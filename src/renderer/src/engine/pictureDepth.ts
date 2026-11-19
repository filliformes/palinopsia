// The depth of ONE picture (the layer a Point Cloud lifts, the picture entering a
// Depth Scan), not of the whole frame. The shared depth map reads the presented
// frame, and a piece standing on that map stands on its own result : a cloud
// raised by the depth of itself, a depth slice keyed by the depth of its own
// matte, frame after frame. So these pieces have a depth engine of their own (a
// second copy of the same model, engine/depthEstimate.ts), fed the picture they
// work on.
//
// It runs only while the depth engine is switched to AI (the shared engine is
// loading or ready : the app's one switch for the model) and while a piece asks;
// three seconds after the last ask it is released (the model and its graphics
// memory go with it). Several pieces take turns : one frame in flight
// at a time, and its map goes back to the piece that sent it.

import { DepthEngine, depthEngine } from './depthEstimate'
import { EngineGL, type Prog, type Target } from './organicGL'
import { GridReadback } from './gridReadback'

type DepthMap = { data: Float32Array; w: number; h: number }

const IDLE_MS = 3000

class PictureDepth {
  private eng: DepthEngine | null = null
  private inflight: object | null = null
  private lastServed: object | null = null
  private asks = new Map<object, number>()
  private maps = new Map<object, DepthMap>()

  /** True while the app's depth engine is set to AI : the clouds may read depth. */
  wanted(): boolean {
    return depthEngine.status === 'loading' || depthEngine.status === 'ready'
  }

  /** The engine's state, for a cloud's status line. */
  get status(): string {
    return this.eng ? this.eng.status : 'off'
  }

  /** The frame size the model wants for a picture of this aspect. */
  inputSize(aspect: number): [number, number] {
    const e = this.engine()
    e.res = depthEngine.res
    return e.inputSize(aspect)
  }

  private engine(): DepthEngine {
    if (!this.eng) this.eng = new DepthEngine()
    return this.eng
  }

  /** A cloud's frame (top-down RGBA at inputSize). False when it was not taken
   *  (the model is busy, or it is another cloud's turn). */
  feed(owner: object, rgba: Uint8Array, w: number, h: number, now: number): boolean {
    this.asks.set(owner, now)
    this.sweep(now)
    const e = this.engine()
    e.res = depthEngine.res
    // take turns : the cloud just served waits while another one asked lately
    if (owner === this.lastServed && this.asks.size > 1) {
      for (const [o, t] of this.asks) if (o !== owner && now - t < 400) return false
    }
    this.collect()
    if (this.inflight) return false
    if (!e.update(rgba, w, h, now)) return false
    this.inflight = owner
    return true
  }

  /** The newest map for this cloud since its last call, or null. */
  take(owner: object): DepthMap | null {
    this.collect()
    const m = this.maps.get(owner) ?? null
    if (m) this.maps.delete(owner)
    return m
  }

  private collect(): void {
    if (!this.eng) return
    const m = this.eng.take()
    if (m && this.inflight) {
      this.maps.set(this.inflight, m)
      this.lastServed = this.inflight
      this.inflight = null
    }
    // a model that stopped (or never started) holds no frame in flight
    if (this.eng.status !== 'ready' && this.eng.status !== 'loading') this.inflight = null
  }

  private sweep(now: number): void {
    for (const [o, t] of this.asks) if (now - t > IDLE_MS) { this.asks.delete(o); this.maps.delete(o) }
  }

  /** A cloud that no longer reads depth (it went, or switched to brightness). */
  release(owner: object): void {
    this.asks.delete(owner)
    this.maps.delete(owner)
    if (this.inflight === owner) this.inflight = null
    if (!this.asks.size) this.shutdown()
  }

  /** Every cloud is gone, or the model is no longer wanted : free it. */
  idle(now: number): void {
    this.sweep(now)
    if (!this.asks.size && this.eng) this.shutdown()
  }

  shutdown(): void {
    this.eng?.release()
    this.eng = null
    this.inflight = null
    this.lastServed = null
    this.maps.clear()
  }
}

export const pictureDepth = new PictureDepth()

// A hot update re-runs this module as a new copy : end the old copy's thread
// (dev only, compiled out of builds).
if (import.meta.hot) {
  const g = globalThis as { __opsiaPictureDepth?: PictureDepth }
  g.__opsiaPictureDepth?.shutdown()
  g.__opsiaPictureDepth = pictureDepth
}

// ── A reader : one consumer's view of its own picture's depth ─────────────────

