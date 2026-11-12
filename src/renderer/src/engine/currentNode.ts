// Current (the native node 'node-fluid') : a real fluid that carries the picture. The
// Fluid source's own stable-fluids solver (fluidSolver.ts) runs on its own fixed grid
// (the frame HEIGHT sets it : 96 to 384 rows, so the water keeps its size and speed at
// 1080p, 4K and on the dome) and the layer's picture is the DYE it carries :
// - where the picture MOVES, the water is dragged along with it (its optical flow on a
//   fixed 256 field : pictureFlow.ts), so a dancer or a pan stirs the water;
// - its LIGHT can rise (warm smoke) or sink (bright parts fall) : buoyancy from luma;
// - the water has a restlessness of its own (CHURN : a few wandering pushes), so a
//   still picture or a generator with no motion still gets curled and smeared;
// - vorticity confinement keeps the eddies the coarse grid would smear out;
// and the carried picture is refreshed by the live one at its own pace (MEMORY : short
// smears or long marbled drifts), with the parts where the water is still left sharp
// (KEEP STILL). A sidechain layer can move the water instead (its motion and its light),
// while this layer is what the water carries. Under the full dome, rising goes to the
// zenith (lib/dome.glsl), and the frame's edges are the walls (the rim).

import type { ConvNode, NodeContext } from './convNodes'
import { EngineGL, FS_HEAD, Edge, num, type Prog, type Target } from './organicGL'
import { FluidSolver, MAX_SPLATS } from './fluidSolver'
import { PictureFlow, PICTURE_FLOW_RES } from './pictureFlow'
import { glGeneration } from './glGeneration'
import { domeFill } from './domeSignal'
import DOME_GLSL from '../shaders/isf/lib/dome.glsl?raw'

// The picture pushes the water : where it moves, the water is pulled toward the
// picture's own velocity (a bounded drag, so steady motion never runs away), and its
// light rises (or sinks) as heat would. `uMotionK` : the share of the gap closed this
// step; `uRise` : cells / s² at full light.
const FORCE_FS = `${FS_HEAD}
${DOME_GLSL}
uniform sampler2D uVel, uFlow, uSrc;
uniform vec2 uN;
uniform float uMotionK, uRise, uDt, uFlowToCells;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uN;
  vec4 v = texture(uVel, uv);
  vec2 f = texture(uFlow, uv).rg;                 // 256-field texels a frame
  vec2 pic = f * uN * uFlowToCells;               // cells / s of this grid
  float m = smoothstep(0.02, 0.25, length(f));    // only where it really moves
  v.xy += (pic - v.xy) * uMotionK * m;
  vec4 c = texture(uSrc, uv);
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114)) * c.a;
  v.xy += domeDir(uv, vec2(0.0, 1.0)) * (l - 0.35) * uRise * uDt;
  o = v;
}`

// The dye : the carried picture (premultiplied), traced back along the water, then
// refreshed by the live picture at the memory's pace. A trace from outside the frame
// (the walls hold the water, but the trace can still step past) reads the live edge
// instead of dragging the border row in.
const DYE_FS = `${FS_HEAD}
uniform sampler2D uVel, uDye, uHost;
uniform vec2 uVelN, uDstN;
uniform float uDt, uRefresh;
out vec4 o;
vec4 pm(vec4 c) { return vec4(c.rgb * c.a, c.a); }
void main() {
  vec2 uv = gl_FragCoord.xy / uDstN;
  vec2 v = texture(uVel, uv).xy;
  vec2 back = uv - v * uDt / uVelN;
  vec4 live = pm(texture(uHost, uv));
  bool inside = back.x >= 0.0 && back.x <= 1.0 && back.y >= 0.0 && back.y <= 1.0;
  vec4 adv = inside ? texture(uDye, back) : live;
  o = mix(adv, live, uRefresh);
}`

// Present : the carried picture over the live one. Where the water is still, KEEP
// lets the sharp live picture through; MIX is the dry / wet. Straight alpha out, and
// the carried picture can spill into transparency.
const SHOW_FS = `${FS_HEAD}
uniform sampler2D uHost, uDye, uVel;
uniform float uMix, uKeep, uStill;
out vec4 fragColor;
vec4 pm(vec4 c) { return vec4(c.rgb * c.a, c.a); }
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  vec4 h = texture(uHost, uv);
  vec4 d = texture(uDye, uv);                     // premultiplied
  float sp = length(texture(uVel, uv).xy);        // cells / s
  float moving = smoothstep(0.0, uStill, sp);
  float w = uMix * mix(1.0, moving, uKeep);
  vec4 c = mix(pm(h), d, w);
  fragColor = vec4(c.a > 1e-5 ? c.rgb / c.a : h.rgb, c.a);
}`

