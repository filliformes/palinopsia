// Field Store : a key-gated store that never fades.
//
// The trails and multi-images of the early digital video instruments were not
// feedback. There was ONE low-resolution store; live video was written into it
// only where a 1-bit key allowed, nothing ever decayed, and address counters
// moved the whole store around. A moving figure therefore leaves HARD stamps of
// itself, discrete with a strobed write, sliding in a lattice when the address
// moves, kept until someone wipes the store. Every trail elsewhere in Opsia
// fades softly; this is the hard, permanent one.
//
// Per frame, all at the store's own size (64 … 512 square, shown stretched over
// the frame : wide pixels on a 16:9 picture, the hardware's own, square ones on
// the dome, where the frame is square and stays framed as it came) :
//   GRAB  the input, four taps per cell (no real prefilter : it aliases, as the
//         converters did), each channel floored to 2^bits levels;
//   KEY   one bit per cell : brightness, edges, motion (against last frame's
//         grab), a sidechain layer's brightness, the layer's transparency, or none;
//   WRITE on the capture clock, the mode's rule writes the grab (or one flat
//         ink) into the store, at the address the slide has reached;
//   SHOW  the store over / under / instead of the live picture, by the key.
// The store is two RGBA8 textures (read one, write the other); alpha 1 is a
// written cell, 0 an empty one. Nothing in it ever fades.
//
// Flash safety : clear ▸ crumbles the store away cell by cell (about 0.4 s), a
// change of display or key crossfades (0.25 s), a store carried over from the
// last scene crumbles in under what this one already holds : no hard full-frame
// flip from here (the output's limiter still stands behind everything).
//
// Survive scene changes (`keep`) : a Field Store leaving with `keep` on parks its
// store here for two minutes; a Field Store arriving with `keep` on takes the
// one parked first in the last burst, in its first 30 seconds. PANIC empties the
// parking (dropKeptStores).

import { glGeneration } from './glGeneration'
import type { ConvNode, NodeContext } from './convNodes'

const num = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' ? v : d)
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const clampi = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(x)))

/** The store's side, per `size`. */
const SIZES = [64, 128, 256, 512]
/** Beats per capture, for the clock's tempo divisions : bar · 1/4 · 1/8 · 1/16. */
const BEATS = [4, 1, 0.5, 0.25]
/** What each mode shows by itself (`show` : by mode) : 0 over · 1 under ·
 *  2 instead · 3 double · 4 inside. Modes : trail, color trail, ghost,
 *  catch-up, mosaic, reveal, protect, acquire. */
const AUTO_SHOW = [1, 1, 3, 1, 0, 2, 4, 0]
/** What each mode writes : 0 the keyed cells · 1 the keyed cells in one ink ·
 *  2 every cell · 3 the cells OUTSIDE the key · 4 the keyed cells still empty. */
const RULE = [0, 1, 0, 2, 0, 0, 3, 4]
const CLEAR_MS = 400
const FADE_MS = 250
const FILL_MS = 400
const ADOPT_MS = 30_000
const PARK_MS = 120_000
const PARK_MAX = 4
/** The slide's dead zone around 0. */
const DEAD = 0.06

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const HEAD = `#version 300 es
precision highp float; precision highp int;
in vec2 vUV; out vec4 o;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec4 pm(vec4 c){ return vec4(c.rgb * c.a, c.a); }
vec4 unpm(vec4 c){ return vec4(c.a > 1e-5 ? c.rgb / c.a : vec3(0.0), c.a); }
float hash12(vec2 q){ vec3 p3 = fract(vec3(q.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`

