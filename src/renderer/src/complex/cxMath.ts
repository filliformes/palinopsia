// Complex Output : the geometry. Pure functions, no DOM, no GL (tested in node by
// tools/cx-test.ts).
//
// A warp is a map from the slice's own square (s, t in 0..1, t down) to the screen
// (x, y in 0..1, y down) :
//   corners  the projective map of the square onto four points (Heckbert 1989)
//   grid     bilinear cells
//   curve    a tensor-product Catmull-Rom surface through the points
//   bezier   bicubic Bezier patches sharing their edges
//   poly     the outline's points pinned one for one, between them by mean value
//            coordinates (Hormann & Floater 2006)
// Soft edges are Bourke's blend (2004), on top of Raskar, Welch & Fuchs (1998).

// third-party: Complex Output's mapping math (published methods, named in part 6)

import type { CxEdges, CxMask, CxSlice, CxWarp, CxWarpType } from '@shared/complexOut'

export type M3 = number[] // row-major

// ── Projective maps ─────────────────────────────────────────────────────
/** The unit square (s right, t down) onto TL TR BR BL (x, y pairs). */
export function squareToQuad(p: ArrayLike<number>): M3 {
  const x0 = p[0], y0 = p[1], x1 = p[2], y1 = p[3], x2 = p[4], y2 = p[5], x3 = p[6], y3 = p[7]
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1]
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2
  const den = dx1 * dy2 - dx2 * dy1
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1]
}
export function mul3(a: M3, b: M3): M3 {
  const o = new Array<number>(9)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return o
}
export function inv3(m: M3): M3 | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) return null
  const k = 1 / det
  return [A * k, (c * h - b * i) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, (c * d - a * f) * k, C * k, (b * g - a * h) * k, (a * e - b * d) * k]
}
export function apply3(m: M3, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]
}
/** The square's denominators at its corners all on one side : the map is sound. */
export function quadSound(p: ArrayLike<number>): boolean {
  const m = squareToQuad(p)
  if (!m.every(Number.isFinite)) return false
  const w = [m[8], m[6] + m[8], m[6] + m[7] + m[8], m[7] + m[8]]
  return Math.min(...w) > 1e-6 && Math.abs(m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])) > 1e-12
}
/** The projective map of one quad onto another. */
export function quadToQuad(a: ArrayLike<number>, b: ArrayLike<number>): M3 | null {
  const ia = inv3(squareToQuad(a))
  return ia ? mul3(squareToQuad(b), ia) : null
}

// ── Evaluating a warp ───────────────────────────────────────────────────
const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

function crWeights(u: number): [number, number, number, number] {
  const u2 = u * u, u3 = u2 * u
  return [-0.5 * u + u2 - 0.5 * u3, 1 - 2.5 * u2 + 1.5 * u3, 0.5 * u + 2 * u2 - 1.5 * u3, -0.5 * u2 + 0.5 * u3]
}
function bzWeights(u: number): [number, number, number, number] {
  const v = 1 - u
  return [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u]
}

/** Where (s, t) lands on the screen. Outside 0..1 the map goes on past its edge
 *  (the anti-aliased rim is drawn from there). */