/** Velocity rows for `detail` (the Fluid source's own range). */
const rowsFor = (detail: number): number => Math.round((96 + Math.max(0, Math.min(1, detail)) * 288) / 4) * 4

export class CurrentNode implements ConvNode {
  private gen = glGeneration()
  private g: EngineGL | null = null
  private solver: FluidSolver | null = null
  private flow: PictureFlow | null = null
  private forceP: Prog | null = null
  private dyeP: Prog | null = null
  private showP: Prog | null = null
  private dye: [Target, Target] | null = null
  private di = 0
  private dw = 0
  private dh = 0
  private acc = 0
  private t = Math.random() * 100
  private seed = Math.random() * 100
  private lastFrame = -1
  private pendingStir = false
  private stirE = new Edge()
  private clearE = new Edge()
  private P = new Float32Array(4 * MAX_SPLATS)
  private V = new Float32Array(4 * MAX_SPLATS)

  constructor(private gl: WebGL2RenderingContext) {}

  private build(): EngineGL {
    const g = new EngineGL(this.gl, 'current')
    this.g = g
    this.solver = new FluidSolver(g)
    this.flow = new PictureFlow(g)
    this.forceP = g.prog(FORCE_FS)
    this.dyeP = g.prog(DYE_FS)
    this.showP = g.prog(SHOW_FS)
    this.dye = null
    this.lastFrame = -1
    return g
  }

  /** Copy the live picture into both dye buffers (premultiplied) : a fresh start. */
  private seedDye(host: WebGLTexture): void {
    const g = this.g!
    // a dye pass with refresh 1 is exactly "the live picture, premultiplied"
    this.dyeP!.use().i1('uVel', 0).i1('uDye', 1).i1('uHost', 2)
      .f2('uVelN', this.solver!.gw, this.solver!.gh).f2('uDstN', this.dw, this.dh).f1('uDt', 0).f1('uRefresh', 1)
    g.bind(0, this.solver!.vel); g.bind(1, this.dye![0].tex); g.bind(2, host)
    g.draw(this.dye![1].fbo, this.dw, this.dh)
    g.bind(1, this.dye![1].tex)
    g.draw(this.dye![0].fbo, this.dw, this.dh)
    this.di = 0
  }

