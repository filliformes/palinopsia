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

import { EngineGL, FS_HEAD, RELIEF, SlotClock, Edge, num, col, type Prog } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'
// The simulation itself (step, resample, display copy) is shared with the
// Morphogen effect : reactionSim.ts.
import { ReactionSim } from './reactionSim'

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
  private sim: ReactionSim
  private show: Prog
  private clock = new SlotClock()
  private regrow = new Edge()
  private inputs: Record<string, number | number[]> = {}

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    this.g = new EngineGL(gl, 'reaction')
    this.sim = new ReactionSim(this.g)
    this.show = this.g.prog(SHOW_FS)
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
    if (this.regrow.fired(num(inputs, 'reseed', 0))) this.sim.regrow()
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
    if (name === 'reseed' && typeof value === 'number' && this.regrow.fired(value)) this.sim.regrow()
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
    const scale = Math.max(0, Math.min(1, num(this.inputs, 'scale', 0.4)))
    const sim = this.sim
    sim.ensureGrid(this.w, this.h, scale)
    const dt = this.clock.tick(clockSec)
    sim.run(dt, Math.max(0, num(this.inputs, 'rate', 1)), {
      feed: num(this.inputs, 'feed', 0.037),
      kill: num(this.inputs, 'kill', 0.06),
      seed: num(this.inputs, 'seed', 0.3),
      scale
    })
    // Present : the V field, framed and lit. The relief's difference step spans
    // about one grid cell on screen, so the normals read the pattern, not the
    // bilinear facets between cells.
    const vis = sim.extract()
    const [tr, tg, tb] = col(this.inputs, 'tint', [0.75, 0.78, 0.72])
    this.show.use()
      .i1('uV', 0)
      .f2('RENDERSIZE', this.w, this.h)
      .f1('uZoom', num(this.inputs, 'zoom', 1)).f1('uRot', num(this.inputs, 'rotate', 0))
      .f2('uPan', num(this.inputs, 'panX', 0), num(this.inputs, 'panY', 0))
      .f1('uSharp', num(this.inputs, 'sharp', 0.5))
      .f1('uRelief', num(this.inputs, 'relief', 0.5)).f1('uAngle', num(this.inputs, 'lightAngle', 2.36))
      .f1('uReliefE', Math.max(1.5, Math.min(10, (this.h / sim.gh) * Math.max(1, num(this.inputs, 'zoom', 1)))))
      .f3('uTint', tr, tg, tb)
    g.bind(0, vis)
    g.draw(targetFbo, this.w, this.h)
    g.done(1)
  }

  dispose(): void {
    this.sim.dispose()
    this.g.dispose()
  }
}
