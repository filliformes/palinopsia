// Morphogen (the native node 'node-reaction') : reaction-diffusion as an effect. The
// Reaction source's own Gray-Scott simulation (reactionSim.ts, compiled with RD_STEER)
// runs on its own fixed grid (the frame HEIGHT sets it, so the pattern keeps its size
// at 1080p, 4K and on the dome), and the layer's picture FEEDS and STEERS it :
// - its darks and lights (or its warm and cool colors) push feed and kill per cell,
//   so each part of the picture grows its own species (spots in one, mazes in another);
// - it PLANTS new growth where it asks : along its edges, where it moves, or in its
//   lights (as well as the sparse random sparks the source has);
// - where it MOVES, the pattern moves with it (the picture's optical flow, measured
//   on a fixed 256 field : pictureFlow.ts, carries the living state);
// and the pattern comes back over the picture in one of five looks : the picture seen
// through the pattern, the pattern inked over it, the picture embossed by it, the
// pattern as a matte (the layer's alpha), or the picture pushed along its slopes.
// A sidechain layer can do the steering instead (a Noise, a film, a camera), while
// this layer is what the pattern shows. Lit by the organic relief light, like the
// Reaction source.

import type { ConvNode, NodeContext } from './convNodes'
import { EngineGL, FS_HEAD, RELIEF, Edge, num, col, type Prog, type Target } from './organicGL'
import { ReactionSim } from './reactionSim'
import { PictureFlow, PICTURE_FLOW_RES } from './pictureFlow'
import { glGeneration } from './glGeneration'

// The steer texture, one texel a grid cell : r = the feed / kill push (-1..1),
// g = how much this cell is planted (0..1), ba = the picture's motion this frame in
// grid cells. The picture is read with a small box over the cell (no aliasing of fine
// texture into the push), premultiplied (transparency counts as dark).
const STEER_FS = `${FS_HEAD}
uniform sampler2D uSrc, uFlow;
uniform vec2 uGrid;
uniform int uSteer, uFrom;
uniform float uContrast;
out vec4 o;
float lum(vec4 c) { return dot(c.rgb, vec3(0.299, 0.587, 0.114)) * c.a; }
vec4 px(vec2 uv) { return texture(uSrc, uv); }
void main() {
  vec2 uv = gl_FragCoord.xy / uGrid;
  vec2 q = 0.25 / uGrid;
  vec4 c = 0.25 * (px(uv + vec2(-q.x, -q.y)) + px(uv + vec2(q.x, -q.y)) + px(uv + vec2(-q.x, q.y)) + px(uv + vec2(q.x, q.y)));
  float l = lum(c);
  float push = 0.0;
  if (uSteer == 0) push = (l - 0.5) * 2.0;
  else if (uSteer == 1) push = (c.r - c.b) * 1.6 * c.a;
  push = clamp(push * uContrast, -1.0, 1.0);
  vec2 f = texture(uFlow, uv).rg;                     // 256-field texels this frame
  vec2 cells = f * uGrid / ${PICTURE_FLOW_RES}.0;
  float plant;
  if (uFrom == 0) {
    // edges : the luma slope across about a cell
    vec2 e = 1.0 / uGrid;
    float gx = lum(px(uv + vec2(e.x, 0.0))) - lum(px(uv - vec2(e.x, 0.0)));
    float gy = lum(px(uv + vec2(0.0, e.y))) - lum(px(uv - vec2(0.0, e.y)));
    plant = smoothstep(0.05, 0.3, length(vec2(gx, gy)));
  } else if (uFrom == 1) {
    plant = smoothstep(0.03, 0.35, length(f));         // where it moves
  } else {
    plant = smoothstep(0.45, 0.95, l);                 // its lights
  }
  o = vec4(push, plant, cells);
}`