const COPY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uTex;
void main() { vec4 c = texture(uTex, vUV); o = vec4(c.rgb * c.a, 1.0); }`

// The map glides toward the newest one a frame at a time : the model gives ten
// maps a second (fewer when several readers share it), and a contour or a relief
// standing on them would step at each.
const GLIDE_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUV;
out vec4 o;
uniform sampler2D uPrev, uRaw;
uniform float uK;
void main() {
  float t = texture(uRaw, vec2(vUV.x, 1.0 - vUV.y)).r; // the model's rows run top-down
  o = vec4(mix(texture(uPrev, vUV).r, t, uK), 0.0, 0.0, 1.0);
}`

/** The depth of the picture a piece works on (a Point Cloud's layer, a Depth
 *  Scan's input), read by the shared picture-depth engine about ten times a
 *  second and smoothed between maps. `step` returns the map (GL rows, 1 = near)
 *  once the first one has come, else null : the caller reads brightness meanwhile. */
export class PictureDepthReader {
  private g: EngineGL
  private copyP: Prog
  private glideP: Prog
  private read: GridReadback | null = null
  private raw: WebGLTexture | null = null
  private rawW = 0
  private rawH = 0
  private sm: [Target, Target] | null = null
  private si = 0
  private have = false
  private fresh = false
  private lastAsk = 0
  private flipBuf: Uint8Array | null = null
  private asking = false

  constructor(gl: WebGL2RenderingContext) {
    this.g = new EngineGL(gl, 'picturedepth')
    this.copyP = this.g.prog(COPY_FS)
    this.glideP = this.g.prog(GLIDE_FS)
  }

  /** One frame : collect what landed, ask again when due, glide. `dt` seconds. */
  step(src: WebGLTexture, aspect: number, dt: number): WebGLTexture | null {
    const g = this.g, gl = g.gl
    if (!g.ok) return null
    const now = performance.now()
    this.asking = true
    if (!this.read) this.read = new GridReadback(gl)
    const got = this.read.takeLatest()
    if (got) {
      // readPixels is bottom-up; the model wants the picture upright
      const s = got.grid, gw = got.w, gh = got.h, row = gw * 4
      if (!this.flipBuf || this.flipBuf.length !== s.length) this.flipBuf = new Uint8Array(s.length)
      const out = this.flipBuf
      for (let y = 0; y < gh; y++) out.set(s.subarray((gh - 1 - y) * row, (gh - y) * row), y * row)
      pictureDepth.feed(this, out, gw, gh, now)
    }
    if (now - this.lastAsk > 85) {
      this.lastAsk = now
      const [iw, ih] = pictureDepth.inputSize(aspect)
      this.read.kick(iw, ih, src, this.copyP.p, this.copyP.u('uTex'), g.vao)
    }
    const m = pictureDepth.take(this)
    if (m) {
      if (!this.raw) {
        this.raw = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, this.raw)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      }
      gl.bindTexture(gl.TEXTURE_2D, this.raw)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
      // float data into a half-float texture : filtered in hardware, no stepping
      if (m.w !== this.rawW || m.h !== this.rawH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, m.w, m.h, 0, gl.RED, gl.FLOAT, m.data)
        this.rawW = m.w
        this.rawH = m.h
        for (const t of this.sm ?? []) g.freeTarget(t)
        this.sm = [g.target(m.w, m.h, { half: 'r', linear: true }), g.target(m.w, m.h, { half: 'r', linear: true })]
        this.fresh = true
      } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, m.w, m.h, gl.RED, gl.FLOAT, m.data)
      gl.bindTexture(gl.TEXTURE_2D, null)
      this.have = true
    }
    if (!this.have || !this.sm) return null
    const k = this.fresh ? 1 : 1 - Math.exp(-Math.max(0, dt) / 0.12)
    this.fresh = false
    this.glideP.use().i1('uPrev', 0).i1('uRaw', 1).f1('uK', k)
    g.bind(0, this.sm[this.si].tex)
    g.bind(1, this.raw)
    g.draw(this.sm[1 - this.si].fbo, this.rawW, this.rawH)
    this.si = 1 - this.si
    g.done(2)
    return this.sm[this.si].tex
  }

  /** The piece no longer reads depth (it switched to brightness, depth went off). */
  stop(): void {
    if (!this.asking) return
    this.asking = false
    this.have = false
    // (the next map starts fresh : never glided from the one before it stopped)
    this.rawW = this.rawH = 0
    pictureDepth.release(this)
    this.read?.dispose()
    this.read = null
  }

  dispose(): void {
    this.stop()
    const g = this.g
    for (const t of this.sm ?? []) g.freeTarget(t)
    this.sm = null
    if (this.raw) g.gl.deleteTexture(this.raw)
    this.raw = null
    g.dispose()
  }
}
