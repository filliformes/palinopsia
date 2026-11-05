// FurSource : the native Fur generator (id 'gen-fur'). A coat of real strands,
// hundreds of thousands of them, seen from above under a studio lamp, that you can
// brush. Drag on the preview and the nap lies the way you combed it, the marks you
// leave showing as they do on velvet, then it heals back over HEAL seconds.
//
// The groom lives in two small half-float grids that follow the frame's height :
//   the nap  : which way each part of the coat lies (x, y), combed by the pointers,
//              relaxing toward the rest field (a slow flow with its whorls);
//   the lean : where the hairs actually are (x, y) and their velocity (z, w), a
//              damped spring toward the nap plus the wind, so a comb's wake and a gust
//              ripple through and settle.
//
// Every strand is one instance of a thin triangle strip (no attributes : its root and
// its look come from gl_InstanceID, its lean from the grid), bent from root to tip,
// tapered, depth-tested so tips lie over roots, multisampled. The light is
// Kajiya-Kay's model for a fiber : it depends on the strand's direction, not on a
// surface normal, which is why combed fur changes tone the way it does.

import { EngineGL, FS_HEAD, SlotClock, Edge, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator, SourcePointer } from './nativeGenerators'
import { audioBus } from './audioIn'
import { domeFill } from './domeSignal'
import { acquireMsaa, msaaBuffer, releaseMsaa } from './sharedMsaa'

const STEP = 1 / 60
const MAX_SEG = 8 // comb strokes a step can take, over all pointers
const SEGMENTS = 4 // a strand's segments : 10 vertices
const MAX_STRANDS = 1500000

// ── The rest of the coat : a slow flow with whorls, or the crown of a full dome ──
const REST = `
uniform vec2 uAspect;
uniform float uFlow, uWhorl, uScale, uLean, uFill, uSeedA, uSeedB, uPart, uDrift;
vec2 restDir(vec2 uv, float seed) {
  vec2 P = (uv - 0.5) * uAspect;
  vec2 q = P * uScale + vec2(seed, seed * 0.7);
  float a = uFlow;
  // the flow bends a little everywhere, and turns right round at the whorls
  float bend = og_fbm(q * 1.3 + uDrift, 3.0) - 0.5;
  float swirl = og_fbm(q * 2.7 + 17.0 - uDrift * 0.6, 2.0) - 0.5;
  a += bend * 1.6 + swirl * uWhorl * 9.0;
  vec2 d = vec2(cos(a), sin(a));
  // under full-dome fill the hair grows out from a crown at the zenith
  if (uFill > 0.5) {
    float r = length(P);
    vec2 o = r > 1e-4 ? P / r : vec2(1.0, 0.0);
    float t = atan(o.y, o.x) + bend * 1.6 + swirl * uWhorl * 5.0;
    d = normalize(mix(vec2(cos(t), sin(t)), d, 0.15));
  }
  return d;
}
vec2 rest(vec2 uv) {
  vec2 d = uPart >= 1.0 ? restDir(uv, uSeedB) : normalize(mix(restDir(uv, uSeedA), restDir(uv, uSeedB), uPart) + 1e-5);
  // (the crown itself stands straight up : leaning away all round it would bare the skin)
  float crown = uFill > 0.5 ? smoothstep(0.0, 0.16, length((uv - 0.5) * uAspect)) : 1.0;
  return d * uLean * crown;
}`

