// The Marbling model : paint floating on water, as polygons (engine/MarbleSource.ts
// draws them). Pure : no GL, no app imports, so the math is tested headless.
//
// The mathematics is the closed-form marbling of the published work on
// mathematical marbling (IEEE CG&A, 2012) : every operation is a map of
// the WHOLE plane, applied to every point of every drop, so a drop's shape only
// ever depends on its own circle and the maps applied after it landed.
// - A DROP of radius r at c moves every point p to c + (p - c)·sqrt(1 + r²/|p - c|²) :
//   the paint already there is pushed out of the new circle and keeps its area.
//   Two drops of Δ1 and Δ2 at the same c are one of sqrt(Δ1² + Δ2²), exactly, so a
//   drop spreads in small steps that add up to the one-shot drop.
// - A TINE LINE (a stylus or a comb dragged through the paint) shears the paint
//   along the stroke : p += z·f(d)·m, d the distance to the tine (the papers'
//   exp(-d/λ), here sech(d/λ) : the same reach without a cusp on the tine).
// - A VORTEX turns the paint round c by an angle that falls off with distance.
// - The automatic CURRENTS are plane-wave shears applied one after the other (a
//   shear along m whose amount depends only on the coordinate across m keeps
//   every area exactly), slowly turning and drifting, so their sum is a smooth,
//   slowly changing flow that never piles the paint up or thins it out.
//
// Space : the frame's centre at the origin, in frame heights (y up), so a drop
// stays round at any composition aspect; the view is [-hw, hw] × [-0.5, 0.5].
//
// Time : spreading, pouring, dissolving and every hand-made event run on a fixed
// clock of STEP seconds, so a gesture logged with its steps replays to the very
// same points (MarbleSource keeps the log on the slot). The currents and the
// automatic drops are live : never logged.

export const STEP = 1 / 60
/** An edge longer than this is split, at the finest (frame heights : 8.6 px at
 *  4K; a drop stretched from afar is resampled once it has stretched 1 %, so an
 *  edge can run up to 1 % over). */
export const MAX_EDGE = 0.004
/** Two edges shorter than this around a point merge it away (unless it is a corner). */
export const MIN_EDGE = 0.0011
/** The picture size MAX_EDGE is made for (pixels a frame height : 4K). A smaller
 *  picture samples its outlines coarser, the same ~8.6 px between points as 4K,
 *  up to COARSEST × MAX_EDGE : at 1080p about half the points for the same drops
 *  (the sharp tips keep their fine sampling). The points budget counts at this size. */
export const REF_PX = 2160
const COARSEST = 2
/** A drop drawn out thinner than this (its mean width, 2 area / perimeter, in
 *  the picture's pixels) dissolves into the water : a combed or swirled sliver
 *  under half a pixel is nearly all outline (points) and hardly any paint, and
 *  the comb only ever draws it longer. */
export const THIN_PX = 0.5
const MIN_PTS = 8
const MAX_DROP_PTS = 1500
/** Steps a dissolve takes (1.5 s), and the quicker one of `clear`. */
const DISSOLVE_STEPS = 90
const CLEAR_STEPS = 40
/** A held drop starts pouring after this many steps without moving (0.25 s). */
const POUR_DELAY = 15
/** Pouring adds this share of the drop's own area per step (doubles in ~0.8 s). */
const POUR_RATE = 0.02
const MAX_R = 0.7
/** A drop lands as a disc this share of its final radius, then spreads. */
const LAND = 0.25
/** How far past the view a drop may drift before it is taken off the water. */
const CULL_MARGIN = 0.35

export interface Drop {
  id: number
  n: number
  xy: Float64Array
  col: number // palette slot, 0..5
  cx: number
  cy: number
  a0: number // the area it was dropped with
  area: number // the area spread so far (its paint's area)
  steps: number // spread time in steps
  age: number
  pour: number // pour steps so far
  held: boolean
  spreading: boolean
  fade: number // 1 → 0 while it dissolves into the water
  fadeStep: number // how much fade it loses per step (0 : not dissolving)
  cap: number // while dissolving : the most points it may have (it stops growing)
  touched: boolean
  stretch: number // how much far pushes have stretched it since its last resample
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// ── Event records (the log) ─────────────────────────────────────────────
// A gesture's events, flat numbers : [step, type, ...args].
export const EV_DROP = 0 // x, y, r, col, spreadSteps, held (1 : until its release)
export const EV_RELEASE = 1 // drop index within the gesture
export const EV_COMB = 2 // x0, y0, x1, y1, tines, spacing
export const EV_SWIRL = 3 // cx, cy, dθ, R
const EV_LEN = [8, 3, 8, 6]

/** One logged gesture (one undo step) : a pointer pressed, moved, let go. */
export interface MarbleGesture {
  k: 'm'
  id: number
  ev: number[]
}

/** Round a logged number : the live gesture applies the rounded value too, so
 *  the replay lands on the same points (1e-5 frame heights : 0.02 px at 4K). */
export const q5 = (v: number): number => Math.round(v * 1e5) / 1e5

/** A log from a session file (or anywhere) checked : numbers finite and in
 *  range, records whole. A malformed gesture is cut to its valid events (or
 *  left out); never a throw. */
export function sanitizeLog(raw: unknown): MarbleGesture[] {
  if (!Array.isArray(raw)) return []
  const out: MarbleGesture[] = []
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue
    const o = g as { k?: unknown; id?: unknown; ev?: unknown }
    if (o.k !== 'm' || !Array.isArray(o.ev)) continue
    const id = typeof o.id === 'number' && Number.isFinite(o.id) ? o.id : out.length + 1
    const src = o.ev as unknown[]
    const ev: number[] = []
    let i = 0
    let drops = 0
    let lastStep = -1
    while (i + 2 <= src.length) {
      const step = src[i], type = src[i + 1]
      if (typeof step !== 'number' || !Number.isInteger(step) || step < 0 || step > 1e10) break
      if (typeof type !== 'number' || !(type in EV_LEN)) break
      const len = EV_LEN[type]
      if (i + len > src.length) break
      const a = src.slice(i + 2, i + len)
      if (!a.every((v) => typeof v === 'number' && Number.isFinite(v))) break
      const n = a as number[]
      if (step < lastStep) break
      if (type === EV_DROP && !(Math.abs(n[0]) < 20 && Math.abs(n[1]) < 20 && n[2] > 0 && n[2] <= MAX_R && n[3] >= 0 && n[3] < 6 && n[4] >= 1 && n[4] <= 600 && (n[5] === 0 || n[5] === 1))) break
      if (type === EV_RELEASE && !(Number.isInteger(n[0]) && n[0] >= 0 && n[0] < drops)) break
      if (type === EV_COMB && !(n.slice(0, 4).every((v) => Math.abs(v) < 20) && n[4] >= 1 && n[4] <= 9 && n[5] > 0 && n[5] < 1)) break
      if (type === EV_SWIRL && !(Math.abs(n[0]) < 20 && Math.abs(n[1]) < 20 && Math.abs(n[2]) < 7 && n[3] > 0 && n[3] < 5)) break
      if (type === EV_DROP) drops++
      ev.push(step, type, ...n)
      lastStep = step
      i += len
    }
    if (ev.length) out.push({ k: 'm', id, ev })
  }
  return out
}

