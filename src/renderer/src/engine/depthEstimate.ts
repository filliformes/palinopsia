// Monocular depth estimator (the return to real Z) : Depth Anything V2 Small
// through Transformers.js, both SHIPPED with the app (resources/depth, fetched
// at build time by `npm run fetch:depth`) and loaded over opsia-asset://depth/,
// so it works offline and in a kiosk and nothing is ever fetched from the
// network (workers/depthWorker.ts refuses to start if a network path is left).
//
// The model runs on a thread of its own (the worker), fed a small frame of the
// picture at the inference size (`res` on the long side, the depth menu's
// detail), async and throttled (~11 Hz), fully decoupled from the 60 Hz render
// loop : the loop just polls `take()` for the latest map and the compositor
// smooths it with its EMA. WebGPU (fp16) first, WebAssembly (8-bit) after.

import DepthWorker from '../workers/depthWorker?worker&inline'

export type DepthStatus = 'off' | 'loading' | 'ready' | 'missing' | 'failed'

/** The inference sizes the depth menu offers (long side, px; multiples of 14,
 *  the model's patch). 518 is the model's own training size. */
export const DEPTH_RES_STEPS = [252, 392, 518] as const
export const DEPTH_RES_DEFAULT = 392

export const DEPTH_MISSING_MESSAGE = 'Depth AI is not in this copy of the app : run npm run fetch:depth, then restart it'

type DepthMap = { data: Float32Array; w: number; h: number }

class DepthEngine {
  private worker: Worker | null = null
  private busy = false
  private lastRun = 0
  private result: DepthMap | null = null
  private fresh = false
  // A running engine that stops (a graphics reset takes WebGPU with it) starts
  // again by itself, 3 s later, up to 3 times per switch-on.
  private retryAt = 0
  private retries = 0
  /** Minimum ms between inferences (~11 Hz). Depth is slow, so this is plenty. */
  minIntervalMs = 90
  status: DepthStatus = 'off'
  /** 'webgpu' or 'wasm' once ready. */
  backend = ''
  dtype = ''
  /** Why it is missing or failed (shown in a toast). */
  message = ''
  /** Last inference time (ms, on the worker) and model load time. */
  inferMs = 0
  loadMs = 0
  /** Inference size, long side (px). */
  res: number = DEPTH_RES_DEFAULT

  /** The frame size the model is fed for a picture of this aspect (w / h) : the
   *  long side at `res`, the short one by the aspect, both multiples of 14. On
   *  the processor (no WebGPU) it reads at the lightest size whatever the menu
   *  says : 252 px takes ~0.33 s there, 392 px ~0.85 s (measured, 8-bit). */
  inputSize(aspect: number): [number, number] {
    const res = this.backend === 'wasm' ? Math.min(this.res, DEPTH_RES_STEPS[0]) : this.res
    const long = Math.max(56, Math.round(res / 14) * 14)
    const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9
    const short = Math.max(56, Math.round(long / Math.max(a, 1 / a) / 14) * 14)
    return a >= 1 ? [long, short] : [short, long]
  }

  private start(): void {
    if (this.worker || this.status === 'missing' || this.status === 'failed') return
    if (performance.now() < this.retryAt) return
    this.status = 'loading'
    let w: Worker
    try {
      w = new DepthWorker()
    } catch (e) {
      this.fail(`could not start its thread (${String(e)})`)
      return
    }
    this.worker = w
    w.onmessage = (e: MessageEvent): void => {
      if (this.worker !== w) return // released meanwhile
      this.onWorker(e.data)
    }
    w.onerror = (e: ErrorEvent): void => {
      if (this.worker !== w) return
      e.preventDefault()
      this.fail(e.message || 'its thread stopped')
    }
    // Test builds only : force the processor path to check the fallback.
    const wasmOnly = !!import.meta.env.VITE_OPSIA_TEST && !!(globalThis as { __depthWasmOnly?: boolean }).__depthWasmOnly
    w.postMessage({ t: 'load', wasmOnly })
  }

  private onWorker(m: { t: string; [k: string]: unknown }): void {
    if (m.t === 'depth') {
      this.result = { data: m.data as Float32Array, w: m.w as number, h: m.h as number }
      this.fresh = true
      this.inferMs = m.ms as number
      this.busy = false
    } else if (m.t === 'status') {
      if (m.status === 'ready') {
        this.status = 'ready'
        this.backend = String(m.backend)
        this.dtype = String(m.dtype)
        this.loadMs = m.ms as number
        console.info(`[depth] Depth Anything V2 Small ready on ${this.backend} (${this.dtype}), loaded from the app in ${this.loadMs} ms`)
      } else if (m.status === 'missing') {
        this.stopWorker()
        this.status = 'missing'
        this.message = DEPTH_MISSING_MESSAGE
        console.warn(`[depth] ${DEPTH_MISSING_MESSAGE} (resources/depth has no manifest)`)
      } else if (m.status === 'failed') {
        this.fail(String(m.message))
      }
    } else if (m.t === 'log') {
      console.warn(`[depth] ${String(m.text)}`)
    }
  }

  private fail(why: string): void {
    const wasReady = this.status === 'ready'
    this.stopWorker()
    if (wasReady && this.retries < 3) {
      this.retries++
      this.status = 'off'
      this.retryAt = performance.now() + 3000
      console.warn(`[depth] Depth AI stopped (${why}) : starting it again`)
      return
    }
    this.status = 'failed'
    this.message = wasReady ? `Depth AI stopped : ${why}` : `Depth AI could not start : ${why}`
    console.error(`[depth] ${this.message}`)
  }

  private stopWorker(): void {
    this.worker?.terminate()
    this.worker = null
    this.busy = false
  }

  /** Feed a frame at inputSize(). Starts the engine on first use, then runs one
   *  inference at a time, at most every minIntervalMs. */
  update(rgba: Uint8Array, w: number, h: number, nowMs: number): void {
    this.start()
    if (this.status !== 'ready' || this.busy || !this.worker) return
    if (nowMs - this.lastRun < this.minIntervalMs) return
    this.lastRun = nowMs
    this.busy = true
    const copy = rgba.slice(0, w * h * 4)
    this.worker.postMessage({ t: 'frame', rgba: copy, w, h }, [copy.buffer])
  }

  /** The newest depth map since the last call, or null if nothing new. */
  take(): DepthMap | null {
    if (!this.fresh || !this.result) return null
    this.fresh = false
    return this.result
  }

  /** Depth left the AI mode : end the thread (it frees the model and the GPU
   *  memory it holds). Turning it on again retries a failed or missing engine. */
  release(): void {
    this.stopWorker()
    this.status = 'off'
    this.retries = 0
    this.retryAt = 0
    this.backend = ''
    this.dtype = ''
    this.message = ''
    this.result = null
    this.fresh = false
  }
}

export const depthEngine = new DepthEngine()

// A hot update re-runs this module as a new copy : end the old copy's thread
// (dev only, compiled out of builds).
if (import.meta.hot) {
  const g = globalThis as { __opsiaDepth?: DepthEngine }
  g.__opsiaDepth?.release()
  g.__opsiaDepth = depthEngine
}
