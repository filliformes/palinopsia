// StrataSource : the native Strata generator (id 'gen-strata'). A place as a scanner
// sees it, a cloud of points, taken apart and put back together by the sound.
//
// The cloud : a place it carries (a colonnade ruin, a grove, a cliff in strata, a
// nebula : strataPlaces.ts), a scan or a model from a file (PLY, XYZ, PTS, OBJ, glTF,
// STL : the Model's own reader, modelLoad.ts), or a picture lifted by its depth (the
// layer picked as SIDECHAIN, raised by the depth model or by its brightness, as the
// Point Cloud does).
//
// What it does to it, all in the vertex shader from each point's place at rest
// (nothing is simulated, so nothing drifts) :
// - STATE : from NATURAL (the points in their own colors) to STRUCTURAL (the ink
//   color, finer points, the LINKS between neighbours drawn as thin lines).
// - SECTIONS : planes cut through the cloud along an axis; the points in a cut are
//   lit, the rest dim (BETWEEN), the cuts SWEEP through, free or on the beat.
// - BREAK : on the sound's hits (or the beat, or the trigger) the cloud splits into
//   blocks; a share of them jump along an axis at once, hold, and are put back over
//   REBUILD seconds (in STEPS, or smoothly). A broken block can show its structure
//   (REVEAL). A hit can also cut the whole picture to the other STATE for a moment.
// - ERODE : points fall away, at random, from the top, the bottom or one side.
// - VOXEL : every point snapped to a grid, the place turned into blocks.
// - PANELS : two to four views side by side, from other angles, in the other state,
//   or cut along other axes.
//
// Drawn as instanced quads (the points) and instanced lines (the links), depth-
// tested in the shared multisampled buffer, through alpha to coverage.
//
// third-party: Ryoichi Kurokawa, audiovisual works (the idea, from what his works and
// interviews say of them : a scanned place of nature or architecture rendered as
// points with shading programs, taken apart and rebuilt in time with the sound, over
// several screens). Written for Palinopsia; no code taken.

import { EngineGL, SlotClock, Edge, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'
import { domeFill } from './domeSignal'
import { acquireMsaa, msaaBuffer, releaseMsaa } from './sharedMsaa'
import { Onset } from './touchInput'
import { tempoBpm } from './tempoSignal'
import { PictureDepthReader, pictureDepth } from './pictureDepth'
import { modelLoader } from './modelLoad'
import { placeCloud, fitCloud, LinkBuilder, PLACE_NAMES, type Cloud } from './strataPlaces'

/** The most points drawn from the picture (POINTS 1). */
export const STRATA_PICTURE_MAX = 360000
const MAX_BREAK = 4
const MAX_LEAN = 1.3963
const TEX_W = 2048
const TAU = Math.PI * 2
const SYNC_BEATS = [0, 1, 2, 4, 8, 16]
const BREAK_BEATS = [0, 1, 2, 4, 8, 0] // hits, beat, 2 beats, bar, 2 bars, by hand
const SCALE = 0.8 // a fitted cloud (radius 1) a little larger than the picture (height 1)
// the cloud menu : the four places, then the picture, then a file
const CLOUD_PICTURE = 4
const CLOUD_FILE = 5

// The height the picture's points stand on, gliding toward the picture's.
const HEIGHT_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUV;
out vec4 o;
uniform sampler2D uPrev, uSide, uMap;
uniform int uMode;          // 1 brightness, 2 darkness, 3 the depth model's map
uniform float uK;
uniform vec2 uCell;
float lumaA(vec2 uv) {
  vec4 c = texture(uSide, uv);
  return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)) * c.a;
}
void main() {
  float t;
  if (uMode == 3) t = texture(uMap, vUV).r;
  else {
    vec2 h = uCell * 0.25;
    float l = 0.25 * (lumaA(vUV + vec2(-h.x, -h.y)) + lumaA(vUV + vec2(h.x, -h.y)) + lumaA(vUV + vec2(-h.x, h.y)) + lumaA(vUV + vec2(h.x, h.y)));
    t = uMode == 2 ? 1.0 - l : l;
  }
  float p = texture(uPrev, vUV).r;
  o = vec4(mix(p, clamp(t, 0.0, 1.0), uK), 0.0, 0.0, 1.0);
}`

// Where a point is and how it looks this frame : shared by the points and the links.
const PLACE_GLSL = `
uniform int uSrc;              // 0 a cloud (textures), 1 the picture (a grid)
uniform sampler2D uPos, uCol, uLink, uSide, uH;
uniform int uTexW;
uniform ivec2 uGrid;
uniform float uAsp, uDepthAmt, uStride;
uniform float uVoxel, uErode;
uniform int uErodeFrom;
uniform float uSec, uSecN, uSecThick, uSecBetween, uSecPh;
uniform int uSecAxis;
uniform vec4 uBrk[${MAX_BREAK}];     // age (s), strength, seed, axis (3 : each block its own)
uniform float uBrkAmt, uBlock, uShare, uRebuild, uHold, uSteps, uReveal;
uniform float uState, uGain, uFog;
uniform vec3 uInk;
uniform vec3 uCam, uR, uU, uF;
uniform float uFocal, uDist, uZFar;
uniform vec2 uRes;
uniform int uSquare;          // the dome's fill : the view kept square

