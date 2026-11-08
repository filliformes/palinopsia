// The Room tracker's own thread (engine/roomTracker.ts starts it).
//
// RTMO, a one-stage multi-person pose model (OpenMMLab MMPose, Apache-2.0) : one
// pass finds every person in the frame with a box and 17 body points (COCO order),
// near or far, facing the camera or not. Run by onnxruntime-web 1.30 on the graphics
// card (WebGPU), on the processor (WebAssembly) when the card can't. Everything
// comes from resources/pose over opsia-asset://pose/ (`npm run fetch:pose`, every
// file hash-checked), never from the network.
//
// The model's own pipeline (its pipeline.json) : the frame scaled to fit 640 x 640
// from the top-left corner, the rest grey 114, BGR, 0..255, no normalisation. Out :
// boxes [1, N, 5] (x1 y1 x2 y2 score) and points [1, N, 17, 3] (x y score), in the
// 640 square; the duplicates of one person are removed here (NMS).
//
// Messages in  : init {model} · frame {bitmap, id, thr}
// Messages out : ready {ep, inputs, outputs} · error {msg} ·
//                result {id, people [{score, box [x1 y1 x2 y2], k [17 x (x y s)]}]
//                (normalised to the frame), runMs, prepMs, w, h}

export {} // a module : its names stay its own (depthWorker.ts has the same ones)

const BASE = 'opsia-asset://pose/'
const S = 640 // the model's input is fixed at 640 x 640 (it refuses any other size)
const NMS_IOU = 0.65

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let ort: Any = null
let session: Any = null
let inName = ''
let ctx: OffscreenCanvasRenderingContext2D | null = null
let buf: Float32Array | null = null

// The worker's global, typed by hand (the page's DOM types describe a window).
const g = self as unknown as {
  postMessage(m: unknown): void
  onmessage: ((e: MessageEvent) => void) | null
}
const post = (m: Record<string, unknown>): void => g.postMessage(m)

async function init(model: string): Promise<void> {
  // fetch:pose writes the manifest last, once every file is verified
  const mf = await fetch(BASE + 'manifest.json').catch(() => null)
  if (!mf || !mf.ok) throw new Error('the Room tracker is not in this build : run npm run fetch:pose, then build again')
  ort = await import(/* @vite-ignore */ BASE + 'ort.webgpu.min.mjs')
  ort.env.wasm.wasmPaths = BASE
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false // already off the render thread
  const url = `${BASE}models/rtmo-${model}.onnx`
  let ep = 'webgpu'
  try {
    session = await ort.InferenceSession.create(url, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' })
  } catch {
    ep = 'wasm'
    session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  }
  inName = session.inputNames[0]
  const canvas = new OffscreenCanvas(S, S)
  ctx = canvas.getContext('2d', { willReadFrequently: true })
  buf = new Float32Array(3 * S * S)
  post({ t: 'ready', ep, inputs: session.inputNames, outputs: session.outputNames })
}

const iou = (a: number[], b: number[]): number => {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
  return u > 0 ? inter / u : 0
}

async function frame(bitmap: ImageBitmap, id: number, thr: number): Promise<void> {
  if (!session || !ctx || !buf) {
    bitmap.close()
    return
  }
  const t0 = performance.now()
  const w = bitmap.width, h = bitmap.height
  const r = Math.min(S / w, S / h)
  ctx.fillStyle = 'rgb(114,114,114)'
  ctx.fillRect(0, 0, S, S)
  ctx.drawImage(bitmap, 0, 0, Math.round(w * r), Math.round(h * r))
  bitmap.close()
  const px = ctx.getImageData(0, 0, S, S).data
  const n = S * S
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    buf[i] = px[j + 2] // B
    buf[n + i] = px[j + 1] // G
    buf[2 * n + i] = px[j] // R
  }
  const t1 = performance.now()
  const out = await session.run({ [inName]: new ort.Tensor('float32', buf, [1, 3, S, S]) })
  const t2 = performance.now()
  let dets: Any = null
  let kps: Any = null
  for (const k of session.outputNames) {
    const t = out[k]
    if (t.dims.length === 3 && t.dims[2] === 5) dets = t
    else if (t.dims.length === 4) kps = t
  }
  const people: Array<{ score: number; box: number[]; k: number[] }> = []
  if (dets && kps) {
    const D = dets.data as Float32Array
    const K = kps.data as Float32Array
    const count = dets.dims[1] as number
    const nk = kps.dims[2] as number
    const cand: Array<{ i: number; s: number; b: number[] }> = []
    for (let i = 0; i < count; i++) {
      const s = D[i * 5 + 4]
      if (s >= thr) cand.push({ i, s, b: [D[i * 5], D[i * 5 + 1], D[i * 5 + 2], D[i * 5 + 3]] })
    }
    cand.sort((a, b) => b.s - a.s)
    const kept: typeof cand = []
    for (const c of cand) if (kept.every((k) => iou(k.b, c.b) < NMS_IOU)) kept.push(c)
    for (const c of kept) {
      const k: number[] = []
      for (let j = 0; j < nk; j++) {
        const o = (c.i * nk + j) * 3
        k.push(K[o] / r / w, K[o + 1] / r / h, K[o + 2])
      }
      people.push({ score: c.s, box: [c.b[0] / r / w, c.b[1] / r / h, c.b[2] / r / w, c.b[3] / r / h], k })
    }
  }
  post({ t: 'result', id, people, runMs: t2 - t1, prepMs: t1 - t0, w, h })
}

let chain: Promise<unknown> = Promise.resolve()
g.onmessage = (e: MessageEvent): void => {
  const m = e.data as { t: string; model?: string; bitmap?: ImageBitmap; id?: number; thr?: number }
  if (m.t === 'init') {
    chain = chain.then(() => init(m.model ?? 's')).catch((err) => post({ t: 'error', msg: String((err && err.message) || err) }))
  } else if (m.t === 'frame' && m.bitmap) {
    const bmp = m.bitmap
    chain = chain.then(() => frame(bmp, m.id ?? 0, m.thr ?? 0.35)).catch((err) => post({ t: 'error', msg: String((err && err.message) || err), id: m.id }))
  }
}
