// FluidSource : the native Fluid generator (id 'gen-fluid'). A real fluid solver
// (Stam's stable fluids, "Stable Fluids", SIGGRAPH 1999, on the GPU after Harris,
// GPU Gems ch. 38) in three kinds :
// - INK : two inks dropped into still water. Wandering nozzles push and stain the
//   water; vorticity confinement keeps the curls the coarse grid would smear, so
//   the ink blooms, folds and threads the way real ink does in a glass;
// - SMOKE : hot plumes from vents along the floor. Buoyancy from temperature
//   lifts them, the gas cools as it rises, and the plume rolls up into eddies and
//   breaks into wisps;
// - FIRE : the same gas burning : temperature drives the lift AND the colour
//   (blackbody, ~800 K deep red to ~2000 K yellow-white), flames puff as the hot
//   column necks off, and soot rises dark above them.
// The velocity grid follows the frame height (`detail` : 96 to 384 rows), the
// dye rides a finer grid (3x), so the look keeps its size in the frame at 1080p,
// 4K and on the dome. Fixed time steps on the layer clock : the same at any frame
// rate. `stir ▸` gives the water a sudden turn, `clear ▸` empties it.
// Lit by the organic relief light (smoke and ink take the light as a thin
// layer; fire is its own light).

import { EngineGL, FS_HEAD, RELIEF, SlotClock, Edge, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'

const MAX_SOURCES = 6
const JACOBI = 24

// Semi-Lagrangian advection : trace back along the velocity, sample there.
// `uDiss` : per-step multiplier (fade). Works for any field at any grid size
// (velocity is in grid cells of the VELOCITY grid per second).
const ADVECT_FS = `${FS_HEAD}
uniform sampler2D uVel, uSrc;
uniform vec2 uVelN, uDstN;
uniform float uDt;
uniform vec4 uDiss;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uDstN;
  vec2 v = texture(uVel, uv).xy;                 // cells / s of the velocity grid
  vec2 back = uv - v * uDt / uVelN;
  o = texture(uSrc, back) * uDiss;
}`

// Sources : gaussian splats of velocity (xy), and of the scalar fields : dye
// (two inks / smoke density / soot) and temperature (the w channel of state).
const SPLAT_FS = `${FS_HEAD}
uniform sampler2D uSrc;
uniform vec2 uDstN;
uniform float uAspect;
uniform int uCount;
uniform vec4 uP[${MAX_SOURCES}];   // x, y (uv), radius (frame heights), strength
uniform vec4 uV[${MAX_SOURCES}];   // what this source adds (per field)
uniform float uDt;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uDstN;
  vec4 s = texture(uSrc, uv);
  for (int i = 0; i < ${MAX_SOURCES}; i++) {
    if (i >= uCount) break;
    vec2 d = (uv - uP[i].xy) * vec2(uAspect, 1.0);
    float g = exp(-dot(d, d) / max(1e-5, uP[i].z * uP[i].z)) * uP[i].w;
    s += uV[i] * g * uDt;
  }
  o = s;
}`

// Buoyancy + soot weight on the velocity (smoke / fire) : hot gas rises, soot
// weighs it down a little.
const BUOY_FS = `${FS_HEAD}
uniform sampler2D uVel, uState;
uniform vec2 uN;
uniform float uDt, uBuoy, uWeight;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uN;
  vec4 v = texture(uVel, uv);
  vec4 st = texture(uState, uv);
  v.y += (st.w * uBuoy - st.x * uWeight) * uDt;
  o = v;
}`

const CURL_FS = `${FS_HEAD}
uniform sampler2D uVel;
uniform ivec2 uN;
out vec4 o;
vec2 at(ivec2 c) { return texelFetch(uVel, clamp(c, ivec2(0), uN - 1), 0).xy; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float w = 0.5 * ((at(c + ivec2(1, 0)).y - at(c - ivec2(1, 0)).y) - (at(c + ivec2(0, 1)).x - at(c - ivec2(0, 1)).x));
  o = vec4(w, 0.0, 0.0, 1.0);
}`

// Vorticity confinement (Fedkiw, Stam, Jensen 2001) : push along N x curl so the
// eddies the grid would smear out keep spinning.
const VORT_FS = `${FS_HEAD}
uniform sampler2D uVel, uCurl;
uniform ivec2 uN;
uniform float uEps, uDt;
out vec4 o;
float cu(ivec2 c) { return texelFetch(uCurl, clamp(c, ivec2(0), uN - 1), 0).x; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 g = 0.5 * vec2(abs(cu(c + ivec2(1, 0))) - abs(cu(c - ivec2(1, 0))), abs(cu(c + ivec2(0, 1))) - abs(cu(c - ivec2(0, 1))));
  vec2 n = g / (length(g) + 1e-5);
  vec2 f = uEps * cu(c) * vec2(n.y, -n.x);
  vec4 v = texelFetch(uVel, c, 0);
  v.xy += f * uDt;
  o = v;
}`

const DIV_FS = `${FS_HEAD}
uniform sampler2D uVel;
uniform ivec2 uN;
out vec4 o;
// Walls : the velocity across the border is mirrored (no flow through).
vec2 at(ivec2 c) {
  vec2 v = texelFetch(uVel, clamp(c, ivec2(0), uN - 1), 0).xy;
  if (c.x < 0 || c.x >= uN.x) v.x = -v.x;
  if (c.y < 0 || c.y >= uN.y) v.y = -v.y;
  return v;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float d = 0.5 * (at(c + ivec2(1, 0)).x - at(c - ivec2(1, 0)).x + at(c + ivec2(0, 1)).y - at(c - ivec2(0, 1)).y);
  o = vec4(d, 0.0, 0.0, 1.0);
}`

const JACOBI_FS = `${FS_HEAD}
uniform sampler2D uP, uDiv;
uniform ivec2 uN;
out vec4 o;
float p(ivec2 c) { return texelFetch(uP, clamp(c, ivec2(0), uN - 1), 0).x; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float d = texelFetch(uDiv, c, 0).x;
  o = vec4((p(c + ivec2(1, 0)) + p(c - ivec2(1, 0)) + p(c + ivec2(0, 1)) + p(c - ivec2(0, 1)) - d) * 0.25, 0.0, 0.0, 1.0);
}`

const GRAD_FS = `${FS_HEAD}
uniform sampler2D uP, uVel;
uniform ivec2 uN;
uniform float uVisc;
out vec4 o;
float p(ivec2 c) { return texelFetch(uP, clamp(c, ivec2(0), uN - 1), 0).x; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 v = texelFetch(uVel, c, 0);
  v.xy -= 0.5 * vec2(p(c + ivec2(1, 0)) - p(c - ivec2(1, 0)), p(c + ivec2(0, 1)) - p(c - ivec2(0, 1)));
  // No flow through the walls; viscosity as a gentle per-step drag.
  if (c.x == 0 || c.x == uN.x - 1) v.x = 0.0;
  if (c.y == 0 || c.y == uN.y - 1) v.y = 0.0;
  v.xy *= uVisc;
  o = v;
}`

// Stir : a large swirl about a random point (the stir event).
const STIR_FS = `${FS_HEAD}
uniform sampler2D uVel;
uniform vec2 uN, uC;
uniform float uAspect, uAmt;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uN;
  vec4 v = texture(uVel, uv);
  vec2 d = (uv - uC) * vec2(uAspect, 1.0);
  float g = exp(-dot(d, d) / 0.06);
  v.xy += vec2(-d.y, d.x) * g * uAmt * uN.y;
  o = v;
}`

const SHOW_FS = `${FS_HEAD}
uniform sampler2D uState;
uniform int uKind;
uniform vec3 uGround, uColA, uColB;
uniform float uRelief, uAngle, uGlow;
out vec4 fragColor;
float dens(vec4 s) {
  if (uKind == 0) return 1.0 - exp(-(s.x + s.y) * 1.6);
  return 1.0 - exp(-s.x * 1.8);
}
float og_height(vec2 uv) { return dens(texture(uState, uv)); }
#define OG_RELIEF_E 2.0
#define OG_SHADOW_STEPS 4
${RELIEF}
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  vec4 s = texture(uState, uv);
  vec3 c;
  if (uKind == 0) {
    // Ink : each ink tints the water toward its own colour by how much is there.
    float a = 1.0 - exp(-s.x * 1.6), b = 1.0 - exp(-s.y * 1.6);
    vec3 ink = (uColA * a + uColB * b) / max(1e-4, a + b);
    float d = 1.0 - (1.0 - a) * (1.0 - b);
    vec3 alb = mix(uGround, ink, d);
    c = mix(alb, og_relief(uv, alb, d, uAngle, uRelief), smoothstep(0.0, 0.25, uRelief));
  } else if (uKind == 1) {
    // Smoke : density over the ground, lit from the side as a thin veil.
    float d = 1.0 - exp(-s.x * 1.8);
    vec3 alb = mix(uGround, uColA, d);
    c = mix(alb, og_relief(uv, alb, d, uAngle, uRelief), smoothstep(0.0, 0.25, uRelief));
  } else {
    // Fire : the gas glows by its temperature (blackbody), soot darkens above.
    float t = clamp(s.w, 0.0, 1.6);
    float soot = 1.0 - exp(-s.x * 1.5);
    vec3 glow = og_blackbody(mix(700.0, 2300.0, clamp(t, 0.0, 1.0))) * smoothstep(0.05, 0.6, t) * (0.6 + 0.8 * t) * uGlow;
    c = mix(uGround, uColA * 0.25, soot) + glow;
  }
  fragColor = vec4(c, 1.0);
}`

interface Fields {
  vel: [Target, Target]
  state: [Target, Target] // x, y : dye A / B (ink) or density (smoke, fire) · w : temperature
  curl: Target
  div: Target
  p: [Target, Target]
  gw: number
  gh: number
  dw: number
  dh: number
}

export class FluidSource implements NativeGenerator {
  private g: EngineGL
  private advect: Prog
  private splat: Prog
  private buoy: Prog
  private curl: Prog
  private vort: Prog
  private divP: Prog
  private jacobi: Prog
  private grad: Prog
  private stirP: Prog
  private show: Prog
  private f: Fields | null = null
  private vi = 0
  private si = 0
  private clock = new SlotClock()
  private acc = 0
  private t = 0
  private seed = Math.random() * 100
  private stirE = new Edge()
  private clearE = new Edge()
  private pendingStir = false
  private pendingClear = false
  private inputs: Record<string, number | number[]> = {}
  private P = new Float32Array(4 * MAX_SOURCES)
  private V = new Float32Array(4 * MAX_SOURCES)

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    const g = (this.g = new EngineGL(gl, 'fluid'))
    this.advect = g.prog(ADVECT_FS)
    this.splat = g.prog(SPLAT_FS)
    this.buoy = g.prog(BUOY_FS)
    this.curl = g.prog(CURL_FS)
    this.vort = g.prog(VORT_FS)
    this.divP = g.prog(DIV_FS)
    this.jacobi = g.prog(JACOBI_FS)
    this.grad = g.prog(GRAD_FS)
    this.stirP = g.prog(STIR_FS)
    this.show = g.prog(SHOW_FS)
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
    if (this.stirE.fired(num(inputs, 'stir', 0))) this.pendingStir = true
    if (this.clearE.fired(num(inputs, 'clear', 0))) this.pendingClear = true
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
    if (typeof value !== 'number') return
    if (name === 'stir' && this.stirE.fired(value)) this.pendingStir = true
    if (name === 'clear' && this.clearE.fired(value)) this.pendingClear = true
  }

  private free(): void {
    const f = this.f
    if (!f) return
    const g = this.g
    for (const t of [...f.vel, ...f.state, ...f.p, f.curl, f.div]) g.freeTarget(t)
    this.f = null
  }

  private ensure(): Fields {
    const detail = Math.max(0, Math.min(1, num(this.inputs, 'detail', 0.5)))
    const gh = Math.round((96 + detail * 288) / 4) * 4
    const gw = Math.max(8, Math.round((gh * this.w) / this.h))
    if (this.f && this.f.gw === gw && this.f.gh === gh) return this.f
    this.free()
    const g = this.g
    const dh = Math.min(1080, gh * 3)
    const dw = Math.max(8, Math.round((dh * this.w) / this.h))
    const half = (w: number, h: number): Target => g.target(w, h, { half: 'rgba', linear: true })
    this.f = {
      vel: [half(gw, gh), half(gw, gh)],
      state: [half(dw, dh), half(dw, dh)],
      curl: half(gw, gh),
      div: half(gw, gh),
      p: [half(gw, gh), half(gw, gh)],
      gw, gh, dw, dh
    }
    this.vi = 0
    this.si = 0
    return this.f
  }

  /** Where the sources are now and what they add (this step). */
  private sources(kind: number, n: number): number {
    const flow = Math.max(0, num(this.inputs, 'flow', 0.5))
    const wander = Math.max(0, Math.min(1, num(this.inputs, 'wander', 0.5)))
    const size = Math.max(0.2, num(this.inputs, 'size', 0.5))
    const t = this.t
    const nz = (i: number, k: number): number =>
      Math.sin(t * (0.13 + 0.07 * i) + this.seed + i * 1.7 + k) * 0.6 + Math.sin(t * (0.31 + 0.05 * i) + i * 2.3 + k * 1.3) * 0.4
    for (let i = 0; i < n; i++) {
      let x: number, y: number, dx: number, dy: number
      if (kind === 0) {
        // Ink : nozzles roam the glass, each pushing its own slowly turning way.
        x = 0.5 + 0.38 * nz(i, 0) * (0.3 + 0.7 * wander) + (i - (n - 1) / 2) * 0.12 * (1 - wander)
        y = 0.5 + 0.34 * nz(i, 5) * (0.3 + 0.7 * wander)
        const a = t * (0.21 + 0.04 * i) + i * 2.4 + 2 * nz(i, 9)
        dx = Math.cos(a)
        dy = Math.sin(a)
      } else {
        // Smoke / fire : vents along the floor, sway with the wander.
        x = (i + 0.5) / n + 0.06 * nz(i, 0) * wander
        y = 0.06
        dx = 0.35 * nz(i, 3) * wander
        dy = 1
      }
      // Puffing : each source breathes on its own irregular rhythm.
      const puff = kind === 2 ? 0.55 + 0.45 * Math.max(0, Math.sin(t * (7 + i) + 3 * nz(i, 7))) : 0.75 + 0.25 * nz(i, 11)
      const r = (kind === 0 ? 0.05 : 0.055) * size
      const P = this.P, V = this.V
      P[i * 4] = x
      P[i * 4 + 1] = y
      P[i * 4 + 2] = r
      P[i * 4 + 3] = flow * puff
      // velocity push (cells/s per s of the velocity grid), written into V for the
      // velocity pass; the scalar amounts are filled per field below.
      V[i * 4] = dx
      V[i * 4 + 1] = dy
      V[i * 4 + 2] = i % 2 // ink : which ink
      V[i * 4 + 3] = 0
    }

    return n
  }

  private step(f: Fields, kind: number, dt: number, count: number): void {
    const g = this.g
    const aspect = this.w / this.h
    const swirl = Math.max(0, num(this.inputs, 'swirl', 0.5))
    const visc = Math.max(0, Math.min(1, num(this.inputs, 'viscosity', 0.2)))
    const fade = Math.max(0, Math.min(1, num(this.inputs, 'fade', 0.3)))
    const buoyIn = num(this.inputs, 'buoyancy', 0.5)
    const push = f.gh * (kind === 0 ? 7 : 2.5) // cells/s gained per second at flow 1

    // 1) advect velocity by itself
    this.advect.use().i1('uVel', 0).i1('uSrc', 1).f2('uVelN', f.gw, f.gh).f2('uDstN', f.gw, f.gh).f1('uDt', dt).f4('uDiss', 1, 1, 1, 1)
    g.bind(0, f.vel[this.vi].tex); g.bind(1, f.vel[this.vi].tex)
    g.draw(f.vel[1 - this.vi].fbo, f.gw, f.gh); this.vi = 1 - this.vi
    // 2) sources push the water
    const Vv = new Float32Array(4 * MAX_SOURCES)
    for (let i = 0; i < count; i++) {
      Vv[i * 4] = this.V[i * 4] * push
      Vv[i * 4 + 1] = this.V[i * 4 + 1] * push
    }
    this.splat.use().i1('uSrc', 0).f2('uDstN', f.gw, f.gh).f1('uAspect', aspect).i1('uCount', count).f1('uDt', dt)
    g.gl.uniform4fv(this.splat.u('uP'), this.P)
    g.gl.uniform4fv(this.splat.u('uV'), Vv)
    g.bind(0, f.vel[this.vi].tex)
    g.draw(f.vel[1 - this.vi].fbo, f.gw, f.gh); this.vi = 1 - this.vi
    // 3) buoyancy (smoke, fire; ink : a slight sinking with buoyancy below 0)
    const buoy = kind === 0 ? buoyIn * 0.3 * f.gh : (0.5 + buoyIn * 2) * f.gh * (kind === 2 ? 1.5 : 1)
    this.buoy.use().i1('uVel', 0).i1('uState', 1).f2('uN', f.gw, f.gh).f1('uDt', dt).f1('uBuoy', buoy).f1('uWeight', kind === 0 ? 0 : 0.08 * f.gh)
    g.bind(0, f.vel[this.vi].tex); g.bind(1, f.state[this.si].tex)
    g.draw(f.vel[1 - this.vi].fbo, f.gw, f.gh); this.vi = 1 - this.vi
    // 4) vorticity confinement
    this.curl.use().i1('uVel', 0).i2('uN', f.gw, f.gh)
    g.bind(0, f.vel[this.vi].tex)
    g.draw(f.curl.fbo, f.gw, f.gh)
    this.vort.use().i1('uVel', 0).i1('uCurl', 1).i2('uN', f.gw, f.gh).f1('uEps', swirl * (kind === 0 ? 30 : 36)).f1('uDt', dt)
    g.bind(0, f.vel[this.vi].tex); g.bind(1, f.curl.tex)
    g.draw(f.vel[1 - this.vi].fbo, f.gw, f.gh); this.vi = 1 - this.vi
    // 5) stir (event)
    if (this.pendingStir) {
      this.pendingStir = false
      this.stirP.use().i1('uVel', 0).f2('uN', f.gw, f.gh).f2('uC', 0.3 + 0.4 * Math.random(), 0.3 + 0.4 * Math.random()).f1('uAspect', aspect).f1('uAmt', (Math.random() < 0.5 ? -1 : 1) * 2.2)
      g.bind(0, f.vel[this.vi].tex)
      g.draw(f.vel[1 - this.vi].fbo, f.gw, f.gh); this.vi = 1 - this.vi
    }
    // 6) project : divergence, pressure, subtract the gradient
    this.divP.use().i1('uVel', 0).i2('uN', f.gw, f.gh)
    g.bind(0, f.vel[this.vi].tex)
    g.draw(f.div.fbo, f.gw, f.gh)
    let pi = 0
    this.jacobi.use().i1('uP', 0).i1('uDiv', 1).i2('uN', f.gw, f.gh)
    g.bind(1, f.div.tex)
    for (let k = 0; k < JACOBI; k++) {
      g.bind(0, f.p[pi].tex)
      g.draw(f.p[1 - pi].fbo, f.gw, f.gh); pi = 1 - pi
    }
    this.grad.use().i1('uP', 0).i1('uVel', 1).i2('uN', f.gw, f.gh).f1('uVisc', Math.pow(1 - visc * 0.012, dt * 60))
    g.bind(0, f.p[pi].tex); g.bind(1, f.vel[this.vi].tex)
    g.draw(f.vel[1 - this.vi].fbo, f.gw, f.gh); this.vi = 1 - this.vi
    // 7) the dye / temperature : sources add, then the water carries them
    const amt = kind === 0 ? 7 : kind === 1 ? 4 : 2.5
    const Vs = new Float32Array(4 * MAX_SOURCES)
    for (let i = 0; i < count; i++) {
      if (kind === 0) {
        Vs[i * 4] = this.V[i * 4 + 2] < 0.5 ? amt : 0
        Vs[i * 4 + 1] = this.V[i * 4 + 2] < 0.5 ? 0 : amt
      } else {
        Vs[i * 4] = kind === 1 ? amt : amt * 0.3 // fire : a little soot at the base
        Vs[i * 4 + 3] = kind === 1 ? 3 : 9 // temperature
      }
    }
    this.splat.use().i1('uSrc', 0).f2('uDstN', f.dw, f.dh).f1('uAspect', aspect).i1('uCount', count).f1('uDt', dt)
    g.gl.uniform4fv(this.splat.u('uP'), this.P)
    g.gl.uniform4fv(this.splat.u('uV'), Vs)
    g.bind(0, f.state[this.si].tex)
    g.draw(f.state[1 - this.si].fbo, f.dw, f.dh); this.si = 1 - this.si
    // fade : ink lingers (tens of seconds), smoke thins over seconds, and the
    // heat cools faster than the gas clears (a plume rises, slows, drifts), fire
    // fastest of all (short flames, soot above them).
    const k = (perStep: number): number => Math.pow(perStep, dt * 60)
    const dye = k(kind === 0 ? 1 - fade * 0.003 : kind === 1 ? 1 - fade * 0.012 : 1 - fade * 0.02)
    const heat = k(kind === 0 ? 0.99 : kind === 1 ? 0.988 : 0.972)
    this.advect.use().i1('uVel', 0).i1('uSrc', 1).f2('uVelN', f.gw, f.gh).f2('uDstN', f.dw, f.dh).f1('uDt', dt).f4('uDiss', dye, dye, dye, heat)
    g.bind(0, f.vel[this.vi].tex); g.bind(1, f.state[this.si].tex)
    g.draw(f.state[1 - this.si].fbo, f.dw, f.dh); this.si = 1 - this.si
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
    const f = this.ensure()
    const kind = Math.max(0, Math.min(2, Math.round(num(this.inputs, 'kind', 0))))
    if (this.pendingClear) {
      this.pendingClear = false
      gl.clearColor(0, 0, 0, 0)
      for (const t of [...f.vel, ...f.state, ...f.p]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
    }
    const dtWall = this.clock.tick(clockSec)
    const rate = Math.max(0, num(this.inputs, 'rate', 1))
    const STEP = 1 / 60
    this.acc = Math.min(this.acc + dtWall * rate, STEP * 4)
    const n = Math.round(Math.max(1, Math.min(MAX_SOURCES, num(this.inputs, 'sources', kind === 0 ? 2 : 3))))
    while (this.acc >= STEP) {
      this.acc -= STEP
      this.t += STEP
      this.sources(kind, n)
      this.step(f, kind, STEP, n)
    }
    const [ar, ag, ab] = col(this.inputs, 'colorA', kind === 0 ? [0.86, 0.9, 0.95] : [0.8, 0.8, 0.82])
    const [br, bg, bb] = col(this.inputs, 'colorB', [0.95, 0.45, 0.18])
    const [gr, gg, gb] = col(this.inputs, 'ground', [0.015, 0.018, 0.024])
    this.show.use()
      .i1('uState', 0).f2('RENDERSIZE', this.w, this.h).i1('uKind', kind)
      .f3('uGround', gr, gg, gb).f3('uColA', ar, ag, ab).f3('uColB', br, bg, bb)
      .f1('uRelief', num(this.inputs, 'relief', 0.35)).f1('uAngle', num(this.inputs, 'lightAngle', 2.36))
      .f1('uGlow', num(this.inputs, 'glow', 1))
    g.bind(0, f.state[this.si].tex)
    g.draw(targetFbo, this.w, this.h)
    g.done(2)
  }

  dispose(): void {
    this.free()
    this.g.dispose()
  }
}