// third-party: Hash without Sine
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float smoother(float t) { t = clamp(t, 0.0, 1.0); return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

// the point at rest : its place and its color (alpha 0 : no point there)
void rest(int i, out vec3 P, out vec4 C) {
  if (uSrc == 0) {
    ivec2 t = ivec2(i % uTexW, i / uTexW);
    P = texelFetch(uPos, t, 0).xyz;
    C = texelFetch(uCol, t, 0);
  } else {
    int ix = i % uGrid.x, iy = i / uGrid.x;
    vec3 h = hash33(vec3(float(ix), float(iy), 17.0));
    vec2 uv = clamp((vec2(float(ix), float(iy)) + 0.5 + (h.xy - 0.5) * 0.7) / vec2(uGrid), 0.0, 1.0);
    C = textureLod(uSide, uv, 0.0);
    float ht = textureLod(uH, uv, 0.0).r;
    P = vec3((uv.x - 0.5) * uAsp, uv.y - 0.5, (ht - 0.5) * uDepthAmt * 0.6);
  }
}

// the point this frame. keep 0 : it is not drawn. moved : how far its block is out.
void placed(int i, out vec3 P, out vec3 col, out float keep, out float moved) {
  vec4 C;
  rest(i, P, C);
  keep = C.a;
  moved = 0.0;
  vec3 h = hash33(vec3(float(i % 4093), float(i / 4093), 7.0));
  float q = mix(0.006, 0.09, uVoxel);
  // (with VOXEL on, a whole cell erodes at once : a cell's other points would fill it)
  if (uVoxel > 0.001) h.x = hash33(floor(P / q) + 3.0).x;
  // ERODE : the points fall away, at random or from a side
  if (uErode > 0.001) {
    float t = 0.5;
    if (uErodeFrom == 1) t = clamp(P.y / 1.1 + 0.5, 0.0, 1.0);
    else if (uErodeFrom == 2) t = clamp(0.5 - P.y / 1.1, 0.0, 1.0);
    else if (uErodeFrom == 3) t = clamp(P.x / 1.1 + 0.5, 0.0, 1.0);
    float w = uErodeFrom == 0 ? 1.0 : 2.0 * t;
    if (h.x < uErode * w) keep = 0.0;
  }
  // VOXEL : snapped to a grid
  if (uVoxel > 0.001) P = (floor(P / q) + 0.5) * q;
  vec3 P0 = P;
  // BREAK : the blocks jump along an axis, hold, and are put back
  for (int k = 0; k < ${MAX_BREAK}; k++) {
    vec4 b = uBrk[k];
    if (b.y <= 0.0) continue;
    vec3 hb = hash33(floor(P0 / uBlock) + b.z);
    if (hb.x > uShare) continue;
    float env = b.x < uHold ? 1.0 : 1.0 - smoother((b.x - uHold) / max(uRebuild, 0.05));
    if (uSteps > 0.5) env = ceil(env * uSteps - 0.001) / uSteps;
    if (env <= 0.0) continue;
    int ax = b.w > 2.5 ? int(floor(hb.z * 2.999)) : int(b.w);
    float d = (hb.y * 2.0 - 1.0) * b.y * uBrkAmt * 0.6 * env;
    if (ax == 0) P.x += d; else if (ax == 1) P.y += d; else P.z += d;
    moved = max(moved, env);
  }
  // the colors : its own (NATURAL) toward the ink (STRUCTURAL)
  vec3 own = C.rgb;
  float state = clamp(uState + uReveal * moved, 0.0, 1.0);
  // SECTIONS : the points in a cut are lit, the rest dim
  float inCut = 0.0, light = 1.0;
  if (uSec > 0.001) {
    float c;
    if (uSecAxis == 0) c = P0.x;
    else if (uSecAxis == 1) c = P0.y;
    else if (uSecAxis == 2) c = P0.z;
    else if (uSecAxis == 3) c = length(P0.xz);
    else c = dot(P0 - uCam, uF) - uDist;
    float f = fract(c * uSecN * 0.9 + uSecPh);
    float d = min(f, 1.0 - f);
    float w = 1.0 - smoothstep(uSecThick * 0.5, uSecThick * 0.5 + 0.03, d);
    inCut = w * uSec;
    light = mix(1.0, mix(uSecBetween, 1.0, w), uSec);
  }
  // (the natural colors lifted a little : a scan's dark colors read as mud on black)
  vec3 nat = own * 1.25 + 0.04;
  col = mix(nat, uInk, max(state, inCut * 0.7)) * light * (1.0 + 0.5 * inCut) * uGain;
}

// the camera : frame heights from the panel's center, and the depth
bool project(vec3 P, out vec2 s, out float depth) {
  vec3 d = P - uCam;
  vec3 v = vec3(dot(d, uR), dot(d, uU), dot(d, uF));
  depth = v.z;
  if (depth < 0.02) return false;
  s = v.xy * uFocal / depth;
  return true;
}
float fogged(float depth) { return 1.0 - uFog * 0.85 * clamp((depth - uDist + 0.1) / 0.8, 0.0, 1.0); }
vec4 clipOf(vec2 s, float depth) {
  return vec4(s.x * 2.0 * (uSquare == 1 ? 1.0 : uRes.y / uRes.x), s.y * 2.0, clamp(depth / uZFar, 0.0, 1.0) * 2.0 - 1.0, 1.0);
}`

const DOT_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${PLACE_GLSL}
uniform float uSize;
uniform int uShape;
out vec2 vLocal;
out float vRad;
out vec4 vCol;
void cull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vLocal = vec2(0.0); vRad = 0.0; vCol = vec4(0.0); }
void main() {
  int i = int(float(gl_InstanceID) * uStride);
  vec3 P, c; float keep, moved;
  placed(i, P, c, keep, moved);
  if (keep < 0.004) { cull(); return; }
  vec2 s; float depth;
  if (!project(P, s, depth)) { cull(); return; }
  float state = clamp(uState + uReveal * moved, 0.0, 1.0);
  // a voxel's point fills its cell : the place reads as blocks, not as a grid of dots
  float world = uSize * mix(1.0, 0.6, state);
  if (uVoxel > 0.001) world = max(world, mix(0.006, 0.09, uVoxel) * 0.5);
  float rPx = world * uFocal / depth * uRes.y;
  rPx = min(rPx, uRes.y * 0.05);
  float amp = keep * fogged(depth);
  if (rPx < 0.7) { amp *= (rPx / 0.7) * (rPx / 0.7); rPx = 0.7; }
  float ext = uShape == 0 ? rPx : rPx + 1.0;
  int vid = gl_VertexID;
  vec2 corner = vec2((vid & 1) == 0 ? -1.0 : 1.0, (vid & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner * ext;
  vRad = rPx;
  vCol = vec4(clamp(c, 0.0, 1.0), clamp(amp, 0.0, 1.0));
  vec4 cp = clipOf(s, depth);
  cp.xy += vLocal / uRes * 2.0;
  gl_Position = cp;
}`

const DOT_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vLocal;
in float vRad;
in vec4 vCol;
uniform int uShape;
out vec4 o;
void main() {
  float a = uShape == 0 ? 1.0 : clamp(vRad - length(vLocal) + 0.5, 0.0, 1.0);
  a *= vCol.a;
  if (a < 0.004) discard;
  float s = sqrt(a);
  o = vec4(vCol.rgb * s, s);
}`

// The links : two ends a line. A cloud's from its neighbours (uLink), the picture's
// from its grid (right and down).
const LINK_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${PLACE_GLSL}
uniform float uLinks;
uniform int uLinkStep;       // a web point is every STEP-th point (a cloud), every STEP-th row and column (the picture)
uniform ivec2 uLinkGrid;     // the picture's web : columns, rows
out vec4 vCol;
void cull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); }
void main() {
  int pair = gl_InstanceID;
  int k = pair / 2;
  int a, b = -1;
  float rest0 = 0.0;
  if (uSrc == 0) {
    vec4 L = texelFetch(uLink, ivec2(k % uTexW, k / uTexW), 0);
    float nb = (pair & 1) == 0 ? L.x : L.y;
    a = k * uLinkStep;
    if (nb >= 0.0) b = int(nb) * uLinkStep;
    rest0 = (pair & 1) == 0 ? L.z : L.w;
  } else {
    int sx = k % uLinkGrid.x, sy = k / uLinkGrid.x;
    int ix = sx * uLinkStep, iy = sy * uLinkStep;
    a = iy * uGrid.x + ix;
    if ((pair & 1) == 0) { if (ix + uLinkStep < uGrid.x) b = a + uLinkStep; }
    else if (iy + uLinkStep < uGrid.y) b = a + uLinkStep * uGrid.x;
  }
  if (b < 0) { cull(); return; }
  vec3 Pa, Pb, ca, cb; float ka, kb, ma, mb;
  placed(a, Pa, ca, ka, ma);
  placed(b, Pb, cb, kb, mb);
  if (ka < 0.004 || kb < 0.004) { cull(); return; }
  // a link across a break, or (the picture) across a cliff in the depth, is cut
  float L = length(Pa - Pb);
  if (uSrc == 0 ? abs(L - rest0) > 0.01 + rest0 * 0.5 : L > 3.0 * float(uLinkStep) / float(uGrid.y)) { cull(); return; }
  bool first = gl_VertexID == 0;
  vec3 P = first ? Pa : Pb;
  vec2 s; float depth;
  if (!project(P, s, depth)) { cull(); return; }
  float state = clamp(uState + uReveal * max(ma, mb), 0.0, 1.0);
  vCol = vec4(clamp(first ? ca : cb, 0.0, 1.0), clamp(uLinks * (0.35 + 0.65 * state) * fogged(depth), 0.0, 1.0));
  gl_Position = clipOf(s, depth);
}`

const LINK_FS = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 o;
void main() {
  if (vCol.a < 0.004) discard;
  float s = sqrt(vCol.a);
  o = vec4(vCol.rgb * s, s);
}`

const SHOW_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPic;
out vec4 o;
void main() {
  vec4 c = texelFetch(uPic, ivec2(gl_FragCoord.xy), 0);
  o = vec4(c.a > 1e-4 ? clamp(c.rgb / c.a, 0.0, 1.0) : vec3(0.0), c.a);
}`

type V3 = [number, number, number]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)

