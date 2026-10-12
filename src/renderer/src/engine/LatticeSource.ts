// LatticeSource : the native Lattice generator (id 'gen-lattice'). A lattice of
// points in space seen through a moving camera : a PLANE of dots (a floor, a
// sheet, a field seen from above) or a VOLUME of them (a room of stars the camera
// flies through). The points can sink into a well, ring with ripples, swell like
// water, lift with the sound's spectrum or with the brightness of another layer.
//
// How it draws :
// - No vertex data at all. Each point is one instance of a 4-vertex strip, and the
//   vertex shader finds its lattice cell from gl_InstanceID, so a count change is
//   a uniform, never a reallocation (authoring rules §7).
// - Each point is a capsule from where it sits now back to where it sat STREAK
//   seconds ago (from the camera's own motion), anti-aliased over one pixel and
//   never thinner than 1.5 pixels across : a far point shrinks in brightness
//   instead of in size, so it never breaks into a shimmer.
// - Points are blended with MAX into a coverage map, then laid over the ground
//   in straight alpha. Overlaps never add up into a glow (the brief's line), and
//   a transparent ground lets the layers below through between the dots.
// - The lattice is infinite : the cells wrap around the camera, which can fly
//   forever (its position wraps at 4096 cells, where every per-point draw repeats,
//   so the wrap is seamless). The lattice's edge always fades out, so the wrap is
//   never seen; FOG fades it sooner.