export function evalWarp(w: CxWarp, s: number, t: number): [number, number] {
  const P = w.pts
  if (w.type === 'corners') {
    if (quadSound(P)) return apply3(squareToQuad(P), s, t)
    const a = (1 - s) * (1 - t), b = s * (1 - t), c = s * t, d = (1 - s) * t
    return [a * P[0] + b * P[2] + c * P[4] + d * P[6], a * P[1] + b * P[3] + c * P[5] + d * P[7]]
  }
  if (w.type === 'poly') {
    const b = bounds(P)
    return [b.x + s * b.w, b.y + t * b.h]
  }
  const ci = clampInt(Math.floor(s * w.cols), 0, w.cols - 1), ri = clampInt(Math.floor(t * w.rows), 0, w.rows - 1)
  const u = s * w.cols - ci, v = t * w.rows - ri
  if (w.type === 'grid') {
    const n = w.cols + 1, i = (ri * n + ci) * 2, j = i + n * 2
    const a = (1 - u) * (1 - v), b = u * (1 - v), c = (1 - u) * v, d = u * v
    return [a * P[i] + b * P[i + 2] + c * P[j] + d * P[j + 2], a * P[i + 1] + b * P[i + 3] + c * P[j + 1] + d * P[j + 3]]
  }
  if (w.type === 'curve') {
    const n = w.cols + 1
    const wu = crWeights(u), wv = crWeights(v)
    // past the edge the surface goes on straight (a point mirrored through the
    // edge) : one cell is then a plain bilinear one
    const at = (r: number, c: number, k: number): number => {
      const col = (rr: number, cc: number): number =>
        cc < 0 ? 2 * P[rr * n * 2 + k] - P[(rr * n + 1) * 2 + k] : cc > w.cols ? 2 * P[(rr * n + w.cols) * 2 + k] - P[(rr * n + w.cols - 1) * 2 + k] : P[(rr * n + cc) * 2 + k]
      return r < 0 ? 2 * col(0, c) - col(1, c) : r > w.rows ? 2 * col(w.rows, c) - col(w.rows - 1, c) : col(r, c)
    }
    let x = 0, y = 0
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      const k = wv[a] * wu[b]
      x += k * at(ri + a - 1, ci + b - 1, 0)
      y += k * at(ri + a - 1, ci + b - 1, 1)
    }
    return [x, y]
  }
  const n = 3 * w.cols + 1
  const wu = bzWeights(u), wv = bzWeights(v)
  let x = 0, y = 0
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    const k = wv[a] * wu[b], i = ((ri * 3 + a) * n + ci * 3 + b) * 2
    x += k * P[i]
    y += k * P[i + 1]
  }
  return [x, y]
}

// ── Changing a warp's kind or its number of cells ───────────────────────
/** The same shape, held by another kind of warp or another number of cells. */
export function resampleWarp(w: CxWarp, type: CxWarpType, cols: number, rows: number): CxWarp {
  if (type === 'poly' || w.type === 'poly') return w
  if (type === 'corners') {
    const c = [evalWarp(w, 0, 0), evalWarp(w, 1, 0), evalWarp(w, 1, 1), evalWarp(w, 0, 1)]
    return { type, cols: 1, rows: 1, pts: c.flat() }
  }
  const out: number[] = []
  if (type !== 'bezier') {
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) out.push(...evalWarp(w, c / cols, r / rows))
    return { type, cols, rows, pts: out }
  }
  // each patch from its corners' positions, slopes and twists, read from inside
  // the patch (a grid's creases stay where they are)
  const n = 3 * cols + 1, m = 3 * rows + 1
  const net = new Array<number>(n * m * 2).fill(0)
  const H = 1e-3
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const f = (u: number, v: number): [number, number] => evalWarp(w, (c + Math.min(1 - 1e-9, Math.max(1e-9, u))) / cols, (r + Math.min(1 - 1e-9, Math.max(1e-9, v))) / rows)
    const slope = (g: (x: number) => [number, number], at0: boolean): [number, number] => {
      const k = at0 ? 1 : -1, x0 = at0 ? 0 : 1
      const a = g(x0), b = g(x0 + k * H), d = g(x0 + 2 * k * H)
      return [(k * (-3 * a[0] + 4 * b[0] - d[0])) / (2 * H), (k * (-3 * a[1] + 4 * b[1] - d[1])) / (2 * H)]
    }
    const set = (a: number, b: number, x: number, y: number): void => {
      const i = ((r * 3 + a) * n + c * 3 + b) * 2
      net[i] = x
      net[i + 1] = y
    }
    for (const vi of [0, 1]) for (const ui of [0, 1]) {
      const p = f(ui, vi)
      const du = slope((x) => f(x, vi), ui === 0), dv = slope((x) => f(ui, x), vi === 0)
      const duv = slope((y) => slope((x) => f(x, y), ui === 0), vi === 0)
      const ku = (ui ? -1 : 1) / 3, kv = (vi ? -1 : 1) / 3
      const a = vi * 3, b = ui * 3, a1 = a + (vi ? -1 : 1), b1 = b + (ui ? -1 : 1)
      set(a, b, p[0], p[1])
      set(a, b1, p[0] + ku * du[0], p[1] + ku * du[1])
      set(a1, b, p[0] + kv * dv[0], p[1] + kv * dv[1])
      set(a1, b1, p[0] + ku * du[0] + kv * dv[0] + ku * kv * duv[0], p[1] + ku * du[1] + kv * dv[1] + ku * kv * duv[1])
    }
  }
  return { type, cols, rows, pts: net }
}

