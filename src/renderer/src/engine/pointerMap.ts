// Where a point of the preview shows the frame from : the displayed canvas
// (the keystone, the output transform, or the domemaster) mapped back to the
// frame's own uv, so a click lands on the picture under the cursor. Each step is
// the very lookup its stage draws with (dome.ts's master pixel → picture, the
// output transform's inverse, the keystone's inverse), so it holds in every
// mode. The other way (a hand's point → the preview, for its cursor) is solved
// from the same function.

import type { DomeConfig } from '@shared/dome'
import type { OutXform } from '@shared/outXform'
import { warpLookup } from './warpQuad'

export interface DisplayState {
  aspect: number // the frame's width / height
  dome: DomeConfig | null
  domeRot: number // the dome's azimuth turn now (rotate + spin), radians
  outX: OutXform | null // null : identity
  outXSpin: number // degrees spun so far
  warp: number[] | null // keystone corners (TL, TR, BR, BL; top-left origin), null : off
}

const rad = (d: number): number => (d * Math.PI) / 180

// Fong's disc → square (dome.ts discToSquare).
function discToSquare(x: number, y: number): [number, number] {
  const u2 = x * x, v2 = y * y, t = 2 * Math.SQRT2
  const a = 0.5 * Math.sqrt(Math.max(0, 2 + u2 - v2 + t * x)) - 0.5 * Math.sqrt(Math.max(0, 2 + u2 - v2 - t * x))
  const b = 0.5 * Math.sqrt(Math.max(0, 2 - u2 + v2 + t * y)) - 0.5 * Math.sqrt(Math.max(0, 2 - u2 + v2 - t * y))
  return [Math.max(-1, Math.min(1, a)), Math.max(-1, Math.min(1, b))]
}

// z → (z - a) / (1 - conj(a)·z) (dome.ts discShift).
function discShift(zx: number, zy: number, ax: number, ay: number): [number, number] {
  const nx = zx - ax, ny = zy - ay
  const dx = 1 - (ax * zx + ay * zy), dy = -(ax * zy - ay * zx)
  const q = Math.max(dx * dx + dy * dy, 1e-6)
  return [(nx * dx + ny * dy) / q, (ny * dx - nx * dy) / q]
}

type V3 = [number, number, number]
const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
const norm = (p: V3): V3 => {
  const l = Math.hypot(p[0], p[1], p[2]) || 1
  return [p[0] / l, p[1] / l, p[2] / l]
}

/** A domemaster point (uv, v up) → the frame's uv, or null (outside the dome, or
 *  where no picture is : under a panorama, beside a screen). */
export function domeToFrame(mu: number, mv: number, cfg: DomeConfig, rot: number, aspect: number): [number, number] | null {
  let qx = mu * 2 - 1
  const qy = mv * 2 - 1
  if (cfg.flipX) qx = -qx
  const r = Math.hypot(qx, qy)
  if (r > 1) return null
  const halfAp = rad(cfg.aperture) / 2
  const theta = r * halfAp
  const az = Math.atan2(qx, -qy)
  const el = Math.PI / 2 - theta
  const c = Math.cos(rot), s = Math.sin(rot)
  if (cfg.mode === 'fisheye') {
    const zx = (c * qx - s * qy) / cfg.scale, zy = (s * qx + c * qy) / cfg.scale
    if (cfg.fit === 'fill') {
      if (Math.hypot(zx, zy) > 1) return null
      const ox = Math.max(-1, Math.min(1, cfg.offsetX)), oy = Math.max(-1, Math.min(1, cfg.offsetY))
      const ax = 0.9 * ox * Math.sqrt(1 - 0.5 * oy * oy), ay = 0.9 * oy * Math.sqrt(1 - 0.5 * ox * ox)
      const [sx, sy] = discShift(zx, zy, ax, ay)
      const [px, py] = discToSquare(sx, sy)
      return [px * 0.5 + 0.5, py * 0.5 + 0.5]
    }
    const qqx = zx - cfg.offsetX, qqy = zy - cfg.offsetY
    const k = Math.sqrt(1 + aspect * aspect)
    const p: [number, number] = cfg.fit === 'cover'
      ? [(qqx / aspect) * 0.5 + 0.5, qqy * 0.5 + 0.5]
      : [((qqx * k) / aspect) * 0.5 + 0.5, qqy * k * 0.5 + 0.5]
    return p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1 ? p : null
  }
  if (cfg.mode === 'wrap') {
    const u = ((az - rot) / (2 * Math.PI)) * cfg.turns + 0.5
    const k = Math.floor(u)
    let fu = u - k
    if (cfg.mirrorSeams && ((k % 2) + 2) % 2 === 1) fu = 1 - fu
    const top = rad(Math.max(cfg.top, cfg.bottom + 1)), bottom = rad(cfg.bottom)
    const v = (el - bottom) / Math.max(top - bottom, 1e-4)
    if (v < 0 || (v > 1 && cfg.cap === 'black')) return null
    return [fu, Math.min(1, v)]
  }
  // screen : the virtual flat screen hung on the dome (dome.ts's basis)
  const a = rad(cfg.azimuth) + rot
  const e = rad(cfg.elevation)
  const C: V3 = [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)]
  const upRef: V3 = Math.abs(C[1]) > 0.995 ? [Math.sin(a), 0, -Math.cos(a)] : [0, 1, 0]
  let R = norm(cross(C, upRef))
  let U = norm(cross(R, C))
  const ro = rad(cfg.roll)
  if (ro !== 0) {
    const cr = Math.cos(ro), sr = Math.sin(ro)
    const R2: V3 = [R[0] * cr + U[0] * sr, R[1] * cr + U[1] * sr, R[2] * cr + U[2] * sr]
    const U2: V3 = [U[0] * cr - R[0] * sr, U[1] * cr - R[1] * sr, U[2] * cr - R[2] * sr]
    R = R2
    U = U2
  }
  const D: V3 = [Math.sin(theta) * Math.sin(az), Math.cos(theta), -Math.sin(theta) * Math.cos(az)]
  const sd = D[0] * C[0] + D[1] * C[1] + D[2] * C[2]
  if (sd <= 1e-4) return null
  const hw = Math.tan(rad(Math.min(170, cfg.width)) / 2)
  const hh = hw / Math.max(0.1, aspect)
  const tx = D[0] / sd, ty = D[1] / sd, tz = D[2] / sd
  const sx = (tx * R[0] + ty * R[1] + tz * R[2]) / hw
  const sy = (tx * U[0] + ty * U[1] + tz * U[2]) / hh
  if (Math.max(Math.abs(sx), Math.abs(sy)) >= 1) return null
  return [sx * 0.5 + 0.5, sy * 0.5 + 0.5]
}

