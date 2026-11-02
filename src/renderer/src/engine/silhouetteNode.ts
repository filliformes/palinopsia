// Silhouette (the native node 'node-silhouette') : the Silhouette source's four
// looks, made an effect. Dropped on any picture (an imported film, a camera
// layer, an NDI input, a generator), it finds the people IN that picture and
// draws CUTOUT (the picture where they are, transparent elsewhere), MATTE (white
// people on black), SHADOW (a flat colored figure) or HOLE (the picture with the
// people taken out), with the source's TRAIL and TRAIL COLOR (silhouetteLook.ts :
// one copy of the looks for both), OVER (the result laid over the input) and MIX.
//
// How it finds them, never holding the picture up :
// - its input is read back small (the long edge 384 / 512 / 768 px, the
//   picture's own aspect, upright, over black) through an async readback ring
//   (gridReadback.ts : pixel-pack buffers + fences, never a stall);
// - the newest frame goes to the body model (MediaPipe Pose lite with its
//   segmentation masks, bodyWorker.ts, the model the Body page and People use)
//   in a worker : ONE worker for every Silhouette effect (the finder below),
//   one frame in flight, each effect in turn (the one served longest ago goes
//   next), at most 30 looks a second each. Alone, the model follows the bodies
//   from frame to frame (VIDEO mode); shared by several effects it looks at each
//   frame on its own (IMAGE mode : frames from several pictures in turn);
// - up to 4 people, their masks united; the mask comes back at the read size,
//   in the picture's own frame (no mirror, no camera aspect), is uploaded (R8)
//   and smoothed over time on the GPU (an R16F state following it at the
//   picture's rate, SMOOTH = its time constant), then cut with THRESHOLD and
//   SOFTNESS like the source.
// A picture that has not changed (a paused film, a still) gets three looks,
// then rests. No person : the mask fades to nothing (cutout empty, hole = the input).
// The mask trails the picture by its detection (a few frames); SYNC holds the
// picture back by that much instead (a ring of copies of the input, as many as
// the measured delay needs, at most SYNC_MAX), so the cut fits a fast move.
// FILL (the sidechain : another layer, picked in the Inspector) is what is drawn
// WHERE THE PEOPLE ARE, screen-aligned (that layer seen through a window shaped
// like them) : CUTOUT the fill inside them and nothing elsewhere, HOLE the
// picture around them and the fill inside, SHADOW the fill tinted by the shadow
// color (multiplied : white leaves it as it is) at the color's opacity; MATTE
// ignores it. SHADE lays the figure's own light and shadow over the fill (hard
// light, measured against the figure's own mean and spread so a dim film and a
// bright one both read), so the body stays readable. The trail keeps the fill
// as it was, each echo a remembered pose made of it (in HOLE too : the fill
// lingers in the picture where they passed). A muted fill layer still renders
// while this reads it (the Compositor's sideReading), so it shows only in the
// people. No fill picked = the old programs, untouched (the same pixels).
// Bypassed, or on a muted layer nobody reads (ctx.live false), it does nothing
// at all : no readback, no look; the shared worker is let go after 30 s unused.
// It never opens a camera and never downloads anything : the model ships in
// resources/mediapipe.

import { createBodyWorker } from './bodyWorker'
import { GridReadback } from './gridReadback'
import { glGeneration } from './glGeneration'
import { SIL_LOOK_GLSL, SilTrail, trailKeep } from './silhouetteLook'
import type { ConvNode, NodeContext } from './convNodes'

// The body model, as personMask.ts loads it (resources/mediapipe over opsia-asset://).
const WASM_BASE = 'opsia-asset://local/wasm'
const POSE_MODEL = 'opsia-asset://local/models/pose_landmarker_lite.task'
const BUNDLE_URL = 'opsia-asset://local/vision_bundle.js'

/** The long edge the picture is read at, per `detail` : low · normal · high. The
 *  model's own input is 256 px (the person's crop) : more costs time and only
 *  helps a small figure. */
const FEED = [384, 512, 768]
/** Looks a second, at most, per effect (films run 24-30 frames a second). */
const MAX_RATE = 30
/** Looks at a picture that does not change (a paused film, a still) before
 *  resting on it : the model, following bodies from frame to frame, may lose
 *  them on a jump (a seek) and finds them again on the next look. */
const SAME_LOOKS = 3
/** A client not drawn for this long no longer counts (bypassed, its layer muted). */
const ACTIVE_MS = 1000
/** No client drawn for this long : the worker and its model are let go. */
const IDLE_WORKER_MS = 30000
/** Shared by several effects : back to following bodies (VIDEO) only after
 *  being alone this long (each switch builds the model again). */
const ALONE_MS = 3000
/** SYNC : the longest the picture is held back, in frames (8 RGBA8 copies of it :
 *  66 MB at 1080p, 134 MB at the dome's 2048², and only while SYNC is on). */
const SYNC_MAX = 8

const num = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)

// ── The finder : one body worker for every Silhouette effect ────────────────

export interface FinderStatus {
  state: 'off' | 'loading' | 'running' | 'failed'
  error: string
  /** Effects drawn in the last second. */
  clients: number
  /** Looks a second, all effects together (over the last 2 s). */
  rate: number
  /** The last look's time in the worker. */
  ms: number
  /** People found in the last look. */
  people: number
  /** 'video' (one effect : bodies followed) or 'image' (shared). */
  mode: 'video' | 'image'
}

