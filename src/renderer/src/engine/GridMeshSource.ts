// GridMeshSource : the native Grid Mesh generator (id 'gen-gridmesh'). A shape made as
// a grid of vertices, deformed by a still noise field it turns through, and drawn in
// any of twelve draw modes read in the grid's own order (engine/gridMesh.ts : the CPU
// half). Built first to play the OCTOCOSME visuals in Palinopsia (their shards,
// scribbles and slivers come from exactly this, see gridMesh.ts's header), then made a
// general source : another layer as its skin, the sound in its deformation, its real
// depth for the depth readers, framed in the middle of a dome.
//
// How it draws :
// - On the CPU every frame : the shape turned (its spin and its own turn), the noise
//   multiplied in on the noise's grid and crossfaded back, its normals worked out
//   again, and the primitives its draw mode makes; each triangle's facing is read on
//   the CPU too, so its FRONT and BACK can each be filled, lines or points.
// - On the GPU : triangles as they are, lines and points as quads made in the vertex
//   shader (as wide in pixels as asked at 1080 rows; points square, lines with plain
//   ends, as the classic wide lines and points are), lit by two lights with the
//   diffuse and specular models of the classic material set, into its own target
//   (no multisampling : the hard edges are part of the look), cleared to transparent
//   black, with the blend factors asked for (or one of the plain blends : normal, add,
//   screen, lighten, exclusion), then copied into the layer as it is.
// - SKIN : the layer picked as its sidechain, wrapped by the grid's own texture
//   coordinates (s, t : the noise multiplies them too, so the picture tears with the
//   shape) or projected from the front, in place of its color.
// - TRUE DEPTH (depthOut) : the same primitives once more into a small depth picture
//   (nearest white), handed to Parallax, Pulfrich and Luma Blur like the Model's.
//
// Every new input reads as "off" when a session does not carry it (the OCTOCOSME
// session's slots were saved before them) : no skin, no sound, no depth, the blend
// factors as set.
//
// The lighting models, each from its published paper (THIRD_PARTY_NOTICES Part 6) :
// third-party: Grid Mesh lighting models

