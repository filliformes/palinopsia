// VeinsSource : the native Veins generator (id 'gen-veins'). Leaf venation and
// roots from the space-colonization model of Runions et al. ("Modeling and
// visualization of leaf venation patterns", SIGGRAPH 2005; "Modeling trees with
// a space colonization algorithm", 2007) :
// - a LEAF blade grows from its margin; as it grows, auxin sources appear in the
//   fresh tissue, far enough from each other and from existing veins;
// - every source pulls its nearest vein node (OPEN venation : each source has one
//   node, the tree only branches) or every node in its neighborhood (CLOSED : the
//   veins reconnect into loops, as in most real leaves);
// - a node pulled by sources grows one step toward their mean direction; a source
//   is removed when a vein reaches it;
// - vein width follows the pipe model : a vein carries all the veins it feeds
//   (w ~ n^(1/3)), so the midrib is thick and the finest veinlets hair-thin;
// - ROOTS : the same rule in soil, from a root collar at the top, pulled down by
//   gravity, the sources scattered through the ground.
// The tree lives on the CPU (a few thousand to ~20k nodes, grid-hashed); the
// veins are drawn each frame as instanced capsules into a half-float map, then
// lit by the organic relief light. `rate` paces growth; when the leaf is done it
// holds, fades and a new one grows (`cycle`), or `regrow ▸`.

