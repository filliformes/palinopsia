// Strata's clouds : the four places it carries (drawn here as if laser-scanned :
// points on surfaces, with their colors), and the links between neighboring points. Made in a worker
// (workers/strataWorker.ts : a place takes up to a quarter second).
//
// - COLONNADE : a ruined portico on a stepped base, broken columns, fallen drums,
//   plants at their feet. Architecture taken back by nature.
// - GROVE : trees on mossy ground, trunks, branches and their foliage.
// - CLIFF : a rock face in layers of sediment, ledges where a layer is harder,
//   scree at its foot, grass on top.
// - NEBULA : a cloud of gas and dust in space, filaments and dense cores, a few stars.
//
// Every place is dealt from a fixed seed (the same cloud every time), fitted like a
// file (its center at the origin, its farthest point at 1) and kept once made.
// Written for Palinopsia : plain sampling of shapes and value noise, no code taken.

export interface Cloud {
  /** x y z of each point, fitted : the center at the origin, the farthest at 1 */
  pos: Float32Array
  /** r g b a of each point, 0..255 */
  col: Uint8Array
  n: number
}

/** A cloud ready to draw : its points in a shuffled order (the first N of them are an
 *  even sample of the whole, the same ones whatever else is drawn), and its web. */
export interface DrawCloud extends Cloud {
  /** the web (LinkBuilder) : 4 floats a web point */
  link: Float32Array
  linkStep: number
  linkN: number
}

export const PLACE_NAMES = ['colonnade', 'grove', 'cliff', 'nebula'] as const

// ── a seeded random and value noise ─────────────────────────────────────────────
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash3 = (x: number, y: number, z: number): number => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const fade = (t: number): number => t * t * (3 - 2 * t)
function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz)
  const l = (a: number, b: number, t: number): number => a + (b - a) * t
  const c = (dx: number, dy: number, dz: number): number => hash3(ix + dx, iy + dy, iz + dz)
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz
  )
}
function fbm(x: number, y: number, z: number, oct = 4): number {
  let s = 0, a = 0.5, f = 1, n = 0
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, z * f)
    n += a
    a *= 0.5
    f *= 2.03
  }
  return s / n
}

// ── a growing point list ────────────────────────────────────────────────────────
class Pts {
  pos: number[] = []
  col: number[] = []
  add(x: number, y: number, z: number, r: number, g: number, b: number): void {
    this.pos.push(x, y, z)
    this.col.push(r, g, b)
  }
  done(): Cloud {
    const n = this.pos.length / 3
    const pos = new Float32Array(this.pos)
    const col = new Uint8Array(n * 4)
    for (let i = 0; i < n; i++) {
      col[i * 4] = Math.max(0, Math.min(255, Math.round(this.col[i * 3] * 255)))
      col[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(this.col[i * 3 + 1] * 255)))
      col[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(this.col[i * 3 + 2] * 255)))
      col[i * 4 + 3] = 255
    }
    return fitCloud({ pos, col, n })
  }
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** The center of the box to the origin, the farthest point at 1 (a new array). A few
 *  stray points far out (birds, dust, a mirror's ghost : every survey has some) do not
 *  count : the fit is then the rest's, and they stand where they are, outside it. */
export function fitCloud(c: Cloud): Cloud {
  const p = c.pos
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < c.n * 3; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2]
    if (x < x0) x0 = x; if (x > x1) x1 = x
    if (y < y0) y0 = y; if (y > y1) y1 = y
    if (z < z0) z0 = z; if (z > z1) z1 = z
  }
  let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2
  let r2 = 0
  for (let i = 0; i < c.n * 3; i += 3) {
    const dx = p[i] - cx, dy = p[i + 1] - cy, dz = p[i + 2] - cz
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz)
  }
  // the body of the cloud : all but one point in two thousand, over an even sample
  let reach = Math.sqrt(r2)
  if (c.n >= 4000) {
    const m = Math.min(c.n, 60000), step = c.n / m
    const axis = new Float32Array(m)
    const mid: number[] = []
    for (let a = 0; a < 3; a++) {
      for (let j = 0; j < m; j++) axis[j] = p[Math.floor(j * step) * 3 + a]
      axis.sort()
      mid.push((axis[Math.floor(m * 0.0005)] + axis[Math.min(m - 1, Math.ceil(m * 0.9995))]) / 2)
    }
    for (let j = 0; j < m; j++) {
      const i = Math.floor(j * step) * 3
      axis[j] = Math.hypot(p[i] - mid[0], p[i + 1] - mid[1], p[i + 2] - mid[2])
    }
    axis.sort()
    const body = axis[Math.floor(m * 0.9995)]
    // (an ordinary cloud's corners reach a third past that : fitted whole, as before)
    if (body > 0 && reach > body * 1.6) {
      ;[cx, cy, cz] = mid
      reach = body * 1.15
    }
  }
  const k = reach > 0 ? 1 / reach : 1
  const out = new Float32Array(c.n * 3)
  for (let i = 0; i < c.n * 3; i += 3) {
    out[i] = (p[i] - cx) * k
    out[i + 1] = (p[i + 1] - cy) * k
    out[i + 2] = (p[i + 2] - cz) * k
  }
  return { pos: out, col: c.col, n: c.n }
}

