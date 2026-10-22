// The AI depth engine's own thread (engine/depthEstimate.ts starts it).
//
// Depth Anything V2 Small runs here through Transformers.js 3.0.2 and its
// onnxruntime-web, ALL of it shipped with the app in resources/depth (fetched at
// build time by `npm run fetch:depth`, every file hash-checked) and served over
// opsia-asset://depth/ (main/assets.ts). Nothing is ever fetched from the
// network : every path the library could build points inside the app, and
// configure() refuses to start if one does not.
//
// Why a thread of its own : creating the model's session and running it on the
// WebAssembly fallback are synchronous, a second or more each, and on the render
// thread they froze the picture. Here the 60 fps loop only posts a small frame
// and takes back a finished map.

const BASE = 'opsia-asset://depth/'
const MODEL = 'onnx-community/depth-anything-v2-small'
// Each backend's weights (the pairing the old CDN path asked for), measured at 392
// px on the RTX 4070 : fp16 on the graphics card, 22 ms a map (q4f16 took 98 ms
// and misread a floor, 8-bit fell back to the processor : 870 ms); 8-bit on the
// processor, 845 ms, 1.5x faster than fp16 there and matching it (r 0.997+).
const DTYPE = { webgpu: 'fp16', wasm: 'q8' } as const
// The range the map is placed in follows the model's own range this slowly (s).
const RANGE_TAU = 1.5

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let lib: Any = null
let model: Any = null
let mean = [0.485, 0.456, 0.406]
let std = [0.229, 0.224, 0.225]
let px: Float32Array | null = null
let lo = 0
let hi = 1
let ranged = false
let lastRun = 0
let chain: Promise<unknown> = Promise.resolve()
const hist = new Uint32Array(256)

// The worker's global, typed by hand (the page's DOM types describe a window).
const g = self as unknown as {
  navigator: Navigator
  postMessage(m: unknown, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent) => void) | null
}
const post = (m: Record<string, unknown>, transfer: Transferable[] = []): void => g.postMessage(m, transfer)

/** Point every path at the bundle and prove it : no network, ever. */
function configure(env: Any): void {
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = BASE + 'models/'
  // Never used with remote models off; pointed inside the app all the same.
  env.remoteHost = BASE + 'remote-disabled/'
  env.useBrowserCache = false
  env.useFSCache = false
  const onnx = env.backends?.onnx
  const wasm = onnx?.wasm
  if (wasm) {
    wasm.wasmPaths = BASE
    wasm.proxy = false // already off the render thread
  }
  // The runtime's own warnings (which graph nodes stay on the processor) came out
  // as console errors at every load : errors only.
  if (onnx) onnx.logLevel = 'error'
  // Windows ignores a power preference and warns each time one is asked (the app
  // already runs on the discrete card : main asks for it), so none is asked.
  if (onnx?.webgpu) onnx.webgpu.powerPreference = undefined
  const net = /^(https?:)?\/\//i
  const paths = [env.localModelPath, env.remoteHost, wasm?.wasmPaths]
  if (env.allowRemoteModels || !wasm || paths.some((p) => typeof p !== 'string' || net.test(p))) {
    throw new Error('a network path is still configured : refusing to start')
  }
}

async function load(wasmOnly = false): Promise<void> {
  const t0 = performance.now()
  // The fetch script writes the manifest last, once every file is verified.
  const manifest = await fetch(BASE + 'manifest.json').then((r) => (r.ok ? r.json() : null), () => null)
  if (!manifest) {
    post({ t: 'status', status: 'missing' })
    return
  }
  lib = await import(/* @vite-ignore */ BASE + 'transformers.min.js')
  configure(lib.env)
  const pp = await fetch(`${BASE}models/${MODEL}/preprocessor_config.json`).then((r) => r.json())
  if (Array.isArray(pp.image_mean) && Array.isArray(pp.image_std)) {
    mean = pp.image_mean
    std = pp.image_std
  }
  // logSeverityLevel 3 : the session logs errors only (see configure()).
  const opts = { local_files_only: true, session_options: { logSeverityLevel: 3 } }
  let backend: 'webgpu' | 'wasm' = 'wasm'
  if (!wasmOnly && 'gpu' in g.navigator) {
    try {
      model = await lib.AutoModelForDepthEstimation.from_pretrained(MODEL, { ...opts, device: 'webgpu', dtype: DTYPE.webgpu })
      backend = 'webgpu'
    } catch (e) {
      post({ t: 'log', level: 'warn', text: `WebGPU refused (${String(e)}) : using the processor` })
    }
  }
  if (!model) model = await lib.AutoModelForDepthEstimation.from_pretrained(MODEL, { ...opts, device: 'wasm', dtype: DTYPE.wasm })
  post({ t: 'status', status: 'ready', backend, dtype: DTYPE[backend], ms: Math.round(performance.now() - t0) })
}