  render(ctx: NodeContext): WebGLTexture {
    const gl = this.gl
    if (gl.isContextLost()) return ctx.host
    if (this.gen !== glGeneration()) {
      this.g = null
      this.gen = glGeneration()
    }
    const g = this.g ?? this.build()
    if (!g.ok) return ctx.host
    const sv = this.solver!
    const inp = ctx.inputs
    const W = ctx.chain.w, H = ctx.chain.h
    const aspect = W / H

    // grids : the water by `detail`, the dye at the picture's size up to 1080 rows
    const gh = rowsFor(num(inp, 'detail', 0.5))
    const gw = Math.max(8, Math.round((gh * W) / H))
    // a new water grid keeps the water moving (resampled : FluidSolver.ensure); the dye carries on
    sv.ensure(gw, gh)
    let fresh = false
    const dh = Math.max(4, Math.min(1080, H))
    const dw = Math.max(4, Math.round((dh * W) / H))
    if (!this.dye || dw !== this.dw || dh !== this.dh) {
      if (this.dye) for (const t of this.dye) g.freeTarget(t)
      this.dye = [g.target(dw, dh, { half: 'rgba', linear: true }), g.target(dw, dh, { half: 'rgba', linear: true })]
      this.dw = dw
      this.dh = dh
      fresh = true
    }
    const restart = fresh || this.lastFrame < 0 || (ctx.frame !== undefined && ctx.frame !== this.lastFrame + 1)
    this.lastFrame = ctx.frame ?? 0
    const cleared = this.clearE.fired(num(inp, 'clear', 0))
    if (cleared || restart) {
      sv.clear()
      this.seedDye(ctx.host)
      this.acc = 0
    }
    if (this.stirE.fired(num(inp, 'stir', 0))) this.pendingStir = true

    // the picture that moves the water : a sidechain, or this layer
    const src = ctx.sidechain ?? ctx.host
    this.flow!.update(src, restart)

    const rate = Math.max(0, num(inp, 'rate', 1))
    const STEP = 1 / 60
    this.acc = Math.min(this.acc + Math.max(0, ctx.dt) * rate, STEP * 3)
    const motion = Math.max(0, Math.min(1, num(inp, 'motion', 0.6)))
    const rise = Math.max(-1, Math.min(1, num(inp, 'rise', 0)))
    const churn = Math.max(0, Math.min(1, num(inp, 'churn', 0.35)))
    const swirl = Math.max(0, Math.min(1, num(inp, 'swirl', 0.5)))
    const visc = Math.max(0, Math.min(1, num(inp, 'viscosity', 0.2)))
    const memory = Math.max(0, Math.min(1, num(inp, 'memory', 0.6)))
    // the live picture's share each 60 Hz step : a quarter at memory 0, 1/500 at 1
    const refresh = 0.25 * Math.pow(0.008, memory)
    // the flow is measured once a frame (256-field texels in this frame's dt); the
    // steps share it, in the water's own time (rate)
    const flowToCells = 1 / Math.max(ctx.dt, 1 / 240) / PICTURE_FLOW_RES
    while (this.acc >= STEP) {
      this.acc -= STEP
      this.t += STEP
      // 1) the water carries itself
      sv.advectSelf(STEP)
      // 2) the picture's motion and light
      this.forceP!.use()
        .i1('uVel', 0).i1('uFlow', 1).i1('uSrc', 2)
        .f2('uN', gw, gh).f1('uDt', STEP).f1('uFlowToCells', flowToCells / Math.max(1, rate))
        .f1('uMotionK', motion * 0.5).f1('uRise', rise * gh * 1.2)
        .f1('DOME_FILL', domeFill())
        .f2('RENDERSIZE', gw, gh)
      g.bind(0, sv.vel); g.bind(1, this.flow!.tex); g.bind(2, src)
      g.draw(sv.velBack.fbo, gw, gh); sv.swap()
      // 3) its own restlessness : wandering pushes, kept clear of the rim
      if (churn > 0) {
        const n = 4
        const t = this.t
        const nz = (i: number, k: number): number =>
          Math.sin(t * (0.11 + 0.05 * i) + this.seed + i * 1.7 + k) * 0.6 + Math.sin(t * (0.27 + 0.04 * i) + i * 2.3 + k * 1.3) * 0.4
        const push = churn * gh * 5
        for (let i = 0; i < n; i++) {
          const a = t * (0.17 + 0.05 * i) + i * 1.9 + 2 * nz(i, 9)
          this.P[i * 4] = 0.5 + 0.32 * nz(i, 0)
          this.P[i * 4 + 1] = 0.5 + 0.3 * nz(i, 5)
          this.P[i * 4 + 2] = 0.09
          this.P[i * 4 + 3] = 0.6 + 0.4 * nz(i, 11)
          this.V[i * 4] = Math.cos(a) * push
          this.V[i * 4 + 1] = Math.sin(a) * push
          this.V[i * 4 + 2] = 0
          this.V[i * 4 + 3] = 0
        }
        sv.splatVelocity(aspect, this.P, this.V, n, STEP)
      }
      // 4) keep the curls, 5) a stir, 6) incompressible
      sv.confine(swirl * 32, STEP)
      if (this.pendingStir) {
        this.pendingStir = false
        sv.stir(0.3 + 0.4 * Math.random(), 0.3 + 0.4 * Math.random(), aspect, (Math.random() < 0.5 ? -1 : 1) * 2.2)
      }
      sv.project(Math.pow(1 - visc * 0.012, 1))
      // 7) the picture rides the water, refreshed by the live one
      const d = this.dye!
      this.dyeP!.use().i1('uVel', 0).i1('uDye', 1).i1('uHost', 2)
        .f2('uVelN', gw, gh).f2('uDstN', dw, dh).f1('uDt', STEP).f1('uRefresh', refresh)
        .f2('RENDERSIZE', dw, dh)
      g.bind(0, sv.vel); g.bind(1, d[this.di].tex); g.bind(2, ctx.host)
      g.draw(d[1 - this.di].fbo, dw, dh)
      this.di = 1 - this.di
    }

    // present
    const out = ctx.chain.next()
    this.showP!.use()
      .i1('uHost', 0).i1('uDye', 1).i1('uVel', 2)
      .f2('RENDERSIZE', W, H)
      .f1('uMix', Math.max(0, Math.min(1, num(inp, 'mix', 1))))
      .f1('uKeep', Math.max(0, Math.min(1, num(inp, 'keep', 0.4))))
      .f1('uStill', gh * 0.04)
    g.bind(0, ctx.host); g.bind(1, this.dye![this.di].tex); g.bind(2, sv.vel)
    g.draw(out.fbo, W, H)
    g.done(3)
    return out.tex
  }

  dispose(): void {
    if (!this.g) return
    if (this.gen === glGeneration()) {
      this.solver?.free()
      this.flow?.dispose()
      if (this.dye) for (const t of this.dye) this.g.freeTarget(t)
      this.g.dispose()
    }
    this.g = null
    this.solver = null
    this.flow = null
    this.dye = null
  }
}