export interface FinderResult {
  mask: Uint8Array | null // null : nobody
  w: number
  h: number
  people: number
  cov: number // the mask's mean over the frame
}

export class FinderClient {
  people = 2
  seen = 0 // last time it asked (it is drawing)
  due = false // it has a frame to give and its rate allows
  served = 0 // when it last gave a frame
  looks: number[] = [] // when its results came (the last 2 s)
  result: FinderResult | null = null // the newest, not yet taken
  last: FinderResult | null = null // the newest, for readouts
  constructor(readonly id: number) {}
  /** Its looks a second (the last 2 s). */
  rate(now = performance.now()): number {
    while (this.looks.length && now - this.looks[0] > 2000) this.looks.shift()
    return this.looks.length / 2
  }
}

class SilhouetteFinder {
  private worker: Worker | null = null
  private ready = false
  private cfgPending = false
  private cfgPeople = 0
  private cfgImage = false
  private sharedAt = 0 // last time several effects were drawing
  private clients = new Set<FinderClient>()
  private nextId = 1
  private inFlight: FinderClient | null = null
  private inFlightAt = 0
  private lastTs = 0
  private looks: number[] = []
  private idleTimer: ReturnType<typeof setInterval> | null = null
  private dead = false
  readonly status: FinderStatus = { state: 'off', error: '', clients: 0, rate: 0, ms: 0, people: 0, mode: 'video' }

  join(): FinderClient {
    const c = new FinderClient(this.nextId++)
    this.clients.add(c)
    return c
  }

  leave(c: FinderClient): void {
    this.clients.delete(c)
    if (this.inFlight === c) this.inFlight = null // its reply is dropped when it comes
  }

  /** Effects drawing now (asked within ACTIVE_MS). */
  private active(now: number): FinderClient[] {
    const out: FinderClient[] = []
    for (const c of this.clients) if (now - c.seen < ACTIVE_MS) out.push(c)
    return out
  }

  private ensureWorker(): void {
    if (this.worker || this.dead || this.status.state === 'failed') return
    try {
      const w = createBodyWorker()
      this.worker = w
      this.ready = false
      this.cfgPending = false
      this.cfgPeople = 0
      this.status.state = 'loading'
      this.status.error = ''
      w.onmessage = (e: MessageEvent): void => this.onMessage(w, e.data)
      w.onerror = (e: ErrorEvent): void => this.fail(e.message || 'the worker stopped')
      w.postMessage({ t: 'init', urls: { bundle: BUNDLE_URL, wasm: WASM_BASE, pose: POSE_MODEL, hand: '', face: '' } })
    } catch (e) {
      this.fail((e as Error).message)
    }
    if (!this.idleTimer) this.idleTimer = setInterval(() => this.checkIdle(), 2000)
  }

  private fail(msg: string): void {
    this.status.state = 'failed'
    this.status.error = msg
    this.inFlight = null
    console.warn('[silhouette fx]', msg)
  }

