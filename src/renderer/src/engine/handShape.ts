// Hand shapes : pure geometry on MediaPipe's 21 hand landmarks, no model. The
// tracker (engine/bodyTracker.ts) calls handShape() for each hand of each tracked
// frame and feeds a ShapeReader per hand slot, which turns the curl vector into
// held shapes (fist, open, point, peace, thumb up / down, ok, horns, call, gun).
//
// Landmarks are normalised 0..1 across the width and the height separately, so on
// a 16:9 or 4:3 camera a raw angle is skewed. Everything here is measured in a
// SQUARE space first : x × aspect, y, and z × aspect (MediaPipe's z, depth from
// the wrist, is on the scale of x). Lengths are then taken relative to the hand's
// own palm, so a hand far from the camera reads like one close to it.
//
// Nothing in this file touches the app : it is tested on its own with synthetic
// hands (built from straight and curled finger chains at many rotations, sizes,
// aspect ratios and mirrorings, with noise).

/** One landmark as MediaPipe gives it (x, y in 0..1 of the frame, z relative). */
export interface HandPt {
  x: number
  y: number
  z?: number
}

/** How to read one hand. */
export interface HandFrame {
  /** Camera width / height (landmarks are normalised per axis). */
  aspect: number
  /** The Body page's Mirror : the roll reads as you see yourself. */
  mirror: boolean
  /** The hand's chirality in the RAW camera picture : true for a hand shaped
   *  like the one on the left of the unmirrored frame (a front camera's view of
   *  the performer's right hand). Decides which way the palm faces. */
  rawLeft: boolean
}

export interface HandShapeFeatures {
  /** Thumb, index, middle, ring, pinky : 0 straight .. 1 fully curled. */
  curl: [number, number, number, number, number]
  /** Thumb tip to the index, middle, ring and pinky tips : 1 touching .. 0 apart. */
  pinch: [number, number, number, number]
  /** Roll in the picture as you see it : 0 fingers to the left, 0.5 up, 1 to the
   *  right (beyond a quarter turn it holds at the end). */
  angle: number
  /** 1 palm toward the camera, 0.5 edge-on, 0 the back of the hand. */
  facing: number
  /** The hand's apparent size : 0 far from the camera .. 1 close to it. */
  span: number
  /** Where the thumb points in the picture : +1 straight up, -1 straight down. */
  thumbUp: number
  /** 0..1 : how readable the roll is (low when the fingers point at the camera). */
  axisSure: number
  /** The palm's size in picture heights (span before its mapping). */
  palm: number
}

// MediaPipe's 21 hand points.
const WRIST = 0
const TH_CMC = 1, TH_MCP = 2, TH_TIP = 4
const FINGER_CHAINS: ReadonlyArray<readonly [number, number, number, number]> = [
  [5, 6, 7, 8], // index : MCP, PIP, DIP, tip
  [9, 10, 11, 12], // middle
  [13, 14, 15, 16], // ring
  [17, 18, 19, 20] // pinky
]
const TIPS = [8, 12, 16, 20]

const D2R = Math.PI / 180
// A finger's curl, from joint angles measured on long chords (a fingertip's last
// joint is too short a segment to read through the landmarks' jitter) : the bend
// at the knuckle (the palm's wrist-to-knuckle line against the first phalanx),
// counting less (a finger bent only at the knuckle points forward, it is not
// folded), plus the bend at the middle joint (the first phalanx against the
// chord to the fingertip, which carries the last joint's bend too). A closed
// fist sums to about 170° this way.
const W_MCP = 0.6
const FINGER_FULL = 170 * D2R
// The thumb's curl : its bend (its metacarpal against the chord to its tip), and
// how far its tip sits from the middle of the palm (a straight thumb laid across
// the palm is tucked, not out).
const THUMB_FLEX_FULL = 90 * D2R
const THUMB_OUT_IN = 0.5 // tip to palm centre, in palms : tucked at or below
const THUMB_OUT_OUT = 0.95 // … and out at or above
const THUMB_W_FLEX = 0.3
// Pinch : tip to tip, in palms. Touching pads leave the two tip points about a
// fifth of a palm apart; each finger reads 0 at its own open distance.
const PINCH_TOUCH = 0.2
const PINCH_FAR = [1.0, 1.1, 1.15, 1.2]
// Span : the palm's size in picture heights, on a log scale (a ratio of distances
// reads the same anywhere in the room) : 0 at 0.04 (across a room), 1 at 0.45
// (a hand right in front of the lens).
const SPAN_LO = 0.04, SPAN_HI = 0.45

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The 21 points in the square space (x × aspect, y, z × aspect), flat. */
function square(lm: ReadonlyArray<HandPt>, aspect: number): Float64Array {
  const p = new Float64Array(63)
  for (let i = 0; i < 21; i++) {
    const q = lm[i]
    p[i * 3] = q.x * aspect
    p[i * 3 + 1] = q.y
    p[i * 3 + 2] = (q.z ?? 0) * aspect
  }
  return p
}

