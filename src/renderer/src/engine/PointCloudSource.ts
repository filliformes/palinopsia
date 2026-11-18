// PointCloudSource : the native Point Cloud generator (id 'gen-pointcloud'). A
// picture lifted into space : the layer picked as SIDECHAIN (or a picture of its
// own when none is) becomes hundreds of thousands of points, each carrying the
// picture's color where it sits, raised toward the camera by the picture's depth
// (the depth model, reading THAT picture) or by its brightness, and seen through
// an orbiting camera.
//
// How it holds still : every point has a home in the picture that never moves (a
// jittered grid dealt once from its index), so a changing picture only recolors
// and re-raises the points, it never re-deals them : no shimmer. STIPPLE thins the
// dark parts out by a threshold of each point's own (fixed), so a point fades out
// and back as the picture under it darkens, still in its place. The height the
// points stand on glides toward the picture's (SETTLE), so the depth model's ten
// maps a second and a flickering video move the relief smoothly.
//
// What moves them, all in the vertex shader, from their home each frame (nothing
// is simulated, so nothing drifts) :
// - SPLASH : on the sound's hits (or the beat, or the trigger) the points fly out
//   along directions of their own, most a little, a few far, losing speed, stirred
//   by a slow flow while they hang, then GATHER back home on an eased arc.
// - WIND : past a line across the picture (LINE AT, LINE ANGLE) the points live
//   short cycles : they leave home, blow away, thin out and form again, more of
//   them the farther past the line, with a ragged edge.
// - THE HAND : the mouse on the preview, every pinching hand, the Room's people :
//   the points part round it on the screen, and its motion drags a wake.
// - SCAN : a plane sweeping through the depth brightens and swells the points it
//   crosses.
//
// Drawn as instanced quads (no vertex data : everything from gl_InstanceID),
// depth-tested in the shared multisampled buffer, round and soft points through
// alpha to coverage. Straight alpha out over the GROUND color (its alpha : a
// transparent ground lets the layers below through between the points).
//
// Dome (full-dome fill) : stretched like any picture, the view kept square so the
// cloud stays round, and the camera standing back so it sits in the middle, clear
// of the rim. Never re-projected to true directions.
//
// third-party: Gather 聚 Lite (the idea : a picture as a depth-raised, orbitable
// point cloud that splashes on the kick and gathers back, wears away on the wind
// past a line, parts under the hand, with a scan plane through its depth)
// third-party: Hex Composer (the idea of drawing the picture as a 3D point field,
// brightness or another picture as its depth)
// Both written for Palinopsia from those ideas alone : no code taken.

import { EngineGL, SlotClock, Edge, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator, SourcePointer } from './nativeGenerators'
import { domeFill } from './domeSignal'
import { acquireMsaa, msaaBuffer, releaseMsaa } from './sharedMsaa'
import { TouchPoints, Onset } from './touchInput'
import { tempoBpm } from './tempoSignal'
import { PictureDepthReader, pictureDepth } from './pictureDepth'

/** The most points the cloud draws (DENSITY 1). */
export const POINTCLOUD_MAX = 640000
const MAX_SPLASH = 4
const MAX_HANDS = 8
const MAX_LEAN = 1.3963 // 80 degrees : the camera never looks straight down
const SYNC_BEATS = [0, 1, 2, 4, 8, 16]
const SPLASH_BEATS = [0, 1, 2, 4, 8, 0] // hits, beat, 2 beats, bar, 2 bars, by hand
const TAU = Math.PI * 2

