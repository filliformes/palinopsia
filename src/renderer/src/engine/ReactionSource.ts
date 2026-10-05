// ReactionSource : the native Reaction generator (id 'reaction'). A Gray-Scott
// reaction-diffusion field : two virtual chemicals (U, V) react and diffuse,
// self-organising into drifting spots, stripes, labyrinths and splitting
// critters. Rebuilt natively (it was an ISF shader) for five reasons :
// - FULL PRECISION : the state lives in 32-bit floats. The ISF version kept it in
//   the runtime's 8-bit persistent buffer, which stalls the slow terms (feed adds
//   ~0.0004 a step, under one 8-bit level) and bands the pattern;
// - THE SAME SIZE AT ANY RESOLUTION : the grid follows the frame height (scale 0
//   = a 1080-row grid, 1 = 216 rows), so 4K and the 4096² dome show the pattern
//   1080p shows, at the same size in the frame;
// - FRAME-RATE INDEPENDENT : `rate` is simulated time per second (60 x rate grid
//   units), stepped in fixed sub-steps no larger than the stable step (1.0), so it
//   runs alike at 30, 60 or 144 fps, and rate can go past the old 1.2 cap;
// - SEAMLESS : the grid is a torus and the display samples it wrapped, so zoom
//   below 1 tiles it without a seam;
// - KNOBS NEVER WIPE IT : a scale change resamples the living pattern onto the new
//   grid instead of restarting it.
// Seeding keeps it alive : sparse blocks of V (the `seeding` knob) nucleate new
// critters and keep it off its frozen fixed point; `regrow ▸` clears to the empty
// U = 1 ground and sparks a fresh scatter. Lit as a surface by the organic relief
// light (relief, light angle), like the rest of the Organic family.