function dist(p: Float64Array, a: number, b: number): number {
  return Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2])
}

/** The bend at joint b (radians, 0 = straight) between segments a→b and b→c. */
function bend(p: Float64Array, a: number, b: number, c: number): number {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
  const vx = p[c * 3] - p[b * 3], vy = p[c * 3 + 1] - p[b * 3 + 1], vz = p[c * 3 + 2] - p[b * 3 + 2]
  const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz)
  if (lu < 1e-9 || lv < 1e-9) return 0
  const c0 = (ux * vx + uy * vy + uz * vz) / (lu * lv)
  return Math.acos(c0 < -1 ? -1 : c0 > 1 ? 1 : c0)
}

/** Everything one hand's shape says, from its 21 landmarks. Null when the
 *  landmarks are missing or degenerate. */
export function handShape(lm: ReadonlyArray<HandPt>, f: HandFrame): HandShapeFeatures | null {
  if (!lm || lm.length < 21) return null
  const aspect = f.aspect > 0 && Number.isFinite(f.aspect) ? f.aspect : 4 / 3
  const p = square(lm, aspect)
  // The palm's own size : the mean of the four wrist-to-knuckle lengths (in 3D,
  // so a palm tilted away from the camera keeps its size).
  const palm = (dist(p, WRIST, 5) + dist(p, WRIST, 9) + dist(p, WRIST, 13) + dist(p, WRIST, 17)) / 4
  if (!(palm > 1e-6)) return null

  // Finger curls (index..pinky).
  const curl: [number, number, number, number, number] = [0, 0, 0, 0, 0]
  for (let i = 0; i < 4; i++) {
    const [m, q, , t] = FINGER_CHAINS[i]
    const a = W_MCP * bend(p, WRIST, m, q) + bend(p, m, q, t)
    curl[i + 1] = clamp01(a / FINGER_FULL)
  }
  // The thumb : its bend, and how far its tip stands from the palm centre.
  const cx = (p[0] + p[15] + p[27] + p[39] + p[51]) / 5
  const cy = (p[1] + p[16] + p[28] + p[40] + p[52]) / 5
  const cz = (p[2] + p[17] + p[29] + p[41] + p[53]) / 5
  const tipOut = Math.hypot(p[TH_TIP * 3] - cx, p[TH_TIP * 3 + 1] - cy, p[TH_TIP * 3 + 2] - cz) / palm
  const out = clamp01((tipOut - THUMB_OUT_IN) / (THUMB_OUT_OUT - THUMB_OUT_IN))
  const flex = clamp01(bend(p, TH_CMC, TH_MCP, TH_TIP) / THUMB_FLEX_FULL)
  curl[0] = clamp01(THUMB_W_FLEX * flex + (1 - THUMB_W_FLEX) * (1 - out))

  // Pinches : the thumb tip to each fingertip, in palms.
  const pinch: [number, number, number, number] = [0, 0, 0, 0]
  for (let i = 0; i < 4; i++) {
    const d = dist(p, TH_TIP, TIPS[i]) / palm
    pinch[i] = clamp01(1 - (d - PINCH_TOUCH) / (PINCH_FAR[i] - PINCH_TOUCH))
  }

  // Roll : the wrist toward the knuckles' middle, in the picture as you see it.
  const ax = (p[15] + p[27] + p[39] + p[51]) / 4 - p[0]
  const ay = (p[16] + p[28] + p[40] + p[52]) / 4 - p[1]
  const az = (p[17] + p[29] + p[41] + p[53]) / 4 - p[2]
  const dx = f.mirror ? -ax : ax
  const theta = Math.atan2(dx, -ay) // 0 up, + to the right as seen
  const angle = clamp01(0.5 + theta / Math.PI)
  const a2 = Math.hypot(ax, ay), a3 = Math.hypot(ax, ay, az)
  const axisSure = a3 > 1e-9 ? clamp01((a2 / a3 - 0.3) / 0.4) : 0

  // Facing : the palm's normal (wrist→index knuckle × wrist→pinky knuckle). Its
  // picture-depth part says toward or away; its sign flips with the hand's
  // chirality (a left and a right hand wind the other way round).
  const bx = p[15] - p[0], by = p[16] - p[1], bz = p[17] - p[2]
  const ex = p[51] - p[0], ey = p[52] - p[1], ez = p[53] - p[2]
  const nx = by * ez - bz * ey, ny = bz * ex - bx * ez, nz = bx * ey - by * ex
  const nl = Math.hypot(nx, ny, nz)
  const toward = nl > 1e-12 ? (f.rawLeft ? -nz : nz) / nl : 0
  const facing = clamp01(0.5 + 0.5 * toward)

  // The thumb's direction in the picture (up is up, mirrored or not), fading out
  // when the thumb points at the camera (its picture is then too short to read).
  const tx = p[TH_TIP * 3] - p[TH_MCP * 3], ty = p[TH_TIP * 3 + 1] - p[TH_MCP * 3 + 1], tz = p[TH_TIP * 3 + 2] - p[TH_MCP * 3 + 2]
  const t2 = Math.hypot(tx, ty), t3 = Math.hypot(tx, ty, tz)
  const thumbUp = t2 > 1e-9 ? (-ty / t2) * clamp01(t2 / t3 / 0.5) : 0

  const span = clamp01(Math.log(palm / SPAN_LO) / Math.log(SPAN_HI / SPAN_LO))
  return { curl, pinch, angle, facing, span, thumbUp, axisSure, palm }
}