  /** Nobody drawing for a while : let the model go (it comes back on demand). */
  private checkIdle(): void {
    const now = performance.now()
    let last = 0
    for (const c of this.clients) last = Math.max(last, c.seen)
    if (this.worker && now - last > IDLE_WORKER_MS) this.stopWorker()
    if (!this.worker && this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }

  private stopWorker(): void {
    const w = this.worker
    this.worker = null
    this.ready = false
    this.cfgPending = false
    this.inFlight = null
    if (this.status.state !== 'failed') this.status.state = 'off'
    try {
      w?.postMessage({ t: 'stop' })
      w?.terminate()
    } catch {
      /* gone */
    }
  }

  /** The count and the mode the drawing effects need : rebuild the model when
   *  they change (never while a build is under way). */
  private reconfigure(now: number): void {
    const act = this.active(now)
    if (act.length > 1) this.sharedAt = now
    let people = 1
    for (const c of act) people = Math.max(people, c.people)
    const image = act.length > 1 || now - this.sharedAt < ALONE_MS
    if (!this.worker || !this.ready || this.cfgPending) return
    if (people === this.cfgPeople && image === this.cfgImage) return
    this.cfgPeople = people
    this.cfgImage = image
    this.cfgPending = true
    this.worker.postMessage({ t: 'config', cfg: { hands: false, pose: false, face: false, silhouette: true, people, image } })
  }

  private onMessage(
    w: Worker,
    m: { t: string; msg?: string; ms?: number; people?: number; error?: string; sil?: { mask?: Uint8Array; w?: number; h?: number; empty?: boolean; cov?: number } | null }
  ): void {
    if (w !== this.worker) return // a worker let go
    if (m.t === 'ready') {
      this.ready = true
      this.reconfigure(performance.now())
    } else if (m.t === 'configured') {
      this.cfgPending = false
      this.status.state = 'running'
      this.status.error = ''
      this.status.mode = this.cfgImage ? 'image' : 'video'
      this.reconfigure(performance.now()) // changed while it was being built
    } else if (m.t === 'error') {
      this.cfgPending = false
      this.fail(m.msg || 'the body model did not load')
    } else if (m.t === 'result') {
      const c = this.inFlight
      this.inFlight = null
      const now = performance.now()
      this.status.ms = Math.round(m.ms ?? 0)
      if (!c || !this.clients.has(c) || m.error) return // gone, or a hiccup on this frame only
      const s = m.sil
      const r: FinderResult =
        s && s.mask && s.w && s.h
          ? { mask: s.mask, w: s.w, h: s.h, people: m.people ?? 0, cov: s.cov ?? 0 }
          : { mask: null, w: 0, h: 0, people: 0, cov: 0 }
      c.result = r
      c.last = r
      // the last 2 s of looks (trimmed here : nothing may read them for hours)
      c.looks.push(now)
      while (now - c.looks[0] > 2000) c.looks.shift()
      this.looks.push(now)
      while (now - this.looks[0] > 2000) this.looks.shift()
      this.status.people = r.people
    }
  }

  /** Called by an effect each frame it draws : may it hand over a frame now?
   *  `due` : it would (its rate allows). The effect served longest ago among the
   *  due ones goes first; one frame in flight for the whole app. */
  mayPost(c: FinderClient, now: number, due: boolean): boolean {
    c.seen = now
    c.due = due
    this.ensureWorker()
    this.reconfigure(now)
    // a reply that never came (a lost frame) must not block it for good
    if (this.inFlight && now - this.inFlightAt > 2000) this.inFlight = null
    if (!due || !this.worker || !this.ready || this.cfgPending || this.inFlight || this.status.state !== 'running') return false
    for (const o of this.clients) {
      if (o !== c && o.due && now - o.seen < 250 && o.served < c.served) return false
    }
    return true
  }

  /** Is the model ready to take frames? (No readback before it is.) */
  get running(): boolean {
    return this.status.state === 'running' && !!this.worker
  }

  /** Hand over a frame (top row first, RGBA) : the slot is taken at once, the
   *  bitmap follows when it is made. */
  post(c: FinderClient, img: ImageData, now: number): void {
    const w = this.worker
    if (!w) return
    this.inFlight = c
    this.inFlightAt = now
    c.served = now
    // VIDEO mode wants its frame times strictly increasing
    const ts = Math.max(this.lastTs + 1, Math.round(now))
    this.lastTs = ts
    createImageBitmap(img)
      .then((bitmap) => {
        if (this.worker !== w || this.inFlight !== c) {
          bitmap.close()
          return
        }
        w.postMessage({ t: 'frame', bitmap, ts, camT: 0, newFrame: true, silhouette: true, mirror: false, full: true, people: c.people }, [bitmap])
      })
      .catch(() => {
        if (this.inFlight === c) this.inFlight = null
      })
  }

  /** The readout : refreshed on read. */
  read(): FinderStatus {
    const now = performance.now()
    while (this.looks.length && now - this.looks[0] > 2000) this.looks.shift()
    this.status.rate = this.looks.length / 2
    this.status.clients = this.active(now).length
    return this.status
  }

  /** Every effect's own numbers (test probes). */
  clientInfo(): Array<{ id: number; people: number; rate: number; found: number; cov: number; seen: number }> {
    const now = performance.now()
    return [...this.clients].map((c) => ({ id: c.id, people: c.people, rate: c.rate(now), found: c.last?.people ?? 0, cov: c.last?.cov ?? 0, seen: Math.round(now - c.seen) }))
  }

  shutdown(): void {
    this.dead = true
    this.stopWorker()
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.idleTimer = null
  }
}

export const silhouetteFinder = new SilhouetteFinder()
// A dev hot update re-runs this module as a new copy : the old one's worker
// would run on with nothing left to stop it.
if (import.meta.hot) {
  const g = globalThis as { __opsiaSilFinder?: SilhouetteFinder }
  g.__opsiaSilFinder?.shutdown()
  g.__opsiaSilFinder = silhouetteFinder
}
if (import.meta.env.VITE_OPSIA_TEST) (window as unknown as { __silfx: SilhouetteFinder }).__silfx = silhouetteFinder

// ── GL ──────────────────────────────────────────────────────────────────────

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

// What the model sees : the picture upright (the readback's first row is the
// picture's top), over black, a 2x2 box of bilinear taps per texel so a 1080p
// picture read at 512 does not alias.
const F_PACK = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex; uniform vec2 uStep;
vec3 tap(vec2 uv){ vec4 c = texture(uTex, uv); return c.rgb * clamp(c.a, 0.0, 1.0); }
void main(){
  vec2 uv = vec2(vUV.x, 1.0 - vUV.y);
  vec3 c = tap(uv - uStep) + tap(uv + uStep) + tap(uv + vec2(uStep.x, -uStep.y)) + tap(uv + vec2(-uStep.x, uStep.y));
  o = vec4(clamp(c * 0.25, 0.0, 1.0), 1.0);
}`

// The mask over time : the state follows the newest look (uK = this frame's
// share; 1 = no smoothing), from nothing when nobody is there (uHas 0).
const F_EMA = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uRaw, uPrev; uniform float uK, uHas;
void main(){
  float r = uHas > 0.5 ? texture(uRaw, vUV).r : 0.0;
  float p = texture(uPrev, vUV).r;
  o = vec4(mix(p, r, uK), 0.0, 0.0, 1.0);
}`

// SYNC : the input into the ring, as it is.
const F_COPY = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex;
void main(){ o = texture(uTex, vUV); }`

// The result over the input (OVER) and the dry / wet (MIX), premultiplied.
const GLSL_FINISH = `
uniform int uOver; uniform float uMix;
vec4 finish(vec4 wet, vec4 dry){
  vec4 w = vec4(wet.rgb * wet.a, wet.a), d = vec4(dry.rgb * dry.a, dry.a);
  if (uOver == 1) w += d * (1.0 - w.a);
  vec4 c = mix(d, w, uMix);
  return vec4(c.a > 1e-5 ? c.rgb / c.a : vec3(0.0), c.a);
}`

// The look : the mask (top row first, so read upside down) cut at the threshold
// over the input. With a trail it writes the trail state (F_OUT finishes it).
const F_LOOK = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uMask, uTrail;
uniform int uMode, uTrailOn;
uniform float uThresh, uSoft, uKeep, uFrame;
uniform vec4 uColor, uTrailColor;
${SIL_LOOK_GLSL}
${GLSL_FINISH}
void main(){
  vec4 pic = texture(uHost, vUV);
  float raw = texture(uMask, vec2(vUV.x, 1.0 - vUV.y)).r;
  float m = smoothstep(uThresh - uSoft, uThresh + uSoft, raw);
  vec4 now = silLook(uMode, pic, m, uColor);
  if (uTrailOn == 1) o = silTrail(uMode, now, m, texture(uTrail, vUV), uKeep, uTrailColor, gl_FragCoord.xy, uFrame);
  else o = finish(now, pic);
}`

const F_OUT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uState; uniform int uMode;
${SIL_LOOK_GLSL}
${GLSL_FINISH}
void main(){ o = finish(silOut(uMode, texture(uState, vUV)), texture(uHost, vUV)); }`

// ── FILL : another layer drawn where the people are (programs of their own, so
// the look without a fill keeps its exact pixels). The mask cut is the look's.
const GLSL_FILL = `
uniform sampler2D uMask;
uniform float uThresh, uSoft, uShade;
uniform vec2 uLight; // the figure's mean luminance, and the gain that spreads +-2 sd over 0..1
uniform vec4 uColor;
float silMask(){
  float raw = texture(uMask, vec2(vUV.x, 1.0 - vUV.y)).r;
  return smoothstep(uThresh - uSoft, uThresh + uSoft, raw);
}
// What is drawn where the people are (straight alpha) : the fill lit by the
// figure's own light (hard light, mid grey at the figure's mean = the fill as it
// is), tinted by the shadow color in SHADOW.
vec4 silBody(int mode, vec4 fill, vec4 pic, float m){
  float L = dot(clamp(pic.rgb, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
  float b = clamp(0.5 + (L - uLight.x) * uLight.y, 0.0, 1.0);
  vec3 f = clamp(fill.rgb, 0.0, 1.0);
  vec3 lit = b < 0.5 ? 2.0 * f * b : 1.0 - 2.0 * (1.0 - f) * (1.0 - b);
  vec3 c = mix(fill.rgb, lit, uShade);
  if (mode == 2) return vec4(c * uColor.rgb, fill.a * m * uColor.a);
  return vec4(c, fill.a * m);
}
// The body (or its trail) laid on what is around it : HOLE the picture with the
// people taken out, the others nothing.
vec4 silAround(int mode, vec4 body, vec4 pic, float m){
  if (mode != 3) return body;
  vec4 b = vec4(body.rgb * body.a, body.a);
  vec4 a = vec4(pic.rgb * pic.a * (1.0 - m), pic.a * (1.0 - m));
  vec4 c = b + a * (1.0 - b.a);
  return vec4(c.a > 1e-5 ? c.rgb / c.a : vec3(0.0), c.a);
}`

// The fill's look : with a trail it writes the body's trail state (silTrail as
// the cutout keeps it : each echo the color it had), F_OUT_FILL lays it down.
const F_LOOK_FILL = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uTrail, uFill;
uniform int uMode, uTrailOn;
uniform float uKeep, uFrame;
${SIL_LOOK_GLSL}
${GLSL_FINISH}
${GLSL_FILL}
void main(){
  vec4 pic = texture(uHost, vUV);
  float m = silMask();
  vec4 body = silBody(uMode, texture(uFill, vUV), pic, m);
  if (uTrailOn == 1) o = silTrail(0, body, m, texture(uTrail, vUV), uKeep, vec4(1.0), gl_FragCoord.xy, uFrame);
  else o = finish(silAround(uMode, body, pic, m), pic);
}`

const F_OUT_FILL = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uState; uniform int uMode;
${GLSL_FINISH}
${GLSL_FILL}
void main(){
  vec4 pic = texture(uHost, vUV);
  o = finish(silAround(uMode, texture(uState, vUV), pic, silMask()), pic);
}`

interface Prog {
  p: WebGLProgram
  u: Record<string, WebGLUniformLocation | null>
}

interface Target {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
}

/** A quick fingerprint of a read frame (every 97th byte) : the same picture
 *  again (a paused film) is not looked at twice. */
function fingerprint(g: Uint8Array): number {
  let h = 2166136261
  for (let i = 0; i < g.length; i += 97) h = Math.imul(h ^ g[i], 16777619)
  return h >>> 0
}

export class SilhouetteNode implements ConvNode {
  private disposed = false
  private gen = glGeneration()
  private vao: WebGLVertexArrayObject | null = null
  private quad: WebGLBuffer | null = null
  private pack: Prog | null = null
  private ema: Prog | null = null
  private look: Prog | null = null
  private out: Prog | null = null
  private zero: WebGLTexture | null = null // 1x1 : no mask yet
  private raw: WebGLTexture | null = null
  private rawW = 0
  private rawH = 0
  private rawHas = false // the last look found someone
  private state: [Target, Target] | null = null
  private stateW = 0
  private stateH = 0
  private stateCur = 0
  private fresh = true // the next look replaces the state outright (no fade from a stale one)
  private hasState = false
  private trail: SilTrail
  private read: GridReadback | null = null
  private client: FinderClient | null = null
  private nextPollAt = 0
  private lastHash = -1
  private sameLooks = 0
  private hasResult = false
  private lastFrame = -1
  private lastAt = 0
  private frameNo = 0
  // SYNC : copies of the input by frame (tick), and the measured delay of a look
  private copy: Prog | null = null
  private ring: Target[] = []
  private ringTick: number[] = []
  private ringW = 0
  private ringH = 0
  private ringNext = 0
  private tick = 0 // frames drawn live
  private postedTick = -1 // the frame the look in flight was read from
  private latency = 0 // frames from a frame read to its mask drawn (smoothed)
  // FILL : its two programs (made the first time a fill is drawn) and the
  // figure's light for SHADE : the luminance of the frame in flight (every 4th
  // pixel), measured inside its mask when that comes back.
  private lookFill: Prog | null = null
  private outFill: Prog | null = null
  private fillOn = false
  private postedLuma: Uint8Array | null = null
  private postedW = 0 // the posted frame's size
  private postedH = 0
  private lightMean = 0.5
  private lightGain = 2
  private lightSeen = false

  constructor(private gl: WebGL2RenderingContext) {
    this.trail = new SilTrail(gl)
  }

  private program(fs: string, names: string[]): Prog {
    const gl = this.gl
    const sh = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[silhouette fx] shader:', gl.getShaderInfoLog(s))
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(p, 0, 'p')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('[silhouette fx] link:', gl.getProgramInfoLog(p))
    const u: Record<string, WebGLUniformLocation | null> = {}
    for (const n of names) u[n] = gl.getUniformLocation(p, n)
    return { p, u }
  }

  private texture(filter: number): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  /** Our own triangle in our own VAO (the default VAO belongs to the ISF runtime);
   *  after a GPU reset every object is dead : start over. */
  private ensureGL(): void {
    const gl = this.gl
    if (this.gen !== glGeneration()) {
      this.vao = null; this.quad = null; this.pack = null; this.ema = null; this.look = null; this.out = null
      this.zero = null; this.raw = null; this.rawW = 0; this.rawH = 0; this.state = null; this.stateW = 0; this.stateH = 0
      this.read = null; this.hasState = false; this.fresh = true
      this.copy = null; this.ring = []; this.ringTick = []; this.ringW = 0; this.ringH = 0
      this.lookFill = null; this.outFill = null
      this.trail = new SilTrail(gl)
      this.gen = glGeneration()
    }
    if (this.vao) return
    gl.getExtension('EXT_color_buffer_float') // the R16F state (the chain is RGBA16F : it is there)
    this.vao = gl.createVertexArray()
    this.quad = gl.createBuffer()
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.look = this.program(F_LOOK, ['uHost', 'uMask', 'uTrail', 'uMode', 'uTrailOn', 'uThresh', 'uSoft', 'uKeep', 'uFrame', 'uColor', 'uTrailColor', 'uOver', 'uMix'])
    this.zero = this.texture(gl.NEAREST)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1))
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  /** The finding half (made on the first real frame : never for the warm-up). */
  private ensureFind(): void {
    if (this.pack) return
    this.pack = this.program(F_PACK, ['uTex', 'uStep'])
    this.ema = this.program(F_EMA, ['uRaw', 'uPrev', 'uK', 'uHas'])
    this.out = this.program(F_OUT, ['uHost', 'uState', 'uMode', 'uOver', 'uMix'])
    this.read = new GridReadback(this.gl, 3)
  }

  /** The fill's programs (the prewarm draws them once : it hands every node a sidechain). */
  private ensureFill(): void {
    if (this.lookFill) return
    const fillU = ['uMask', 'uThresh', 'uSoft', 'uShade', 'uLight', 'uColor', 'uOver', 'uMix']
    this.lookFill = this.program(F_LOOK_FILL, ['uHost', 'uTrail', 'uFill', 'uMode', 'uTrailOn', 'uKeep', 'uFrame', ...fillU])
    this.outFill = this.program(F_OUT_FILL, ['uHost', 'uState', 'uMode', ...fillU])
  }

  /** The figure's light inside the mask of the frame it was found in : its mean
   *  luminance and spread, followed over a few looks (SHADE centers the fill's
   *  light on the mean, so a dim film does not just darken the fill). */
  private measureLight(r: FinderResult): void {
    const lum = this.postedLuma
    if (!lum || !r.mask || !this.postedW) return
    const lw = Math.ceil(this.postedW / 4)
    const lh = Math.ceil(this.postedH / 4)
    const sx = r.w / this.postedW
    const sy = r.h / this.postedH
    let n = 0
    let s = 0
    let s2 = 0
    for (let y = 0; y < lh; y++) {
      const my = Math.min(r.h - 1, Math.floor((y * 4 + 2) * sy)) * r.w
      for (let x = 0; x < lw; x++) {
        if (r.mask[my + Math.min(r.w - 1, Math.floor((x * 4 + 2) * sx))] < 128) continue
        const l = lum[y * lw + x] / 255
        s += l
        s2 += l * l
        n++
      }
    }
    if (n < 24) return // too little of anyone to measure : keep the last
    const mean = s / n
    const sd = Math.sqrt(Math.max(0, s2 / n - mean * mean))
    const gain = 0.25 / Math.max(sd, 0.06)
    const k = this.lightSeen ? 0.3 : 1
    this.lightMean += (mean - this.lightMean) * k
    this.lightGain += (gain - this.lightGain) * k
    this.lightSeen = true
  }

  private ensureState(w: number, h: number): void {
    if (this.state && this.stateW === w && this.stateH === h) return
    const gl = this.gl
    this.disposeState()
    const mk = (): Target => {
      const tex = this.texture(gl.LINEAR)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, null)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      return { fbo, tex }
    }
    this.state = [mk(), mk()]
    this.stateW = w
    this.stateH = h
    this.stateCur = 0
    this.fresh = true
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private disposeState(): void {
    if (!this.state) return
    for (const t of this.state) {
      this.gl.deleteFramebuffer(t.fbo)
      this.gl.deleteTexture(t.tex)
    }
    this.state = null
    this.hasState = false
  }

  /** Hand the model the newest picture when it is this effect's turn, and keep a
   *  fresh readback queued for the next one. */
  private feed(ctx: NodeContext, now: number): void {
    const inp = ctx.inputs
    const finder = silhouetteFinder
    const c = this.client ?? (this.client = finder.join())
    c.people = Math.round(clamp(num(inp.people, 2), 1, 4))
    const L = FEED[Math.round(clamp(num(inp.detail, 1), 0, 2))]
    const cw = ctx.chain.w
    const ch = ctx.chain.h
    const fw = cw >= ch ? L : Math.max(16, Math.round((L * cw) / ch))
    const fh = cw >= ch ? Math.max(16, Math.round((L * ch) / cw)) : L
    const read = this.read!
    if (finder.mayPost(c, now, now >= this.nextPollAt)) {
      const g = read.takeLatest()
      if (g && g.w === fw && g.h === fh) {
        const h = fingerprint(g.grid)
        this.sameLooks = this.hasResult && h === this.lastHash ? this.sameLooks + 1 : 0
        if (this.sameLooks >= SAME_LOOKS) {
          // the same picture, looked at enough : look again a little later, the others go first
          this.nextPollAt = now + 150
          c.served = now
        } else {
          this.lastHash = h
          if (this.fillOn) {
            // SHADE's light : the luminance of this frame, every 4th pixel (~0.03 ms)
            const lw = Math.ceil(fw / 4)
            const lh = Math.ceil(fh / 4)
            if (!this.postedLuma || this.postedLuma.length !== lw * lh) this.postedLuma = new Uint8Array(lw * lh)
            const lum = this.postedLuma
            const px = g.grid
            for (let y = 0; y < lh; y++) {
              const row = (y * 4 + 2 < fh ? y * 4 + 2 : fh - 1) * fw
              for (let x = 0; x < lw; x++) {
                const i = (row + (x * 4 + 2 < fw ? x * 4 + 2 : fw - 1)) * 4
                lum[y * lw + x] = (54 * px[i] + 183 * px[i + 1] + 19 * px[i + 2]) >> 8
              }
            }
            this.postedW = fw
            this.postedH = fh
          } else this.postedW = 0
          finder.post(c, new ImageData(new Uint8ClampedArray(g.grid), fw, fh), now)
          this.postedTick = this.tick - 1
          // a frame early : at 60 fps the rate lands on every other frame
          this.nextPollAt = now + 1000 / MAX_RATE - 4
        }
      }
    }
    if (!finder.running) return // no readback before the model can take it
    // A full ring holds pictures older than the next turn : start it over fresh.
    if (read.full) read.dropInFlight()
    const gl = this.gl
    gl.useProgram(this.pack!.p)
    gl.uniform2f(this.pack!.u.uStep, 0.25 / fw, 0.25 / fh)
    read.kick(fw, fh, ctx.host, this.pack!.p, this.pack!.u.uTex, this.vao!, false)
  }

  /** The newest look → the raw mask texture. */
  private takeResult(): boolean {
    const r = this.client?.result
    if (!r) return false
    this.client!.result = null
    this.hasResult = true
    if (this.postedTick >= 0) {
      const lat = this.tick - this.postedTick
      this.latency = this.latency > 0 ? this.latency * 0.85 + lat * 0.15 : lat
    }
    if (!r.mask) {
      this.rawHas = false
      return true
    }
    if (this.fillOn) this.measureLight(r)
    const gl = this.gl
    if (!this.raw) this.raw = this.texture(gl.LINEAR)
    gl.bindTexture(gl.TEXTURE_2D, this.raw)
    // rows top-down, any width : no flip (the ISF runtime leaves it on), byte alignment
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    if (r.w !== this.rawW || r.h !== this.rawH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, r.w, r.h, 0, gl.RED, gl.UNSIGNED_BYTE, r.mask)
      this.rawW = r.w
      this.rawH = r.h
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, r.w, r.h, gl.RED, gl.UNSIGNED_BYTE, r.mask)
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.rawHas = true
    return true
  }

  /** The state follows the raw mask (its own size); SMOOTH = the time constant.
   *  `took` : a look came this frame. */
  private smooth(smooth: number, dt: number, took: boolean): void {
    if (!this.rawW) return // nobody seen yet : the zero mask
    this.ensureState(this.rawW, this.rawH)
    // after a gap the state holds until the first new look, then jumps to it
    if (this.fresh && this.hasState && !took) return
    const gl = this.gl
    const tau = 0.8 * smooth * smooth
    const k = this.fresh || !this.hasState || tau < 0.004 ? 1 : 1 - Math.exp(-dt / tau)
    const prev = this.state![1 - this.stateCur]
    const next = this.state![this.stateCur]
    const p = this.ema!
    gl.useProgram(p.p)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.rawHas && this.raw ? this.raw : this.zero); gl.uniform1i(p.u.uRaw, 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.tex); gl.uniform1i(p.u.uPrev, 1)
    gl.uniform1f(p.u.uK, k)
    gl.uniform1f(p.u.uHas, this.rawHas ? 1 : 0)
    gl.bindVertexArray(this.vao)
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo)
    gl.viewport(0, 0, this.stateW, this.stateH)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.stateCur = 1 - this.stateCur
    this.hasState = true
    this.fresh = false
  }

  /** SYNC : this frame's input into the ring, and the copy as many frames back as
   *  the mask is late (`back`); the input itself until the ring holds that far. */
  private held(ctx: NodeContext, back: number): WebGLTexture {
    const gl = this.gl
    const cw = ctx.chain.w
    const ch = ctx.chain.h
    if (this.ringW !== cw || this.ringH !== ch) this.disposeRing()
    this.ringW = cw
    this.ringH = ch
    const n = Math.min(SYNC_MAX, back + 1)
    // grow only (a delay that shrinks for a moment keeps its copies)
    while (this.ring.length < n) {
      const tex = this.texture(gl.LINEAR)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      this.ring.push({ fbo, tex })
      this.ringTick.push(-1)
    }
    if (!this.copy) this.copy = this.program(F_COPY, ['uTex'])
    const slot = this.ringNext % this.ring.length
    this.ringNext = slot + 1
    gl.useProgram(this.copy.p)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(this.copy.u.uTex, 0)
    gl.bindVertexArray(this.vao)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ring[slot].fbo)
    gl.viewport(0, 0, cw, ch)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.ringTick[slot] = this.tick
    const want = this.tick - Math.min(back, this.ring.length - 1)
    let best = -1
    for (let i = 0; i < this.ring.length; i++) {
      const t = this.ringTick[i]
      if (t >= want && t <= this.tick && (best < 0 || t < this.ringTick[best])) best = i
    }
    return best >= 0 ? this.ring[best].tex : ctx.host // the wanted frame, or the oldest kept after it
  }

  private disposeRing(): void {
    for (const t of this.ring) {
      this.gl.deleteFramebuffer(t.fbo)
      this.gl.deleteTexture(t.tex)
    }
    this.ring = []
    this.ringTick = []
    this.ringNext = 0
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = this.gl
    const cw = ctx.chain.w
    const ch = ctx.chain.h
    const inp = ctx.inputs
    const warm = cw < 16 || ch < 16 // the prewarm's 8x8 : draw the look once, find nobody
    // a gap in the frames (just inserted, re-enabled, PANIC) : what the ring
    // holds is from before, and the state must not fade in from a stale mask
    // On a muted layer nobody reads : nothing to show, nothing to find (and the
    // frames it skips count as a gap when it comes back).
    if (!warm && ctx.live === false) return ctx.host
    const gap = ctx.frame !== undefined && this.lastFrame >= 0 && ctx.frame !== this.lastFrame + 1
    if (ctx.frame !== undefined) this.lastFrame = ctx.frame
    this.ensureGL()
    const now = performance.now()
    const wallDt = this.lastAt > 0 ? clamp((now - this.lastAt) / 1000, 0, 0.1) : 1 / 60
    this.lastAt = now
    const mode = Math.round(clamp(num(inp.mode, 0), 0, 3))
    // the fill : another layer, drawn where the people are (the matte ignores it)
    const fill = mode !== 1 ? ctx.sidechain : null
    if (fill && !this.fillOn) this.lightSeen = false // measure this picture's light afresh
    this.fillOn = !!fill

    let pic = ctx.host
    if (!warm) {
      this.ensureFind()
      if (gap) {
        this.read!.dropInFlight()
        this.fresh = true
        this.postedTick = -1
      }
      this.tick++
      this.feed(ctx, now)
      const smooth = clamp(num(inp.smooth, 0.25), 0, 1)
      this.smooth(smooth, wallDt, this.takeResult())
      // SYNC : the picture held back by the look's delay, plus the smoothing's
      // (a first-order follow puts a moving edge ~0.7 tau late)
      if (num(inp.sync, 0) >= 0.5 && this.latency > 0) {
        const back = Math.round(this.latency + (0.7 * 0.8 * smooth * smooth) / Math.max(1 / 240, wallDt))
        pic = this.held(ctx, Math.max(0, Math.min(SYNC_MAX - 1, back)))
      } else if (this.ring.length) this.disposeRing()
    }

    // ── the look ──
    const trail = warm ? 0 : clamp(num(inp.trail, 0), 0, 1)
    const keep = trailKeep(trail, Math.abs(ctx.dt))
    if (keep > 0) this.trail.ensure(cw, ch)
    else this.trail.dispose()
    const color = Array.isArray(inp.color) ? (inp.color as number[]) : [0.95, 0.92, 0.85, 1]
    const trailColor = Array.isArray(inp.trailColor) ? (inp.trailColor as number[]) : [1, 1, 1, 1]
    const over = num(inp.over, 0) >= 0.5 ? 1 : 0
    const mix = clamp(num(inp.mix, 1), 0, 1)
    const mask = this.hasState && this.state ? this.state[1 - this.stateCur].tex : this.zero!
    if (fill) return this.renderFill(ctx, pic, mask, fill, mode, keep, color, over, mix, warm)
    const p = this.look!
    gl.useProgram(p.p)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pic); gl.uniform1i(p.u.uHost, 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mask); gl.uniform1i(p.u.uMask, 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.trail.read() ?? mask); gl.uniform1i(p.u.uTrail, 2)
    gl.uniform1i(p.u.uMode, mode)
    gl.uniform1i(p.u.uTrailOn, this.trail.on ? 1 : 0)
    gl.uniform1f(p.u.uThresh, clamp(num(inp.threshold, 0.5), 0.02, 0.98))
    gl.uniform1f(p.u.uSoft, Math.max(0.001, num(inp.softness, 0.08)))
    gl.uniform1f(p.u.uKeep, keep)
    gl.uniform1f(p.u.uFrame, this.frameNo++ % 4096)
    gl.uniform4f(p.u.uColor, color[0] ?? 1, color[1] ?? 1, color[2] ?? 1, color[3] ?? 1)
    gl.uniform4f(p.u.uTrailColor, trailColor[0] ?? 1, trailColor[1] ?? 1, trailColor[2] ?? 1, trailColor[3] ?? 1)
    gl.uniform1i(p.u.uOver, over)
    gl.uniform1f(p.u.uMix, mix)
    const dst = ctx.chain.next()
    const write = this.trail.write()
    gl.bindVertexArray(this.vao) // the readback ring unbinds it
    if (write) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo)
      gl.viewport(0, 0, cw, ch)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      const q = this.out!
      gl.useProgram(q.p)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pic); gl.uniform1i(q.u.uHost, 0)
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, write.tex); gl.uniform1i(q.u.uState, 1)
      gl.uniform1i(q.u.uMode, mode)
      gl.uniform1i(q.u.uOver, over)
      gl.uniform1f(q.u.uMix, mix)
      this.trail.swap()
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
    gl.viewport(0, 0, cw, ch)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    for (let i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null)
    return dst.tex
  }

  /** The look with a FILL : the other layer where the people are (cutout, hole,
   *  shadow), lit by the figure's own light (SHADE), with or without a trail. */
  private renderFill(
    ctx: NodeContext, pic: WebGLTexture, mask: WebGLTexture, fill: WebGLTexture, mode: number,
    keep: number, color: number[], over: number, mix: number, warm: boolean
  ): WebGLTexture {
    const gl = this.gl
    const cw = ctx.chain.w
    const ch = ctx.chain.h
    const inp = ctx.inputs
    this.ensureFill()
    const setCommon = (q: Prog): void => {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mask); gl.uniform1i(q.u.uMask, 1)
      gl.uniform1i(q.u.uMode, mode)
      gl.uniform1f(q.u.uThresh, clamp(num(inp.threshold, 0.5), 0.02, 0.98))
      gl.uniform1f(q.u.uSoft, Math.max(0.001, num(inp.softness, 0.08)))
      gl.uniform1f(q.u.uShade, clamp(num(inp.shade, 0.5), 0, 1))
      gl.uniform2f(q.u.uLight, this.lightMean, this.lightGain)
      gl.uniform4f(q.u.uColor, color[0] ?? 1, color[1] ?? 1, color[2] ?? 1, color[3] ?? 1)
      gl.uniform1i(q.u.uOver, over)
      gl.uniform1f(q.u.uMix, mix)
    }
    const p = this.lookFill!
    gl.useProgram(p.p)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pic); gl.uniform1i(p.u.uHost, 0)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.trail.read() ?? mask); gl.uniform1i(p.u.uTrail, 2)
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, fill); gl.uniform1i(p.u.uFill, 3)
    setCommon(p)
    gl.uniform1i(p.u.uTrailOn, this.trail.on ? 1 : 0)
    gl.uniform1f(p.u.uKeep, keep)
    gl.uniform1f(p.u.uFrame, this.frameNo++ % 4096)
    const dst = ctx.chain.next()
    const write = this.trail.write()
    gl.bindVertexArray(this.vao) // the readback ring unbinds it
    if (write) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo)
      gl.viewport(0, 0, cw, ch)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    if (write || warm) {
      // the trail state laid down (the warm-up draws this program once too)
      if (!write) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
        gl.viewport(0, 0, cw, ch)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      const q = this.outFill!
      gl.useProgram(q.p)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pic); gl.uniform1i(q.u.uHost, 0)
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, write ? write.tex : mask); gl.uniform1i(q.u.uState, 2)
      setCommon(q)
      if (write) this.trail.swap()
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
    gl.viewport(0, 0, cw, ch)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    for (let i = 0; i < 4; i++) {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null)
    return dst.tex
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.client) silhouetteFinder.leave(this.client)
    this.client = null
    const gl = this.gl
    if (this.gen !== glGeneration()) return // a GPU reset : the objects are gone already
    this.trail.dispose()
    this.disposeState()
    this.disposeRing()
    this.read?.dispose()
    for (const pr of [this.pack, this.ema, this.look, this.out, this.copy, this.lookFill, this.outFill]) if (pr) gl.deleteProgram(pr.p)
    for (const t of [this.zero, this.raw]) if (t) gl.deleteTexture(t)
    if (this.vao) {
      gl.bindVertexArray(this.vao)
      if (this.quad) gl.deleteBuffer(this.quad)
      gl.bindVertexArray(null)
      gl.deleteVertexArray(this.vao)
    }
    this.vao = null
  }
}