const NAP_FS = `${FS_HEAD}
uniform sampler2D uNap;
uniform float uHeal, uInit, uStrength, uBrush;
uniform int uSegN;
uniform vec4 uSeg[${MAX_SEG}];  // from x, y; to x, y (frame heights, 0 the middle)
uniform float uPoke[${MAX_SEG}]; // 1 : a click : the coat parts round the point
${REST}
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  vec2 target = rest(uv);
  vec2 n = uInit > 0.5 ? target : textureLod(uNap, uv, 0.0).xy;
  // it heals, the way it was combed fading back to how it grows
  n = mix(n, target, uHeal);
  vec2 P = (uv - 0.5) * uAspect;
  for (int i = 0; i < uSegN; i++) {
    vec2 a = uSeg[i].xy, ab = uSeg[i].zw - a;
    float ll = dot(ab, ab);
    vec2 cp = a + ab * (ll > 0.0 ? clamp(dot(P - a, ab) / ll, 0.0, 1.0) : 0.0);
    float d = length(P - cp) / uBrush;
    float f = smoothstep(1.0, 0.25, d);
    if (f <= 0.0) continue;
    vec2 dir = uPoke[i] > 0.5 ? (P - cp) / max(length(P - cp), 1e-4) : ab / max(sqrt(ll), 1e-5);
    // laid flat the way the comb went, firmest under its middle
    n = mix(n, dir * 0.96, f * uStrength);
  }
  o = vec4(n, 0.0, 1.0);
}`

const LEAN_FS = `${FS_HEAD}
uniform sampler2D uNap, uLean_;
uniform vec2 uGrid, uWindDir;
uniform float uWind, uGust, uFront, uT, uK, uC, uInitL;
uniform vec2 uAspect;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  vec2 P = (uv - 0.5) * uAspect;
  vec2 nap = textureLod(uNap, uv, 0.0).xy;
  if (uInitL > 0.5) { o = vec4(nap, 0.0, 0.0); return; }
  vec4 s = textureLod(uLean_, uv, 0.0);
  // the wind : a slow restless breath, and gusts passing as fronts across the coat
  float breath = (og_fbm(P * 1.7 + vec2(uT * 0.21, -uT * 0.13), 2.0) - 0.5) * uWind * 1.6;
  float along = dot(P, uWindDir);
  float front = sin(along * 7.0 - uFront) * 0.5 + 0.5;
  front *= front;
  float patchy = og_fbm(P * 2.3 + vec2(-uT * 0.17, uT * 0.11) + 5.0, 2.0);
  vec2 wind = uWindDir * (breath + uGust * front * patchy * 2.2) + vec2(-uWindDir.y, uWindDir.x) * breath * 0.6;
  // a damped spring toward the nap; the neighbors pull a little, so a ripple travels
  vec2 e = 1.0 / uGrid;
  vec2 lap = textureLod(uLean_, uv + vec2(e.x, 0.0), 0.0).xy + textureLod(uLean_, uv - vec2(e.x, 0.0), 0.0).xy
           + textureLod(uLean_, uv + vec2(0.0, e.y), 0.0).xy + textureLod(uLean_, uv - vec2(0.0, e.y), 0.0).xy - 4.0 * s.xy;
  vec2 acc = (nap + wind - s.xy) * uK - s.zw * uC + lap * 18.0;
  vec2 v = s.zw + acc * ${STEP};
  vec2 x = s.xy + v * ${STEP};
  float l = length(x);
  if (l > 0.98) { x *= 0.98 / l; v *= 0.5; }
  o = vec4(x, v);
}`