/** Calls `f(start, type)` for each event of a gesture's flat list. */
export function forEachEvent(ev: readonly number[], f: (at: number, type: number) => void): void {
  let i = 0
  while (i + 1 < ev.length) {
    const t = ev[i + 1]
    const len = EV_LEN[t]
    if (len === undefined || i + len > ev.length) return
    f(i, t)
    i += len
  }
}

/** Seeded random numbers (mulberry32) : a slot's own dice. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The currents' and the automatic comb and swirl's settings for one frame. */
export interface Currents {
  evolve: number // 0..1 : how fast the water moves (0 : still)
  scale: number // the currents' wavelength (1 : about a frame height)
  comb: number // 0..1
  combSpacing: number // frame heights
  combAngle: number // radians
  swirl: number // 0..1
}

let scratch = new Float64Array(8192)

export class MarbleModel {
  drops: Drop[] = []
  /** The fixed-step clock (steps since this water was made : never goes back). */
  step = 0
  points = 0
  /** Half the view's width and height, in frame heights. */
  hw = 16 / 18
  hh = 0.5
  /** Points, counted as 4K samples them (see budgetPoints). */
  budget = 60000
  /** The picture's pixels a frame height (setDensity). */
  px = REF_PX
  /** The longest edge now : MAX_EDGE at 4K and above, up to twice that below. */
  maxEdge = MAX_EDGE
  private max2 = MAX_EDGE * MAX_EDGE
  private nextId = 1
  /** Steps the last resample or transform changed something : replay may skip
   *  only fully quiet stretches. */
  private busy = false
  // The currents' own state (live, never logged).
  private modeAng = [0.3, 2.4, 4.4]
  private modePh = [0, 2.1, 4.2]
  private combPh = 0 // where the automatic comb is in its cycle (0..1 per stroke + pause)
  private combDir = 1
  private combLeg = 0
  private swirlT = 0

  constructor(seed = 1) {
    const r = rng(seed * 7919 + 13)
    this.modeAng = [r() * 6.283, r() * 6.283, r() * 6.283]
    this.modePh = [r() * 6.283, r() * 6.283, r() * 6.283]
    this.swirlT = r() * 1000
  }

  get count(): number {
    return this.drops.length
  }

  /** The picture's size (pixels a frame height) : outlines are sampled no finer
   *  than it can show. Existing outlines follow at their next resample. */
  setDensity(px: number): void {
    if (!(px > 0) || px === this.px) return
    this.px = px
    this.maxEdge = MAX_EDGE * Math.max(1, Math.min(COARSEST, REF_PX / px))
    this.max2 = this.maxEdge * this.maxEdge
  }

  /** The budget in points at this size : the same outlines, sampled coarser on a
   *  smaller picture, so the same drops stay on the water at 1080p and at 4K. */
  budgetPoints(): number {
    return Math.round(this.budget * (MAX_EDGE / this.maxEdge))
  }

  /** Anything moving on the fixed clock (spreading, pouring, dissolving). */
  active(): boolean {
    if (this.busy) return true
    for (const d of this.drops) if (d.spreading || d.fadeStep > 0) return true
    return false
  }

  spreading(): boolean {
    for (const d of this.drops) if (d.spreading) return true
    return false
  }

  /** The paint on the water against the view's area (dissolving paint left out). */
  fullness(): number {
    let a = 0
    for (const d of this.drops) if (d.fadeStep === 0) a += Math.max(d.area, d.a0)
    return a / (4 * this.hw * this.hh)
  }

  // ── The transforms ───────────────────────────────────────────────────

  /** Every point pushed out by a drop of radius sqrt(r2) at (cx, cy). */
  pushAll(cx: number, cy: number, r2: number): void {
    if (!(r2 > 0)) return
    for (const d of this.drops) {
      // its edges stretch where the push is strong (resample it this step), and
      // a little at a distance : those add up until they reach 1 % (its box from
      // before the push)
      if (!d.touched) {
        const ex = Math.max(d.minX - cx, 0, cx - d.maxX)
        const ey = Math.max(d.minY - cy, 0, cy - d.maxY)
        const dd = ex * ex + ey * ey
        d.stretch += r2 / (2 * Math.max(dd, 1e-12))
        if (dd < r2 * 400 + 1e-4 || d.stretch > 0.01) d.touched = true
      }
      const xy = d.xy
      const n2 = d.n * 2
      // the box follows the points (the frame is drawn from it : no pass of its own)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let i = 0; i < n2; i += 2) {
        const dx = xy[i] - cx
        const dy = xy[i + 1] - cy
        const l2 = dx * dx + dy * dy
        const s = Math.sqrt(1 + r2 / (l2 > 1e-24 ? l2 : 1e-24))
        const x = cx + dx * s, y = cy + dy * s
        xy[i] = x
        xy[i + 1] = y
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      d.minX = x0; d.minY = y0; d.maxX = x1; d.maxY = y1
    }
  }

