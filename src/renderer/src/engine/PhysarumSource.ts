// PhysarumSource : the native Slime Mould generator (id 'gen-physarum'). The
// agent model of Physarum polycephalum (Jones, "Characteristics of pattern
// formation and evolution in approximations of Physarum transport networks",
// Artificial Life 16, 2010) : hundreds of thousands of particles, each sensing
// the chemical trail ahead-left, ahead and ahead-right, turning toward the
// strongest, stepping forward and depositing more trail; the trail spreads and
// evaporates. Out of nothing but those rules the slime builds and rebuilds a
// living transport network : veins that thicken where traffic is heavy, prune
// where it isn't, and reroute when disturbed.
//
// Agents live in a float texture (x, y in trail pixels, heading) stepped by a
// fragment shader; deposits are a point cloud added into the trail map; the
// trail map follows the frame height (`scale`), so the network keeps its size at
// 1080p, 4K and on the dome. Fixed steps on the layer clock. Lit by the organic
// relief light (the network stands off the ground like a slime vein).

import { EngineGL, FS_HEAD, RELIEF, SlotClock, Edge, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'

const AGENT_W = 512 // up to 512² = 262,144 agents

const STEP_FS = `${FS_HEAD}
uniform sampler2D uAgents, uTrail;
uniform vec2 uN;
uniform float uSA, uSO, uRA, uSS, uSalt, uJitter;
out vec4 o;
float trail(vec2 p) { return texture(uTrail, p / uN).r; } // REPEAT : the world wraps
void main() {
  vec4 a = texelFetch(uAgents, ivec2(gl_FragCoord.xy), 0);
  if (a.w < 0.5) { o = a; return; } // an unused slot (fewer agents than slots)
  float h = a.z;
  float f = trail(a.xy + uSO * vec2(cos(h), sin(h)));
  float l = trail(a.xy + uSO * vec2(cos(h + uSA), sin(h + uSA)));
  float r = trail(a.xy + uSO * vec2(cos(h - uSA), sin(h - uSA)));
  float rnd = og_hash(gl_FragCoord.xy * 0.731 + uSalt);
  if (f > l && f > r) {
    // keep going
  } else if (f < l && f < r) {
    h += (rnd < 0.5 ? -uRA : uRA);           // both sides better : pick one
  } else if (l > r) {
    h += uRA;
  } else if (r > l) {
    h -= uRA;
  }
  h += (og_hash(gl_FragCoord.yx * 1.37 + uSalt * 0.7) - 0.5) * uJitter;
  vec2 p = mod(a.xy + uSS * vec2(cos(h), sin(h)), uN);
  o = vec4(p, mod(h, 6.2831853), 1.0);
}`

// Agents seeded in one of three shapes : scattered, a disc, a ring (heading
// outward or random).
const SEED_FS = `${FS_HEAD}
uniform vec2 uN;
uniform float uCount, uShape, uSalt;
out vec4 o;
void main() {
  vec2 c = gl_FragCoord.xy;
  float id = floor(c.y) * ${AGENT_W}.0 + floor(c.x);
  if (id >= uCount) { o = vec4(0.0); return; }
  vec2 h2 = og_hash2(c * 0.917 + uSalt);
  float h3 = og_hash(c.yx * 1.31 + uSalt);
  vec2 p;
  float head = h3 * 6.2831853;
  float R = 0.42 * uN.y;
  if (uShape < 0.5) {
    p = h2 * uN;
  } else if (uShape < 1.5) {
    float ang = h2.x * 6.2831853, rad = sqrt(h2.y) * R;
    p = uN * 0.5 + rad * vec2(cos(ang), sin(ang));
    head = ang + 3.14159265;                  // inward : the disc contracts into veins
  } else {
    float ang = h2.x * 6.2831853, rad = R * (0.92 + 0.08 * h2.y);
    p = uN * 0.5 + rad * vec2(cos(ang), sin(ang));
    head = ang + 3.14159265 + (h3 - 0.5);
  }
  o = vec4(mod(p, uN), head, 1.0);
}`

// One point per agent slot, at the agent's position; unused slots fall outside.
const DEPOSIT_VS = `#version 300 es
precision highp float;
uniform sampler2D uAgents;
uniform vec2 uN;
void main() {
  ivec2 c = ivec2(gl_VertexID % ${AGENT_W}, gl_VertexID / ${AGENT_W});
  vec4 a = texelFetch(uAgents, c, 0);
  vec2 p = (floor(a.xy) + 0.5) / uN * 2.0 - 1.0;
  gl_Position = a.w > 0.5 ? vec4(p, 0.0, 1.0) : vec4(9.0, 9.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`
const DEPOSIT_FS = `#version 300 es
precision highp float;
uniform float uDep;
out vec4 o;
void main() { o = vec4(uDep, 0.0, 0.0, 1.0); }`

// Spread (3x3 mean) and evaporate.
const DIFFUSE_FS = `${FS_HEAD}
uniform sampler2D uTrail;
uniform ivec2 uN;
uniform float uDiffuse, uDecay, uCap;
out vec4 o;
float at(ivec2 c) { return texelFetch(uTrail, ivec2((c.x + uN.x) % uN.x, (c.y + uN.y) % uN.y), 0).r; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float s = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) s += at(c + ivec2(x, y));
  float v = mix(at(c), s / 9.0, uDiffuse) * uDecay;
  // Saturate : Jones' agents could not share a cell, which kept the veins fine.
  // Here many can, so a crowded vein would pull ever more agents in and the
  // network would collapse into a few fat cords; a saturated trail stops
  // rewarding crowding (every full vein smells the same).
  o = vec4(min(v, uCap), 0.0, 0.0, 1.0);
}`

const SHOW_FS = `${FS_HEAD}
uniform sampler2D uTrail;
uniform vec3 uTint, uGround;
uniform float uGain, uGlow, uRelief, uAngle, uZoom;
out vec4 fragColor;
vec2 frameUV(vec2 uv) { return (uv - 0.5) / max(0.05, uZoom) + 0.5; }
float net(vec2 uv) { return 1.0 - exp(-texture(uTrail, frameUV(uv)).r * uGain); }
float og_height(vec2 uv) { return net(uv); }
#define OG_RELIEF_E 1.5
#define OG_SHADOW_STEPS 3
${RELIEF}
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  float v = net(uv);
  vec3 alb = mix(uGround, uTint, smoothstep(0.02, 0.9, v));
  vec3 lit = mix(alb, og_relief(uv, alb, v, uAngle, uRelief), smoothstep(0.0, 0.25, uRelief));
  // The busiest veins glow a little (the slime's translucency).
  fragColor = vec4(lit + uTint * pow(v, 3.0) * uGlow * 0.6, 1.0);
}`

export class PhysarumSource implements NativeGenerator {
  private g: EngineGL
  private step: Prog
  private seed: Prog
  private dep: Prog
  private diff: Prog
  private show: Prog
  private agents: [Target, Target] | null = null
  private trail: [Target, Target] | null = null
  private ai = 0
  private ti = 0
  private tw = 0
  private th = 0
  private count = 0
  private clock = new SlotClock()
  private acc = 0
  private n = 0
  private pendingSeed = true
  private reseedE = new Edge()
  private inputs: Record<string, number | number[]> = {}

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    const g = (this.g = new EngineGL(gl, 'physarum'))
    this.step = g.prog(STEP_FS)
    this.seed = g.prog(SEED_FS)
    this.dep = g.prog(DEPOSIT_FS, DEPOSIT_VS)
    this.diff = g.prog(DIFFUSE_FS)
    this.show = g.prog(SHOW_FS)
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
    if (this.reseedE.fired(num(inputs, 'reseed', 0))) this.pendingSeed = true
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
    if (name === 'reseed' && typeof value === 'number' && this.reseedE.fired(value)) this.pendingSeed = true
  }

  private ensure(): void {
    const g = this.g
    if (!this.agents) this.agents = [g.target(AGENT_W, AGENT_W), g.target(AGENT_W, AGENT_W)]
    const scale = Math.max(0, Math.min(1, num(this.inputs, 'scale', 0.4)))
    const rows = Math.round(1080 / (1 + 3 * scale) / 4) * 4
    const cols = Math.max(8, Math.round((rows * this.w) / this.h))
    if (this.trail && cols === this.tw && rows === this.th) return
    if (this.trail) { g.freeTarget(this.trail[0]); g.freeTarget(this.trail[1]) }
    const t = (): Target => g.target(cols, rows, { half: 'r', linear: true, repeat: true })
    this.trail = [t(), t()]
    this.tw = cols
    this.th = rows
    this.pendingSeed = true // a new world size : the agents start over in it
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
    const A = this.agents!, T = this.trail!
    const density = Math.max(0.02, Math.min(1, num(this.inputs, 'agents', 0.5)))
    // Agents scale with the world's area so the density reads the same at any size.
    // (Jones runs 3-15 % of cells occupied : denser collapses into a few thick cords.)
    this.count = Math.min(AGENT_W * AGENT_W, Math.round(density * 0.3 * this.tw * this.th))
    if (this.pendingSeed) {
      this.pendingSeed = false
      this.seed.use().f2('uN', this.tw, this.th).f1('uCount', this.count).f1('uShape', Math.round(num(this.inputs, 'shape', 0))).f1('uSalt', Math.random() * 100)
      g.draw(A[this.ai].fbo, AGENT_W, AGENT_W)
      gl.clearColor(0, 0, 0, 0)
      for (const t of T) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clear(gl.COLOR_BUFFER_BIT) }
    }
    const dt = this.clock.tick(clockSec)
    const rate = Math.max(0, num(this.inputs, 'rate', 1))
    const STEP = 1 / 60
    this.acc = Math.min(this.acc + dt * rate, STEP * 3)
    const sa = (Math.max(5, Math.min(90, num(this.inputs, 'sensorAngle', 22.5))) * Math.PI) / 180
    const turn = (Math.max(5, Math.min(90, num(this.inputs, 'turn', 45))) * Math.PI) / 180
    const so = Math.max(1, num(this.inputs, 'sensor', 9))
    const ss = Math.max(0.2, num(this.inputs, 'speed', 1))
    const decay = Math.max(0, Math.min(1, num(this.inputs, 'decay', 0.5)))
    const diffuse = Math.max(0, Math.min(1, num(this.inputs, 'diffuse', 0.5)))
    while (this.acc >= STEP) {
      this.acc -= STEP
      this.n++
      // agents sense the trail and move
      this.step.use().i1('uAgents', 0).i1('uTrail', 1).f2('uN', this.tw, this.th)
        .f1('uSA', sa).f1('uSO', so).f1('uRA', turn).f1('uSS', ss).f1('uSalt', (this.n % 997) * 0.137)
        .f1('uJitter', Math.max(0, num(this.inputs, 'wobble', 0.15)))
      g.bind(0, A[this.ai].tex); g.bind(1, T[this.ti].tex)
      g.draw(A[1 - this.ai].fbo, AGENT_W, AGENT_W); this.ai = 1 - this.ai
      // they deposit
      g.bind(1, null)
      this.dep.use().i1('uAgents', 0).f2('uN', this.tw, this.th).f1('uDep', Math.max(0, num(this.inputs, 'deposit', 0.5)) * 0.4)
      g.bind(0, A[this.ai].tex)
      g.drawPointsAdd(T[this.ti].fbo, this.tw, this.th, this.count)
      // the trail spreads and evaporates
      this.diff.use().i1('uTrail', 0).i2('uN', this.tw, this.th).f1('uDiffuse', diffuse).f1('uDecay', 1 - (0.01 + decay * 0.09)).f1('uCap', 0.25 + Math.max(0, num(this.inputs, 'deposit', 0.5)) * 0.5)
      g.bind(0, T[this.ti].tex)
      g.draw(T[1 - this.ti].fbo, this.tw, this.th); this.ti = 1 - this.ti
    }
    const [tr, tg, tb] = col(this.inputs, 'tint', [0.95, 0.82, 0.32])
    const [gr, gg, gb] = col(this.inputs, 'ground', [0.012, 0.012, 0.01])
    this.show.use().i1('uTrail', 0).f2('RENDERSIZE', this.w, this.h)
      .f3('uTint', tr, tg, tb).f3('uGround', gr, gg, gb)
      .f1('uGain', 0.35 + 2.5 * Math.max(0, num(this.inputs, 'contrast', 0.5)))
      .f1('uGlow', Math.max(0, num(this.inputs, 'glow', 0.5)))
      .f1('uRelief', num(this.inputs, 'relief', 0.4)).f1('uAngle', num(this.inputs, 'lightAngle', 2.36))
      .f1('uZoom', num(this.inputs, 'zoom', 1))
    g.bind(0, T[this.ti].tex)
    g.draw(targetFbo, this.w, this.h)
    g.done(2)
  }

  dispose(): void {
    const g = this.g
    for (const t of [...(this.agents ?? []), ...(this.trail ?? [])]) g.freeTarget(t)
    this.agents = null
    this.trail = null
    g.dispose()
  }
}
