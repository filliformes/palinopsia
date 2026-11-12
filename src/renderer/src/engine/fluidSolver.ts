// The stable-fluids solver the Fluid source and the Current effect share (Stam's
// "Stable Fluids", SIGGRAPH 1999, on the GPU after Harris, GPU Gems ch. 38) : a
// velocity grid that advects itself, takes pushes (gaussian splats or any pass a
// user writes into it), keeps its curls with vorticity confinement (Fedkiw, Stam,
// Jensen 2001) and is made divergence-free by a Jacobi pressure solve, plus the
// semi-Lagrangian advection that carries any field (dye, temperature, a picture)
// on a grid of its own size. The grid size is the caller's (both tie it to the
// frame HEIGHT), so the water keeps its size and speed at 1080p, 4K and on the dome.
// Velocity is in cells of the VELOCITY grid per second.
//
// - FluidSource ('gen-fluid') : its own nozzles / vents, buoyancy and display;
// - CurrentNode ('node-fluid') : the picture's motion and light push the water,
//   the picture is the dye.

import { FS_HEAD, type EngineGL, type Prog, type Target } from './organicGL'

/** Gaussian pushes one splat pass takes. */
export const MAX_SPLATS = 6
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
uniform vec4 uP[${MAX_SPLATS}];   // x, y (uv), radius (frame heights), strength
uniform vec4 uV[${MAX_SPLATS}];   // what this source adds (per field)
uniform float uDt;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uDstN;
  vec4 s = texture(uSrc, uv);
  for (int i = 0; i < ${MAX_SPLATS}; i++) {
    if (i >= uCount) break;
    vec2 d = (uv - uP[i].xy) * vec2(uAspect, 1.0);
    float g = exp(-dot(d, d) / max(1e-5, uP[i].z * uP[i].z)) * uP[i].w;
    s += uV[i] * g * uDt;
  }
  o = s;
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

export class FluidSolver {
  private advectP: Prog
  private splatP: Prog
  private curlP: Prog
  private vortP: Prog
  private divP: Prog
  private jacobiP: Prog
  private gradP: Prog
  private stirP: Prog
  private velT: [Target, Target] | null = null
  private curlT: Target | null = null
  private divT: Target | null = null
  private pT: [Target, Target] | null = null
  private vi = 0
  gw = 0
  gh = 0

  constructor(private g: EngineGL) {
    this.advectP = g.prog(ADVECT_FS)
    this.splatP = g.prog(SPLAT_FS)
    this.curlP = g.prog(CURL_FS)
    this.vortP = g.prog(VORT_FS)
    this.divP = g.prog(DIV_FS)
    this.jacobiP = g.prog(JACOBI_FS)
    this.gradP = g.prog(GRAD_FS)
    this.stirP = g.prog(STIR_FS)
  }

  /** The velocity grid at gw × gh. True when it was (re)made. A new size keeps
   *  the water moving : the velocity is resampled onto the new grid (in its cells,
   *  so the same speed), the pressure restarts (the next solve rebuilds it). A
   *  modulated detail would otherwise start still water at every step of it. */
  ensure(gw: number, gh: number): boolean {
    if (this.velT && this.gw === gw && this.gh === gh) return false
    const oldVel = this.velT
    const old = oldVel ? oldVel[this.vi] : null
    const ow = this.gw, oh = this.gh
    this.velT = null
    this.free()
    const half = (w: number, h: number): Target => this.g.target(w, h, { half: 'rgba', linear: true })
    this.velT = [half(gw, gh), half(gw, gh)]
    this.curlT = half(gw, gh)
    this.divT = half(gw, gh)
    this.pT = [half(gw, gh), half(gw, gh)]
    this.gw = gw
    this.gh = gh
    this.vi = 0
    if (old && ow > 0 && oh > 0) {
      // an advection with no time step is a plain bilinear resample; uDiss scales
      // the cells / s to the new grid's cells
      this.advectP.use().i1('uVel', 0).i1('uSrc', 1).f2('uVelN', gw, gh).f2('uDstN', gw, gh).f1('uDt', 0).f4('uDiss', gw / ow, gh / oh, 1, 1)
      this.g.bind(0, old.tex)
      this.g.bind(1, old.tex)
      this.g.draw(this.velT[0].fbo, gw, gh)
    }
    if (oldVel) for (const t of oldVel) this.g.freeTarget(t)
    return true
  }

  /** The velocity now (read it in a pass), its back buffer (write the pass's
   *  result there), then swap() to make it current. */
  get vel(): WebGLTexture {
    return this.velT![this.vi].tex
  }
  get velBack(): Target {
    return this.velT![1 - this.vi]
  }
  swap(): void {
    this.vi = 1 - this.vi
  }