  /** A stylus (tines = 1) or a comb dragged from (x0, y0) to (x1, y1) : the paint
   *  near each tine slides along with it, fading over `w` across the stroke and
   *  over WINDOW along it, in short sub-strokes so the map stays one to one. */
  tine(x0: number, y0: number, x1: number, y1: number, tines: number, spacing: number, w: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0)
    if (len < 1e-7) return
    const mx = (x1 - x0) / len
    const my = (y1 - y0) / len
    const nx = -my
    const ny = mx
    const k = Math.max(1, Math.ceil(len / (w * 0.3)))
    const z = len / k
    const half = (tines - 1) / 2
    const WIN = 0.12 + spacing * half
    const reach = w * 7 + spacing * half
    for (let s = 0; s < k; s++) {
      const ax = x0 + mx * z * (s + 0.5)
      const ay = y0 + my * z * (s + 0.5)
      for (const d of this.drops) {
        // the drop entirely out of reach : nothing moves
        const ex = Math.max(d.minX - ax, 0, ax - d.maxX)
        const ey = Math.max(d.minY - ay, 0, ay - d.maxY)
        if (ex * ex + ey * ey > (reach + WIN * 3) * (reach + WIN * 3)) continue
        d.touched = true
        const xy = d.xy
        const n2 = d.n * 2
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (let i = 0; i < n2; i += 2) {
          let x = xy[i], y = xy[i + 1]
          const px = x - ax
          const py = y - ay
          const u = px * mx + py * my
          let c = px * nx + py * ny
          if (tines > 1) {
            c = c + half * spacing
            const t = Math.round(c / spacing)
            c = Math.abs(c - (t < 0 ? 0 : t > tines - 1 ? tines - 1 : t) * spacing)
          } else c = Math.abs(c)
          if (c <= reach) {
            // sech across the tine (the same tail as exp, but no cusp on the tine
            // itself) : a tip rounds off within about a pixel, so the two sides of
            // a long chevron never meet and cross
            const wu = u / WIN
            const e = Math.exp(-c / w)
            const disp = z * ((2 * e) / (1 + e * e)) * Math.exp(-wu * wu)
            x += disp * mx
            y += disp * my
            xy[i] = x
            xy[i + 1] = y
          }
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
        d.minX = x0; d.minY = y0; d.maxX = x1; d.maxY = y1
      }
      // the outlines follow between sub-strokes, so a long drag never folds them
      if (s < k - 1) this.resampleTouched()
    }
    this.busy = true
  }

  /** The paint turned round (cx, cy) by dθ at the centre, falling off over R. */
  vortex(cx: number, cy: number, dth: number, R: number): void {
    if (!(Math.abs(dth) > 1e-9) || !(R > 1e-4)) return
    // a big turn in small ones (the shear across the vortex stays under ~0.15
    // a turn), the outlines resampled between them
    const k = Math.max(1, Math.ceil(Math.abs(dth) * 5))
    for (let s = 0; s < k; s++) {
      this.vortexOnce(cx, cy, dth / k, R)
      if (s < k - 1) this.resampleTouched()
    }
    this.busy = true
  }

  private vortexOnce(cx: number, cy: number, dth: number, R: number): void {
    const reach2 = 9 * R * R
    const iR2 = 1 / (R * R)
    for (const d of this.drops) {
      const ex = Math.max(d.minX - cx, 0, cx - d.maxX)
      const ey = Math.max(d.minY - cy, 0, cy - d.maxY)
      if (ex * ex + ey * ey > reach2) continue
      d.touched = true
      const xy = d.xy
      const n2 = d.n * 2
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let i = 0; i < n2; i += 2) {
        let x = xy[i], y = xy[i + 1]
        const dx = x - cx
        const dy = y - cy
        const l2 = dx * dx + dy * dy
        if (l2 <= reach2) {
          const a = dth * Math.exp(-l2 * iR2)
          let c: number, s: number
          if (a > 0.02 || a < -0.02) { c = Math.cos(a); s = Math.sin(a) } else { const a2 = a * a; c = 1 - a2 * 0.5 + a2 * a2 / 24; s = a - a * a2 / 6 }
          x = cx + dx * c - dy * s
          y = cy + dx * s + dy * c
          xy[i] = x
          xy[i + 1] = y
        }
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      d.minX = x0; d.minY = y0; d.maxX = x1; d.maxY = y1
    }
  }

  // ── Drops ────────────────────────────────────────────────────────────