/** A flat warp of the same kind over a rectangle. */
export function rectWarp(w: CxWarp, x: number, y: number, ww: number, hh: number): CxWarp {
  if (w.type === 'poly') {
    const b = bounds(w.pts)
    const out: number[] = []
    for (let i = 0; i < w.pts.length; i += 2) out.push(x + ((w.pts[i] - b.x) / Math.max(1e-9, b.w)) * ww, y + ((w.pts[i + 1] - b.y) / Math.max(1e-9, b.h)) * hh)
    return { ...w, pts: out }
  }
  return resampleWarp({ type: 'corners', cols: 1, rows: 1, pts: [x, y, x + ww, y, x + ww, y + hh, x, y + hh] }, w.type, w.cols, w.rows)
}

/** One point of a warp moved, what hangs on it following (bezier : a knot takes
 *  its handles; a handle takes the twist points beside it, and turns the handle
 *  across the knot with it unless `free`). Indices count points, not numbers. */
export function movePoint(w: CxWarp, i: number, dx: number, dy: number, free = false): CxWarp {
  const p = [...w.pts]
  const add = (k: number, x: number, y: number): void => {
    p[k * 2] += x
    p[k * 2 + 1] += y
  }
  if (w.type !== 'bezier') {
    add(i, dx, dy)
    return { ...w, pts: p }
  }
  const n = 3 * w.cols + 1, m = 3 * w.rows + 1
  const c = i % n, r = Math.floor(i / n)
  const at = (rr: number, cc: number): number | null => (rr >= 0 && rr < m && cc >= 0 && cc < n ? rr * n + cc : null)
  const kc = c % 3 === 0, kr = r % 3 === 0
  if (kc && kr) {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const k = at(r + a, c + b)
      if (k !== null) add(k, dx, dy)
    }
  } else if (kc !== kr) {
    // a handle : along the row (kr) or down the column (kc)
    const alongRow = kr
    const kk = alongRow ? [r, c % 3 === 1 ? c - 1 : c + 1] : [r % 3 === 1 ? r - 1 : r + 1, c]
    const moveWith = (rr: number, cc: number, x: number, y: number): void => {
      for (const d of [-1, 0, 1]) {
        const k = alongRow ? at(rr + d, cc) : at(rr, cc + d)
        if (k !== null) add(k, x, y)
      }
    }
    moveWith(r, c, dx, dy)
    const or = 2 * kk[0] - r, oc = 2 * kk[1] - c
    const o = at(or, oc)
    if (!free && o !== null) {
      // the other handle keeps its length, in line with this one
      const K = kk[0] * n + kk[1], me = r * n + c
      const vx = p[K * 2] - p[me * 2], vy = p[K * 2 + 1] - p[me * 2 + 1]
      const len = Math.hypot(vx, vy)
      const ol = Math.hypot(p[o * 2] - p[K * 2], p[o * 2 + 1] - p[K * 2 + 1])
      if (len > 1e-9) moveWith(or, oc, p[K * 2] + (vx / len) * ol - p[o * 2], p[K * 2 + 1] + (vy / len) * ol - p[o * 2 + 1])
    }
  } else add(i, dx, dy)
  return { ...w, pts: p }
}