// ── surfaces sampled at random ──────────────────────────────────────────────────
type RGB = [number, number, number]
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]
const mixC = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** A box's surface : n points spread over its faces by area. */
function box(P: Pts, R: () => number, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, n: number, color: (x: number, y: number, z: number) => RGB): void {
  const areas = [sy * sz, sy * sz, sx * sz, sx * sz, sx * sy, sx * sy]
  const tot = areas.reduce((a, b) => a + b, 0)
  for (let i = 0; i < n; i++) {
    let r = R() * tot, f = 0
    while (f < 5 && r > areas[f]) { r -= areas[f]; f++ }
    const u = R() - 0.5, v = R() - 0.5
    let x = cx, y = cy, z = cz
    if (f < 2) { x += (f === 0 ? -0.5 : 0.5) * sx; y += u * sy; z += v * sz }
    else if (f < 4) { y += (f === 2 ? -0.5 : 0.5) * sy; x += u * sx; z += v * sz }
    else { z += (f === 4 ? -0.5 : 0.5) * sz; x += u * sx; y += v * sy }
    const c = color(x, y, z)
    P.add(x, y, z, c[0], c[1], c[2])
  }
}

/** A cylinder's side between two points (radius r0 at a, r1 at b), its ends open. */
function tube(P: Pts, R: () => number, a: [number, number, number], b: [number, number, number], r0: number, r1: number, n: number, color: (t: number, ang: number, x: number, y: number, z: number) => RGB, flute = 0): void {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const L = Math.hypot(d[0], d[1], d[2]) || 1
  const w = [d[0] / L, d[1] / L, d[2] / L]
  const up = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  let u = [w[1] * up[2] - w[2] * up[1], w[2] * up[0] - w[0] * up[2], w[0] * up[1] - w[1] * up[0]]
  const ul = Math.hypot(u[0], u[1], u[2]) || 1
  u = [u[0] / ul, u[1] / ul, u[2] / ul]
  const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]]
  for (let i = 0; i < n; i++) {
    const t = R(), ang = R() * Math.PI * 2
    let r = r0 + (r1 - r0) * t
    if (flute) r *= 1 + 0.045 * Math.cos(ang * flute)
    const cs = Math.cos(ang) * r, sn = Math.sin(ang) * r
    const x = a[0] + d[0] * t + u[0] * cs + v[0] * sn
    const y = a[1] + d[1] * t + u[1] * cs + v[1] * sn
    const z = a[2] + d[2] * t + u[2] * cs + v[2] * sn
    const c = color(t, ang, x, y, z)
    P.add(x, y, z, c[0], c[1], c[2])
  }
}

/** A disc (a column's broken top, a drum's face). */
function disc(P: Pts, R: () => number, c: [number, number, number], r: number, axis: 'y' | 'x', n: number, color: RGB): void {
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, s = Math.sqrt(R()) * r
    const jag = axis === 'y' ? (R() - 0.5) * 0.02 : 0
    if (axis === 'y') P.add(c[0] + Math.cos(a) * s, c[1] + jag, c[2] + Math.sin(a) * s, ...shade(color, 0.85 + R() * 0.2))
    else P.add(c[0], c[1] + Math.cos(a) * s, c[2] + Math.sin(a) * s, ...shade(color, 0.85 + R() * 0.2))
  }
}

