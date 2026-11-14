// third-party: Holocloth
// Drape (the native node 'node-drape') : whatever enters the rack, printed on a
// sheet of cloth you can grab. A Verlet cloth on the CPU (structural, shear and
// bend constraints, a fixed 1/120 s step) adapted from Holocloth by Dmitry
// Kurash (MIT, github.com/dmitrykurash/holocloth) : its constraint layout and
// weights, its grab (every point near the hit pulled toward the pointer by a
// smoothstep of its distance, keeping its offset) and its fold occlusion (how far
// the neighbors' mean sits in front of a point). Ours : the hanging / flag /
// floating sheet, gravity, the wind on each point's normal, the sound's pokes,
// the Room's people pressing into it, the print, and the light (Relief's).
//
// The sim grid is small (44 points across); the mesh drawn is four times finer,
// each vertex a Catmull-Rom blend of 16 sim points read from a float texture, so
// the folds stay round at 4096. The pointer (the mouse on the preview, a Body
// pinch) arrives in the frame's uv; the node keeps its own camera to find what
// was grabbed and where it is pulled.

import type { ConvNode, NodeContext } from './convNodes'
import type { SourcePointer } from './nativeGenerators'
import { RELIEF_SHADE } from './reliefShade'
import { domeFill } from './domeSignal'
import { audioBus } from './audioIn'
import { roomTracker, roomMirror } from './roomTracker'
import { acquireMsaa, msaaBuffer, releaseMsaa } from './sharedMsaa'
import { glGeneration } from './glGeneration'

const COLS = 44
const SUB = 4 // mesh vertices per sim cell, each way
const STEP = 1 / 120
const MAX_SUB = 4
const CAM = 3 // the camera's distance : the z = 0 plane fills the frame's height

const num = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)

const MESH_VS = `#version 300 es
precision highp float; precision highp sampler2D; precision highp int;
in vec2 aUV;
uniform sampler2D uPos, uNrm;
uniform ivec2 uN;
uniform mat4 uMVP, uMV;
out vec2 vUV; out vec3 vN; out float vCav; out vec3 vP;
vec4 cr(float t) {
  float t2 = t * t, t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}
void main() {
  vec2 g = aUV * vec2(uN - 1);
  ivec2 i0 = min(ivec2(floor(g)), uN - 2);
  vec2 f = g - vec2(i0);
  vec4 wx = cr(f.x), wy = cr(f.y);
  vec3 P = vec3(0.0);
  vec4 Nc = vec4(0.0);
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    ivec2 c = clamp(i0 + ivec2(x - 1, y - 1), ivec2(0), uN - 1);
    float w = wx[x] * wy[y];
    P += texelFetch(uPos, c, 0).xyz * w;
    Nc += texelFetch(uNrm, c, 0) * w;
  }
  vUV = aUV;
  vN = mat3(uMV) * Nc.xyz;
  vCav = Nc.w;
  vec4 mv = uMV * vec4(P, 1.0);
  vP = mv.xyz;
  gl_Position = uMVP * vec4(P, 1.0);
}`