/** Every point of a warp through a map of the plane. */
export function mapPoints(pts: number[], f: (x: number, y: number) => [number, number]): number[] {
  const o = new Array<number>(pts.length)
  for (let i = 0; i < pts.length; i += 2) {
    const q = f(pts[i], pts[i + 1])
    o[i] = q[0]
    o[i + 1] = q[1]
  }
  return o
}

// ── Meshes ──────────────────────────────────────────────────────────────
export interface CxMesh {
  /** x, y, w, s, t for each vertex : x, y in the screen's 0..1, w the projective weight (1 but for corners) */
  v: Float32Array
  idx: Uint32Array
}

const span = (w: CxWarp): { ms: number; mt: number } => {
  // how much of 0..1 one screen-height thousandth is, along each side
  const L = (a: [number, number], b: [number, number]): number => Math.max(1e-4, Math.hypot(a[0] - b[0], a[1] - b[1]))
  return {
    ms: 1 / Math.min(L(evalWarp(w, 0, 0), evalWarp(w, 1, 0)), L(evalWarp(w, 0, 1), evalWarp(w, 1, 1))),
    mt: 1 / Math.min(L(evalWarp(w, 0, 0), evalWarp(w, 0, 1)), L(evalWarp(w, 1, 0), evalWarp(w, 1, 1)))
  }
}

/** The slice's mesh, reaching `rim` (a share of the screen) past its edge, where
 *  the anti-aliased half pixel outside it is drawn. */
export function warpMesh(w: CxWarp, rim: number): CxMesh {
  if (w.type === 'poly') {
    const b = bounds(w.pts)
    const x0 = b.x - rim, y0 = b.y - rim, x1 = b.x + b.w + rim, y1 = b.y + b.h + rim
    const S = (x: number): number => (x - b.x) / Math.max(1e-9, b.w), T = (y: number): number => (y - b.y) / Math.max(1e-9, b.h)
    return {
      v: new Float32Array([x0, y0, 1, S(x0), T(y0), x1, y0, 1, S(x1), T(y0), x1, y1, 1, S(x1), T(y1), x0, y1, 1, S(x0), T(y1)]),
      idx: new Uint32Array([0, 1, 2, 0, 2, 3])
    }
  }
  const k = span(w)
  const ms = Math.min(0.2, rim * k.ms), mt = Math.min(0.2, rim * k.mt)
  if (w.type === 'corners' && quadSound(w.pts)) {
    const m = squareToQuad(w.pts)
    const cs: number[][] = [[-ms, -mt], [1 + ms, -mt], [1 + ms, 1 + mt], [-ms, 1 + mt]]
    let ws = cs.map(([s, t]) => m[6] * s + m[7] * t + m[8])
    if (Math.min(...ws) <= 1e-6) {
      cs.splice(0, 4, [0, 0], [1, 0], [1, 1], [0, 1])
      ws = cs.map(([s, t]) => m[6] * s + m[7] * t + m[8])
    }
    const v = new Float32Array(20)
    cs.forEach(([s, t], i) => v.set([(m[0] * s + m[1] * t + m[2]) / ws[i], (m[3] * s + m[4] * t + m[5]) / ws[i], ws[i], s, t], i * 5))
    return { v, idx: new Uint32Array([0, 1, 2, 0, 2, 3]) }
  }
  const per = w.type === 'grid' ? 8 : w.type === 'corners' ? 24 : 14
  const cells = (n: number): number => Math.min(192, Math.max(n, n * Math.max(2, Math.min(per, Math.floor(192 / n)))))
  const line = (n: number, e: number): number[] => [-e, ...Array.from({ length: n + 1 }, (_, i) => i / n), 1 + e]
  const S = line(cells(w.cols), ms), T = line(cells(w.rows), mt)
  const v = new Float32Array(S.length * T.length * 5)
  let o = 0
  for (const t of T) for (const s of S) {
    const p = evalWarp(w, s, t)
    v[o++] = p[0]; v[o++] = p[1]; v[o++] = 1; v[o++] = s; v[o++] = t
  }
  const idx = new Uint32Array((S.length - 1) * (T.length - 1) * 6)
  o = 0
  for (let r = 0; r + 1 < T.length; r++) for (let c = 0; c + 1 < S.length; c++) {
    const a = r * S.length + c, b = a + 1, d = a + S.length, e = d + 1
    idx[o++] = a; idx[o++] = b; idx[o++] = e; idx[o++] = a; idx[o++] = e; idx[o++] = d
  }
  return { v, idx }
}