// The picture of its own, when no layer is picked : a lit globe in bands, dunes,
// rings on water. rgb + its height (0 far, 1 near). uPh : a phase wrapped at 2 pi,
// read only at whole multiples so the wrap never shows.
const OWN_GLSL = `
uniform int uOwn;
uniform float uPh, uAsp;
vec4 ownPic(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(uAsp, 1.0);
  if (uOwn == 0) {
    float R = 0.34;
    float r = length(p) / R;
    float inside = 1.0 - smoothstep(0.97, 1.0, r);
    float z = sqrt(max(0.0, 1.0 - r * r));
    vec3 n = vec3(p / R, z);
    float bands = 0.5 + 0.5 * sin(p.y * 24.0 + 1.6 * sin(p.x * 7.0 + uPh) + uPh * 2.0);
    float lit = 0.18 + 0.82 * max(0.0, dot(n, normalize(vec3(-0.45, 0.55, 0.7))));
    vec3 c = mix(vec3(0.62, 0.3, 0.16), vec3(0.96, 0.86, 0.68), bands) * lit;
    float dust = (1.0 - inside) * 0.07 * (1.0 - smoothstep(1.0, 1.7, r));
    return vec4(c * inside + vec3(0.55, 0.5, 0.45) * dust, inside * (0.35 + 0.65 * z) + (1.0 - inside) * 0.1 * (1.0 - smoothstep(1.0, 1.7, r)));
  }
  if (uOwn == 1) {
    // dunes : sharp crests, a lit windward face and a shaded lee
    float w = p.x * 15.0 + 2.2 * sin(p.y * 3.0 + uPh) + 0.6 * sin(p.y * 9.0 - uPh * 2.0) + 1.5 * sin(p.x * 2.0 + p.y * 1.3);
    float f = fract(w / 6.2831853);
    float ridge = f < 0.7 ? f / 0.7 : (1.0 - f) / 0.3;
    float h = 0.12 + 0.75 * ridge * ridge * (0.7 + 0.3 * sin(p.y * 2.0 + p.x * 1.1));
    float lit = f < 0.7 ? 0.55 + 0.45 * ridge : 0.18;
    vec3 c = mix(vec3(0.3, 0.17, 0.09), vec3(0.98, 0.78, 0.52), lit) * (0.45 + 0.55 * h);
    return vec4(c, h);
  }
  float r = length(p);
  float wv = cos(r * 34.0 - uPh * 3.0) * exp(-r * 2.6);
  float h = 0.45 + 0.45 * wv;
  vec3 c = mix(vec3(0.02, 0.09, 0.12), vec3(0.55, 0.85, 0.88), clamp(0.5 + 0.8 * wv, 0.0, 1.0)) * (0.4 + 0.6 * exp(-r * 1.2));
  return vec4(c, h);
}`

