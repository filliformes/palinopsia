// PersonMask : who is in a layer's own picture. A video or capture slot with
// People on hands its frames, scaled down, to a body worker of its own
// (bodyWorker.ts : MediaPipe Pose lite, the model the Body page uses, one mask
// per person found, merged) and keeps the newest mask as an R8 texture in the
// compositor's context, in the frame's own coordinates. The framing blit then
// cuts the people out, blurs what is around them, or takes them away.
//
// The mask is computed on the slot's own frames, so it lines up with them
// whatever the camera (the Body page's tracker has a capture of its own). One
// frame in flight at a time : the picture never waits for the model, the mask
// just trails it by one detection (about 10 to 30 ms).

import { createBodyWorker } from './bodyWorker'

const WASM_BASE = 'opsia-asset://local/wasm'
const POSE_MODEL = 'opsia-asset://local/models/pose_landmarker_lite.task'
const BUNDLE_URL = 'opsia-asset://local/vision_bundle.js'
// The width the model is fed. Its own input is 256 square : more costs time and
// buys no sharper edge.
const FEED_W = 320

/** What People is doing, for the framing section's readout. */
export interface PersonStatus {
  state: 'loading' | 'running' | 'failed'
  people: number // found in the last detection
  ms: number // the last detection's time in the worker
  error: string
}

// The readout reads this by layer and slot (the UI never touches the engine).
const statuses = new Map<string, PersonStatus>()
export function personStatus(layer: number, slot: 'A' | 'B'): PersonStatus | null {
  return statuses.get(`${layer}${slot}`) ?? null
}

/** A frame the slot already holds : its <video>, or an RGBA buffer (top row first). */
export type PersonFrame = HTMLVideoElement | { w: number; h: number; stride: number; buf: ArrayBuffer }

export class PersonMask {
  private worker: Worker | null = null
  private ready = false
  private cfgPending = false
  private people = 2
  private configured = 0
  private inFlight = false
  private inFlightAt = 0
  private lastTs = 0
  private disposed = false
  private tex: WebGLTexture | null = null
  private texW = 0
  private texH = 0
  private pending: { mask: Uint8Array; w: number; h: number } | null = null
  private has = false
  readonly status: PersonStatus = { state: 'loading', people: 0, ms: 0, error: '' }

  constructor(
    private gl: WebGL2RenderingContext,
    private key: string
  ) {
    statuses.set(key, this.status)
    try {
      const w = createBodyWorker()
      this.worker = w
      w.onmessage = (e: MessageEvent): void => this.onMessage(e.data)
      w.onerror = (e: ErrorEvent): void => this.fail(e.message || 'the worker stopped')
      w.postMessage({ t: 'init', urls: { bundle: BUNDLE_URL, wasm: WASM_BASE, pose: POSE_MODEL, hand: '', face: '' } })
    } catch (e) {
      this.fail((e as Error).message)
    }
  }

  /** How many people to look for (1 to 4 : the model finds each one separately). */
  setPeople(n: number): void {
    this.people = Math.max(1, Math.min(4, Math.round(n) || 1))
    if (this.ready && !this.cfgPending && this.configured !== this.people) this.configure()
  }

  private configure(): void {
    if (!this.worker) return
    this.configured = this.people
    this.cfgPending = true
    this.worker.postMessage({ t: 'config', cfg: { hands: false, pose: false, face: false, silhouette: true, people: this.people } })
  }

  private fail(msg: string): void {
    this.status.state = 'failed'
    this.status.error = msg
    this.inFlight = false
    console.warn('[people]', msg)
  }