import { EngineGL, SlotClock, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'

const VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform int uForm;            // 0 plane, 1 volume
uniform int uN;               // cells per side
uniform float uS;             // cell size, world units
uniform vec3 uCam;            // camera position, in CELLS, wrapped at 4096
uniform vec3 uRight, uUp, uBack;          // camera basis now
uniform vec3 uRightP, uUpP, uBackP;       // and STREAK seconds ago
uniform vec3 uDelta;          // camera travel over the streak, world units
uniform float uF;             // focal length, frame heights
uniform vec2 uRes;            // target size, pixels
uniform float uDot;           // dot radius, world units
uniform float uVary, uJitter;
uniform vec3 uWell;           // the well / attractor, camera-relative world units
uniform float uWellAmt, uReach, uRipple, uRings, uRipplePh, uSwell, uSwellPh;
uniform float uAudio, uSide;
uniform float uFogStart, uEdge;
uniform int uHasAudio, uHasSide;
uniform sampler2D uAudioTex, uSideTex;
out vec2 vLocal;
out float vLen, vRad, vAmp;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Value noise with a period of 512 of its own cells. It is read at the point's
// WRAPPED cell over 8, so one noise period is exactly the 4096-cell wrap : the
// swell runs on across the wrap in space and in time. §2 : floored, small inputs.
float vnoise(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, 512.0)), b = hash12(mod(i + vec2(1.0, 0.0), 512.0));
  float c = hash12(mod(i + vec2(0.0, 1.0), 512.0)), d = hash12(mod(i + vec2(1.0, 1.0), 512.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
// The cell nearest the camera among those congruent to k (one axis).
float cellNear(float k, float cam, float n) { return k - n * floor((k - cam) / n + 0.5); }

// Bands of the shared spectrum by distance from the well, bass at its heart.
float band(float x) {
  if (uHasAudio == 0 || uAudio < 0.001) return 0.0;
  int bi = int(clamp(x, 0.0, 1.0) * 127.0);
  return texelFetch(uAudioTex, ivec2(bi, 1), 0).r;
}

vec2 toPx(vec3 v) {
  float depth = max(-v.z, 1e-4);
  vec2 s = v.xy * uF / depth;                      // frame heights from the centre
  return (vec2(s.x * uRes.y / uRes.x, s.y) + 0.5) * uRes;
}

void main() {
  float n = float(uN);
  int k = gl_InstanceID;
  vec3 cell;
  if (uForm == 0) cell = vec3(float(k % uN), 0.0, float(k / uN));
  else cell = vec3(float(k % uN), float((k / uN) % uN), float(k / (uN * uN)));
  vec3 idx = vec3(cellNear(cell.x, uCam.x, n), uForm == 0 ? 0.0 : cellNear(cell.y, uCam.y, n), cellNear(cell.z, uCam.z, n));
  vec3 id = mod(idx, 4096.0);
  vec3 h = hash33(id + vec3(7.0, 13.0, 29.0));
  vec3 jit = (hash33(id.zxy + 101.0) - 0.5) * uJitter;
  if (uForm == 0) jit.y = 0.0;

  // Camera-relative position, world units. The plane lies at the camera's height
  // below it (uCam.y holds that height for the plane).
  vec3 P = (idx - uCam + jit) * uS;
  if (uForm == 0) P.y = -uCam.y;
  vec3 flatP = P;

  // The point as it would sit undisplaced, for the sidechain's screen lookup :
  // the other layer is read where this point appears, so its picture is embossed
  // on the field as the camera sees it.
  float lum = 0.0;
  if (uHasSide == 1 && uSide > 0.001) {
    vec3 v0 = vec3(dot(P, uRight), dot(P, uUp), dot(P, uBack));
    if (-v0.z > 1e-3) {
      vec2 uv = clamp(toPx(v0) / uRes, 0.0, 1.0);
      vec4 s = textureLod(uSideTex, uv, 0.0);
      lum = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722)) * s.a;
    }
  }

  float R = uReach;
  float sizeK = mix(1.0, 0.5 + 2.6 * pow(h.z, 4.0), uVary);
  float amp = mix(1.0, 0.45 + 0.55 * h.y, uVary);
  if (uForm == 0) {
    float r = length(P.xz - uWell.xz);
    float y = -uWellAmt * 0.8 * R / (1.0 + (r * r) / (R * R));
    y += uRipple * 0.22 * R * sin(r * 6.2831853 * uRings / R - uRipplePh) * exp(-r / (R * 3.0));
    y += uSwell * 0.12 * R * vnoise(id.xz / 8.0 + vec2(uSwellPh, uSwellPh * 0.6));
    y += uAudio * 0.35 * R * band(r / (R * 4.0));
    y += uSide * 0.4 * R * lum;
    P.y += y;
  } else {
    vec3 d = P - uWell;
    float dl = max(length(d), 1e-4);
    vec3 dir = d / dl;
    float pull = uWellAmt * 1.6 * R * R * R / (dl * dl + R * R);
    P -= dir * min(pull, dl * 0.95);
    P += dir * uRipple * 0.3 * R * sin(dl * 6.2831853 * uRings / R - uRipplePh) * exp(-dl / (R * 3.0));
    P.y += uSwell * 0.25 * R * vnoise(id.xz / 8.0 + vec2(uSwellPh, uSwellPh * 0.6));
    P += dir * uAudio * 0.5 * R * band(dl / (R * 4.0));
    // In space there is no height to lift : the other layer lights the stars and
    // grows them where it is bright.
    amp *= mix(1.0, lum, uSide);
    sizeK *= mix(1.0, 0.4 + 1.2 * lum, uSide);
  }

  // The edge of the lattice always fades (the wrap must never show); FOG fades
  // it sooner. Measured on the flat lattice, so a deep well does not fade early.
  vec3 fq = abs(flatP - (uForm == 0 ? vec3(0.0, flatP.y, 0.0) : vec3(0.0)));
  float cheb = max(max(fq.x, fq.y), fq.z);
  float half_n = 0.5 * n * uS;
  amp *= 1.0 - smoothstep(uEdge * half_n, half_n, cheb);
  amp *= 1.0 - smoothstep(uFogStart * half_n, half_n, uForm == 0 ? length(flatP.xz) : length(flatP));

  vec3 v = vec3(dot(P, uRight), dot(P, uUp), dot(P, uBack));
  float depth = -v.z;
  if (depth < 0.05 || amp < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 Pp = P + uDelta;
  vec3 vp = vec3(dot(Pp, uRightP), dot(Pp, uUpP), dot(Pp, uBackP));
  vec2 pc = toPx(v);
  vec2 pp = -vp.z > 0.05 ? toPx(vp) : pc;

  // Radius in pixels, floored at 0.75 (1.5 across) : below that the dot keeps
  // its size and loses brightness by the area it lost.
  float rPx = uDot * sizeK * uF / depth * uRes.y;
  // ...and capped near the lens : a point passing the camera swelled into a soft
  // ball filling a sixth of the frame (seen in the starfield). Points stay points.
  rPx = min(rPx, uRes.y * 0.018 * sizeK);
  if (rPx < 0.75) { amp *= (rPx / 0.75) * (rPx / 0.75); rPx = 0.75; }
  // A streak longer than a sixth of the frame is cut there : a point sweeping
  // past the lens would otherwise draw one quad across the whole screen.
  vec2 seg = pc - pp;
  float L = length(seg);
  float Lmax = uRes.y / 6.0;
  if (L > Lmax) { pp = pc - seg / L * Lmax; L = Lmax; }
  vec2 dir2 = L > 0.01 ? (pc - pp) / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir2.y, dir2.x);
  int vid = gl_VertexID;
  float a = (vid & 1) == 0 ? -rPx - 1.0 : L + rPx + 1.0;
  float b = (vid & 2) == 0 ? -rPx - 1.0 : rPx + 1.0;
  vec2 px = pp + dir2 * a + nrm * b;
  vLocal = vec2(a, b);
  vLen = L;
  vRad = rPx;
  vAmp = amp;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
}`

const DOT_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vLen, vRad, vAmp;
out vec4 o;
void main() {
  float ca = clamp(vLocal.x, 0.0, vLen);
  float d = length(vec2(vLocal.x - ca, vLocal.y));
  float cov = clamp(vRad - d + 0.5, 0.0, 1.0);
  // A streak fades toward its tail, the way a long exposure does.
  float tail = vLen > vRad ? mix(0.25, 1.0, ca / max(vLen, 1e-4)) : 1.0;
  float v = cov * vAmp * tail;
  o = vec4(v);
}`