const MESH_FS = `#version 300 es
precision highp float; precision highp sampler2D;
in vec2 vUV; in vec3 vN; in float vCav; in vec3 vP;
out vec4 o;
uniform sampler2D uHost;
uniform vec3 uL, uCloth;
uniform float uMat, uSheen, uFolds, uAz;
${RELIEF_SHADE}
void main() {
  vec3 N = normalize(vN);
  bool back = !gl_FrontFacing;
  if (back) N = -N;
  // (light and shine as Relief : the viewer straight ahead)
  vec4 pr = texture(uHost, vec2(vUV.x, 1.0 - vUV.y));
  vec3 a = mix(uCloth, pr.rgb, clamp(pr.a, 0.0, 1.0));
  // the back of a printed sheet : the print shows through, faint
  if (back) a = mix(uCloth, a, 0.3) * 0.7;
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 c;
  if (uMat < 1.5) {
    // cloth : light wrapped round the folds, a soft sheen at the edges turning away
    float wrap = max(0.0, (dot(N, uL) + 0.5) / 1.5);
    float nv = max(0.0, N.z);
    vec3 H = normalize(uL + V);
    float satin = uMat > 0.5 ? 1.0 : 0.0;
    float sheen = pow(1.0 - nv, 2.5) * uSheen;
    float spec = pow(max(0.0, dot(N, H)), mix(8.0, 48.0, satin)) * mix(0.05, 0.4, satin) * (0.4 + uSheen);
    c = a * (0.16 + 0.88 * wrap * wrap) + sheen * (0.25 + 0.6 * a) * mix(0.5, 1.0, satin) + spec;
  } else {
    // plastic, chrome, foil : Relief's own
    float M = uMat < 2.5 ? 3.0 : uMat < 3.5 ? 4.0 : 7.0;
    c = shadeSurface(M, a, N, uL, uAz, 0.9, vec3(0.0), 0.0, 0.0, 0.0, vUV);
  }
  // the folds : what sits deep in a crease gets less light
  c *= 1.0 - uFolds * 0.8 * clamp(vCav, 0.0, 1.0);
  o = vec4(c, 1.0);
}`