  /** A new drop lands : a disc a quarter of its size (a drop hits the water
   *  with a body; a pinpoint circle was torn up by the first current that
   *  crossed it), spreading to radius r over `steps` steps. `held` keeps it
   *  pouring until released. */
  drop(x: number, y: number, r: number, col: number, steps: number, held = false): Drop {
    const n = Math.max(24, Math.min(MAX_DROP_PTS, Math.round((2 * Math.PI * r) / (this.maxEdge * 0.75))))
    const r0 = r * LAND
    this.pushAll(x, y, r0 * r0)
    const xy = new Float64Array(n * 2)
    // counter-clockwise : every drop has the same orientation (the stencil fill
    // does not need it, the tests check it stays)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      xy[i * 2] = x + Math.cos(a) * r0
      xy[i * 2 + 1] = y + Math.sin(a) * r0
    }
    const d: Drop = {
      id: this.nextId++, n, xy, col: col | 0, cx: x, cy: y, a0: Math.PI * r * r, area: Math.PI * r0 * r0,
      steps: Math.max(1, Math.round(steps)), age: 0, pour: 0, held, spreading: true, fade: 1, fadeStep: 0, cap: 0,
      touched: true, stretch: 0, minX: x - r0, minY: y - r0, maxX: x + r0, maxY: y + r0
    }
    this.drops.push(d)
    this.points += n
    this.busy = true
    return d
  }

  release(d: Drop | undefined): void {
    if (d) d.held = false
  }

  /** The whole water dissolves (a short fade, not a cut). */
  clear(): void {
    for (const d of this.drops) {
      d.spreading = false
      d.held = false
      if (d.fadeStep === 0) d.cap = d.n
      if (d.fadeStep === 0 || d.fadeStep < 1 / CLEAR_STEPS) d.fadeStep = 1 / CLEAR_STEPS
    }
    this.busy = true
  }

  /** The drop starts dissolving into the water (1.5 s) and stops growing : a
   *  fading drop is still carried, but its outline gains no more points. */
  private dissolve(d: Drop): void {
    if (d.fadeStep > 0) return
    d.fadeStep = 1 / DISSOLVE_STEPS
    d.cap = d.n
  }

  /** Empty now (a rebuild starts from clean water). */
  reset(): void {
    this.drops = []
    this.points = 0
    this.busy = false
  }

  // ── The fixed step ───────────────────────────────────────────────────

  /** One step of the fixed clock : spreading and pouring drops grow (oldest
   *  first), dissolving drops fade, the points budget is kept, touched drops are
   *  resampled, drops far off the view leave the water. */
  stepOnce(): void {
    this.step++
    let busy = false
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i]
      if (!d.spreading) continue
      d.age++
      if (d.held && d.age > POUR_DELAY && Math.sqrt((d.a0 * (1 + POUR_RATE * (d.pour + 1))) / Math.PI) < MAX_R) d.pour++
      const target = d.a0 * (1 + POUR_RATE * d.pour)
      const t = Math.min(1, d.age / d.steps)
      const e = 1 - (1 - t) * (1 - t) * (1 - t)
      const want = target * e
      if (want > d.area) {
        this.pushAll(d.cx, d.cy, (want - d.area) / Math.PI)
        d.area = want
      }
      if (t >= 1 && !d.held) d.spreading = false
      busy = true
    }
    // dissolving
    let gone = false
    for (const d of this.drops) {
      if (d.fadeStep > 0) {
        d.fade -= d.fadeStep
        if (d.fade <= 0) gone = true
        busy = true
      }
    }
    if (gone) this.drops = this.drops.filter((d) => {
      if (d.fade > 0) return true
      this.points -= d.n
      return false
    })
    this.keepBudget()
    if (this.resampleTouched()) busy = true
    this.cull()
    this.busy = busy
  }

  /** Past the points budget, drops dissolve into the water (as many as it
   *  takes) : among the older half, the most stretched first (the most outline
   *  for their paint : the thin filaments the currents drew out), so the big
   *  regions behind everything are not forever halfway through fading (on a
   *  dark water they turned the whole ground khaki and plum). */
  keepBudget(): void {
    // The points budget at this picture size. Drops already dissolving count
    // half : they no longer grow and leave within 1.5 s, yet under a lively comb
    // they were once half of all the points (153K for a 60K budget at evolve 1).
    const B = this.budgetPoints()
    let live = 0
    for (const d of this.drops) live += d.fadeStep === 0 ? d.n : d.n * 0.5
    if (live <= B) return
    const old = this.drops.slice(0, Math.max(1, Math.ceil(this.drops.length / 2))).filter((d) => d.fadeStep === 0 && !d.spreading)
    old.sort((a, b) => b.n / Math.sqrt(Math.max(b.area, 1e-6)) - a.n / Math.sqrt(Math.max(a.area, 1e-6)) || a.id - b.id)
    for (const d of old) {
      if (live <= B) break
      this.dissolve(d)
      live -= d.n * 0.5
    }
    // still over (the older half was not enough) : the oldest of the rest
    for (const d of this.drops) {
      if (live <= B) break
      if (d.fadeStep > 0 || d.spreading) continue
      this.dissolve(d)
      live -= d.n * 0.5
    }
  }

  /** Resample every drop a transform touched (see resample). True when a drop
   *  changed. A drop whose outline changed is checked for thinness here (only
   *  then : a still drop never turns thin, and the log replays the same). */
  resampleTouched(): boolean {
    let changed = false
    for (const d of this.drops) {
      if (!d.touched) continue
      d.touched = false
      d.stretch = 0
      if (!this.resample(d)) continue
      changed = true
      this.bbox(d)
      if (!d.spreading && d.fadeStep === 0 && this.thin(d)) this.dissolve(d)
    }
    return changed
  }

  /** All drops. */
  resampleAll(): void {
    for (const d of this.drops) d.touched = true
    this.resampleTouched()
  }

  bbox(d: Drop): void {
    const xy = d.xy
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    const n2 = d.n * 2
    for (let i = 0; i < n2; i += 2) {
      const x = xy[i], y = xy[i + 1]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    d.minX = x0; d.minY = y0; d.maxX = x1; d.maxY = y1
  }

  /** Drawn out under THIN_PX on average (2 area / perimeter, in the picture's
   *  pixels) : a sliver more outline than paint. */
  thin(d: Drop): boolean {
    const xy = d.xy
    const n = d.n
    let per = 0
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1
      per += Math.hypot(xy[j * 2] - xy[i * 2], xy[j * 2 + 1] - xy[i * 2 + 1])
    }
    return per > 0 && ((2 * d.area) / per) * this.px < THIN_PX
  }

  /** Would resample change this outline? Its own tests, in the same order and
   *  without a square root. The currents ask it of every drop every frame (they
   *  used to resample them all : a full pass and three square roots an edge). */
  needsResample(d: Drop): boolean {
    const n = d.n
    const xy = d.xy
    const MAX2 = this.max2
    const canMerge = !d.spreading && n > MIN_PTS
    // a dissolving drop at its cap gains no points (merges only)
    const grow = d.fadeStep === 0 || d.n < d.cap
    let x = xy[0], y = xy[1]
    let ax = x - xy[n * 2 - 2], ay = y - xy[n * 2 - 1]
    let la = ax * ax + ay * ay
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1
      const k = j + 1 === n ? 0 : j + 1
      const xj = xy[j * 2], yj = xy[j * 2 + 1]
      const ex = xj - x, ey = yj - y
      const le = ex * ex + ey * ey
      const bx = xy[k * 2] - xj, by = xy[k * 2 + 1] - yj
      const lb = bx * bx + by * by
      if (grow && (le > MAX2 || (le > TIP2 && (turns(ax, ay, la, ex, ey, le) || turns(ex, ey, le, bx, by, lb))))) return true
      if (canMerge && j !== 0 && le < MIN2 && lb < MIN2 && straight(ex, ey, le, bx, by, lb)) return true
      ax = ex; ay = ey; la = le
      x = xj; y = yj
    }
    return false
  }

  /** Keep the outline smooth without exploding : an edge past the longest edge
   *  (maxEdge : MAX_EDGE at 4K, coarser on a smaller picture) is split on the
   *  curve through its neighbours (Catmull-Rom); a point whose two edges are both
   *  under MIN_EDGE merges away, unless it sits on a corner or the drop is still
   *  spreading (its tiny first circle). A dissolving drop never grows past its
   *  cap. One pass, in place. */
  resample(d: Drop): boolean {
    const n = d.n
    const xy = d.xy
    const MAX2 = this.max2
    const maxE = this.maxEdge
    const canMerge = !d.spreading
    // quick test : most drops need nothing
    if (!this.needsResample(d)) return false
    let room = d.fadeStep === 0 ? Infinity : Math.max(0, d.cap - n)
    let o = scratch
    if (o.length < n * 4 + 64) o = scratch = new Float64Array(n * 8 + 64)
    let m = 0
    let lx = xy[0], ly = xy[1]
    o[m++] = lx; o[m++] = ly
    let kept = n
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1
      const k = j + 1 === n ? 0 : j + 1
      const h = i === 0 ? n - 1 : i - 1
      const xj = xy[j * 2], yj = xy[j * 2 + 1]
      // merge p_j away (never the first point, which closes the loop)
      if (canMerge && j !== 0 && kept > MIN_PTS) {
        const ax = xj - lx, ay = yj - ly
        const bx = xy[k * 2] - xj, by = xy[k * 2 + 1] - yj
        const la = ax * ax + ay * ay, lb = bx * bx + by * by
        // a corner (turning more than ~30°) stays
        if (la < MIN2 && lb < MIN2 && straight(ax, ay, la, bx, by, lb)) { kept--; room++; continue }
      }
      // split the edge from the last kept point to p_j : a long one, or one
      // beside a sharp turn (the comb's pointed tips are sampled finer, so the
      // two sides of a thin tip never cross)
      const dx = xj - lx, dy = yj - ly
      const l2 = dx * dx + dy * dy
      if (room > 0 && (l2 > MAX2 || (l2 > TIP2 && sharp(xy, n, i, j)))) {
        // (a little short of the longest edge : the curve bulges past its chord)
        const parts = Math.min(room + 1, l2 > MAX2 ? Math.ceil(Math.sqrt(l2) / (maxE * 0.8)) : 2)
        room -= parts - 1
        if (m + parts * 2 + 4 > o.length) {
          const big = new Float64Array(Math.max(o.length * 2, m + parts * 2 + 64))
          big.set(o.subarray(0, m))
          o = scratch = big
        }
        // Catmull-Rom through p_h, p_i, p_j, p_k (the last kept point stands for
        // p_i when points were merged before it : close enough, and exact for
        // the common case)
        const p0x = xy[h * 2], p0y = xy[h * 2 + 1]
        const p1x = lx, p1y = ly
        const p2x = xj, p2y = yj
        const p3x = xy[k * 2], p3y = xy[k * 2 + 1]
        for (let s = 1; s < parts; s++) {
          const t = s / parts, t2 = t * t, t3 = t2 * t
          o[m++] = 0.5 * (2 * p1x + (-p0x + p2x) * t + (2 * p0x - 5 * p1x + 4 * p2x - p3x) * t2 + (-p0x + 3 * p1x - 3 * p2x + p3x) * t3)
          o[m++] = 0.5 * (2 * p1y + (-p0y + p2y) * t + (2 * p0y - 5 * p1y + 4 * p2y - p3y) * t2 + (-p0y + 3 * p1y - 3 * p2y + p3y) * t3)
        }
      }
      if (j !== 0) {
        if (m + 2 > o.length) {
          const big = new Float64Array(o.length * 2)
          big.set(o.subarray(0, m))
          o = scratch = big
        }
        o[m++] = xj; o[m++] = yj
        lx = xj; ly = yj
      }
    }
    const nn = m >> 1
    if (nn === n && !needsCopy(o, xy, m)) return false
    if (xy.length < m) d.xy = new Float64Array(Math.ceil(m * 1.5) & ~1)
    d.xy.set(o.subarray(0, m))
    this.points += nn - n
    d.n = nn
    return true
  }

  /** Drops that drifted far off the view leave the water (not seen, not drawn). */
  cull(): void {
    const X = this.hw + CULL_MARGIN, Y = this.hh + CULL_MARGIN
    let any = false
    for (const d of this.drops) if (d.minX > X || d.maxX < -X || d.minY > Y || d.maxY < -Y) { any = true; break }
    if (!any) return
    this.drops = this.drops.filter((d) => {
      if (d.spreading || !(d.minX > X || d.maxX < -X || d.minY > Y || d.maxY < -Y)) return true
      this.points -= d.n
      return false
    })
  }

  // ── The live currents (never logged) ─────────────────────────────────

  /** `dt` seconds of the slow currents : three plane-wave shears, the automatic
   *  comb and the drifting swirl, fused in one pass over the points. */
  currents(dt: number, c: Currents): void {
    const ev = c.evolve
    if (!(ev > 0) || !(dt > 0)) return
    const sp = ev * (0.6 + 1.4 * ev) // a gentle start, lively at 1
    // a long frame (a stall, a slow machine) in short ones, the outlines
    // resampled between them, so the comb's shear never folds an outline
    const cw = Math.max(0.01, c.combSpacing) * 0.16 + 0.004
    const n = Math.max(1, Math.ceil(Math.max((dt * sp) / 0.05, (c.comb * 0.11 * sp * dt) / (0.3 * cw))))
    for (let i = 0; i < Math.min(n, 12); i++) {
      this.currentsOnce(dt / n, c, sp)
      if (i < n - 1) this.resampleTouched()
    }
  }

  private currentsOnce(dt: number, c: Currents, sp: number): void {
    // the modes turn and drift slowly, so the flow never settles into cells
    const turn = [0.031, -0.023, 0.017]
    const drift = [0.23, -0.31, 0.19]
    const wl = [0.95, 0.63, 0.44]
    const amp = [0.045, 0.03, 0.022]
    const kx = [0, 0, 0], ky = [0, 0, 0], ax = [0, 0, 0], ay = [0, 0, 0], ph = [0, 0, 0]
    for (let m = 0; m < 3; m++) {
      this.modeAng[m] = (this.modeAng[m] + turn[m] * sp * dt) % (Math.PI * 2)
      this.modePh[m] = (this.modePh[m] + drift[m] * sp * dt) % (Math.PI * 2)
      const k = (Math.PI * 2) / (wl[m] * Math.max(0.15, c.scale))
      const ca = Math.cos(this.modeAng[m]), sa = Math.sin(this.modeAng[m])
      kx[m] = ca * k
      ky[m] = sa * k
      // the shear is along m ⊥ k, so it never squeezes the paint
      ax[m] = -sa * amp[m] * sp * dt
      ay[m] = ca * amp[m] * sp * dt
      ph[m] = this.modePh[m]
    }
    // The automatic comb : a stroke, a rest, the way back offset by half a tine.
    let cz = 0, cmx = 0, cmy = 0, cnx = 0, cny = 0, cax = 0, cay = 0
    const sx = Math.max(0.01, c.combSpacing)
    const cw = sx * 0.16 + 0.004
    if (c.comb > 0) {
      const cycle = 9 / Math.max(0.2, sp) // seconds for a stroke and its rest
      this.combPh += dt / cycle
      if (this.combPh >= 1) {
        this.combPh %= 1
        this.combDir = -this.combDir
        this.combLeg = (this.combLeg + 1) % 4
      }
      if (this.combPh < 0.55) {
        const a = c.combAngle + (this.combLeg >= 2 ? Math.PI / 2 : 0)
        cmx = Math.cos(a) * this.combDir
        cmy = Math.sin(a) * this.combDir
        cnx = -Math.sin(a)
        cny = Math.cos(a)
        const off = (this.combLeg & 1 ? 0.5 : 0) * sx
        cax = cnx * off
        cay = cny * off
        // slow at the ends of the stroke, a smooth pull in the middle
        const s = Math.sin((this.combPh / 0.55) * Math.PI)
        cz = c.comb * 0.11 * sp * dt * s * s
      }
    }
    // The swirl drifting across the water.
    let sw = 0, scx = 0, scy = 0, sR = 0
    if (c.swirl > 0) {
      this.swirlT = (this.swirlT + dt * sp) % 40000
      const t = this.swirlT
      scx = this.hw * 0.62 * Math.sin(t * 0.071 + 1.3)
      scy = 0.3 * Math.sin(t * 0.053)
      sR = 0.2 * Math.sqrt(Math.max(0.15, c.scale))
      sw = c.swirl * 0.45 * sp * dt * (Math.sin(t * 0.021) >= 0 ? 1 : -1)
    }
    const isx = 1 / sx
    const icw = 1 / cw
    const sR2 = 9 * sR * sR
    const isR2 = sR > 0 ? 1 / (sR * sR) : 0
    const kx0 = kx[0], ky0 = ky[0], ax0 = ax[0], ay0 = ay[0], p0 = ph[0]
    const kx1 = kx[1], ky1 = ky[1], ax1 = ax[1], ay1 = ay[1], p1 = ph[1]
    const kx2 = kx[2], ky2 = ky[2], ax2 = ax[2], ay2 = ay[2], p2 = ph[2]
    for (const d of this.drops) {
      const xy = d.xy
      const n2 = d.n * 2
      const swirlHere = sw !== 0 && !(Math.max(d.minX - scx, 0, scx - d.maxX) ** 2 + Math.max(d.minY - scy, 0, scy - d.maxY) ** 2 > sR2)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let i = 0; i < n2; i += 2) {
        let x = xy[i], y = xy[i + 1]
        let w = fcos(x * kx0 + y * ky0 + p0)
        x += ax0 * w; y += ay0 * w
        w = fcos(x * kx1 + y * ky1 + p1)
        x += ax1 * w; y += ay1 * w
        w = fcos(x * kx2 + y * ky2 + p2)
        x += ax2 * w; y += ay2 * w
        if (cz !== 0) {
          let q = (x - cax) * cnx + (y - cay) * cny
          q = (q - Math.round(q * isx) * sx) * icw
          // sech(q) through cosh's series to q⁸ (0.2 % off at the farthest a
          // point can be from its tine; Math.exp cost 70 ns a point here)
          const v = q * q
          const disp = cz / (1 + v * (0.5 + v * (1 / 24 + v * (1 / 720 + v / 40320))))
          x += disp * cmx; y += disp * cmy
        }
        if (swirlHere) {
          const dx = x - scx, dy = y - scy
          const l2 = dx * dx + dy * dy
          if (l2 < sR2) {
            const a = sw * fexpNeg(l2 * isR2)
            const a2 = a * a
            const cs = 1 - a2 * 0.5, sn = a - a * a2 / 6
            x = scx + dx * cs - dy * sn
            y = scy + dx * sn + dy * cs
          }
        }
        xy[i] = x; xy[i + 1] = y
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      d.minX = x0; d.minY = y0; d.maxX = x1; d.maxY = y1
      // resampled only where an edge is due a split or a merge (they once all
      // were, every frame : a third of the worker's time)
      if (!d.touched && this.needsResample(d)) d.touched = true
    }
  }

  // ── Snapshots (undo of a hand-made gesture) ──────────────────────────

  snapshot(): ModelSnapshot {
    return {
      drops: this.drops.map((d) => ({ ...d, xy: d.xy.slice(0, d.n * 2) })),
      points: this.points,
      nextId: this.nextId
    }
  }

  restore(s: ModelSnapshot): void {
    this.drops = s.drops.map((d) => ({ ...d, xy: d.xy.slice() }))
    this.points = s.points
    this.nextId = Math.max(this.nextId, s.nextId)
    this.busy = true
  }
}