  /** Still water, no pressure. */
  clear(): void {
    const gl = this.g.gl
    if (!this.velT || !this.pT) return
    gl.clearColor(0, 0, 0, 0)
    for (const t of [...this.velT, ...this.pT]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
  }

  /** Carry `src` (any grid, filtered) along the velocity into `dst`, times `diss`
   *  per channel (a per-step fade). */
  advect(src: WebGLTexture, dst: Target, dt: number, diss: [number, number, number, number] = [1, 1, 1, 1]): void {
    const g = this.g
    this.advectP.use().i1('uVel', 0).i1('uSrc', 1).f2('uVelN', this.gw, this.gh).f2('uDstN', dst.w, dst.h).f1('uDt', dt).f4('uDiss', diss[0], diss[1], diss[2], diss[3])
    g.bind(0, this.vel)
    g.bind(1, src)
    g.draw(dst.fbo, dst.w, dst.h)
  }

  /** The velocity carried by itself (the first step of every frame). */
  advectSelf(dt: number): void {
    this.advect(this.vel, this.velBack, dt)
    this.swap()
  }

  /** Gaussian splats (`P` : x, y, radius, strength · `V` : what each adds) of `src`
   *  into `dst` (dst.w × dst.h); `count` of them, at most MAX_SPLATS. */
  splat(src: WebGLTexture, dst: Target, aspect: number, P: Float32Array, V: Float32Array, count: number, dt: number): void {
    const g = this.g
    this.splatP.use().i1('uSrc', 0).f2('uDstN', dst.w, dst.h).f1('uAspect', aspect).i1('uCount', count).f1('uDt', dt)
    g.gl.uniform4fv(this.splatP.u('uP'), P)
    g.gl.uniform4fv(this.splatP.u('uV'), V)
    g.bind(0, src)
    g.draw(dst.fbo, dst.w, dst.h)
  }

  /** Splats into the velocity (V's xy : cells / s gained per second). */
  splatVelocity(aspect: number, P: Float32Array, V: Float32Array, count: number, dt: number): void {
    this.splat(this.vel, this.velBack, aspect, P, V, count, dt)
    this.swap()
  }

  /** Vorticity confinement at strength `eps`. */
  confine(eps: number, dt: number): void {
    const g = this.g
    this.curlP.use().i1('uVel', 0).i2('uN', this.gw, this.gh)
    g.bind(0, this.vel)
    g.draw(this.curlT!.fbo, this.gw, this.gh)
    this.vortP.use().i1('uVel', 0).i1('uCurl', 1).i2('uN', this.gw, this.gh).f1('uEps', eps).f1('uDt', dt)
    g.bind(0, this.vel); g.bind(1, this.curlT!.tex)
    g.draw(this.velBack.fbo, this.gw, this.gh); this.swap()
  }

  /** A large swirl about (cx, cy) (uv), `amt` signed. */
  stir(cx: number, cy: number, aspect: number, amt: number): void {
    const g = this.g
    this.stirP.use().i1('uVel', 0).f2('uN', this.gw, this.gh).f2('uC', cx, cy).f1('uAspect', aspect).f1('uAmt', amt)
    g.bind(0, this.vel)
    g.draw(this.velBack.fbo, this.gw, this.gh); this.swap()
  }

  /** Make the water incompressible (divergence, pressure, subtract the gradient),
   *  with `visc` the per-step drag multiplier. */
  project(visc: number): void {
    const g = this.g
    this.divP.use().i1('uVel', 0).i2('uN', this.gw, this.gh)
    g.bind(0, this.vel)
    g.draw(this.divT!.fbo, this.gw, this.gh)
    let pi = 0
    const p = this.pT!
    this.jacobiP.use().i1('uP', 0).i1('uDiv', 1).i2('uN', this.gw, this.gh)
    g.bind(1, this.divT!.tex)
    for (let k = 0; k < JACOBI; k++) {
      g.bind(0, p[pi].tex)
      g.draw(p[1 - pi].fbo, this.gw, this.gh); pi = 1 - pi
    }
    this.gradP.use().i1('uP', 0).i1('uVel', 1).i2('uN', this.gw, this.gh).f1('uVisc', visc)
    g.bind(0, p[pi].tex); g.bind(1, this.vel)
    g.draw(this.velBack.fbo, this.gw, this.gh); this.swap()
  }

  free(): void {
    const g = this.g
    for (const t of [...(this.velT ?? []), ...(this.pT ?? []), this.curlT, this.divT]) g.freeTarget(t)
    this.velT = null
    this.pT = null
    this.curlT = null
    this.divT = null
  }
}