// The height the points stand on, gliding toward the picture's.
const HEIGHT_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUV;
out vec4 o;
uniform sampler2D uPrev, uSide, uMap;
uniform int uMode;          // 0 its own picture, 1 brightness, 2 darkness, 3 the depth model's map
uniform float uK;           // how far toward the picture this frame (1 : at once)
uniform vec2 uCell;         // one grid cell, in uv
${OWN_GLSL}
float lumaA(vec2 uv) {
  vec4 c = texture(uSide, uv);
  return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)) * c.a;
}
void main() {
  float t;
  if (uMode == 0) t = ownPic(vUV).a;
  else if (uMode == 3) t = texture(uMap, vUV).r;
  else {
    // the cell's average : the picture's own detail would read as noise in the relief
    vec2 h = uCell * 0.25;
    float l = 0.25 * (lumaA(vUV + vec2(-h.x, -h.y)) + lumaA(vUV + vec2(h.x, -h.y)) + lumaA(vUV + vec2(-h.x, h.y)) + lumaA(vUV + vec2(h.x, h.y)));
    t = uMode == 2 ? 1.0 - l : l;
  }
  float p = texture(uPrev, vUV).r;
  o = vec4(mix(p, clamp(t, 0.0, 1.0), uK), 0.0, 0.0, 1.0);
}`

const DOT_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uSide, uH;
uniform int uHasSide, uShape, uSquare;
uniform ivec2 uGrid;          // points across, down
uniform float uJitter, uStipple, uGain, uDepth, uFog;
uniform vec3 uCam, uR, uU, uF; // camera position and basis (right, up, forward)
uniform float uFocal, uDist, uZFar;
uniform vec2 uRes;
uniform float uSize;          // point radius, world units (a share of the spacing)
uniform vec4 uSplash[${MAX_SPLASH}];   // age (s), strength, seed, gather (s)
uniform float uThrow, uFlowPh;
uniform float uWind, uWindA, uWindAt, uWindPh;
uniform vec4 uHand[${MAX_HANDS}];      // x, y (frame heights from the center), radius, strength
uniform vec2 uHandV[${MAX_HANDS}];     // its motion, frame heights a second
uniform int uNHand;
uniform float uScan, uScanPos;
out vec2 vLocal;
out float vRad;
out vec4 vCol;
${OWN_GLSL}

// third-party: Hash without Sine
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float smoother(float t) { t = clamp(t, 0.0, 1.0); return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
void cull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vLocal = vec2(0.0); vRad = 0.0; vCol = vec4(0.0); }

void main() {
  int k = gl_InstanceID;
  int ix = k % uGrid.x, iy = k / uGrid.x;
  vec3 h1 = hash33(vec3(float(ix), float(iy), 17.0));
  vec3 h2 = hash33(vec3(float(iy), float(ix), 41.0));
  vec3 h3 = hash33(vec3(float(ix) + 7.0, float(iy) + 3.0, 73.0));
  // its home in the picture : a cell of the grid, jittered once and for good
  vec2 uv = (vec2(float(ix), float(iy)) + 0.5 + (h1.xy - 0.5) * uJitter) / vec2(uGrid);
  uv = clamp(uv, 0.0, 1.0);
  vec4 pc = uHasSide == 1 ? textureLod(uSide, uv, 0.0) : vec4(ownPic(uv).rgb, 1.0);
  float lum = dot(pc.rgb, vec3(0.2126, 0.7152, 0.0722));
  // STIPPLE : a threshold of its own; the dark parts thin out, each point in place
  float keep = uStipple > 0.001 ? clamp((lum - h1.z * uStipple) / 0.05 + 0.5, 0.0, 1.0) : 1.0;
  float amp = pc.a * keep;
  if (amp < 0.004) { cull(); return; }
  float gain = uGain;

  float ht = textureLod(uH, uv, 0.0).r;
  vec3 P0 = vec3((uv.x - 0.5) * uAsp, uv.y - 0.5, (ht - 0.5) * uDepth * 0.6);
  vec3 P = P0;

  // SPLASH : flung out along a direction of its own, then gathered home
  for (int i = 0; i < ${MAX_SPLASH}; i++) {
    vec4 s = uSplash[i];
    if (s.y <= 0.0) continue;
    vec3 hs = hash33(vec3(float(ix), float(iy), s.z));
    float age = max(0.0, s.x - hs.x * 0.08);
    float hang = s.w * 0.3, back = s.w * 0.7;
    float out1 = 1.0 - exp(-age / 0.09);
    float home = smoother((age - hang) / max(back, 0.05));
    float env = out1 * (1.0 - home);
    if (env <= 0.0) continue;
    float far = s.y * uThrow * (0.08 + 0.45 * hs.y + 2.4 * pow(hs.z, 7.0));
    vec3 dir = normalize(vec3(P0.xy * 1.4, 0.5) + (hash33(vec3(float(iy), s.z, float(ix))) - 0.5) * 1.7);
    vec3 q = P0 * 3.0;
    vec3 stir = vec3(sin(q.y * 2.1 + uFlowPh), sin(q.z * 1.7 + q.x * 1.3 + uFlowPh * 2.0), sin(q.x * 2.3 - uFlowPh));
    P += (dir + stir * 0.35) * far * env;
    // an arc on the way home
    P.z += sin(3.14159265 * home) * 0.25 * far * out1;
  }

  // WIND : past the line the points live short cycles, blown away and formed again
  if (uWind > 0.001) {
    vec2 n = vec2(cos(uWindA), sin(uWindA));
    vec2 tg = vec2(-n.y, n.x);
    float along = dot(P0.xy, tg);
    float rag = 0.05 * sin(along * 6.0 + uWindPh * 0.9) + 0.025 * sin(along * 17.0 - uWindPh * 1.7) + (h2.x - 0.5) * 0.09;
    float past = dot(P0.xy, n) - uWindAt - rag;
    float amt = smoothstep(0.0, 0.4, past) * uWind;
    float w = clamp((amt - h2.y) * 6.0, 0.0, 1.0);
    if (w > 0.0) {
      float ph = fract(uWindPh * (0.55 + 0.9 * h2.z) + h3.x);
      float formIn = smoothstep(0.0, 0.1, ph);
      float u = clamp((ph - 0.3) / 0.7, 0.0, 1.0);
      float travel = pow(u, 1.7) * (0.35 + 0.9 * h3.y);
      float fade = 1.0 - smoothstep(0.3, 1.0, u);
      vec3 q = P0 * 4.0;
      vec3 turb = vec3(sin(q.y * 3.0 + uWindPh * 1.3), sin(q.x * 2.6 - uWindPh), 0.6 + 0.4 * sin(q.x * 1.7 + q.y * 2.2 + uWindPh));
      P += (vec3(n, 0.15 + 0.35 * h3.z) + turb * 0.35) * travel * w;
      amp *= mix(1.0, fade * formIn, w);
    } else {
      // the points still at home take a little more light, so that side keeps its weight
      gain *= 1.0 + 0.5 * amt;
    }
    if (amp < 0.004) { cull(); return; }
  }

  // SCAN : a plane through the depth brightens and swells what it crosses
  float sizeK = 1.0;
  if (uScan > 0.001) {
    float x = (ht - uScanPos) / 0.06;
    float b = exp(-x * x) * uScan;
    sizeK += 1.4 * b;
    gain *= 1.0 + 1.6 * b;
  }

  // the camera
  vec3 d = P - uCam;
  vec3 v = vec3(dot(d, uR), dot(d, uU), dot(d, uF));
  float depth = v.z;
  if (depth < 0.02) { cull(); return; }
  vec2 s = v.xy * uFocal / depth;   // frame heights from the center
  // THE HAND : the points part round it, and its motion drags a wake
  for (int i = 0; i < ${MAX_HANDS}; i++) {
    if (i >= uNHand) break;
    vec4 hd = uHand[i];
    vec2 dv = s - hd.xy;
    float L = length(dv);
    float R = hd.z;
    if (L > R * 2.0) continue;
    vec2 dirH = L > 1e-4 ? dv / L : normalize(h3.xy - 0.5 + 1e-3);
    float t = 1.0 - clamp(L / (R * 1.6), 0.0, 1.0);
    // each point its own push : the gap's edge is ragged, the parted points heap
    // up round it, as sand does round a finger
    s += dirH * R * hd.w * t * t * (0.75 + 0.6 * h3.z);
    s += uHandV[i] * 0.06 * hd.w * exp(-(L * L) / (R * R));
  }
  // FOG : the points beyond the middle of the cloud dim with distance
  gain *= 1.0 - uFog * 0.85 * clamp((depth - uDist + 0.1) / 0.6, 0.0, 1.0);

  float rPx = uSize * sizeK * uFocal / depth * uRes.y;
  rPx = min(rPx, uRes.y * 0.03);
  // below a pixel a point keeps its size and gives up brightness instead
  if (rPx < 0.7) { amp *= (rPx / 0.7) * (rPx / 0.7); rPx = 0.7; }
  vec2 pc2 = (vec2(uSquare == 1 ? s.x : s.x * uRes.y / uRes.x, s.y) + 0.5) * uRes;
  float ext = uShape == 0 ? rPx : uShape == 1 ? rPx + 1.0 : rPx * 1.8 + 1.0;
  int vid = gl_VertexID;
  vec2 corner = vec2((vid & 1) == 0 ? -1.0 : 1.0, (vid & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner * ext;
  vRad = rPx;
  vCol = vec4(clamp(pc.rgb * gain, 0.0, 1.0), clamp(amp, 0.0, 1.0));
  vec2 px = pc2 + vLocal;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, clamp(depth / uZFar, 0.0, 1.0) * 2.0 - 1.0, 1.0);
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
  float a;
  if (uShape == 0) a = 1.0;
  else if (uShape == 1) a = clamp(vRad - length(vLocal) + 0.5, 0.0, 1.0);
  else { float q = length(vLocal) / max(vRad, 1e-3); a = exp(-2.2 * q * q); }
  a *= vCol.a;
  if (a < 0.004) discard;
  // Alpha to coverage turns the alpha into the share of samples covered, and each
  // covered sample holds the alpha again : written as is, a point would land at a
  // squared (a soft one nearly vanished). Its square root lands at a. Premultiplied :
  // the multisampled buffer is resolved, then divided back out.
  float s = sqrt(a);
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

interface Splash { age: number; strength: number; seed: number; gather: number }
interface Hand { x: number; y: number; vx: number; vy: number; s: number; seen: boolean }

export class PointCloudSource implements NativeGenerator {
  private g: EngineGL
  private heightP: Prog
  private dotP: Prog
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
  // the camera's own turn (SPIN) and its sway, the flows' phases
  private spinA = 0
  private swayA = Math.random() * TAU
  private swayB = Math.random() * TAU
  private flowPh = Math.random() * TAU
  private windPh = Math.random() * 100
  private ownPh = Math.random() * TAU
  private scanPh = Math.random()
  private beatAcc = 0
  private splashes: Splash[] = []
  private burst = new Edge()
  private onset = new Onset()
  private touch = new TouchPoints()
  private hands = new Map<number, Hand>()
  // the depth model's view of the picture this cloud lifts
  private depthRead: PictureDepthReader
  private count = 0
  /** the relief stands on the depth model's map (a test hook reads it) */
  haveMap = false

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    const g = (this.g = new EngineGL(gl, 'pointcloud'))
    this.heightP = g.prog(HEIGHT_FS)
    this.dotP = g.prog(DOT_FS, DOT_VS)
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

  pointer(ev: SourcePointer): void {
    this.touch.pointer(ev)
  }

  pointerHint(): string {
    return 'drag : part the points'
  }

  status(): string {
    return `${Math.round(this.count / 1000)}K points`
  }

  event(name: string): void {
    if (name === 'splash' || name === 'burst') this.fire(1, true)
  }

  /** A splash : every point flung out, gathered back over GATHER seconds. */
  private fire(strength: number, byHand = false): void {
    const I = this.inputs
    const amt = clamp(num(I, 'splash', 0.4), 0, 1)
    // the trigger always throws (at least half way), the sound and the beat by SPLASH
    const s = byHand ? Math.max(strength * amt, 0.5) : strength * amt
    if (s <= 0.001) return
    if (this.splashes.length >= MAX_SPLASH) this.splashes.shift()
    this.splashes.push({ age: 0, strength: s, seed: 100 + Math.floor(Math.random() * 800), gather: clamp(num(I, 'gather', 2), 0.3, 8) })
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

  private ensure(asp: number): void {
    const g = this.g
    // the relief's grid : 512 on the long side (the depth model reads at most 518)
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
    const fill = domeFill() > 0
    // the picture lies in the world at its own shape; under fill the VIEW is square
    const asp = this.w / Math.max(1, this.h)
    const viewAsp = fill ? 1 : asp
    this.ensure(asp)

    // ── the clocks ──
    const spin = num(I, 'spin', 0)
    this.spinA = (this.spinA + spin * 0.5 * dt) % TAU
    const swayRate = clamp(num(I, 'swayRate', 0.3), 0, 2)
    this.swayA = (this.swayA + swayRate * 0.7 * dt) % TAU
    this.swayB = (this.swayB + swayRate * 0.43 * dt) % TAU
    this.flowPh = (this.flowPh + dt * 0.9) % TAU
    this.ownPh = (this.ownPh + dt * 0.12) % TAU
    // (wrapped far out : the points' own rates are not whole multiples of it)
    this.windPh = (this.windPh + dt * clamp(num(I, 'windSpeed', 0.3), 0, 1) * 0.6) % 1000
    const scanSync = Math.round(clamp(num(I, 'scanSync', 0), 0, SYNC_BEATS.length - 1))
    const bpm = clamp(tempoBpm(), 20, 300)
    const scanPeriod = scanSync > 0 ? (60 / bpm) * SYNC_BEATS[scanSync] : clamp(num(I, 'scanPeriod', 8), 1, 30)
    this.scanPh = (this.scanPh + dt / scanPeriod) % 1

    // ── the splashes : the sound's hits, the beat, or the trigger only ──
    const on = Math.round(clamp(num(I, 'splashOn', 0), 0, SPLASH_BEATS.length - 1))
    const amt = clamp(num(I, 'splash', 0.4), 0, 1)
    const hit = this.onset.hit() // (read every frame : its edge must not go stale)
    if (amt > 0.001) {
      if (on === 0 && hit > 0) this.fire(hit)
      else if (SPLASH_BEATS[on] > 0) {
        this.beatAcc += dt
        const per = (60 / bpm) * SPLASH_BEATS[on]
        if (this.beatAcc >= per) {
          this.beatAcc %= per
          this.fire(1)
        }
      }
    }
    for (const s of this.splashes) s.age += dt
    this.splashes = this.splashes.filter((s) => s.age < s.gather + 0.6)

    // ── the hands : each point's place on the screen, its press rising and falling ──
    const pts = this.touch.step(dt, 0.65, false, viewAsp, { people: clamp(num(I, 'people', 0), 0, 1), point: undefined, press: false })
    for (const hd of this.hands.values()) hd.seen = false
    for (const p of pts) {
      let hd = this.hands.get(p.key)
      if (!hd) {
        hd = { x: p.x, y: p.y, vx: 0, vy: 0, s: 0, seen: true }
        this.hands.set(p.key, hd)
      }
      const vx = dt > 0 ? (p.x - p.px) / dt : 0, vy = dt > 0 ? (p.y - p.py) / dt : 0
      const kv = 1 - Math.exp(-dt / 0.08)
      hd.vx += (clamp(vx, -6, 6) - hd.vx) * kv
      hd.vy += (clamp(vy, -6, 6) - hd.vy) * kv
      hd.x = p.x
      hd.y = p.y
      hd.s = Math.min(p.w, hd.s + dt / 0.18)
      hd.seen = true
    }
    for (const [k, hd] of this.hands) {
      if (hd.seen) continue
      // let go : the points close back over a second
      hd.s -= dt / 0.9
      hd.vx *= Math.exp(-dt / 0.2)
      hd.vy *= Math.exp(-dt / 0.2)
      if (hd.s <= 0) this.hands.delete(k)
    }

    // ── the depth : the model reading this picture, or its brightness ──
    const raise = Math.round(clamp(num(I, 'raise', 0), 0, 2))
    const wantModel = raise === 0 && !!this.side && pictureDepth.wanted()
    const map = wantModel ? this.depthRead.step(this.side!, asp, dt) : null
    if (!wantModel) this.depthRead.stop()
    this.haveMap = !!map
    const mode = !this.side ? 0 : map ? 3 : raise === 2 ? 2 : 1
    const settle = clamp(num(I, 'settle', 0.3), 0, 2)
    const k = this.first || settle < 0.01 ? 1 : 1 - Math.exp(-dt / settle)
    const H = this.hgt!
    this.heightP.use()
      .i1('uPrev', 0).i1('uSide', 1).i1('uMap', 2)
      .i1('uMode', mode).f1('uK', k)
      .f2('uCell', 1 / this.hw, 1 / this.hh)
      .i1('uOwn', Math.round(clamp(num(I, 'own', 0), 0, 2))).f1('uPh', this.ownPh).f1('uAsp', asp)
    g.bind(0, H[this.hi].tex)
    g.bind(1, this.side ?? this.blank())
    g.bind(2, map ?? this.blank())
    g.draw(H[1 - this.hi].fbo, this.hw, this.hh)
    this.hi = 1 - this.hi
    this.first = false

    // ── the camera, orbiting the picture's center ──
    const sway = clamp(num(I, 'sway', 0.3), 0, 1)
    const yaw = num(I, 'turn', 0) * Math.PI + this.spinA + sway * 0.45 * Math.sin(this.swayA)
    const pitch = clamp(clamp(num(I, 'tilt', 0), -1, 1) * MAX_LEAN + sway * 0.16 * Math.sin(this.swayB), -MAX_LEAN, MAX_LEAN)
    const lens = clamp(num(I, 'lens', 0.5), 0, 1)
    const focal = 0.6 * Math.pow(10, 1 - lens)
    // DISTANCE 1 : the flat picture just fills the frame's height. On the dome the
    // camera stands back, so the cloud sits in the middle, clear of the rim.
    const D = focal * clamp(num(I, 'distance', 1.1), 0.3, 4) * (fill ? 1.4 : 1)
    const C: V3 = [D * Math.sin(yaw) * Math.cos(pitch), D * Math.sin(pitch), D * Math.cos(yaw) * Math.cos(pitch)]
    const F = norm([-C[0], -C[1], -C[2]])
    const R = norm(cross(F, [0, 1, 0]))
    const U = cross(R, F)

    // ── the points ──
    const density = clamp(num(I, 'density', 0.5), 0.02, 1)
    const n = Math.round(density * POINTCLOUD_MAX)
    const cols = Math.max(2, Math.round(Math.sqrt(n * asp)))
    const rows = Math.max(2, Math.floor(n / cols))
    this.count = cols * rows
    const size = clamp(num(I, 'size', 1), 0.1, 4)
    const shape = Math.round(clamp(num(I, 'shape', 1), 0, 2))
    // a point's radius : half the spacing between homes at SIZE 1, so they touch
    const radius = (0.5 / rows) * size

    const splashU = new Float32Array(MAX_SPLASH * 4)
    this.splashes.forEach((s, i) => splashU.set([s.age, s.strength, s.seed, s.gather], i * 4))
    const handU = new Float32Array(MAX_HANDS * 4)
    const handV = new Float32Array(MAX_HANDS * 2)
    const part = clamp(num(I, 'part', 0.6), 0, 1)
    const partR = clamp(num(I, 'partSize', 0.15), 0.02, 0.6)
    let nh = 0
    if (part > 0.001) {
      for (const hd of this.hands.values()) {
        if (nh >= MAX_HANDS) break
        handU.set([hd.x, hd.y, partR, clamp(hd.s, 0, 1) * part], nh * 4)
        handV.set([hd.vx, hd.vy], nh * 2)
        nh++
      }
    }
    const windAt = clamp(num(I, 'windAt', 0.3), -1, 1) * 0.5 * Math.max(asp, 1)

    const [gr, gg, gb] = col(I, 'ground', [0, 0, 0])
    const gv = I.ground
    const ga = Array.isArray(gv) && gv.length >= 4 ? clamp(gv[3], 0, 1) : 1
    const ms = msaaBuffer(gl, this.w, this.h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, ms.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.colorMask(true, true, true, true)
    gl.depthMask(true)
    // premultiplied ground : the resolve averages premultiplied samples
    gl.clearColor(gr * ga, gg * ga, gb * ga, ga)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.BLEND)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.CULL_FACE)
    // (every shape : a point fading out dithers its samples instead of punching a
    // hole in the ground)
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE)
    const p = this.dotP
    p.use()
      .i1('uSide', 0).i1('uH', 1)
      .i1('uHasSide', this.side ? 1 : 0).i1('uShape', shape).i1('uSquare', fill ? 1 : 0)
      .i2('uGrid', cols, rows)
      .f1('uJitter', clamp(num(I, 'jitter', 0.6), 0, 1))
      .f1('uStipple', clamp(num(I, 'stipple', 0.25), 0, 1))
      .f1('uGain', clamp(num(I, 'gain', 1), 0, 2))
      .f1('uDepth', clamp(num(I, 'depth', 0.5), 0, 1))
      .f1('uFog', clamp(num(I, 'fog', 0.3), 0, 1))
      .f3('uCam', ...C).f3('uR', ...R).f3('uU', ...U).f3('uF', ...F)
      .f1('uFocal', focal).f1('uDist', D).f1('uZFar', D * 3 + 6)
      .f2('uRes', this.w, this.h)
      .f1('uSize', radius)
      .f1('uThrow', clamp(num(I, 'throw', 0.35), 0.02, 1.5)).f1('uFlowPh', this.flowPh)
      .f1('uWind', clamp(num(I, 'wind', 0), 0, 1)).f1('uWindA', num(I, 'windAngle', 0)).f1('uWindAt', windAt).f1('uWindPh', this.windPh)
      .i1('uNHand', nh)
      .f1('uScan', clamp(num(I, 'scan', 0), 0, 1)).f1('uScanPos', 1.15 - 1.3 * this.scanPh)
      .i1('uOwn', Math.round(clamp(num(I, 'own', 0), 0, 2))).f1('uPh', this.ownPh).f1('uAsp', asp)
    gl.uniform4fv(p.u('uSplash'), splashU)
    gl.uniform4fv(p.u('uHand'), handU)
    gl.uniform2fv(p.u('uHandV'), handV)
    g.bind(0, this.side ?? this.blank())
    g.bind(1, H[this.hi].tex)
    gl.bindVertexArray(g.pointVao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cols * rows)
    gl.bindVertexArray(null)
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE)
    gl.disable(gl.DEPTH_TEST)
    g.bind(1, null)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms.fbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.pic!.fbo)
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    this.showP.use().i1('uPic', 0)
    g.bind(0, this.pic!.tex)
    g.draw(targetFbo, this.w, this.h)
    g.done(3)
  }

  dispose(): void {
    const g = this.g, gl = g.gl
    this.depthRead.dispose()
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