// GRAB : the input at the store's size. Four taps inside the cell, averaged
// premultiplied (a transparent tap carries no color); each channel floored to
// its levels, spread over the whole range (black and white stay black and white,
// a near-neutral gradient breaks into colored bands).
const F_GRAB = HEAD + `
uniform sampler2D uHost;
uniform vec2 uCell;
uniform float uLevels;
void main(){
  vec2 q = uCell * 0.25;
  vec4 s = (pm(texture(uHost, vUV + vec2(-q.x, -q.y))) + pm(texture(uHost, vUV + vec2(q.x, -q.y)))
          + pm(texture(uHost, vUV + vec2(-q.x, q.y))) + pm(texture(uHost, vUV + vec2(q.x, q.y)))) * 0.25;
  vec4 c = unpm(s);
  vec3 rgb = clamp(c.rgb, 0.0, 1.0);
  rgb = min(floor(rgb * uLevels), uLevels - 1.0) / (uLevels - 1.0);
  o = vec4(rgb, clamp(c.a, 0.0, 1.0));
}`

// KEY : one bit per cell (r), the level it was cut from (g).
// uKey : 0 brightness · 1 edges · 2 motion · 3 sidechain · 4 transparency · 5 none.
const F_KEY = HEAD + `
uniform sampler2D uCur, uPrev, uSide;
uniform int uKey, uInvert, uHasSide;
uniform float uThr;
uniform vec2 uCell;
float lumAt(ivec2 t, ivec2 hi){ vec4 c = texelFetch(uCur, clamp(t, ivec2(0), hi), 0); return luma(c.rgb) * c.a; }
void main(){
  ivec2 t = ivec2(gl_FragCoord.xy);
  ivec2 hi = textureSize(uCur, 0) - 1;
  vec4 c = texelFetch(uCur, t, 0);
  float v = 1.0;
  if (uKey == 0) v = luma(c.rgb) * c.a;
  else if (uKey == 1) {
    float gx = lumAt(t + ivec2(1, 0), hi) - lumAt(t - ivec2(1, 0), hi);
    float gy = lumAt(t + ivec2(0, 1), hi) - lumAt(t - ivec2(0, 1), hi);
    v = clamp((abs(gx) + abs(gy)) * 2.0, 0.0, 1.0);
  } else if (uKey == 2) {
    vec3 d = abs(pm(c).rgb - pm(texelFetch(uPrev, t, 0)).rgb);
    v = clamp(max(d.r, max(d.g, d.b)) * 3.0, 0.0, 1.0);
  } else if (uKey == 3) {
    if (uHasSide == 1) {
      vec2 q = uCell * 0.25;
      vec4 s = (pm(texture(uSide, vUV + vec2(-q.x, -q.y))) + pm(texture(uSide, vUV + vec2(q.x, -q.y)))
              + pm(texture(uSide, vUV + vec2(-q.x, q.y))) + pm(texture(uSide, vUV + vec2(q.x, q.y)))) * 0.25;
      v = luma(clamp(s.rgb, 0.0, 1.0)); // premultiplied : a transparent sidechain keys nothing
    } else v = luma(c.rgb) * c.a;
  } else if (uKey == 4) v = c.a;
  float k = uKey == 5 ? 1.0 : step(uThr, v);
  if (uInvert == 1 && uKey != 5) k = 1.0 - k;
  o = vec4(k, v, 0.0, 1.0);
}`

// WRITE : one store cell per fragment. The cell's screen place is its address
// minus the slide (wrapping : the store is a torus). The clear's band of cells
// empties first, then the mode's rule writes the grab over it.
// uRule : see RULE.
const F_WRITE = HEAD + `
uniform sampler2D uStore, uCur, uKeyT;
uniform ivec2 uPan;
uniform int uRule, uGrab;
uniform vec3 uInk;
uniform float uEraseLo, uEraseHi, uSeed;
void main(){
  ivec2 a = ivec2(gl_FragCoord.xy);
  int n = textureSize(uStore, 0).x;
  vec4 old = texelFetch(uStore, a, 0);
  float h = hash12(vec2(a) + vec2(uSeed, uSeed * 0.61));
  if (h >= uEraseLo && h < uEraseHi) old = vec4(0.0);
  vec4 res = old;
  if (uGrab == 1) {
    ivec2 cell = (a - uPan + n) % n;
    float k = texelFetch(uKeyT, cell, 0).r;
    vec4 c = texelFetch(uCur, cell, 0);
    float on = step(0.5, c.a);
    vec4 fresh = uRule == 1 ? vec4(uInk * on, on) : vec4(c.rgb * on, on);
    bool w = k > 0.5;
    if (uRule == 2) w = true;
    else if (uRule == 3) w = k < 0.5;
    else if (uRule == 4) w = k > 0.5 && old.a < 0.5;
    if (w) res = fresh;
  }
  o = res;
}`