/** Where on the slice (s, t) a point of the screen is : null outside it. `near`
 *  takes the closest point instead. */
export function invWarp(w: CxWarp, x: number, y: number, near = false): [number, number] | null {
  if (w.type === 'corners' && quadSound(w.pts)) {
    const m = inv3(squareToQuad(w.pts))
    if (m) {
      const q = apply3(m, x, y)
      if (near || (q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1)) return q
      return null
    }
  }
  if (w.type === 'poly') {
    const b = bounds(w.pts)
    if (!near && !insidePoly(w.pts, x, y)) return null
    return [(x - b.x) / Math.max(1e-9, b.w), (y - b.y) / Math.max(1e-9, b.h)]
  }
  // a coarse look, then Newton on the surface itself
  const nc = Math.max(8, w.cols * 4), nr = Math.max(8, w.rows * 4)
  let best = Infinity, bs = 0.5, bt = 0.5
  for (let r = 0; r <= nr; r++) for (let c = 0; c <= nc; c++) {
    const p = evalWarp(w, c / nc, r / nr)
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2
    if (d < best) { best = d; bs = c / nc; bt = r / nr }
  }
  const h = 1e-4
  for (let k = 0; k < 12; k++) {
    const p = evalWarp(w, bs, bt)
    const ex = x - p[0], ey = y - p[1]
    if (ex * ex + ey * ey < 1e-14) break
    const a = evalWarp(w, bs + h, bt), b = evalWarp(w, bs, bt + h)
    const xs = (a[0] - p[0]) / h, ys = (a[1] - p[1]) / h, xt = (b[0] - p[0]) / h, yt = (b[1] - p[1]) / h
    const det = xs * yt - xt * ys
    if (Math.abs(det) < 1e-12) break
    bs = Math.min(1.2, Math.max(-0.2, bs + (ex * yt - ey * xt) / det))
    bt = Math.min(1.2, Math.max(-0.2, bt + (ey * xs - ex * ys) / det))
  }
  const p = evalWarp(w, bs, bt)
  const ok = Math.hypot(p[0] - x, p[1] - y) < 1e-4 && bs >= -1e-4 && bs <= 1.0001 && bt >= -1e-4 && bt <= 1.0001
  return ok || near ? [bs, bt] : null
}

/** The slice's edge on the screen, as a closed line. */
export function warpOutline(w: CxWarp): number[] {
  if (w.type === 'poly') return w.pts
  if (w.type === 'corners') return w.pts
  const n = w.type === 'grid' ? w.cols : w.cols * 10, m = w.type === 'grid' ? w.rows : w.rows * 10
  const o: number[] = []
  for (let i = 0; i < n; i++) o.push(...evalWarp(w, i / n, 0))
  for (let i = 0; i < m; i++) o.push(...evalWarp(w, 1, i / m))
  for (let i = 0; i < n; i++) o.push(...evalWarp(w, 1 - i / n, 1))
  for (let i = 0; i < m; i++) o.push(...evalWarp(w, 0, 1 - i / m))
  return o
}