export interface ModelSnapshot {
  drops: Drop[]
  points: number
  nextId: number
}

/** cos(x), ~5e-7 off, three times as fast as Math.cos here (the currents call it
 *  three times per point per frame : 7 → 2 ms at 90K points). Each current is a
 *  shear, which keeps every area exactly whatever function drives it. */
export function fcos(x: number): number {
  let t = x * 0.15915494309189535
  t -= Math.round(t) // a turn in [-0.5, 0.5]
  let a = t < 0 ? -t : t
  let sgn = 1
  if (a > 0.25) { a = 0.5 - a; sgn = -1 }
  const th = a * 6.283185307179586
  const u = th * th
  return sgn * (1 - u * (0.5 - u * (1 / 24 - u * (1 / 720 - u * (1 / 40320 - u / 3628800)))))
}

const POW2N = new Float64Array(64).map((_, k) => 2 ** -k)

/** e^-x for x ≥ 0, 2e-5 off at worst (the swirl's falloff, for ~60 % of the
 *  points every frame : Math.exp is a call, this is inline arithmetic). A turn
 *  keeps every area whatever angle drives it. */
export function fexpNeg(x: number): number {
  const t = x * 1.4426950408889634
  if (!(t < 63)) return 0
  const k = t | 0
  const f = t - k
  // 2^-f on [0, 1) : its Taylor series to f⁶
  const p = 1 - f * (0.6931471805599453 - f * (0.2402265069591007 - f * (0.05550410866482158 - f * (0.009618129107628477 - f * (0.0013333558146428443 - f * 0.00015403530393381606)))))
  return p * POW2N[k]
}