// MERGE : another store drawn under this one's empty cells, screen place to
// screen place (each store has its own size and slide). A band of cells per
// frame (uLo..uHi of a per-cell random number) lets it crumble in; 0..2 is all
// at once. uHasOwn 0 : a plain copy (a size change).
const F_MERGE = HEAD + `
uniform sampler2D uOwn, uOld;
uniform ivec2 uPanOwn, uPanOld;
uniform int uN, uHasOwn;
uniform float uLo, uHi, uSeed;
void main(){
  ivec2 a = ivec2(gl_FragCoord.xy);
  int m = textureSize(uOld, 0).x;
  vec4 own = uHasOwn == 1 ? texelFetch(uOwn, a, 0) : vec4(0.0);
  float h = hash12(vec2(a) + vec2(uSeed, uSeed * 0.61));
  vec4 res = own;
  if (own.a < 0.5 && h >= uLo && h < uHi) {
    ivec2 cell = (a - uPanOwn + uN) % uN;
    ivec2 pc = clamp(ivec2((vec2(cell) + 0.5) * float(m) / float(uN)), ivec2(0), ivec2(m - 1));
    res = texelFetch(uOld, (pc + uPanOld) % m, 0);
  }
  o = res;
}`

// SHOW : full size. Each screen pixel reads its store cell (nearest : the blocks
// show) at the slid address, and the key of its cell.
// m : 0 over (the store wherever written) · 1 under (the keyed live in front of
// the store) · 2 instead (the store alone, empty = transparent) · 3 double (the
// store at half over the live) · 4 inside (the store only inside the key).
// A change of display or key fades from B (the old) to A over uFade.
const F_SHOW = HEAD + `
uniform sampler2D uHost, uStore, uKeyA, uKeyB;
uniform ivec2 uPan;
uniform int uShowA, uShowB;
uniform float uFade, uMix;
vec4 mixPm(vec4 a, vec4 b, float t){ return unpm(mix(pm(a), pm(b), t)); }
vec4 view(int m, vec4 live, vec4 st, float k){
  bool has = st.a > 0.5;
  vec4 held = has ? st : live;
  if (m == 0) return held;
  if (m == 1) return k > 0.5 ? live : held;
  if (m == 2) return has ? st : vec4(0.0);
  if (m == 3) return has ? mixPm(live, st, 0.5) : live;
  return k > 0.5 ? held : live;
}
void main(){
  int n = textureSize(uStore, 0).x;
  ivec2 cell = clamp(ivec2(vUV * float(n)), ivec2(0), ivec2(n - 1));
  vec4 live = texture(uHost, vUV);
  vec4 st = texelFetch(uStore, (cell + uPan) % n, 0);
  vec4 r = view(uShowA, live, st, texelFetch(uKeyA, cell, 0).r);
  if (uFade < 1.0) r = mixPm(view(uShowB, live, st, texelFetch(uKeyB, cell, 0).r), r, uFade);
  o = mixPm(live, r, uMix);
}`

// ── Shared GL : one VAO + the five programs per context ──────────────────
interface Prog {
  p: WebGLProgram
  u(name: string): WebGLUniformLocation | null
}
interface Shared {
  gen: number
  vao: WebGLVertexArrayObject
  quad: WebGLBuffer
  vs: WebGLShader | null
  progs: Map<string, Prog>
}
const SHARED = new WeakMap<WebGL2RenderingContext, Shared>()

/** Our own triangle in our own VAO : the default VAO belongs to the ISF runtime
 *  (its quad sits in attribute 0). Never deleted, so never a buffer pulled from
 *  under a bound VAO; a GPU reset (the generation moved) builds a fresh set. */