// The looks. One small program each (a mode switch in one program costs every look
// all of them on D3D). `og_height` is the pattern, sharpened as the source shows it.
const showFs = (look: number): string => `${FS_HEAD}#define LOOK ${look}
uniform sampler2D uHost, uV;
uniform float uSharp, uRelief, uAngle, uReliefE, uAmount, uMix;
uniform vec3 uInk;
out vec4 fragColor;
float reactV(vec2 uv) {
  // V lives about 0..0.4 where a pattern grows (its spots and ridges peak near
  // 0.3) : scaled up to the whole 0..1 before the source's own sharpening curve,
  // or a living coral reads as an empty ground
  float v = texture(uV, uv).r * 2.6;
  return smoothstep(0.08, 0.35, pow(clamp(v, 0.0, 1.0), mix(1.0, 3.0, uSharp)));
}
float og_height(vec2 uv) { return reactV(uv); }
#define OG_RELIEF_E uReliefE
${RELIEF}
vec4 pm(vec4 c) { return vec4(c.rgb * c.a, c.a); }
vec2 mirror(vec2 u) { return 1.0 - abs(1.0 - mod(u, 2.0)); }
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  vec4 h = texture(uHost, uv);
  float v = reactV(uv);
  float lit = smoothstep(0.0, 0.25, uRelief);
  vec4 w;
#if LOOK == 0
  // the picture seen through the pattern : its ridges keep the picture, its grooves
  // sink toward a dark shade of it (never black), lit as a surface
  vec3 alb = h.rgb * mix(1.0 - 0.88 * uAmount, 1.0, v);
  w = vec4(mix(alb, og_relief(uv, alb, v, uAngle, uRelief), lit), h.a);
#elif LOOK == 1
  // the pattern inked over the picture (it grows into transparency too)
  vec3 ink = mix(uInk * 0.12, uInk, v);
  ink = mix(ink, og_relief(uv, ink, v, uAngle, uRelief), lit);
  float k = clamp(v * uAmount, 0.0, 1.0);
  float ka = k + h.a * (1.0 - k);
  w = vec4(ka > 1e-5 ? (ink * k + h.rgb * h.a * (1.0 - k)) / ka : h.rgb, ka);
#elif LOOK == 2
  // the picture embossed by the pattern : its own colors, carved by the light
  w = vec4(og_relief(uv, h.rgb, v, uAngle, uAmount), h.a);
#elif LOOK == 3
  // the pattern as a matte : the layer shows only where it grows
  w = vec4(h.rgb, h.a * mix(1.0, v, uAmount));
#else
  // the picture pushed along the pattern's slopes (a lens of it)
  float e = uReliefE / RENDERSIZE.y;
  float asp = RENDERSIZE.x / RENDERSIZE.y;
  vec2 gr = vec2(reactV(uv + vec2(e / asp, 0.0)) - reactV(uv - vec2(e / asp, 0.0)), reactV(uv + vec2(0.0, e)) - reactV(uv - vec2(0.0, e)));
  vec2 q = mirror(uv + gr * uAmount * 0.05 * vec2(1.0 / asp, 1.0));
  w = texture(uHost, q);
#endif
  // dry / wet, premultiplied : the result never covers less than the picture
  vec4 c = mix(pm(h), pm(w), uMix);
  float a = c.a;
#if LOOK == 4
  a = max(a, h.a); // moved content never opens a hole in the picture
#endif
  fragColor = vec4(c.a > 1e-5 ? c.rgb / c.a : h.rgb, a);
}`

export class MorphogenNode implements ConvNode {
  private gen = glGeneration()
  private g: EngineGL | null = null
  private sim: ReactionSim | null = null
  private flow: PictureFlow | null = null
  private steerP: Prog | null = null
  private shows: (Prog | null)[] = [null, null, null, null, null]
  private steer: Target | null = null
  private lastFrame = -1
  private regrowE = new Edge()

  constructor(private gl: WebGL2RenderingContext) {}

  private build(): EngineGL {
    const g = new EngineGL(this.gl, 'morphogen')
    this.g = g
    this.sim = new ReactionSim(g, true)
    this.flow = new PictureFlow(g)
    this.steerP = g.prog(STEER_FS)
    this.shows = [null, null, null, null, null]
    this.steer = null
    this.lastFrame = -1
    return g
  }

  private show(look: number): Prog {
    let p = this.shows[look]
    if (!p) p = this.shows[look] = this.g!.prog(showFs(look))
    return p
  }