/** A float16 tensor's data comes back as raw halves (Uint16Array) without Float16Array. */
function toF32(data: ArrayLike<number>, type: string): Float32Array {
  if (type !== 'float16' || !(data instanceof Uint16Array)) return data instanceof Float32Array ? data : Float32Array.from(data)
  const out = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const h = data[i], e = (h >> 10) & 31, f = h & 1023
    const v = e === 0 ? f * 5.960464477539063e-8 : e === 31 ? (f ? NaN : Infinity) : (1 + f / 1024) * 2 ** (e - 15)
    out[i] = h & 32768 ? -v : v
  }
  return out
}

async function infer(rgba: Uint8Array, w: number, h: number): Promise<void> {
  const n = w * h
  if (!px || px.length !== 3 * n) px = new Float32Array(3 * n)
  // The frame comes at the inference size (a multiple of 14, the model's patch),
  // so it is only normalized here (NCHW, the model's mean / std), never resampled.
  const m0 = mean[0], m1 = mean[1], m2 = mean[2]
  const k0 = 1 / (255 * std[0]), k1 = 1 / (255 * std[1]), k2 = 1 / (255 * std[2])
  const o0 = m0 / std[0], o1 = m1 / std[1], o2 = m2 / std[2]
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    px[i] = rgba[j] * k0 - o0
    px[n + i] = rgba[j + 1] * k1 - o1
    px[2 * n + i] = rgba[j + 2] * k2 - o2
  }
  const t0 = performance.now()
  const out = await model({ pixel_values: new lib.Tensor('float32', px, [1, 3, h, w]) })
  const ms = performance.now() - t0
  const pd = out.predicted_depth
  const dims: number[] = pd.dims
  const dh = dims[dims.length - 2], dw = dims[dims.length - 1]
  const raw = toF32(pd.data, pd.type)
  pd.dispose?.()
  // Depth Anything answers RELATIVE depth (disparity : larger is nearer) on a
  // scale of its own that drifts from frame to frame. Stretching each map to its
  // own min..max (the library's depth image, and what the CDN path did) made the
  // whole map breathe each time something came in or left. The map is placed
  // instead in a range that FOLLOWS the model's (its 2nd..98th percentile) over
  // RANGE_TAU seconds : a new scene settles within a couple of seconds and the
  // picture never pumps. The compositor's EMA smooths the map itself on top.
  let mn = Infinity, mx = -Infinity
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  let plo = mn, phi = mx
  if (mx > mn) {
    hist.fill(0)
    const s = 255 / (mx - mn)
    for (let i = 0; i < raw.length; i++) hist[((raw[i] - mn) * s) | 0]++
    const cut = raw.length * 0.02
    let acc = 0, b = 0
    for (; b < 255 && acc + hist[b] < cut; b++) acc += hist[b]
    plo = mn + b / s
    acc = 0
    for (b = 255; b > 0 && acc + hist[b] < cut; b--) acc += hist[b]
    phi = mn + (b + 1) / s
  }
  const now = performance.now()
  if (!ranged) {
    lo = plo
    hi = phi
    ranged = true
  } else {
    const k = 1 - Math.exp(-Math.min(1, (now - lastRun) / 1000) / RANGE_TAU)
    lo += (plo - lo) * k
    hi += (phi - hi) * k
  }
  lastRun = now
  const inv = hi > lo ? 1 / (hi - lo) : 0
  const data = new Float32Array(dw * dh)
  for (let i = 0; i < data.length; i++) {
    const v = (raw[i] - lo) * inv
    data[i] = v < 0 ? 0 : v > 1 ? 1 : v
  }
  post({ t: 'depth', data, w: dw, h: dh, ms }, [data.buffer])
}

g.onmessage = (e: MessageEvent): void => {
  const m = e.data
  const fail = (err: unknown): void => post({ t: 'status', status: 'failed', message: String((err as Error)?.message ?? err) })
  if (m.t === 'load') chain = chain.then(() => load(!!m.wasmOnly)).catch(fail)
  else if (m.t === 'frame') chain = chain.then(() => infer(m.rgba, m.w, m.h)).catch(fail)
}
