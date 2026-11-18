// GridMeshSource : the native Grid Mesh generator (id 'gen-gridmesh'). A shape made as
// a grid of vertices, deformed by a still noise field it turns through, and drawn in
// any of twelve draw modes read in the grid's own order (engine/gridMesh.ts : the CPU
// half). Built to play the OCTOCOSME visuals in Palinopsia : their shards, scribbles
// and slivers come from exactly this (see gridMesh.ts's header).
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
//   black, with the blend factors asked for, then copied into the layer as it is.
//
// The lighting models, each from its published paper (THIRD_PARTY_NOTICES Part 6) :
// third-party: Grid Mesh lighting models

import { EngineGL, SlotClock, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'
import {
  PLANES, buildGridShape, deformGrid, gridNormals, noiseField, primitives, transformGrid, type Primitives
} from './gridMesh'

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
  float c2 = nh * nh;
  float D = exp((c2 - 1.0) / (m * m * c2)) / (3.14159 * m * m * c2 * c2);
  float vh = max(1e-3, dot(V, H));
  float G = min(1.0, min(2.0 * nh * nv / vh, 2.0 * nh * nl / vh));
  float F = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
  return D * G * F / (4.0 * nv);
}
vec4 lit(vec3 N, vec3 V, vec4 vcol) {
  vec4 base = uColor * vcol;
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
uniform mat4 uMV, uP;
uniform mat3 uNM;
uniform vec2 uOff;
out vec3 vE;
out vec3 vN;
out vec4 vC;
void main() {
  vec4 e = uMV * vec4(p, 1.0);
  vE = e.xyz;
  vN = uNM * aN;
  vC = aC;
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
out vec4 o;
void main() {
  vec3 N = normalize(vN + 1e-6);
  if (!gl_FrontFacing) N = -N;     // both sides lit, as a two-sided material
  vec3 V = normalize(-vE);
  o = lit(N, V, vC) * uLevel;
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
uniform mat4 uMV, uP;
uniform mat3 uNM;
uniform vec2 uOff, uRes;
uniform float uWidth;
out vec3 vE;
out vec3 vN;
out vec4 vC;
void main() {
  int k = gl_VertexID;
  bool atB = k >= 2;
  vec4 ea = uMV * vec4(aA, 1.0), eb = uMV * vec4(aB, 1.0);
  vec4 ca = uP * ea, cb = uP * eb;
  ca.xy += uOff * ca.w; cb.xy += uOff * cb.w;
  vE = atB ? eb.xyz : ea.xyz;
  vN = uNM * (atB ? aNB : aNA);
  vC = atB ? aCB : aCA;
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
uniform mat4 uMV, uP;
uniform mat3 uNM;
uniform vec2 uOff, uRes;
uniform float uSize;
out vec3 vE;
out vec3 vN;
out vec4 vC;
void main() {
  int k = gl_VertexID;
  vec2 corner = vec2((k == 1 || k == 3) ? 1.0 : -1.0, k >= 2 ? 1.0 : -1.0);
  vec4 e = uMV * vec4(aP, 1.0);
  vE = e.xyz;
  vN = uNM * aN;
  vC = aC;
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
out vec4 o;
void main() {
  vec3 N = normalize(vN + 1e-6);
  vec3 V = normalize(-vE);
  if (dot(N, V) < 0.0) N = -N;
  o = lit(N, V, vC) * uLevel;
}`

const COPY_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPic;
out vec4 o;
void main() { o = texelFetch(uPic, ivec2(gl_FragCoord.xy), 0); }`

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
  'zero', 'one', 'dst color', 'src color', 'one − dst color', 'one − src color',
  'src alpha', 'one − src alpha', 'dst alpha', 'one − dst alpha', 'src alpha saturate'
] as const
function glFactor(gl: WebGL2RenderingContext, i: number): number {
  return [gl.ZERO, gl.ONE, gl.DST_COLOR, gl.SRC_COLOR, gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR,
    gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.DST_ALPHA, gl.ONE_MINUS_DST_ALPHA, gl.SRC_ALPHA_SATURATE][Math.max(0, Math.min(10, Math.round(i)))]
}

const POLY_FILL = 0, POLY_LINE = 1, POLY_POINT = 2

export class GridMeshSource implements NativeGenerator {
  private g: EngineGL
  private triP: Prog
  private segP: Prog
  private ptP: Prog
  private copyP: Prog
  private pic: Target | null = null
  private depthRb: WebGLRenderbuffer | null = null
  private inputs: Record<string, number | number[]> = {}
  private clock = new SlotClock()
  // the shape and the noise, kept until what makes them changes
  private shapeKey = ''
  private shape: Float32Array | null = null
  private noiseKey = ''
  private noise: Float32Array | null = null
  private primKey = ''
  private prim: Primitives | null = null
  // the spin's own angles (radians)
  private sx = 0
  private sy = 0
  private sz = 0
  // GPU buffers, refilled each frame
  private triVao: WebGLVertexArrayObject
  private segVao: WebGLVertexArrayObject
  private ptVao: WebGLVertexArrayObject
  private triBuf: WebGLBuffer
  private segBuf: WebGLBuffer
  private ptBuf: WebGLBuffer
  private nTri = 0
  private nSeg = 0
  private nPt = 0
  private stat = ''

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
    ;[this.triVao, this.triBuf] = mk(10, [[0, 3, 0], [1, 3, 3], [2, 4, 6]], false)
    ;[this.segVao, this.segBuf] = mk(20, [[0, 3, 0], [1, 3, 3], [2, 3, 6], [3, 3, 9], [4, 4, 12], [5, 4, 16]], true)
    ;[this.ptVao, this.ptBuf] = mk(10, [[0, 3, 0], [1, 3, 3], [2, 4, 6]], true)
  }

  update(inputs: Record<string, number | number[]>): void { this.inputs = { ...inputs } }
  setInput(name: string, value: number | number[]): void { this.inputs[name] = value }
  status(): string { return this.stat }

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

    const grid = this.shape.slice()
    const inside = num(I, 'noiseStill', 1) > 0.5 // the shape turns inside the still noise
    const D = Math.PI / 180
    const rot: [number, number, number] = [this.sx + num(I, 'shapeRotX', 0) * D, this.sy + num(I, 'shapeRotY', 0) * D, this.sz + num(I, 'shapeRotZ', 0) * D]
    const scl: [number, number, number] = [num(I, 'scaleX', 1), num(I, 'scaleY', 1), num(I, 'scaleZ', 1)]
    if (inside) transformGrid(grid, rot, scl)

    const blend = num(I, 'noiseBlend', 0)
    let out: Float32Array = grid
    if (blend !== 0) {
      const nd = Math.max(2, Math.min(64, Math.round(num(I, 'noiseGrid', 20))))
      const nk = [num(I, 'noiseBasis', 6), nd, num(I, 'noiseScale', 1), num(I, 'noiseX', 0), num(I, 'noiseY', 0), num(I, 'noiseZ', 0), num(I, 'noiseFlip', 0), num(I, 'noiseSize', 1)]
        .map((v) => Math.round(v * 1000) / 1000).join(':')
      if (nk !== this.noiseKey || !this.noise) {
        const flip = num(I, 'noiseFlip', 0) > 0.5 ? -1 : 1
        this.noise = noiseField({
          basis: Math.round(num(I, 'noiseBasis', 6)), dim: nd, scale: num(I, 'noiseScale', 1),
          origin: [num(I, 'noiseX', 0), num(I, 'noiseY', 0), num(I, 'noiseZ', 0)], weight: [flip, flip, flip], size: num(I, 'noiseSize', 1)
        })
        this.noiseKey = nk
      }
      out = deformGrid(grid, nx, ny, this.noise, nd, blend)
    }
    if (!inside) transformGrid(out, rot, scl)
    if (num(I, 'autoNormals', 1) > 0.5) gridNormals(out, nx, ny)
    // the noise in the colors : 1 as the chain leaves them (grey patches), 0 plain
    const nc = Math.max(0, Math.min(1, num(I, 'noiseColor', 1)))
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
    const { grid, nx, ny } = this.build(dt)

    // ── camera and the mesh's own place (after the noise) ──
    const D = Math.PI / 180
    const size = Math.max(0.01, num(I, 'size', 1))
    const S = m4(); S[0] = S[5] = S[10] = size
    const T = m4(); T[12] = num(I, 'posX', 0); T[13] = num(I, 'posY', 0); T[14] = -Math.max(0.1, num(I, 'distance', 22))
    const R = mul4(mul4(rotX(num(I, 'tilt', 0) * D), rotY(num(I, 'turn', 0) * D)), rotZ(num(I, 'roll', 0) * D))
    const MV = mul4(T, mul4(R, S))
    const asp = this.w / Math.max(1, this.h)
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
    const sx = new Float32Array(n), sy = new Float32Array(n), sw = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      const o = k * PLANES, x = grid[o], y = grid[o + 1], z = grid[o + 2]
      sw[k] = MVP[3] * x + MVP[7] * y + MVP[11] * z + MVP[15]
      const iw = Math.abs(sw[k]) > 1e-6 ? 1 / sw[k] : 0
      sx[k] = (MVP[0] * x + MVP[4] * y + MVP[8] * z + MVP[12]) * iw
      sy[k] = (MVP[1] * x + MVP[5] * y + MVP[9] * z + MVP[13]) * iw
    }
    const tri: number[] = [], seg: number[] = [], pts: number[] = []
    for (let t = 0; t < prim.tris.length; t += 3) {
      const a = prim.tris[t], b = prim.tris[t + 1], c = prim.tris[t + 2]
      const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a])
      const pm = area >= 0 ? polyF : polyB
      if (pm === POLY_FILL) tri.push(a, b, c)
      else if (pm === POLY_LINE) seg.push(a, b, b, c, c, a)
      else pts.push(a, b, c)
    }
    for (const v of prim.segs) seg.push(v)
    for (const v of prim.pts) pts.push(v)

    // ── into the buffers ──
    const put10 = (arr: Float32Array, at: number, k: number): void => {
      const o = k * PLANES
      arr[at] = grid[o]; arr[at + 1] = grid[o + 1]; arr[at + 2] = grid[o + 2]
      arr[at + 3] = grid[o + 5]; arr[at + 4] = grid[o + 6]; arr[at + 5] = grid[o + 7]
      arr[at + 6] = grid[o + 8]; arr[at + 7] = grid[o + 9]; arr[at + 8] = grid[o + 10]; arr[at + 9] = grid[o + 11]
    }
    const tb = new Float32Array(tri.length * 10)
    for (let i = 0; i < tri.length; i++) put10(tb, i * 10, tri[i])
    const sb = new Float32Array((seg.length / 2) * 20)
    for (let i = 0; i < seg.length; i += 2) {
      const at = (i / 2) * 20, oa = seg[i] * PLANES, ob = seg[i + 1] * PLANES
      sb[at] = grid[oa]; sb[at + 1] = grid[oa + 1]; sb[at + 2] = grid[oa + 2]
      sb[at + 3] = grid[ob]; sb[at + 4] = grid[ob + 1]; sb[at + 5] = grid[ob + 2]
      sb[at + 6] = grid[oa + 5]; sb[at + 7] = grid[oa + 6]; sb[at + 8] = grid[oa + 7]
      sb[at + 9] = grid[ob + 5]; sb[at + 10] = grid[ob + 6]; sb[at + 11] = grid[ob + 7]
      for (let c = 0; c < 4; c++) { sb[at + 12 + c] = grid[oa + 8 + c]; sb[at + 16 + c] = grid[ob + 8 + c] }
    }
    const pb = new Float32Array(pts.length * 10)
    for (let i = 0; i < pts.length; i++) put10(pb, i * 10, pts[i])
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuf); gl.bufferData(gl.ARRAY_BUFFER, tb, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf); gl.bufferData(gl.ARRAY_BUFFER, sb, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ptBuf); gl.bufferData(gl.ARRAY_BUFFER, pb, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    this.nTri = tri.length; this.nSeg = seg.length / 2; this.nPt = pts.length
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
    if (num(I, 'blendOn', 1) > 0.5) {
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      gl.blendFunc(glFactor(gl, num(I, 'blendSrc', 6)), glFactor(gl, num(I, 'blendDst', 7)))
    } else gl.disable(gl.BLEND)

    const lightDir = (az: number, el: number): [number, number, number] => {
      const a = az * D, e = el * D
      return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]
    }
    const [c1r, c1g, c1b] = col(I, 'light1Color', [1, 1, 1])
    const [c2r, c2g, c2b] = col(I, 'light2Color', [0, 0, 0])
    const l1 = lightDir(num(I, 'light1Az', 30), num(I, 'light1El', 30))
    const l2 = lightDir(num(I, 'light2Az', -60), num(I, 'light2El', 10))
    const [cr, cg, cb] = col(I, 'color', [1, 1, 1])
    const ca = (() => { const v = I['color']; return Array.isArray(v) && v.length >= 4 ? v[3] : 1 })()
    const [spr, spg, spb] = col(I, 'specularColor', [0, 0, 0])
    const [er, eg, eb] = col(I, 'emission', [0, 0, 0])
    const [ar, ag, ab] = col(I, 'ambientColor', [0, 0, 0])
    const amb = Math.max(0, num(I, 'ambient', 0.2))
    const level = Math.max(0, num(I, 'level', 1))
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
    }
    const px = this.h / 1080
    if (this.nTri) {
      setCommon(this.triP.use())
      gl.bindVertexArray(this.triVao)
      gl.drawArrays(gl.TRIANGLES, 0, this.nTri)
    }
    if (this.nSeg) {
      setCommon(this.segP.use()).f1('uWidth', Math.max(1, num(I, 'lineWidth', 1) * px))
      gl.bindVertexArray(this.segVao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nSeg)
    }
    if (this.nPt) {
      setCommon(this.ptP.use()).f1('uSize', Math.max(1, num(I, 'pointSize', 2) * px))
      gl.bindVertexArray(this.ptVao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nPt)
    }
    gl.bindVertexArray(null)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)

    // ── into the layer, as it is ──
    this.copyP.use().i1('uPic', 0)
    g.bind(0, this.pic!.tex)
    g.draw(targetFbo, this.w, this.h)
    g.done(4)
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
    g.dispose()
  }
}
