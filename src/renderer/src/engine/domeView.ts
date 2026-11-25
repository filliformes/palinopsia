// The dome viewer's head : where you stand in the room, where you look, and the
// plain arithmetic the viewer draws and reads from. Nothing here touches WebGL or
// the DOM (components/DomeSim.tsx draws, components/DomeViewer.tsx takes the
// hands), so all of it runs in a plain test.
//
// The room is in METERS : the floor at y = 0, the sphere's center at (0, cy, 0),
// the front at -z, the audience's right at +x (the direction convention of
// engine/dome.ts). Your place is this computer's, never the piece's : walking
// around must not ask to save the session.
//
// Walking and flying through a dome at its real size, with a height lock, running
// and a gamepad, is the idea of a fulldome viewer made at the SAT; every line
// here is Palinopsia's own.
// third-party: DomeportPro (ideas and measured facts only, no code)

import type { DomeConfig, DomeRoom } from '@shared/dome'

export type DomeMove = 'walk' | 'fly'
export type DomeSeat = 'best' | 'center' | 'back' | 'side' | 'lying'
export const DOME_EYES = { standing: 1.65, seated: 1.2, lying: 0.35 } as const
export type DomePosture = keyof typeof DOME_EYES

/** One head, shared by every place the viewer shows (the Output page, its own
 *  window), so moving it from one to the other keeps the view. */
export interface DomeCam {
  yaw: number // 0 = the front, + = to the audience's right
  pitch: number // 0 = the horizon, + = up
  dist: number // outside view : radii from the center
  x: number
  y: number
  z: number
  eye: number // the eye's height over the floor while walking, meters
  move: DomeMove
  /** On the sphere's center, the one point the master is made for. Any step off
   *  it takes you down to the floor (walking). */
  best: boolean
}

const KEY = 'opsia.domeSeat'
const fin = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb)
function loadCam(): DomeCam {
  const d: DomeCam = { yaw: 0, pitch: 0.45, dist: 2.6, x: 0, y: 0, z: 0, eye: DOME_EYES.standing, move: 'walk', best: true }
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DomeCam> | null
    if (!r) return d
    return {
      ...d,
      x: fin(r.x, 0), y: fin(r.y, 0), z: fin(r.z, 0),
      eye: Math.max(0.1, Math.min(2.2, fin(r.eye, d.eye))),
      move: r.move === 'fly' ? 'fly' : 'walk',
      best: r.best !== false
    }
  } catch {
    return d
  }
}
export const domeCam: DomeCam = loadCam()
export function saveDomeCam(): void {
  try {
    const { x, y, z, eye, move, best } = domeCam
    localStorage.setItem(KEY, JSON.stringify({ x, y, z, eye, move, best }))
  } catch {
    /* not remembered */
  }
}

/** The engine's side : `serial` moves once a rendered domemaster is on the
 *  canvas; `spin` is the mapping's spin as it plays, degrees a second. */
export const domeFrame = { serial: 0, spin: 0 }

const CLEAR = 0.4 // how near the screen a head may come, meters

/** How far from the middle of the room a head at height y may go. */
export function domeReach(room: DomeRoom, y: number): number {
  const cross = Math.sqrt(Math.max(0, room.R * room.R - (y - room.cy) * (y - room.cy)))
  const past = room.halfAp > Math.PI / 2
  // the floor ends under the rim; over the rim, at the screen itself
  const r = y >= room.rimY ? Math.min(cross, past ? room.rimR : room.R) : room.rimR
  return Math.max(0.3, r - CLEAR)
}

/** Keep the head inside the room. */
export function keepInside(cam: DomeCam, room: DomeRoom): void {
  if (cam.best) {
    cam.x = 0
    cam.z = 0
    cam.y = room.cy
    return
  }
  cam.y = Math.max(0.1, Math.min(Math.max(0.2, room.cy + room.R - CLEAR), cam.y))
  const lim = domeReach(room, cam.y)
  const h = Math.hypot(cam.x, cam.z)
  if (h > lim) {
    cam.x *= lim / h
    cam.z *= lim / h
  }
}

export interface DomeInput { fwd: number; side: number; up: number; yaw: number; pitch: number; run: boolean }

