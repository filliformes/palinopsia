// Touch (the native node 'node-touch') : makes any picture touchable. The hand on
// the preview (the mouse, every pinching hand), the Room's people, an OSC finger or
// the effect's own point push the picture : RINGS (a shockwave bursting from the
// touch and traveling out), SPREAD (pushed away from the hand), SWIRL (twisted
// round it), DRAG (carried along with it), LENS (a lens under it), ATTRACT (pulled
// in). A FIRE trigger (a pad, a modulator, the sound's hits) does the mode's touch
// once at the center, the point or a random place : a kick fires a shockwave.
//
// The pushes live in a displacement field at half the picture's height (at most 720
// rows : the cost holds at 4K and on the dome), relaxed every frame by a damped
// spring (FADE how fast it comes back, SPRING whether it creeps or wobbles), softened
// by its neighbors; the drag carries the field along under the hand, so what is under
// it really travels with it. The rings and the lenses are drawn over the field each
// frame from a few numbers each (no state), then one pass warps the picture through
// it, a matte shade showing where the push bunches it up or stretches it.
//
// On the dome (full-dome fill) the field lives on the dome's disc (touchInput.ts :
// the zenith in the middle), so a ring is round on the dome all the way to the rim and
// a swirl turns round the touch as you see it.

import type { ConvNode, NodeContext } from './convNodes'
import type { SourcePointer } from './nativeGenerators'
import { glGeneration } from './glGeneration'
import { domeFill } from './domeSignal'
import { TouchPoints, Onset, touchBus, toField, firePlace, wanderAt, type TouchPoint } from './touchInput'
import DOME_GLSL from '../shaders/isf/lib/dome.glsl?raw'

const num = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)

const MAX_PTS = 8
const MAX_RINGS = 16
const MAX_LENS = 8
const MAX_BURSTS = 8
const MAX_ROWS = 720