// ── The strands ──────────────────────────────────────────────────────────────
const STRAND_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uLean_, uSide;
uniform ivec2 uCells;
uniform vec2 uAspect;
uniform float uLen, uWidth, uClump, uCurl, uWild, uPx, uSideAmt, uSideUse, uHasSide, uPat, uPatScale;
uniform vec3 uTip, uRoot, uPatCol;
out float vT;
out vec3 vTan;
flat out vec3 vTipC;
flat out vec3 vRootC;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
// the coat's markings, by the root's place
float marking(vec2 P) {
  if (uPat < 0.5) return 0.0;
  vec2 q = P * uPatScale + 3.7;
  float wob = vnoise(q * 1.7) * 0.6;
  if (uPat < 1.5) {
    // spots : rosettes, a dark ring round each cell's middle
    vec2 g = floor(q), f = fract(q);
    float best = 9.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 c = vec2(float(x), float(y));
      vec2 o = hash2(g + c);
      best = min(best, length(c + o - f));
    }
    best += (wob - 0.3) * 0.25;
    return smoothstep(0.42, 0.34, best) * smoothstep(0.12, 0.2, best);
  }
  if (uPat < 2.5) {
    // stripes : bands across the flow, broken and wandering
    float s = sin((q.y + wob * 1.4 + vnoise(q * 0.5) * 2.0) * 6.2832 * 0.8);
    return smoothstep(0.35, 0.65, s);
  }
  // patches : big soft-edged islands
  return smoothstep(0.5, 0.56, vnoise(q * 0.8) * 0.7 + vnoise(q * 1.9) * 0.3);
}
void main() {
  int id = gl_InstanceID;
  ivec2 cell = ivec2(id % uCells.x, id / uCells.x);
  vec2 c = vec2(cell);
  vec2 h = hash2(c * 1.37 + 0.5);
  vec2 h2 = hash2(c.yx * 0.73 + 7.1);
  // the root : a jittered grid over the frame, a little past its edges
  vec2 root = ((c + h) / vec2(uCells)) * 1.08 - 0.04;
  vec2 P0 = (root - 0.5) * uAspect;
  vec4 s = textureLod(uLean_, root, 0.0);
  vec2 lean = s.xy;
  // each hair strays from the nap; a clump's hairs lean to its middle at the tips
  lean += (h2 - 0.5) * uWild;
  float L = length(lean);
  if (L > 0.98) { lean *= 0.98 / L; L = 0.98; }
  float len = uLen * (0.7 + 0.6 * h.x);
  vec3 tipC = uTip, rootC = uRoot;
  float sideL = 1.0;
  if (uHasSide > 0.5 && uSideAmt > 0.0) {
    vec3 sc = textureLod(uSide, root, 0.0).rgb;
    float lum = dot(sc, vec3(0.3, 0.59, 0.11));
    if (uSideUse < 0.5 || uSideUse > 1.5) { tipC = mix(tipC, sc, uSideAmt); rootC = mix(rootC, sc * 0.4, uSideAmt); }
    if (uSideUse > 0.5) sideL = mix(1.0, smoothstep(0.05, 0.5, lum), uSideAmt);
  }
  len *= sideL;
  float mk = marking(P0);
  if (mk > 0.0) { tipC = mix(tipC, uPatCol, mk); rootC = mix(rootC, uPatCol * 0.6, mk); }
  // a hair's own shade
  float shade = 0.82 + 0.36 * h2.x;
  vTipC = tipC * shade;
  vRootC = rootC * shade;
  // no hair at all where a sidechain grows none (not a stub of one)
  vT = 0.0;
  vTan = vec3(0.0, 0.0, 1.0);
  if (sideL < 0.04) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  int vid = gl_VertexID;
  float t = float(vid / 2) / ${SEGMENTS}.0;
  float side = (vid % 2 == 0) ? -1.0 : 1.0;
  vec2 dir = L > 1e-4 ? lean / L : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  // the clump's middle, by a coarse grid over the roots
  // (turned and warped : on a straight grid the coat came out woven)
  vec2 cw = mat2(0.83, -0.56, 0.56, 0.83) * P0 + (vec2(vnoise(P0 * 9.0), vnoise(P0 * 9.0 + 31.0)) - 0.5) * 0.09;
  vec2 cg = floor(cw * 42.0);
  vec2 cc = (cg + 0.5 + (hash2(cg) - 0.5) * 0.9) / 42.0;
  vec2 toClump = (cc - cw) * uClump * (0.6 + 0.8 * hash(cg + 3.3)) * sideL;
  // bent from root to tip : up first, laying over toward the tip
  float up = sqrt(max(0.0, 1.0 - L * L));
  float w = sin(t * 3.1 + h.y * 6.28) * uCurl * 0.3;
  vec2 off = dir * L * len * t * (0.75 + 0.5 * t) + perp * w * len * t + toClump * t * t;
  float z = len * (up * t * (1.0 - 0.25 * t) + 0.2 * t);
  vec2 P = P0 + off;
  // the tangent, for the light and for the strip's width
  vec2 dp = dir * L * len * (0.75 + t) + perp * (uCurl * 0.3 * len * (sin(t * 3.1 + h.y * 6.28) + t * 3.1 * cos(t * 3.1 + h.y * 6.28))) + toClump * 2.0 * t;
  float dz = len * (up * (1.0 - 0.5 * t) + 0.2);
  vTan = vec3(dp, dz);
  vec2 sdir = length(dp) > 1e-6 ? normalize(dp) : perp;
  vec2 sn = vec2(-sdir.y, sdir.x);
  float wpx = uWidth * (1.0 - 0.86 * t) * (0.8 + 0.4 * h.y);
  // (in frame heights / 1080, so a hair keeps its size in the frame at any resolution;
  // never thinner than the multisampling can hold, or the far tips break up)
  wpx = max(wpx, 0.55 / uPx);
  vec2 clip = P / uAspect * 2.0 + sn * side * wpx / 1080.0 / uAspect;
  gl_Position = vec4(clip, 0.9 - 1.7 * clamp(z / max(uLen * 1.3, 1e-4), 0.0, 1.0), 1.0);
  vT = t;
}`

const STRAND_FS = `#version 300 es
precision highp float;
uniform vec3 uL;
uniform float uShine, uGloss;
in float vT;
in vec3 vTan;
flat in vec3 vTipC;
flat in vec3 vRootC;
out vec4 o;
void main() {
  vec3 T = normalize(vTan);
  // Kajiya-Kay : a fiber lights by the angle between it and the lamp, not by a normal
  float TL = dot(T, uL), TV = T.z;
  float sTL = sqrt(max(0.0, 1.0 - TL * TL)), sTV = sqrt(max(0.0, 1.0 - TV * TV));
  float diff = 0.34 + 0.66 * sTL;
  float spec = pow(max(0.0, sTL * sTV - TL * TV), uGloss);
  float spec2 = pow(max(0.0, sTL * sTV - (TL - 0.22) * TV), uGloss * 0.4);
  // deep in the coat it is dark, the light reaching only the upper part of a hair
  float ao = 0.1 + 0.9 * smoothstep(0.0, 0.85, vT);
  vec3 alb = mix(vRootC, vTipC, smoothstep(0.1, 0.8, vT));
  vec3 c = alb * diff * ao + (spec * 0.16 + spec2 * alb * 0.32) * uShine * ao;
  o = vec4(c, 1.0);
}`

// (the picture : the resolved strands, straight alpha again)
const SHOW_FS = `${FS_HEAD}
uniform sampler2D uPic;
out vec4 o;
void main() {
  vec4 c = texelFetch(uPic, ivec2(gl_FragCoord.xy), 0);
  o = c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
}`

interface Stroke { ax: number; ay: number; bx: number; by: number; poke: number }

export class FurSource implements NativeGenerator {
  private g: EngineGL
  private napP: Prog
  private leanP: Prog
  private strandP: Prog
  private showP: Prog
  private nap: [Target, Target] | null = null
  private lean: [Target, Target] | null = null
  private pic: Target | null = null
  private blankTex: WebGLTexture | null = null
  private ni = 0
  private li = 0
  private gw = 0
  private gh = 0
  private clock = new SlotClock()
  private acc = 0
  private t = 0
  private front = 0
  private inputs: Record<string, number | number[]> = {}
  private side: WebGLTexture | null = null
  private init = true
  private partE = new Edge()
  private groomE = new Edge()
  private seedA = Math.random() * 40
  private seedB = this.seedA
  private part = 1
  private drift = 0
  private prevT = 0
  private gustEnv = 0
  private aspect: [number, number] = [1, 1]
  private last = new Map<number, { x: number; y: number }>()
  private strokes: Stroke[] = []
  private pendGroom = false
  private windA = Math.random() * 6.28

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    const g = (this.g = new EngineGL(gl, 'fur'))
    this.napP = g.prog(NAP_FS)
    this.leanP = g.prog(LEAN_FS)
    this.strandP = g.prog(STRAND_FS, STRAND_VS)
    this.showP = g.prog(SHOW_FS)
    acquireMsaa()
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
    if (this.partE.fired(num(inputs, 'repart', 0))) this.repart()
    if (this.groomE.fired(num(inputs, 'groom', 0))) this.pendGroom = true
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
    if (typeof value !== 'number') return
    if (name === 'repart' && this.partE.fired(value)) this.repart()
    if (name === 'groom' && this.groomE.fired(value)) this.pendGroom = true
  }

  feed(_audio: WebGLTexture | null, side: WebGLTexture | null): void {
    this.side = side
  }

  private repart(): void {
    // from where it is now to a new way of lying, over a second
    this.seedA = this.part >= 1 ? this.seedB : this.seedA
    this.seedB = Math.random() * 40
    this.part = 0
    this.windA = Math.random() * 6.28
  }

  pointer(ev: SourcePointer): void {
    const x = (ev.u - 0.5) * this.aspect[0], y = (ev.v - 0.5) * this.aspect[1]
    if (ev.phase === 'down') {
      this.last.set(ev.pid, { x, y })
      // a click parts the coat round the point (a drag goes on to comb it)
      this.strokes.push({ ax: x, ay: y, bx: x, by: y, poke: 1 })
    } else if (ev.phase === 'move') {
      const l = this.last.get(ev.pid)
      if (l) {
        this.strokes.push({ ax: l.x, ay: l.y, bx: x, by: y, poke: 0 })
        this.last.set(ev.pid, { x, y })
      }
    } else this.last.delete(ev.pid)
  }

  pointerHint(): string {
    return 'drag : comb the fur · click : part it'
  }

  status(): string {
    return `${Math.round(this.strandCount() / 1000)}K hairs`
  }

  event(name: string): void {
    if (name === 'repart') this.repart()
    else if (name === 'groom') this.pendGroom = true
  }

  private strandCount(): number {
    return Math.max(2000, Math.min(MAX_STRANDS, Math.round(Math.max(0.02, Math.min(1, num(this.inputs, 'density', 0.5))) * MAX_STRANDS)))
  }

  private blank(): WebGLTexture {
    const gl = this.g.gl
    if (this.blankTex) return this.blankTex
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

  private ensure(): void {
    const g = this.g
    // the groom's grid : a coarse one, a brush's mark and a gust's front hold on it
    const rows = 320
    const cols = Math.max(32, Math.round((rows * this.aspect[0]) / this.aspect[1]))
    if (!this.nap || cols !== this.gw || rows !== this.gh) {
      for (const t of [...(this.nap ?? []), ...(this.lean ?? [])]) g.freeTarget(t)
      const m = (): Target => g.target(cols, rows, { half: 'rgba', linear: true })
      this.nap = [m(), m()]
      this.lean = [m(), m()]
      this.gw = cols
      this.gh = rows
      this.init = true
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
    const fill = domeFill() > 0
    const asp = fill ? 1 : this.w / Math.max(1, this.h)
    this.aspect = [asp, 1]
    this.ensure()
    const dt = this.clock.tick(clockSec)
    this.acc = Math.min(this.acc + dt, STEP * 3)

    // ── the sound : the mids gust through the coat, an accent re-parts it ──
    const amt = Math.max(0, Math.min(1, num(I, 'audio', 0)))
    let gustA = 0
    if (amt > 0) {
      const mids = (audioBus.feature('band', 2) + audioBus.feature('band', 3)) * 0.5
      gustA = Math.min(1, mids * 1.6) * amt
      const tr = audioBus.feature('transient')
      if (tr > 0.8 && this.prevT <= 0.8 && this.part >= 1 && Math.random() < num(I, 'audioPart', 0.5)) this.repart()
      this.prevT = tr
    }
    // the gust's envelope rises fast and falls slowly, as wind does
    this.gustEnv += (Math.max(gustA, Math.max(0, num(I, 'gust', 0))) - this.gustEnv) * (1 - Math.exp(-dt / (gustA > this.gustEnv ? 0.08 : 0.5)))

    const flow = num(I, 'flow', -1.5708)
    const whorl = Math.max(0, Math.min(1, num(I, 'whorl', 0.25)))
    const scale = Math.max(0.2, num(I, 'scale', 1.4))
    const leanAmt = Math.max(0, Math.min(0.95, num(I, 'lie', 0.7)))
    const healS = Math.max(0.5, num(I, 'heal', 15))
    const never = healS >= 60 // the end of the slider : what you comb stays
    const brush = 0.012 + 0.2 * Math.pow(Math.max(0, Math.min(1, num(I, 'brush', 0.4))), 1.5)
    const hold = Math.max(0, Math.min(1, num(I, 'hold', 0.8)))
    const wind = Math.max(0, Math.min(1, num(I, 'wind', 0.12)))
    const driftK = Math.max(0, Math.min(1, num(I, 'drift', 0.05)))
    const lively = Math.max(0, Math.min(1, num(I, 'spring', 0.5)))
    const N = this.nap!, L = this.lean!

    const rest = (p: Prog): Prog =>
      p.f2('uAspect', this.aspect[0], this.aspect[1]).f1('uFlow', flow).f1('uWhorl', whorl).f1('uScale', scale)
        .f1('uLean', leanAmt).f1('uFill', fill ? 1 : 0).f1('uSeedA', this.seedA).f1('uSeedB', this.seedB)
        .f1('uPart', this.part).f1('uDrift', this.drift)

    while (this.acc >= STEP || this.init) {
      this.acc = Math.max(0, this.acc - STEP)
      this.t = (this.t + STEP) % 4096
      this.drift = (this.drift + STEP * driftK * 0.05) % 512
      if (this.part < 1) this.part = Math.min(1, this.part + STEP)
      // the wind's direction wanders, gusts run along it (out from the zenith on the dome)
      this.windA += STEP * 0.03 * (Math.sin(this.t * 0.11) + 0.3)
      this.front = (this.front + STEP * (2.2 + 4.5 * this.gustEnv)) % 6283.2

      // the nap : healing, and what the pointers did since the last step
      const segs = this.strokes.splice(0, MAX_SEG)
      const segA = new Float32Array(MAX_SEG * 4), pokeA = new Float32Array(MAX_SEG)
      segs.forEach((s, i) => { segA.set([s.ax, s.ay, s.bx, s.by], i * 4); pokeA[i] = s.poke })
      // (the strokes of a fast drag that did not fit wait for the next step)
      const heal = this.pendGroom ? 0.25 : never ? 0 : 1 - Math.exp(-STEP / (healS / 3))
      rest(this.napP.use()).i1('uNap', 0).f2('RENDERSIZE', this.gw, this.gh)
        .f1('uHeal', heal).f1('uInit', this.init ? 1 : 0).f1('uStrength', 0.25 + 0.75 * hold).f1('uBrush', brush).i1('uSegN', segs.length)
      gl.uniform4fv(this.napP.u('uSeg'), segA)
      gl.uniform1fv(this.napP.u('uPoke'), pokeA)
      g.bind(0, N[this.ni].tex)
      g.draw(N[1 - this.ni].fbo, this.gw, this.gh)
      this.ni = 1 - this.ni

      // the lean : a spring toward the nap, plus the wind
      const k = 18 + 52 * (1 - lively)
      const c = 2.2 + 9 * (1 - lively)
      this.leanP.use().i1('uNap', 0).i1('uLean_', 1).f2('RENDERSIZE', this.gw, this.gh).f2('uGrid', this.gw, this.gh)
        .f2('uAspect', this.aspect[0], this.aspect[1]).f2('uWindDir', Math.cos(this.windA), Math.sin(this.windA))
        .f1('uWind', wind).f1('uGust', this.gustEnv).f1('uFront', this.front).f1('uT', this.t)
        .f1('uK', k).f1('uC', c).f1('uInitL', this.init ? 1 : 0)
      g.bind(0, N[this.ni].tex)
      g.bind(1, L[this.li].tex)
      g.draw(L[1 - this.li].fbo, this.gw, this.gh)
      this.li = 1 - this.li
      this.init = false
    }
    this.pendGroom = false

    // ── the strands, multisampled and depth-tested ──
    const len = Math.max(0.002, num(I, 'length', 0.05))
    const thick = Math.max(0.2, num(I, 'thickness', 1))
    // the work is hairs x length x thickness : long thick hairs need fewer to cover,
    // and this holds the frame rate at the end of those three sliders
    const count = Math.min(this.strandCount(), Math.round(225000 / (len * thick)))
    const cols = Math.max(4, Math.round(Math.sqrt(count * asp)))
    const rowsN = Math.max(4, Math.floor(count / cols))
    const px = this.h / 1080
    const [tr, tg, tb] = col(I, 'tip', [0.55, 0.37, 0.22])
    const [rr, rg, rb] = col(I, 'root', [0.1, 0.055, 0.03])
    const [sr, sg, sb] = col(I, 'skin', [0.02, 0.012, 0.008])
    const [mr, mg, mb] = col(I, 'markColor', [0.03, 0.022, 0.018])
    const sideAmt = Math.max(0, Math.min(1, num(I, 'side', 0)))
    const la = num(I, 'lightAngle', 2.36)
    const lh = Math.max(0, Math.min(1, num(I, 'lightHeight', 0.55)))
    const lz = 0.2 + 0.9 * lh
    const ln = Math.hypot(1, lz)
    const ground = Math.max(0, Math.min(1, num(I, 'ground', 1)))
    const ms = msaaBuffer(gl, this.w, this.h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, ms.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.colorMask(true, true, true, true)
    gl.depthMask(true)
    gl.clearColor(sr * ground, sg * ground, sb * ground, ground)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.BLEND)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.CULL_FACE)
    const p = this.strandP
    p.use().i1('uLean_', 0).i1('uSide', 1).i2('uCells', cols, rowsN).f2('uAspect', asp, 1)
      .f1('uLen', len).f1('uWidth', 1.45 * thick).f1('uPx', px)
      .f1('uClump', Math.max(0, Math.min(1, num(I, 'clump', 0.4)))).f1('uCurl', Math.max(0, Math.min(1, num(I, 'curl', 0.15))))
      .f1('uWild', Math.max(0, Math.min(1, num(I, 'wild', 0.3))) * 0.6)
      .f1('uSideAmt', sideAmt).f1('uSideUse', Math.round(num(I, 'sideUse', 0))).f1('uHasSide', this.side ? 1 : 0)
      .f1('uPat', Math.round(num(I, 'marks', 0))).f1('uPatScale', Math.max(0.5, num(I, 'markScale', 6)))
      .f3('uTip', tr, tg, tb).f3('uRoot', rr, rg, rb).f3('uPatCol', mr, mg, mb)
      .f3('uL', Math.cos(la) / ln, Math.sin(la) / ln, lz / ln)
      .f1('uShine', Math.max(0, Math.min(1, num(I, 'shine', 0.5))) * 1.1).f1('uGloss', 10 + 60 * Math.max(0, Math.min(1, num(I, 'gloss', 0.45))))
    g.bind(0, L[this.li].tex)
    g.bind(1, this.side ?? this.blank())
    gl.bindVertexArray(g.pointVao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEGMENTS + 1) * 2, cols * rowsN)
    gl.bindVertexArray(null)
    gl.disable(gl.DEPTH_TEST)
    g.bind(1, null)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms.fbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.pic!.fbo)
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    this.showP.use().i1('uPic', 0).f2('RENDERSIZE', this.w, this.h)
    g.bind(0, this.pic!.tex)
    g.draw(targetFbo, this.w, this.h)
    g.done(2)
  }

  dispose(): void {
    const g = this.g, gl = g.gl
    for (const t of [...(this.nap ?? []), ...(this.lean ?? []), this.pic]) g.freeTarget(t)
    this.nap = null
    this.lean = null
    this.pic = null
    if (this.blankTex) gl.deleteTexture(this.blankTex)
    this.blankTex = null
    g.dispose()
    releaseMsaa(gl)
  }
}