/** One step of walking or flying, dt seconds. True while something moves. */
export function stepDomeCam(cam: DomeCam, room: DomeRoom, inp: DomeInput, dt: number): boolean {
  const moving = inp.fwd !== 0 || inp.side !== 0 || (cam.move === 'fly' && inp.up !== 0)
  const turning = inp.yaw !== 0 || inp.pitch !== 0
  if (turning) {
    cam.yaw += inp.yaw * dt
    cam.pitch = clampPitch(cam.pitch + inp.pitch * dt)
  }
  if (moving) {
    if (cam.best) { cam.best = false; cam.y = room.cy }
    const l = Math.max(1, Math.hypot(inp.fwd, inp.side))
    const v = (cam.move === 'fly' ? (inp.run ? 10 : 3) : inp.run ? 4.2 : 1.4) * dt
    const f = (inp.fwd / l) * v, s = (inp.side / l) * v
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw)
    if (cam.move === 'fly') {
      const cp = Math.cos(cam.pitch)
      cam.x += cp * sy * f + cy * s
      cam.y += Math.sin(cam.pitch) * f + inp.up * v
      cam.z += -cp * cy * f + sy * s
    } else {
      cam.x += sy * f + cy * s
      cam.z += -cy * f + sy * s
    }
  }
  let sinking = false
  if (!cam.best && cam.move === 'walk' && cam.y !== cam.eye) {
    // down (or up) to the eye's height in about a third of a second
    cam.y += (cam.eye - cam.y) * (1 - Math.exp(-dt * 9))
    if (Math.abs(cam.y - cam.eye) < 0.002) cam.y = cam.eye
    sinking = true
  }
  keepInside(cam, room)
  return moving || turning || sinking
}

export function clampPitch(p: number): number {
  return Math.max(-1.45, Math.min(1.53, p))
}

/** Jump to a place in the room. */
export function seatDomeCam(cam: DomeCam, room: DomeRoom, seat: DomeSeat): void {
  cam.best = seat === 'best'
  cam.x = 0
  cam.z = 0
  cam.yaw = 0
  cam.pitch = 0.45
  if (seat === 'best') { cam.y = room.cy; return }
  cam.move = 'walk'
  // (stood up again after lying down)
  if (seat === 'lying') { cam.eye = DOME_EYES.lying; cam.pitch = 1.5 }
  else if (cam.eye < 0.6) cam.eye = DOME_EYES.standing
  cam.y = cam.eye
  const far = domeReach(room, cam.eye) * 0.85
  if (seat === 'back') cam.z = far
  if (seat === 'side') cam.x = far
  keepInside(cam, room)
}

export type Vec3 = [number, number, number]
export function lookDir(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch)
  return [cp * Math.sin(yaw), Math.sin(pitch), -cp * Math.cos(yaw)]
}

/** Where a look from `eye` along `dir` meets the screen : the direction seen
 *  from the sphere's center (angle from the zenith, azimuth), how far it is in
 *  meters, and whether that is past the rim (no screen there). */
export function domeHit(room: DomeRoom, tiltDeg: number, eye: Vec3, dir: Vec3): { theta: number; az: number; dist: number; off: boolean } | null {
  const ex = eye[0], ey = eye[1] - room.cy, ez = eye[2]
  const b = ex * dir[0] + ey * dir[1] + ez * dir[2]
  const c = ex * ex + ey * ey + ez * ez - room.R * room.R
  const disc = b * b - c
  if (disc < 0) return null
  const t = -b + Math.sqrt(disc) // the far side : the inner face
  if (t <= 0) return null
  const px = ex + dir[0] * t, py = ey + dir[1] * t, pz = ez + dir[2] * t
  const a = (tiltDeg * Math.PI) / 180
  const ca = Math.cos(a), sa = Math.sin(a)
  const y = (ca * py + sa * pz) / room.R, z = (-sa * py + ca * pz) / room.R, x = px / room.R
  const theta = Math.acos(Math.max(-1, Math.min(1, y)))
  return { theta, az: Math.atan2(x, -z), dist: t, off: theta > room.halfAp + 1e-6 }
}

/** The picture's sharpness where you look : master pixels per degree of YOUR
 *  view, sideways and up. From the center it is (4096 / 210) = 19.5 up and down;
 *  nearer the screen it falls, for the same pixels fill more of your view. */
export function domeDensity(
  room: DomeRoom, cfg: Pick<DomeConfig, 'aperture' | 'res'>, tiltDeg: number, eye: Vec3, yaw: number, pitch: number
): { h: number; v: number } | null {
  const mHalf = (cfg.aperture * Math.PI) / 360
  const d = lookDir(yaw, pitch)
  const r: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)]
  const u: Vec3 = [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]]
  const at = (off: Vec3, k: number): [number, number] | null => {
    const q: Vec3 = [d[0] + off[0] * k, d[1] + off[1] * k, d[2] + off[2] * k]
    const l = Math.hypot(...q)
    const h = domeHit(room, tiltDeg, eye, [q[0] / l, q[1] / l, q[2] / l])
    if (!h) return null
    const rr = (h.theta / mHalf) * 0.5 * cfg.res
    return [rr * Math.sin(h.az), -rr * Math.cos(h.az)]
  }
  const half = Math.tan((0.25 * Math.PI) / 180)
  const px = (off: Vec3): number | null => {
    const a = at(off, -half), b = at(off, half)
    return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5 : null
  }
  const h = px(r), v = px(u)
  return h === null || v === null ? null : { h, v }
}