/** A part of the surface turned over on itself (the sign of its area changes). */
export function warpFolded(w: CxWarp): boolean {
  if (w.type === 'poly') return selfCrossing(w.pts)
  if (w.type === 'corners' && !quadSound(w.pts)) return true
  const n = w.type === 'corners' ? 1 : w.cols * 4, m = w.type === 'corners' ? 1 : w.rows * 4
  let pos = 0, neg = 0
  for (let r = 0; r < m; r++) for (let c = 0; c < n; c++) {
    const a = evalWarp(w, c / n, r / m), b = evalWarp(w, (c + 1) / n, r / m), d = evalWarp(w, c / n, (r + 1) / m), e = evalWarp(w, (c + 1) / n, (r + 1) / m)
    for (const k of [(b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]), (d[0] - e[0]) * (b[1] - e[1]) - (d[1] - e[1]) * (b[0] - e[0])]) {
      if (k > 1e-10) pos++
      else if (k < -1e-10) neg++
    }
  }
  return pos > 0 && neg > 0
}

// ── Outlines ────────────────────────────────────────────────────────────
export function bounds(p: ArrayLike<number>): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1])
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
export function insidePoly(p: ArrayLike<number>, x: number, y: number): boolean {
  let c = false
  const n = p.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], yi = p[i * 2 + 1], xj = p[j * 2], yj = p[j * 2 + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
/** Distance to a closed outline (positive inside). */
export function polyDistance(p: ArrayLike<number>, x: number, y: number): number {
  let d = Infinity
  const n = p.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) d = Math.min(d, segDistance(x, y, p[j * 2], p[j * 2 + 1], p[i * 2], p[i * 2 + 1]))
  return insidePoly(p, x, y) ? d : -d
}
export function segDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const k = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / Math.max(1e-18, dx * dx + dy * dy)))
  return Math.hypot(x - ax - k * dx, y - ay - k * dy)
}
export function polyArea(p: ArrayLike<number>): number {
  let a = 0
  const n = p.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) a += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1]
  return Math.abs(a) / 2
}
function selfCrossing(p: number[]): boolean {
  const n = p.length / 2
  const o = (a: number, b: number, c: number): number => (p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[a * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[a * 2])
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue
    const a = i, b = (i + 1) % n, c = j, d = (j + 1) % n
    if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return true
  }
  return false
}
/** The outline as a line, rounded through its points when `smooth` (a closed
 *  Catmull-Rom curve). */
export function flattenMask(m: Pick<CxMask, 'pts' | 'smooth'>): number[] {
  if (!m.smooth) return m.pts
  const n = m.pts.length / 2, o: number[] = []
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 10; k++) {
      const w = crWeights(k / 10)
      let x = 0, y = 0
      for (let a = 0; a < 4; a++) {
        const j = ((i + a - 1 + n) % n) * 2
        x += w[a] * m.pts[j]
        y += w[a] * m.pts[j + 1]
      }
      o.push(x, y)
    }
  }
  return o
}
/** A slice's mask carried onto the screen by its warp (its sides cut short enough
 *  to follow the bends). */
export function maskOnScreen(w: CxWarp, m: Pick<CxMask, 'pts' | 'smooth'>): number[] {
  const line = flattenMask(m)
  const straight = w.type === 'corners' || w.type === 'poly'
  const o: number[] = []
  const n = line.length / 2
  for (let i = 0; i < n; i++) {
    const ax = line[i * 2], ay = line[i * 2 + 1], bx = line[((i + 1) % n) * 2], by = line[((i + 1) % n) * 2 + 1]
    const steps = straight ? 1 : Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 24))
    for (let k = 0; k < steps; k++) o.push(...evalWarp(w, ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps))
  }
  return o
}
/** A mask's coverage at a distance (px) inside its outline : the soft edge is
 *  centered on it, never thinner than the anti-aliased pixel. */
export function maskCover(dist: number, soft: number): number {
  const s = Math.max(1, soft)
  const k = Math.min(1, Math.max(0, dist / s + 0.5))
  return soft > 1 ? k * k * (3 - 2 * k) : k
}