/** Ground : a noisy field over x, z (size s), n points, colored by `color`. */
function ground(P: Pts, R: () => number, s: number, n: number, amp: number, color: (x: number, z: number, h: number) => RGB): void {
  for (let i = 0; i < n; i++) {
    const x = (R() - 0.5) * s, z = (R() - 0.5) * s
    const h = amp * (fbm(x * 1.3 + 7, 0.5, z * 1.3, 5) - 0.5)
    const c = color(x, z, h)
    P.add(x, h, z, c[0], c[1], c[2])
  }
}

/** Foliage : a noisy ball of points round c. */
function foliage(P: Pts, R: () => number, c: [number, number, number], r: number, n: number, base: RGB): void {
  for (let i = 0; i < n; i++) {
    // on a lumpy shell, thicker toward the outside (what a scanner sees)
    const u = R() * 2 - 1, a = R() * Math.PI * 2, s = Math.sqrt(1 - u * u)
    const dir = [s * Math.cos(a), u, s * Math.sin(a)]
    const lump = 0.7 + 0.5 * fbm(dir[0] * 2 + c[0] * 3, dir[1] * 2 + c[1], dir[2] * 2 + c[2] * 3, 3)
    const depth = Math.pow(R(), 0.35)
    const rr = r * lump * depth
    const k = 0.7 + 0.5 * R() * (0.6 + 0.4 * (dir[1] * 0.5 + 0.5))
    P.add(c[0] + dir[0] * rr, c[1] + dir[1] * rr * 0.8, c[2] + dir[2] * rr, ...shade(base, k))
  }
}

// ── the places ──────────────────────────────────────────────────────────────────
function colonnade(): Cloud {
  const R = rng(4127)
  const P = new Pts()
  const earth: RGB = [0.43, 0.36, 0.27], grass: RGB = [0.33, 0.41, 0.2], marble: RGB = [0.84, 0.81, 0.74]
  ground(P, R, 3.4, 70000, 0.12, (x, z, h) => {
    const g = fbm(x * 2.2, 3, z * 2.2, 3)
    return shade(mixC(earth, grass, Math.min(1, Math.max(0, (g - 0.4) * 3))), 0.75 + 0.4 * (h + 0.06) * 4 + R() * 0.1)
  })
  const stone = (x: number, y: number, z: number): RGB => {
    const g = fbm(x * 9, y * 9, z * 9, 3)
    return shade(mixC(marble, [0.55, 0.52, 0.45], Math.max(0, 0.9 - y * 2.2) * 0.6 + (g - 0.5) * 0.6), 0.85 + R() * 0.15)
  }
  // the stepped base
  box(P, R, 0, 0.03, 0, 2.6, 0.06, 1.25, 16000, stone)
  box(P, R, 0, 0.09, 0, 2.45, 0.06, 1.1, 14000, stone)
  box(P, R, 0, 0.15, 0, 2.3, 0.06, 0.95, 13000, stone)
  const top = 0.18
  const full = 1.15
  const xs = [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0]
  const heights: number[][] = [[], []]
  for (let row = 0; row < 2; row++) {
    const z = row === 0 ? -0.33 : 0.33
    for (let i = 0; i < xs.length; i++) {
      const broken = R() < 0.45
      const h = broken ? 0.18 + R() * 0.6 : full
      heights[row].push(h)
      const x = xs[i]
      tube(P, R, [x, top, z], [x, top + h, z], 0.072, 0.062, Math.round(9000 * h), (t, _a, px, py, pz) => stone(px, py, pz), 20)
      if (broken) disc(P, R, [x, top + h, z], 0.064, 'y', 700, marble)
      else box(P, R, x, top + h + 0.03, z, 0.19, 0.06, 0.19, 1800, stone) // the capital
      // a fallen drum beside the broken ones
      if (broken && R() < 0.8) {
        const dx = (R() - 0.5) * 0.5, dz = (row === 0 ? -1 : 1) * (0.25 + R() * 0.35)
        const len = 0.18 + R() * 0.2
        const ang = R() * Math.PI
        const cx = x + dx, cz = z + dz
        const ax = Math.cos(ang) * len * 0.5, az = Math.sin(ang) * len * 0.5
        const y = cz > 0.62 || cz < -0.62 ? 0.07 : top + 0.07
        tube(P, R, [cx - ax, y, cz - az], [cx + ax, y, cz + az], 0.07, 0.07, 2200, (t, _a, px, py, pz) => stone(px, py, pz), 20)
      }
      // what grows at its foot
      if (R() < 0.6) foliage(P, R, [x + (R() - 0.5) * 0.2, top + 0.04, z + (row === 0 ? -1 : 1) * 0.12], 0.09 + R() * 0.06, 1500, [0.26, 0.4, 0.17])
    }
    // the architrave where neighbors both stand
    for (let i = 0; i + 1 < xs.length; i++) {
      if (heights[row][i] >= full && heights[row][i + 1] >= full) {
        box(P, R, (xs[i] + xs[i + 1]) / 2, top + full + 0.1, z, 0.46, 0.1, 0.2, 3500, stone)
      }
    }
  }
  // shrubs and grass tufts round the ruin
  for (let i = 0; i < 26; i++) {
    const x = (R() - 0.5) * 3, z = (R() - 0.5) * 3
    if (Math.abs(x) < 1.3 && Math.abs(z) < 0.62) continue
    foliage(P, R, [x, 0.04, z], 0.06 + R() * 0.12, 1200, mixC([0.24, 0.38, 0.15], [0.45, 0.45, 0.2], R()))
  }
  return P.done()
}

