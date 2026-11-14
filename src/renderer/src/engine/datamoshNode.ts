// Datamosh (the native node 'node-datamosh') : the look of a compressed video whose
// keyframes went missing, made in real time without any codec. Written for Palinopsia
// from the published literature only; every shader here is its own.
//
// The codec it imitates (ITU-T Rec. H.264 / ISO/IEC 14496-10, and the MPEG family
// before it) cuts the picture in macroblocks. An I-frame carries the whole picture; a
// P-frame carries, per macroblock, a motion vector (where to copy the block from in
// the frame before) and a residual (what the copy got wrong); colour travels at half
// the resolution (4:2:0). Take the I-frames away and the P-frames' vectors keep moving
// a picture that is no longer theirs : the smear, the melt and the bloom described in
//   W. Brown and M. Kutty, "Datamoshing and the emergence of digital complexity from
//   digital chaos", Convergence 18(2), 2012, pp. 165-176. doi:10.1177/1354856511433683
//
// Here, every frame :
// 1. THE VECTORS. The flow source (the layer, or the sidechain for motion transfer) is
//    brought down to luma on an N x N grid, smoothed, and compared with the frame before by the
//    Lucas-Kanade pass (flowEstimator.ts : Lucas and Kanade 1981, on Horn and Schunck's
//    1981 brightness constancy constraint). It runs at two sizes, N and N / 4, and the
//    small one answers where the motion is too fast for the large one : the coarse
//    level of the pyramid in
//      J.-Y. Bouguet, "Pyramidal implementation of the Lucas Kanade feature tracker :
//      description of the algorithm", Intel Corporation, Microprocessor Research Labs,
//      2000
//    used as a choice between two levels, without his warp and refinement. The field
//    is then smoothed (a separable binomial blur, weighted by the vectors' length so
//    that a moving shape's flat inside takes the motion of its rim), gated by the
//    motion floor, turned (swirl), and for the fluid mode averaged over time.
// 2. MOTION COMPENSATION. The accumulator (full size, straight RGBA, half float) is
//    read backwards along the field, acc(uv - d) : the semi-Lagrangian advection of
//      J. Stam, "Stable Fluids", Proc. SIGGRAPH 1999, pp. 121-128.
//      doi:10.1145/311535.311548
//    which is also what a P-frame does. STICKY takes one vector per macroblock and
//    moves the block by whole pixels (a rigid tile : it tears at the block's edges);
//    MELT and FLUID take a vector per pixel and read between pixels (a soft smear).
//    Colour (the difference to luma) is carried at half resolution with the vector of
//    a block twice the size, and corrected more slowly : chroma bleed.
// 3. THE CORRECTION, in two bands (the live frame and the moved history are each split
//    with a blurred copy of themselves) :
//      out = H + aL (blur(live) - blur(H)) + aH ((live - blur(live)) - (H - blur(H)))
//    PERSISTENCE keeps the history (the coarse band forgets at its rate, the detail
//    more slowly), REFRESH (the I-frame) pulls both bands to the live frame, RESIDUAL
//    pulls the detail only : the live picture's detail drawn in the old picture's
//    colours. Where the history already is the live frame, nothing changes : a still
//    picture stays exact.
//    RESEED snaps random macroblocks back, MANIFEST lets the live frame through where
//    there is motion, MOSH GATE holds only what moves (or only what is still), and
//    inside an ACTANT (a drifting, fading mask) nothing is corrected at all.
// 4. THE BLOOM. A trigger, a clock or a detected cut (the frame's mean luma change or
//    mean flow jumps over its running average; found on the GPU by reducing to one
//    texel, never read back) sets an envelope that takes REFRESH to 0 and PERSISTENCE
//    to 1 for about 0.4 s : the scene before is dragged by the new scene's motion.
//
// Every rate is per 60 Hz frame and raised to the frames that passed, so the look is
// the same at any frame rate and a rack at dt = 0 is a still picture.

import type { ConvNode, NodeContext } from './convNodes'
import { glGeneration } from './glGeneration'
import { F_FLOW_LK } from './flowEstimator'

const num = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)