/** An edge long enough to split at a sharp turn (twice the merge length). */
const TIP2 = (2.2 * MIN_EDGE) ** 2
const MIN2 = MIN_EDGE * MIN_EDGE

/** The outline turns by more than ~40° from edge a (squared length la) to edge
 *  b : cos < 0.766, squared so no root is taken (a zero edge counts as a turn). */
function turns(ax: number, ay: number, la: number, bx: number, by: number, lb: number): boolean {
  const dot = ax * bx + ay * by
  return dot <= 0 || dot * dot < 0.586756 * la * lb
}

/** It turns by less than ~30° (cos > 0.866) : not a corner, a point may merge away. */
function straight(ax: number, ay: number, la: number, bx: number, by: number, lb: number): boolean {
  const dot = ax * bx + ay * by
  return dot > 0 && dot * dot > 0.749956 * la * lb
}

/** The outline turns sharply (more than ~40°) at either end of edge i → j. */
function sharp(xy: Float64Array, n: number, i: number, j: number): boolean {
  const h = i === 0 ? n - 1 : i - 1
  const k = j + 1 === n ? 0 : j + 1
  const ex = xy[j * 2] - xy[i * 2], ey = xy[j * 2 + 1] - xy[i * 2 + 1]
  const ax = xy[i * 2] - xy[h * 2], ay = xy[i * 2 + 1] - xy[h * 2 + 1]
  const bx = xy[k * 2] - xy[j * 2], by = xy[k * 2 + 1] - xy[j * 2 + 1]
  const le = ex * ex + ey * ey
  return turns(ax, ay, ax * ax + ay * ay, ex, ey, le) || turns(ex, ey, le, bx, by, bx * bx + by * by)
}