const QUAD_VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`
const BEHIND_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uHost; uniform float uK;
void main(){ vec4 c = texture(uHost, vUV); o = vec4(c.rgb * c.a, c.a) * uK; }`
// (the resolved picture : premultiplied by the multisampling's coverage, straight again)
const SHOW_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uPic;
void main(){ vec4 c = texelFetch(uPic, ivec2(gl_FragCoord.xy), 0); o = c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }`

interface Grab { idx: Int32Array; w: Float32Array; off: Float32Array; target: [number, number, number]; ndcZ: number; u: number; v: number }

function compile(gl: WebGL2RenderingContext, vs: string, fs: string, attr: string): WebGLProgram {
  const mk = (t: number, s: string): WebGLShader => {
    const sh = gl.createShader(t)!
    gl.shaderSource(sh, s)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('[drape] ' + (gl.getShaderInfoLog(sh) || 'shader'))
    return sh
  }
  const p = gl.createProgram()!
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs))
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
  gl.bindAttribLocation(p, 0, attr)
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[drape] ' + (gl.getProgramInfoLog(p) || 'link'))
  return p
}

// 4x4 column-major helpers
function mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
    o[c * 4 + r] = s
  }
  return o
}
function invert(m: Float32Array): Float32Array | null {
  const a = m, inv = new Float32Array(16)
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10]
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10]
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9]
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9]
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10]
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10]
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9]
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9]
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6]
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6]
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5]
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5]
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6]
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6]
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5]
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5]
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12]
  if (Math.abs(det) < 1e-12) return null
  for (let i = 0; i < 16; i++) inv[i] /= det
  return inv
}

export class DrapeNode implements ConvNode {
  // the sim
  private cols = 0
  private rows = 0
  private pos = new Float32Array(0)
  private prev = new Float32Array(0)
  private rest = new Float32Array(0)
  private pin = new Uint8Array(0)
  private nrm = new Float32Array(0) // xyz normal + cavity
  private cons = new Int32Array(0) // pairs
  private conRest = new Float32Array(0)
  private conW = new Float32Array(0)
  private spacing = 0.05
  private key = ''
  private acc = 0
  private t = 0
  private prevT = 0
  private prevPoke = 0
  private prevReset = 0
  // GL
  private gen = -1
  private meshProg: WebGLProgram | null = null
  private behindProg: WebGLProgram | null = null
  private showProg: WebGLProgram | null = null
  private pic: { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number } | null = null
  private uni = new Map<string, WebGLUniformLocation | null>()
  private meshVao: WebGLVertexArrayObject | null = null
  private meshBuf: WebGLBuffer | null = null
  private idxBuf: WebGLBuffer | null = null
  private idxCount = 0
  private quadVao: WebGLVertexArrayObject | null = null
  private quadBuf: WebGLBuffer | null = null
  private posTex: WebGLTexture | null = null
  private nrmTex: WebGLTexture | null = null
  private upPos = new Float32Array(0)
  private upNrm = new Float32Array(0)
  private mvp: Float32Array = new Float32Array(16)
  private mv: Float32Array = new Float32Array(16)
  private aspect = 16 / 9
  // the pointer
  private grabs = new Map<number, Grab>()
  private pending: SourcePointer[] = []
  private grabR = 0.15
  private disposed = false

  constructor(private gl: WebGL2RenderingContext) {
    acquireMsaa()
  }

  /** What a click does, for the preview's hint. */
  pointerHint(): string {
    return 'drag : grab the cloth, let go and it falls'
  }

  /** The mouse on the preview or a Body pinch : grab, pull, let go (frame uv, v up). */
  pointer(ev: SourcePointer): void {
    this.pending.push(ev)
    if (this.pending.length > 64) this.pending.splice(0, this.pending.length - 64)
  }

  // ── the sim ────────────────────────────────────────────────────────────

  private build(aspect: number, size: number, mode: number, crumple: number): void {
    const cols = COLS
    const rows = Math.max(8, Math.round((COLS - 1) / aspect) + 1)
    this.cols = cols
    this.rows = rows
    const n = cols * rows
    const wd = 2 * size * aspect, hd = 2 * size
    this.spacing = wd / (cols - 1)
    this.pos = new Float32Array(n * 3)
    this.rest = new Float32Array(n * 3)
    this.pin = new Uint8Array(n)
    this.nrm = new Float32Array(n * 4)
    // a gentle crumple so it is cloth from the first frame (the lengths stay the flat
    // sheet's : it relaxes into soft folds)
    const amp = crumple * 0.35 * size
    const ph = Math.random() * 100
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const x = -wd / 2 + c * this.spacing
      const y = hd / 2 - r * (hd / (rows - 1))
      const z = amp * (Math.sin(x * 2.3 + ph) * 0.5 + Math.sin(y * 3.1 + x * 1.2 + ph * 1.7) * 0.35 + Math.sin(x * 5.3 - y * 4.1 + ph * 0.3) * 0.15)
      this.rest[i * 3] = x; this.rest[i * 3 + 1] = y; this.rest[i * 3 + 2] = z
      this.pin[i] = mode === 0 ? (r === 0 ? 1 : 0) : mode === 1 ? (c === 0 ? 1 : 0) : 0
    }
    // the pins sit flat (the edge held straight)
    for (let i = 0; i < n; i++) if (this.pin[i]) this.rest[i * 3 + 2] = 0
    this.pos.set(this.rest)
    this.prev = this.pos.slice()
    // constraints : structural 1, shear 0.85, bend 0.35 (Holocloth's)
    const list: number[] = [], rl: number[] = [], wl: number[] = []
    const add = (a: number, b: number, w: number): void => {
      const dx = this.rest[b * 3] - this.rest[a * 3], dy = this.rest[b * 3 + 1] - this.rest[a * 3 + 1]
      list.push(a, b); rl.push(Math.hypot(dx, dy)); wl.push(w) // the flat lengths
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (c + 1 < cols) add(i, i + 1, 1)
      if (r + 1 < rows) add(i, i + cols, 1)
      if (c + 1 < cols && r + 1 < rows) { add(i, i + cols + 1, 0.85); add(i + 1, i + cols, 0.85) }
      if (c + 2 < cols) add(i, i + 2, 0.35)
      if (r + 2 < rows) add(i, i + cols * 2, 0.35)
    }
    this.cons = Int32Array.from(list)
    this.conRest = Float32Array.from(rl)
    this.conW = Float32Array.from(wl)
    this.upPos = new Float32Array(n * 4)
    this.upNrm = new Float32Array(n * 4)
    this.grabs.clear()
    this.acc = 0
  }

  private normals(): void {
    const { cols, rows, pos, nrm } = this
    const P = (i: number, k: number): number => pos[i * 3 + k]
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const l = r * cols + Math.max(0, c - 1), rr = r * cols + Math.min(cols - 1, c + 1)
      const u = Math.max(0, r - 1) * cols + c, d = Math.min(rows - 1, r + 1) * cols + c
      const ax = P(rr, 0) - P(l, 0), ay = P(rr, 1) - P(l, 1), az = P(rr, 2) - P(l, 2)
      const bx = P(u, 0) - P(d, 0), by = P(u, 1) - P(d, 1), bz = P(u, 2) - P(d, 2)
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
      const ln = Math.hypot(nx, ny, nz) || 1
      nx /= ln; ny /= ln; nz /= ln
      nrm[i * 4] = nx; nrm[i * 4 + 1] = ny; nrm[i * 4 + 2] = nz
      // the fold : how far the four neighbors' mean sits in front of the point
      const mx = (P(l, 0) + P(rr, 0) + P(u, 0) + P(d, 0)) / 4 - P(i, 0)
      const my = (P(l, 1) + P(rr, 1) + P(u, 1) + P(d, 1)) / 4 - P(i, 1)
      const mz = (P(l, 2) + P(rr, 2) + P(u, 2) + P(d, 2)) / 4 - P(i, 2)
      nrm[i * 4 + 3] = clamp(((mx * nx + my * ny + mz * nz) / this.spacing) * 3, 0, 1)
    }
  }

  private step(I: Record<string, number | number[]>, mode: number): void {
    const { pos, prev, pin, rest, nrm } = this
    const n = this.cols * this.rows
    const dt = STEP
    const damp = Math.pow(1 - clamp(num(I.damping, 0.25), 0, 1) * 0.12, dt * 60)
    const g = mode === 2 ? 0 : clamp(num(I.gravity, 0.5), 0, 1) * 9
    const wind = clamp(num(I.wind, 0.3), 0, 1) * 9
    const gust = clamp(num(I.gust, 0.5), 0, 1)
    const t = this.t
    const hold = mode === 2 ? 0.6 : 0
    for (let i = 0; i < n; i++) {
      if (pin[i]) continue
      const k = i * 3
      const x = pos[k], y = pos[k + 1], z = pos[k + 2]
      // the wind : a breath that comes and goes along the sheet, pushing on each point's normal
      const nse = Math.sin(1.7 * t + x * 1.3 + y * 0.7) * 0.5 + Math.sin(2.9 * t - y * 1.9 + 1.1) * 0.3 + Math.sin(0.6 * t + x * 2.3) * 0.2
      const ws = wind * (0.55 + gust * nse)
      // a curtain takes the wind on its face; a flag streams along it, off its pole
      // (a sheet lying along the wind gets no push on its face : the drag carries it)
      const flag = mode === 1
      const wx = (flag ? 1 : 0.35) * ws, wz = (flag ? -0.3 : -1) * ws
      const drag = flag ? 1.6 : 0.15
      const nx = nrm[i * 4], ny = nrm[i * 4 + 1], nz = nrm[i * 4 + 2]
      const wn = wx * nx + wz * nz
      let ax = wn * nx + wx * drag
      let ay = wn * ny - g
      let az = wn * nz + wz * drag
      if (hold > 0) { ax += (rest[k] - x) * hold; ay += (rest[k + 1] - y) * hold; az += (rest[k + 2] - z) * hold }
      const vx = (x - prev[k]) * damp, vy = (y - prev[k + 1]) * damp, vz = (z - prev[k + 2]) * damp
      prev[k] = x; prev[k + 1] = y; prev[k + 2] = z
      pos[k] = x + vx + ax * dt * dt
      pos[k + 1] = y + vy + ay * dt * dt
      pos[k + 2] = z + vz + az * dt * dt
    }
    const stiff = clamp(num(I.stiffness, 0.7), 0, 1)
    const iters = 3 + Math.round(stiff * 11)
    const kk = 0.35 + 0.65 * stiff
    const { cons, conRest, conW } = this
    const m = conRest.length
    for (let it = 0; it < iters; it++) {
      for (let c = 0; c < m; c++) {
        const a = cons[c * 2], b = cons[c * 2 + 1]
        const ia = a * 3, ib = b * 3
        const dx = pos[ib] - pos[ia], dy = pos[ib + 1] - pos[ia + 1], dz = pos[ib + 2] - pos[ia + 2]
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (len < 1e-9) continue
        const corr = ((len - conRest[c]) / len) * 0.5 * kk * conW[c]
        const pa = pin[a], pb = pin[b]
        if (pa && pb) continue
        const fa = pa ? 0 : pb ? 2 : 1, fb = pb ? 0 : pa ? 2 : 1
        pos[ia] += dx * corr * fa; pos[ia + 1] += dy * corr * fa; pos[ia + 2] += dz * corr * fa
        pos[ib] -= dx * corr * fb; pos[ib + 1] -= dy * corr * fb; pos[ib + 2] -= dz * corr * fb
      }
      this.applyGrabs()
    }
    this.pressPeople(I)
  }

  private applyGrabs(): void {
    const { pos, prev } = this
    for (const g of this.grabs.values()) {
      for (let j = 0; j < g.idx.length; j++) {
        const k = g.idx[j] * 3, w = g.w[j]
        for (let a = 0; a < 3; a++) {
          const tgt = g.target[a] + g.off[j * 3 + a]
          pos[k + a] += (tgt - pos[k + a]) * w
          prev[k + a] += (pos[k + a] - prev[k + a]) * w * 0.3
        }
      }
    }
  }

  // The Room's people press into the cloth, each where they stand (their box's middle)
  private pressPeople(I: Record<string, number | number[]>): void {
    const amt = clamp(num(I.people, 0), 0, 1)
    if (amt <= 0 || !roomTracker.running()) return
    const people = roomTracker.list()
    if (!people.length) return
    const mir = roomMirror()
    const asp = this.aspect
    const { pos, pin } = this
    const n = this.cols * this.rows
    for (const p of people) {
      let cx = (p.box[0] + p.box[2]) / 2
      if (mir) cx = 1 - cx
      const cy = 1 - (p.box[1] + p.box[3]) / 2
      const px = (cx * 2 - 1) * asp, py = cy * 2 - 1
      const rad = Math.max(0.15, (p.box[3] - p.box[1]) * 0.9)
      const depth = amt * 0.8
      for (let i = 0; i < n; i++) {
        if (pin[i]) continue
        const k = i * 3
        const d = Math.hypot(pos[k] - px, pos[k + 1] - py) / rad
        if (d >= 1) continue
        const s = 1 - d * d
        const want = -depth * s * s
        if (pos[k + 2] > want) pos[k + 2] += (want - pos[k + 2]) * 0.5
      }
    }
  }

  private poke(strength: number): void {
    const n = this.cols * this.rows
    const c = Math.floor(Math.random() * n)
    const cx = this.pos[c * 3], cy = this.pos[c * 3 + 1]
    const rad = 0.45
    for (let i = 0; i < n; i++) {
      if (this.pin[i]) continue
      const k = i * 3
      const d = Math.hypot(this.pos[k] - cx, this.pos[k + 1] - cy) / rad
      if (d >= 1) continue
      const s = (1 - d * d) * strength * 0.06
      this.prev[k] -= this.nrm[i * 4] * s
      this.prev[k + 1] -= this.nrm[i * 4 + 1] * s
      this.prev[k + 2] -= this.nrm[i * 4 + 2] * s
    }
  }

  // ── the camera and the pointer ────────────────────────────────────────

  private camera(tilt: number): void {
    const a = this.aspect
    const f = CAM // 1 / tan(fov / 2) : the z = 0 plane spans y -1..1
    const near = 0.3, far = 12
    const proj = new Float32Array([f / a, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0])
    const c = Math.cos(tilt), s = Math.sin(tilt)
    // view : turn about x by tilt, then step back
    this.mv = new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, -CAM, 1])
    this.mvp = mul(proj, this.mv)
  }

  private project(i: number): [number, number, number] {
    const m = this.mvp, k = i * 3
    const x = this.pos[k], y = this.pos[k + 1], z = this.pos[k + 2]
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12]
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13]
    const cz = m[2] * x + m[6] * y + m[10] * z + m[14]
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15]
    return [cx / cw, cy / cw, cz / cw]
  }

  private unproject(nx: number, ny: number, nz: number): [number, number, number] | null {
    const inv = invert(this.mvp)
    if (!inv) return null
    const x = inv[0] * nx + inv[4] * ny + inv[8] * nz + inv[12]
    const y = inv[1] * nx + inv[5] * ny + inv[9] * nz + inv[13]
    const z = inv[2] * nx + inv[6] * ny + inv[10] * nz + inv[14]
    const w = inv[3] * nx + inv[7] * ny + inv[11] * nz + inv[15]
    return [x / w, y / w, z / w]
  }

  private handlePointer(ev: SourcePointer): void {
    if (ev.phase === 'up' || ev.phase === 'cancel') { this.grabs.delete(ev.pid); return }
    const nx = ev.u * 2 - 1, ny = ev.v * 2 - 1
    if (ev.phase === 'down') {
      const n = this.cols * this.rows
      const a = this.aspect
      let best = -1, bd = 1e9, bz = 0
      const pr: Array<[number, number, number]> = new Array(n)
      for (let i = 0; i < n; i++) {
        const p = this.project(i)
        pr[i] = p
        const d = Math.hypot((p[0] - nx) * a, p[1] - ny)
        if (d < bd) { bd = d; best = i; bz = p[2] }
      }
      // too far from the cloth : nothing to grab
      if (best < 0 || bd > this.grabR * 2 + 0.05) return
      const hit = this.unproject(nx, ny, bz)
      if (!hit) return
      const R = this.grabR * 2
      const idx: number[] = [], w: number[] = [], off: number[] = []
      for (let i = 0; i < n; i++) {
        if (this.pin[i]) continue
        const d = Math.hypot((pr[i][0] - pr[best][0]) * a, pr[i][1] - pr[best][1])
        if (d >= R) continue
        const t = 1 - d / R
        idx.push(i)
        w.push(t * t * (3 - 2 * t))
        off.push(this.pos[i * 3] - hit[0], this.pos[i * 3 + 1] - hit[1], this.pos[i * 3 + 2] - hit[2])
      }
      if (!idx.length) return
      this.grabs.set(ev.pid, { idx: Int32Array.from(idx), w: Float32Array.from(w), off: Float32Array.from(off), target: hit, ndcZ: bz, u: ev.u, v: ev.v })
      return
    }
    const g = this.grabs.get(ev.pid)
    if (!g) return
    const p = this.unproject(nx, ny, g.ndcZ)
    if (p) g.target = p
    g.u = ev.u; g.v = ev.v
  }

  // ── GL ─────────────────────────────────────────────────────────────────

  private u(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    const key = (p === this.meshProg ? 'm:' : p === this.showProg ? 's:' : 'b:') + name
    if (!this.uni.has(key)) this.uni.set(key, this.gl.getUniformLocation(p, name))
    return this.uni.get(key) ?? null
  }

  private ensureGL(): void {
    const gl = this.gl
    if (this.gen === glGeneration() && this.meshProg) return
    this.gen = glGeneration()
    this.uni.clear()
    this.meshProg = compile(gl, MESH_VS, MESH_FS, 'aUV')
    this.behindProg = compile(gl, QUAD_VS, BEHIND_FS, 'p')
    this.showProg = compile(gl, QUAD_VS, SHOW_FS, 'p')
    this.pic = null
    this.quadVao = gl.createVertexArray()
    gl.bindVertexArray(this.quadVao)
    this.quadBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.meshVao = null // rebuilt for the grid
    this.posTex = null
    this.nrmTex = null
  }

  private ensureMesh(): void {
    const gl = this.gl
    const gx = (this.cols - 1) * SUB + 1, gy = (this.rows - 1) * SUB + 1
    if (this.meshVao && this.idxCount === (gx - 1) * (gy - 1) * 6) return
    if (this.meshVao) { gl.deleteVertexArray(this.meshVao); gl.deleteBuffer(this.meshBuf); gl.deleteBuffer(this.idxBuf) }
    const uv = new Float32Array(gx * gy * 2)
    for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) { uv[(y * gx + x) * 2] = x / (gx - 1); uv[(y * gx + x) * 2 + 1] = y / (gy - 1) }
    const idx = new Uint32Array((gx - 1) * (gy - 1) * 6)
    let k = 0
    for (let y = 0; y < gy - 1; y++) for (let x = 0; x < gx - 1; x++) {
      const a = y * gx + x, b = a + 1, c = a + gx, d = c + 1
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d
    }
    this.meshVao = gl.createVertexArray()
    gl.bindVertexArray(this.meshVao)
    this.meshBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf)
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.idxBuf = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)
    gl.bindVertexArray(null)
    this.idxCount = idx.length
    // the sim's float textures
    for (const old of [this.posTex, this.nrmTex]) if (old) gl.deleteTexture(old)
    const mk = (): WebGLTexture => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.cols, this.rows, 0, gl.RGBA, gl.FLOAT, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      return t
    }
    this.posTex = mk()
    this.nrmTex = mk()
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl
    const I = ctx.inputs
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensureGL()
    const dome = domeFill()
    this.aspect = dome ? 1 : W / Math.max(1, H)
    const mode = Math.round(clamp(num(I.mode, 0), 0, 2))
    const size = clamp(num(I.size, 0.9), 0.3, 1.3)
    const crumple = clamp(num(I.crumple, 0.3), 0, 1)
    const key = `${mode}|${size.toFixed(3)}|${this.aspect.toFixed(3)}`
    const reset = num(I.reset, 0)
    if (key !== this.key || (reset >= 0.5 && this.prevReset < 0.5)) {
      this.build(this.aspect, size, mode, crumple)
      this.key = key
      this.normals()
    }
    this.prevReset = reset
    this.grabR = clamp(num(I.grab, 0.15), 0.03, 0.5)
    this.camera(clamp(num(I.tilt, 0.15), -1, 1) * 0.6)
    for (const ev of this.pending.splice(0)) this.handlePointer(ev)
    // pokes : the event, and the sound's hits
    const pk = num(I.poke, 0)
    if (pk >= 0.5 && this.prevPoke < 0.5) this.poke(1)
    this.prevPoke = pk
    const au = clamp(num(I.audio, 0), 0, 1)
    if (au > 0) {
      const tr = audioBus.feature('transient')
      if (tr > 0.8 && this.prevT <= 0.8) this.poke(au * 1.6)
      this.prevT = tr
    }
    // the sim, at a fixed step on this rack's clock (a frozen layer holds its folds)
    this.acc = Math.min(this.acc + Math.max(0, ctx.dt), STEP * MAX_SUB)
    while (this.acc >= STEP) {
      this.t += STEP
      this.step(I, mode)
      this.acc -= STEP
    }
    this.normals()
    // upload
    const n = this.cols * this.rows
    for (let i = 0; i < n; i++) {
      this.upPos[i * 4] = this.pos[i * 3]; this.upPos[i * 4 + 1] = this.pos[i * 3 + 1]; this.upPos[i * 4 + 2] = this.pos[i * 3 + 2]; this.upPos[i * 4 + 3] = 1
    }
    this.upNrm.set(this.nrm)
    this.ensureMesh()
    gl.bindTexture(gl.TEXTURE_2D, this.posTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.FLOAT, this.upPos)
    gl.bindTexture(gl.TEXTURE_2D, this.nrmTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.FLOAT, this.upNrm)

    // draw : into the shared multisampled buffer, then resolved into the chain
    const ms = msaaBuffer(gl, W, H)
    gl.bindFramebuffer(gl.FRAMEBUFFER, ms.fbo)
    gl.viewport(0, 0, W, H)
    gl.clearColor(0, 0, 0, 0)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    const behind = clamp(num(I.behind, 0), 0, 1)
    if (behind > 0) {
      gl.useProgram(this.behindProg)
      gl.bindVertexArray(this.quadVao)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host)
      gl.uniform1i(this.u(this.behindProg!, 'uHost'), 0)
      gl.uniform1f(this.u(this.behindProg!, 'uK'), behind)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const P = this.meshProg!
    gl.useProgram(P)
    gl.bindVertexArray(this.meshVao)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.posTex); gl.uniform1i(this.u(P, 'uPos'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.nrmTex); gl.uniform1i(this.u(P, 'uNrm'), 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(this.u(P, 'uHost'), 2)
    gl.uniform2i(this.u(P, 'uN'), this.cols, this.rows)
    gl.uniformMatrix4fv(this.u(P, 'uMVP'), false, this.mvp)
    gl.uniformMatrix4fv(this.u(P, 'uMV'), false, this.mv)
    const la = num(I.lightAngle, 2.36)
    const lh = clamp(num(I.lightHeight, 0.55), 0, 1)
    const lz = 0.15 + 1.1 * lh
    const ln = Math.hypot(1, lz)
    gl.uniform3f(this.u(P, 'uL'), Math.cos(la) / ln, Math.sin(la) / ln, lz / ln)
    const cl = Array.isArray(I.color) ? I.color : [0.08, 0.08, 0.09, 1]
    gl.uniform3f(this.u(P, 'uCloth'), cl[0], cl[1], cl[2])
    gl.uniform1f(this.u(P, 'uMat'), Math.round(clamp(num(I.material, 0), 0, 4)))
    gl.uniform1f(this.u(P, 'uFoilSat'), clamp(num(I.rainbow, 0.25), 0, 1))
    gl.uniform1f(this.u(P, 'uFoilScale'), clamp(num(I.flakes, 220), 20, 400))
    gl.uniform1f(this.u(P, 'uFoilGlint'), clamp(num(I.glint, 0.5), 0, 1))
    gl.uniform1f(this.u(P, 'uSheen'), clamp(num(I.sheen, 0.5), 0, 1))
    gl.uniform1f(this.u(P, 'uFolds'), clamp(num(I.folds, 0.6), 0, 1))
    gl.uniform1f(this.u(P, 'uAz'), la)
    gl.drawElements(gl.TRIANGLES, this.idxCount, gl.UNSIGNED_INT, 0)
    gl.disable(gl.DEPTH_TEST)
    gl.bindVertexArray(null)
    // resolve into an 8-bit picture (the multisampled buffer's own format), then
    // into the chain, straight alpha again
    if (!this.pic || this.pic.w !== W || this.pic.h !== H) {
      if (this.pic) { gl.deleteTexture(this.pic.tex); gl.deleteFramebuffer(this.pic.fbo) }
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      this.pic = { tex, fbo, w: W, h: H }
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms.fbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.pic.fbo)
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    const out = ctx.chain.next()
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
    gl.viewport(0, 0, W, H)
    gl.useProgram(this.showProg)
    gl.bindVertexArray(this.quadVao)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.pic.tex)
    gl.uniform1i(this.u(this.showProg!, 'uPic'), 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    if (this.gen === glGeneration()) {
      if (this.meshVao) gl.deleteVertexArray(this.meshVao)
      if (this.quadVao) gl.deleteVertexArray(this.quadVao)
      for (const b of [this.meshBuf, this.idxBuf, this.quadBuf]) if (b) gl.deleteBuffer(b)
      for (const t of [this.posTex, this.nrmTex]) if (t) gl.deleteTexture(t)
      for (const p of [this.meshProg, this.behindProg, this.showProg]) if (p) gl.deleteProgram(p)
      if (this.pic) { gl.deleteTexture(this.pic.tex); gl.deleteFramebuffer(this.pic.fbo) }
    }
    releaseMsaa(gl)
  }
}