/** The motion floor's unit : `thresh` / THRESH_DIV is a speed in picture heights per 60 Hz frame. */
const THRESH_DIV = 16
/** The speed (picture heights per 60 Hz frame) that counts as fully moving, for manifest and the gate. */
const MOVING = 0.003
/** The bloom's envelope, per 60 Hz frame (0.4 s after the hit it is at an eighth). */
const BLOOM_K = 0.917
/** The fluid mode's average : about 0.3 s. */
const FLUID_K = 1 - Math.exp(-1 / 18)
const BLOBS = 3
/** The luma's smoothing before the flow pass : the kernel's step, in texels (its sigma is 1.41 of them). */
const LUMA_BLUR = 1.0

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
in vec2 vUV; out vec4 o;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// nothing unfinite goes in or out (a comparison with itself is false for a NaN)
vec4 finite(vec4 c) {
  return vec4(c.x == c.x ? c.x : 0.0, c.y == c.y ? c.y : 0.0, c.z == c.z ? c.z : 0.0, c.w == c.w ? c.w : 0.0);
}
vec4 safe(vec4 c) {
  c = finite(c);
  return vec4(clamp(c.rgb, 0.0, 4096.0), clamp(c.a, 0.0, 1.0));
}
`

// the flow source's luma (covered by its alpha) on the grid : 16 taps over the texel
const LUMA_FS = `${HEAD}
uniform sampler2D uT;
uniform vec2 uCell; // a grid texel, in uv
void main() {
  float l = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec4 c = safe(texture(uT, vUV + (vec2(float(i), float(j)) - 1.5) * 0.25 * uCell));
    l += dot(c.rgb, LUMA) * c.a;
  }
  o = vec4(clamp(l / 16.0, 0.0, 1.0), 0.0, 0.0, 1.0);
}`

// 4 taps on the diagonals : a tent blur (half a texel out), a 4x reduction (a source
// texel out), premultiplied on the way for a picture
const TAP4_FS = `${HEAD}
uniform sampler2D uT;
uniform vec2 uOff;
uniform float uPremul;
vec4 tap(vec2 q) {
  vec4 c = texture(uT, q);
  if (uPremul > 0.5) { c = safe(c); c.rgb *= c.a; }
  return c;
}
void main() {
  o = 0.25 * (tap(vUV + uOff) + tap(vUV - uOff) + tap(vUV + vec2(uOff.x, -uOff.y)) + tap(vUV + vec2(-uOff.x, uOff.y)));
}`

// the blurred copy of a picture (a quarter of its size) : 9 taps, a tent; back to
// straight color
const QBLUR_FS = `${HEAD}
uniform sampler2D uT;
uniform vec2 uPx;
void main() {
  vec4 s = vec4(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    float w = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0);
    s += w * texture(uT, vUV + vec2(float(i), float(j)) * 1.25 * uPx);
  }
  s /= 16.0;
  o = vec4(s.a > 1e-5 ? s.rgb / s.a : vec3(0.0), s.a);
}`

// The luma's smoothing, one way then the other : the binomial row of 9 in 5 taps. The
// flow pass takes its gradients over 6 texels; detail finer than that would read as
// motion the wrong way.
const GAUSS_FS = `${HEAD}
uniform sampler2D uT;
uniform vec2 uStep;
void main() {
  o = texture(uT, vUV) * 0.2734375
    + (texture(uT, vUV + uStep * 1.3333333) + texture(uT, vUV - uStep * 1.3333333)) * 0.328125
    + (texture(uT, vUV + uStep * 3.1111111) + texture(uT, vUV - uStep * 3.1111111)) * 0.03515625;
}`

// the two levels of flow : the small grid answers where the motion is fast
const MERGE_FS = `${HEAD}
uniform sampler2D uFine, uCoarse;
uniform float uTexels; // N / 256 : the field's unit, in texels of the large grid
void main() {
  vec2 f = texture(uFine, vUV).xy;
  vec2 c = texture(uCoarse, vUV).xy;
  float k = smoothstep(0.75, 2.0, length(c) * uTexels);
  o = vec4(mix(f, c, k), 0.0, 1.0);
}`

// The field's smoothing, across : the binomial row of 9 (1 8 28 56 70 56 28 8 1) read
// in 5 taps between texels. Each vector weighs its own length : xy the weighted sum,
// z the sum of the weights.
const BLURH_FS = `${HEAD}
uniform sampler2D uT;
uniform vec2 uStep;
vec3 tap(float k) {
  vec2 f = texture(uT, vUV + uStep * k).xy;
  float w = length(f);
  return vec3(f * w, w);
}
void main() {
  vec3 s = tap(0.0) * 0.2734375
    + (tap(1.3333333) + tap(-1.3333333)) * 0.328125
    + (tap(3.1111111) + tap(-3.1111111)) * 0.03515625;
  o = vec4(s, 1.0);
}`

// The field, as the picture is moved by it. Down the blur, then : uv per 60 Hz frame,
// the motion floor, the swirl, the gain, the push along the picture's edges, and for
// the fluid mode the average over time.
// xy : the displacement (uv per 60 Hz frame)   z : how much it moves here, 0..1
const FIELD_FS = `${HEAD}
uniform sampler2D uT, uPrev, uBlur;
uniform vec2 uStep, uQ, uRot;
uniform float uToUv, uAsp, uThresh, uSign, uMotion, uEdge, uEma, uZero, uFill;
vec3 tap(float k) { return texture(uT, vUV + uStep * k).xyz; }
float lb(vec2 q) { vec4 c = texture(uBlur, q); return dot(c.rgb, LUMA) * c.a; }
void main() {
  vec3 s = tap(0.0) * 0.2734375
    + (tap(1.3333333) + tap(-1.3333333)) * 0.328125
    + (tap(3.1111111) + tap(-3.1111111)) * 0.03515625;
  // in picture heights per 60 Hz frame, square whatever the picture's shape
  vec2 v = s.xy / (s.z + uFill) * uToUv * uSign * vec2(uAsp, 1.0);
  float mag = length(v);
  if (uThresh > 0.0) {
    float g = smoothstep(0.5 * uThresh, 1.5 * uThresh, mag);
    v *= g; mag *= g;
  }
  float m = smoothstep(0.0, ${MOVING.toFixed(4)}, mag);
  v = vec2(uRot.x * v.x - uRot.y * v.y, uRot.y * v.x + uRot.x * v.y) * uMotion;
  if (uEdge != 0.0) {
    vec2 g = 0.5 * vec2(lb(vUV + vec2(uQ.x, 0.0)) - lb(vUV - vec2(uQ.x, 0.0)), lb(vUV + vec2(0.0, uQ.y)) - lb(vUV - vec2(0.0, uQ.y)));
    vec2 e = g * 0.04 * uEdge;
    float el = length(e);
    v += el > 0.006 ? e * (0.006 / el) : e;
  }
  vec3 f = vec3(v / vec2(uAsp, 1.0), m) * (1.0 - uZero);
  f = mix(texture(uPrev, vUV).xyz, f, uEma);
  o = finite(vec4(f, 1.0));
}`

// the frame's change, in 16 x 16 cells : x the mean luma difference, y the mean flow
const STATS_FS = `${HEAD}
uniform sampler2D uCur, uPrev, uFlow;
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 s = vec2(0.0);
  for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) {
    vec2 q = (cell + (vec2(float(i), float(j)) + 0.5) / 8.0) / 16.0;
    s.x += abs(texture(uCur, q).r - texture(uPrev, q).r);
    s.y += length(texture(uFlow, q).xy);
  }
  o = vec4(s / 64.0, 0.0, 1.0);
}`

const STATS1_FS = `${HEAD}
uniform sampler2D uT;
void main() {
  vec2 s = vec2(0.0);
  for (int j = 0; j < 16; j++) for (int i = 0; i < 16; i++) s += texelFetch(uT, ivec2(i, j), 0).xy;
  o = vec4(s / 256.0, 0.0, 1.0);
}`

// The bloom's state, one texel : r the envelope, g b the running averages of the
// frame's luma change and flow, a 1 on the frame a cut was found.
const STATE_FS = `${HEAD}
uniform sampler2D uPrev, uStats;
uniform float uFrames, uFire, uAuto, uSense, uReset, uBlind;
void main() {
  vec4 s = uReset > 0.5 ? vec4(0.0) : texelFetch(uPrev, ivec2(0), 0);
  vec2 st = uBlind > 0.5 ? s.gb : texelFetch(uStats, ivec2(0), 0).xy;
  float env = s.r * pow(${BLOOM_K}, uFrames);
  // a cut : the change jumps over what it has been
  vec2 jump = st - 1.5 * s.gb;
  float cut = uAuto > 0.0 ? max(step(uSense * 0.25, jump.x), step(uSense * 6.0, jump.y)) : 0.0;
  env = max(env, max(uFire, cut * uAuto));
  float a = 1.0 - pow(0.95, uFrames);
  vec2 avg = mix(s.gb, min(st, 2.0 * s.gb + vec2(0.02, 0.3)), a);
  o = finite(vec4(clamp(env, 0.0, 1.0), avg, cut));
}`

// the actants' mask : carried by the flow, fading, new blobs dropped in
const MASK_FS = `${HEAD}
uniform sampler2D uPrev, uField;
uniform float uFrames, uKeep, uAsp;
uniform int uDrop;
uniform vec3 uBlob[${BLOBS}]; // x y, radius (picture heights)
void main() {
  vec2 q = vUV - texture(uField, vUV).xy * uFrames;
  float m = texture(uPrev, q).r * uKeep;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) m = 0.0;
  for (int i = 0; i < ${BLOBS}; i++) {
    if (i >= uDrop) break;
    vec2 d = (vUV - uBlob[i].xy) * vec2(uAsp, 1.0);
    m = max(m, 1.0 - smoothstep(0.35 * uBlob[i].z, uBlob[i].z, length(d)));
  }
  o = vec4(m == m ? clamp(m, 0.0, 1.0) : 0.0, 0.0, 0.0, 1.0);
}`

// the accumulator's frame : moved, then corrected
const MAIN_FS = `${HEAD}
uniform sampler2D uAcc, uAccBlur, uHost, uHostBlur, uField, uMask, uState;
uniform vec2 uRes;
uniform int uMode;
uniform float uBlock, uFrames, uTick, uSeed;
uniform float uDecay, uRefresh, uResidual, uReseed, uManifest, uGate, uBleed, uActant;

