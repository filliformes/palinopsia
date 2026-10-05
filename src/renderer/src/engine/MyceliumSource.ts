// MyceliumSource : the native Mycelium generator (id 'mycelium', replacing the
// ISF version, whose "hyphae" were contour lines of noise : closed loops that
// never had tips, never branched and never fused). Here the network GROWS, the
// way a fungal colony does (the hyphal-tip models of Edelstein, 1982, and
// Boswell et al., 2003) :
// - TIPS are agents. Each extends forward a little every step, its heading
//   wandering slightly but persistent (hyphae run straight-ish), bending toward
//   fresh ground (it smells the nutrient ahead-left / ahead / ahead-right);
// - it BRANCHES : a dead slot is reborn as a side branch of a living tip, off at
//   30 to 60 degrees;
// - it FEEDS : the ground's nutrient is used up around the threads it lays, and a
//   tip that runs into used-up ground (another hypha's, or its own colony's)
//   stops : it fuses into the network (anastomosis) instead of crossing it;
// - so the colony expands as a front from its inoculation points over a patchy
//   ground, densely where the ground is rich, and stalls when it has eaten it;
// - the LIFE CYCLE of the ISF version stays : the colony grows, slowly dissolves,
//   and a new one starts from new spores (`rate` paces it).
// Threads are laid as points into a hyphae map (young threads bright at the
// front, older ones settling darker) that follows the frame height (`scale`),
// lit by the organic relief light (threads raised off the ground).

