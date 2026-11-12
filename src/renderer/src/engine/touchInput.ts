// The touch points that Touch and Ripple share (engine/touchNode.ts,
// engine/rippleNode.ts) : everything that can lay a hand on the picture, gathered
// in one place and given in the effects' own FIELD space.
//
// - The pointer : the mouse on the preview and every pinching hand (the Body
//   page's pinch = click) arrive through pointerInput.ts as SourcePointer events,
//   one pointer id each, in the frame's uv (already mapped back through the
//   keystone, the output transform or the dome : engine/pointerMap.ts).
// - The Room's people (the Body page's Room tracker) : each one a point where
//   they stand (their box's middle, as Drape presses the cloth), mirrored as the
//   Body page shows them.
// - OSC : /opsia/touch x y [s] taps every Touch and Ripple, /opsia/touch/hold x y
//   holds a finger there, /opsia/touch/up lets it go (oscInput.ts -> touchBus).
// - The effect's own POINT (an XY pad, modulatable) held by its PRESS switch.
//
// The FIELD : flat, frame heights from the frame's center (x scaled by the aspect,
// so a circle is round); under full-dome fill, the dome's disc at half scale
// (Fong's square -> disc, the dome stage's own map, lib/dome.glsl) : radius 0.5 at
// the frame's rim, so the zenith is the middle and a ring stays round on the dome
// all the way down to the rim. Both measure about one frame height across.

import type { SourcePointer } from './nativeGenerators'
import { roomTracker, roomMirror } from './roomTracker'
import { audioBus } from './audioIn'
import { onSessionLoaded } from '../sessionEvents'

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)

/** A frame point (uv, v up) -> the field (see above). */
export function toField(u: number, v: number, dome: boolean, aspect: number): [number, number] {
  if (!dome) return [(u - 0.5) * aspect, v - 0.5]
  const sx = clamp(u * 2 - 1, -1, 1), sy = clamp(v * 2 - 1, -1, 1)
  return [0.5 * sx * Math.sqrt(1 - 0.5 * sy * sy), 0.5 * sy * Math.sqrt(1 - 0.5 * sx * sx)]
}

/** A random place on the picture, in the field : the frame (a margin kept) or,
 *  on the dome, the disc inside the horizon (`horizon` : its radius on the disc). */
export function randomField(dome: boolean, aspect: number, horizon: number): [number, number] {
  if (!dome) return [(Math.random() - 0.5) * 0.9 * aspect, (Math.random() - 0.5) * 0.9]
  const r = 0.5 * clamp(horizon, 0.3, 1) * 0.92 * Math.sqrt(Math.random())
  const a = Math.random() * Math.PI * 2
  return [r * Math.cos(a), r * Math.sin(a)]
}

/** Where a fired event lands : 0 the center (the zenith on the dome), 1 the
 *  effect's point, 2 somewhere at random. */
export function firePlace(at: number, point: number[] | undefined, dome: boolean, aspect: number, horizon: number): [number, number] {
  const k = Math.round(at)
  if (k === 1) {
    const p = Array.isArray(point) && point.length >= 2 ? point : [0.5, 0.5]
    return toField(clamp(p[0], 0, 1), clamp(p[1], 0, 1), dome, aspect)
  }
  if (k === 2) return randomField(dome, aspect, horizon)
  return [0, 0]
}

// ── OSC : one bus for every Touch and Ripple ─────────────────────────────

interface Tap { seq: number; u: number; v: number; s: number }

/** A held OSC finger lets go by itself when no /opsia/touch/hold came for this
 *  long (a controller that crashed, a release that is not mapped, the network). */
export const HOLD_TIMEOUT_MS = 3000

class TouchBus {
  private seq = 0
  private taps: Tap[] = []
  /** The held OSC finger (frame uv) and when it was last sent, null when let go. */
  private held: { u: number; v: number; at: number } | null = null