// ── Mean value coordinates (the poly warp, and its check in node) ───────
/** (x, y) inside (or outside) the outline `out`, carried to the outline `inp`. */
export function meanValueMap(out: ArrayLike<number>, inp: ArrayLike<number>, x: number, y: number): [number, number] {
  const n = out.length / 2
  const dx = new Array<number>(n), dy = new Array<number>(n), r = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    dx[i] = out[i * 2] - x
    dy[i] = out[i * 2 + 1] - y
    r[i] = Math.hypot(dx[i], dy[i])
    if (r[i] < 1e-9) return [inp[i * 2], inp[i * 2 + 1]]
  }
  const tan = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const A = dx[i] * dy[j] - dx[j] * dy[i], D = dx[i] * dx[j] + dy[i] * dy[j]
    if (Math.abs(A) < 1e-12 && D < 0) {
      // on the side itself : straight between its two ends
      const k = r[i] / (r[i] + r[j])
      return [inp[i * 2] * (1 - k) + inp[j * 2] * k, inp[i * 2 + 1] * (1 - k) + inp[j * 2 + 1] * k]
    }
    // tan(angle / 2), with its sign
    tan[i] = A / (r[i] * r[j] + D)
  }
  let sw = 0, u = 0, v = 0
  for (let i = 0; i < n; i++) {
    const k = (tan[(i + n - 1) % n] + tan[i]) / r[i]
    sw += k
    u += k * inp[i * 2]
    v += k * inp[i * 2 + 1]
  }
  return [u / sw, v / sw]
}

// ── The input side ──────────────────────────────────────────────────────
/** Flips and quarter turns, as a map of the slice's own square. */
export function turnMap(s: Pick<CxSlice, 'flipX' | 'flipY' | 'turn'>): M3 {
  let m: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  if (s.flipX) m = mul3([-1, 0, 1, 0, 1, 0, 0, 0, 1], m)
  if (s.flipY) m = mul3([1, 0, 0, 0, -1, 1, 0, 0, 1], m)
  // the picture a quarter clockwise : the slice's TL shows the input's BL
  for (let k = 0; k < s.turn; k++) m = mul3(m, [0, 1, 0, -1, 0, 1, 0, 0, 1])
  return m
}
/** The slice's square to the source's 0..1 (y down). */
export const inputMap = (s: Pick<CxSlice, 'input' | 'flipX' | 'flipY' | 'turn' | 'inKind'>): M3 => {
  const p = s.inKind === 'poly' ? (() => { const b = bounds(s.input); return [b.x, b.y, b.x + b.w, b.y, b.x + b.w, b.y + b.h, b.x, b.y + b.h] })() : s.input
  return mul3(quadSound(p) ? squareToQuad(p) : squareToQuad(rect8(bounds(p))), turnMap(s))
}
const rect8 = (b: { x: number; y: number; w: number; h: number }): number[] => [b.x, b.y, b.x + b.w, b.y, b.x + b.w, b.y + b.h, b.x, b.y + b.h]
/** A poly slice's input outline after its flips and turns (about its own middle). */
export function polyInput(s: Pick<CxSlice, 'input' | 'flipX' | 'flipY' | 'turn'>): number[] {
  if (!s.flipX && !s.flipY && !s.turn) return s.input
  const b = bounds(s.input), m = turnMap(s)
  return mapPoints(s.input, (x, y) => {
    const q = apply3(m, (x - b.x) / Math.max(1e-9, b.w), (y - b.y) / Math.max(1e-9, b.h))
    return [b.x + q[0] * b.w, b.y + q[1] * b.h]
  })
}

// ── Soft edges ──────────────────────────────────────────────────────────
/** The blend's light at x (0 the outer side, 1 the inner) : Bourke's curve. */
export function blendLight(x: number, power: number, lum: number): number {
  const k = Math.min(1, Math.max(0, x))
  return k < 0.5 ? lum * Math.pow(2 * k, power) : 1 - (1 - lum) * Math.pow(2 * (1 - k), power)
}
/** ... and the pixel value that gives that light on a projector of that gamma. */
export const blendValue = (x: number, e: Pick<CxEdges, 'power' | 'gamma' | 'lum'>): number => Math.pow(blendLight(x, e.power, e.lum), 1 / e.gamma)