function sharedGL(gl: WebGL2RenderingContext): Shared {
  let s = SHARED.get(gl)
  if (s && s.gen === glGeneration()) return s
  const vao = gl.createVertexArray()!
  const quad = gl.createBuffer()!
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  s = { gen: glGeneration(), vao, quad, vs: null, progs: new Map() }
  SHARED.set(gl, s)
  return s
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error('[fieldStore] shader:', gl.getShaderInfoLog(sh))
  return sh
}

/** A program, compiled on first use and kept for the context's life. */
function prog(gl: WebGL2RenderingContext, s: Shared, fs: string): Prog {
  let pr = s.progs.get(fs)
  if (pr) return pr
  if (!s.vs) s.vs = compile(gl, gl.VERTEX_SHADER, VS)
  const p = gl.createProgram()!
  gl.attachShader(p, s.vs)
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.bindAttribLocation(p, 0, 'p')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('[fieldStore] link:', gl.getProgramInfoLog(p))
  const cache = new Map<string, WebGLUniformLocation | null>()
  pr = {
    p,
    u: (name) => {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name))
      return cache.get(name)!
    }
  }
  s.progs.set(fs, pr)
  return pr
}

/** Bind a program and our VAO, attribute 0 re-pointed at our triangle (anything
 *  that wired its own buffer into the VAO while it was bound is undone).
 *  FxRack.apply unbinds the VAO after the node renders. */
function use(gl: WebGL2RenderingContext, s: Shared, fs: string): Prog {
  const pr = prog(gl, s, fs)
  gl.useProgram(pr.p)
  gl.bindVertexArray(s.vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, s.quad)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  return pr
}

function bindTex(gl: WebGL2RenderingContext, unit: number, tex: WebGLTexture): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, tex)
}

function drawTo(gl: WebGL2RenderingContext, fbo: WebGLFramebuffer, w: number, h: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.viewport(0, 0, w, h)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

// ── Textures : RGBA8, nearest (the blocks are the point) ─────────────────
interface Tex {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
}
function makeTex(gl: WebGL2RenderingContext, n: number): Tex {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, n, n)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { tex, fbo }
}
function freeTex(gl: WebGL2RenderingContext, t: Tex): void {
  gl.deleteTexture(t.tex)
  gl.deleteFramebuffer(t.fbo)
}

/** One store : its two buffers (read one, write the other), its slide (in
 *  cells, 0..n) and how many grabs it has taken (the ink steps on it). */
interface Store {
  gl: WebGL2RenderingContext
  gen: number
  n: number
  buf: [Tex, Tex]
  cur: number
  panX: number
  panY: number
  count: number
}
function makeStore(gl: WebGL2RenderingContext, n: number): Store {
  return { gl, gen: glGeneration(), n, buf: [makeTex(gl, n), makeTex(gl, n)], cur: 0, panX: 0, panY: 0, count: 0 }
}
/** Free a store's textures (a dead context's are already gone). */
function freeStore(s: Store): void {
  if (s.gen !== glGeneration() || s.gl.isContextLost()) return
  freeTex(s.gl, s.buf[0])
  freeTex(s.gl, s.buf[1])
}
const panInt = (s: Store): [number, number] => [
  Math.min(s.n - 1, Math.max(0, Math.floor(s.panX))),
  Math.min(s.n - 1, Math.max(0, Math.floor(s.panY)))
]
const wrap = (x: number, n: number): number => (Number.isFinite(x) ? ((x % n) + n) % n : 0)

// ── The parking : stores waiting to survive a scene change ───────────────
interface Parked {
  store: Store
  at: number
  timer: ReturnType<typeof setTimeout>
}
const parked: Parked[] = []

function park(store: Store): void {
  const entry: Parked = {
    store,
    at: performance.now(),
    timer: setTimeout(() => unpark(entry, true), PARK_MS)
  }
  parked.push(entry)
  // a handful at most : the oldest go first
  while (parked.length > PARK_MAX) unpark(parked[0], true)
}

function unpark(entry: Parked, free: boolean): void {
  const i = parked.indexOf(entry)
  if (i < 0) return
  parked.splice(i, 1)
  clearTimeout(entry.timer)
  if (free) freeStore(entry.store)
}

