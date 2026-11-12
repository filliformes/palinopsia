// The Gray-Scott simulation the Reaction source and the Morphogen effect share :
// two virtual chemicals (U, V) react and diffuse on a full-precision torus grid
// whose size follows the frame HEIGHT (`scale` 0 = 1080 rows, 1 = 216), stepped in
// fixed sub-steps on the slot's clock. One code path, two users :
// - ReactionSource (the 'reaction' generator) runs it as it always has;
// - MorphogenNode (the 'node-reaction' effect) runs the same step compiled with
//   RD_STEER : a steer texture at grid size biases feed / kill per cell (the
//   picture's darks and lights grow different species) and plants V where the
//   picture asks (its edges, its motion, its lights), and an advection pass carries
//   the living pattern along the picture's own motion before it steps.
// Without RD_STEER the step is the Reaction source's own arithmetic, unchanged.

import { EngineGL, FS_HEAD, type Prog, type Target } from './organicGL'

const stepFs = (steer: boolean): string => `${FS_HEAD}${steer ? '#define RD_STEER 1\n' : ''}
uniform sampler2D uS;
uniform ivec2 uN;
uniform float uFeed, uKill, uDt, uSeed, uBlock, uClear;
uniform vec2 uSalt;
#ifdef RD_STEER
uniform sampler2D uSteer; // r : feed / kill push (-1..1) · g : planting (0..1)
uniform vec2 uBiasFK;     // feed, kill offsets at a full push
uniform float uPlant;
#endif
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
  float F = uFeed, K = uKill;
#ifdef RD_STEER
  vec4 sv = texelFetch(uSteer, c, 0);
  F = clamp(F + sv.r * uBiasFK.x, 0.002, 0.12);
  K = clamp(K + sv.r * uBiasFK.y, 0.02, 0.08);
#endif
  if (uClear > 0.5) {
    // The empty ground (U = 1) with a fresh scatter of sparks.
    U = 1.0;
    V = step(0.985, og_hash(blk * 1.37 + uSalt * 3.1)) * 0.9;
#ifdef RD_STEER
    // an effect starts with more sparks (one block in 14) : the pattern is there in a
    // few seconds instead of creeping out of a handful over a picture. Denser
    // starts eat up U everywhere at once and the whole field dies.
    V = max(V, step(0.93, og_hash(blk * 2.11 + uSalt * 1.7)) * 0.6);
#endif
  } else {
    float uvv = U * V * V;
    U += (lap.x - uvv + F * (1.0 - U)) * uDt;
    V += (0.5 * lap.y + uvv - (F + K) * V) * uDt;
    // Sparse seeding : a block of V that nucleates a critter. The scatter is
    // redrawn every 2/3 s of the slot's clock (uSalt), like the ISF version.
    V += step(1.0 - uSeed, og_hash(blk + uSalt)) * 0.5 * min(uDt, 1.0);
#ifdef RD_STEER
    // The picture plants : sparks like the seeding's, but only where it asks (the
    // more it asks, the likelier a block). Sparse on purpose : V poured over whole
    // regions starves them of U and they die back to nothing.
    V += step(1.0 - uPlant * sv.g, og_hash(blk * 0.91 + uSalt * 2.3)) * 0.5 * min(uDt, 1.0);
#endif
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

// The living pattern carried along a motion field (the steer texture's ba, in grid
// cells this frame) : a semi-Lagrangian trace back, bilinear on the 32-bit state,
// wrapped like the torus. Where nothing moves, the cell reads itself exactly.
const ADVECT_FS = `${FS_HEAD}
uniform sampler2D uS, uSteer;
uniform ivec2 uN;
uniform float uGain;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 d = texelFetch(uSteer, c, 0).ba * uGain;
  if (dot(d, d) < 1e-8) { o = texelFetch(uS, c, 0); return; }
  vec2 p = vec2(c) - d;
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  #define W(dx, dy) texelFetch(uS, ivec2(((i.x + dx) % uN.x + uN.x) % uN.x, ((i.y + dy) % uN.y + uN.y) % uN.y), 0)
  o = mix(mix(W(0, 0), W(1, 0), f.x), mix(W(0, 1), W(1, 1), f.x), f.y);
}`

// V into a half-float copy the GPU filters and wraps itself : the display then
// costs one fetch per sample instead of four (the relief samples V 8 times).
const EXTRACT_FS = `${FS_HEAD}
uniform sampler2D uS;
out vec4 o;
void main() { o = vec4(texelFetch(uS, ivec2(gl_FragCoord.xy), 0).g, 0.0, 0.0, 1.0); }`

/** The knobs one run of steps reads. `seed` : the seeding knob, 0..1. `scale` :
 *  the pattern size knob, 0..1 (it also sets the seeding blocks' size). */
export interface ReactionParams {
  feed: number
  kill: number
  seed: number
  scale: number
}

/** A steered run (RD_STEER builds only). */
export interface ReactionSteer {
  tex: WebGLTexture // grid-size RGBA16F : r push, g planting, ba motion in cells
  biasFeed: number
  biasKill: number
  plant: number
}

/** Grid rows for `scale` : 1080 at 0, 216 at 1 (the ISF version's sampling
 *  stride 1 + 4·scale, now a real grid). */
export function reactionRows(scale: number): number {
  const s = Math.max(0, Math.min(1, scale))
  return Math.max(120, Math.round(1080 / (1 + 4 * s) / 4) * 4)
}

export class ReactionSim {
  private step: Prog
  private resample: Prog
  private extractP: Prog
  private advectP: Prog | null
  private st: [Target, Target] | null = null
  private vis: Target | null = null
  private cur = 0
  gw = 0
  gh = 0
  private simT = 0 // simulated time (grid units), drives the seeding scatter
  private pendingClear = true

  constructor(private g: EngineGL, readonly steered = false) {
    this.step = g.prog(stepFs(steered))
    this.resample = g.prog(RESAMPLE_FS)
    this.extractP = g.prog(EXTRACT_FS)
    this.advectP = steered ? g.prog(ADVECT_FS) : null
  }

  /** Start over : the empty ground and a fresh scatter, on the next run. */
  regrow(): void {
    this.pendingClear = true
  }

  /** The grid for a w × h frame at `scale`; a change resamples the living
   *  pattern onto the new grid instead of restarting it. True when it changed. */
  ensureGrid(w: number, h: number, scale: number): boolean {
    const rows = reactionRows(scale)
    const cols = Math.max(4, Math.round((rows * w) / Math.max(1, h)))
    if (cols === this.gw && rows === this.gh && this.st) return false
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
    return true
  }

  /** Step `dt` seconds of the slot's clock at `rate` : the ISF version's one step
   *  per frame at 60 fps (dt = rate), in sub-steps no larger than the stable 1.0. */
  run(dt: number, rate: number, p: ReactionParams, steer?: ReactionSteer): void {
    const g = this.g
    const st = this.st
    if (!st) return
    const sim = dt * 60 * Math.max(0, rate)
    let n = Math.min(12, Math.ceil(sim - 1e-6))
    if (this.pendingClear) n = Math.max(n, 1)
    const sdt = n > 0 ? Math.min(1, sim / n) : 0
    const scale = Math.max(0, Math.min(1, p.scale))
    this.step.use()
      .i1('uS', 0).i2('uN', this.gw, this.gh)
      .f1('uFeed', p.feed).f1('uKill', p.kill)
      .f1('uSeed', Math.max(0, Math.min(1, p.seed)) * 0.006)
      .f1('uBlock', Math.max(1, 6 / (1 + 4 * scale)))
      .f2('RENDERSIZE', this.gw, this.gh)
    if (this.steered) {
      this.step.i1('uSteer', 1)
        .f2('uBiasFK', steer ? steer.biasFeed : 0, steer ? steer.biasKill : 0)
        .f1('uPlant', steer ? steer.plant : 0)
      if (steer) g.bind(1, steer.tex)
    }
    for (let i = 0; i < n; i++) {
      this.simT += sdt
      const salt = Math.floor(this.simT / 40) % 997 // a new scatter every ~2/3 s at rate 1
      this.step.f1('uDt', this.pendingClear ? 0 : sdt).f1('uClear', this.pendingClear ? 1 : 0).f2('uSalt', salt * 17.13, salt * 3.71)
      this.pendingClear = false
      g.bind(0, st[this.cur].tex)
      g.draw(st[1 - this.cur].fbo, this.gw, this.gh)
      this.cur = 1 - this.cur
    }
  }

  /** Carry the pattern along the steer texture's motion (ba, grid cells), scaled
   *  by `gain`. Steered builds only. */
  advect(steerTex: WebGLTexture, gain: number): void {
    const st = this.st
    if (!st || !this.advectP || gain <= 0) return
    const g = this.g
    this.advectP.use().i1('uS', 0).i1('uSteer', 1).i2('uN', this.gw, this.gh).f1('uGain', gain).f2('RENDERSIZE', this.gw, this.gh)
    g.bind(0, st[this.cur].tex)
    g.bind(1, steerTex)
    g.draw(st[1 - this.cur].fbo, this.gw, this.gh)
    this.cur = 1 - this.cur
  }

  /** Copy V into the filtered half-float display texture; returns it. */
  extract(): WebGLTexture | null {
    const st = this.st
    if (!st || !this.vis) return null
    this.extractP.use().i1('uS', 0)
    this.g.bind(0, st[this.cur].tex)
    this.g.draw(this.vis.fbo, this.gw, this.gh)
    return this.vis.tex
  }

  get visTex(): WebGLTexture | null {
    return this.vis?.tex ?? null
  }

  dispose(): void {
    if (this.st) {
      this.g.freeTarget(this.st[0])
      this.g.freeTarget(this.st[1])
      this.st = null
    }
    this.g.freeTarget(this.vis)
    this.vis = null
  }
}
