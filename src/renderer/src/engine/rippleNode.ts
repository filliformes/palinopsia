// Ripple (the native node 'node-ripple') : the picture seen through water. A wave
// height field (h, and h a step ago, in 32 bits) on a grid a third of the picture's
// height (200 to 720 rows), stepped by the wave equation a few times a frame so the
// rings travel at the same speed whatever the grid; the picture is bent by the
// water's slope (refraction, its colors split a little) and lit matte : the side of
// each crest that faces the lamp goes pale, the other side darker, never a shine.
//
// What makes the rings : RAIN (drops at random places), the sound's hits (a drop on
// the kick), the STONE trigger (at the center, the point or a random place), an OSC
// tap, the picture's own MOTION (what changes stirs the water), the hand (the mouse,
// every pinching hand : a stone where it goes down, a finger trailing through the
// water while it is held), the Room's people wading where they stand (touchInput.ts).
//
// Flat, the frame's edges are the pool's walls (or a soft shore that swallows the
// rings). On the dome (full-dome fill) the water lives on the dome's disc (the
// zenith in the middle, rings round on the dome) and the disc's rim is the wall :
// a ring dropped at the zenith comes back from all round.

import type { ConvNode, NodeContext } from './convNodes'
import type { SourcePointer } from './nativeGenerators'
import { glGeneration } from './glGeneration'
import { domeFill } from './domeSignal'
import { TouchPoints, Onset, touchBus, toField, firePlace, randomField, wanderAt, type TouchPoint } from './touchInput'
import { fieldSize } from './touchNode'
import DOME_GLSL from '../shaders/isf/lib/dome.glsl?raw'

const num = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)