  /** A tap at (u, v) (0..1, v up), strength s (1 = as the effect's own). */
  tap(u: number, v: number, s = 1): void {
    this.taps.push({ seq: ++this.seq, u: clamp(u, 0, 1), v: clamp(v, 0, 1), s: clamp(s, 0, 4) })
    if (this.taps.length > 32) this.taps.splice(0, this.taps.length - 32)
  }
  holdAt(u: number, v: number, now = performance.now()): void {
    this.held = { u: clamp(u, 0, 1), v: clamp(v, 0, 1), at: now }
  }
  release(): void {
    this.held = null
  }
  /** The held OSC finger now (frame uv), null when let go or timed out. */
  hold(now = performance.now()): { u: number; v: number } | null {
    if (this.held && now - this.held.at > HOLD_TIMEOUT_MS) this.held = null
    return this.held
  }
  /** The taps after `seq` (a reader's last seen), and the newest seq. A new reader
   *  (seq < 0) starts from now : nothing old replays when an effect is added. */
  since(seq: number): { taps: Tap[]; seq: number } {
    if (seq < 0) return { taps: [], seq: this.seq }
    return { taps: seq >= this.seq ? [] : this.taps.filter((t) => t.seq > seq), seq: this.seq }
  }
}

export const touchBus = new TouchBus()
// a finger held in one session does not press on the next (New, Open, Generate)
onSessionLoaded(() => touchBus.release())

// ── The sound's hits ─────────────────────────────────────────────────────

/** A hit of the sound (an onset : the transient feature rising through 0.8, as
 *  Drape's pokes), and how loud the sound is then. */
export class Onset {
  private prev = 0
  hit(): number {
    const tr = audioBus.feature('transient')
    const h = tr > 0.8 && this.prev <= 0.8
    this.prev = tr
    return h ? clamp(0.5 + audioBus.feature('level'), 0.5, 1.5) : 0
  }
}

// ── The points ───────────────────────────────────────────────────────────

/** A point laid on the picture this frame (field units). */
export interface TouchPoint {
  key: number
  x: number
  y: number
  /** where it was last frame (its motion this frame is (x - px, y - py)) */
  px: number
  py: number
  /** it went down this frame (a tap, a person arriving) */
  fresh: boolean
  /** how much it presses, 0..1 (the people amount for the Room) */
  w: number
}

interface Track { u: number; v: number; down: boolean; fresh: boolean; x: number; y: number; px: number; py: number; seen: boolean; w: number; ending: boolean }

const OSC_KEY = 1000
const POINT_KEY = 1001
const GHOST_KEY = 1002
const ROOM_KEY = 2000

export interface TouchExtras {
  /** the Room's people, how much they press (0 : not read) */
  people: number
  /** the effect's own point (uv) and whether it is held down */
  point: number[] | undefined
  press: boolean
  /** a hand of its own (BY ITSELF) : where it is now (uv) and how hard it presses */
  ghost?: [number, number, number] | null
}

/** Where the effect's own hand wanders (BY ITSELF) at `t` seconds : a slow,
 *  never-repeating path over the middle of the picture (uv). */
export function wanderAt(t: number): [number, number] {
  return [
    0.5 + 0.3 * Math.sin(0.21 * t + 1.3) + 0.08 * Math.sin(0.67 * t + 0.2),
    0.5 + 0.27 * Math.sin(0.17 * t) + 0.08 * Math.cos(0.53 * t + 0.4)
  ]
}

/** One effect's points : the pointers it was handed, the OSC finger, its own
 *  point, the Room's people, each followed by a smoothed place (FOLLOW : 1 right
 *  under the hand, lower trails behind it like something elastic). */
export class TouchPoints {
  private tracks = new Map<number, Track>()
  private pending: SourcePointer[] = []

  /** A pointer event (the mouse, a hand), applied at the next step. */
  pointer(ev: SourcePointer): void {
    this.pending.push(ev)
    if (this.pending.length > 128) this.pending.splice(0, this.pending.length - 128)
  }