function needsCopy(a: Float64Array, b: Float64Array, m: number): boolean {
  for (let i = 0; i < m; i++) if (a[i] !== b[i]) return true
  return false
}

// ── Replay : a gesture's events on the fixed clock ─────────────────────

/** Applies one event (at its index in a gesture's flat list) to the model.
 *  `drops` collects the drops this gesture made (a release names one). */
export function applyEvent(m: MarbleModel, ev: readonly number[], at: number, drops: Drop[]): void {
  const t = ev[at + 1]
  const a = at + 2
  if (t === EV_DROP) drops.push(m.drop(ev[a], ev[a + 1], ev[a + 2], ev[a + 3], ev[a + 4], ev[a + 5] === 1))
  else if (t === EV_RELEASE) m.release(drops[ev[a]])
  else if (t === EV_COMB) m.tine(ev[a], ev[a + 1], ev[a + 2], ev[a + 3], ev[a + 4], ev[a + 5], combWidth(ev[a + 5], ev[a + 4]))
  else if (t === EV_SWIRL) m.vortex(ev[a], ev[a + 1], ev[a + 2], ev[a + 3])
}

/** The stylus's width : a single tine is a fine stylus, a comb's tines are
 *  narrower than their spacing. */
export function combWidth(spacing: number, tines: number): number {
  return tines > 1 ? Math.max(0.006, spacing * 0.22) : 0.018
}

/** A drop's spread time in steps (fixed-clock), from seconds. */
export const spreadSteps = (sec: number): number => Math.max(1, Math.min(600, Math.round(sec / STEP)))

/**
 * Replays gestures onto the model on the fixed clock : each event at its own
 * step (relative to `base`), steps run between them while anything spreads,
 * quiet stretches skipped. `rebase` : the first event lands on the model's
 * current step (an appended gesture), else the log's own steps are kept (a
 * rebuild on clean water). A generator : it yields between steps so a long log
 * replays across frames.
 */
export function* replay(m: MarbleModel, log: readonly MarbleGesture[], rebase: boolean): Generator<void, void, void> {
  type E = { s: number; g: number; at: number }
  const all: E[] = []
  log.forEach((g, gi) => forEachEvent(g.ev, (at) => all.push({ s: g.ev[at], g: gi, at })))
  if (!all.length) return
  all.sort((a, b) => a.s - b.s || a.g - b.g || a.at - b.at)
  // appended gestures land now; a rebuild (clean water) runs on the log's own steps
  if (!rebase) m.step = all[0].s
  const shift = rebase ? m.step - all[0].s : 0
  const drops: Drop[][] = log.map(() => [])
  let i = 0
  while (i < all.length) {
    const s = all[i].s + shift
    // the model catches up to the event's step : steps while something moves,
    // a jump over a quiet stretch
    while (m.step < s) {
      if (!m.active()) { m.step = s; break }
      m.stepOnce()
      yield
    }
    while (i < all.length && all[i].s + shift === s) {
      const e = all[i]
      applyEvent(m, log[e.g].ev, e.at, drops[e.g])
      i++
    }
  }
  while (m.active()) {
    m.stepOnce()
    yield
  }
}