/** The store to take over : from the last burst of stores left (a scene change
 *  leaves them within moments of each other), the first one left, so racks that
 *  leave and arrive in the same order find their own again. */
function takeParked(gl: WebGL2RenderingContext): Store | null {
  const ok = parked.filter((e) => e.store.gl === gl && e.store.gen === glGeneration())
  if (!ok.length) return null
  const last = Math.max(...ok.map((e) => e.at))
  const burst = ok.filter((e) => e.at >= last - 2000).sort((a, b) => a.at - b.at)
  const e = burst[0]
  unpark(e, false)
  return e.store
}

/** PANIC : every parked store is let go, so a Field Store rebuilt by the flush
 *  starts empty even with `keep` on. */
export function dropKeptStores(): void {
  while (parked.length) unpark(parked[0], true)
}

/** The slide : a velocity with a dead zone around 0 and a steep curve, in stores
 *  per 60 Hz frame (half the store per frame at the ends : the wagon-wheel strobe
 *  of a fast slide is the character). */
function slideRate(x: number): number {
  const a = Math.abs(x)
  if (a <= DEAD) return 0
  const t = Math.min(1, (a - DEAD) / (1 - DEAD))
  return Math.sign(x) * t * t * t * t * 0.5
}

/** HSV (0..1) to RGB, each channel floored to `levels`. */
function ink(h: number, sat: number, val: number, levels: number): [number, number, number] {
  const f = (k0: number): number => {
    const k = (k0 + h * 6) % 6
    const c = val - val * sat * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.min(Math.floor(c * levels), levels - 1) / (levels - 1)
  }
  return [f(5), f(3), f(1)]
}

export class FieldStoreNode implements ConvNode {
  private disposed = false
  private gen = glGeneration()
  private store: Store | null = null
  private grabs: [Tex, Tex] | null = null // this frame's grab and the last (the motion key)
  private keys: [Tex, Tex] | null = null // the key now, and the key frozen at the last change (the fade)
  private n = 0
  private sizeAt = 0
  private gi = 0
  private ki = 0
  private lastFrame = -1
  private reseed = true
  private bornAt = 0
  private adopted = false
  private wrote = false
  private keep = false
  // a store carried over while this one already holds something : crumbles in
  private incoming: Store | null = null
  private fillAt = 0
  private fillDone = 0
  private fillSeed = 0
  // the clock
  private acc = 0
  private timer = 0
  private prevGrab = 0
  private prevClear = 0
  // clear ▸ : the crumble
  private erasing = false
  private eraseAt = 0
  private eraseDone = 0
  private eraseSeed = 0
  // the look (display + key) : a change fades
  private look = ''
  private showNow = 0
  private showPrev = -1
  private fadeAt = 0

  constructor(private gl: WebGL2RenderingContext) {}

  /** The store and its scratch at side `n`. A new size keeps the picture
   *  (resampled, nearest, its slide scaled with it). */
  private ensure(s: Shared, n: number): void {
    const gl = this.gl
    if (this.store && this.n === n) return
    if (this.grabs) for (const t of this.grabs) freeTex(gl, t)
    if (this.keys) for (const t of this.keys) freeTex(gl, t)
    this.grabs = [makeTex(gl, n), makeTex(gl, n)]
    this.keys = [makeTex(gl, n), makeTex(gl, n)]
    this.reseed = true
    const old = this.store
    const fresh = makeStore(gl, n)
    if (old) {
      const r = n / old.n
      fresh.panX = wrap(old.panX * r, n)
      fresh.panY = wrap(old.panY * r, n)
      fresh.count = old.count
      this.merge(s, fresh, old, false, 0, 2, 0)
      freeStore(old)
    }
    this.store = fresh
    this.n = n
  }