  /** Drop every point (a cleared effect still follows a hand that is down). */
  reset(): void {
    for (const [k, t] of this.tracks) if (!t.down) this.tracks.delete(k)
  }

  private set(key: number, u: number, v: number, down: boolean, w: number, dome: boolean, aspect: number): void {
    let t = this.tracks.get(key)
    if (!t) {
      const [x, y] = toField(u, v, dome, aspect)
      t = { u, v, down: false, fresh: false, x, y, px: x, py: y, seen: true, w, ending: false }
      this.tracks.set(key, t)
    }
    // pressed again (a double click, a press right after a sub-frame click) : the
    // last one's ending no longer applies, or the held press would end every frame
    if (down) t.ending = false
    if (down && !t.down) {
      // a new touch starts right where it lands : no glide from the last one
      const [x, y] = toField(u, v, dome, aspect)
      t.x = t.px = x
      t.y = t.py = y
      t.fresh = true
    }
    t.u = u
    t.v = v
    t.down = down
    t.w = w
    t.seen = true
  }

  /** This frame's points. `dt` seconds of the rack's clock. */
  step(dt: number, follow: number, dome: boolean, aspect: number, ex: TouchExtras): TouchPoint[] {
    for (const t of this.tracks.values()) { t.seen = false; t.fresh = false }
    // the pointers (kept down until they let go)
    for (const ev of this.pending.splice(0)) {
      if (ev.phase === 'up' || ev.phase === 'cancel') {
        const t = this.tracks.get(ev.pid)
        // (a click quicker than a frame still lands : it lives for this frame)
        if (t) { if (t.fresh) t.ending = true; else t.down = false }
        continue
      }
      this.set(ev.pid, ev.u, ev.v, true, 1, dome, aspect)
    }
    for (const [k, t] of this.tracks) if (k < OSC_KEY && t.down) t.seen = true
    // the OSC finger, the effect's own point
    const h = touchBus.hold()
    if (h) this.set(OSC_KEY, h.u, h.v, true, 1, dome, aspect)
    if (ex.ghost && ex.ghost[2] > 0) this.set(GHOST_KEY, clamp(ex.ghost[0], 0, 1), clamp(ex.ghost[1], 0, 1), true, clamp(ex.ghost[2], 0, 1), dome, aspect)
    if (ex.press && Array.isArray(ex.point) && ex.point.length >= 2) this.set(POINT_KEY, clamp(ex.point[0], 0, 1), clamp(ex.point[1], 0, 1), true, 1, dome, aspect)
    // the Room's people, where they stand (as the Body page mirrors them)
    if (ex.people > 0 && roomTracker.running()) {
      const mir = roomMirror()
      for (const p of roomTracker.list()) {
        let cx = (p.box[0] + p.box[2]) / 2
        if (mir) cx = 1 - cx
        const cy = 1 - (p.box[1] + p.box[3]) / 2
        this.set(ROOM_KEY + p.id, clamp(cx, 0, 1), clamp(cy, 0, 1), true, clamp(ex.people, 0, 1), dome, aspect)
      }
    }
    // gone : a pointer let go, the OSC finger released, a person left
    for (const [k, t] of this.tracks) {
      if (!t.seen || !t.down) this.tracks.delete(k)
    }
    // follow : 1 snaps under the hand, lower glides after it (frame-rate free)
    const f = clamp(follow, 0, 1)
    const a = f >= 0.995 ? 1 : 1 - Math.exp(-Math.max(0, dt) * (1.2 + 38 * f * f))
    const out: TouchPoint[] = []
    for (const [key, t] of this.tracks) {
      const [tx, ty] = toField(t.u, t.v, dome, aspect)
      t.px = t.x
      t.py = t.y
      if (!t.fresh) {
        t.x += (tx - t.x) * a
        t.y += (ty - t.y) * a
      }
      out.push({ key, x: t.x, y: t.y, px: t.px, py: t.py, fresh: t.fresh, w: t.w })
      if (t.ending) t.down = false
    }
    return out
  }
}