function grove(): Cloud {
  const R = rng(9203)
  const P = new Pts()
  const moss: RGB = [0.25, 0.33, 0.14], litter: RGB = [0.36, 0.27, 0.17], bark: RGB = [0.33, 0.26, 0.2]
  ground(P, R, 3.2, 80000, 0.22, (x, z, h) => shade(mixC(litter, moss, fbm(x * 3, 1, z * 3, 3)), 0.7 + (h + 0.1) * 2 + R() * 0.12))
  const branch = (a: [number, number, number], dir: [number, number, number], len: number, r: number, depth: number): void => {
    const b: [number, number, number] = [a[0] + dir[0] * len, a[1] + dir[1] * len, a[2] + dir[2] * len]
    tube(P, R, a, b, r, r * 0.72, Math.round(26000 * len * r + 150), (_t, ang) => shade(bark, 0.75 + 0.3 * Math.cos(ang * 7) * 0.5 + R() * 0.15))
    if (depth === 0) {
      const tone = R() < 0.2 ? [0.55, 0.42, 0.14] as RGB : mixC([0.2, 0.36, 0.13], [0.36, 0.46, 0.18], R())
      foliage(P, R, b, 0.16 + R() * 0.08, 2600, tone)
      return
    }
    const kids = depth === 3 ? 3 : 2 + (R() < 0.5 ? 1 : 0)
    for (let k = 0; k < kids; k++) {
      const a2 = R() * Math.PI * 2, lean = 0.35 + R() * 0.5
      let d: [number, number, number] = [dir[0] * 0.6 + Math.cos(a2) * lean, dir[1] * 0.6 + 0.45, dir[2] * 0.6 + Math.sin(a2) * lean]
      const l = Math.hypot(d[0], d[1], d[2])
      d = [d[0] / l, d[1] / l, d[2] / l]
      const at = 0.6 + R() * 0.4
      branch([a[0] + (b[0] - a[0]) * at, a[1] + (b[1] - a[1]) * at, a[2] + (b[2] - a[2]) * at], d, len * (0.55 + R() * 0.2), r * 0.62, depth - 1)
    }
  }
  const spots: Array<[number, number]> = []
  for (let i = 0; spots.length < 9 && i < 200; i++) {
    const x = (R() - 0.5) * 2.4, z = (R() - 0.5) * 2.4
    if (spots.every(([sx, sz]) => Math.hypot(sx - x, sz - z) > 0.55)) spots.push([x, z])
  }
  for (const [x, z] of spots) {
    const h0 = 0.22 * (fbm(x * 1.3 + 7, 0.5, z * 1.3, 5) - 0.5)
    const tall = 0.55 + R() * 0.35
    branch([x, h0, z], [(R() - 0.5) * 0.15, 1, (R() - 0.5) * 0.15], tall, 0.045 + R() * 0.02, 3)
  }
  return P.done()
}