  /** Draw `from` under `into`'s empty cells (the cells whose random number is in
   *  lo..hi), screen place to screen place. `hasOwn` false : a plain copy. */
  private merge(s: Shared, into: Store, from: Store, hasOwn: boolean, lo: number, hi: number, seed: number): void {
    const gl = this.gl
    const p = use(gl, s, F_MERGE)
    const [ox, oy] = panInt(into)
    const [fx, fy] = panInt(from)
    bindTex(gl, 0, hasOwn ? into.buf[into.cur].tex : from.buf[from.cur].tex)
    gl.uniform1i(p.u('uOwn'), 0)
    bindTex(gl, 1, from.buf[from.cur].tex)
    gl.uniform1i(p.u('uOld'), 1)
    gl.uniform2i(p.u('uPanOwn'), ox, oy)
    gl.uniform2i(p.u('uPanOld'), fx, fy)
    gl.uniform1i(p.u('uN'), into.n)
    gl.uniform1i(p.u('uHasOwn'), hasOwn ? 1 : 0)
    gl.uniform1f(p.u('uLo'), lo)
    gl.uniform1f(p.u('uHi'), hi)
    gl.uniform1f(p.u('uSeed'), seed)
    drawTo(gl, into.buf[1 - into.cur].fbo, into.n, into.n)
    into.cur = 1 - into.cur
  }