import { EngineGL, SlotClock, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'
import { audioBus } from './audioIn'
import { Onset } from './touchInput'
import { domeFill } from './domeSignal'
import {
  PLANES, buildGridShape, deformGrid, gridNormals, noiseField, primitives, transformGrid, type Primitives
} from './gridMesh'
import { HitCover, isNoTurn, quatIn, quatMat4 } from './heldObject'

// ── Shaders ──────────────────────────────────────────────────────────────────

const LIGHT = `
uniform vec3 uL1, uL2;          // toward each light, eye space
uniform vec3 uL1c, uL2c;        // their colors (black : off)
uniform vec3 uAmbL;             // the lights' ambient
uniform vec4 uColor;            // the material's diffuse (the mesh color)
uniform vec3 uSpecC, uEmit, uAmbC;
uniform float uShine, uDiffM, uSpecM;
uniform float uToonDS, uToonDSm, uToonSS, uToonSSm, uRough, uDark;
uniform float uLit;
// the skin : another layer, wrapped by the grid's s, t (tiled, scrolled) or from the front
uniform sampler2D uSide;
uniform float uSkin, uSkinMode, uTile, uScrollT;
uniform vec2 uPicRes;
vec3 skinAt(vec2 uv) {
  if (uSkinMode < 0.5) { vec2 w = uv * uTile + vec2(uScrollT, 0.0); return texture(uSide, vec2(fract(w.x), 1.0 - fract(w.y))).rgb; }
  return texture(uSide, gl_FragCoord.xy / uPicRes).rgb;
}
// toon : SIZE is how much of it the light covers (1 : nearly all), SMOOTH how soft its edge is
float toon(float x, float size, float smo) { float e = 1.0 - size, h = max(1e-3, smo) * 0.5; return smoothstep(e - h, e + h, x); }
float diffuseTerm(vec3 N, vec3 L, vec3 V) {
  float nl = max(0.0, dot(N, L));
  if (uDiffM < 0.5) return nl;                                   // Lambert
  if (uDiffM < 1.5) {                                             // Oren-Nayar (qualitative)
    float s2 = uRough * uRough;
    float A = 1.0 - 0.5 * s2 / (s2 + 0.33), B = 0.45 * s2 / (s2 + 0.09);
    float nv = max(0.0, dot(N, V));
    float ti = acos(clamp(nl, 0.0, 1.0)), tr = acos(clamp(nv, 0.0, 1.0));
    vec3 lp = normalize(L - N * nl + 1e-5), vp = normalize(V - N * nv + 1e-5);
    float g = max(0.0, dot(lp, vp));
    return nl * (A + B * g * sin(max(ti, tr)) * tan(min(ti, tr)));
  }
  if (uDiffM < 2.5) return toon(nl, uToonDS, uToonDSm);          // toon
  float k = 1.0 + uDark;                                          // Minnaert
  return pow(nl, k) * pow(max(1e-3, dot(N, V)), k - 1.0);
}
float specTerm(vec3 N, vec3 L, vec3 V) {
  if (dot(N, L) <= 0.0) return 0.0;
  vec3 H = normalize(L + V);
  float sh = max(0.5, uShine);
  float nh = max(0.0, dot(N, H));
  if (uSpecM < 0.5) return pow(nh, sh);                          // Blinn
  if (uSpecM < 1.5) return pow(max(0.0, dot(reflect(-L, N), V)), sh); // Phong
  if (uSpecM < 2.5) return toon(pow(nh, sh), uToonSS, uToonSSm); // toon
  float nl = max(1e-3, dot(N, L)), nv = max(1e-3, dot(N, V));
  if (uSpecM < 3.5) {                                             // Ward (isotropic)
    float a = clamp(1.0 / sh, 0.02, 1.0);
    float t2 = (1.0 - nh * nh) / max(1e-4, nh * nh);
    return nl * exp(-t2 / (a * a)) / (4.0 * 3.14159 * a * a * sqrt(nl * nv));
  }
  float m = clamp(1.0 / sh, 0.03, 1.0);                           // Cook-Torrance
  float c2 = max(nh * nh, 1e-4); // (0 at a silhouette : 0/0)
  float D = exp((c2 - 1.0) / (m * m * c2)) / (3.14159 * m * m * c2 * c2);
  float vh = max(1e-3, dot(V, H));
  float G = min(1.0, min(2.0 * nh * nv / vh, 2.0 * nh * nl / vh));
  float F = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
  return D * G * F / (4.0 * nv);
}
vec4 lit(vec3 N, vec3 V, vec4 vcol, vec2 uv) {
  vec4 base = uColor;
  if (uSkin > 0.0) base.rgb = mix(base.rgb, skinAt(uv), uSkin);
  base *= vcol;
  if (uLit < 0.5) return base;
  vec3 c = uEmit + uAmbL * uAmbC;
  c += uL1c * (diffuseTerm(N, uL1, V) * base.rgb + specTerm(N, uL1, V) * uSpecC);
  c += uL2c * (diffuseTerm(N, uL2, V) * base.rgb + specTerm(N, uL2, V) * uSpecC);
  return vec4(c, base.a);
}`

const TRI_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 p;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec4 aC;
layout(location = 3) in vec2 aUV;
uniform mat4 uMV, uP;
uniform mat3 uNM;
uniform vec2 uOff;
out vec3 vE;
out vec3 vN;
out vec4 vC;
out vec2 vUV;
void main() {
  vec4 e = uMV * vec4(p, 1.0);
  vE = e.xyz;
  vN = uNM * aN;
  vC = aC;
  vUV = aUV;
  gl_Position = uP * e;
  gl_Position.xy += uOff * gl_Position.w;
}`

const TRI_FS = `#version 300 es
precision highp float;
${LIGHT}
uniform float uLevel;
in vec3 vE;
in vec3 vN;
in vec4 vC;
in vec2 vUV;
out vec4 o;
void main() {
  vec3 N = normalize(vN + 1e-6);
  if (!gl_FrontFacing) N = -N;     // both sides lit, as a two-sided material
  vec3 V = normalize(-vE);
  o = lit(N, V, vC, vUV) * uLevel;
}`

// Lines : one quad per segment, from its two ends (instanced), plain square ends.
const SEG_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aA;
layout(location = 1) in vec3 aB;
layout(location = 2) in vec3 aNA;
layout(location = 3) in vec3 aNB;
layout(location = 4) in vec4 aCA;
layout(location = 5) in vec4 aCB;
layout(location = 6) in vec2 aUVA;
layout(location = 7) in vec2 aUVB;
uniform mat4 uMV, uP;
uniform mat3 uNM;
uniform vec2 uOff, uRes;
uniform float uWidth;
out vec3 vE;
out vec3 vN;
out vec4 vC;
out vec2 vUV;
void main() {
  int k = gl_VertexID;
  bool atB = k >= 2;
  vec4 ea = uMV * vec4(aA, 1.0), eb = uMV * vec4(aB, 1.0);
  vec4 ca = uP * ea, cb = uP * eb;
  ca.xy += uOff * ca.w; cb.xy += uOff * cb.w;
  vE = atB ? eb.xyz : ea.xyz;
  vN = uNM * (atB ? aNB : aNA);
  vC = atB ? aCB : aCA;
  vUV = atB ? aUVB : aUVA;
  if (ca.w < 1e-3 || cb.w < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sa = (ca.xy / ca.w * 0.5 + 0.5) * uRes, sb = (cb.xy / cb.w * 0.5 + 0.5) * uRes;
  vec2 d = sb - sa;
  float l = length(d);
  d = l > 1e-3 ? d / l : vec2(1.0, 0.0);
  vec2 nrm = vec2(-d.y, d.x);
  float side = (k == 0 || k == 2) ? -1.0 : 1.0;
  vec4 c = atB ? cb : ca;
  vec2 s = (atB ? sb : sa) + nrm * side * uWidth * 0.5;
  gl_Position = vec4((s / uRes * 2.0 - 1.0) * c.w, c.z, c.w);
}`

// Points : one square per vertex (instanced), its side in pixels.
const PT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aP;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec4 aC;
layout(location = 3) in vec2 aUV;
uniform mat4 uMV, uP;
uniform mat3 uNM;
uniform vec2 uOff, uRes;
uniform float uSize;
out vec3 vE;
out vec3 vN;
out vec4 vC;
out vec2 vUV;
void main() {
  int k = gl_VertexID;
  vec2 corner = vec2((k == 1 || k == 3) ? 1.0 : -1.0, k >= 2 ? 1.0 : -1.0);
  vec4 e = uMV * vec4(aP, 1.0);
  vE = e.xyz;
  vN = uNM * aN;
  vC = aC;
  vUV = aUV;
  vec4 c = uP * e;
  c.xy += uOff * c.w;
  if (c.w < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  c.xy += corner * uSize * 0.5 / uRes * 2.0 * c.w;
  gl_Position = c;
}`

// Lines and points : lit from their vertex's normal (no facing).
const LP_FS = `#version 300 es
precision highp float;
${LIGHT}
uniform float uLevel;
in vec3 vE;
in vec3 vN;
in vec4 vC;
in vec2 vUV;
out vec4 o;
void main() {
  vec3 N = normalize(vN + 1e-6);
  vec3 V = normalize(-vE);
  if (dot(N, V) < 0.0) N = -N;
  o = lit(N, V, vC, vUV) * uLevel;
}`

// TRUE DEPTH : the eye depth over the mesh's own reach, nearest white (as the Model's).
const DEPTH_FS = `#version 300 es
precision highp float;
uniform float uNear0, uFar0;
in vec3 vE;
out vec4 o;
void main() { float d = clamp((uFar0 + vE.z) / max(1e-4, uFar0 - uNear0), 0.0, 1.0); o = vec4(d, d, d, 1.0); }`

// The picture holds its color as it shows over black, with plain coverage in its
// alpha (the alpha blends ONE, 1 − source alpha whatever the color blend). When the
// color was multiplied by its alpha on the way in (uUnpre), it goes to the layer
// divided back (the layer takes straight alpha), so a level or a color alpha counts
// once, as over the black of the classic patch, not twice.
const COPY_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPic;
uniform float uUnpre;
out vec4 o;
void main() {
  vec4 c = texelFetch(uPic, ivec2(gl_FragCoord.xy), 0);
  o = uUnpre > 0.5 ? vec4(c.a > 1e-4 ? c.rgb / c.a : vec3(0.0), c.a) : c;
}`

// ── Matrices (column-major) ──────────────────────────────────────────────────
type M4 = Float32Array
const m4 = (): M4 => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m }
function mul4(a: M4, b: M4): M4 {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
  return o
}
function rotX(t: number): M4 { const m = m4(), c = Math.cos(t), s = Math.sin(t); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m }
function rotY(t: number): M4 { const m = m4(), c = Math.cos(t), s = Math.sin(t); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m }
function rotZ(t: number): M4 { const m = m4(), c = Math.cos(t), s = Math.sin(t); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m }

/** The eight spin axes (x y z turn rates) a single knob steps through. */
export const SPIN_AXES: ReadonlyArray<[number, number, number]> = [
  [0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [2, 2, 2], [1, 1, 1], [1, 0, 1], [0, 1, 1]
]
export const SPIN_AXIS_LABELS = ['still', 'y', 'z', 'x + y', 'all ×2', 'all', 'x + z', 'y + z']

/** The blend factors, in the order the classic GL patching menus number them. */
export const BLEND_FACTORS = [
  'zero', 'one', 'dest color', 'source color', '1 − dest color', '1 − source color',
  'source alpha', '1 − source alpha', 'dest alpha', '1 − dest alpha', 'alpha saturate'
] as const
function glFactor(gl: WebGL2RenderingContext, i: number): number {
  return [gl.ZERO, gl.ONE, gl.DST_COLOR, gl.SRC_COLOR, gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR,
    gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.DST_ALPHA, gl.ONE_MINUS_DST_ALPHA, gl.SRC_ALPHA_SATURATE][Math.max(0, Math.min(10, Math.round(i)))]
}

/** BLEND AS : 0 the two factors as set, then the plain blends a performer reaches for.
 *  Over the transparent black ground the pieces start on, a multiply would stay black,
 *  so the menu offers lighten (the brighter wins) and exclusion (crossings cancel). */
export const BLEND_AS = ['factors', 'normal', 'add', 'screen', 'lighten', 'exclusion'] as const

const POLY_FILL = 0, POLY_LINE = 1, POLY_POINT = 2

/** A float scratch array that grows (kept between frames : no garbage every frame). */
function grow(a: Float32Array<ArrayBuffer>, n: number): Float32Array<ArrayBuffer> { return a.length >= n ? a : new Float32Array(Math.ceil(n * 1.25)) }
function growI(a: Int32Array<ArrayBuffer>, n: number): Int32Array<ArrayBuffer> {
  if (a.length >= n) return a
  const b = new Int32Array(Math.ceil(n * 1.5))
  b.set(a)
  return b
}

export class GridMeshSource implements NativeGenerator {
  private g: EngineGL
  private triP: Prog
  private segP: Prog
  private ptP: Prog
  private copyP: Prog
  private triDP_: Prog | null = null
  private segDP_: Prog | null = null
  private ptDP_: Prog | null = null
  private pic: Target | null = null
  private depthRb: WebGLRenderbuffer | null = null
  private depth: { tex: WebGLTexture; fbo: WebGLFramebuffer; rb: WebGLRenderbuffer; w: number; h: number } | null = null
  private depthReady = false
  private blankTex: WebGLTexture | null = null
  private side: WebGLTexture | null = null
  private inputs: Record<string, number | number[]> = {}
  private clock = new SlotClock()
  // the shape and the noise, kept until what makes them changes
  private shapeKey = ''
  private shape: Float32Array | null = null
  private work = new Float32Array(0)
  private noiseKey = ''
  private noiseDim = 0
  private noiseAt = -1e9
  private noise: Float32Array | null = null
  private primKey = ''
  private prim: Primitives | null = null
  // the spin's own angles (radians)
  private sx = 0
  private sy = 0
  private sz = 0
  // the sound : its level (followed), the hits' push on the noise field, the skin's scroll
  private onset = new Onset()
  private lvl = 0
  private kick = 0
  private scrollT = 0
  // GPU buffers, refilled each frame, and their CPU side (kept, grown when needed)
  private triVao: WebGLVertexArrayObject
  private segVao: WebGLVertexArrayObject
  private ptVao: WebGLVertexArrayObject
  private triBuf: WebGLBuffer
  private segBuf: WebGLBuffer
  private ptBuf: WebGLBuffer
  private tb = new Float32Array(0)
  private sb = new Float32Array(0)
  private pb = new Float32Array(0)
  private tri = new Int32Array(1024)
  private seg = new Int32Array(1024)
  private pts = new Int32Array(1024)
  private nTri = 0
  private nSeg = 0
  private nPt = 0
  private stat = ''
  // where each vertex fell on screen last frame (clip space, and its w), kept for the
  // hand (pointerInput.ts) : what the mesh covers
  private hx = new Float32Array(0)
  private hy = new Float32Array(0)
  private hw = new Float32Array(0)
  private hn = 0
  private hPtR = 0
  private cover = new HitCover()

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    const g = (this.g = new EngineGL(gl, 'gridmesh'))
    this.triP = g.prog(TRI_FS, TRI_VS)
    this.segP = g.prog(LP_FS, SEG_VS)
    this.ptP = g.prog(LP_FS, PT_VS)
    this.copyP = g.prog(COPY_FS)
    // each on its own vertex array (never the default one, which the ISF runtime owns)
    const mk = (stride: number, attrs: Array<[number, number, number]>, inst: boolean): [WebGLVertexArrayObject, WebGLBuffer] => {
      const vao = gl.createVertexArray()!
      gl.bindVertexArray(vao)
      const b = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, b)
      for (const [loc, n, off] of attrs) {
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride * 4, off * 4)
        if (inst) gl.vertexAttribDivisor(loc, 1)
      }
      gl.bindVertexArray(null)
      gl.bindBuffer(gl.ARRAY_BUFFER, null)
      return [vao, b]
    }
    // a vertex : position, normal, color, s t (12 floats); a line : both ends' (24)
    ;[this.triVao, this.triBuf] = mk(12, [[0, 3, 0], [1, 3, 3], [2, 4, 6], [3, 2, 10]], false)
    ;[this.segVao, this.segBuf] = mk(24, [[0, 3, 0], [1, 3, 3], [2, 3, 6], [3, 3, 9], [4, 4, 12], [5, 4, 16], [6, 2, 20], [7, 2, 22]], true)
    ;[this.ptVao, this.ptBuf] = mk(12, [[0, 3, 0], [1, 3, 3], [2, 4, 6], [3, 2, 10]], true)
  }

  // (the depth programs only once TRUE DEPTH is on : less to compile up front)
  private get triDP(): Prog { return (this.triDP_ ??= this.g.prog(DEPTH_FS, TRI_VS)) }
  private get segDP(): Prog { return (this.segDP_ ??= this.g.prog(DEPTH_FS, SEG_VS)) }
  private get ptDP(): Prog { return (this.ptDP_ ??= this.g.prog(DEPTH_FS, PT_VS)) }

  update(inputs: Record<string, number | number[]>): void { this.inputs = { ...inputs } }
  setInput(name: string, value: number | number[]): void { this.inputs[name] = value }
  status(): string { return this.stat }

  /** The layer picked as its skin (its sidechain), every frame before render. */
  feed(_audio: WebGLTexture | null, side: WebGLTexture | null): void { this.side = side }

  /** Its real depth (nearest white), while TRUE DEPTH is on and it has drawn one. */
  depthTexture(): WebGLTexture | null {
    return this.depthReady && num(this.inputs, 'depthOut', 0) > 0.5 ? this.depth?.tex ?? null : null
  }

  private blank(): WebGLTexture {
    const gl = this.g.gl
    if (this.blankTex) return this.blankTex
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.blankTex = t
    return t
  }

  private ensureTarget(): void {
    const gl = this.g.gl
    if (this.pic) return
    this.pic = this.g.target(this.w, this.h, { float: false })
    this.depthRb = gl.createRenderbuffer()!
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.w, this.h)
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pic.fbo)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** The depth picture : the depth readers read it filtered and coarse, half size, at
   *  most 1024 a side (as the Model's). */
  private ensureDepth(): void {
    if (this.depth) return
    const gl = this.g.gl
    const k = Math.min(0.5, 1024 / Math.max(this.w, this.h))
    const dw = Math.max(16, Math.round(this.w * k)), dh = Math.max(16, Math.round(this.h * k))
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, dw, dh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
    const rb = gl.createRenderbuffer()!
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, dw, dh)
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.depth = { tex, fbo, rb, w: dw, h: dh }
  }

  private freeDepth(): void {
    if (!this.depth) return
    const gl = this.g.gl
    gl.deleteFramebuffer(this.depth.fbo)
    gl.deleteRenderbuffer(this.depth.rb)
    gl.deleteTexture(this.depth.tex)
    this.depth = null
  }

  /** The sound this frame : its level followed (a quick rise, a slow fall) for AUDIO,
   *  and each hit pushing the noise field along for HITS. */
  private listen(dt: number): void {
    const I = this.inputs
    const amt = Math.max(0, Math.min(1, num(I, 'audio', 0)))
    const to = amt > 0 ? Math.min(1, audioBus.feature('level') * 1.6) : 0
    this.lvl += (to - this.lvl) * (1 - Math.exp(-dt / (to > this.lvl ? 0.04 : 0.3)))
    const hits = Math.max(0, Math.min(1, num(I, 'hits', 0)))
    const hit = this.onset.hit() // (read every frame : its edge must not go stale)
    if (hits > 0 && hit > 0) this.kick = (this.kick + hit * hits * 1.7) % 1000
  }

  /** The grid this frame, with the noise in it, and its primitives. */
  private build(dt: number): { grid: Float32Array; nx: number; ny: number } {
    const I = this.inputs
    const shapeI = Math.round(num(I, 'shape', 9))
    const nx = Math.max(2, Math.min(256, Math.round(num(I, 'dimX', 40))))
    const ny = Math.max(2, Math.min(256, Math.round(num(I, 'dimY', 40))))
    const sk = `${shapeI}:${nx}:${ny}`
    if (sk !== this.shapeKey || !this.shape) { this.shape = buildGridShape(shapeI, nx, ny); this.shapeKey = sk }

    // the spin (its axes times its speed, degrees a second)
    const axes = SPIN_AXES[Math.max(0, Math.min(7, Math.round(num(I, 'spinAxes', 5))))]
    const sp = (num(I, 'spinSpeed', 10) * Math.PI) / 180
    const TWO = Math.PI * 2
    this.sx = (this.sx + axes[0] * sp * dt) % TWO
    this.sy = (this.sy + axes[1] * sp * dt) % TWO
    this.sz = (this.sz + axes[2] * sp * dt) % TWO

    // (a copy kept from frame to frame : the shape stays as built)
    if (this.work.length !== this.shape.length) this.work = new Float32Array(this.shape.length)
    const grid = this.work
    grid.set(this.shape)
    const inside = num(I, 'noiseStill', 1) > 0.5 // the shape turns inside the still noise
    const D = Math.PI / 180
    const rot: [number, number, number] = [this.sx + num(I, 'shapeRotX', 0) * D, this.sy + num(I, 'shapeRotY', 0) * D, this.sz + num(I, 'shapeRotZ', 0) * D]
    const scl: [number, number, number] = [num(I, 'scaleX', 1), num(I, 'scaleY', 1), num(I, 'scaleZ', 1)]
    if (inside) transformGrid(grid, rot, scl)

    // the sound swells the deformation : its level adds up to 2 to BLEND at AUDIO 1
    const blend = num(I, 'noiseBlend', 1.5) + this.lvl * Math.max(0, Math.min(1, num(I, 'audio', 0))) * 2
    let out: Float32Array = grid
    if (blend !== 0) {
      const nd = Math.max(2, Math.min(64, Math.round(num(I, 'noiseGrid', 20))))
      // (the hits push the field along a fixed diagonal : each one a new place)
      const kx = this.kick, ky = this.kick * 0.61, kz = this.kick * 0.37
      const nk = [num(I, 'noiseBasis', 6), nd, num(I, 'noiseScale', 0.9), num(I, 'noiseX', 0) + kx, num(I, 'noiseY', 0) + ky, num(I, 'noiseZ', 0) + kz, num(I, 'noiseFlip', 0), num(I, 'noiseSize', 1.8)]
        .map((v) => Math.round(v * 1000) / 1000).join(':')
      // A new field costs 1 to 45 ms on this thread (the basis, the grid) : while its
      // key keeps moving (a modulated offset, a Morph, the hits) it is rebuilt at
      // most every 50 ms, the last one kept meanwhile (a new grid size : at once).
      const now = performance.now()
      if (!this.noise || nd !== this.noiseDim || (nk !== this.noiseKey && now - this.noiseAt >= 50)) {
        this.noiseAt = now
        this.noiseDim = nd
        const flip = num(I, 'noiseFlip', 0) > 0.5 ? -1 : 1
        this.noise = noiseField({
          basis: Math.round(num(I, 'noiseBasis', 6)), dim: nd, scale: num(I, 'noiseScale', 0.9),
          origin: [num(I, 'noiseX', 0) + kx, num(I, 'noiseY', 0) + ky, num(I, 'noiseZ', 0) + kz], weight: [flip, flip, flip], size: num(I, 'noiseSize', 1.8)
        })
        this.noiseKey = nk
      }
      out = deformGrid(grid, nx, ny, this.noise, nd, blend)
    }
    if (!inside) transformGrid(out, rot, scl)
    if (num(I, 'autoNormals', 1) > 0.5) gridNormals(out, nx, ny)
    // the noise in the colors : 1 as the chain leaves them (grey patches), 0 plain
    const nc = Math.max(0, Math.min(1, num(I, 'noiseColor', 0.5)))
    if (nc < 1) for (let o = 8; o < out.length; o += PLANES) for (let c = 0; c < 4; c++) out[o + c] = 1 + (out[o + c] - 1) * nc
    return { grid: out, nx, ny }
  }

  render(targetFbo: WebGLFramebuffer, clockSec: number): void {
    const g = this.g, gl = g.gl
    const clear = (): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }
    if (!g.ok) { clear(); return }
    const I = this.inputs
    const dt = this.clock.tick(clockSec)
    this.listen(dt)
    const { grid, nx, ny } = this.build(dt)

    // ── camera and the mesh's own place (after the noise) ──
    // Under full-dome fill the frame is kept square (the fill spreads it over one
    // circle) and the camera stands back, so the mesh sits round in the middle of the
    // dome, clear of the bent rim (the stretch rule; never re-projected).
    const fill = domeFill() > 0
    const D = Math.PI / 180
    const size = Math.max(0.01, num(I, 'size', 1.2))
    const S = m4(); S[0] = S[5] = S[10] = size
    const dist = Math.max(0.1, num(I, 'distance', 22)) * (fill ? 1.5 : 1)
    const T = m4(); T[12] = num(I, 'posX', 0); T[13] = num(I, 'posY', 0); T[14] = -dist
    const R0 = mul4(mul4(rotX(num(I, 'tilt', 0) * D), rotY(num(I, 'turn', 0) * D)), rotZ(num(I, 'roll', 0) * D))
    // how the hand holds it (dragged on the preview) : the outermost turn, in the
    // camera's own axes, round its center (the lights stay where they are)
    const held = quatIn(I['orient'])
    const R = isNoTurn(held) ? R0 : mul4(quatMat4(held), R0)
    const MV = mul4(T, mul4(R, S))
    const asp = fill ? 1 : this.w / Math.max(1, this.h)
    const fov = Math.max(1, Math.min(170, num(I, 'lens', 15))) * D
    const f = 1 / Math.tan(fov / 2)
    const near = 0.1, far = 10000
    const Pm = new Float32Array(16)
    Pm[0] = f / asp; Pm[5] = f; Pm[10] = (far + near) / (near - far); Pm[11] = -1; Pm[14] = (2 * far * near) / (near - far)
    const NM = new Float32Array([R[0], R[1], R[2], R[4], R[5], R[6], R[8], R[9], R[10]])
    const MVP = mul4(Pm, MV)

    // ── the primitives, each triangle's facing read here ──
    const mode = Math.max(0, Math.min(11, Math.round(num(I, 'drawMode', 0))))
    const pk = `${mode}:${nx}:${ny}`
    if (pk !== this.primKey || !this.prim) { this.prim = primitives(mode, nx, ny); this.primKey = pk }
    const prim = this.prim
    const polyF = Math.round(num(I, 'polyFront', POLY_FILL)), polyB = Math.round(num(I, 'polyBack', POLY_FILL))
    const n = nx * ny
    if (this.hx.length < n) { this.hx = new Float32Array(n); this.hy = new Float32Array(n); this.hw = new Float32Array(n) }
    const sx = this.hx, sy = this.hy, sws = this.hw
    this.hn = n
    this.hPtR = (Math.max(1, num(I, 'pointSize', 4)) / 1080) * 0.5
    let reach2 = 0 // the mesh's reach from its center, squared (for its depth's range)
    for (let k = 0; k < n; k++) {
      const o = k * PLANES, x = grid[o], y = grid[o + 1], z = grid[o + 2]
      const r2 = x * x + y * y + z * z
      if (r2 > reach2) reach2 = r2
      const sw = MVP[3] * x + MVP[7] * y + MVP[11] * z + MVP[15]
      const iw = Math.abs(sw) > 1e-6 ? 1 / sw : 0
      sws[k] = sw
      sx[k] = (MVP[0] * x + MVP[4] * y + MVP[8] * z + MVP[12]) * iw
      sy[k] = (MVP[1] * x + MVP[5] * y + MVP[9] * z + MVP[13]) * iw
    }
    // (the most the lists can hold this frame : every triangle as three lines)
    const nT = prim.tris.length
    this.tri = growI(this.tri, nT)
    this.seg = growI(this.seg, nT * 2 + prim.segs.length)
    this.pts = growI(this.pts, nT + prim.pts.length)
    const tri = this.tri, seg = this.seg, pts = this.pts
    let nTri = 0, nSegV = 0, nPt = 0
    for (let t = 0; t < nT; t += 3) {
      const a = prim.tris[t], b = prim.tris[t + 1], c = prim.tris[t + 2]
      const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a])
      const pm = area >= 0 ? polyF : polyB
      if (pm === POLY_FILL) { tri[nTri++] = a; tri[nTri++] = b; tri[nTri++] = c }
      else if (pm === POLY_LINE) { seg[nSegV++] = a; seg[nSegV++] = b; seg[nSegV++] = b; seg[nSegV++] = c; seg[nSegV++] = c; seg[nSegV++] = a }
      else { pts[nPt++] = a; pts[nPt++] = b; pts[nPt++] = c }
    }
    for (const v of prim.segs) seg[nSegV++] = v
    for (const v of prim.pts) pts[nPt++] = v

    // ── into the buffers ──
    const put12 = (arr: Float32Array, at: number, k: number): void => {
      const o = k * PLANES
      arr[at] = grid[o]; arr[at + 1] = grid[o + 1]; arr[at + 2] = grid[o + 2]
      arr[at + 3] = grid[o + 5]; arr[at + 4] = grid[o + 6]; arr[at + 5] = grid[o + 7]
      arr[at + 6] = grid[o + 8]; arr[at + 7] = grid[o + 9]; arr[at + 8] = grid[o + 10]; arr[at + 9] = grid[o + 11]
      arr[at + 10] = grid[o + 3]; arr[at + 11] = grid[o + 4]
    }
    const tb = (this.tb = grow(this.tb, nTri * 12))
    for (let i = 0; i < nTri; i++) put12(tb, i * 12, tri[i])
    const nSeg = nSegV / 2
    const sb = (this.sb = grow(this.sb, nSeg * 24))
    for (let i = 0; i < nSegV; i += 2) {
      const at = (i / 2) * 24, oa = seg[i] * PLANES, ob = seg[i + 1] * PLANES
      sb[at] = grid[oa]; sb[at + 1] = grid[oa + 1]; sb[at + 2] = grid[oa + 2]
      sb[at + 3] = grid[ob]; sb[at + 4] = grid[ob + 1]; sb[at + 5] = grid[ob + 2]
      sb[at + 6] = grid[oa + 5]; sb[at + 7] = grid[oa + 6]; sb[at + 8] = grid[oa + 7]
      sb[at + 9] = grid[ob + 5]; sb[at + 10] = grid[ob + 6]; sb[at + 11] = grid[ob + 7]
      for (let c = 0; c < 4; c++) { sb[at + 12 + c] = grid[oa + 8 + c]; sb[at + 16 + c] = grid[ob + 8 + c] }
      sb[at + 20] = grid[oa + 3]; sb[at + 21] = grid[oa + 4]; sb[at + 22] = grid[ob + 3]; sb[at + 23] = grid[ob + 4]
    }
    const pb = (this.pb = grow(this.pb, nPt * 12))
    for (let i = 0; i < nPt; i++) put12(pb, i * 12, pts[i])
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuf); gl.bufferData(gl.ARRAY_BUFFER, tb, gl.DYNAMIC_DRAW, 0, nTri * 12)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf); gl.bufferData(gl.ARRAY_BUFFER, sb, gl.DYNAMIC_DRAW, 0, nSeg * 24)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ptBuf); gl.bufferData(gl.ARRAY_BUFFER, pb, gl.DYNAMIC_DRAW, 0, nPt * 12)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    this.nTri = nTri; this.nSeg = nSeg; this.nPt = nPt
    this.stat = `${nx}×${ny} · ${this.nTri / 3} triangles · ${this.nSeg} lines · ${this.nPt} points`

    // ── draw ──
    this.ensureTarget()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pic!.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.colorMask(true, true, true, true)
    gl.depthMask(true)
    gl.clearColor(0, 0, 0, 0)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.STENCIL_TEST)
    if (num(I, 'depthTest', 1) > 0.5) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL) } else gl.disable(gl.DEPTH_TEST)
    // the color blends as asked; the alpha always ONE, 1 − source alpha : it keeps
    // plain coverage (a level or color alpha multiplied in once), and the copy
    // below divides the color back when its source factor took the alpha in
    let unpre = false
    if (num(I, 'blendOn', 1) > 0.5) {
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      const blend = (src: number, dst: number): void => {
        gl.blendFuncSeparate(src, dst, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        unpre = src === gl.SRC_ALPHA || src === gl.SRC_ALPHA_SATURATE
      }
      switch (Math.round(num(I, 'blendMode', 0))) {
        case 1: blend(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); break // normal
        case 2: blend(gl.SRC_ALPHA, gl.ONE); break // add
        case 3: blend(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break // screen
        case 4: gl.blendEquation(gl.MAX); break // lighten
        case 5: blend(gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR); break // exclusion
        default: blend(glFactor(gl, num(I, 'blendSrc', 6)), glFactor(gl, num(I, 'blendDst', 7)))
      }
    } else gl.disable(gl.BLEND)

    const lightDir = (az: number, el: number): [number, number, number] => {
      const a = az * D, e = el * D
      return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]
    }
    const [c1r, c1g, c1b] = col(I, 'light1Color', [1, 1, 1])
    const [c2r, c2g, c2b] = col(I, 'light2Color', [0.2, 0.25, 0.4])
    const l1 = lightDir(num(I, 'light1Az', 30), num(I, 'light1El', 30))
    const l2 = lightDir(num(I, 'light2Az', -60), num(I, 'light2El', 10))
    const [cr, cg, cb] = col(I, 'color', [1, 1, 1])
    const ca = (() => { const v = I['color']; return Array.isArray(v) && v.length >= 4 ? v[3] : 1 })()
    const [spr, spg, spb] = col(I, 'specularColor', [0, 0, 0])
    const [er, eg, eb] = col(I, 'emission', [0, 0, 0])
    const [ar, ag, ab] = col(I, 'ambientColor', [0, 0, 0])
    const amb = Math.max(0, num(I, 'ambient', 0.2))
    const level = Math.max(0, num(I, 'level', 1))
    // the skin : only with a layer picked to wear (else none, whatever SKIN says)
    const skin = this.side ? Math.max(0, Math.min(1, num(I, 'skin', 0))) : 0
    this.scrollT = (this.scrollT + num(I, 'scroll', 0) * dt * 0.1) % 1
    g.bind(3, this.side ?? this.blank())
    const setCommon = (p: Prog): Prog => {
      gl.uniformMatrix4fv(p.u('uMV'), false, MV)
      gl.uniformMatrix4fv(p.u('uP'), false, Pm)
      gl.uniformMatrix3fv(p.u('uNM'), false, NM)
      return p.f2('uOff', 0, 0).f2('uRes', this.w, this.h)
        .f3('uL1', l1[0], l1[1], l1[2]).f3('uL2', l2[0], l2[1], l2[2])
        .f3('uL1c', c1r, c1g, c1b).f3('uL2c', c2r, c2g, c2b).f3('uAmbL', amb, amb, amb)
        .f4('uColor', cr, cg, cb, ca).f3('uSpecC', spr, spg, spb).f3('uEmit', er, eg, eb).f3('uAmbC', ar, ag, ab)
        .f1('uShine', num(I, 'shininess', 2)).f1('uDiffM', Math.round(num(I, 'diffuseModel', 0))).f1('uSpecM', Math.round(num(I, 'specularModel', 0)))
        .f1('uToonDS', num(I, 'toonDiffSize', 0.5)).f1('uToonDSm', num(I, 'toonDiffSmooth', 0.05))
        .f1('uToonSS', num(I, 'toonSpecSize', 0.5)).f1('uToonSSm', num(I, 'toonSpecSmooth', 0.05))
        .f1('uRough', num(I, 'roughness', 0.3)).f1('uDark', num(I, 'darkness', 0.5))
        .f1('uLit', num(I, 'lighting', 1) > 0.5 ? 1 : 0).f1('uLevel', level)
        .f1('uSkin', skin).f1('uSkinMode', Math.round(num(I, 'skinMode', 0))).f1('uTile', Math.max(0.05, num(I, 'tile', 1)))
        .f1('uScrollT', this.scrollT).f2('uPicRes', this.w, this.h).i1('uSide', 3)
    }
    const px = this.h / 1080
    const drawAll = (tp: Prog, sp: Prog, pp: Prog, set: (p: Prog) => Prog, pxk: number): void => {
      if (this.nTri) {
        set(tp.use())
        gl.bindVertexArray(this.triVao)
        gl.drawArrays(gl.TRIANGLES, 0, this.nTri)
      }
      if (this.nSeg) {
        set(sp.use()).f1('uWidth', Math.max(1, num(I, 'lineWidth', 1) * pxk))
        gl.bindVertexArray(this.segVao)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nSeg)
      }
      if (this.nPt) {
        set(pp.use()).f1('uSize', Math.max(1, num(I, 'pointSize', 4) * pxk))
        gl.bindVertexArray(this.ptVao)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nPt)
      }
    }
    drawAll(this.triP, this.segP, this.ptP, setCommon, px)
    gl.disable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ZERO)

    // ── its real depth, for the depth readers : nearest white over its own reach ──
    this.depthReady = false
    if (num(I, 'depthOut', 0) > 0.5) {
      this.ensureDepth()
      const d = this.depth!
      const reach = Math.sqrt(reach2) * size
      const near0 = dist - reach, far0 = dist + reach
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo)
      gl.viewport(0, 0, d.w, d.h)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LESS)
      const setDepth = (p: Prog): Prog => {
        gl.uniformMatrix4fv(p.u('uMV'), false, MV)
        gl.uniformMatrix4fv(p.u('uP'), false, Pm)
        gl.uniformMatrix3fv(p.u('uNM'), false, NM)
        return p.f2('uOff', 0, 0).f2('uRes', d.w, d.h).f1('uNear0', near0).f1('uFar0', far0)
      }
      drawAll(this.triDP, this.segDP, this.ptDP, setDepth, d.h / 1080)
      this.depthReady = true
    } else if (this.depth) this.freeDepth()
    gl.bindVertexArray(null)
    gl.disable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)

    // ── into the layer, as it is ──
    this.copyP.use().i1('uPic', 0).f1('uUnpre', unpre ? 1 : 0)
    g.bind(0, this.pic!.tex)
    g.draw(targetFbo, this.w, this.h)
    g.done(4)
  }

  /** Is the frame point (u, v : 0..1, v up) on the mesh as it drew its last frame
   *  (pointerInput.ts : the hand grabs what is under it, the wheel zooms it). Every
   *  triangle its draw mode makes counts (whether drawn filled, as lines or points :
   *  a wireframe is held by its whole shape), and its lines and points. */
  hitTest(u: number, v: number): boolean {
    const prim = this.prim
    if (!prim || !this.hn) return false
    if (this.cover.stale()) {
      const c = this.cover, x = this.hx, y = this.hy, w = this.hw
      c.begin(this.w / Math.max(1, this.h))
      const ok = (k: number): boolean => k < this.hn && w[k] > 1e-3
      const T = prim.tris
      for (let t = 0; t + 2 < T.length; t += 3) {
        const a = T[t], b = T[t + 1], d = T[t + 2]
        if (ok(a) && ok(b) && ok(d)) c.tri(x[a], y[a], x[b], y[b], x[d], y[d])
      }
      const S = prim.segs
      for (let t = 0; t + 1 < S.length; t += 2) if (ok(S[t]) && ok(S[t + 1])) c.seg(x[S[t]], y[S[t]], x[S[t + 1]], y[S[t + 1]])
      for (const k of prim.pts) if (ok(k)) c.dot(x[k], y[k], this.hPtR)
    }
    return this.cover.hit(u, v)
  }

  dispose(): void {
    const g = this.g, gl = g.gl
    for (const [vao, b] of [[this.triVao, this.triBuf], [this.segVao, this.segBuf], [this.ptVao, this.ptBuf]] as const) {
      gl.bindVertexArray(vao)
      gl.deleteBuffer(b)
      gl.bindVertexArray(null)
      gl.deleteVertexArray(vao)
    }
    g.freeTarget(this.pic)
    this.pic = null
    if (this.depthRb) gl.deleteRenderbuffer(this.depthRb)
    this.depthRb = null
    this.freeDepth()
    if (this.blankTex) gl.deleteTexture(this.blankTex)
    this.blankTex = null
    g.dispose()
  }
}