function cliff(): Cloud {
  const R = rng(3319)
  const P = new Pts()
  const palette: RGB[] = [[0.72, 0.55, 0.38], [0.6, 0.36, 0.24], [0.78, 0.7, 0.55], [0.48, 0.42, 0.38], [0.66, 0.46, 0.3], [0.82, 0.76, 0.62], [0.52, 0.3, 0.22]]
  const layers = 15
  const hard: number[] = []
  const tone: RGB[] = []
  for (let i = 0; i < layers; i++) { hard.push(R()); tone.push(palette[Math.floor(R() * palette.length)]) }
  const W = 3.2, H = 1.7
  const face = (x: number, y: number): { z: number; li: number } => {
    const warp = 0.06 * (fbm(x * 0.8, 1, 2, 3) - 0.5) + 0.12 * x * 0.15
    const li = Math.max(0, Math.min(layers - 1, Math.floor(((y + warp) / H) * layers)))
    const zl = hard[li] * 0.12
    const z = 0.3 * (fbm(x * 1.6, y * 1.1, 4, 5) - 0.5) + zl + 0.08 * fbm(x * 8, y * 8, 1, 2)
    return { z, li }
  }
  // the face
  for (let i = 0; i < 160000; i++) {
    const x = (R() - 0.5) * W, y = R() * H
    const { z, li } = face(x, y)
    const g = fbm(x * 6, y * 6, 9, 3)
    P.add(x, y, z, ...shade(tone[li], 0.6 + 0.5 * g + R() * 0.1))
  }
  // grass on the top
  for (let i = 0; i < 22000; i++) {
    const x = (R() - 0.5) * W, d = -R() * 0.8
    const y = H + 0.04 * fbm(x * 4, d * 4, 3, 3)
    P.add(x, y, face(x, H).z + d, ...shade([0.32, 0.4, 0.18], 0.7 + R() * 0.35))
  }
  // the scree at its foot
  for (let i = 0; i < 40000; i++) {
    const x = (R() - 0.5) * W, d = R() * 0.9
    const y = Math.max(0, 0.35 * (1 - d / 0.9) * (0.6 + 0.6 * fbm(x * 2, 3, d * 3, 3))) - 0.02
    P.add(x, y, face(x, 0.02).z + 0.12 + d, ...shade([0.55, 0.5, 0.44], 0.6 + R() * 0.45))
  }
  return P.done()
}

function nebula(): Cloud {
  const R = rng(7741)
  const P = new Pts()
  const ha: RGB = [0.86, 0.26, 0.32], oiii: RGB = [0.22, 0.68, 0.74], dust: RGB = [0.42, 0.28, 0.22]
  // the density on a coarse grid first (the noise is costly), then points dealt into
  // its cells by their weight, each jittered within its cell
  const G = 44
  const sx = 2, sy = 1.4, sz = 1.6
  const dens = new Float32Array(G * G * G)
  let tot = 0
  for (let k = 0; k < G; k++) for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = ((i + 0.5) / G - 0.5) * sx, y = ((j + 0.5) / G - 0.5) * sy, z = ((k + 0.5) / G - 0.5) * sz
    const f = fbm(x * 1.4 + 3, y * 1.4, z * 1.4, 4)
    // thin sheets where the field crosses its middle : the filaments
    const fil = Math.pow(Math.max(0, 1 - Math.abs(f - 0.5) * 12), 3)
    const body = fbm(x * 2.2, y * 2.2 + 5, z * 2.2, 4)
    const fall = Math.max(0, 1 - ((2 * x) / sx) ** 2 - ((2 * y) / sy) ** 2 - ((2 * z) / sz) ** 2)
    const d = Math.sqrt(fall) * (0.04 * body + fil * (0.4 + body))
    const w = d * d
    dens[(k * G + j) * G + i] = w
    tot += w
  }
  const cdf = new Float32Array(dens.length)
  let acc = 0
  for (let c = 0; c < dens.length; c++) { acc += dens[c] / tot; cdf[c] = acc }
  const N = 200000
  for (let n = 0; n < N; n++) {
    const u = R()
    let lo = 0, hi = cdf.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < u) lo = m + 1; else hi = m }
    const i = lo % G, j = Math.floor(lo / G) % G, k = Math.floor(lo / (G * G))
    const x = ((i + R()) / G - 0.5) * sx, y = ((j + R()) / G - 0.5) * sy, z = ((k + R()) / G - 0.5) * sz
    const d = Math.sqrt(dens[lo])
    // hydrogen red on one side, oxygen teal on the other, blended across
    const mixT = 0.4 + 0.9 * (x / sx) + 1.8 * (fbm(x * 1.1 + 11, y * 1.1, z * 1.1, 2) - 0.5)
    let c = mixC(ha, oiii, Math.max(0, Math.min(1, mixT)))
    if (d < 0.25) c = mixC(dust, c, d / 0.25)
    c = mixC(c, [1, 0.95, 0.9], Math.min(1, Math.max(0, d - 0.6) * 2))
    P.add(x, y, z, ...shade(c, 0.6 + 0.6 * d + R() * 0.1))
  }
  // a few stars, scattered through the whole volume and beyond
  for (let i = 0; i < 1500; i++) {
    const x = (R() - 0.5) * 3, y = (R() - 0.5) * 2, z = (R() - 0.5) * 2.4
    const k = 0.3 + Math.pow(R(), 4) * 0.7
    P.add(x, y, z, k, k, k * (0.95 + R() * 0.1))
  }
  return P.done()
}

