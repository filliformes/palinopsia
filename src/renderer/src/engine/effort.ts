// Movement qualities : HOW the body moves, read from the pose landmarks (where it
// is, the Pose features already say). The effort descriptors of dance movement
// analysis in their computable form (Camurri et al., expressive gesture analysis;
// Larboulette & Gibet 2015, a review of computable expressive descriptors) :
//   energy      the weight of the movement : expressive kinetic energy, held at its peak
//   suddenness  its time : aggregated acceleration (sudden against sustained)
//   directness  its space : net displacement over path length (straight against wandering)
//   fluidity    its flow : how little of the limbs' velocity lies above a few hertz
//               (a shake, a stop-go, a staccato read jerky; a sweep reads smooth)
//   expansion   the contraction index inverted : how far the limbs reach from the body
//   symmetry    left against right, mirrored across the body's own axis
// Two gestures ride on them : IMPULSE (a burst out of calm) and FREEZE (a quick
// stop into stillness).
// Everything is measured in TORSO LENGTHS (per second), so a dancer far from the
// camera and one close to it read alike. Landmarks jitter and these are
// derivatives, so each joint first goes through a One-Euro filter (Casiez et al.
// 2012) whose cutoff rises with speed, and the jitter that survives is learned as
// a floor and taken off : a still body reads still on any camera. The floors
// calibrate over the first moments, then follow jitter only while the body is
// near them, so a long unbroken dance is not mistaken for jitter. Pushed once per
// NEW camera frame, stamped with the frame's media time.

export interface EffortStats {
  energy: number // 0 still .. 1 vigorous
  expansion: number // 0 folded in .. 1 limbs spread far from the body
  fluidity: number // 0 jerky .. 1 smooth (held while the body is still)
  suddenness: number // 0 sustained .. 1 sudden
  directness: number // 0 wandering .. 1 straight to the point (held while still)
  symmetry: number // 0 lopsided .. 1 mirror-symmetric
  speed: number // expressive speed above the jitter floor, torso lengths / s
  impulse: boolean // this frame : a burst out of calm
  freeze: boolean // this frame : a quick stop held still
}

export const EFFORT_REST: EffortStats = {
  energy: 0, expansion: 0, fluidity: 0.5, suddenness: 0, directness: 0.5, symmetry: 0.5,
  speed: 0, impulse: false, freeze: false
}

interface Landmark { x: number; y: number; visibility?: number }

// The joints read (MediaPipe pose indices) and their EXPRESSIVE weights : the
// hands count more than a physical mass model would give them, since a mover's
// energy reads mostly in the hands.
const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
//               nose shoL shoR elbL elbR wriL wriR hipL hipR kneL kneR ankL ankR
const WEIGHT = [0.08, 0.08, 0.08, 0.08, 0.08, 0.16, 0.16, 0.08, 0.08, 0.06, 0.06, 0.08, 0.08]
const NJ = JOINTS.length
// End effectors for directness (head, wrists, ankles), as indices into JOINTS.
const EFFECTORS = [0, 5, 6, 11, 12]
// Left/right pairs for symmetry (indices into JOINTS) and their weights.
const PAIRS: Array<[number, number, number]> = [[3, 4, 1], [5, 6, 1.5], [9, 10, 0.5], [11, 12, 0.5]]
// Arm joints for expansion (indices into JOINTS) and their weights.
const REACH: Array<[number, number]> = [[5, 1], [6, 1], [3, 0.5], [4, 0.5]]

const EURO_MIN = 1.0 // Hz : the filter's cutoff at rest
const EURO_BETA = 3.5 // cutoff rise per torso length / s (about 8 Hz at 2 TL/s)
const EURO_D = 1.0 // Hz : cutoff of the filter's own speed estimate
const GAP = 0.25 // s : a longer hole in the frames restarts the filters
const HP_HZ = 2.5 // fluidity : velocity content above this counts against it
const HP_POLES = 4 // … through a 4-pole high-pass (a clean split from a 1 Hz sweep)
const DIR_WIN = 0.6 // s : the directness window (about one reach)
const QUIET = 0.25 // TL/s above the floor : under this the body is calm
const MOVING = 0.4 // TL/s : fluidity reads the joints moving at least this fast
const PATH_MIN = 0.25 // TL : directness only reads a path at least this long
const CALIBRATE = 1.5 // s : the floors' first calibration after a camera start

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
/** EMA factor for a time constant tau (s) over dt (s). */
const ema = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau)
/** One-Euro smoothing factor for a cutoff (Hz) over dt (s). */
const euroA = (dt: number, hz: number): number => {
  const r = 2 * Math.PI * hz * dt
  return r / (r + 1)
}
/** Median of the first n values (a small scratch array, sorted in place). */
function median(a: Float64Array, n: number): number {
  if (n <= 0) return 0
  const v = a.subarray(0, n).sort()
  return n & 1 ? v[n >> 1] : (v[n / 2 - 1] + v[n / 2]) / 2
}
/** A jitter floor : falls fast to a quieter signal; rises quickly while
 *  calibrating or while the signal stays near it (the camera got noisier), and
 *  only very slowly past that band (so steady movement isn't taken for jitter). */