import { EngineGL, FS_HEAD, RELIEF, SlotClock, Edge, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'

const STEP_FS = `${FS_HEAD}
uniform sampler2D uS;
uniform ivec2 uN;
uniform float uFeed, uKill, uDt, uSeed, uBlock, uClear;
uniform vec2 uSalt;
out vec4 o;
vec2 at(ivec2 c, int dx, int dy) {
  return texelFetch(uS, ivec2((c.x + dx + uN.x) % uN.x, (c.y + dy + uN.y) % uN.y), 0).rg;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 s = at(c, 0, 0);
  vec2 lap = -s + 0.2 * (at(c, 1, 0) + at(c, -1, 0) + at(c, 0, 1) + at(c, 0, -1))
                + 0.05 * (at(c, 1, 1) + at(c, -1, -1) + at(c, 1, -1) + at(c, -1, 1));
  float U = s.x, V = s.y;
  vec2 blk = floor(vec2(c) / uBlock);
  if (uClear > 0.5) {
    // The empty ground (U = 1) with a fresh scatter of sparks.
    U = 1.0;
    V = step(0.985, og_hash(blk * 1.37 + uSalt * 3.1)) * 0.9;
  } else {
    float uvv = U * V * V;
    U += (lap.x - uvv + uFeed * (1.0 - U)) * uDt;
    V += (0.5 * lap.y + uvv - (uFeed + uKill) * V) * uDt;
    // Sparse seeding : a block of V that nucleates a critter. The scatter is
    // redrawn every 2/3 s of the slot's clock (uSalt), like the ISF version.
    V += step(1.0 - uSeed, og_hash(blk + uSalt)) * 0.5 * min(uDt, 1.0);
  }
  o = vec4(clamp(U, 0.0, 1.0), clamp(V, 0.0, 1.0), 0.0, 1.0);
}`

// Bilinear resample of the old grid onto a new one (scale changed).
const RESAMPLE_FS = `${FS_HEAD}
uniform sampler2D uS;
uniform ivec2 uN;
uniform vec2 uDst;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy / uDst * vec2(uN) - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  #define T(dx, dy) texelFetch(uS, ivec2((i.x + dx + uN.x) % uN.x, (i.y + dy + uN.y) % uN.y), 0)
  o = mix(mix(T(0, 0), T(1, 0), f.x), mix(T(0, 1), T(1, 1), f.x), f.y);
}`

// V into a half-float copy the GPU filters and wraps itself : the display then
// costs one fetch per sample instead of four (the relief samples V 8 times).
const EXTRACT_FS = `${FS_HEAD}
uniform sampler2D uS;
out vec4 o;
void main() { o = vec4(texelFetch(uS, ivec2(gl_FragCoord.xy), 0).g, 0.0, 0.0, 1.0); }`

const SHOW_FS = `${FS_HEAD}
uniform sampler2D uV;
uniform float uZoom, uRot, uSharp, uRelief, uAngle, uReliefE;
uniform vec2 uPan;
uniform vec3 uTint;
out vec4 fragColor;
// The display framing : zoom / pan / rotate about the centre, wrapped (a torus).
vec2 reactUV(vec2 uv) {
  vec2 p = uv - 0.5;
  float a = uRot * 3.14159265;
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
  return p / max(0.05, uZoom) + uPan * 0.5 + 0.5;
}
float reactV(vec2 uv) {
  float v = texture(uV, reactUV(uv)).r; // REPEAT : the torus wraps in hardware
  return smoothstep(0.08, 0.35, pow(clamp(v, 0.0, 1.0), mix(1.0, 3.0, uSharp)));
}
float og_height(vec2 uv) { return reactV(uv); }
#define OG_RELIEF_E uReliefE
${RELIEF}
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  float v = reactV(uv);
  vec3 base = vec3(0.02, 0.02, 0.025);
  vec3 flatc = mix(base, uTint, v);
  // Lit : ridges in the tint, grooves a dark shade of it (not black), so the
  // light has a surface to model.
  vec3 alb = mix(uTint * 0.12 + base, uTint, v);
  vec3 c = mix(flatc, og_relief(uv, alb, v, uAngle, uRelief), smoothstep(0.0, 0.25, uRelief));
  fragColor = vec4(c, 1.0);
}`

export class ReactionSource implements NativeGenerator {
  private g: EngineGL
  private step: Prog
  private resample: Prog
  private show: Prog
  private extract: Prog
  private vis: Target | null = null
  private st: [Target, Target] | null = null
  private cur = 0
  private gw = 0
  private gh = 0
  private clock = new SlotClock()
  private simT = 0 // simulated time (grid units), drives the seeding scatter
  private pendingClear = true
  private regrow = new Edge()
  private inputs: Record<string, number | number[]> = {}

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    this.g = new EngineGL(gl, 'reaction')
    this.step = this.g.prog(STEP_FS)
    this.resample = this.g.prog(RESAMPLE_FS)
    this.show = this.g.prog(SHOW_FS)
    this.extract = this.g.prog(EXTRACT_FS)
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
    if (this.regrow.fired(num(inputs, 'reseed', 0))) this.pendingClear = true
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
    if (name === 'reseed' && typeof value === 'number' && this.regrow.fired(value)) this.pendingClear = true
  }

  /** Grid rows for `scale` : 1080 at 0, 216 at 1 (the ISF version's sampling
   *  stride 1 + 4·scale, now a real grid). */
  private ensureGrid(): void {
    const scale = Math.max(0, Math.min(1, num(this.inputs, 'scale', 0.4)))
    const rows = Math.max(120, Math.round(1080 / (1 + 4 * scale) / 4) * 4)
    const cols = Math.max(4, Math.round((rows * this.w) / this.h))
    if (cols === this.gw && rows === this.gh && this.st) return
    const g = this.g
    const next: [Target, Target] = [g.target(cols, rows), g.target(cols, rows)]
    if (this.st) {
      // Carry the living pattern over to the new grid.
      this.resample.use().i1('uS', 0).i2('uN', this.gw, this.gh).f2('uDst', cols, rows)
      g.bind(0, this.st[this.cur].tex)
      g.draw(next[0].fbo, cols, rows)
      g.freeTarget(this.st[0])
      g.freeTarget(this.st[1])
    } else {
      this.pendingClear = true
    }
    this.st = next
    this.cur = 0
    this.gw = cols
    this.gh = rows
    g.freeTarget(this.vis)
    this.vis = g.target(cols, rows, { half: 'r', linear: true, repeat: true })
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
    this.ensureGrid()
    const st = this.st!
    const dt = this.clock.tick(clockSec)
    const rate = Math.max(0, num(this.inputs, 'rate', 1))
    // Simulated time this frame : the ISF version's one step per frame at 60 fps
    // (dt = rate), now on the clock, in sub-steps no larger than the stable 1.0.
    const sim = dt * 60 * rate
    let n = Math.min(12, Math.ceil(sim - 1e-6))
    if (this.pendingClear) n = Math.max(n, 1)
    const sdt = n > 0 ? Math.min(1, sim / n) : 0
    const scale = Math.max(0, Math.min(1, num(this.inputs, 'scale', 0.4)))
    this.step.use()
      .i1('uS', 0).i2('uN', this.gw, this.gh)
      .f1('uFeed', num(this.inputs, 'feed', 0.037)).f1('uKill', num(this.inputs, 'kill', 0.06))
      .f1('uSeed', Math.max(0, Math.min(1, num(this.inputs, 'seed', 0.3))) * 0.006)
      .f1('uBlock', Math.max(1, 6 / (1 + 4 * scale)))
      .f2('RENDERSIZE', this.gw, this.gh)
    for (let i = 0; i < n; i++) {
      this.simT += sdt
      const salt = Math.floor(this.simT / 40) % 997 // a new scatter every ~2/3 s at rate 1
      this.step.f1('uDt', this.pendingClear ? 0 : sdt).f1('uClear', this.pendingClear ? 1 : 0).f2('uSalt', salt * 17.13, salt * 3.71)
      this.pendingClear = false
      g.bind(0, st[this.cur].tex)
      g.draw(st[1 - this.cur].fbo, this.gw, this.gh)
      this.cur = 1 - this.cur
    }
    // Present : the V field, framed and lit. The relief's difference step spans
    // about one grid cell on screen, so the normals read the pattern, not the
    // bilinear facets between cells.
    this.extract.use().i1('uS', 0)
    g.bind(0, st[this.cur].tex)
    g.draw(this.vis!.fbo, this.gw, this.gh)
    const [tr, tg, tb] = col(this.inputs, 'tint', [0.75, 0.78, 0.72])
    this.show.use()
      .i1('uV', 0)
      .f2('RENDERSIZE', this.w, this.h)
      .f1('uZoom', num(this.inputs, 'zoom', 1)).f1('uRot', num(this.inputs, 'rotate', 0))
      .f2('uPan', num(this.inputs, 'panX', 0), num(this.inputs, 'panY', 0))
      .f1('uSharp', num(this.inputs, 'sharp', 0.5))
      .f1('uRelief', num(this.inputs, 'relief', 0.5)).f1('uAngle', num(this.inputs, 'lightAngle', 2.36))
      .f1('uReliefE', Math.max(1.5, Math.min(10, (this.h / this.gh) * Math.max(1, num(this.inputs, 'zoom', 1)))))
      .f3('uTint', tr, tg, tb)
    g.bind(0, this.vis!.tex)
    g.draw(targetFbo, this.w, this.h)
    g.done(1)
  }

  dispose(): void {
    if (this.st) {
      this.g.freeTarget(this.st[0])
      this.g.freeTarget(this.st[1])
      this.st = null
    }
    this.g.freeTarget(this.vis)
    this.vis = null
    this.g.dispose()
  }
}