// ── Which hand is which ──────────────────────────────────────────────────

export type HandSlot = 'left' | 'right'
/** MediaPipe's handedness for one hand (its first category), when it has one. */
export interface HandLabel {
  name: string // 'Left' | 'Right'
  score: number
}

/** Whether a hand in this slot is shaped like the raw picture's left hand (the
 *  chirality handShape() needs). Slots are sides as you see them : with Mirror
 *  on, the left slot is the raw picture's right. */
export function rawLeftFor(slot: HandSlot, mirror: boolean): boolean {
  return mirror ? slot === 'right' : slot === 'left'
}

/** Puts the tracked hands in the left / right slots. Two hands : by where they
 *  are, as you see them (the one on the left is the left, as it always was).
 *  One hand : the slot it already had while it stays in view (a hand that just
 *  lost its partner keeps its side), else its handedness (MediaPipe's label :
 *  on an unmirrored camera its "Left" is the hand on the raw picture's left,
 *  that is the performer's right; learned again from every two-hand frame, so
 *  a camera that mirrors or a back view corrects itself), else the half of the
 *  picture it is in. */
export class HandSlots {
  private last: Record<HandSlot, { x: number; y: number; at: number } | null> = { left: null, right: null }
  // +1 : the label "Left" belongs to the raw picture's left hand; -1 : the other
  // way round. Learned from frames with two hands, two different labels.
  private sense = 1
  // A single hand just come into view : when, and its labels' vote so far.
  private entry: { at: number; vote: number } | null = null

  reset(): void {
    this.last = { left: null, right: null }
    this.entry = null
  }