/** The output transform's lookup (outXform.ts) : a shown point → the frame. */
function outLookup(u: number, v: number, o: OutXform, spinDeg: number, aspect: number): [number, number] | null {
  let qx = (u - 0.5) * aspect - o.offsetX * aspect
  let qy = v - 0.5 - o.offsetY
  const r = rad(o.rotate + spinDeg)
  const c = Math.cos(r), s = Math.sin(r)
  const rx = c * qx + s * qy
  const ry = -s * qx + c * qy
  const sc = Math.max(1e-3, o.scale)
  qx = (rx / sc) * (o.flipX ? -1 : 1)
  qy = (ry / sc) * (o.flipY ? -1 : 1)
  let tx = qx / aspect + 0.5
  let ty = qy + 0.5
  if (o.edge === 'repeat') {
    tx -= Math.floor(tx)
    ty -= Math.floor(ty)
  } else if (o.edge === 'mirror') {
    tx = 1 - Math.abs((((tx % 2) + 2) % 2) - 1)
    ty = 1 - Math.abs((((ty % 2) + 2) % 2) - 1)
  } else if (tx < 0 || tx > 1 || ty < 0 || ty > 1) return null
  return [tx, ty]
}

/** A point of the shown canvas (0..1 of its picture, top-left origin) → the
 *  frame's uv (v up), or null where the picture is not. */
export function displayToFrame(nx: number, ny: number, st: DisplayState): [number, number] | null {
  if (st.dome) return domeToFrame(nx, 1 - ny, st.dome, st.domeRot, st.aspect)
  let u = nx
  let v = 1 - ny
  if (st.warp) {
    const p = warpLookup(st.warp, nx, ny)
    if (!p) return null
    u = p[0]
    v = p[1]
    if (u < 0 || u > 1 || v < 0 || v > 1) return null
  }
  if (st.outX) return outLookup(u, v, st.outX, st.outXSpin, st.aspect)
  return [u, v]
}

/** The frame's uv → where it shows on the canvas (0..1, top-left origin), or
 *  null when it shows nowhere. Solved from displayToFrame : a coarse search,
 *  then a few Newton steps (two hand cursors a frame : cheap). */
export function frameToDisplay(u: number, v: number, st: DisplayState): [number, number] | null {
  if (!st.dome && !st.warp && !st.outX) return [u, 1 - v]
  const err = (x: number, y: number): number => {
    const p = displayToFrame(x, y, st)
    return p ? Math.hypot(p[0] - u, p[1] - v) : Infinity
  }
  let bx = 0.5
  let by = 0.5
  let be = Infinity
  const N = 40
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const e = err(i / N, j / N)
      if (e < be) { be = e; bx = i / N; by = j / N }
    }
  }
  if (!Number.isFinite(be)) return null
  for (let it = 0; it < 12 && be > 1e-5; it++) {
    const h = 1e-4
    const p = displayToFrame(bx, by, st)
    const px = displayToFrame(bx + h, by, st)
    const py = displayToFrame(bx, by + h, st)
    if (!p || !px || !py) break
    const a = (px[0] - p[0]) / h, b = (py[0] - p[0]) / h, c = (px[1] - p[1]) / h, d = (py[1] - p[1]) / h
    const det = a * d - b * c
    if (Math.abs(det) < 1e-12) break
    const ex = u - p[0], ey = v - p[1]
    const nx = bx + (d * ex - b * ey) / det
    const ny = by + (-c * ex + a * ey) / det
    const ne = err(nx, ny)
    if (!(ne < be)) break
    bx = nx
    by = ny
    be = ne
  }
  return be < 0.01 ? [bx, by] : null
}