/** Runs a replay to the end at once. */
export function replayNow(m: MarbleModel, log: readonly MarbleGesture[], rebase: boolean): void {
  const it = replay(m, log, rebase)
  while (!it.next().done) { /* run */ }
}

// ── Hand gestures : a pointer (the mouse, a pinching hand) on the water ──

export const TOOL_DROPS = 0
export const TOOL_COMB = 1
export const TOOL_SWIRL = 2

/** What a gesture needs from the source's settings, read when each event lands. */
export interface HandSettings {
  tool: number
  /** A drop's radius now (size, spread and the crowding law applied). */
  radius: () => number
  /** The next drop's palette slot. */
  color: () => number
  spreadSteps: number
  combSpacing: number
}

interface Gesture {
  tool: number
  ev: number[]
  drops: Drop[]
  held: number // index of the held drop in `drops` (-1 : none)
  lastX: number
  lastY: number
  trailR: number
  trailCol: number
  swirlX: number
  swirlY: number
  swirlA: number | null
  tines: number
  log: boolean
  id: number
}

/** The pointers on the water, each its own gesture (two hands and the mouse at
 *  once). Every event is applied to the model the moment it lands and, for a
 *  logged pointer, kept with its step : the gesture comes back as one log entry
 *  when the pointer lets go. */
export class HandGestures {
  private g = new Map<number, Gesture>()
  constructor(private m: MarbleModel) {}

  active(): boolean {
    return this.g.size > 0
  }

  has(pid: number): boolean {
    return this.g.has(pid)
  }

  private push(gs: Gesture, type: number, args: number[]): void {
    const ev = [this.m.step, type, ...args]
    applyEvent(this.m, ev, 0, gs.drops)
    if (gs.log) gs.ev.push(...ev)
  }

  /** `log` : keep the gesture (the mouse); body and remote pointers are live. */
  down(pid: number, x: number, y: number, s: HandSettings, opts: { shift?: boolean; log?: boolean; id?: number } = {}): void {
    if (this.g.has(pid)) this.cancel(pid)
    const gs: Gesture = {
      tool: s.tool | 0, ev: [], drops: [], held: -1, lastX: q5(x), lastY: q5(y), trailR: 0, trailCol: 0,
      swirlX: q5(x), swirlY: q5(y), swirlA: null, tines: opts.shift ? 5 : 1, log: opts.log !== false,
      id: opts.id ?? Math.floor(Math.random() * 2147483647)
    }
    this.g.set(pid, gs)
    if (gs.tool === TOOL_DROPS) {
      const r = q5(Math.max(0.002, Math.min(MAX_R, s.radius())))
      this.push(gs, EV_DROP, [q5(x), q5(y), r, s.color(), s.spreadSteps, 1])
      gs.held = gs.drops.length - 1
      gs.trailR = q5(Math.max(0.002, r * 0.5))
    }
  }

  move(pid: number, x: number, y: number, s: HandSettings): void {
    const gs = this.g.get(pid)
    if (!gs) return
    x = q5(x)
    y = q5(y)
    if (gs.tool === TOOL_DROPS) {
      // moving lets the pour go : the drag is a trail of smaller drops
      if (gs.held >= 0) {
        this.push(gs, EV_RELEASE, [gs.held])
        gs.held = -1
      }
      const gap = gs.trailR * 1.4
      let d = Math.hypot(x - gs.lastX, y - gs.lastY)
      while (d >= gap) {
        const k = gap / d
        const px = q5(gs.lastX + (x - gs.lastX) * k)
        const py = q5(gs.lastY + (y - gs.lastY) * k)
        this.push(gs, EV_DROP, [px, py, gs.trailR, s.color(), s.spreadSteps, 0])
        gs.lastX = px
        gs.lastY = py
        d = Math.hypot(x - gs.lastX, y - gs.lastY)
      }
    } else if (gs.tool === TOOL_COMB) {
      if (x !== gs.lastX || y !== gs.lastY) {
        this.push(gs, EV_COMB, [gs.lastX, gs.lastY, x, y, gs.tines, q5(Math.max(0.01, Math.min(0.5, s.combSpacing)))])
        gs.lastX = x
        gs.lastY = y
      }
    } else {
      const dx = x - gs.swirlX, dy = y - gs.swirlY
      const R = Math.hypot(dx, dy)
      if (R < 0.008) return
      const a = Math.atan2(dy, dx)
      if (gs.swirlA !== null) {
        let da = a - gs.swirlA
        da -= Math.PI * 2 * Math.round(da / (Math.PI * 2))
        if (Math.abs(da) > 1e-4) this.push(gs, EV_SWIRL, [gs.swirlX, gs.swirlY, q5(da), q5(Math.min(4.9, R))])
      }
      gs.swirlA = a
    }
  }

  /** The pointer lets go : the gesture's log entry (null when not logged or empty). */
  up(pid: number): MarbleGesture | null {
    const gs = this.g.get(pid)
    if (!gs) return null
    if (gs.held >= 0) this.push(gs, EV_RELEASE, [gs.held])
    this.g.delete(pid)
    return gs.log && gs.ev.length ? { k: 'm', id: gs.id, ev: gs.ev } : null
  }

  /** Lost (the slot changed, the water was rebuilt) : the held drop is let go. */
  cancel(pid: number): MarbleGesture | null {
    return this.up(pid)
  }

  cancelAll(): void {
    for (const pid of [...this.g.keys()]) this.up(pid)
  }

  /** The gesture under way on a pointer (its id, for its undo snapshot). */
  gestureId(pid: number): number | null {
    return this.g.get(pid)?.id ?? null
  }
}