  /** Indices into `wrists` for each slot (-1 : empty). `wrists` are the raw
   *  wrist points (x, y in 0..1); `labels` the handedness of each, if known. */
  assign(
    wrists: ReadonlyArray<{ x: number; y: number }>,
    labels: ReadonlyArray<HandLabel | null | undefined>,
    mirror: boolean,
    aspect: number,
    now: number
  ): Record<HandSlot, number> {
    const mx = (x: number): number => (mirror ? 1 - x : x)
    const res: Record<HandSlot, number> = { left: -1, right: -1 }
    const n = wrists.length
    if (n >= 2) {
      const a = mx(wrists[0].x) <= mx(wrists[1].x) ? 0 : 1
      res.left = a
      res.right = 1 - a
      // the raw picture's left hand, and the labels of the two
      const rl = wrists[0].x <= wrists[1].x ? 0 : 1
      const la = labels[rl]?.name, lb = labels[1 - rl]?.name
      if (la && lb && la !== lb) this.sense = Math.max(-1, Math.min(1, this.sense + ((la === 'Left' ? 1 : -1) - this.sense) * 0.05))
    } else if (n === 1) {
      const w = wrists[0]
      const lab = labels[0]
      const labRaw = lab && (lab.name === 'Left' || lab.name === 'Right') ? (lab.name === 'Left') === this.sense >= 0 : null
      const vote = labRaw === null ? 0 : (labRaw ? 1 : -1) * (lab && lab.score > 0 ? lab.score : 0.5)
      const fromRaw = (rawLeft: boolean): HandSlot => (mirror ? (rawLeft ? 'right' : 'left') : rawLeft ? 'left' : 'right')
      let slot: HandSlot | null = null
      // Still the same hand : the slot whose last wrist is near, seen just now.
      let bestD = SLOT_GATE
      for (const k of ['left', 'right'] as const) {
        const l = this.last[k]
        if (!l || now - l.at > SLOT_GRACE_MS) continue
        const d = Math.hypot((w.x - l.x) * aspect, w.y - l.y)
        if (d < bestD) { bestD = d; slot = k }
      }
      if (slot && this.entry && now - this.entry.at < SLOT_ENTRY_MS && labRaw !== null) {
        // A hand just in : its labels vote a little longer (the first frame,
        // half in view at the edge, is the least sure).
        this.entry.vote += vote
        slot = fromRaw(this.entry.vote >= 0)
      } else if (!slot) {
        if (labRaw !== null) {
          slot = fromRaw(labRaw)
          this.entry = { at: now, vote }
        } else {
          slot = mx(w.x) < 0.5 ? 'left' : 'right'
          this.entry = null
        }
      }
      res[slot] = 0
    }
    if (n !== 1) this.entry = null
    for (const k of ['left', 'right'] as const) {
      const i = res[k]
      if (i >= 0) this.last[k] = { x: wrists[i].x, y: wrists[i].y, at: now }
    }
    // A slot left empty by a pair that became one forgets its hand at once, so
    // the hand that stays cannot be taken for the one that left.
    if (n === 1) {
      const other: HandSlot = res.left >= 0 ? 'right' : 'left'
      this.last[other] = null
    }
    return res
  }
}
// A hand within this distance (picture heights) of where a slot's hand was, a
// moment ago, is still that hand.
const SLOT_GATE = 0.25
const SLOT_GRACE_MS = 400
const SLOT_ENTRY_MS = 250

// ── Smoothing ─────────────────────────────────────────────────────────────

/** A light smoothing of one hand's landmarks before its shape is read : joint
 *  angles read through raw jitter come out too bent (an angle is never below
 *  zero, so the jitter only ever adds), and a still finger reads as curling.
 *  Averaging the points first takes that off. Its time constant shortens as the
 *  hand moves faster (a quick gesture keeps up; a hand held still settles).
 *  One per hand slot; reset it when the slot's hand changes. */