  private onMessage(m: {
    t: string
    msg?: string
    ms?: number
    people?: number
    error?: string
    sil?: { mask?: Uint8Array; w?: number; h?: number; empty?: boolean } | null
  }): void {
    if (this.disposed) return
    if (m.t === 'ready') {
      this.ready = true
      this.configure()
    } else if (m.t === 'configured') {
      this.cfgPending = false
      this.status.state = 'running'
      this.status.error = ''
      // The count changed while the model was being built : build it again.
      if (this.configured !== this.people) this.configure()
    } else if (m.t === 'error') {
      this.cfgPending = false
      this.fail(m.msg || 'the model did not load')
    } else if (m.t === 'result') {
      this.inFlight = false
      this.status.ms = Math.round(m.ms ?? 0)
      if (m.error) return // a hiccup on this frame only
      this.status.people = m.people ?? 0
      const s = m.sil
      if (s && s.mask && s.w && s.h) this.pending = { mask: s.mask, w: s.w, h: s.h }
      else if (s && s.empty) this.pending = { mask: new Uint8Array(1), w: 1, h: 1 } // nobody
    }
  }

  /** Hand the model the slot's current frame, if it is free (never waits). */
  feed(frame: PersonFrame | null): void {
    const w = this.worker
    if (!w || !frame || !this.ready || this.cfgPending || this.disposed || this.status.state === 'failed') return
    // A reply that never came (a lost frame) must not block it for good.
    if (this.inFlight && performance.now() - this.inFlightAt < 2000) return
    let make: Promise<ImageBitmap>
    try {
      if (frame instanceof HTMLVideoElement) {
        if (frame.readyState < 2 || !frame.videoWidth || !frame.videoHeight) return
        const h = Math.max(1, Math.round((FEED_W * frame.videoHeight) / frame.videoWidth))
        make = createImageBitmap(frame, { resizeWidth: FEED_W, resizeHeight: h, resizeQuality: 'low' })
      } else {
        if (!(frame.w > 0 && frame.h > 0) || frame.stride !== frame.w * 4 || frame.buf.byteLength < frame.w * frame.h * 4) return
        const img = new ImageData(new Uint8ClampedArray(frame.buf, 0, frame.w * frame.h * 4), frame.w, frame.h)
        const h = Math.max(1, Math.round((FEED_W * frame.h) / frame.w))
        make = createImageBitmap(img, { resizeWidth: FEED_W, resizeHeight: h, resizeQuality: 'low' })
      }
    } catch {
      return
    }
    this.inFlight = true
    this.inFlightAt = performance.now()
    // The model wants its frame times strictly increasing.
    const ts = Math.max(this.lastTs + 1, Math.round(performance.now()))
    this.lastTs = ts
    make
      .then((bitmap) => {
        if (this.disposed || this.worker !== w) {
          bitmap.close()
          return
        }
        w.postMessage({ t: 'frame', bitmap, ts, camT: 0, newFrame: true, silhouette: true, mirror: false, full: true }, [bitmap])
      })
      .catch(() => {
        this.inFlight = false
      })
  }

  /** The newest mask (uploaded here, inside the render), or null before the first. */
  texture(): WebGLTexture | null {
    const p = this.pending
    if (p) {
      this.pending = null
      const gl = this.gl
      if (!this.tex) {
        this.tex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, this.tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      }
      gl.bindTexture(gl.TEXTURE_2D, this.tex)
      // Rows are top-down and any width : no flip (the ISF runtime leaves it on),
      // byte alignment.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      if (p.w !== this.texW || p.h !== this.texH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, p.w, p.h, 0, gl.RED, gl.UNSIGNED_BYTE, p.mask)
        this.texW = p.w
        this.texH = p.h
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, p.w, p.h, gl.RED, gl.UNSIGNED_BYTE, p.mask)
      }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
      this.has = true
    }
    return this.has ? this.tex : null
  }

  dispose(): void {
    this.disposed = true
    statuses.delete(this.key)
    try {
      this.worker?.postMessage({ t: 'stop' })
      this.worker?.terminate()
    } catch {
      /* gone */
    }
    this.worker = null
    if (this.tex) this.gl.deleteTexture(this.tex)
    this.tex = null
  }
}