  render(ctx: NodeContext): WebGLTexture {
    const gl = this.gl
    if (gl.isContextLost()) return ctx.host
    // a GPU reset this window saw : everything held is dead, start over
    if (this.gen !== glGeneration()) {
      this.g = null
      this.gen = glGeneration()
    }
    const g = this.g ?? this.build()
    if (!g.ok) return ctx.host
    const sim = this.sim!
    const inp = ctx.inputs
    const W = ctx.chain.w, H = ctx.chain.h
    const scale = Math.max(0, Math.min(1, num(inp, 'scale', 0.45)))
    if (sim.ensureGrid(W, H, scale) || !this.steer) {
      g.freeTarget(this.steer)
      this.steer = g.target(sim.gw, sim.gh, { half: 'rgba' })
    }
    if (this.regrowE.fired(num(inp, 'reseed', 0))) sim.regrow()
    const restart = this.lastFrame < 0 || (ctx.frame !== undefined && ctx.frame !== this.lastFrame + 1)
    this.lastFrame = ctx.frame ?? 0

    // 1) the steering picture's motion and its push / planting, at grid size
    const src = ctx.sidechain ?? ctx.host
    this.flow!.update(src, restart)
    this.steerP!.use()
      .i1('uSrc', 0).i1('uFlow', 1)
      .f2('uGrid', sim.gw, sim.gh)
      .i1('uSteer', Math.round(num(inp, 'steer', 0)))
      .i1('uFrom', Math.round(num(inp, 'plantFrom', 0)))
      .f1('uContrast', 1.6)
      .f2('RENDERSIZE', sim.gw, sim.gh)
    g.bind(0, src)
    g.bind(1, this.flow!.tex)
    g.draw(this.steer.fbo, sim.gw, sim.gh)

    // 2) the pattern follows the motion, then lives its steps on the rack's clock
    const follow = Math.max(0, Math.min(1, num(inp, 'follow', 0.6)))
    if (!restart && follow > 0) sim.advect(this.steer.tex, follow * 2.5)
    const bias = Math.max(-1, Math.min(1, num(inp, 'bias', 0.6)))
    sim.run(ctx.dt, Math.max(0, num(inp, 'rate', 2)), {
      feed: num(inp, 'feed', 0.0456),
      kill: num(inp, 'kill', 0.0635),
      seed: num(inp, 'seed', 0.15),
      scale
    }, {
      tex: this.steer.tex,
      // at the default push (0.6) the lights grow coral, the darks dividing spots
      biasFeed: bias * 0.0148,
      biasKill: bias * -0.0025,
      plant: Math.max(0, Math.min(1, num(inp, 'plant', 0.5))) * 0.03
    })
    const vis = sim.extract()

    // 3) the look, over the picture
    const look = Math.max(0, Math.min(4, Math.round(num(inp, 'look', 0))))
    const out = ctx.chain.next()
    const [ir, ig, ib] = col(inp, 'ink', [0.12, 0.11, 0.1])
    this.show(look).use()
      .i1('uHost', 0).i1('uV', 1)
      .f2('RENDERSIZE', W, H)
      .f1('uSharp', num(inp, 'sharp', 0.5))
      .f1('uRelief', num(inp, 'relief', 0.5)).f1('uAngle', num(inp, 'lightAngle', 2.36))
      .f1('uReliefE', Math.max(1.5, Math.min(10, H / sim.gh)))
      .f1('uAmount', Math.max(0, Math.min(1, num(inp, 'amount', 0.8))))
      .f1('uMix', Math.max(0, Math.min(1, num(inp, 'mix', 1))))
      .f3('uInk', ir, ig, ib)
    g.bind(0, ctx.host)
    g.bind(1, vis)
    g.draw(out.fbo, W, H)
    g.done(2)
    return out.tex
  }

  dispose(): void {
    if (!this.g) return
    if (this.gen === glGeneration()) {
      this.sim?.dispose()
      this.flow?.dispose()
      this.g.freeTarget(this.steer)
      this.g.dispose()
    }
    this.g = null
    this.sim = null
    this.flow = null
    this.steer = null
  }
}
