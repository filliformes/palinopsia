// Monocular depth estimator (the return to real Z). Lazy-loads transformers.js
// (Hugging Face, WebGPU) from a CDN on first use — so there is NO build-time
// dependency and nothing ships in the installer; the library + the small
// Depth-Anything model download once, when the user first switches Depth to "AI",
// and are cached by the browser. Inference runs at low res, ASYNC and throttled,
// fully decoupled from the 60 Hz render loop : the loop just polls `take()` for the
// latest depth map and the compositor temporally smooths it. Online-only feature.
//
// NOTE: the model path is UNVERIFIED on-GPU (WebGPU availability + speed on the
// Aero). The synthetic-depth mode (Compositor.setSyntheticDepth) exercises the
// whole downstream path — Parallax FX, binding, EMA — without any of this.

// The CDN specifier is hidden from the bundler (`@vite-ignore`) so rollup never
// tries to resolve @huggingface/transformers at build time. Resolved at runtime.
const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2'
const MODEL = 'onnx-community/depth-anything-v2-small'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lib = any
let libPromise: Promise<Lib> | null = null
function loadLib(): Promise<Lib> {
  if (!libPromise) {
    libPromise = import(/* @vite-ignore */ CDN).then((m: Lib) => {
      m.env.allowLocalModels = false
      m.env.useBrowserCache = true
      return m
    })
  }
  return libPromise
}

export type DepthStatus = 'off' | 'loading' | 'ready' | 'failed'

class DepthEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null
  private loading = false
  private failed = false
  private busy = false
  private lastRun = 0
  private result: { data: Float32Array; w: number; h: number } | null = null
  private fresh = false
  /** Minimum ms between inferences (~11 Hz). Depth is slow, so this is plenty. */
  minIntervalMs = 90
  status: DepthStatus = 'off'

  private async ensure(): Promise<void> {
    if (this.pipe || this.loading || this.failed) return
    this.loading = true
    this.status = 'loading'
    try {
      const lib = await loadLib()
      try {
        this.pipe = await lib.pipeline('depth-estimation', MODEL, { device: 'webgpu', dtype: 'fp16' })
      } catch {
        // WebGPU missing / model dtype unavailable → CPU (WASM) fallback (slow).
        this.pipe = await lib.pipeline('depth-estimation', MODEL, { device: 'wasm', dtype: 'q8' })
      }
      this.status = 'ready'
    } catch (e) {
      console.error('[depth] model load failed (needs network + WebGPU/WASM):', e)
      this.failed = true
      this.status = 'failed'
    } finally {
      this.loading = false
    }
  }

  /** Feed a low-res RGBA frame. Kicks off (lazy) load + throttled async inference. */
  update(rgba: Uint8Array, w: number, h: number, nowMs: number): void {
    void this.ensure()
    if (!this.pipe || this.busy || this.failed) return
    if (nowMs - this.lastRun < this.minIntervalMs) return
    this.lastRun = nowMs
    this.busy = true
    void this.run(rgba.slice(0, w * h * 4), w, h)
  }

  private async run(rgba: Uint8Array, w: number, h: number): Promise<void> {
    try {
      const lib = await loadLib()
      const img = new lib.RawImage(rgba, w, h, 4)
      const out = await this.pipe(img)
      const dm = out?.depth ?? (Array.isArray(out) ? out[0]?.depth : null)
      if (dm && dm.data) {
        const dw = dm.width as number, dh = dm.height as number, ch = (dm.channels as number) ?? 1
        const n = dw * dh
        const data = new Float32Array(n)
        let mn = 1e9, mx = -1e9
        for (let i = 0; i < n; i++) { const v = dm.data[i * ch] / 255; data[i] = v; if (v < mn) mn = v; if (v > mx) mx = v }
        const inv = mx > mn ? 1 / (mx - mn) : 1
        for (let i = 0; i < n; i++) data[i] = (data[i] - mn) * inv // normalize to 0..1
        this.result = { data, w: dw, h: dh }
        this.fresh = true
      }
    } catch (e) {
      console.error('[depth] inference failed:', e)
      this.failed = true
      this.status = 'failed'
    } finally {
      this.busy = false
    }
  }

  /** The newest depth map since the last call, or null if nothing new. */
  take(): { data: Float32Array; w: number; h: number } | null {
    if (!this.fresh || !this.result) return null
    this.fresh = false
    return this.result
  }
}

export const depthEngine = new DepthEngine()