  /** A store left by the scene before. Nothing written here yet : it is taken
   *  over at once, slide and all (the same picture as a frame ago, no change on
   *  screen). Else it crumbles in under what this one already holds. */
  private adopt(s: Shared, from: Store, now: number): void {
    const store = this.store!
    this.adopted = true
    if (!this.wrote) {
      const r = store.n / from.n
      store.panX = wrap(from.panX * r, store.n)
      store.panY = wrap(from.panY * r, store.n)
      store.count = from.count
      this.merge(s, store, from, true, 0, 2, 0)
      freeStore(from)
      this.wrote = true
      return
    }
    this.incoming = from
    this.fillAt = now
    this.fillDone = 0
    this.fillSeed = Math.floor(Math.random() * 997)
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = this.gl
    if (gl.isContextLost()) return ctx.host
    if (this.gen !== glGeneration()) {
      // a GPU reset : every object of ours is dead (the store with them), start over
      this.store = null
      this.grabs = null
      this.keys = null
      this.incoming = null
      this.n = 0
      this.lastFrame = -1
      this.gen = glGeneration()
    }
    const s = sharedGL(gl)
    const inp = ctx.inputs
    const now = performance.now()
    if (!this.bornAt) this.bornAt = now

    // a new size at most every quarter second : a modulated size can't rebuild
    // the store every frame
    let n = SIZES[clampi(num(inp.size, 2), 0, 3)]
    if (this.store && n !== this.n) {
      if (now - this.sizeAt < 250) n = this.n
      else this.sizeAt = now
    }
    const levels = 2 ** clampi(num(inp.bits, 4), 1, 8)
    const mode = clampi(num(inp.mode, 0), 0, 7)
    const showIn = clampi(num(inp.show, 0), 0, 5)
    const key = clampi(num(inp.key, 0), 0, 5)
    const thr = clamp01(num(inp.threshold, 0.5))
    const invert = num(inp.invert, 0) >= 0.5
    const clock = clampi(num(inp.clock, 1), 0, 7)
    const every = Math.max(1, Math.round(num(inp.every, 5)))
    const mix = clamp01(num(inp.mix, 1))
    this.keep = num(inp.keep, 0) >= 0.5

    this.ensure(s, n)
    const store = this.store!
    const grabs = this.grabs!
    const keys = this.keys!

    // survive : a store the last scene left, taken over in the first seconds
    if (this.keep && !this.adopted && now - this.bornAt < ADOPT_MS) {
      const from = takeParked(gl)
      if (from) this.adopt(s, from, now)
    }

    // ── events ──
    const g = num(inp.grab, 0)
    const fired = g >= 0.5 && this.prevGrab < 0.5
    this.prevGrab = g
    const c = num(inp.clear, 0)
    if (c >= 0.5 && this.prevClear < 0.5) {
      // a fresh crumble (one under way starts over : its done cells stay empty)
      this.erasing = true
      this.eraseAt = now
      this.eraseDone = 0
      this.eraseSeed = Math.floor(Math.random() * 997)
    }
    this.prevClear = c

    // ── the capture clock (in 60 Hz frames of this rack's clock : layer speed
    //    scales it, a frozen layer takes nothing) ──
    const f60 = Math.max(0, Math.min(8, ctx.dt * 60))
    const moving = ctx.dt > 0
    let grab = fired
    if (fired) {
      // a grab by hand restarts the clock from here
      this.acc = 0
      this.timer = 0
    } else if (clock === 0) grab = moving
    else if (clock === 1) {
      this.acc += f60
      if (this.acc >= every) {
        grab = true
        this.acc = this.acc >= 2 * every ? 0 : this.acc - every
      }
    } else if (clock === 2) {
      // bursts : N frames written, then twice as long held
      if (moving && this.acc < every) grab = true
      this.acc = (this.acc + f60) % (every * 3)
    } else if (clock <= 6) {
      const bpm = Math.max(20, Math.min(300, ctx.bpm && ctx.bpm > 0 ? ctx.bpm : 120))
      const iv = (60 / bpm) * BEATS[clock - 3]
      this.timer += ctx.dt
      if (this.timer >= iv) {
        grab = true
        this.timer = this.timer >= 2 * iv ? 0 : this.timer - iv
      }
    }

    // ── the look : a new display or key fades in, the old key held for it ──
    const show = showIn > 0 ? showIn - 1 : AUTO_SHOW[mode]
    const look = `${show}|${key}|${invert ? 1 : 0}`
    const lookChanged = look !== this.look
    if (lookChanged) {
      if (this.look) {
        this.showPrev = this.showNow
        this.fadeAt = now
        this.ki = 1 - this.ki
      }
      this.look = look
      this.showNow = show
    }

    // ── grab + key, at the store's size ──
    const gap = ctx.frame === undefined ? this.lastFrame < 0 : this.lastFrame < 0 || ctx.frame !== this.lastFrame + 1
    this.lastFrame = ctx.frame ?? 0
    const reseed = gap || this.reseed
    this.reseed = false
    if (moving || reseed) {
      const pg = use(gl, s, F_GRAB)
      bindTex(gl, 0, ctx.host)
      gl.uniform1i(pg.u('uHost'), 0)
      gl.uniform2f(pg.u('uCell'), 1 / n, 1 / n)
      gl.uniform1f(pg.u('uLevels'), levels)
      this.gi = 1 - this.gi
      drawTo(gl, grabs[this.gi].fbo, n, n)
      // just (re)started : last frame's grab is this one (no motion out of nothing)
      if (reseed) drawTo(gl, grabs[1 - this.gi].fbo, n, n)
    }
    // the key : every running frame, and on a change of key while frozen (from
    // the grab already there)
    if (moving || reseed || lookChanged) {
      const pk = use(gl, s, F_KEY)
      bindTex(gl, 0, grabs[this.gi].tex)
      gl.uniform1i(pk.u('uCur'), 0)
      bindTex(gl, 1, grabs[1 - this.gi].tex)
      gl.uniform1i(pk.u('uPrev'), 1)
      bindTex(gl, 2, ctx.sidechain ?? ctx.host)
      gl.uniform1i(pk.u('uSide'), 2)
      gl.uniform1i(pk.u('uHasSide'), ctx.sidechain ? 1 : 0)
      gl.uniform1i(pk.u('uKey'), key)
      gl.uniform1i(pk.u('uInvert'), invert ? 1 : 0)
      gl.uniform1f(pk.u('uThr'), thr)
      gl.uniform2f(pk.u('uCell'), 1 / n, 1 / n)
      drawTo(gl, keys[this.ki].fbo, n, n)
    }

    // ── the slide : the address moves, the store never does ──
    if (moving) {
      store.panX = wrap(store.panX - slideRate(num(inp.slideX, 0)) * n * f60, n)
      store.panY = wrap(store.panY - slideRate(num(inp.slideY, 0)) * n * f60, n)
    }

    // ── a carried-over store crumbling in under this one ──
    if (this.incoming) {
      const pr = Math.min(1, (now - this.fillAt) / FILL_MS)
      this.merge(s, store, this.incoming, true, this.fillDone, pr >= 1 ? 2 : pr, this.fillSeed)
      this.fillDone = pr
      if (pr >= 1) {
        freeStore(this.incoming)
        this.incoming = null
      }
    }

    // ── write (and the clear's crumble) ──
    let eLo = 0
    let eHi = 0
    if (this.erasing) {
      const pr = Math.min(1, (now - this.eraseAt) / CLEAR_MS)
      eLo = this.eraseDone
      eHi = pr >= 1 ? 2 : pr
      this.eraseDone = pr
      if (pr >= 1) this.erasing = false
    }
    if (grab || eHi > eLo) {
      const pw = use(gl, s, F_WRITE)
      const [wx, wy] = panInt(store)
      bindTex(gl, 0, store.buf[store.cur].tex)
      gl.uniform1i(pw.u('uStore'), 0)
      bindTex(gl, 1, grabs[this.gi].tex)
      gl.uniform1i(pw.u('uCur'), 1)
      bindTex(gl, 2, keys[this.ki].tex)
      gl.uniform1i(pw.u('uKeyT'), 2)
      gl.uniform2i(pw.u('uPan'), wx, wy)
      gl.uniform1i(pw.u('uRule'), RULE[mode])
      gl.uniform1i(pw.u('uGrab'), grab ? 1 : 0)
      // color trail : one flat ink per grab, its hue stepping from grab to grab
      const hue = num(inp.hue, 0.08) + num(inp.drift, 0.05) * store.count
      const [ir, ig, ib] = ink(wrap(hue, 1), 0.6, 0.9, levels)
      gl.uniform3f(pw.u('uInk'), ir, ig, ib)
      gl.uniform1f(pw.u('uEraseLo'), eLo)
      gl.uniform1f(pw.u('uEraseHi'), eHi)
      gl.uniform1f(pw.u('uSeed'), this.eraseSeed)
      drawTo(gl, store.buf[1 - store.cur].fbo, n, n)
      store.cur = 1 - store.cur
      if (grab) {
        store.count++
        this.wrote = true
      }
    }

    if (mix <= 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.activeTexture(gl.TEXTURE0)
      return ctx.host // the store keeps running underneath
    }

    // ── show ──
    const fade = this.showPrev < 0 ? 1 : Math.min(1, (now - this.fadeAt) / FADE_MS)
    if (fade >= 1) this.showPrev = -1
    const out = ctx.chain.next()
    const p = use(gl, s, F_SHOW)
    const [px, py] = panInt(store)
    bindTex(gl, 0, ctx.host)
    gl.uniform1i(p.u('uHost'), 0)
    bindTex(gl, 1, store.buf[store.cur].tex)
    gl.uniform1i(p.u('uStore'), 1)
    bindTex(gl, 2, keys[this.ki].tex)
    gl.uniform1i(p.u('uKeyA'), 2)
    bindTex(gl, 3, keys[1 - this.ki].tex)
    gl.uniform1i(p.u('uKeyB'), 3)
    gl.uniform2i(p.u('uPan'), px, py)
    gl.uniform1i(p.u('uShowA'), this.showNow)
    gl.uniform1i(p.u('uShowB'), this.showPrev < 0 ? this.showNow : this.showPrev)
    gl.uniform1f(p.u('uFade'), fade)
    gl.uniform1f(p.u('uMix'), mix)
    drawTo(gl, out.fbo, ctx.chain.w, ctx.chain.h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.activeTexture(gl.TEXTURE0)
    return out.tex
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    const live = this.gen === glGeneration() && !gl.isContextLost()
    if (this.incoming) freeStore(this.incoming)
    this.incoming = null
    if (this.store) {
      // keep : parked for the next scene's Field Store (only a store with something in it)
      if (live && this.keep && this.wrote) park(this.store)
      else freeStore(this.store)
    }
    this.store = null
    if (live) {
      if (this.grabs) for (const t of this.grabs) freeTex(gl, t)
      if (this.keys) for (const t of this.keys) freeTex(gl, t)
    }
    this.grabs = null
    this.keys = null
  }
}