function floorStep(f: number, x: number, dt: number, band: number, cap: number, calibrating: boolean): number {
  const tau = x < f ? 0.4 : calibrating ? 0.5 : x < band * f ? 2 : 300
  return Math.min(cap, f + (x - f) * ema(dt, tau))
}

class JointState {
  on = false // the One-Euro filter holds a position
  x = 0 // filtered position (torso lengths)
  y = 0
  dx = 0 // the filter's own speed estimate
  hasV = false // a velocity from the previous frame exists
  vx = 0
  vy = 0
  pv = 0 // slow mean of this joint's velocity power (fluidity)
  ph = 0 // … and of its high-passed velocity power
  // The high-pass chain on the velocity : each stage's output and last input.
  hpOut = new Float64Array(HP_POLES * 2)
  hpIn = new Float64Array(HP_POLES * 2)

  reset(): void {
    this.on = false
    this.hasV = false
    this.pv = this.ph = 0
  }

  /** Filter a new raw position; returns the velocity (null on a fresh start).
   *  `jit` is the jitter's own apparent speed, kept out of the cutoff. */
  step(x: number, y: number, dt: number, jit: number): [number, number] | null {
    if (!this.on || dt <= 0) {
      this.on = true
      this.x = x
      this.y = y
      this.dx = 0
      this.hasV = false
      return null
    }
    // The cutoff follows the smoothed SPEED (not the smoothed velocity : a hand
    // darting in changing directions averages to no velocity, and would be
    // smoothed into a glide).
    this.dx += euroA(dt, EURO_D) * (Math.hypot(x - this.x, y - this.y) / dt - this.dx)
    const a = euroA(dt, EURO_MIN + EURO_BETA * Math.max(0, this.dx - 1.2 * jit))
    const nx = this.x + a * (x - this.x)
    const ny = this.y + a * (y - this.y)
    const vx = (nx - this.x) / dt
    const vy = (ny - this.y) / dt
    this.x = nx
    this.y = ny
    return [vx, vy]
  }

  /** The velocity through the high-pass chain; returns its power. */
  highPass(vx: number, vy: number, a: number, first: boolean): number {
    let ix = vx, iy = vy
    for (let s = 0; s < HP_POLES; s++) {
      const o = s * 2
      if (first) {
        this.hpOut[o] = this.hpOut[o + 1] = 0
      } else {
        this.hpOut[o] = a * (this.hpOut[o] + ix - this.hpIn[o])
        this.hpOut[o + 1] = a * (this.hpOut[o + 1] + iy - this.hpIn[o + 1])
      }
      this.hpIn[o] = ix
      this.hpIn[o + 1] = iy
      ix = this.hpOut[o]
      iy = this.hpOut[o + 1]
    }
    return ix * ix + iy * iy
  }
}

interface Snapshot {
  t: number
  x: Float32Array // filtered effector positions (torso lengths)
  y: Float32Array
  w: Float32Array // 0 = unseen this frame
}