import { EngineGL, FS_HEAD, RELIEF, SlotClock, Edge, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'

const MAX_NODES = 24000

const SEG_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 corner;      // (0..1 along, -1..1 across)
layout(location = 1) in vec4 seg;         // x0, y0, x1, y1 (frame-height units)
layout(location = 2) in vec2 wid;         // half width at 0 / at 1
uniform vec2 uWorld;                      // world size (aspect, 1)
out vec2 vP;
out vec4 vSeg;
out vec2 vWid;
void main() {
  vec2 a = seg.xy, b = seg.zw;
  vec2 d = b - a;
  float L = max(length(d), 1e-5);
  vec2 t = d / L, n = vec2(-t.y, t.x);
  float r = max(wid.x, wid.y) + 0.002;
  vec2 p = mix(a - t * r, b + t * r, corner.x) + n * corner.y * r;
  vP = p; vSeg = seg; vWid = wid;
  gl_Position = vec4(p / uWorld * 2.0 - 1.0, 0.0, 1.0);
}`
// Capsule coverage (tapered), soft edge one pixel wide; MAX-blended so crossings
// don't double up.
const SEG_FS = `#version 300 es
precision highp float;
in vec2 vP;
in vec4 vSeg;
in vec2 vWid;
uniform float uPx;                        // one output pixel in frame-height units
out vec4 o;
void main() {
  vec2 a = vSeg.xy, b = vSeg.zw;
  vec2 ba = b - a;
  float h = clamp(dot(vP - a, ba) / max(dot(ba, ba), 1e-10), 0.0, 1.0);
  float w = mix(vWid.x, vWid.y, h);
  float d = length(vP - a - ba * h) - w;
  float cov = 1.0 - smoothstep(-uPx, uPx, d);
  // r : coverage · g : a rounded height (veins stand up most at their axis)
  float ht = cov * sqrt(max(0.0, 1.0 - pow(clamp(length(vP - a - ba * h) / max(w, uPx), 0.0, 1.0), 2.0)));
  o = vec4(cov, ht, 0.0, 1.0);
}`

const SHOW_FS = `${FS_HEAD}
uniform sampler2D uVeins;
uniform vec3 uVein, uBlade, uGround;
uniform float uBladeAmt, uRelief, uAngle, uFade, uKind, uGrow;
uniform vec2 uWorld;
out vec4 fragColor;
// The leaf outline (same function as the CPU side) : base at the bottom middle.
float leafW(float s) { return 0.42 * pow(sin(3.14159 * pow(clamp(s, 0.0, 1.0), 0.85)), 0.9) * (1.0 - 0.18 * s); }
float inLeaf(vec2 w) {
  float L = 0.86 * uGrow;
  float s = (w.y - 0.07) / max(L, 1e-4);
  if (s < 0.0 || s > 1.0) return 0.0;
  float hw = leafW(s) * L * 1.1;
  return 1.0 - smoothstep(hw - 0.004, hw + 0.004, abs(w.x - uWorld.x * 0.5));
}
float og_height(vec2 uv) { return texture(uVeins, uv).g; }
#define OG_RELIEF_E 1.4
#define OG_SHADOW_STEPS 3
${RELIEF}
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  vec2 w = uv * uWorld;
  vec4 v = texture(uVeins, uv);
  float blade = uKind < 1.5 ? inLeaf(w) * uBladeAmt : 0.0;
  // Translucent blade : a touch darker beside the veins (the vein shadows).
  vec3 base = mix(uGround, uBlade, blade);
  vec3 alb = mix(base, uVein, v.r);
  vec3 c = mix(alb, og_relief(uv, alb, v.g, uAngle, uRelief), smoothstep(0.0, 0.25, uRelief));
  fragColor = vec4(mix(uGround, c, uFade), 1.0);
}`

interface Grid {
  cell: number
  map: Map<number, number[]>
}

export class VeinsSource implements NativeGenerator {
  private g: EngineGL
  private seg: Prog
  private show: Prog
  private vao: WebGLVertexArrayObject
  private quadBuf: WebGLBuffer
  private instBuf: WebGLBuffer
  private map: Target | null = null
  private clock = new SlotClock()
  private inputs: Record<string, number | number[]> = {}
  private regrowE = new Edge()
  private pendingRegrow = true
  private rnd = Math.random
  // the tree
  private nx = new Float32Array(MAX_NODES)
  private ny = new Float32Array(MAX_NODES)
  private par = new Int32Array(MAX_NODES)
  private cnt = new Float32Array(MAX_NODES) // pipe model : veins fed through this node
  private n = 0
  // Anastomoses (closed venation) : extra vein segments joining two nodes.
  private links: number[] = []
  private idle = 0 // iterations in a row with no growth
  private ax: number[] = []
  private ay: number[] = []
  private grid: Grid = { cell: 0.05, map: new Map() }
  private grow = 0.08 // leaf size 0..1
  private t = 0
  private doneFor = 0
  private fade = 1
  private acc = 0
  private kind = 0
  private inst = new Float32Array(MAX_NODES * 6)

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    const g = (this.g = new EngineGL(gl, 'veins'))
    this.seg = g.prog(SEG_FS, SEG_VS)
    this.show = g.prog(SHOW_FS)
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.quadBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.instBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf)
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0)
    gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16)
    gl.vertexAttribDivisor(2, 1)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
    if (this.regrowE.fired(num(inputs, 'reseed', 0))) this.pendingRegrow = true
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
    if (name === 'reseed' && typeof value === 'number' && this.regrowE.fired(value)) this.pendingRegrow = true
  }

  private get aspect(): number {
    return this.w / this.h
  }

  // ── geometry ──
  private leafW(s: number): number {
    const c = Math.min(1, Math.max(0, s))
    return 0.42 * Math.pow(Math.sin(Math.PI * Math.pow(c, 0.85)), 0.9) * (1 - 0.18 * c)
  }
  private inside(x: number, y: number): boolean {
    if (this.kind === 2) return y > 0.03 && y < 0.9 && x > 0.04 && x < this.aspect - 0.04
    const L = 0.86 * this.grow
    const s = (y - 0.07) / L
    if (s < 0 || s > 1) return false
    return Math.abs(x - this.aspect * 0.5) < this.leafW(s) * L
  }

  private key(cx: number, cy: number): number {
    return cx * 73856093 + cy * 19349663
  }
  private gridAdd(i: number): void {
    const c = this.grid.cell
    const k = this.key(Math.floor(this.nx[i] / c), Math.floor(this.ny[i] / c))
    const a = this.grid.map.get(k)
    if (a) a.push(i)
    else this.grid.map.set(k, [i])
  }
  /** Nodes within `r` of (x, y). */
  private near(x: number, y: number, r: number, out: number[]): void {
    out.length = 0
    const c = this.grid.cell
    const cx = Math.floor(x / c), cy = Math.floor(y / c)
    const span = Math.ceil(r / c)
    const r2 = r * r
    for (let j = -span; j <= span; j++) for (let i = -span; i <= span; i++) {
      const a = this.grid.map.get(this.key(cx + i, cy + j))
      if (!a) continue
      for (const k of a) {
        const dx = this.nx[k] - x, dy = this.ny[k] - y
        if (dx * dx + dy * dy <= r2) out.push(k)
      }
    }
  }
  private nearest(x: number, y: number, r: number, tmp: number[]): number {
    this.near(x, y, r, tmp)
    let best = -1, bd = Infinity
    for (const k of tmp) {
      const d = (this.nx[k] - x) ** 2 + (this.ny[k] - y) ** 2
      if (d < bd) { bd = d; best = k }
    }
    return best
  }

  private addNode(x: number, y: number, p: number): number {
    if (this.n >= MAX_NODES) return -1
    const i = this.n++
    this.nx[i] = x
    this.ny[i] = y
    this.par[i] = p
    this.gridAdd(i)
    return i
  }

  private restart(): void {
    this.kind = Math.max(0, Math.min(2, Math.round(num(this.inputs, 'kind', 0))))
    const spacing = this.spacing()
    this.grid = { cell: spacing * 3, map: new Map() }
    this.n = 0
    this.links = []
    this.idle = 0
    this.ax = []
    this.ay = []
    this.t = 0
    this.doneFor = 0
    this.fade = 1
    if (this.kind === 2) {
      this.grow = 1
      const collars = 1 + Math.round(Math.max(0, Math.min(1, num(this.inputs, 'density', 0.5))) * 2)
      for (let i = 0; i < collars; i++) {
        const x = this.aspect * (0.5 + (i - (collars - 1) / 2) * 0.28)
        const a = this.addNode(x, 0.97, -1)
        this.addNode(x, 0.97 - spacing, a)
      }
    } else {
      this.grow = 0.08
      // the petiole : the base of the midrib
      const a = this.addNode(this.aspect * 0.5, 0.0, -1)
      const b = this.addNode(this.aspect * 0.5, 0.035, a)
      this.addNode(this.aspect * 0.5, 0.07, b)
    }
  }

  /** Vein spacing (the auxin birth / kill distance), frame-height units. */
  private spacing(): number {
    const d = Math.max(0, Math.min(1, num(this.inputs, 'density', 0.5)))
    return 0.034 - d * 0.022
  }

  /** One growth iteration : sprinkle sources in the fresh tissue, grow veins
   *  toward them, remove the sources the veins reached. */
  private iterate(): boolean {
    const sp = this.spacing()
    const kill = sp * 0.75
    const infl = sp * (this.kind === 2 ? 7 : 5)
    const step = sp * 0.42
    const closed = this.kind === 1
    const tmp: number[] = []
    // new sources (Poisson-ish : dart throwing)
    const tries = this.kind === 2 ? 30 : 60
    for (let t = 0; t < tries; t++) {
      let x: number, y: number
      if (this.kind === 2) {
        x = 0.04 + this.rnd() * (this.aspect - 0.08)
        y = 0.04 + Math.pow(this.rnd(), 0.7) * 0.86
      } else {
        const L = 0.86 * this.grow
        y = 0.07 + this.rnd() * L
        const s = (y - 0.07) / L
        x = this.aspect * 0.5 + (this.rnd() * 2 - 1) * this.leafW(s) * L
      }
      if (!this.inside(x, y)) continue
      if (this.nearest(x, y, sp, tmp) >= 0) continue
      let ok = true
      for (let k = Math.max(0, this.ax.length - 400); k < this.ax.length; k++) {
        if ((this.ax[k] - x) ** 2 + (this.ay[k] - y) ** 2 < sp * sp) { ok = false; break }
      }
      if (ok) { this.ax.push(x); this.ay.push(y) }
    }
    // attraction : each source pulls its nearest node (open), or every node in its
    // relative neighbourhood (closed : loops)
    const pull = new Map<number, [number, number, number]>()
    const add = (k: number, x: number, y: number): void => {
      const dx = x - this.nx[k], dy = y - this.ny[k]
      const L = Math.hypot(dx, dy) || 1
      const p = pull.get(k)
      if (p) { p[0] += dx / L; p[1] += dy / L; p[2]++ } else pull.set(k, [dx / L, dy / L, 1])
    }
    for (let i = 0; i < this.ax.length; i++) {
      const x = this.ax[i], y = this.ay[i]
      if (closed) {
        this.near(x, y, infl, tmp)
        if (!tmp.length) continue
        // relative neighbourhood : keep nodes no other node is closer to both
        let best = -1, bd = Infinity
        for (const k of tmp) { const d = (this.nx[k] - x) ** 2 + (this.ny[k] - y) ** 2; if (d < bd) { bd = d; best = k } }
        for (const k of tmp) {
          const dk = (this.nx[k] - x) ** 2 + (this.ny[k] - y) ** 2
          if (k === best || dk < bd * 1.25) add(k, x, y)
        }
      } else {
        const k = this.nearest(x, y, infl, tmp)
        if (k >= 0) add(k, x, y)
      }
    }
    let grew = 0
    const grav = this.kind === 2 ? 0.55 : 0
    for (const [k, p] of pull) {
      let dx = p[0] / p[2], dy = p[1] / p[2] - grav
      const L = Math.hypot(dx, dy)
      if (L < 1e-4) continue
      dx /= L; dy /= L
      const x = this.nx[k] + dx * step, y = this.ny[k] + dy * step
      // Running into another vein : in a CLOSED leaf the two join (a loop, the
      // areole of a real leaf); in an open leaf or a root it just stops there.
      const c = this.nearest(x, y, step * 0.6, tmp)
      if (c >= 0) {
        if (closed && c !== k && this.par[c] !== k && this.par[k] !== c && this.links.length < 6000) {
          this.links.push(k, c)
          grew++
        }
        continue
      }
      if (this.addNode(x, y, k) >= 0) grew++
    }
    // sources reached
    if (this.ax.length) {
      const nx: number[] = [], ny: number[] = []
      for (let i = 0; i < this.ax.length; i++) {
        if (this.nearest(this.ax[i], this.ay[i], kill, tmp) < 0) { nx.push(this.ax[i]); ny.push(this.ay[i]) }
      }
      this.ax = nx
      this.ay = ny
    }
    // Done when nothing grew for a while (sources out of every vein's reach can
    // linger forever; they must not keep the cycle from turning).
    this.idle = grew > 0 ? 0 : this.idle + 1
    return this.idle < 40
  }

  /** Pipe model : how many vein tips each node feeds (children follow parents). */
  private pipes(): void {
    this.cnt.fill(1, 0, this.n)
    for (let i = this.n - 1; i > 0; i--) {
      const p = this.par[i]
      if (p >= 0) this.cnt[p] += this.cnt[i]
    }
  }

  private ensureMap(): Target {
    if (!this.map) this.map = this.g.target(this.w, this.h, { half: 'rgba', linear: true })
    return this.map
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
    const kindNow = Math.max(0, Math.min(2, Math.round(num(this.inputs, 'kind', 0))))
    if (kindNow !== this.kind) this.pendingRegrow = true
    if (this.pendingRegrow) { this.pendingRegrow = false; this.restart() }
    const dt = this.clock.tick(clockSec)
    const rate = Math.max(0, num(this.inputs, 'rate', 1))
    this.t += dt * rate
    // the blade grows from its margin over ~25 s at rate 1
    if (this.kind !== 2) this.grow = Math.min(1, 0.08 + this.t / 25)
    // Roots fill the soil at once (no blade to grow into) : slower steps, so the
    // system is seen reaching down rather than appearing.
    this.acc += dt * rate * (this.kind === 2 ? 5 : 20)
    let iters = 0
    let alive = true
    while (this.acc >= 1 && iters < 4) {
      this.acc -= 1
      iters++
      alive = this.iterate() || this.grow < 1
    }
    if (this.acc > 4) this.acc = 0
    // life cycle : done → hold → fade → regrow
    const cycle = num(this.inputs, 'cycle', 1) > 0.5
    if (!alive || this.n >= MAX_NODES - 10) this.doneFor += dt
    else this.doneFor = 0
    if (cycle && this.doneFor > 6) {
      this.fade = Math.max(0, this.fade - dt / 3)
      if (this.fade <= 0) this.pendingRegrow = true
    }
    // draw the veins (pipe model widths)
    this.pipes()
    const thick = Math.max(0.1, num(this.inputs, 'thickness', 1))
    const w0 = 0.0011 * thick
    let m = 0
    for (let i = 0; i < this.n; i++) {
      const p = this.par[i]
      if (p < 0) continue
      const o = m * 6
      this.inst[o] = this.nx[p]; this.inst[o + 1] = this.ny[p]
      this.inst[o + 2] = this.nx[i]; this.inst[o + 3] = this.ny[i]
      this.inst[o + 4] = w0 * Math.cbrt(this.cnt[p])
      this.inst[o + 5] = w0 * Math.cbrt(this.cnt[i])
      m++
    }
    for (let j = 0; j + 1 < this.links.length && m < MAX_NODES; j += 2) {
      const a = this.links[j], b = this.links[j + 1]
      const o = m * 6
      this.inst[o] = this.nx[a]; this.inst[o + 1] = this.ny[a]
      this.inst[o + 2] = this.nx[b]; this.inst[o + 3] = this.ny[b]
      this.inst[o + 4] = w0 * Math.cbrt(this.cnt[a])
      this.inst[o + 5] = w0 * Math.cbrt(this.cnt[b])
      m++
    }
    const T = this.ensureMap()
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (m > 0) {
      this.seg.use().f2('uWorld', this.aspect, 1).f1('uPx', 1 / this.h)
      gl.bindVertexArray(this.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst, 0, m * 6)
      gl.bindBuffer(gl.ARRAY_BUFFER, null)
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.MAX)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, m)
      gl.blendEquation(gl.FUNC_ADD)
      gl.disable(gl.BLEND)
      gl.bindVertexArray(null)
    }
    const [vr, vg, vb] = col(this.inputs, 'veinColor', this.kind === 2 ? [0.82, 0.74, 0.6] : [0.86, 0.9, 0.62])
    const [br, bgc, bb] = col(this.inputs, 'blade', [0.12, 0.26, 0.1])
    const [gr, gg, gb] = col(this.inputs, 'ground', this.kind === 2 ? [0.045, 0.03, 0.022] : [0.012, 0.014, 0.012])
    this.show.use().i1('uVeins', 0).f2('RENDERSIZE', this.w, this.h).f2('uWorld', this.aspect, 1)
      .f3('uVein', vr, vg, vb).f3('uBlade', br, bgc, bb).f3('uGround', gr, gg, gb)
      .f1('uBladeAmt', Math.max(0, Math.min(1, num(this.inputs, 'bladeAmt', 0.7))))
      .f1('uRelief', num(this.inputs, 'relief', 0.5)).f1('uAngle', num(this.inputs, 'lightAngle', 2.36))
      .f1('uFade', this.fade).f1('uKind', this.kind).f1('uGrow', this.grow)
    g.bind(0, T.tex)
    g.draw(targetFbo, this.w, this.h)
    g.done(1)
  }

  dispose(): void {
    const gl = this.g.gl
    this.g.freeTarget(this.map)
    this.map = null
    gl.bindVertexArray(this.vao)
    gl.deleteBuffer(this.quadBuf)
    gl.deleteBuffer(this.instBuf)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(this.vao)
    this.g.dispose()
  }
}