interface Break { age: number; strength: number; seed: number; axis: number }

/** A cloud on the GPU : its points, colors and (once found) neighbours. */
interface GpuCloud {
  src: Cloud
  n: number
  rows: number
  pos: WebGLTexture
  col: WebGLTexture
  link: WebGLTexture | null
  builder: LinkBuilder | null
  /** the web : a web point is every linkStep-th point, linkN of them */
  linkStep: number
  linkN: number
}

export class StrataSource implements NativeGenerator {
  private g: EngineGL
  private heightP: Prog
  private dotP: Prog
  private linkP: Prog
  private showP: Prog
  private hgt: [Target, Target] | null = null
  private hi = 0
  private hw = 0
  private hh = 0
  private pic: Target | null = null
  private clock = new SlotClock()
  private inputs: Record<string, number | number[]> = {}
  private side: WebGLTexture | null = null
  private blankTex: WebGLTexture | null = null
  private first = true
  private spinA = 0
  private swayA = Math.random() * TAU
  private swayB = Math.random() * TAU
  private secPh = 0
  private beatAcc = 0
  private time = 0
  private cutUntil = -1
  private breaks: Break[] = []
  private burst = new Edge()
  private onset = new Onset()
  private depthRead: PictureDepthReader
  private gpu: GpuCloud | null = null
  private path: string | null = null
  private files: readonly string[] = []
  private count = 0
  private note = ''

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    const g = (this.g = new EngineGL(gl, 'strata'))
    this.heightP = g.prog(HEIGHT_FS)
    this.dotP = g.prog(DOT_FS, DOT_VS)
    this.linkP = g.prog(LINK_FS, LINK_VS)
    this.showP = g.prog(SHOW_FS)
    this.depthRead = new PictureDepthReader(gl)
    acquireMsaa()
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
    if (this.burst.fired(num(inputs, 'burst', 0))) this.fire(1, true)
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
    if (name === 'burst' && typeof value === 'number' && this.burst.fired(value)) this.fire(1, true)
  }

  feed(_audio: WebGLTexture | null, side: WebGLTexture | null): void {
    this.side = side
  }

  file(path: string | null, files: readonly string[] = []): void {
    this.path = path || null
    this.files = files
  }

  status(): string {
    const k = this.count < 1000 ? String(this.count) : `${Math.round(this.count / 1000)}K`
    return this.note ? `${this.note}` : `${k} points`
  }

  event(name: string): void {
    if (name === 'break' || name === 'burst') this.fire(1, true)
  }

  /** A break : a share of the blocks jump, hold, and are put back over REBUILD. */
  private fire(strength: number, byHand = false): void {
    const I = this.inputs
    const amt = clamp(num(I, 'break', 0.5), 0, 1)
    const s = byHand ? Math.max(strength, 0.6) : strength
    if (amt > 0.001) {
      if (this.breaks.length >= MAX_BREAK) this.breaks.shift()
      this.breaks.push({ age: 0, strength: s, seed: 100 + Math.floor(Math.random() * 800), axis: Math.round(clamp(num(I, 'breakAxis', 0), 0, 3)) })
    }
    // a hard cut to the other state, for HOLD seconds
    if (Math.random() < clamp(num(I, 'cut', 0), 0, 1)) this.cutUntil = this.time + clamp(num(I, 'cutHold', 0.25), 0.03, 3)
  }

  private blank(): WebGLTexture {
    if (this.blankTex) return this.blankTex
    const gl = this.g.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.blankTex = t
    return t
  }

  private dataTex(rows: number, data: Float32Array | Uint8Array, float: boolean): WebGLTexture {
    const gl = this.g.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEX_W, rows, 0, gl.RGBA, gl.FLOAT, data as Float32Array)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TEX_W, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data as Uint8Array)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, null)
    return t
  }

  private freeCloud(): void {
    const gl = this.g.gl
    if (!this.gpu) return
    gl.deleteTexture(this.gpu.pos)
    gl.deleteTexture(this.gpu.col)
    if (this.gpu.link) gl.deleteTexture(this.gpu.link)
    this.gpu = null
  }

  /** Put a cloud on the GPU (kept while it stays the same object). */
  private useCloud(c: Cloud): GpuCloud {
    if (this.gpu && this.gpu.src === c) return this.gpu
    this.freeCloud()
    const rows = Math.max(1, Math.ceil(c.n / TEX_W))
    const pos = new Float32Array(TEX_W * rows * 4)
    for (let i = 0; i < c.n; i++) {
      pos[i * 4] = c.pos[i * 3] * SCALE
      pos[i * 4 + 1] = c.pos[i * 3 + 1] * SCALE
      pos[i * 4 + 2] = c.pos[i * 3 + 2] * SCALE
      pos[i * 4 + 3] = 1
    }
    const colA = new Uint8Array(TEX_W * rows * 4)
    colA.set(c.col.subarray(0, c.n * 4))
    this.gpu = { src: c, n: c.n, rows, pos: this.dataTex(rows, pos, true), col: this.dataTex(rows, colA, false), link: null, builder: null, linkStep: 1, linkN: 0 }
    return this.gpu
  }

  /** The cloud from a file (a model's vertices, a scan's points), once read. */
  private fileCloud(): Cloud | null {
    if (!this.path) {
      this.note = 'no file : open one in the Inspector (ply, xyz, pts, obj, glb, gltf, stl)'
      return null
    }
    const st = modelLoader.get(this.path, this.files)
    if (st.state === 'loading') { this.note = 'reading the scan…'; return null }
    if (st.state === 'error') { this.note = st.message; return null }
    const m = st.mesh
    let c = fileClouds.get(m)
    if (!c) {
      const n = m.pos.length / 3
      let colA = m.col
      if (!colA) {
        colA = new Uint8Array(n * 4)
        colA.fill(200)
      }
      // (a file without colors in a soft grey; a texture's colors are left to the Model)
      c = fitCloud({ pos: m.pos, col: colA, n })
      fileClouds.set(m, c)
    }
    this.note = ''
    return c
  }

  private ensure(asp: number): void {
    const g = this.g
    const hw = asp >= 1 ? 512 : Math.max(16, Math.round(512 * asp))
    const hh = asp >= 1 ? Math.max(16, Math.round(512 / asp)) : 512
    if (!this.hgt || hw !== this.hw || hh !== this.hh) {
      if (this.hgt) for (const t of this.hgt) g.freeTarget(t)
      this.hgt = [g.target(hw, hh, { half: 'r', linear: true }), g.target(hw, hh, { half: 'r', linear: true })]
      this.hw = hw
      this.hh = hh
      this.first = true
    }
    if (!this.pic) this.pic = g.target(this.w, this.h, { float: false })
  }

  render(targetFbo: WebGLFramebuffer, clockSec: number): void {
    const g = this.g
    const gl = g.gl
    if (!g.ok) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return
    }
    const I = this.inputs
    const dt = this.clock.tick(clockSec)
    this.time += dt
    const fill = domeFill() > 0
    const asp = this.w / Math.max(1, this.h)
    this.ensure(asp)

    // ── the clocks ──
    this.spinA = (this.spinA + num(I, 'spin', 0.08) * 0.5 * dt) % TAU
    const swayRate = clamp(num(I, 'swayRate', 0.3), 0, 2)
    this.swayA = (this.swayA + swayRate * 0.7 * dt) % TAU
    this.swayB = (this.swayB + swayRate * 0.43 * dt) % TAU
    const bpm = clamp(tempoBpm(), 20, 300)
    const sync = Math.round(clamp(num(I, 'sweepSync', 0), 0, SYNC_BEATS.length - 1))
    if (sync > 0) this.secPh = (this.secPh + (dt / ((60 / bpm) * SYNC_BEATS[sync])) * Math.sign(num(I, 'sweep', 0.2) || 1)) % 1000
    else this.secPh = (this.secPh + dt * num(I, 'sweep', 0.2) * 0.5) % 1000

    // ── the breaks : the sound's hits, the beat, or the trigger only ──
    const on = Math.round(clamp(num(I, 'breakOn', 0), 0, BREAK_BEATS.length - 1))
    const hit = this.onset.hit()
    if (on === 0 && hit > 0) this.fire(hit)
    else if (BREAK_BEATS[on] > 0) {
      this.beatAcc += dt
      const per = (60 / bpm) * BREAK_BEATS[on]
      if (this.beatAcc >= per) {
        this.beatAcc %= per
        this.fire(1)
      }
    }
    const rebuild = clamp(num(I, 'rebuild', 1.5), 0.05, 8)
    const hold = clamp(num(I, 'hold', 0.15), 0, 4)
    for (const b of this.breaks) b.age += dt
    this.breaks = this.breaks.filter((b) => b.age < hold + rebuild + 0.1)

    // ── the cloud ──
    const which = Math.round(clamp(num(I, 'cloud', 0), 0, CLOUD_FILE))
    let cloud: Cloud | null = null
    let picture = false
    if (which === CLOUD_PICTURE) {
      if (this.side) { picture = true; this.note = '' }
      else { cloud = placeCloud(0); this.note = 'no layer picked as SIDECHAIN : the colonnade meanwhile' }
    } else if (which === CLOUD_FILE) {
      cloud = this.fileCloud()
    } else {
      cloud = placeCloud(which)
      this.note = ''
    }
    if (!picture && !cloud) {
      // nothing to draw yet (a file being read) : the ground alone
      this.clearTo(targetFbo)
      return
    }
    const density = clamp(num(I, 'density', 0.6), 0.02, 1)
    const links = clamp(num(I, 'links', 0), 0, 1)
    let gpu: GpuCloud | null = null
    let drawN = 0
    let stride = 1
    let gx = 0, gy = 0
    if (cloud) {
      gpu = this.useCloud(cloud)
      drawN = Math.max(1, Math.round(gpu.n * density))
      stride = gpu.n / drawN
      // the neighbours, found a slice a frame once the links are wanted
      if (links > 0.001 && !gpu.link) {
        if (!gpu.builder) gpu.builder = new LinkBuilder(cloud.pos, cloud.n)
        if (gpu.builder.step(20000)) {
          const B = gpu.builder
          const rows = Math.max(1, Math.ceil(B.m / TEX_W))
          const data = new Float32Array(TEX_W * rows * 4)
          data.set(B.out)
          for (let i = B.m * 4; i < data.length; i += 4) { data[i] = -1; data[i + 1] = -1 }
          // the rest lengths, in the drawn scale
          for (let i = 0; i < B.m; i++) { data[i * 4 + 2] *= SCALE; data[i * 4 + 3] *= SCALE }
          gpu.link = this.dataTex(rows, data, true)
          gpu.linkStep = B.stride
          gpu.linkN = B.m
          gpu.builder = null
        }
      }
    } else {
      // the picture : its height first
      const raise = Math.round(clamp(num(I, 'raise', 0), 0, 2))
      const wantModel = raise === 0 && pictureDepth.wanted()
      const map = wantModel ? this.depthRead.step(this.side!, asp, dt) : null
      if (!wantModel) this.depthRead.stop()
      const mode = map ? 3 : raise === 2 ? 2 : 1
      const settle = clamp(num(I, 'settle', 0.3), 0, 2)
      const k = this.first || settle < 0.01 ? 1 : 1 - Math.exp(-dt / settle)
      const H = this.hgt!
      this.heightP.use().i1('uPrev', 0).i1('uSide', 1).i1('uMap', 2).i1('uMode', mode).f1('uK', k).f2('uCell', 1 / this.hw, 1 / this.hh)
      g.bind(0, H[this.hi].tex)
      g.bind(1, this.side!)
      g.bind(2, map ?? this.blank())
      g.draw(H[1 - this.hi].fbo, this.hw, this.hh)
      this.hi = 1 - this.hi
      this.first = false
      const n = Math.round(density * STRATA_PICTURE_MAX)
      gx = Math.max(2, Math.round(Math.sqrt(n * asp)))
      gy = Math.max(2, Math.floor(n / gx))
      drawN = gx * gy
    }
    this.count = drawN

    // ── the panels ──
    const panels = fill ? 1 : Math.round(clamp(num(I, 'panels', 1), 1, 4))
    const panelMode = Math.round(clamp(num(I, 'panelMode', 0), 0, 3))
    const spread = clamp(num(I, 'spread', 0.5), 0, 1)
    const gapPx = panels > 1 ? Math.round(clamp(num(I, 'gap', 0.3), 0, 1) * this.h * 0.03) : 0
    const baseState = clamp(num(I, 'state', 0.3), 0, 1)
    const cutNow = this.time < this.cutUntil
    const secAxis = Math.round(clamp(num(I, 'axis', 1), 0, 4))

    const [gr, gg, gb] = col(I, 'ground', [0, 0, 0])
    const gv = I.ground
    const ga = Array.isArray(gv) && gv.length >= 4 ? clamp(gv[3], 0, 1) : 1
    const ink = col(I, 'ink', [0.92, 0.94, 0.96])
    const ms = msaaBuffer(gl, this.w, this.h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, ms.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.colorMask(true, true, true, true)
    gl.depthMask(true)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(gr * ga, gg * ga, gb * ga, ga)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.BLEND)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE)

    const brkU = new Float32Array(MAX_BREAK * 4)
    this.breaks.forEach((b, i) => brkU.set([b.age, b.strength, b.seed, b.axis], i * 4))
    const size = clamp(num(I, 'size', 1), 0.1, 4)
    // a point's radius : about half the spacing of the drawn points
    const radius = picture ? (0.5 / Math.max(2, gy)) * size : (1.6 / Math.sqrt(Math.max(1, drawN))) * size * 0.5

    gl.enable(gl.SCISSOR_TEST)
    for (let p = 0; p < panels; p++) {
      const x0 = Math.round((p * this.w) / panels)
      const x1 = Math.round(((p + 1) * this.w) / panels)
      const vx = x0 + (p > 0 ? Math.ceil(gapPx / 2) : 0)
      const vw = Math.max(1, x1 - x0 - (p > 0 ? Math.ceil(gapPx / 2) : 0) - (p < panels - 1 ? Math.floor(gapPx / 2) : 0))
      gl.viewport(vx, 0, vw, this.h)
      gl.scissor(vx, 0, vw, this.h)
      const vAsp = fill ? 1 : vw / this.h
      const off = p - (panels - 1) / 2
      const angles = panelMode === 0 || panelMode === 3
      const states = panelMode === 1 || panelMode === 3
      const cuts = panelMode === 2 || panelMode === 3
      // the camera, orbiting the cloud's centre
      const sway = clamp(num(I, 'sway', 0.3), 0, 1)
      const yaw = num(I, 'turn', 0) * Math.PI + this.spinA + sway * 0.45 * Math.sin(this.swayA) + (panels > 1 && angles ? off * spread * 1.2 : 0)
      const pitch = clamp(clamp(num(I, 'tilt', 0.12), -1, 1) * MAX_LEAN + sway * 0.16 * Math.sin(this.swayB), -MAX_LEAN, MAX_LEAN)
      const lens = clamp(num(I, 'lens', 0.5), 0, 1)
      const focal = 0.6 * Math.pow(10, 1 - lens)
      const D = focal * clamp(num(I, 'distance', 1.2), 0.3, 4) * (fill ? 1.4 : 1) * (panels > 1 ? Math.max(1, 1.15 / Math.max(0.3, vAsp)) : 1)
      const C: V3 = [D * Math.sin(yaw) * Math.cos(pitch), D * Math.sin(pitch), D * Math.cos(yaw) * Math.cos(pitch)]
      const F = norm([-C[0], -C[1], -C[2]])
      const R = norm(cross(F, [0, 1, 0]))
      const U = cross(R, F)
      let state = cutNow ? 1 - baseState : baseState
      if (panels > 1 && states && p % 2 === 1) state = 1 - state
      const axis = panels > 1 && cuts ? (secAxis + p) % 5 : secAxis
      const sec = panels > 1 && cuts ? Math.max(clamp(num(I, 'sections', 0), 0, 1), 0.7) : clamp(num(I, 'sections', 0), 0, 1)

      const setPlace = (pr: Prog): void => {
        pr.use()
          .i1('uPos', 0).i1('uCol', 1).i1('uLink', 2).i1('uSide', 3).i1('uH', 4)
          .i1('uSrc', picture ? 1 : 0).i1('uTexW', TEX_W)
          .i2('uGrid', gx, gy).f1('uAsp', asp).f1('uDepthAmt', clamp(num(I, 'depth', 0.5), 0, 1)).f1('uStride', stride)
          .f1('uVoxel', clamp(num(I, 'voxel', 0), 0, 1)).f1('uErode', clamp(num(I, 'erode', 0), 0, 1)).i1('uErodeFrom', Math.round(clamp(num(I, 'erodeFrom', 1), 0, 3)))
          .f1('uSec', sec).f1('uSecN', clamp(num(I, 'slices', 6), 1, 40)).f1('uSecThick', clamp(num(I, 'thick', 0.15), 0.01, 0.9))
          .f1('uSecBetween', clamp(num(I, 'between', 0.35), 0, 1)).f1('uSecPh', this.secPh).i1('uSecAxis', axis)
          .f1('uBrkAmt', clamp(num(I, 'break', 0.5), 0, 1)).f1('uBlock', clamp(num(I, 'blocks', 0.12), 0.02, 0.6))
          .f1('uShare', clamp(num(I, 'share', 0.5), 0, 1)).f1('uRebuild', rebuild).f1('uHold', hold)
          .f1('uSteps', Math.round(clamp(num(I, 'steps', 4), 0, 16))).f1('uReveal', clamp(num(I, 'reveal', 0.6), 0, 1))
          .f1('uState', state).f1('uGain', clamp(num(I, 'gain', 1), 0, 2)).f1('uFog', clamp(num(I, 'fog', 0.3), 0, 1))
          .f3('uInk', ink[0], ink[1], ink[2])
          .f3('uCam', ...C).f3('uR', ...R).f3('uU', ...U).f3('uF', ...F)
          .f1('uFocal', focal).f1('uDist', D).f1('uZFar', D * 3 + 6)
          .f2('uRes', vw, this.h).i1('uSquare', fill ? 1 : 0)
        gl.uniform4fv(pr.u('uBrk'), brkU)
      }
      g.bind(0, gpu ? gpu.pos : this.blank())
      g.bind(1, gpu ? gpu.col : this.blank())
      g.bind(2, gpu?.link ?? this.blank())
      g.bind(3, picture ? this.side! : this.blank())
      g.bind(4, picture ? this.hgt![this.hi].tex : this.blank())
      gl.bindVertexArray(g.pointVao)
      // the points
      setPlace(this.dotP)
      this.dotP.f1('uSize', radius).i1('uShape', Math.round(clamp(num(I, 'shape', 1), 0, 1)))
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, drawN)
      // the links
      if (links > 0.001 && (picture || gpu?.link)) {
        setPlace(this.linkP)
        // the picture's web : about 90 rows of it, whatever the points
        const ls = picture ? Math.max(1, Math.round(gy / 90)) : gpu!.linkStep
        const lgx = picture ? Math.ceil(gx / ls) : 0, lgy = picture ? Math.ceil(gy / ls) : 0
        this.linkP.f1('uLinks', links).i1('uLinkStep', ls).i2('uLinkGrid', lgx, lgy)
        gl.drawArraysInstanced(gl.LINES, 0, 2, (picture ? lgx * lgy : gpu!.linkN) * 2)
      }
      gl.bindVertexArray(null)
    }
    gl.disable(gl.SCISSOR_TEST)
    gl.viewport(0, 0, this.w, this.h)
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE)
    gl.disable(gl.DEPTH_TEST)
    for (let u = 4; u >= 0; u--) g.bind(u, null)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms.fbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.pic!.fbo)
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    this.showP.use().i1('uPic', 0)
    g.bind(0, this.pic!.tex)
    g.draw(targetFbo, this.w, this.h)
    g.done(5)
  }

  private clearTo(targetFbo: WebGLFramebuffer): void {
    const gl = this.g.gl
    const [gr, gg, gb] = col(this.inputs, 'ground', [0, 0, 0])
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.clearColor(gr, gg, gb, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  dispose(): void {
    const g = this.g, gl = g.gl
    this.depthRead.dispose()
    this.freeCloud()
    if (this.hgt) for (const t of this.hgt) g.freeTarget(t)
    this.hgt = null
    g.freeTarget(this.pic)
    this.pic = null
    if (this.blankTex) gl.deleteTexture(this.blankTex)
    this.blankTex = null
    g.dispose()
    releaseMsaa(gl)
  }
}

// a file's cloud, made once per mesh read (shared by every slot that shows it)
const fileClouds = new WeakMap<object, Cloud>()

export { PLACE_NAMES }