export class HandSmoother {
  private p: Float64Array | null = null
  private t = 0
  private out: HandPt[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))

  reset(): void {
    this.p = null
  }

  /** `now` in ms; `tauMs` the time constant of a still hand. */
  push(lm: ReadonlyArray<HandPt>, now: number, aspect: number, tauMs = SMOOTH_MS): HandPt[] {
    if (!lm || lm.length < 21) return lm as HandPt[]
    const p = this.p
    const dt = this.t ? now - this.t : 0
    this.t = now
    if (!p || dt <= 0 || dt > 250) {
      const q = new Float64Array(63)
      for (let i = 0; i < 21; i++) { q[i * 3] = lm[i].x; q[i * 3 + 1] = lm[i].y; q[i * 3 + 2] = lm[i].z ?? 0 }
      this.p = q
    } else {
      // How fast the hand moves, in palms a second (wrist and middle knuckle).
      const palm = Math.hypot((lm[9].x - lm[0].x) * aspect, lm[9].y - lm[0].y) || 1e-3
      const mv = (Math.hypot((lm[0].x - p[0]) * aspect, lm[0].y - p[1]) + Math.hypot((lm[9].x - p[27]) * aspect, lm[9].y - p[28])) / 2
      const speed = mv / palm / (dt / 1000)
      const tau = tauMs / (1 + speed / SMOOTH_FAST)
      const a = 1 - Math.exp(-dt / Math.max(1, tau))
      for (let i = 0; i < 21; i++) {
        p[i * 3] += (lm[i].x - p[i * 3]) * a
        p[i * 3 + 1] += (lm[i].y - p[i * 3 + 1]) * a
        p[i * 3 + 2] += ((lm[i].z ?? 0) - p[i * 3 + 2]) * a
      }
    }
    const q = this.p as Float64Array
    for (let i = 0; i < 21; i++) { const o = this.out[i]; o.x = q[i * 3]; o.y = q[i * 3 + 1]; o.z = q[i * 3 + 2] }
    return this.out
  }
}
// A still hand's time constant, and the speed (palms a second) that halves it.
const SMOOTH_MS = 70
const SMOOTH_FAST = 3

// ── Held shapes ──────────────────────────────────────────────────────────

export const HAND_SHAPES = ['fist', 'open', 'point', 'peace', 'thumbUp', 'thumbDown', 'ok', 'horns', 'call', 'gun'] as const
export type HandShapeId = (typeof HAND_SHAPES)[number]

// What each finger must do, thumb first : E extended, F folded, N not extended
// (folded or half way : a thumb resting on the fingers), - anything.
type Need = 'E' | 'F' | 'N' | '-'
const PATTERN: Record<HandShapeId, readonly [Need, Need, Need, Need, Need]> = {
  fist: ['N', 'F', 'F', 'F', 'F'],
  open: ['E', 'E', 'E', 'E', 'E'],
  point: ['N', 'E', 'F', 'F', 'F'],
  peace: ['-', 'E', 'E', 'F', 'F'],
  thumbUp: ['E', 'F', 'F', 'F', 'F'],
  thumbDown: ['E', 'F', 'F', 'F', 'F'],
  ok: ['-', '-', 'E', 'E', 'E'],
  horns: ['-', 'E', 'F', 'F', 'E'],
  call: ['E', 'F', 'F', 'F', 'E'],
  gun: ['E', 'E', 'F', 'F', 'F']
}

// Curl thresholds at the middle sensitivity : a finger is extended below EXT and
// folded above FOLD; between them it is neither, and no shape that needs it
// either way holds. Sensitivity (0..1, higher = easier) narrows that gap by up
// to SENS_SPAN each side. Once a shape is held, each limit gives HYS more before
// it lets go (enter and exit thresholds), so a hand at a limit does not flicker.
const EXT = 0.36
const FOLD = 0.64
const THUMB_IN = 0.46 // the thumb's N : above this it is not out (tucked or resting)
const SENS_SPAN = 0.07
const HYS = 0.07
const THUMB_DIR = 0.5 // thumb up / down : |thumbUp| past this (about 60° from level)
const OK_PINCH = 0.7 // ok : thumb and index tips this close (pinch)
const OPEN_PINCH = 0.55 // open : … and no closer than this
const RELEASE_MS = 150 // a held shape lets go after not fitting this long