const SHOW_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uCov;
uniform vec3 uInk;
uniform vec4 uGround;
out vec4 o;
void main() {
  float c = texelFetch(uCov, ivec2(gl_FragCoord.xy), 0).r;
  // Straight alpha : the dots over the ground, divided back out by the alpha so a
  // transparent ground gets no dark fringe around each dot.
  float a = c + uGround.a * (1.0 - c);
  vec3 rgb = (uInk * c + uGround.rgb * uGround.a * (1.0 - c)) / max(a, 1e-4);
  o = vec4(rgb, a);
}`

const WRAP = 4096
const MAX_LEAN = 1.3963 // 80 degrees : straight down or up the basis degenerates
const EXTENT = 64 // the lattice's side in world units, whatever the count

type V3 = [number, number, number]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const wrapC = (x: number): number => ((x % WRAP) + WRAP) % WRAP

/** The camera basis for a heading and a downward lean : right, up, back. */
function basis(yaw: number, down: number): { f: V3; r: V3; u: V3; b: V3 } {
  const f: V3 = [Math.cos(down) * Math.sin(yaw), -Math.sin(down), -Math.cos(down) * Math.cos(yaw)]
  const r = norm(cross(f, [0, 1, 0]))
  const u = cross(r, f)
  return { f, r, u, b: [-f[0], -f[1], -f[2]] }
}

export class LatticeSource implements NativeGenerator {
  private g: EngineGL
  private dots: Prog
  private show: Prog
  private cov: Target | null = null
  private clock = new SlotClock()
  private inputs: Record<string, number | number[]> = {}
  // The camera, in CELLS (so a wrap at 4096 cells is seamless), the heading it
  // has turned through, and the travelling phases of the ripples and the swell.
  private cam: V3 = [Math.random() * WRAP, 0, Math.random() * WRAP]
  private yaw = 0
  private ripplePh = Math.random() * Math.PI * 2
  private swellPh = Math.random() * 512
  private cellS = 0
  private audioTex: WebGLTexture | null = null
  private sideTex: WebGLTexture | null = null
  private blankTex: WebGLTexture | null = null

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    this.g = new EngineGL(gl, 'lattice')
    this.dots = this.g.prog(DOT_FS, VS)
    this.show = this.g.prog(SHOW_FS)
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
  }

  private blank(): WebGLTexture {
    if (this.blankTex) return this.blankTex
    const gl = this.g.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false) // §7 : set on every upload
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.blankTex = t
    return t
  }

  feed(audio: WebGLTexture | null, side: WebGLTexture | null): void {
    this.audioTex = audio
    this.sideTex = side
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
    if (!this.cov) this.cov = g.target(this.w, this.h, { float: false })
    const I = this.inputs
    const dt = this.clock.tick(clockSec)
    const form = Math.round(num(I, 'form', 0)) === 1 ? 1 : 0
    const count = Math.max(16, Math.min(256, num(I, 'count', 200)))
    // A volume holds its count per side cubed : a fifth as many per side keeps it
    // near the plane's point count (200 -> 40 per side, 64 000 points).
    const n = form === 0 ? Math.round(count) : Math.max(6, Math.min(56, Math.round(count / 5)))
    const s = EXTENT / n
    // A count change keeps the camera where it is in the world : the cells are
    // re-dealt, the scene does not jump.
    if (this.cellS > 0 && Math.abs(this.cellS - s) > 1e-9) {
      this.cam = [wrapC((this.cam[0] * this.cellS) / s), wrapC((this.cam[1] * this.cellS) / s), wrapC((this.cam[2] * this.cellS) / s)]
    }
    this.cellS = s

    const down = Math.max(-1, Math.min(1, num(I, 'tilt', 0.45))) * MAX_LEAN
    const spin = num(I, 'spin', 0) * 0.5 // radians per second
    this.yaw = (this.yaw + spin * dt) % (Math.PI * 2)
    const yaw = num(I, 'turn', 0) * Math.PI + this.yaw
    const B = basis(yaw, down)
    // FLY : forward along the heading (level, over a plane) or along the view (in
    // a volume), in world units per second.
    const fly = num(I, 'fly', 0.15) * 6
    const vel: V3 = form === 0 ? norm([B.f[0], 0, B.f[2]]).map((x) => x * fly) as V3 : (B.f.map((x) => x * fly) as V3)
    this.cam[0] = wrapC(this.cam[0] + (vel[0] * dt) / s)
    this.cam[2] = wrapC(this.cam[2] + (vel[2] * dt) / s)
    if (form === 1) this.cam[1] = wrapC(this.cam[1] + (vel[1] * dt) / s)
    const height = Math.max(0.3, num(I, 'height', 10))

    const pace = num(I, 'pace', 0.3)
    this.ripplePh = (this.ripplePh + pace * 2 * Math.PI * dt) % (Math.PI * 2)
    this.swellPh = (this.swellPh + pace * 0.6 * dt) % 512

    const lens = Math.max(0, Math.min(1, num(I, 'lens', 0.6)))
    const f = 0.6 * Math.pow(10, 1 - lens)
    const reach = 1 + 19 * Math.max(0, Math.min(1, num(I, 'reach', 0.3)))
    // The well sits where the camera looks : on the plane, the point the view
    // meets (capped inside the lattice); in a volume, ahead along the view.
    let well: V3
    if (form === 0) {
      const d = Math.min(EXTENT * 0.3, height / Math.tan(Math.max(0.08, down)))
      const fh = norm([B.f[0], 0, B.f[2]])
      well = [fh[0] * d, 0, fh[2] * d]
    } else {
      const d = reach * 2.5 + 2
      well = [B.f[0] * d, B.f[1] * d, B.f[2] * d]
    }
    // STREAK : the camera STREAK seconds ago, from its present motion.
    const streakSec = Math.max(0, Math.min(1, num(I, 'streak', 0))) * 0.5
    const Bp = basis(yaw - spin * streakSec, down)
    const delta: V3 = [vel[0] * streakSec, vel[1] * streakSec, vel[2] * streakSec]

    const fog = Math.max(0, Math.min(1, num(I, 'fog', 0.35)))
    const size = Math.max(0, num(I, 'size', 0.35))
    // Dot radius in world units : on the plane a share of the cell (size 1, the
    // dots touch), in a volume a much smaller one (stars, not balls).
    const dotR = size * (form === 0 ? 0.5 : 0.08) * s

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cov.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const hasAudio = this.audioTex && num(I, 'audio', 0) > 0.001 ? 1 : 0
    const hasSide = this.sideTex && num(I, 'side', 0) > 0.001 ? 1 : 0
    this.dots.use()
      .i1('uForm', form).i1('uN', n).f1('uS', s)
      .f3('uCam', this.cam[0], form === 0 ? height : this.cam[1], this.cam[2])
      .f3('uRight', ...B.r).f3('uUp', ...B.u).f3('uBack', ...B.b)
      .f3('uRightP', ...Bp.r).f3('uUpP', ...Bp.u).f3('uBackP', ...Bp.b)
      .f3('uDelta', ...delta)
      .f1('uF', f).f2('uRes', this.w, this.h)
      .f1('uDot', dotR)
      .f1('uVary', Math.max(0, Math.min(1, num(I, 'vary', 0.2))))
      .f1('uJitter', Math.max(0, Math.min(1, num(I, 'jitter', 0))))
      .f3('uWell', ...well)
      .f1('uWellAmt', Math.max(0, num(I, 'well', 0.5))).f1('uReach', reach)
      .f1('uRipple', Math.max(0, num(I, 'ripple', 0.3))).f1('uRings', Math.max(0.25, num(I, 'rings', 3)))
      .f1('uRipplePh', this.ripplePh)
      .f1('uSwell', Math.max(0, num(I, 'swell', 0))).f1('uSwellPh', this.swellPh)
      .f1('uAudio', Math.max(0, num(I, 'audio', 0))).f1('uSide', Math.max(0, Math.min(1, num(I, 'side', 0))))
      // never 1 : smoothstep with equal edges is undefined (§3)
      .f1('uFogStart', 0.98 - 0.9 * fog).f1('uEdge', 0.8)
      .i1('uHasAudio', hasAudio).i1('uHasSide', hasSide)
      .i1('uAudioTex', 0).i1('uSideTex', 1)
    // A unit the program samples must hold a texture even when the branch that
    // reads it is off, or WebGL warns on every draw : the 1x1 blank stands in.
    g.bind(0, hasAudio ? this.audioTex : this.blank())
    g.bind(1, hasSide ? this.sideTex : this.blank())
    gl.bindVertexArray(g.pointVao)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.MAX)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, form === 0 ? n * n : n * n * n)
    gl.disable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.bindVertexArray(null)

    const [ir, ig, ib] = col(I, 'ink', [0.92, 0.94, 0.95])
    const gv = I.ground
    const ground = Array.isArray(gv) && gv.length >= 4 ? gv : [0.02, 0.02, 0.025, 1]
    this.show.use().i1('uCov', 0).f3('uInk', ir, ig, ib).f4('uGround', ground[0], ground[1], ground[2], ground[3])
    g.bind(0, this.cov.tex)
    g.bind(1, null)
    g.draw(targetFbo, this.w, this.h)
    g.done(2)
  }

  dispose(): void {
    this.g.freeTarget(this.cov)
    this.cov = null
    if (this.blankTex) this.g.gl.deleteTexture(this.blankTex)
    this.blankTex = null
    this.g.dispose()
  }
}