import { EngineGL, FS_HEAD, RELIEF, SlotClock, Edge, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'

const TIP_W = 256 // 65,536 tip slots

// Tip state : x, y (map pixels), heading, life (1 alive, 0 dead slot).
const STEP_FS = `${FS_HEAD}
uniform sampler2D uTips, uMap;
uniform vec2 uN;
uniform float uStep, uWander, uSense, uBranch, uSalt, uStarve, uSteer;
out vec4 o;
float food(vec2 p) { return texture(uMap, p / uN).b; }
void main() {
  ivec2 me = ivec2(gl_FragCoord.xy);
  vec4 t = texelFetch(uTips, me, 0);
  float r1 = og_hash(gl_FragCoord.xy * 0.913 + uSalt);
  float r2 = og_hash(gl_FragCoord.yx * 1.271 + uSalt * 1.7);
  if (t.w < 0.5) {
    // A dead slot : maybe reborn as a branch of a random living tip.
    ivec2 pj = ivec2(og_hash2(gl_FragCoord.xy * 0.37 + uSalt * 2.3) * ${TIP_W}.0);
    vec4 par = texelFetch(uTips, pj, 0);
    if (par.w > 0.5 && r1 < uBranch) {
      float side = r2 < 0.5 ? -1.0 : 1.0;
      float h = par.z + side * mix(0.52, 1.05, og_hash(gl_FragCoord.xy + uSalt * 0.31));
      o = vec4(par.xy, h, 1.0);
    } else {
      o = t;
    }
    return;
  }
  // Steer : persistent, a little wander, and a pull toward fresh ground.
  float h = t.z + (r1 - 0.5) * uWander;
  float f = food(t.xy + uSense * vec2(cos(h), sin(h)));
  float l = food(t.xy + uSense * vec2(cos(h + 0.5), sin(h + 0.5)));
  float r = food(t.xy + uSense * vec2(cos(h - 0.5), sin(h - 0.5)));
  if (l > f && l > r) h += uSteer; else if (r > f && r > l) h -= uSteer;
  vec2 p = t.xy + uStep * vec2(cos(h), sin(h));
  // Off the map, starved (eaten ground : another thread is there) or old : stop.
  bool out_ = any(lessThan(p, vec2(1.0))) || any(greaterThan(p, uN - 1.0));
  float here = out_ ? 0.0 : food(p);
  float die = step(here, uStarve) + step(1.0 - 0.0002, r2);
  o = (out_ || die > 0.5) ? vec4(p, h, 0.0) : vec4(p, h, 1.0);
}`

// Inoculation : spores at the seed points (a few tips each), every other slot dead.
const SEED_FS = `${FS_HEAD}
uniform vec2 uN;
uniform float uSeeds, uSalt;
out vec4 o;
void main() {
  vec2 c = gl_FragCoord.xy;
  float id = floor(c.y) * ${TIP_W}.0 + floor(c.x);
  float perSeed = 6.0;
  if (id >= uSeeds * perSeed) { o = vec4(0.0); return; }
  float s = floor(id / perSeed);
  vec2 sp = vec2(0.18, 0.18) + og_hash2(vec2(s * 3.17, s * 1.31) + uSalt) * vec2(0.64, 0.64);
  vec2 p = sp * uN + (og_hash2(c + uSalt) - 0.5) * 3.0;
  o = vec4(p, og_hash(c * 1.7 + uSalt) * 6.2831853, 1.0);
}`

// Map : r = hyphae (laid threads), g = young threads (the front, fades), b = food.
const MAP_SEED_FS = `${FS_HEAD}
uniform vec2 uN;
uniform float uSalt, uPatch;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy / uN.y * 6.0 + uSalt;
  float n = og_fbm(p, 4.0);
  o = vec4(0.0, 0.0, clamp(mix(1.0, 0.35 + 0.95 * n, uPatch), 0.0, 1.0), 1.0);
}`

const DEPOSIT_VS = `#version 300 es
precision highp float;
uniform sampler2D uTips;
uniform vec2 uN;
void main() {
  ivec2 c = ivec2(gl_VertexID % ${TIP_W}, gl_VertexID / ${TIP_W});
  vec4 t = texelFetch(uTips, c, 0);
  vec2 p = (floor(t.xy) + 0.5) / uN * 2.0 - 1.0;
  gl_Position = t.w > 0.5 ? vec4(p, 0.0, 1.0) : vec4(9.0, 9.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`
const DEPOSIT_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.35, 0.6, 0.0, 0.0); }`

// The ground : threads eat the food around them (it spreads a little), the
// young glow of the front fades, and during the dissolve everything thins.
const MAP_FS = `${FS_HEAD}
uniform sampler2D uMap;
uniform ivec2 uN;
uniform float uEat, uYoung, uDissolve;
out vec4 o;
vec4 at(ivec2 c) { return texelFetch(uMap, clamp(c, ivec2(0), uN - 1), 0); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 m = at(c);
  float h = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) h += min(at(c + ivec2(x, y)).r, 1.0);
  m.b = max(0.0, m.b - uEat * h);
  m.r = min(m.r, 1.5) * uDissolve;
  m.g *= uYoung;
  o = m;
}`

const SHOW_FS = `${FS_HEAD}
uniform sampler2D uMap;
uniform vec3 uTint, uGround;
uniform float uWidth, uFront, uRelief, uAngle;
out vec4 fragColor;
float thread(vec2 uv) {
  float r = texture(uMap, uv).r;
  return smoothstep(0.02, 0.02 + 0.6 * (1.0 - uWidth), r);
}
float og_height(vec2 uv) { return thread(uv); }
#define OG_RELIEF_E 1.2
#define OG_SHADOW_STEPS 3
${RELIEF}
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  vec4 m = texture(uMap, uv);
  float v = thread(uv);
  float young = clamp(m.g, 0.0, 1.0);
  // Older threads settle into the ground's tone, the front stays bright.
  vec3 tc = mix(uTint * mix(0.55, 1.0, 1.0 - uFront), uTint * 1.15, young * uFront);
  vec3 alb = mix(uGround, tc, v);
  vec3 c = mix(alb, og_relief(uv, alb, v, uAngle, uRelief), smoothstep(0.0, 0.25, uRelief));
  // Where the food is spent the ground darkens a hair (the colony's stain).
  c *= mix(0.85, 1.0, clamp(m.b * 1.5, 0.0, 1.0));
  fragColor = vec4(c, 1.0);
}`

export class MyceliumSource implements NativeGenerator {
  private g: EngineGL
  private step: Prog
  private seed: Prog
  private mapSeed: Prog
  private dep: Prog
  private map: Prog
  private show: Prog
  private tips: [Target, Target] | null = null
  private mp: [Target, Target] | null = null
  private ti = 0
  private mi = 0
  private mw = 0
  private mh = 0
  private clock = new SlotClock()
  private acc = 0
  private n = 0
  private life = 0 // seconds into this colony's cycle
  private pendingSeed = true
  private regrowE = new Edge()
  private inputs: Record<string, number | number[]> = {}

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    const g = (this.g = new EngineGL(gl, 'mycelium'))
    this.step = g.prog(STEP_FS)
    this.seed = g.prog(SEED_FS)
    this.mapSeed = g.prog(MAP_SEED_FS)
    this.dep = g.prog(DEPOSIT_FS, DEPOSIT_VS)
    this.map = g.prog(MAP_FS)
    this.show = g.prog(SHOW_FS)
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
    if (this.regrowE.fired(num(inputs, 'reseed', 0))) this.pendingSeed = true
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
    if (name === 'reseed' && typeof value === 'number' && this.regrowE.fired(value)) this.pendingSeed = true
  }

  private ensure(): void {
    const g = this.g
    if (!this.tips) this.tips = [g.target(TIP_W, TIP_W), g.target(TIP_W, TIP_W)]
    // `scale` 1..10 (the ISF version's noise scale, higher = finer) : the map's
    // rows, so finer networks get a finer map.
    const scale = Math.max(1, Math.min(10, num(this.inputs, 'scale', 4)))
    const rows = Math.round((240 + scale * 60) / 4) * 4
    const cols = Math.max(8, Math.round((rows * this.w) / this.h))
    if (this.mp && cols === this.mw && rows === this.mh) return
    if (this.mp) { g.freeTarget(this.mp[0]); g.freeTarget(this.mp[1]) }
    const t = (): Target => g.target(cols, rows, { half: 'rgba', linear: true })
    this.mp = [t(), t()]
    this.mw = cols
    this.mh = rows
    this.pendingSeed = true
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
    this.ensure()
    const T = this.tips!, M = this.mp!
    const dt = this.clock.tick(clockSec)
    // `rate` (the ISF version's life-cycle speed, 0.25 by default) : how fast the
    // tips run and how long a colony lives.
    const rate = Math.max(0, num(this.inputs, 'rate', 0.25))
    const speed = 0.4 + rate * 2.4
    const cycle = 75 / Math.max(0.05, 0.4 + rate * 2.4) // seconds per colony at this speed
    this.life += dt
    if (this.life > cycle) this.pendingSeed = true
    const dissolveFrom = cycle * 0.8
    if (this.pendingSeed) {
      this.pendingSeed = false
      this.life = 0
      const salt = Math.random() * 100
      const seeds = 1 + Math.round(Math.max(0, Math.min(1, num(this.inputs, 'density', 0.5))) * 2)
      this.seed.use().f2('uN', this.mw, this.mh).f1('uSeeds', seeds).f1('uSalt', salt)
      g.draw(T[this.ti].fbo, TIP_W, TIP_W)
      this.mapSeed.use().f2('uN', this.mw, this.mh).f1('uSalt', salt).f1('uPatch', 0.8)
      g.draw(M[this.mi].fbo, this.mw, this.mh)
    }
    const STEP = 1 / 60
    this.acc = Math.min(this.acc + dt * speed, STEP * 4)
    const density = Math.max(0, Math.min(1, num(this.inputs, 'density', 0.5)))
    const front = Math.max(0, Math.min(1, num(this.inputs, 'front', 0.35)))
    const dissolve = this.life > dissolveFrom ? 0.985 : 1
    while (this.acc >= STEP) {
      this.acc -= STEP
      this.n++
      this.step.use().i1('uTips', 0).i1('uMap', 1).f2('uN', this.mw, this.mh)
        // Hyphae run nearly straight (a few degrees of wander a step) and branch
        // every second or so; a curling random walk ran back into its own
        // threads and starved.
        .f1('uStep', 0.7).f1('uWander', 0.07).f1('uSteer', 0.03).f1('uSense', 5)
        .f1('uBranch', 0.004 + density * 0.012).f1('uSalt', (this.n % 991) * 0.173)
        .f1('uStarve', 0.08)
      g.bind(0, T[this.ti].tex); g.bind(1, M[this.mi].tex)
      g.draw(T[1 - this.ti].fbo, TIP_W, TIP_W); this.ti = 1 - this.ti
      g.bind(1, null)
      this.dep.use().i1('uTips', 0).f2('uN', this.mw, this.mh)
      g.bind(0, T[this.ti].tex)
      g.drawPointsAdd(M[this.mi].fbo, this.mw, this.mh, TIP_W * TIP_W)
      this.map.use().i1('uMap', 0).i2('uN', this.mw, this.mh)
        .f1('uEat', 0.04).f1('uYoung', Math.pow(0.985 - front * 0.01, 1)).f1('uDissolve', dissolve)
      g.bind(0, M[this.mi].tex)
      g.draw(M[1 - this.mi].fbo, this.mw, this.mh); this.mi = 1 - this.mi
    }
    const [tr, tg, tb] = col(this.inputs, 'tint', [0.85, 0.82, 0.7])
    const [gr, gg, gb] = col(this.inputs, 'ground', [0.018, 0.016, 0.014])
    this.show.use().i1('uMap', 0).f2('RENDERSIZE', this.w, this.h)
      .f3('uTint', tr, tg, tb).f3('uGround', gr, gg, gb)
      .f1('uWidth', Math.max(0, Math.min(1, (num(this.inputs, 'width', 0.12) - 0.02) / 0.48)))
      .f1('uFront', front).f1('uRelief', num(this.inputs, 'relief', 0.5)).f1('uAngle', num(this.inputs, 'lightAngle', 2.36))
    g.bind(0, M[this.mi].tex)
    g.draw(targetFbo, this.w, this.h)
    g.done(2)
  }

  dispose(): void {
    const g = this.g
    for (const t of [...(this.tips ?? []), ...(this.mp ?? [])]) g.freeTarget(t)
    this.tips = null
    this.mp = null
    g.dispose()
  }
}