export class EffortReader {
  private joints = Array.from({ length: NJ }, () => new JointState())
  private hist: Snapshot[] = []
  private lastT = -1
  private scale = 0 // smoothed torso length, image-height units
  private rawSpeed = 0 // smoothed weighted RMS speed, jitter included
  private acc = 0 // smoothed aggregated acceleration, jitter included
  private floorJ = 0.3 // the jitter's apparent raw speed (the filters' own floor)
  private medJ = 0
  private scrJ = new Float64Array(NJ)
  private medV = 0 // smoothed median joint speed, acceleration, high-band power
  private medA = 0
  private medH = 0
  // Per-frame scratch for the medians.
  private scrV = new Float64Array(NJ)
  private scrA = new Float64Array(NJ)
  private scrH = new Float64Array(NJ)
  // Learned jitter floors (kept while the body leaves and returns : they belong
  // to the camera and the room, not the person).
  private floorV = 0.1
  private floorA = 3
  private floorH = 0.01
  private seen = 0 // seconds of body seen since the camera started (calibration)
  // Gesture state.
  private quietFor = 0 // seconds calm (0 while moving)
  private calmBefore = 0 // how long it had been calm before it last started moving
  private sinceStart = 0 // seconds since it last started moving
  private lastFast = -1e9 // last time the body moved fast (freeze)
  private impArmed = false
  private frzArmed = false
  private stats: EffortStats = { ...EFFORT_REST }

  /** The latest readings (without pushing a frame). */
  current(): EffortStats {
    return this.stats
  }

  /** The body left : readings back to rest, the learned floors kept. */
  reset(): void {
    this.restart()
    this.scale = 0
    this.rawSpeed = 0
    this.acc = 0
    this.medV = this.medA = this.medH = this.medJ = 0
    this.quietFor = this.calmBefore = this.sinceStart = 0
    this.lastFast = -1e9
    this.impArmed = this.frzArmed = false
    this.stats = { ...EFFORT_REST }
  }

  /** The camera (re)started : forget the floors too, and calibrate again. */
  resetAll(): void {
    this.reset()
    this.floorV = 0.1
    this.floorA = 3
    this.floorH = 0.01
    this.floorJ = 0.3
    this.seen = 0
  }

  /** Filters and windows start over (a hole in the frames); the outputs hold. */
  private restart(): void {
    for (const j of this.joints) j.reset()
    this.hist.length = 0
    this.lastT = -1
  }