// third-party: Hash without Sine
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// third-party: Hash without Sine
float hash13(vec3 p3) {
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// 1 - (1 - k)^frames : a per 60 Hz frame share, over the frames that passed
float over(float k) { return 1.0 - pow(clamp(1.0 - k, 1e-6, 1.0), uFrames); }

void main() {
  vec4 live = safe(texture(uHost, vUV));
  if (uSeed > 0.5) { o = live; return; }
  vec2 px = gl_FragCoord.xy;
  vec2 bq = floor(px / uBlock);            // the macroblock
  vec2 bc = (bq + 0.5) * uBlock / uRes;    // its centre
  vec4 liveB = texture(uHostBlur, vUV);
  float env = texelFetch(uState, ivec2(0), 0).r;

  // ── the vector : one per macroblock (its mean), or one per pixel ──
  vec3 F;
  if (uMode == 1) {
    vec2 h = 0.25 * uBlock / uRes;
    F = 0.2 * (texture(uField, bc).xyz + texture(uField, bc + h).xyz + texture(uField, bc - h).xyz
      + texture(uField, bc + vec2(h.x, -h.y)).xyz + texture(uField, bc + vec2(-h.x, h.y)).xyz);
  } else F = texture(uField, vUV).xyz;
  vec2 d = F.xy * uFrames;
  float m = F.z;

  // ── motion compensation : the history, read backwards along the vector ──
  // a block moves by whole pixels (a rigid tile, read on the pixel); what is left of
  // the vector is handed out over the frames, each block on its own beat
  float beat = fract(hash12(bq) + uTick * 0.61803399);
  vec2 src = uMode == 1 ? (px - floor(d * uRes + beat)) / uRes : vUV - d;
  vec4 H = texture(uAcc, src);

  // ── chroma : at half resolution, on the vector of a block twice the size ──
  if (uBleed > 0.0) {
    float cb = uBlock * 2.0;
    vec2 cq = floor(px / cb);
    vec2 dc = texture(uField, (cq + 0.5) * cb / uRes).xy * uFrames;
    vec2 site = floor(px * 0.5) * 2.0 + 1.0; // the corner 4 pixels share : their mean
    float cbeat = fract(hash12(cq + 71.3) + uTick * 0.61803399);
    vec2 cs = uMode == 1 ? (site - 2.0 * floor(dc * uRes * 0.5 + cbeat)) / uRes : site / uRes - dc;
    vec3 Hc = texture(uAcc, cs).rgb;
    float y = dot(H.rgb, LUMA);
    H.rgb = y + mix(H.rgb - y, Hc - dot(Hc, LUMA), uBleed);
  }
  vec4 Hb = texture(uAccBlur, vUV - d);

  // ── the bloom : no I-frame, the history held ──
  float decay = mix(uDecay, 1.0, env);
  float refresh = uRefresh * (1.0 - env);

  // ── how much of the difference to the live frame is corrected, in each band ──
  float keepL = pow(max(decay, 1e-6), uFrames) * (1.0 - over(refresh));
  float keepH = pow(max(decay, 1e-6), 0.3 * uFrames) * (1.0 - over(refresh)) * (1.0 - over(0.5 * uResidual));
  // the gate : the hold stays where it moves (+) or where it is still (-)
  float hold = uGate >= 0.0 ? mix(1.0, m, uGate) : mix(1.0, 1.0 - m, -uGate);
  float loose = 1.0 - over(0.25);
  keepL = mix(min(keepL, loose), keepL, hold);
  keepH = mix(min(keepH, loose), keepH, hold);
  // manifest : the live frame comes through where there is motion
  float man = 1.0 - over(clamp(m * uManifest, 0.0, 1.0));
  keepL *= man; keepH *= man;
  // reseed : some macroblocks snap back
  float snap = hash13(vec3(bq, uTick)) < over(uReseed * 0.05) ? 1.0 : 0.0;
  keepL *= 1.0 - snap; keepH *= 1.0 - snap;
  // an actant : nothing is corrected inside it
  if (uActant > 0.0) {
    float a = smoothstep(0.15, 0.5, texture(uMask, uMode == 1 ? bc : vUV).r) * uActant;
    keepL = mix(keepL, 1.0, a); keepH = mix(keepH, 1.0, a);
    snap *= 1.0 - a;
  }

  vec4 corr = (1.0 - keepL) * (liveB - Hb) + (1.0 - keepH) * ((live - liveB) - (H - Hb));
  // (colour is corrected more slowly than luma)
  float cy = dot(corr.rgb, LUMA);
  corr.rgb = cy + (corr.rgb - cy) * (1.0 - 0.75 * uBleed * (1.0 - snap));
  o = safe(H + corr);
}`

// re-sharpen : the result against a slightly blurred copy of itself
const SHARP_FS = `${HEAD}
uniform sampler2D uT;
uniform vec2 uOff;
uniform float uAmt;
void main() {
  vec4 c = texture(uT, vUV);
  vec4 b = 0.25 * (texture(uT, vUV + uOff) + texture(uT, vUV - uOff) + texture(uT, vUV + vec2(uOff.x, -uOff.y)) + texture(uT, vUV + vec2(-uOff.x, uOff.y)));
  o = safe(c + uAmt * (c - b));
}`

interface Tex { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }
interface Prog { p: WebGLProgram; locs: Map<string, WebGLUniformLocation | null> }
type Pair = [Tex, Tex]

function compile(gl: WebGL2RenderingContext, fs: string, name: string): Prog {
  const mk = (t: number, s: string): WebGLShader => {
    const sh = gl.createShader(t)!
    gl.shaderSource(sh, s)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`[datamosh] ${name} : ` + (gl.getShaderInfoLog(sh) || 'shader'))
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
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`[datamosh] ${name} : ` + (gl.getProgramInfoLog(p) || 'link'))
  return { p, locs: new Map() }
}

const SHADERS = {
  luma: LUMA_FS, tap4: TAP4_FS, gauss: GAUSS_FS, qblur: QBLUR_FS, lk: F_FLOW_LK, merge: MERGE_FS, blurH: BLURH_FS, field: FIELD_FS,
  stats: STATS_FS, stats1: STATS1_FS, state: STATE_FS, mask: MASK_FS, main: MAIN_FS, sharp: SHARP_FS
}
type Progs = Record<keyof typeof SHADERS, Prog>

/** Everything sized on the flow grid. */
interface Grid {
  lumaRaw: Tex
  lumaTmp: Tex
  lumaCRaw: Tex
  lumaCTmp: Tex
  luma: Pair // N, this frame and the one before
  lumaC: Pair // N / 4
  flowF: Tex
  flowC: Tex
  flowM: Tex
  flowH: Tex
  field: Pair
  mask: Pair
  stats: Tex // 16 x 16
  stats1: Tex // 1 x 1
  state: Pair // 1 x 1
}
/** Everything sized on the picture. */
interface Full {
  acc: Pair
  out: Tex | null // the re-sharpened picture, made when first asked for
  qTmp: Tex // a quarter of the picture
  hostBlur: Tex
  accBlur: Tex
}

const UNITS = 7

export class DatamoshNode implements ConvNode {
  private gen = -1
  private progs: Progs | null = null
  private vao: WebGLVertexArrayObject | null = null
  private quad: WebGLBuffer | null = null
  private grid: Grid | null = null
  private full: Full | null = null
  private key = ''
  private disposed = false
  // which of each pair holds this frame
  private ai = 0 // the accumulator
  private li = 0 // luma
  private fi = 0 // the field
  private mi = 0 // the actants' mask
  private si = 0 // the bloom's state
  private last: WebGLTexture | null = null // what was returned last
  private lastFrame = -2
  private blind = true // the frame before is not known : no flow, no cut
  private tick = 0
  // triggers and clocks
  private prevTrig = 0
  private prevActTrig = 0
  private bloomDue = false
  private dropDue = false
  private pulseAcc = 0
  private actAcc = 0
  private maskLive = false
  private aBlob = new Float32Array(BLOBS * 3)

  constructor(private gl: WebGL2RenderingContext) {}

  private u(pr: Prog, n: string): WebGLUniformLocation | null {
    let l = pr.locs.get(n)
    if (l === undefined) { l = this.gl.getUniformLocation(pr.p, n); pr.locs.set(n, l) }
    return l
  }

  private target(w: number, h: number, one = false): Tex {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (one) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, null)
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
    const g = this.grid, f = this.full
    if (g) {
      for (const t of [g.lumaRaw, g.lumaTmp, g.lumaCRaw, g.lumaCTmp, ...g.luma, ...g.lumaC, g.flowF, g.flowC, g.flowM, g.flowH, ...g.field, ...g.mask, g.stats, g.stats1, ...g.state]) this.free(t)
    }
    if (f) for (const t of [...f.acc, f.out, f.qTmp, f.hostBlur, f.accBlur]) this.free(t)
    this.grid = null
    this.full = null
    this.last = null
  }

  private clear(t: Tex): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  private ensureGL(): void {
    const gl = this.gl
    if (this.gen === glGeneration() && this.progs) return
    // (after a lost context everything made before is dead : nothing to free)
    this.gen = glGeneration()
    this.grid = null
    this.full = null
    this.last = null
    this.key = ''
    gl.getExtension('EXT_color_buffer_float')
    const progs = {} as Progs
    for (const k of Object.keys(SHADERS) as (keyof typeof SHADERS)[]) progs[k] = compile(gl, SHADERS[k], k)
    this.progs = progs
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

  /** Make `pr` the program, with `texs` on the units 0.. under the given uniform names. */
  private use(pr: Prog, texs: [string, WebGLTexture][]): void {
    const gl = this.gl
    gl.useProgram(pr.p)
    for (let i = 0; i < texs.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, texs[i][1])
      gl.uniform1i(this.u(pr, texs[i][0]), i)
    }
  }

  private f1(pr: Prog, n: string, v: number): void { this.gl.uniform1f(this.u(pr, n), v) }
  private f2(pr: Prog, n: string, x: number, y: number): void { this.gl.uniform2f(this.u(pr, n), x, y) }

  private draw(t: Tex): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.viewport(0, 0, t.w, t.h)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** A picture's blurred copy : a quarter of its size, straight color. */
  private blurred(src: WebGLTexture, W: number, H: number, to: Tex): void {
    const P = this.progs!, F = this.full!
    this.use(P.tap4, [['uT', src]])
    this.f2(P.tap4, 'uOff', 1 / W, 1 / H)
    this.f1(P.tap4, 'uPremul', 1)
    this.draw(F.qTmp)
    this.use(P.qblur, [['uT', F.qTmp.tex]])
    this.f2(P.qblur, 'uPx', 1 / F.qTmp.w, 1 / F.qTmp.h)
    this.draw(to)
  }

  private finish(): void {
    const gl = this.gl
    for (let i = UNITS - 1; i >= 0; i--) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null) }
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = this.gl
    if (gl.isContextLost()) return ctx.host
    this.ensureGL()
    const P = this.progs!
    const I = ctx.inputs
    const W = Math.max(1, ctx.chain.w | 0), H = Math.max(1, ctx.chain.h | 0)
    const N = [128, 256, 512][clamp(Math.round(num(I.flowRes, 1)), 0, 2)]
    const NC = N / 4

    // ── the targets : made when a size changes ──
    const key = `${W}x${H}|${N}`
    let seed = false
    if (key !== this.key || !this.grid || !this.full) {
      this.freeTargets()
      const qw = Math.max(1, Math.ceil(W / 4)), qh = Math.max(1, Math.ceil(H / 4))
      this.full = {
        acc: [this.target(W, H), this.target(W, H)],
        out: null,
        qTmp: this.target(qw, qh),
        hostBlur: this.target(qw, qh),
        accBlur: this.target(qw, qh)
      }
      this.grid = {
        lumaRaw: this.target(N, N, true),
        lumaTmp: this.target(N, N, true),
        lumaCRaw: this.target(NC, NC, true),
        lumaCTmp: this.target(NC, NC, true),
        luma: [this.target(N, N, true), this.target(N, N, true)],
        lumaC: [this.target(NC, NC, true), this.target(NC, NC, true)],
        flowF: this.target(N, N),
        flowC: this.target(NC, NC),
        flowM: this.target(N, N),
        flowH: this.target(N, N),
        field: [this.target(N, N), this.target(N, N)],
        mask: [this.target(N, N, true), this.target(N, N, true)],
        stats: this.target(16, 16),
        stats1: this.target(1, 1),
        state: [this.target(1, 1), this.target(1, 1)]
      }
      this.key = key
      seed = true
    }
    const G = this.grid, F = this.full

    // a gap in the frames : the node was off, or just put in
    const frame = ctx.frame
    if (frame !== undefined) {
      if (frame !== this.lastFrame + 1) seed = true
      this.lastFrame = frame
    }
    if (!this.last) seed = true

    // ── inputs ──
    const mode = clamp(Math.round(num(I.mode, 1)), 0, 2)
    const motion = clamp(num(I.motion, 1), 0, 4)
    const swirl = clamp(num(I.swirl, 0), -1, 1)
    const invert = num(I.flowInvert, 0) >= 0.5
    const block = Math.max(2, Math.round(clamp(num(I.block, 16), 2, 64) * H / 1080))
    const decay = clamp(num(I.decay, 0.92), 0, 1)
    const refresh = clamp(num(I.refresh, 0.06), 0, 1)
    const residual = clamp(num(I.residual, 0.15), 0, 1)
    const reseed = clamp(num(I.reseed, 0.1), 0, 1)
    const manifest = clamp(num(I.manifest, 0), 0, 1)
    const thresh = clamp(num(I.thresh, 0.012), 0, 0.1)
    const gate = clamp(num(I.moshGate, 0), -1, 1)
    const edge = clamp(num(I.edgeRepel, 0), -1, 1)
    const resharp = clamp(num(I.resharp, 0), 0, 1)
    const bleed = clamp(num(I.bleed, 0.2), 0, 1)
    const autoBloom = clamp(num(I.autoBloom, 0.7), 0, 1)
    const cutSense = clamp(num(I.cutSense, 0.35), 0.02, 1)
    const pulse = clamp(num(I.pulse, 0), 0, 8)
    const actant = clamp(num(I.actant, 0), 0, 1)
    const actantLife = clamp(num(I.actantLife, 0.6), 0, 1)
    const actantRate = clamp(num(I.actantRate, 0), 0, 8)
    const flowSrc = ctx.sidechain && num(I.sidechainFlow, 0) >= 0.5 ? ctx.sidechain : ctx.host

    // ── triggers (a rising edge waits for the next frame that runs) and clocks ──
    const dt = Number.isFinite(ctx.dt) ? Math.max(0, ctx.dt) : 0
    const frames = clamp(dt * 60, 0, 8)
    const trig = num(I.trig, 0)
    if (trig >= 0.5 && this.prevTrig < 0.5) this.bloomDue = true
    this.prevTrig = trig
    const actTrig = num(I.actantTrig, 0)
    if (actTrig >= 0.5 && this.prevActTrig < 0.5) this.dropDue = true
    this.prevActTrig = actTrig
    if (pulse > 0) {
      this.pulseAcc += Math.min(dt, 0.25) * pulse
      if (this.pulseAcc >= 1) { this.pulseAcc %= 1; this.bloomDue = true }
    } else this.pulseAcc = 0
    if (actantRate > 0) {
      this.actAcc += Math.min(dt, 0.25) * actantRate
      if (this.actAcc >= 1) { this.actAcc %= 1; this.dropDue = true }
    } else this.actAcc = 0

    // ── frozen : the same picture, and the frame before is no longer known ──
    if (!seed && frames <= 0) {
      this.blind = true
      return this.last!
    }

    const asp = W / H
    const blind = seed || this.blind

    // ── the flow source's luma, on the grid and on the small grid ──
    this.li = 1 - this.li
    const lc = this.li, lp = blind ? lc : 1 - lc
    this.use(P.luma, [['uT', flowSrc]])
    this.f2(P.luma, 'uCell', 1 / N, 1 / N)
    this.draw(G.lumaRaw)
    // (the small grid is reduced from the unsmoothed one, then smoothed on its own scale)
    this.use(P.tap4, [['uT', G.lumaRaw.tex]])
    this.f2(P.tap4, 'uOff', 1 / N, 1 / N)
    this.f1(P.tap4, 'uPremul', 0)
    this.draw(G.lumaCRaw)
    const smooth = (from: Tex, tmp: Tex, to: Tex): void => {
      this.use(P.gauss, [['uT', from.tex]])
      this.f2(P.gauss, 'uStep', LUMA_BLUR / from.w, 0)
      this.draw(tmp)
      this.use(P.gauss, [['uT', tmp.tex]])
      this.f2(P.gauss, 'uStep', 0, LUMA_BLUR / from.h)
      this.draw(to)
    }
    smooth(G.lumaRaw, G.lumaTmp, G.luma[lc])
    smooth(G.lumaCRaw, G.lumaCTmp, G.lumaC[lc])

    // ── the live frame's blurred copy ──
    this.blurred(ctx.host, W, H, F.hostBlur)

    if (seed) {
      // the live frame is the history; nothing moves, no bloom, no actant
      for (const t of [...G.field, ...G.mask, ...G.state]) this.clear(t)
      this.maskLive = false
      this.bloomDue = false
      this.dropDue = false
      this.pulseAcc = 0
      this.actAcc = 0
    } else {
      // ── the vectors : Lucas-Kanade on the grid and on the small grid ──
      const lk = (cur: Tex, prev: Tex, to: Tex, n: number): void => {
        this.use(P.lk, [['uCur', cur.tex], ['uPrev', prev.tex]])
        this.f2(P.lk, 'uRes', n, n)
        this.f1(P.lk, 'uLambda', 0.001)
        this.f1(P.lk, 'uClamp', 3 * 256 / n)
        this.f1(P.lk, 'uScale', 256 / n)
        this.draw(to)
      }
      lk(G.luma[lc], G.luma[lp], G.flowF, N)
      lk(G.lumaC[lc], G.lumaC[lp], G.flowC, NC)
      this.use(P.merge, [['uFine', G.flowF.tex], ['uCoarse', G.flowC.tex]])
      this.f1(P.merge, 'uTexels', N / 256)
      this.draw(G.flowM)
      // smoothed over the same share of the picture whatever the grid
      const st = N / 256
      this.use(P.blurH, [['uT', G.flowM.tex]])
      this.f2(P.blurH, 'uStep', st / N, 0)
      this.draw(G.flowH)

      // ── the field ──
      this.fi = 1 - this.fi
      const a = swirl * Math.PI * 0.5
      this.use(P.field, [['uT', G.flowH.tex], ['uPrev', G.field[1 - this.fi].tex], ['uBlur', F.hostBlur.tex]])
      this.f2(P.field, 'uStep', 0, st / N)
      this.f2(P.field, 'uQ', 1 / F.hostBlur.w, 1 / F.hostBlur.h)
      this.f2(P.field, 'uRot', Math.cos(a), Math.sin(a))
      // (the flow is what moved since the frame before : per 60 Hz frame, divided by the frames that passed)
      this.f1(P.field, 'uToUv', 1 / (256 * Math.max(dt * 60, 0.05)))
      this.f1(P.field, 'uAsp', asp)
      this.f1(P.field, 'uThresh', thresh / THRESH_DIV)
      this.f1(P.field, 'uSign', invert ? -1 : 1)
      this.f1(P.field, 'uMotion', motion)
      this.f1(P.field, 'uEdge', edge)
      this.f1(P.field, 'uEma', mode === 2 ? 1 - Math.pow(1 - FLUID_K, frames) : 1)
      this.f1(P.field, 'uZero', blind ? 1 : 0)
      this.f1(P.field, 'uFill', 0.08)
      this.draw(G.field[this.fi])

      // ── the frame's change, down to one texel, and the bloom's state ──
      this.use(P.stats, [['uCur', G.luma[lc].tex], ['uPrev', G.luma[lp].tex], ['uFlow', G.flowM.tex]])
      this.draw(G.stats)
      this.use(P.stats1, [['uT', G.stats.tex]])
      this.draw(G.stats1)
      this.si = 1 - this.si
      this.use(P.state, [['uPrev', G.state[1 - this.si].tex], ['uStats', G.stats1.tex]])
      this.f1(P.state, 'uFrames', frames)
      this.f1(P.state, 'uFire', this.bloomDue ? 1 : 0)
      this.f1(P.state, 'uAuto', autoBloom)
      this.f1(P.state, 'uSense', cutSense)
      this.f1(P.state, 'uReset', 0)
      this.f1(P.state, 'uBlind', blind ? 1 : 0)
      this.draw(G.state[this.si])
      this.bloomDue = false

      // ── the actants ──
      if (actant > 0) {
        const drop = this.dropDue
        if (drop) {
          for (let i = 0; i < BLOBS; i++) {
            this.aBlob[i * 3] = 0.12 + 0.76 * Math.random()
            this.aBlob[i * 3 + 1] = 0.12 + 0.76 * Math.random()
            this.aBlob[i * 3 + 2] = 0.07 + 0.09 * Math.random()
          }
        }
        if (drop || this.maskLive) {
          // 0 : a fraction of a second; 1 : several seconds
          const tau = 0.15 * Math.pow(40, actantLife)
          this.mi = 1 - this.mi
          this.use(P.mask, [['uPrev', G.mask[1 - this.mi].tex], ['uField', G.field[this.fi].tex]])
          this.f1(P.mask, 'uFrames', frames)
          this.f1(P.mask, 'uKeep', Math.exp(-(frames / 60) / tau))
          this.f1(P.mask, 'uAsp', asp)
          gl.uniform1i(this.u(P.mask, 'uDrop'), drop ? BLOBS : 0)
          gl.uniform3fv(this.u(P.mask, 'uBlob'), this.aBlob)
          this.draw(G.mask[this.mi])
          this.maskLive = true
        }
      } else if (this.maskLive) {
        this.clear(G.mask[0])
        this.clear(G.mask[1])
        this.maskLive = false
      }
      this.dropDue = false

      // ── the history's blurred copy ──
      this.blurred(F.acc[this.ai].tex, W, H, F.accBlur)
      this.tick = (this.tick + 1) % 4096
    }

    // ── the accumulator's frame ──
    const prev = F.acc[this.ai]
    this.ai = 1 - this.ai
    const acc = F.acc[this.ai]
    this.use(P.main, [
      ['uAcc', prev.tex], ['uAccBlur', F.accBlur.tex], ['uHost', ctx.host], ['uHostBlur', F.hostBlur.tex],
      ['uField', G.field[this.fi].tex], ['uMask', G.mask[this.mi].tex], ['uState', G.state[this.si].tex]
    ])
    this.f2(P.main, 'uRes', W, H)
    gl.uniform1i(this.u(P.main, 'uMode'), mode)
    this.f1(P.main, 'uBlock', block)
    this.f1(P.main, 'uFrames', frames)
    this.f1(P.main, 'uTick', this.tick)
    this.f1(P.main, 'uSeed', seed ? 1 : 0)
    this.f1(P.main, 'uDecay', decay)
    this.f1(P.main, 'uRefresh', refresh)
    this.f1(P.main, 'uResidual', residual)
    this.f1(P.main, 'uReseed', reseed)
    this.f1(P.main, 'uManifest', manifest)
    this.f1(P.main, 'uGate', gate)
    this.f1(P.main, 'uBleed', bleed)
    this.f1(P.main, 'uActant', this.maskLive ? actant : 0)
    this.draw(acc)
    this.blind = false

    // ── re-sharpen (the picture shown, never the history) ──
    let out = acc
    if (resharp > 0) {
      if (!F.out) F.out = this.target(W, H)
      const r = 1.5 * Math.max(1, H / 1080)
      this.use(P.sharp, [['uT', acc.tex]])
      this.f2(P.sharp, 'uOff', r / W, r / H)
      this.f1(P.sharp, 'uAmt', 1.5 * resharp)
      this.draw(F.out)
      out = F.out
    }
    this.finish()
    this.last = out.tex
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
    this.vao = null
    this.quad = null
  }
}