const made = new Map<number, Cloud>()
/** A place's cloud (made on the first ask, then kept). */
export function placeCloud(i: number): Cloud {
  const k = Math.max(0, Math.min(PLACE_NAMES.length - 1, Math.round(i)))
  let c = made.get(k)
  if (!c) {
    c = [colonnade, grove, cliff, nebula][k]()
    made.set(k, c)
  }
  return c
}

/** The points in a shuffled order, always the same for a cloud : its first N are then an
 *  even sample (POINTS under a modulator adds and takes points, the others hold still;
 *  in the file's own order every step of it picked others, and the cloud boiled). */
export function shuffleCloud(c: Cloud): Cloud {
  const R = rng(c.n ^ 0x5bd1)
  const pos = c.pos.slice(0, c.n * 3), col = c.col.slice(0, c.n * 4)
  const w = new Uint32Array(col.buffer, 0, c.n)
  for (let i = c.n - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1))
    const a = i * 3, b = j * 3
    const x = pos[a], y = pos[a + 1], z = pos[a + 2]
    pos[a] = pos[b]; pos[a + 1] = pos[b + 1]; pos[a + 2] = pos[b + 2]
    pos[b] = x; pos[b + 1] = y; pos[b + 2] = z
    const t = w[i]; w[i] = w[j]; w[j] = t
  }
  return { pos, col, n: c.n }
}

/** A fitted cloud made ready to draw : shuffled, its web found. */
export function drawCloud(fitted: Cloud): DrawCloud {
  const c = shuffleCloud(fitted)
  const B = new LinkBuilder(c.pos, c.n)
  B.step(Infinity)
  return { ...c, link: B.out, linkStep: B.stride, linkN: B.m }
}

// ── the links : each point's two nearest neighbors, by a spatial hash ──────────
/** The web of links : every STRIDE-th point of the cloud (about LINK_POINTS of them) and
 *  its two nearest neighbors among those, so a link is longer than a point is wide and
 *  reads as a line over the cloud. Built a slice at a time (a scan of millions of points
 *  must not stall a frame). `out` : 4 floats a web point, its two neighbors' web
 *  indices (-1 : none within reach) and their distances. */
export const LINK_POINTS = 30000
/** The most candidates looked at for one point (a scan with most of its points in one
 *  clump : thousands share a cell, and looking at them all took minutes). */