  /** One new camera frame : `lm` the 33 pose landmarks (normalized image
   *  coordinates), `t` the frame's media time (s), `aspect` width / height;
   *  `sImpulse` / `sFreeze` the gestures' sensitivities (0..1, 0.5 default). */
  push(lm: Landmark[], t: number, aspect: number, sImpulse = 0.5, sFreeze = 0.5): EffortStats {
    const st = this.stats
    st.impulse = false
    st.freeze = false
    if (lm.length < 29) return st
    let dt = t - this.lastT
    if (this.lastT < 0 || !(dt > 0) || dt > GAP) {
      this.restart()
      dt = 0
    }
    this.lastT = t
    const X = (i: number): number => lm[i].x * aspect
    const Y = (i: number): number => lm[i].y
    const vis = (i: number): number => smooth(0.35, 0.75, lm[i].visibility ?? 1)

    // The scale : torso length (shoulder middle to hip middle), or the shoulder
    // width when the hips are out of frame (a webcam at a desk).
    const shx = (X(11) + X(12)) / 2, shy = (Y(11) + Y(12)) / 2
    const hpx = (X(23) + X(24)) / 2, hpy = (Y(23) + Y(24)) / 2
    const hipsSeen = Math.min(vis(23), vis(24)) > 0.5
    const raw = Math.max(0.03, hipsSeen ? Math.hypot(shx - hpx, shy - hpy) : Math.hypot(X(11) - X(12), Y(11) - Y(12)) * 1.35)
    this.scale = this.scale > 0 && dt > 0 ? this.scale + (raw - this.scale) * ema(dt, 0.5) : raw
    const s = this.scale
    const cx = hipsSeen ? (shx + hpx) / 2 : shx
    const cy = hipsSeen ? (shy + hpy) / 2 : shy + 0.5 * s

    // ── Per joint : filter, then velocity, acceleration, high band ──
    let sw = 0, sv2 = 0, swa = 0, sa = 0, nV = 0, nA = 0
    const tau = 1 / (2 * Math.PI * HP_HZ)
    const hpA = dt > 0 ? tau / (tau + dt) : 0
    for (let k = 0; k < NJ; k++) {
      const i = JOINTS[k]
      const wv = vis(i)
      const js = this.joints[k]
      if (wv < 0.05) {
        js.reset() // unseen : start clean when it returns, no leap
        continue
      }
      const v = js.step(X(i) / s, Y(i) / s, dt, this.floorJ)
      if (!v) continue
      this.scrJ[nV] = js.dx
      const [vx, vy] = v
      const w = WEIGHT[k] * wv
      const v2 = vx * vx + vy * vy
      sw += w
      sv2 += w * v2
      const h2 = js.highPass(vx, vy, hpA, !js.hasV)
      js.pv += (v2 - js.pv) * ema(dt, 0.6)
      js.ph += (h2 - js.ph) * ema(dt, 0.6)
      this.scrV[nV] = Math.sqrt(v2)
      this.scrH[nV++] = js.ph
      if (js.hasV) {
        const am = Math.hypot((vx - js.vx) / dt, (vy - js.vy) / dt)
        sa += w * am
        swa += w
        this.scrA[nA++] = am
      }
      js.vx = vx
      js.vy = vy
      js.hasV = true
    }

    if (sw > 0 && dt > 0) {
      this.seen += dt
      const cal = this.seen < CALIBRATE
      // The jitter floors learn from the MEDIAN joint : one hand moving alone
      // cannot shift a median, so a slow single-limb movement is never taken for
      // jitter; only a whole body moving for minutes without a pause could be.
      this.medJ += (median(this.scrJ, nV) - this.medJ) * ema(dt, 0.2)
      this.floorJ = floorStep(this.floorJ, this.medJ, dt, 2.5, 3, cal)
      this.medV += (median(this.scrV, nV) - this.medV) * ema(dt, 0.2)
      this.floorV = floorStep(this.floorV, this.medV, dt, 2.5, 0.6, cal)
      // Energy : the weighted RMS speed above the jitter floor, with a fast
      // attack and a slower release (a windowed peak, as the weight effort is).
      this.rawSpeed += (Math.sqrt(sv2 / sw) - this.rawSpeed) * ema(dt, 0.05)
      const speed = Math.max(0, this.rawSpeed - 1.4 * this.floorV)
      st.speed = speed
      const eRaw = 1 - Math.exp(-speed / 1.2)
      st.energy += (eRaw - st.energy) * ema(dt, eRaw > st.energy ? 0.05 : 0.35)
      // Suddenness : the aggregated acceleration above its floor, same envelope.
      if (swa > 0) {
        this.medA += (median(this.scrA, nA) - this.medA) * ema(dt, 0.2)
        this.floorA = floorStep(this.floorA, this.medA, dt, 2.5, 25, cal)
        this.acc += (sa / swa - this.acc) * ema(dt, 0.05)
        const sRaw = 1 - Math.exp(-Math.max(0, this.acc - 1.4 * this.floorA) / 12)
        st.suddenness += (sRaw - st.suddenness) * ema(dt, sRaw > st.suddenness ? 0.04 : 0.4)
      }
      // Fluidity : over the joints that MOVE (still ones only add jitter), the
      // share of their velocity's power above HP_HZ, the jitter's own share off.
      this.medH += (median(this.scrH, nV) - this.medH) * ema(dt, 0.2)
      this.floorH = floorStep(this.floorH, this.medH, dt, 4, 4, cal)
      const vMove = Math.max(MOVING, 3 * this.floorV)
      let num = 0, den = 0
      for (let k = 0; k < NJ; k++) {
        const js = this.joints[k]
        if (!js.hasV || js.pv < vMove * vMove) continue
        const w = WEIGHT[k]
        num += w * Math.max(0, js.ph - 1.2 * this.floorH)
        den += w * js.pv
      }
      if (den > 0) {
        const hf = Math.sqrt(num / den)
        const fRaw = 1 - clamp01((hf - 0.08) / 0.3)
        st.fluidity += (fRaw - st.fluidity) * ema(dt, 0.25)
      }

      // ── Gestures ──
      // IMPULSE : out of at least a moment of calm, fast within a quarter second.
      // FREEZE : a fast movement stopped within a quarter second, held still.
      const vImp = 1.8 - sImpulse * 1.2 // 1.2 TL/s at the default sensitivity
      const vFrz = 1.6 - sFreeze * 1.0 // 1.1 TL/s
      if (speed > vFrz) {
        this.lastFast = t
        this.frzArmed = true
      }
      if (speed < QUIET) {
        if (this.quietFor === 0) {
          // The calm just began : a freeze only if the fast movement was recent.
          if (t - this.lastFast > 0.25) this.frzArmed = false
          this.impArmed = true
        }
        this.quietFor += dt
        if (this.frzArmed && this.quietFor >= 0.12) {
          st.freeze = true
          this.frzArmed = false
        }
      } else {
        if (this.quietFor > 0) {
          this.calmBefore = this.quietFor
          this.sinceStart = 0
        }
        this.quietFor = 0
        this.sinceStart += dt
        if (this.impArmed && speed > vImp && this.sinceStart < 0.25 && this.calmBefore > 0.35) {
          st.impulse = true
          this.impArmed = false
        }
      }
    }

    // ── Directness : effector paths over the last DIR_WIN seconds ──
    const snap: Snapshot = { t, x: new Float32Array(EFFECTORS.length), y: new Float32Array(EFFECTORS.length), w: new Float32Array(EFFECTORS.length) }
    for (let e = 0; e < EFFECTORS.length; e++) {
      const k = EFFECTORS[e]
      const js = this.joints[k]
      if (!js.on) continue
      snap.x[e] = js.x
      snap.y[e] = js.y
      snap.w[e] = WEIGHT[k] * vis(JOINTS[k])
    }
    this.hist.push(snap)
    while (this.hist.length > 2 && this.hist[1].t <= t - DIR_WIN) this.hist.shift()
    if (dt > 0 && this.hist.length > 2) {
      let wPath = 0, wNet = 0, longest = 0
      for (let e = 0; e < EFFECTORS.length; e++) {
        const w = snap.w[e]
        if (w <= 0) continue
        let path = 0, first = -1, last = -1
        for (let h = 0; h < this.hist.length; h++) {
          const H = this.hist[h]
          if (H.w[e] <= 0) continue
          if (last >= 0) {
            // Each step less what jitter alone would travel in it.
            const step = Math.hypot(H.x[e] - this.hist[last].x[e], H.y[e] - this.hist[last].y[e])
            path += Math.max(0, step - this.floorV * (H.t - this.hist[last].t))
          }
          if (first < 0) first = h
          last = h
        }
        if (first < 0 || last === first) continue
        const net = Math.hypot(this.hist[last].x[e] - this.hist[first].x[e], this.hist[last].y[e] - this.hist[first].y[e])
        wPath += w * path
        wNet += w * Math.min(net, path)
        longest = Math.max(longest, path)
      }
      if (longest > PATH_MIN && wPath > 0) {
        st.directness += (clamp01(wNet / wPath) - st.directness) * ema(dt, 0.2)
      }
    }

    // ── Expansion : the arms' reach from the torso centre, plus the stance ──
    let rw = 0, rs = 0
    for (const [k, wk] of REACH) {
      const i = JOINTS[k]
      const w = wk * vis(i)
      rw += w
      rs += (w * Math.hypot(X(i) - cx, Y(i) - cy)) / s
    }
    if (rw > 0.2) {
      let ex = clamp01((rs / rw - 0.45) / 0.95)
      if (Math.min(vis(27), vis(28)) > 0.5) ex = 0.75 * ex + 0.25 * clamp01((Math.abs(X(27) - X(28)) / s - 0.3) / 1.0)
      st.expansion = dt > 0 ? st.expansion + (ex - st.expansion) * ema(dt, 0.12) : ex
    }

    // ── Symmetry : each left joint mirrored across the body axis vs its right ──
    let ux = 0, uy = -1
    if (hipsSeen) {
      const l = Math.hypot(shx - hpx, shy - hpy) || 1
      ux = (shx - hpx) / l
      uy = (shy - hpy) / l
    }
    let dw = 0, ds = 0
    for (const [kl, kr, wk] of PAIRS) {
      const il = JOINTS[kl], ir = JOINTS[kr]
      const w = wk * Math.min(vis(il), vis(ir))
      if (w <= 0.05) continue
      const dx = X(il) - cx, dy = Y(il) - cy
      const along = dx * ux + dy * uy
      const mx = cx + 2 * along * ux - dx, my = cy + 2 * along * uy - dy
      dw += w
      ds += (w * Math.hypot(mx - X(ir), my - Y(ir))) / s
    }
    if (dw > 0) {
      const sy = 1 - clamp01(ds / dw / 1.2)
      st.symmetry = dt > 0 ? st.symmetry + (sy - st.symmetry) * ema(dt, 0.15) : sy
    }
    return st
  }
}