export const TOUCH_MODES = ['rings', 'spread', 'swirl', 'drag', 'lens', 'attract'] as const
const HINTS = [
  'click : a shockwave from the point · drag : a wake of rings',
  'press : push the picture away · drag : plow through it',
  'press : twist the picture round the point',
  'drag : the picture goes along with the hand',
  'press : a lens under the point',
  'press : pull the picture in'
]

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
in vec2 vUV; out vec4 o;
${DOME_GLSL}
uniform float uDome, uAsp;
// the field : flat, frame heights from the center; on the dome, the disc at half scale
vec2 fOfTex(vec2 q) { return uDome > 0.5 ? q - 0.5 : vec2((q.x - 0.5) * uAsp, q.y - 0.5); }
vec2 texOfF(vec2 f) { return uDome > 0.5 ? f + 0.5 : vec2(f.x / uAsp + 0.5, f.y + 0.5); }
vec2 dTex(vec2 df) { return uDome > 0.5 ? df : vec2(df.x / uAsp, df.y); }
vec2 toF(vec2 uv) { return uDome > 0.5 ? domeDisc(uv) * 0.5 : vec2((uv.x - 0.5) * uAsp, uv.y - 0.5); }
vec2 fromF(vec2 f) { return uDome > 0.5 ? domeFrame(f * 2.0) : vec2(f.x / uAsp + 0.5, f.y + 0.5); }
float prof(float t) { t = clamp(t, 0.0, 1.0); float s = 1.0 - t * t; return s * s; }
`

// The field : RG the displacement (field units : the picture at f shows what was at
// f - D), BA its velocity (the spring's).
const FIELD_FS = `${HEAD}
uniform sampler2D uS;
uniform vec2 uPx;
uniform float uDt, uW, uZeta, uSoft, uMode, uStr;
uniform int uN, uNB;
uniform vec4 uP[${MAX_PTS}];  // x y, last frame's x y
uniform vec4 uK[${MAX_PTS}];  // radius, weight
uniform vec4 uB[${MAX_BURSTS}];  // x y, a direction
uniform vec4 uBK[${MAX_BURSTS}]; // radius, amount
// a mode's push at d from a point (field units a second at full weight) : none at the
// point itself (no direction there), most at about half the radius
vec2 push(vec2 d, float R) {
  float r = length(d);
  float t = r / R;
  if (t >= 1.0 || r < 1e-6) return vec2(0.0);
  vec2 n = d / r;
  if (uMode < 1.5) return n * R * t * prof(t) * 8.0;              // spread
  if (uMode < 2.5) return vec2(-n.y, n.x) * r * prof(t) * 7.0;     // swirl
  return -n * R * t * prof(t) * 6.0;                              // attract
}
void main() {
  vec2 f = fOfTex(vUV);
  if (uDome > 0.5 && length(f) > 0.5) { o = vec4(0.0); return; }
  bool drag = uMode > 2.5 && uMode < 3.5;
  bool pushes = (uMode > 0.5 && uMode < 2.5) || uMode > 4.5;
  // drag : the hands carry the field along under them, so what is under one goes with it
  vec2 adv = vec2(0.0);
  if (drag) {
    for (int i = 0; i < ${MAX_PTS}; i++) {
      if (i >= uN) break;
      vec4 P = uP[i];
      float g = prof(length(f - P.xy) / uK[i].x) * uK[i].y * uStr;
      adv += (P.xy - P.zw) * g;
    }
  }
  vec2 q = vUV - dTex(adv);
  vec4 s = texture(uS, q);
  vec2 D = s.rg, V = s.ba;
  // softened by its neighbors
  vec2 nb = 0.25 * (texture(uS, q + vec2(uPx.x, 0.0)).rg + texture(uS, q - vec2(uPx.x, 0.0)).rg + texture(uS, q + vec2(0.0, uPx.y)).rg + texture(uS, q - vec2(0.0, uPx.y)).rg);
  D = mix(D, nb, uSoft);
  D += adv;
  // the held points push
  if (pushes) {
    for (int i = 0; i < ${MAX_PTS}; i++) {
      if (i >= uN) break;
      D += push(f - uP[i].xy, uK[i].x) * uK[i].y * uStr * uDt;
    }
  }
  // the bursts (a tap, the trigger, a hit of the sound) : one shove of the mode
  for (int i = 0; i < ${MAX_BURSTS}; i++) {
    if (i >= uNB) break;
    vec4 B = uB[i];
    vec4 K = uBK[i];
    if (drag) D += B.zw * K.x * prof(length(f - B.xy) / K.x) * K.y * 0.8;
    else D += push(f - B.xy, K.x) * K.y * 0.12;
  }
  // relaxed : a damped spring back to the picture as it is (none : it stays pushed)
  if (uW > 0.0) {
    V += (-uW * uW * D - 2.0 * uZeta * uW * V) * uDt;
    D += V * uDt;
  } else V = vec2(0.0);
  float m = length(D);
  if (m > 0.45) { D *= 0.45 / m; V *= 0.5; }
  o = vec4(D, V);
}`

// The field as the picture sees it : the state, the rings and the lenses
const TOTAL_FS = `${HEAD}
uniform sampler2D uS;
uniform float uRW;
uniform int uNR, uNL;
uniform vec4 uRing[${MAX_RINGS}]; // x y, radius, amplitude
uniform vec4 uLens[${MAX_LENS}];  // x y, radius, amount
void main() {
  vec2 f = fOfTex(vUV);
  if (uDome > 0.5 && length(f) > 0.5) { o = vec4(0.0); return; }
  vec2 D = texture(uS, vUV).rg;
  for (int i = 0; i < ${MAX_RINGS}; i++) {
    if (i >= uNR) break;
    vec4 R = uRing[i];
    vec2 d = f - R.xy;
    float r = length(d);
    float x = (r - R.z) / uRW;
    if (abs(x) < 3.0 && r > 1e-5) D += d / r * R.w * exp(-x * x) * smoothstep(0.0, uRW, r);
  }
  for (int i = 0; i < ${MAX_LENS}; i++) {
    if (i >= uNL) break;
    vec4 L = uLens[i];
    vec2 d = f - L.xy;
    float t = length(d) / L.z;
    if (t < 1.0) D += d * L.w * prof(t);
  }
  o = vec4(D, 0.0, 1.0);
}`

const SHOW_FS = `${HEAD}
uniform sampler2D uHost, uT;
uniform vec2 uTPx;
uniform float uShade, uSplit, uMix, uCell;
vec2 mirror(vec2 u) { return 1.0 - abs(1.0 - mod(u, 2.0)); }
vec4 at(vec2 f) {
  vec2 uv = fromF(f);
  return texture(uHost, uDome > 0.5 ? uv : mirror(uv));
}
vec4 pm(vec4 c) { return vec4(c.rgb * c.a, c.a); }
void main() {
  vec4 dry = texture(uHost, vUV);
  vec2 f = toF(vUV);
  if (uDome > 0.5 && length(f) > 0.5) { o = dry; return; }
  vec2 q = texOfF(f);
  vec2 D = texture(uT, q).rg;
  if (dot(D, D) < 1e-12) { o = dry; return; }
  vec4 c = at(f - D);
  if (uSplit > 0.0) {
    c.r = at(f - D * (1.0 + uSplit * 0.6)).r;
    c.b = at(f - D * (1.0 - uSplit * 0.6)).b;
  }
  // a matte shade : where the push bunches the picture up it darkens, where it
  // stretches it, it lightens (no light added : the picture's own, scaled)
  float div = ((texture(uT, q + vec2(uTPx.x, 0.0)).r - texture(uT, q - vec2(uTPx.x, 0.0)).r)
             + (texture(uT, q + vec2(0.0, uTPx.y)).g - texture(uT, q - vec2(0.0, uTPx.y)).g)) / (2.0 * uCell);
  c.rgb *= 1.0 + uShade * clamp(div * 0.5, -0.6, 0.25);
  // dry / wet, premultiplied : a transparent picture stays transparent
  vec4 m = mix(pm(dry), pm(c), uMix);
  o = vec4(m.a > 1e-5 ? m.rgb / m.a : c.rgb, m.a);
}`

interface Tex { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }
interface Prog { p: WebGLProgram; locs: Map<string, WebGLUniformLocation | null> }
interface Ring { x: number; y: number; t: number; a: number }
interface Lens { x: number; y: number; a: number; held: boolean }

function compile(gl: WebGL2RenderingContext, fs: string): Prog {
  const mk = (t: number, s: string): WebGLShader => {
    const sh = gl.createShader(t)!
    gl.shaderSource(sh, s)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('[touch] ' + (gl.getShaderInfoLog(sh) || 'shader'))
    return sh
  }
  const p = gl.createProgram()!
  const v = mk(gl.VERTEX_SHADER, VS), f = mk(gl.FRAGMENT_SHADER, fs)
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  gl.bindAttribLocation(p, 0, 'p')
  gl.linkProgram(p)
  gl.deleteShader(v)
  gl.deleteShader(f)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[touch] ' + (gl.getProgramInfoLog(p) || 'link'))
  return { p, locs: new Map() }
}

/** The field's size for a picture (W x H) : half its height, at most 720 rows;
 *  square on the dome (the disc). Shared with Ripple's own grid rule. */
export function fieldSize(W: number, H: number, rows: number, dome: boolean): [number, number] {
  const h = Math.max(48, Math.round(rows))
  return [dome ? h : Math.max(48, Math.round((h * W) / Math.max(1, H))), h]
}

export class TouchNode implements ConvNode {
  private gen = -1
  private progs: { field: Prog; total: Prog; show: Prog } | null = null
  private vao: WebGLVertexArrayObject | null = null
  private quad: WebGLBuffer | null = null
  private state: [Tex, Tex] | null = null
  private total: Tex | null = null
  private cur = 0
  private key = ''
  private fine = false
  private disposed = false
  // the touches
  private pts = new TouchPoints()
  private onset = new Onset()
  private rings: Ring[] = []
  private lens = new Map<number, Lens>()
  private pops = 0
  private lastRing = new Map<number, [number, number]>()
  private bursts: number[][] = []
  private prevFire = 0
  private prevClear = 0
  private busSeq = -1
  private mode = 3
  private ringW = 0.043
  private clearNext = false
  private wanderT = Math.random() * 600
  // uniform scratch
  private aP = new Float32Array(MAX_PTS * 4)
  private aK = new Float32Array(MAX_PTS * 4)
  private aB = new Float32Array(MAX_BURSTS * 4)
  private aBK = new Float32Array(MAX_BURSTS * 4)
  private aR = new Float32Array(MAX_RINGS * 4)
  private aL = new Float32Array(MAX_LENS * 4)

  constructor(private gl: WebGL2RenderingContext) {}

  /** What a click does now, for the preview's hint. */
  pointerHint(): string {
    return HINTS[this.mode] ?? HINTS[3]
  }

  /** The mouse on the preview, a Body pinch (frame uv, v up). */
  pointer(ev: SourcePointer): void {
    this.pts.pointer(ev)
  }

  private u(pr: Prog, n: string): WebGLUniformLocation | null {
    let l = pr.locs.get(n)
    if (l === undefined) { l = this.gl.getUniformLocation(pr.p, n); pr.locs.set(n, l) }
    return l
  }

  private target(w: number, h: number, f32: boolean): Tex {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (f32) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    return { tex, fbo, w, h }
  }

  private free(t: Tex | null): void {
    if (!t) return
    this.gl.deleteFramebuffer(t.fbo)
    this.gl.deleteTexture(t.tex)
  }

  private freeTargets(): void {
    if (this.state) { this.free(this.state[0]); this.free(this.state[1]) }
    this.free(this.total)
    this.state = null
    this.total = null
  }

  private draw(t: Tex): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.viewport(0, 0, t.w, t.h)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private ensureGL(): void {
    const gl = this.gl
    if (this.gen === glGeneration() && this.progs) return
    // after a GPU reset everything here is dead : build it all again
    this.gen = glGeneration()
    this.state = null
    this.total = null
    this.key = ''
    this.progs = { field: compile(gl, FIELD_FS), total: compile(gl, TOTAL_FS), show: compile(gl, SHOW_FS) }
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    // 32-bit state where it can be filtered (a slow fade creeps in 16 bits)
    this.fine = !!gl.getExtension('OES_texture_float_linear')
  }

  /** The mode's touch once, at a place (field units), s its strength. */
  private fire(x: number, y: number, s: number, mode: number, size: number, str: number): void {
    if (mode === 0) {
      // (as high as the ring is wide : steeper and the picture folds over in the ring)
      this.rings.push({ x, y, t: 0, a: str * s * this.ringW * 2.2 })
      if (this.rings.length > MAX_RINGS) this.rings.splice(0, this.rings.length - MAX_RINGS)
    } else if (mode === 4) {
      this.lens.set(-(++this.pops % 100000) - 1, { x, y, a: Math.min(0.75, str * 0.7 * s), held: false })
    } else {
      const ang = Math.random() * Math.PI * 2
      this.bursts.push([x, y, Math.cos(ang) * 0.5, Math.sin(ang) * 0.5, size, str * s])
      if (this.bursts.length > MAX_BURSTS) this.bursts.splice(0, this.bursts.length - MAX_BURSTS)
    }
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = this.gl
    if (gl.isContextLost()) return ctx.host
    this.ensureGL()
    const P = this.progs!
    const I = ctx.inputs
    const W = ctx.chain.w, H = ctx.chain.h
    const fill = domeFill()
    const dome = fill > 0
    const asp = W / Math.max(1, H)
    const dt = clamp(ctx.dt, 0, 0.05)
    const mode = Math.round(clamp(num(I.mode, 3), 0, 5))
    this.mode = mode
    const size = clamp(num(I.size, 0.18), 0.02, 0.8)
    const str = clamp(num(I.strength, 0.6), 0, 1)
    const fade = clamp(num(I.fade, 0.35), 0, 1)
    const spring = clamp(num(I.spring, 0.35), 0, 1)
    this.ringW = 0.008 + 0.07 * clamp(num(I.width, 0.5), 0, 1)
    // the field : half the height, at most 720 rows (the same cost on the dome)
    const [fw, fh] = fieldSize(W, H, Math.min(MAX_ROWS, H / 2), dome)
    const key = `${fw}x${fh}|${dome ? 1 : 0}`
    if (key !== this.key || !this.state) {
      this.freeTargets()
      this.state = [this.target(fw, fh, this.fine), this.target(fw, fh, this.fine)]
      this.total = this.target(fw, fh, false)
      this.cur = 0
      this.key = key
    }
    // clear : the picture as it is, at once
    const clr = num(I.clear, 0)
    if ((clr >= 0.5 && this.prevClear < 0.5) || this.clearNext) {
      this.clearNext = false
      for (const t of this.state) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) }
      this.rings = []
      this.lens.clear()
      this.bursts = []
    }
    this.prevClear = clr

    // ── the touches ──
    // its own hand (BY ITSELF) wanders slowly through the picture
    const wander = clamp(num(I.wander, 0), 0, 1)
    this.wanderT = (this.wanderT + dt) % 30000
    const wp = wanderAt(this.wanderT)
    const pts: TouchPoint[] = this.pts.step(dt, num(I.follow, 0.75), dome, asp, {
      people: clamp(num(I.people, 0), 0, 1),
      point: Array.isArray(I.point) ? I.point : undefined,
      press: num(I.press, 0) >= 0.5,
      ghost: wander > 0 ? [wp[0], wp[1], wander] : null
    })
    // the trigger, the sound's hits, the OSC taps
    const fr = num(I.fire, 0)
    if (fr >= 0.5 && this.prevFire < 0.5) {
      const [x, y] = firePlace(num(I.fireAt, 0), I.point as number[] | undefined, dome, asp, fill)
      this.fire(x, y, 1, mode, size, str)
    }
    this.prevFire = fr
    const au = clamp(num(I.audio, 0), 0, 1)
    if (au > 0) {
      const h = this.onset.hit()
      if (h > 0) {
        const [x, y] = firePlace(num(I.fireAt, 0), I.point as number[] | undefined, dome, asp, fill)
        this.fire(x, y, au * h, mode, size, str)
      }
    }
    const bus = touchBus.since(this.busSeq)
    this.busSeq = bus.seq
    for (const t of bus.taps) {
      const [x, y] = toField(t.u, t.v, dome, asp)
      this.fire(x, y, t.s, mode, size, str)
    }
    // the points' own : a touch going down fires (a ring, a shove), a dragged one
    // leaves a wake of rings, a held one is a lens
    const ringGap = Math.max(0.04, this.ringW * 3)
    for (const p of pts) {
      if (mode === 0) {
        const last = this.lastRing.get(p.key)
        if (p.fresh || !last) {
          this.fire(p.x, p.y, p.w, 0, size, str)
          this.lastRing.set(p.key, [p.x, p.y])
        } else if (Math.hypot(p.x - last[0], p.y - last[1]) > ringGap) {
          this.fire(p.x, p.y, p.w * 0.6, 0, size, str)
          this.lastRing.set(p.key, [p.x, p.y])
        }
      } else if (p.fresh && mode !== 3 && mode !== 4) this.fire(p.x, p.y, p.w * 0.5, mode, size, str)
    }
    for (const k of this.lastRing.keys()) if (!pts.some((p) => p.key === k)) this.lastRing.delete(k)
    // the lenses : each held point's swells, a released one (or a fired pop) fades
    const lensRate = 0.6 + 7 * fade * fade
    for (const l of this.lens.values()) l.held = false
    if (mode === 4) {
      for (const p of pts) {
        let l = this.lens.get(p.key)
        if (!l) { l = { x: p.x, y: p.y, a: 0, held: true }; this.lens.set(p.key, l) }
        l.x = p.x; l.y = p.y; l.held = true
        l.a += (Math.min(0.75, str * 0.7 * p.w) - l.a) * (1 - Math.exp(-dt * 9))
      }
    }
    for (const [k, l] of this.lens) {
      if (!l.held) l.a *= Math.exp(-dt * lensRate)
      if (l.a < 0.002) this.lens.delete(k)
    }
    // the rings travel out and die away
    const speed = 0.12 + 1.1 * Math.pow(clamp(num(I.speed, 0.45), 0, 1), 2)
    const rw = this.ringW
    for (const r of this.rings) r.t += dt
    this.rings = this.rings.filter((r) => r.t * speed < 1.7 && r.a * Math.exp(-0.7 * r.t) > 2e-4)

    // ── the field ──
    const S = this.state
    const n = Math.min(MAX_PTS, pts.length)
    this.aP.fill(0); this.aK.fill(0)
    for (let i = 0; i < n; i++) {
      const p = pts[i]
      this.aP.set([p.x, p.y, p.px, p.py], i * 4)
      this.aK.set([size, p.w, 0, 0], i * 4)
    }
    const nb = Math.min(MAX_BURSTS, this.bursts.length)
    this.aB.fill(0); this.aBK.fill(0)
    for (let i = 0; i < nb; i++) {
      const b = this.bursts[i]
      this.aB.set([b[0], b[1], b[2], b[3]], i * 4)
      this.aBK.set([b[4], b[5], 0, 0], i * 4)
    }
    this.bursts = []
    const w = 14 * Math.pow(fade, 1.5)
    gl.disable(gl.BLEND)
    let pr = P.field
    gl.useProgram(pr.p)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, S[this.cur].tex)
    gl.uniform1i(this.u(pr, 'uS'), 0)
    gl.uniform1f(this.u(pr, 'uDome'), dome ? 1 : 0)
    gl.uniform1f(this.u(pr, 'uAsp'), asp)
    gl.uniform1f(this.u(pr, 'DOME_FILL'), fill)
    gl.uniform2f(this.u(pr, 'uPx'), 1 / fw, 1 / fh)
    gl.uniform1f(this.u(pr, 'uDt'), dt)
    gl.uniform1f(this.u(pr, 'uW'), w)
    gl.uniform1f(this.u(pr, 'uZeta'), 1.0 - 0.92 * spring)
    gl.uniform1f(this.u(pr, 'uSoft'), 0.5 * Math.pow(clamp(num(I.soft, 0.25), 0, 1), 1.5))
    gl.uniform1f(this.u(pr, 'uMode'), mode)
    gl.uniform1f(this.u(pr, 'uStr'), str)
    gl.uniform1i(this.u(pr, 'uN'), n)
    gl.uniform1i(this.u(pr, 'uNB'), nb)
    gl.uniform4fv(this.u(pr, 'uP'), this.aP)
    gl.uniform4fv(this.u(pr, 'uK'), this.aK)
    gl.uniform4fv(this.u(pr, 'uB'), this.aB)
    gl.uniform4fv(this.u(pr, 'uBK'), this.aBK)
    // (a frozen rack holds its field : nothing moves at dt 0, nothing new is pushed)
    if (dt > 0 || nb > 0) {
      this.draw(S[1 - this.cur])
      this.cur = 1 - this.cur
    }
    // the rings and lenses over it
    const nr = Math.min(MAX_RINGS, this.rings.length)
    this.aR.fill(0)
    for (let i = 0; i < nr; i++) {
      const r = this.rings[i]
      const R = r.t * speed
      this.aR.set([r.x, r.y, R, (r.a * Math.exp(-0.7 * r.t)) / Math.sqrt(1 + 2 * R)], i * 4)
    }
    const lensList = [...this.lens.values()].slice(-MAX_LENS)
    this.aL.fill(0)
    lensList.forEach((l, i) => this.aL.set([l.x, l.y, size, l.a], i * 4))
    pr = P.total
    gl.useProgram(pr.p)
    gl.bindTexture(gl.TEXTURE_2D, S[this.cur].tex)
    gl.uniform1i(this.u(pr, 'uS'), 0)
    gl.uniform1f(this.u(pr, 'uDome'), dome ? 1 : 0)
    gl.uniform1f(this.u(pr, 'uAsp'), asp)
    gl.uniform1f(this.u(pr, 'DOME_FILL'), fill)
    gl.uniform1f(this.u(pr, 'uRW'), rw)
    gl.uniform1i(this.u(pr, 'uNR'), nr)
    gl.uniform1i(this.u(pr, 'uNL'), lensList.length)
    gl.uniform4fv(this.u(pr, 'uRing'), this.aR)
    gl.uniform4fv(this.u(pr, 'uLens'), this.aL)
    this.draw(this.total!)
    // the picture through it
    const out = ctx.chain.next()
    pr = P.show
    gl.useProgram(pr.p)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(this.u(pr, 'uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.total!.tex); gl.uniform1i(this.u(pr, 'uT'), 1)
    gl.uniform1f(this.u(pr, 'uDome'), dome ? 1 : 0)
    gl.uniform1f(this.u(pr, 'uAsp'), asp)
    gl.uniform1f(this.u(pr, 'DOME_FILL'), fill)
    gl.uniform2f(this.u(pr, 'uTPx'), 1 / fw, 1 / fh)
    gl.uniform1f(this.u(pr, 'uCell'), 1 / fh)
    gl.uniform1f(this.u(pr, 'uShade'), clamp(num(I.shade, 0.3), 0, 1))
    gl.uniform1f(this.u(pr, 'uSplit'), clamp(num(I.split, 0), 0, 1))
    gl.uniform1f(this.u(pr, 'uMix'), clamp(num(I.mix, 1), 0, 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
    gl.viewport(0, 0, W, H)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    if (this.gen !== glGeneration()) return
    this.freeTargets()
    if (this.progs) for (const p of Object.values(this.progs)) gl.deleteProgram(p.p)
    if (this.vao) {
      gl.bindVertexArray(this.vao)
      if (this.quad) gl.deleteBuffer(this.quad)
      gl.bindVertexArray(null)
      gl.deleteVertexArray(this.vao)
    }
    this.progs = null
  }
}