/** How well one shape fits, with its enter thresholds (give 0), or with some
 *  give (0..1 of the hysteresis : 1 for a held shape, half for one settling) :
 *  the smallest margin of all its conditions, > 0 when it fits. Margins are in
 *  curl units. */
export function shapeFit(id: HandShapeId, f: HandShapeFeatures, sens: number, give: number): number {
  const k = (Math.min(1, Math.max(0, sens)) - 0.5) * 2 // -1..1
  const slack = HYS * give
  const ext = EXT + SENS_SPAN * k + slack
  const fold = FOLD - SENS_SPAN * k - slack
  const notExt = THUMB_IN - SENS_SPAN * k * 0.5 - slack
  let m = Infinity
  const need = PATTERN[id]
  for (let i = 0; i < 5; i++) {
    const c = f.curl[i]
    const n = need[i]
    if (n === 'E') m = Math.min(m, ext - c)
    else if (n === 'F') m = Math.min(m, c - fold)
    else if (n === 'N') m = Math.min(m, c - notExt)
  }
  const s = slack * 2 // the extra conditions get the same give, scaled to their range
  if (id === 'thumbUp') m = Math.min(m, (f.thumbUp - (THUMB_DIR - s)) * 0.5)
  else if (id === 'thumbDown') m = Math.min(m, (-f.thumbUp - (THUMB_DIR - s)) * 0.5)
  else if (id === 'ok') m = Math.min(m, (f.pinch[0] - (OK_PINCH - 0.1 * k - s)) * 0.5)
  else if (id === 'open') m = Math.min(m, ((OPEN_PINCH + s) - f.pinch[0]) * 0.5)
  return m
}

/** One hand slot's held shape : fires once when a shape is entered and has held
 *  for the settle time, lets go when it no longer fits with the exit thresholds
 *  (or another shape takes over), then can fire again. */
export class ShapeReader {
  private held: HandShapeId | null = null
  private heldOffSince: number | null = null // when the held shape stopped fitting (null : it fits)
  private cand: HandShapeId | null = null
  private candSince = 0

  /** The shape held now (fired and not let go), or null. */
  current(): HandShapeId | null {
    return this.held
  }

  /** The hand is gone : forget everything (it fires again when it comes back). */
  reset(): void {
    this.held = null
    this.heldOffSince = null
    this.cand = null
    this.candSince = 0
  }

  /** One tracked frame : returns the shape that fired on it, or null.
   *  `now` in ms; `settleMs` how long a new shape must hold before it fires;
   *  `sens(id)` the sensitivity of that shape (0..1, higher = easier). */
  push(f: HandShapeFeatures, now: number, settleMs: number, sens: (id: HandShapeId) => number): HandShapeId | null {
    // The held shape lets go when it has not fitted, even with its give, for a
    // moment (a jittery frame or two do not make it fire again); a shape still
    // settling, when it no longer fits with half that give.
    if (this.held) {
      if (shapeFit(this.held, f, sens(this.held), 1) > 0) this.heldOffSince = null
      else if (this.heldOffSince === null) this.heldOffSince = now
      if (this.heldOffSince !== null && now - this.heldOffSince >= RELEASE_MS) { this.held = null; this.heldOffSince = null }
    }
    const candEnter = this.cand ? shapeFit(this.cand, f, sens(this.cand), 0) : 0
    if (this.cand && candEnter <= 0 && shapeFit(this.cand, f, sens(this.cand), 0.5) <= 0) this.cand = null
    // The best shape that fits with the enter thresholds takes over a settling
    // one only when that one fits by its give alone.
    let best: HandShapeId | null = null
    let bestM = 0
    for (const id of HAND_SHAPES) {
      const m = shapeFit(id, f, sens(id), 0)
      if (m > bestM) { bestM = m; best = id }
    }
    if (best && best !== this.cand && (!this.cand || candEnter <= 0)) {
      this.cand = best
      this.candSince = now
    }
    const c = this.cand
    if (c && c !== this.held && now - this.candSince >= settleMs) {
      this.held = c
      this.heldOffSince = null
      return c
    }
    return null
  }
}