const MAX_DROPS = 16
const MAX_FINGERS = 8
const STEP = 1 / 60
const MAX_STEPS = 3
const MAX_SUB = 16

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
in vec2 vUV; out vec4 o;
${DOME_GLSL}
uniform float uDome, uAsp;
vec2 fOfTex(vec2 q) { return uDome > 0.5 ? q - 0.5 : vec2((q.x - 0.5) * uAsp, q.y - 0.5); }
vec2 texOfF(vec2 f) { return uDome > 0.5 ? f + 0.5 : vec2(f.x / uAsp + 0.5, f.y + 0.5); }
vec2 toF(vec2 uv) { return uDome > 0.5 ? domeDisc(uv) * 0.5 : vec2((uv.x - 0.5) * uAsp, uv.y - 0.5); }
vec2 fromF(vec2 f) { return uDome > 0.5 ? domeFrame(f * 2.0) : vec2(f.x / uAsp + 0.5, f.y + 0.5); }
uniform ivec2 uSize;
// a cell of the water (on the dome : inside the disc)
bool wet(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= uSize.x || c.y >= uSize.y) return false;
  if (uDome < 0.5) return true;
  vec2 q = (vec2(c) + 0.5) / vec2(uSize);
  return length(q - 0.5) <= 0.5;
}
`

// the picture's brightness on the grid, read through the field (on the dome, the disc)
const LUMA_FS = `${HEAD}
uniform sampler2D uHost;
void main() {
  vec4 c = texture(uHost, fromF(fOfTex(vUV)));
  o = vec4(dot(c.rgb, vec3(0.3, 0.59, 0.11)) * c.a, 0.0, 0.0, 1.0);
}`

// one step of the wave equation : R = h, G = h a step ago
const SIM_FS = `${HEAD}
uniform sampler2D uS, uL0, uL1;
uniform float uC2, uDamp, uEdge, uMotion, uFirst;
uniform int uND, uNF;
uniform vec4 uDrop[${MAX_DROPS}];  // x y, radius, depth
uniform vec4 uFing[${MAX_FINGERS}]; // x y, radius, depth
float hAt(ivec2 c, float self) {
  // the walls : reflect (the water stands at the wall), or the shore (nothing comes back)
  return wet(c) ? texelFetch(uS, c, 0).r : (uEdge < 0.5 ? self : 0.0);
}
float bump(float t) { return t < 1.0 ? 0.5 + 0.5 * cos(3.14159265 * t) : 0.0; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (!wet(c)) { o = vec4(0.0); return; }
  vec4 s = texelFetch(uS, c, 0);
  float h = s.r, hp = s.g;
  float lap = hAt(c + ivec2(1, 0), h) + hAt(c - ivec2(1, 0), h) + hAt(c + ivec2(0, 1), h) + hAt(c - ivec2(0, 1), h) - 4.0 * h;
  float hn = (2.0 * h - hp + uC2 * lap) * uDamp;
  vec2 f = fOfTex(vUV);
  if (uEdge > 0.5) {
    // a shore : a band at the edge that swallows what reaches it
    float e = uDome > 0.5 ? 0.5 - length(f) : min(0.5 * uAsp - abs(f.x), 0.5 - abs(f.y));
    hn *= mix(0.86, 1.0, smoothstep(0.0, 0.07, e));
  }
  if (uFirst > 0.5) {
    // what changes in the picture stirs the water
    hn += (texture(uL0, vUV).r - texture(uL1, vUV).r) * uMotion;
    for (int i = 0; i < ${MAX_DROPS}; i++) {
      if (i >= uND) break;
      vec4 D = uDrop[i];
      hn -= D.w * bump(length(f - D.xy) / D.z);
    }
  }
  // fingers in the water hold it down where they are : a moving one leaves a wake
  for (int i = 0; i < ${MAX_FINGERS}; i++) {
    if (i >= uNF) break;
    vec4 F = uFing[i];
    float b = bump(length(f - F.xy) / F.z);
    if (b > 0.0) hn = mix(hn, min(hn, -F.w * b), 0.5 * b);
  }
  o = vec4(hn, h, 0.0, 1.0);
}`

// the slope (a Sobel 3x3 : the grid's own steps never show) and the height
const SLOPE_FS = `${HEAD}
uniform sampler2D uS;
uniform float uCell;
float H0;
float hf(ivec2 c) { return wet(c) ? texelFetch(uS, c, 0).r : H0; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (!wet(c)) { o = vec4(0.0); return; }
  H0 = texelFetch(uS, c, 0).r;
  float a = hf(c + ivec2(-1, -1)), b = hf(c + ivec2(0, -1)), d = hf(c + ivec2(1, -1));
  float e = hf(c + ivec2(-1, 0)), g = hf(c + ivec2(1, 0));
  float k = hf(c + ivec2(-1, 1)), l = hf(c + ivec2(0, 1)), m = hf(c + ivec2(1, 1));
  float gx = ((d + 2.0 * g + m) - (a + 2.0 * e + k)) / (8.0 * uCell);
  float gy = ((k + 2.0 * l + m) - (a + 2.0 * b + d)) / (8.0 * uCell);
  o = vec4(gx, gy, H0, 1.0);
}`

const SHOW_FS = `${HEAD}
uniform sampler2D uHost, uG;
uniform float uRefr, uSplit, uShade, uDeep, uMix;
uniform vec2 uL;
uniform vec3 uTint;
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
  vec4 g = texture(uG, texOfF(f));
  // the picture bent by the water's slope, its colors a little apart
  vec2 off = -g.xy * uRefr;
  vec4 c = at(f + off);
  if (uSplit > 0.0) {
    c.r = at(f + off * (1.0 + uSplit)).r;
    c.b = at(f + off * (1.0 - uSplit)).b;
  }
  // the crests lit matte : the side facing the lamp goes pale, the far side darker
  float k = clamp(dot(-g.xy, uL) * 2.5, -1.0, 1.0);
  float lum = dot(c.rgb, vec3(0.3, 0.59, 0.11));
  vec3 pale = vec3(0.86, 0.88, 0.86) * (0.6 + 0.4 * lum);
  if (k > 0.0) c.rgb = mix(c.rgb, max(c.rgb, pale), k * uShade * 0.55);
  else c.rgb *= 1.0 + k * uShade * 0.6;
  // the water's own color, most in the troughs
  float tr = clamp(-g.z * 60.0, 0.0, 1.0);
  c.rgb = mix(c.rgb, c.rgb * uTint * 1.2, uDeep * (0.35 + 0.65 * tr));
  vec4 mx = mix(pm(dry), pm(c), uMix);
  o = vec4(mx.a > 1e-5 ? mx.rgb / mx.a : c.rgb, mx.a);
}`

interface Tex { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }
interface Prog { p: WebGLProgram; locs: Map<string, WebGLUniformLocation | null> }

function compile(gl: WebGL2RenderingContext, fs: string): Prog {
  const mk = (t: number, s: string): WebGLShader => {
    const sh = gl.createShader(t)!
    gl.shaderSource(sh, s)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('[ripple] ' + (gl.getShaderInfoLog(sh) || 'shader'))
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
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[ripple] ' + (gl.getProgramInfoLog(p) || 'link'))
  return { p, locs: new Map() }
}

export class RippleNode implements ConvNode {
  private gen = -1
  private progs: { luma: Prog; sim: Prog; slope: Prog; show: Prog } | null = null
  private vao: WebGLVertexArrayObject | null = null
  private quad: WebGLBuffer | null = null
  private state: [Tex, Tex] | null = null
  private luma: [Tex, Tex] | null = null
  private slope: Tex | null = null
  private cur = 0
  private lc = 0
  private lumaFresh = 0
  private key = ''
  private acc = 0
  private rainAcc = 0
  private disposed = false
  // what makes the rings
  private pts = new TouchPoints()
  private onset = new Onset()
  private drops: number[][] = []
  private prevStone = 0
  private prevStill = 0
  private busSeq = -1
  private wanderT = Math.random() * 600
  private aD = new Float32Array(MAX_DROPS * 4)
  private aF = new Float32Array(MAX_FINGERS * 4)

  constructor(private gl: WebGL2RenderingContext) {}

  pointerHint(): string {
    return 'click : drop a stone · drag : a finger through the water'
  }

  pointer(ev: SourcePointer): void {
    this.pts.pointer(ev)
  }

  private u(pr: Prog, n: string): WebGLUniformLocation | null {
    let l = pr.locs.get(n)
    if (l === undefined) { l = this.gl.getUniformLocation(pr.p, n); pr.locs.set(n, l) }
    return l
  }

  private target(w: number, h: number, kind: 'f32' | 'f16' | 'r8'): Tex {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (kind === 'f32') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null)
    else if (kind === 'f16') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    // (the 32-bit state is read by whole cells : no filtering, no extension)
    const flt = kind === 'f32' ? gl.NEAREST : gl.LINEAR
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, flt)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, flt)
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
    if (this.luma) { this.free(this.luma[0]); this.free(this.luma[1]) }
    this.free(this.slope)
    this.state = null
    this.luma = null
    this.slope = null
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
    this.gen = glGeneration()
    this.state = null
    this.luma = null
    this.slope = null
    this.key = ''
    gl.getExtension('EXT_color_buffer_float')
    this.progs = { luma: compile(gl, LUMA_FS), sim: compile(gl, SIM_FS), slope: compile(gl, SLOPE_FS), show: compile(gl, SHOW_FS) }
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  /** A drop at (x, y) (field units) : r its radius, a how deep it goes in. */
  private drop(x: number, y: number, r: number, a: number): void {
    this.drops.push([x, y, r, a])
    if (this.drops.length > MAX_DROPS) this.drops.splice(0, this.drops.length - MAX_DROPS)
  }

  private common(pr: Prog, dome: boolean, asp: number, fill: number, gw: number, gh: number): void {
    const gl = this.gl
    gl.uniform1f(this.u(pr, 'uDome'), dome ? 1 : 0)
    gl.uniform1f(this.u(pr, 'uAsp'), asp)
    gl.uniform1f(this.u(pr, 'DOME_FILL'), fill)
    gl.uniform2i(this.u(pr, 'uSize'), gw, gh)
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
    const dt = clamp(ctx.dt, 0, 0.1)
    // the grid : a third of the height, 200 to 720 rows; square on the dome (the disc)
    const [gw, gh] = fieldSize(W, H, clamp(H / 3, 200, 720), dome)
    const key = `${gw}x${gh}|${dome ? 1 : 0}`
    if (key !== this.key || !this.state) {
      this.freeTargets()
      this.state = [this.target(gw, gh, 'f32'), this.target(gw, gh, 'f32')]
      this.luma = [this.target(gw, gh, 'r8'), this.target(gw, gh, 'r8')]
      this.slope = this.target(gw, gh, 'f16')
      this.cur = 0
      this.lumaFresh = 0
      this.key = key
    }
    const cell = 1 / gh
    // still : the water flat at once
    const still = num(I.still, 0)
    if (still >= 0.5 && this.prevStill < 0.5) {
      for (const t of this.state) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) }
      this.drops = []
    }
    this.prevStill = still

    // ── what makes the rings ──
    const ds = clamp(num(I.dropSize, 0.35), 0, 1)
    const dropR = Math.max(2.5 * cell, 0.007 + 0.05 * ds * ds)
    const stoneR = Math.max(3 * cell, dropR * 2.2)
    const stone = (x: number, y: number, s: number): void => this.drop(x, y, stoneR, 0.3 * stoneR * s)
    if (dt > 0) {
      // the rain : drops at random places, as many as RAIN asks (about 30 a second at 1)
      const rain = clamp(num(I.rain, 0.25), 0, 1)
      this.rainAcc += dt * 30 * rain * rain
      while (this.rainAcc >= 1) {
        this.rainAcc -= Math.random() < 0.85 ? 1 : 0.5
        const [x, y] = randomField(dome, asp, fill)
        const r = dropR * (0.6 + 0.8 * Math.random())
        this.drop(x, y, r, 0.4 * r * (0.5 + Math.random()))
      }
    }
    const st = num(I.stone, 0)
    if (st >= 0.5 && this.prevStone < 0.5) {
      const [x, y] = firePlace(num(I.stoneAt, 0), I.point as number[] | undefined, dome, asp, fill)
      stone(x, y, 1)
    }
    this.prevStone = st
    const au = clamp(num(I.audio, 0), 0, 1)
    if (au > 0) {
      const h = this.onset.hit()
      if (h > 0) {
        const [x, y] = firePlace(num(I.stoneAt, 0), I.point as number[] | undefined, dome, asp, fill)
        stone(x, y, au * h)
      }
    }
    const bus = touchBus.since(this.busSeq)
    this.busSeq = bus.seq
    for (const t of bus.taps) {
      const [x, y] = toField(t.u, t.v, dome, asp)
      stone(x, y, t.s)
    }
    // the hands, the OSC finger, the point, the people : a stone where one goes down,
    // then a finger in the water while it stays
    const wander = clamp(num(I.wander, 0), 0, 1)
    this.wanderT = (this.wanderT + dt) % 30000
    const wp = wanderAt(this.wanderT)
    const pts: TouchPoint[] = this.pts.step(dt, num(I.follow, 0.8), dome, asp, {
      people: clamp(num(I.people, 0), 0, 1),
      point: Array.isArray(I.point) ? I.point : undefined,
      press: num(I.press, 0) >= 0.5,
      ghost: wander > 0 ? [wp[0], wp[1], wander] : null
    })
    const fingerR = Math.max(3 * cell, dropR * 1.6)
    const nf = Math.min(MAX_FINGERS, pts.length)
    this.aF.fill(0)
    for (let i = 0; i < nf; i++) {
      const p = pts[i]
      if (p.fresh) stone(p.x, p.y, p.w)
      this.aF.set([p.x, p.y, fingerR, 0.12 * fingerR * p.w], i * 4)
    }

    // ── the water ──
    gl.disable(gl.BLEND)
    // the picture's brightness now, beside the last frame's
    const motion = clamp(num(I.motion, 0.25), 0, 1)
    if (motion > 0 && dt > 0) {
      this.lc = 1 - this.lc
      const pr = P.luma
      gl.useProgram(pr.p)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, ctx.host)
      gl.uniform1i(this.u(pr, 'uHost'), 0)
      this.common(pr, dome, asp, fill, gw, gh)
      this.draw(this.luma![this.lc])
      this.lumaFresh = Math.min(2, this.lumaFresh + 1)
    } else this.lumaFresh = 0
    // a fixed step (the same water at any frame rate), each split so a ring moves
    // under 0.6 cells a substep (stable, and the speed is the same on any grid)
    this.acc = Math.min(this.acc + dt, STEP * MAX_STEPS)
    const v = 0.06 + 0.7 * Math.pow(clamp(num(I.speed, 0.4), 0, 1), 1.5)
    const cells = (v * gh) * STEP
    const sub = clamp(Math.ceil(cells / 0.6), 1, MAX_SUB)
    const c = cells / sub
    const calm = clamp(num(I.calm, 0.35), 0, 1)
    const damp = Math.exp(-(0.08 + 2.6 * calm * calm) * (STEP / sub))
    const nd = Math.min(MAX_DROPS, this.drops.length)
    this.aD.fill(0)
    for (let i = 0; i < nd; i++) this.aD.set(this.drops[i], i * 4)
    let first = nd > 0 || this.lumaFresh >= 2
    const pr = P.sim
    gl.useProgram(pr.p)
    this.common(pr, dome, asp, fill, gw, gh)
    gl.uniform1i(this.u(pr, 'uS'), 0)
    gl.uniform1i(this.u(pr, 'uL0'), 1)
    gl.uniform1i(this.u(pr, 'uL1'), 2)
    gl.uniform1f(this.u(pr, 'uC2'), c * c)
    gl.uniform1f(this.u(pr, 'uDamp'), damp)
    gl.uniform1f(this.u(pr, 'uEdge'), Math.round(num(I.edges, 0)) === 1 ? 1 : 0)
    gl.uniform1f(this.u(pr, 'uMotion'), this.lumaFresh >= 2 ? motion * motion * 0.006 : 0)
    gl.uniform1i(this.u(pr, 'uND'), nd)
    gl.uniform1i(this.u(pr, 'uNF'), nf)
    gl.uniform4fv(this.u(pr, 'uDrop'), this.aD)
    gl.uniform4fv(this.u(pr, 'uFing'), this.aF)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.luma![this.lc].tex)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.luma![1 - this.lc].tex)
    const S = this.state
    while (this.acc >= STEP) {
      this.acc -= STEP
      for (let k = 0; k < sub; k++) {
        gl.uniform1f(this.u(pr, 'uFirst'), first ? 1 : 0)
        first = false
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, S[this.cur].tex)
        this.draw(S[1 - this.cur])
        this.cur = 1 - this.cur
      }
    }
    // (drops wait for the next step when this frame had none : a frozen rack keeps them)
    if (!first) this.drops = []
    // the slope
    {
      const p2 = P.slope
      gl.useProgram(p2.p)
      this.common(p2, dome, asp, fill, gw, gh)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, S[this.cur].tex)
      gl.uniform1i(this.u(p2, 'uS'), 0)
      gl.uniform1f(this.u(p2, 'uCell'), cell)
      this.draw(this.slope!)
    }
    // the picture through the water
    const out = ctx.chain.next()
    const p3 = P.show
    gl.useProgram(p3.p)
    this.common(p3, dome, asp, fill, gw, gh)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(this.u(p3, 'uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.slope!.tex); gl.uniform1i(this.u(p3, 'uG'), 1)
    gl.uniform1f(this.u(p3, 'uRefr'), 0.13 * Math.pow(clamp(num(I.refract, 0.5), 0, 1), 1.3))
    gl.uniform1f(this.u(p3, 'uSplit'), 0.35 * clamp(num(I.split, 0.15), 0, 1))
    gl.uniform1f(this.u(p3, 'uShade'), clamp(num(I.shade, 0.35), 0, 1))
    gl.uniform1f(this.u(p3, 'uDeep'), clamp(num(I.deep, 0.1), 0, 1))
    gl.uniform1f(this.u(p3, 'uMix'), clamp(num(I.mix, 1), 0, 1))
    const la = num(I.lightAngle, 2.36)
    gl.uniform2f(this.u(p3, 'uL'), Math.cos(la), Math.sin(la))
    const tint = Array.isArray(I.tint) ? I.tint : [0.55, 0.68, 0.72, 1]
    gl.uniform3f(this.u(p3, 'uTint'), tint[0], tint[1], tint[2])
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
    gl.viewport(0, 0, W, H)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    for (let i = 2; i >= 0; i--) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null) }
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