const LINK_LOOKS = 600
export class LinkBuilder {
  readonly out: Float32Array
  /** the cloud's index of web point k is k * stride */
  readonly stride: number
  readonly m: number
  private head: Int32Array
  private next: Int32Array
  private mask: number
  private cell: number
  private at = 0
  done = false
  private pos: Float32Array
  private n: number
  constructor(cloudPos: Float32Array, cloudN: number) {
    this.stride = Math.max(1, Math.ceil(cloudN / LINK_POINTS))
    const m = (this.m = Math.ceil(cloudN / this.stride))
    const pos = new Float32Array(m * 3)
    for (let k = 0; k < m; k++) {
      const i = k * this.stride
      pos[k * 3] = cloudPos[i * 3]; pos[k * 3 + 1] = cloudPos[i * 3 + 1]; pos[k * 3 + 2] = cloudPos[i * 3 + 2]
    }
    this.pos = pos
    this.n = m
    const n = m
    this.out = new Float32Array(n * 4)
    // the reach : about two spacings of the cloud, as if spread over a surface
    // (scans are surfaces) of the fitted ball's size
    this.cell = Math.max(0.003, Math.min(0.12, 2.2 * Math.sqrt(6 / Math.max(1, n))))
    let size = 1
    while (size < n * 2) size <<= 1
    this.mask = size - 1
    this.head = new Int32Array(size).fill(-1)
    this.next = new Int32Array(n)
    const inv = 1 / this.cell
    for (let i = 0; i < n; i++) {
      const h = this.key(Math.floor(pos[i * 3] * inv), Math.floor(pos[i * 3 + 1] * inv), Math.floor(pos[i * 3 + 2] * inv))
      this.next[i] = this.head[h]
      this.head[h] = i
    }
  }
  private key(x: number, y: number, z: number): number {
    return ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) & this.mask
  }
  /** Find the neighbors of up to `budget` more points; true when every point has them. */
  step(budget: number): boolean {
    if (this.done) return true
    const p = this.pos, inv = 1 / this.cell, r2 = this.cell * this.cell
    const end = Math.min(this.n, this.at + budget)
    for (let i = this.at; i < end; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]
      const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv)
      let b1 = -1, b2 = -1, d1 = r2, d2 = r2
      let looks = 0
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (let j = this.head[this.key(cx + dx, cy + dy, cz + dz)]; j >= 0; j = this.next[j]) {
          if (++looks > LINK_LOOKS) break
          // (two cells can share a hash : the same point met twice)
          if (j === i || j === b1 || j === b2) continue
          const ex = p[j * 3] - x, ey = p[j * 3 + 1] - y, ez = p[j * 3 + 2] - z
          const d = ex * ex + ey * ey + ez * ez
          if (d >= d2) continue
          if (d < d1) { b2 = b1; d2 = d1; b1 = j; d1 = d } else { b2 = j; d2 = d }
        }
      }
      const o = i * 4
      this.out[o] = b1
      this.out[o + 1] = b2
      this.out[o + 2] = Math.sqrt(d1)
      this.out[o + 3] = Math.sqrt(d2)
    }
    this.at = end
    if (end < this.n) return false
    // a pair that names each other is drawn once, from its lower index
    for (let i = 0; i < this.n; i++) for (let k = 0; k < 2; k++) {
      const j = this.out[i * 4 + k]
      if (j >= 0 && j < i && (this.out[j * 4] === i || this.out[j * 4 + 1] === i)) this.out[i * 4 + k] = -1
    }
    this.done = true
    return true
  }
}

// ── a file's colors ─────────────────────────────────────────────────────────────
export interface MeshColors {
  pos: Float32Array
  uv: Float32Array | null
  col: Uint8Array
  hasColor: boolean
  texture: ImageBitmap | null
}

/** Each point's color, as the Model shows the file : its vertex color, times its
 *  texture under the point's texture coordinates where the file has one (the mesh's
 *  colors carry alpha 255 where the texture applies, 0 where the file gave no color);
 *  a file with neither in a soft gray. Always opaque : Strata draws a point by alpha. */
export function pointColors(m: MeshColors): Uint8Array {
  const n = m.pos.length / 3
  const out = new Uint8Array(n * 4)
  const src = m.col
  let tex: { data: Uint8ClampedArray; w: number; h: number } | null = null
  if (m.texture && m.uv) {
    try {
      const w = m.texture.width, h = m.texture.height
      const cv = new OffscreenCanvas(w, h)
      const cx = cv.getContext('2d')!
      cx.drawImage(m.texture, 0, 0)
      tex = { data: cx.getImageData(0, 0, w, h).data, w, h }
    } catch {
      tex = null // (a texture closed meanwhile : the vertex colors alone)
    }
  }
  const fr = (x: number): number => clamp01(x - Math.floor(x))
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const a = src[o + 3]
    if (!m.hasColor && !(tex && a > 127)) {
      out[o] = out[o + 1] = out[o + 2] = 200
    } else {
      let r = src[o], g = src[o + 1], b = src[o + 2]
      if (tex && m.uv && a > 127) {
        // the Model samples its texture uploaded unflipped : the image's first row at v = 0
        const x = Math.min(tex.w - 1, Math.floor(fr(m.uv[i * 2]) * tex.w))
        const y = Math.min(tex.h - 1, Math.floor(fr(m.uv[i * 2 + 1]) * tex.h))
        const t = (y * tex.w + x) * 4
        r = (r * tex.data[t]) / 255; g = (g * tex.data[t + 1]) / 255; b = (b * tex.data[t + 2]) / 255
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b
    }
    out[o + 3] = 255
  }
  return out
}