// ── how often the viewer may take the picture ───────────────────────────
/** Never slow the show : the viewer takes every frame, every second, fourth or
 *  eighth one, and gives way as soon as the render loop runs slower than it did.
 *  No display rate is assumed : the loop is judged against its own best of the
 *  last half minute (each figure a mean of three seconds : a heavy scene's rate
 *  wanders by itself; a frame the loop had to skip is already missing from it). A
 *  step up is a trial : the loop loses more than 2 % and it goes back, waiting
 *  twice as long before the next one. */
export class ViewerGovernor {
  level = 1 // one frame in 2^level is taken
  private last: number[] = []
  private best: number[] = []
  private settle = 3
  private hold = 1
  private wait = 4
  private trial = -1
  /** Once a second : the loop's frame rate and what a take costs this thread (ms). */
  tick(fps: number, takeMs: number): void {
    this.last.push(fps)
    if (this.last.length > 3) this.last.shift()
    const now = this.last.reduce((a, b) => a + b, 0) / this.last.length
    if (this.last.length === 3) this.best.push(now)
    if (this.best.length > 30) this.best.shift()
    if (this.settle > 0) { this.settle--; return }
    if (this.trial > 0) {
      if (now < this.trial * 0.98) {
        this.down()
        this.wait = Math.min(64, this.wait * 2)
        this.hold = this.wait
      }
      this.trial = -1
      return
    }
    const ref = Math.max(now, ...this.best)
    if (this.level < 3 && (now < ref * 0.92 || takeMs > 4)) {
      this.down()
      this.hold = this.wait
      return
    }
    if (this.level > 0 && takeMs <= 2 && --this.hold <= 0) {
      this.trial = now
      this.level--
      this.settle = 3
      this.hold = this.wait
    }
  }
  private down(): void {
    if (this.level < 3) this.level++
    this.settle = 3
  }
  every(): number {
    return 1 << this.level
  }
}

// ── how fast the picture turns around you ───────────────────────────────
export const STRIP_W = 256
export const STRIP_H = 8

/** The turning speed around the zenith, read off the picture itself : two
 *  unwrapped strips of the dome (azimuth across, a few elevations down) taken
 *  about 0.2 s apart are slid over each other until they agree best. */
export class RotationMeter {
  private ring: Array<{ t: number; v: Float32Array; norm: number }> = []
  private last: number[] = []
  /** Degrees a second (+ = to the audience's right), null when the picture has
   *  nothing to follow or changes too much between the two. */
  value: number | null = null
  reset(): void {
    this.ring = []
    this.last = []
    this.value = null
  }
  /** RGBA8 rows, STRIP_W x STRIP_H, at time t (ms). */
  push(px: Uint8Array, t: number): void {
    const v = new Float32Array(STRIP_W * STRIP_H)
    let norm = 0
    for (let r = 0; r < STRIP_H; r++) {
      let m = 0
      for (let i = 0; i < STRIP_W; i++) {
        const k = (r * STRIP_W + i) * 4
        const l = 0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2]
        v[r * STRIP_W + i] = l
        m += l
      }
      m /= STRIP_W
      for (let i = 0; i < STRIP_W; i++) {
        const k = r * STRIP_W + i
        v[k] -= m
        norm += v[k] * v[k]
      }
    }
    const now = { t, v, norm: Math.sqrt(norm) }
    while (this.ring.length && t - this.ring[0].t > 600) this.ring.shift()
    const ref = [...this.ring].reverse().find((e) => t - e.t >= 180)
    this.ring.push(now)
    if (!ref) return
    const d = this.slide(ref, now)
    if (d === null) {
      this.last = []
      this.value = null
      return
    }
    this.last.push((d * 360) / STRIP_W / ((t - ref.t) / 1000))
    if (this.last.length > 5) this.last.shift()
    this.value = [...this.last].sort((a, b) => a - b)[this.last.length >> 1]
  }
  private slide(a: { v: Float32Array; norm: number }, b: { v: Float32Array; norm: number }): number | null {
    // under about 2 levels of contrast there is nothing to follow
    if (a.norm < 90 || b.norm < 90) return null
    const MAX = 64
    const score = new Float32Array(MAX * 2 + 1)
    for (let s = -MAX; s <= MAX; s++) {
      let sum = 0
      for (let r = 0; r < STRIP_H; r++) {
        const o = r * STRIP_W
        for (let i = 0; i < STRIP_W; i++) sum += a.v[o + i] * b.v[o + ((i + s + STRIP_W) & (STRIP_W - 1))]
      }
      score[s + MAX] = sum / (a.norm * b.norm)
    }
    // a picture that repeats around the room agrees at several slides : the
    // smallest one is the likely one
    let best = 0
    let bv = -2
    for (let k = 0; k < score.length; k++) {
      const w = score[k] - (0.03 * Math.abs(k - MAX)) / MAX
      if (w > bv) { bv = w; best = k }
    }
    if (score[best] < 0.6) return null
    let f = 0
    if (best > 0 && best < score.length - 1) {
      const l = score[best - 1], c = score[best], r = score[best + 1]
      const q = l - 2 * c + r
      if (q < -1e-9) f = Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / q))
    }
    return best - MAX + f
  }
}
