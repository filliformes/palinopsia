// Inflate (the native node 'node-inflate') : any picture blown up into volume. The
// layer's shape (its alpha, or what is bright, or what is dark) is the mask; a jump flood
// finds every pixel's distance to the edge of that mask; that distance becomes a pressure,
// relaxed a few times with nothing outside the shape, as a skin blown up takes its form
// (no ridge down the middle, what is narrow stands lower), and the square root of it is a
// round height, lit with Relief's own materials (reliefShade.ts). So a line of text, a logo,
// a silhouette comes out as live chrome, plastic, clay, soap film or glass, updated every
// frame with whatever the layer is doing. The pressure stays in 32 bits on the small grid
// and is read by whole texels (no filtering needed); the height and slope come out of it into
// a filtered 16-bit target, so a reflection sees a slope that is continuous across the grid's
// cells instead of one facet per cell.

import type { ConvNode, NodeContext } from './convNodes'
import { RELIEF_SHADE } from './reliefShade'
import { glGeneration } from './glGeneration'
import { domeFill } from './domeSignal'

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
in vec2 vUV; out vec4 o;
`

// the seeds : a pixel on the mask's edge knows itself (its own place); the rest know nothing
const MASK_FS = `${HEAD}
uniform sampler2D uHost;
uniform float uFrom, uThresh;
float cover(vec4 c) {
  float l = dot(c.rgb, vec3(0.3, 0.59, 0.11)) * c.a;
  if (uFrom < 0.5) return c.a;
  if (uFrom < 1.5) return l;
  return (1.0 - l) * c.a;
}
void main() {
  o = vec4(smoothstep(uThresh - 0.04, uThresh + 0.04, cover(texture(uHost, vUV))));
}`

const SEED_FS = `${HEAD}
uniform sampler2D uM;
uniform vec2 uPx;
void main() {
  float m = texture(uM, vUV).r;
  bool inside = m > 0.5;
  bool edge = false;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    if ((texture(uM, vUV + vec2(float(x), float(y)) * uPx).r > 0.5) != inside) edge = true;
  }
  o = edge ? vec4(vUV, 1.0, 1.0) : vec4(0.0);
}`

const JFA_FS = `${HEAD}
uniform sampler2D uS;
uniform vec2 uAspect, uStep;
void main() {
  vec4 best = texture(uS, vUV);
  float bd = best.z > 0.5 ? length((best.xy - vUV) * uAspect) : 1e9;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    if (x == 0 && y == 0) continue;
    vec4 c = texture(uS, vUV + vec2(float(x), float(y)) * uStep);
    if (c.z < 0.5) continue;
    float d = length((c.xy - vUV) * uAspect);
    if (d < bd) { bd = d; best = c; }
  }
  o = best;
}`

// the pressure : a parabola of the distance in, flat past the puff (its root is a circle)
const PRESS_FS = `${HEAD}
uniform sampler2D uM, uD;
uniform vec2 uAspect;
uniform float uPuff, uRound;
void main() {
  float m = texture(uM, vUV).r;
  vec4 s = texture(uD, vUV);
  if (m <= 0.5) { o = vec4(0.0); return; }
  float t = s.z < 0.5 ? 1.0 : clamp(length((s.xy - vUV) * uAspect) / uPuff, 0.0, 1.0);
  // round : a full round pillow; low : a flat top with a mitred bevel
  float sh = smoothstep(0.0, 1.0, t);
  o = vec4(mix(sh * sh, t * (2.0 - t), uRound));
}`

// a skin relaxing : each point the mean of its neighbours, held to nothing outside the shape
const RELAX_FS = `${HEAD}
uniform sampler2D uU, uM;
uniform int uS;
float at(ivec2 c) { return texelFetch(uU, clamp(c, ivec2(0), textureSize(uU, 0) - 1), 0).r; }
void main() {
  if (texture(uM, vUV).r <= 0.5) { o = vec4(0.0); return; }
  ivec2 c = ivec2(gl_FragCoord.xy);
  int s = uS, d = max(1, int(float(uS) * 0.7071 + 0.5));
  float a = at(c + ivec2(s, 0)) + at(c - ivec2(s, 0)) + at(c + ivec2(0, s)) + at(c - ivec2(0, s));
  float b = at(c + ivec2(d, d)) + at(c - ivec2(d, d)) + at(c + ivec2(d, -d)) + at(c - ivec2(d, -d));
  o = vec4((at(c) + a + b) / 9.0);
}`

// the height and its slope, out of the pressure : r the height, g and b the slope
const SLOPE_FS = `${HEAD}
uniform sampler2D uU;
uniform vec2 uCell;
uniform float uPuff;
float at(ivec2 c) { return sqrt(max(0.0, texelFetch(uU, clamp(c, ivec2(0), textureSize(uU, 0) - 1), 0).r)) * uPuff; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float a1 = at(c + ivec2(-1, -1)), a2 = at(c + ivec2(0, -1)), a3 = at(c + ivec2(1, -1));
  float b1 = at(c + ivec2(-1, 0)), b3 = at(c + ivec2(1, 0));
  float c1 = at(c + ivec2(-1, 1)), c2 = at(c + ivec2(0, 1)), c3 = at(c + ivec2(1, 1));
  vec2 slope = vec2((a3 + 2.0 * b3 + c3) - (a1 + 2.0 * b1 + c1), (c1 + 2.0 * c2 + c3) - (a1 + 2.0 * a2 + a3)) / (8.0 * uCell);
  o = vec4(at(c), slope, 1.0);
}`

const SHOW_FS = `${HEAD}
uniform sampler2D uHost, uM, uH, uSide;
uniform vec2 uAspect, uRes;
uniform vec3 uL, uTint;
uniform float uAz, uPuff, uVolume, uMat, uGloss, uFilm, uFilmNm, uMixA, uKeep, uHasSide, uShadow, uT, uFrom, uThresh, uCav, uDisp, uRim;
uniform vec2 uGrid;
${RELIEF_SHADE}
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  vec2 h = vec2(127.1, 311.7);
  float a = fract(sin(dot(i, h)) * 43758.5453), b = fract(sin(dot(i + vec2(1, 0), h)) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0, 1), h)) * 43758.5453), d = fract(sin(dot(i + vec2(1, 1), h)) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float heightAt(vec2 uv) { return texture(uH, uv).r; }
float cover(vec4 c) {
  float l = dot(c.rgb, vec3(0.3, 0.59, 0.11)) * c.a;
  if (uFrom < 0.5) return c.a;
  if (uFrom < 1.5) return l;
  return (1.0 - l) * c.a;
}
void main() {
  vec4 host = texture(uHost, vUV);
  vec4 hs = texture(uH, vUV);
  float h = hs.r;
  vec3 N = normalize(vec3(-hs.gb * uVolume, 1.0));
  float m = texture(uM, vUV).r;
  vec3 alb = mix(host.a > 1e-4 ? host.rgb : uTint, uTint, 1.0 - uKeep);
  // the materials : 0 clay 1 plastic 2 metal 3 chrome 4 soap film 5 glass 6 foil
  float M = uMat < 0.5 ? 0.0 : uMat < 1.5 ? 3.0 : uMat < 2.5 ? 1.0 : uMat < 3.5 ? 4.0 : uMat < 4.5 ? 6.0 : uMat > 5.5 ? 7.0 : 4.0;
  vec3 refl = vec3(0.0);
  float reflAmt = 0.0;
  if (uHasSide > 0.5) { refl = texture(uSide, vUV + reflect(vec3(0.0, 0.0, -1.0), N).xy * 0.34).rgb * 1.2; reflAmt = 1.0; }
  float nm = 180.0 + uFilmNm + h * 2600.0 + (noise(vUV * uAspect * 7.0 + uT * 0.07) + 0.5 * noise(vUV * uAspect * 15.0 - uT * 0.05)) * 300.0;
  vec2 P = (vUV - 0.5) * uAspect;
  vec3 lit = shadeSurface(M, alb, N, uL, uAz, 0.3 + uGloss * 1.2, refl, reflAmt, uFilm, nm, P);
  float fr = 1.0;
  if (uMat > 4.5 && uMat < 5.5) {
    // glass : a picked layer bent by the shape, else the picture itself, the room on its shoulders
    // red bends least, blue most (DISPERSION) : the split is widest at the rim, where
    // the surface turns away (the idea after Orb, MIT; no code taken)
    // third-party: Orb (an idea, no code)
    vec2 bo = N.xy * 0.14;
    vec2 bur = vUV + bo * (1.0 - 0.3 * uDisp), bug = vUV + bo, bub = vUV + bo * (1.0 + 0.35 * uDisp);
    vec3 bent = uHasSide > 0.5
      ? vec3(texture(uSide, bur).r, texture(uSide, bug).g, texture(uSide, bub).b)
      : vec3(texture(uHost, bur).r, texture(uHost, bug).g, texture(uHost, bub).b);
    fr = pow(max(0.0, 1.0 - N.z), 3.0);
    lit = bent * (0.86 + 0.2 * N.z) + roomAt(reflect(vec3(0.0, 0.0, -1.0), N), uAz, P, N.z, 0.05) * (0.08 + 0.75 * fr);
    // the rim : a bright thin edge where the glass turns away
    lit += vec3(0.92, 0.96, 1.0) * pow(max(0.0, 1.0 - N.z), 4.0) * uRim * 0.9;
  }
  // (after the glass, which replaces the lit surface : its creases darken too)
  // cavity : the creases between swellings get less of the room (the slope's divergence :
  // a valley is positive)
  if (uCav > 0.0) {
    vec2 g = 1.0 / uGrid;
    float cur = (texture(uH, vUV + vec2(g.x, 0.0)).g - texture(uH, vUV - vec2(g.x, 0.0)).g) / (2.0 * g.x * uAspect.x)
              + (texture(uH, vUV + vec2(0.0, g.y)).b - texture(uH, vUV - vec2(0.0, g.y)).b) / (2.0 * g.y * uAspect.y);
    lit *= 1.0 - uCav * 0.8 * clamp(cur * uVolume * 0.06, 0.0, 1.0);
  }
  // the shadow it throws on what is outside it
  float sh = 0.0;
  if (uShadow > 0.0 && m < 0.5) {
    vec2 d = normalize(uL.xy + 1e-5) * uPuff * 0.45 / uAspect;
    for (int i = 1; i <= 5; i++) sh = max(sh, smoothstep(0.0, uPuff * 0.3, heightAt(vUV + d * float(i) / 5.0)) * (1.0 - float(i) / 6.0));
    sh *= uShadow;
  }
  // the shape's own edge at the picture's own resolution; the height's grid may be coarser
  float cov = smoothstep(uThresh - 0.04, uThresh + 0.04, cover(host));
  // straight alpha : the shape, over the picture as it was. Glass with nothing to bend
  // is clear in the middle : the layers under it show through.
  vec3 outC = mix(host.rgb * (1.0 - 0.6 * sh), lit, cov);
  float clear = uMat > 4.5 && uMat < 5.5 && uHasSide < 0.5 ? mix(0.3, 1.0, min(1.0, fr * 2.4)) : 1.0;
  float outA = max(host.a * (1.0 - cov), cov * clear);
  if (sh > 0.0 && host.a < 0.01) { outC = vec3(0.0); outA = 0.6 * sh; }
  outC = mix(host.rgb, outC, uMixA);
  o = vec4(outC, mix(host.a, outA, uMixA));
}`

interface Tex { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }

function compile(gl: WebGL2RenderingContext, fs: string): WebGLProgram {
  const mk = (t: number, src: string): WebGLShader => {
    const s = gl.createShader(t)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[convNode] inflate :', gl.getShaderInfoLog(s))
    return s
  }
  const v = mk(gl.VERTEX_SHADER, VS), f = mk(gl.FRAGMENT_SHADER, fs)
  const p = gl.createProgram()!
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  gl.bindAttribLocation(p, 0, 'p')
  gl.linkProgram(p)
  gl.deleteShader(v)
  gl.deleteShader(f)
  return p
}

const num = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export class InflateNode implements ConvNode {
  private gen = glGeneration()
  private progs: { mask: WebGLProgram; seed: WebGLProgram; jfa: WebGLProgram; press: WebGLProgram; relax: WebGLProgram; slope: WebGLProgram; show: WebGLProgram } | null = null
  private vao: WebGLVertexArrayObject | null = null
  private quad: WebGLBuffer | null = null
  private mask: Tex | null = null
  private jf: [Tex, Tex] | null = null
  private press: [Tex, Tex] | null = null
  private height: Tex | null = null
  private blank: WebGLTexture | null = null
  private az = 0
  private t = 0
  private flowT = 0 // how far the flowing metal's bands have run (integrated : a knob never jumps them)
  private locs = new Map<string, WebGLUniformLocation | null>()

  constructor(private gl: WebGL2RenderingContext) {}

  private u(p: WebGLProgram, n: string): WebGLUniformLocation | null {
    const k = n + String((p as unknown as { __id?: number }).__id ?? '')
    let l = this.locs.get(k)
    if (l === undefined) { l = this.gl.getUniformLocation(p, n); this.locs.set(k, l) }
    return l
  }

  private target(w: number, h: number, type: 'rg' | 'r8' | 'r32' | 'hs'): Tex {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (type === 'rg') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else if (type === 'r32') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null)
    else if (type === 'hs') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const f = type === 'rg' || type === 'r32' ? gl.NEAREST : gl.LINEAR
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    return { tex, fbo, w, h }
  }

  private free(t: Tex | null): void {
    if (!t) return
    this.gl.deleteFramebuffer(t.fbo)
    this.gl.deleteTexture(t.tex)
  }

  private draw(fbo: WebGLFramebuffer, w: number, h: number): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.viewport(0, 0, w, h)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  render(ctx: NodeContext): WebGLTexture {
    const gl = this.gl
    if (gl.isContextLost()) return ctx.host
    if (this.gen !== glGeneration()) {
      this.progs = null; this.vao = null; this.quad = null; this.mask = null; this.jf = null; this.press = null; this.height = null; this.blank = null
      this.locs.clear()
      this.gen = glGeneration()
    }
    if (!this.progs) {
      this.progs = { mask: compile(gl, MASK_FS), seed: compile(gl, SEED_FS), jfa: compile(gl, JFA_FS), press: compile(gl, PRESS_FS), relax: compile(gl, RELAX_FS), slope: compile(gl, SLOPE_FS), show: compile(gl, SHOW_FS) }
      let id = 1
      for (const p of Object.values(this.progs)) (p as unknown as { __id: number }).__id = id++
      this.vao = gl.createVertexArray()!
      gl.bindVertexArray(this.vao)
      this.quad = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.bindVertexArray(null)
      gl.bindBuffer(gl.ARRAY_BUFFER, null)
      this.blank = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.blank)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    const P = this.progs
    const chain = ctx.chain
    const W = chain.w, H = chain.h
    const I = ctx.inputs
    // the flood runs on a grid bounded at 720 rows : the distance is smooth, and the same
    // at 1080p and on the dome's 2048² composition (the cost holds)
    const scale = Math.min(1, 720 / H)
    const w = Math.max(16, Math.round(W * scale)), h = Math.max(16, Math.round(H * scale))
    if (!this.mask || this.mask.w !== w || this.mask.h !== h) {
      this.free(this.mask)
      if (this.jf) { this.free(this.jf[0]); this.free(this.jf[1]) }
      if (this.press) { this.free(this.press[0]); this.free(this.press[1]) }
      this.free(this.height)
      this.mask = this.target(w, h, 'r8')
      this.jf = [this.target(w, h, 'rg'), this.target(w, h, 'rg')]
      this.press = [this.target(w, h, 'r32'), this.target(w, h, 'r32')]
      this.height = this.target(w, h, 'hs')
    }
    gl.disable(gl.BLEND)
    const fill = domeFill() > 0
    const asp: [number, number] = fill ? [1, 1] : [W / Math.max(1, H), 1]
    this.t = (this.t + ctx.dt) % 4096
    this.flowT = (this.flowT + Math.max(-1, Math.min(1, num(I.flowSpeed, 0.3))) * 0.8 * ctx.dt + 8192) % 8192
    // the mask
    gl.useProgram(P.mask)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, ctx.host)
    gl.uniform1i(this.u(P.mask, 'uHost'), 0)
    gl.uniform1f(this.u(P.mask, 'uFrom'), Math.round(num(I.from, 1)))
    gl.uniform1f(this.u(P.mask, 'uThresh'), Math.max(0.02, Math.min(0.98, num(I.threshold, 0.4))))
    this.draw(this.mask.fbo, w, h)
    // the flood : from its widest step down to one pixel
    const J = this.jf!
    let cur = 0
    gl.useProgram(P.seed)
    gl.bindTexture(gl.TEXTURE_2D, this.mask.tex)
    gl.uniform1i(this.u(P.seed, 'uM'), 0)
    gl.uniform2f(this.u(P.seed, 'uPx'), 1 / w, 1 / h)
    this.draw(J[0].fbo, w, h)
    const puff = 0.006 + 0.16 * Math.pow(Math.max(0, Math.min(1, num(I.puff, 0.4))), 1.5)
    // (only as far as the puff reaches : beyond it the height is flat, no need to know)
    const reach = Math.ceil(Math.max(w, h) * Math.min(1, puff * 2.2 / Math.min(asp[0], asp[1])))
    let step = 1
    while (step * 2 < reach) step *= 2
    gl.useProgram(P.jfa)
    gl.uniform1i(this.u(P.jfa, 'uS'), 0)
    gl.uniform2f(this.u(P.jfa, 'uAspect'), asp[0], asp[1])
    while (step >= 1) {
      gl.bindTexture(gl.TEXTURE_2D, J[cur].tex)
      gl.uniform2f(this.u(P.jfa, 'uStep'), step / w, step / h)
      this.draw(J[1 - cur].fbo, w, h)
      cur = 1 - cur
      step = step >> 1
    }
    // the pressure, relaxed from wide to fine : by ROUND, none keeps a mitred bevel
    const round = Math.max(0, Math.min(1, num(I.round, 0.85)))
    const U = this.press!
    gl.useProgram(P.press)
    gl.bindTexture(gl.TEXTURE_2D, this.mask.tex)
    gl.uniform1i(this.u(P.press, 'uM'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, J[cur].tex)
    gl.uniform1i(this.u(P.press, 'uD'), 1)
    gl.uniform2f(this.u(P.press, 'uAspect'), asp[0], asp[1])
    gl.uniform1f(this.u(P.press, 'uPuff'), puff)
    gl.uniform1f(this.u(P.press, 'uRound'), round)
    this.draw(U[0].fbo, w, h)
    let uc = 0
    // (in grid pixels : a share of the puff)
    const relaxPx = round * round * puff * h * 0.5
    {
      gl.useProgram(P.relax)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.mask.tex)
      gl.uniform1i(this.u(P.relax, 'uM'), 1)
      gl.uniform1i(this.u(P.relax, 'uU'), 0)
      gl.activeTexture(gl.TEXTURE0)
      // (from wide to one pixel, then one more : a sparse kernel alone leaves its own lattice,
      // and the flood's whole-pixel distances, and a mirror shows both)
      const steps: number[] = []
      for (let px = relaxPx; px > 1.5; px *= 0.6) steps.push(Math.round(px))
      steps.push(1, 1)
      for (const px of steps) {
        gl.bindTexture(gl.TEXTURE_2D, U[uc].tex)
        gl.uniform1i(this.u(P.relax, 'uS'), px)
        this.draw(U[1 - uc].fbo, w, h)
        uc = 1 - uc
      }
    }
    gl.activeTexture(gl.TEXTURE0)
    // the height and its slope
    gl.useProgram(P.slope)
    gl.bindTexture(gl.TEXTURE_2D, U[uc].tex)
    gl.uniform1i(this.u(P.slope, 'uU'), 0)
    gl.uniform2f(this.u(P.slope, 'uCell'), asp[0] / w, asp[1] / h)
    gl.uniform1f(this.u(P.slope, 'uPuff'), puff)
    this.draw(this.height!.fbo, w, h)
    // the light
    const orbit = num(I.orbit, 0.1)
    this.az = (this.az + orbit * 1.2 * ctx.dt) % (Math.PI * 2)
    const la = num(I.lightAngle, 2.36) + this.az
    const lh = Math.max(0, Math.min(1, num(I.lightHeight, 0.55)))
    const lz = 0.15 + 1.1 * lh
    const ln = Math.hypot(1, lz)
    const tint = Array.isArray(I.tint) ? I.tint : [0.8, 0.82, 0.86, 1]
    const out = chain.next()
    gl.useProgram(P.show)
    const s = P.show
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(this.u(s, 'uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mask.tex); gl.uniform1i(this.u(s, 'uM'), 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.height!.tex); gl.uniform1i(this.u(s, 'uH'), 2)
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, ctx.sidechain ?? this.blank); gl.uniform1i(this.u(s, 'uSide'), 3)
    gl.uniform2f(this.u(s, 'uAspect'), asp[0], asp[1])
    gl.uniform2f(this.u(s, 'uRes'), W, H)
    gl.uniform1f(this.u(s, 'uFrom'), Math.round(num(I.from, 1)))
    gl.uniform1f(this.u(s, 'uThresh'), Math.max(0.02, Math.min(0.98, num(I.threshold, 0.4))))
    gl.uniform3f(this.u(s, 'uL'), Math.cos(la) / ln, Math.sin(la) / ln, lz / ln)
    gl.uniform3f(this.u(s, 'uTint'), tint[0], tint[1], tint[2])
    gl.uniform1f(this.u(s, 'uAz'), la)
    gl.uniform1f(this.u(s, 'uPuff'), puff)
    gl.uniform1f(this.u(s, 'uVolume'), 0.25 + 1.5 * Math.max(0, Math.min(1, num(I.volume, 0.5))))
    gl.uniform1f(this.u(s, 'uMat'), Math.round(num(I.material, 3)))
    gl.uniform1f(this.u(s, 'uGloss'), Math.max(0, Math.min(1, num(I.gloss, 0.6))))
    gl.uniform1f(this.u(s, 'uFilm'), Math.max(0, Math.min(1, num(I.film, 0))))
    gl.uniform1f(this.u(s, 'uFilmNm'), 800 * Math.max(0, Math.min(1, num(I.filmThick, 0.3))))
    gl.uniform1f(this.u(s, 'uMixA'), Math.max(0, Math.min(1, num(I.mix, 1))))
    gl.uniform1f(this.u(s, 'uKeep'), Math.max(0, Math.min(1, num(I.keep, 1))))
    gl.uniform1f(this.u(s, 'uHasSide'), ctx.sidechain ? 1 : 0)
    gl.uniform1f(this.u(s, 'uShadow'), Math.max(0, Math.min(1, num(I.shadow, 0.5))))
    gl.uniform1f(this.u(s, 'uT'), this.t)
    gl.uniform1f(this.u(s, 'uFlow'), Math.max(0, Math.min(1, num(I.flow, 0))))
    gl.uniform1f(this.u(s, 'uFlowT'), this.flowT)
    gl.uniform1f(this.u(s, 'uBands'), Math.max(0.5, Math.min(16, num(I.bands, 3))))
    gl.uniform1f(this.u(s, 'uSplit'), Math.max(0, Math.min(1, num(I.split, 0.35))))
    gl.uniform1f(this.u(s, 'uRipple'), Math.max(0, Math.min(1, num(I.ripple, 0.3))))
    gl.uniform1f(this.u(s, 'uFoilSat'), Math.max(0, Math.min(1, num(I.rainbow, 0.25))))
    gl.uniform1f(this.u(s, 'uFoilScale'), Math.max(20, Math.min(400, num(I.flakes, 220))))
    gl.uniform1f(this.u(s, 'uFoilGlint'), Math.max(0, Math.min(1, num(I.glint, 0.5))))
    gl.uniform1f(this.u(s, 'uCav'), Math.max(0, Math.min(1, num(I.cavity, 0))))
    gl.uniform1f(this.u(s, 'uDisp'), Math.max(0, Math.min(1, num(I.dispersion, 0))))
    gl.uniform1f(this.u(s, 'uRim'), Math.max(0, Math.min(1, num(I.rim, 0))))
    gl.uniform2f(this.u(s, 'uGrid'), this.height!.w, this.height!.h)
    this.draw(out.fbo, W, H)
    for (let i = 3; i >= 0; i--) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null) }
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    const gl = this.gl
    if (this.gen !== glGeneration()) return
    this.free(this.mask)
    if (this.jf) { this.free(this.jf[0]); this.free(this.jf[1]) }
    if (this.press) { this.free(this.press[0]); this.free(this.press[1]) }
    this.free(this.height)
    if (this.progs) for (const p of Object.values(this.progs)) gl.deleteProgram(p)
    if (this.vao) {
      gl.bindVertexArray(this.vao)
      if (this.quad) gl.deleteBuffer(this.quad)
      gl.bindVertexArray(null)
      gl.deleteVertexArray(this.vao)
    }
    if (this.blank) gl.deleteTexture(this.blank)
  }
}
