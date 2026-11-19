// gridMesh : the CPU half of the Grid Mesh source (engine/GridMeshSource.ts). A shape
// made as a GRID of vertices (dimX × dimY, kept in row order), deformed the way a
// classic matrix-geometry patch does it, then cut into the primitives its draw mode
// asks for, in the grid's own order :
//
//   1. the shape : position, texture coordinate, normal and color (white) per vertex,
//      twelve values in all, turned and scaled first (the turn lives inside the
//      shape, so the noise below stays still while the shape turns through it);
//   2. a noise field on its own small grid (20 × 20 by default), one channel per
//      value, each brought to 0..1 and scaled by SIZE;
//   3. the shape resampled onto the noise's grid (nearest cell : vertices repeat or
//      drop), multiplied by it, value by value (positions, normals and colors alike);
//   4. that resampled back onto the shape's grid (nearest again) and crossfaded with
//      the plain shape : 0 the shape, 1 the noisy one, past 1 beyond it.
//
// The repeats and drops of steps 3 and 4 are what make the steps and shards; drawing
// each ROW of the grid as a line strip, a fan, quads or one polygon (not as its
// surface) makes the rings, scribbles and long slivers. The round shapes have their
// axis along z (toward the camera) and the cube is a square tube whose rows walk its
// outline, as the classic grid shapes are made (checked against the OCTOCOSME patch's
// own output, its mesh bank's slots 1 to 4 at rest).
//
// Written for Palinopsia : the idea of this chain comes from the OCTOCOSME visuals
// (Vincent's own Max patch), built there on Jitter's gridshape, bfg and mesh objects;
// no code of theirs is used (THIRD_PARTY_NOTICES Part 6). The noises are written from
// their published methods :
// third-party: Grid Mesh noise methods

// third-party: The built-in shape list
export const GRID_SHAPES = ['sphere', 'torus', 'cylinder', 'open cylinder', 'cube', 'open cube', 'plane', 'circle', 'cone', 'capsule'] as const

export const NOISE_BASES = [
  'saw', 'distance', 'sine', 'cell', 'checker', 'distorted', 'gradient', 'simplex', 'voronoi',
  'value (cubic)', 'value (convolution)', 'sparse convolution', 'fractal mono', 'fractal hetero',
  'multifractal', 'hybrid multifractal', 'ridged multifractal', 'turbulence'
] as const

/** The draw modes, in the order the classic matrix-mesh menus give them. */
export const DRAW_MODES = [
  'tri grid', 'quad grid', 'points', 'lines', 'line strip', 'line loop', 'triangles', 'tri fan',
  'tri strip', 'quads', 'quad strip', 'polygon'
] as const

/** Twelve values a vertex : x y z · s t · nx ny nz · r g b a. */
export const PLANES = 12

// ── The shapes on their grid ─────────────────────────────────────────────────

/** dimX × dimY vertices, row order (x fastest), twelve values each. */
export function buildGridShape(shape: number, dimX: number, dimY: number): Float32Array {
  const nx = Math.max(2, Math.round(dimX)), ny = Math.max(2, Math.round(dimY))
  const out = new Float32Array(nx * ny * PLANES)
  const TAU = Math.PI * 2
  const put = (k: number, x: number, y: number, z: number, s: number, t: number, a: number, b: number, c: number): void => {
    const o = k * PLANES
    out[o] = x; out[o + 1] = y; out[o + 2] = z
    out[o + 3] = s; out[o + 4] = t
    const l = Math.hypot(a, b, c) || 1
    out[o + 5] = a / l; out[o + 6] = b / l; out[o + 7] = c / l
    out[o + 8] = 1; out[o + 9] = 1; out[o + 10] = 1; out[o + 11] = 1
  }
  const name = GRID_SHAPES[Math.max(0, Math.min(GRID_SHAPES.length - 1, Math.round(shape)))]
  for (let j = 0; j < ny; j++) {
    const v = j / (ny - 1)
    for (let i = 0; i < nx; i++) {
      const u = i / (nx - 1)
      const k = j * nx + i
      const th = u * TAU, ct = Math.cos(th), st = Math.sin(th)
      switch (name) {
        case 'sphere': {
          const ph = v * Math.PI, sp = Math.sin(ph), cp = Math.cos(ph)
          put(k, sp * ct, sp * st, cp, u, v, sp * ct, sp * st, cp)
          break
        }
        case 'torus': {
          const R = 1, r = 0.5, ph = v * TAU, cp = Math.cos(ph), sp = Math.sin(ph)
          put(k, (R + r * cp) * ct, (R + r * cp) * st, r * sp, u, v, cp * ct, cp * st, sp)
          break
        }
        case 'cylinder': {
          // the first and last rows close the ends (one centre point each), the rows
          // between run down the side
          if (j === 0) { put(k, 0, 0, 1, u, v, 0, 0, 1); break }
          if (j === ny - 1) { put(k, 0, 0, -1, u, v, 0, 0, -1); break }
          const w = ny > 3 ? (j - 1) / (ny - 3) : 0.5
          put(k, ct, st, 1 - 2 * w, u, v, ct, st, 0)
          break
        }
        case 'cone':
          // open : from its point (the first row) to its rim (the last)
          put(k, v * ct, v * st, 1 - 2 * v, u, v, ct, st, 0.5)
          break
        case 'open cylinder':
          put(k, ct, st, 1 - 2 * v, u, v, ct, st, 0)
          break
        case 'cube':
        case 'open cube': {
          // a square tube along z, each row walking the square's perimeter from its
          // top-left corner, down first (counter-clockwise as seen from the front, so a
          // fan of a row faces the camera); the cube closes its two ends (first and
          // last rows : one centre point each)
          const closed = name === 'cube'
          if (closed && j === 0) { put(k, 0, 0, 1, u, v, 0, 0, 1); break }
          if (closed && j === ny - 1) { put(k, 0, 0, -1, u, v, 0, 0, -1); break }
          const w = closed ? (ny > 3 ? (j - 1) / (ny - 3) : 0.5) : v
          const t = (u % 1) * 4, side = Math.min(3, Math.floor(t)), f = t - side
          const [x, y, nX, nY] = side === 0 ? [-1, 1 - 2 * f, -1, 0] : side === 1 ? [-1 + 2 * f, -1, 0, -1] : side === 2 ? [1, -1 + 2 * f, 1, 0] : [1 - 2 * f, 1, 0, 1]
          put(k, x, y, 1 - 2 * w, u, v, nX, nY, 0)
          break
        }
        case 'plane':
          put(k, u * 2 - 1, v * 2 - 1, 0, u, v, 0, 0, 1)
          break
        case 'circle':
          put(k, v * ct, v * st, 0, u, v, 0, 0, 1)
          break
        case 'capsule': {
          const ph = v * Math.PI, sp = Math.sin(ph), cp = Math.cos(ph)
          const z = cp + (cp >= 0 ? 0.5 : -0.5)
          put(k, sp * ct, sp * st, z, u, v, sp * ct, sp * st, cp)
          break
        }
      }
    }
  }
  return out
}

/** Turn and scale the positions and normals in place (the shape's own transform). */
export function transformGrid(g: Float32Array, rot: [number, number, number], scale: [number, number, number]): void {
  const [ax, ay, az] = rot
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az)
  // R = Rz · Ry · Rx (x first)
  const r00 = cz * cy, r01 = cz * sy * sx - sz * cx, r02 = cz * sy * cx + sz * sx
  const r10 = sz * cy, r11 = sz * sy * sx + cz * cx, r12 = sz * sy * cx - cz * sx
  const r20 = -sy, r21 = cy * sx, r22 = cy * cx
  const [kx, ky, kz] = scale
  for (let o = 0; o < g.length; o += PLANES) {
    const x = g[o] * kx, y = g[o + 1] * ky, z = g[o + 2] * kz
    g[o] = r00 * x + r01 * y + r02 * z
    g[o + 1] = r10 * x + r11 * y + r12 * z
    g[o + 2] = r20 * x + r21 * y + r22 * z
    const a = g[o + 5], b = g[o + 6], c = g[o + 7]
    g[o + 5] = r00 * a + r01 * b + r02 * c
    g[o + 6] = r10 * a + r11 * b + r12 * c
    g[o + 7] = r20 * a + r21 * b + r22 * c
  }
}

// ── The noises (each written from its published method) ─────────────────────

/** A seeded permutation (a shuffle, so no published table is reproduced). */
function perm(seed: number): Uint8Array {
  const p = new Uint8Array(512)
  const a = new Uint8Array(256)
  for (let i = 0; i < 256; i++) a[i] = i
  let s = seed >>> 0 || 1
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0
    const j = s % (i + 1)
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  for (let i = 0; i < 512; i++) p[i] = a[i & 255]
  return p
}
const P = perm(0x0c70c05e)
const hash3 = (x: number, y: number, z: number): number => P[P[P[x & 255] + (y & 255)] + (z & 255)]
const rnd3 = (x: number, y: number, z: number): number => hash3(x, y, z) / 255 // a lattice value 0..1
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** The dot product with one of the twelve cube-edge gradients (h picks it). */
function grad12(h: number, a: number, b: number, c: number): number {
  switch (h % 12) {
    case 0: return a + b; case 1: return -a + b; case 2: return a - b; case 3: return -a - b
    case 4: return a + c; case 5: return -a + c; case 6: return a - c; case 7: return -a - c
    case 8: return b + c; case 9: return -b + c; case 10: return b - c; default: return -b - c
  }
}

/** Gradient noise (Perlin 1985, with the 2002 quintic fade and twelve edge gradients). */
function gradient(x: number, y: number, z: number): number {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z)
  const fx = x - X, fy = y - Y, fz = z - Z
  const g = grad12
  const u = fade(fx), v = fade(fy), w = fade(fz)
  const n = (i: number, j: number, k: number): number => g(hash3(X + i, Y + j, Z + k), fx - i, fy - j, fz - k)
  return lerp(
    lerp(lerp(n(0, 0, 0), n(1, 0, 0), u), lerp(n(0, 1, 0), n(1, 1, 0), u), v),
    lerp(lerp(n(0, 0, 1), n(1, 0, 1), u), lerp(n(0, 1, 1), n(1, 1, 1), u), v),
    w
  )
}

/** Simplex noise (Perlin 2001) : the space cut into tetrahedra, four corners summed. */
function simplex(x: number, y: number, z: number): number {
  const F3 = 1 / 3, G3 = 1 / 6
  const s = (x + y + z) * F3
  const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s)
  const t = (i + j + k) * G3
  const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t)
  let i1, j1, k1, i2, j2, k2
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1 }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1 }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1 }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1 }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
  }
  const corner = (dx: number, dy: number, dz: number, ci: number, cj: number, ck: number): number => {
    let r = 0.6 - dx * dx - dy * dy - dz * dz
    if (r <= 0) return 0
    r *= r
    return r * r * grad12(hash3(i + ci, j + cj, k + ck), dx, dy, dz)
  }
  return 32 * (
    corner(x0, y0, z0, 0, 0, 0) +
    corner(x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, i1, j1, k1) +
    corner(x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3, i2, j2, k2) +
    corner(x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3, 1, 1, 1)
  )
}

/** Catmull-Rom spline through four values. */
const catrom = (a: number, b: number, c: number, d: number, t: number): number =>
  0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)

/** Value noise, cubic : random lattice values through a Catmull-Rom spline (Peachey). */
function valueCubic(x: number, y: number, z: number): number {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z)
  const fx = x - X, fy = y - Y, fz = z - Z
  const pz: number[] = []
  for (let k = -1; k <= 2; k++) {
    const py: number[] = []
    for (let j = -1; j <= 2; j++) {
      py.push(catrom(rnd3(X - 1, Y + j, Z + k), rnd3(X, Y + j, Z + k), rnd3(X + 1, Y + j, Z + k), rnd3(X + 2, Y + j, Z + k), fx))
    }
    pz.push(catrom(py[0], py[1], py[2], py[3], fy))
  }
  return catrom(pz[0], pz[1], pz[2], pz[3], fz)
}

/** Value convolution noise : the lattice values filtered by a smooth kernel (Peachey). */
function valueConv(x: number, y: number, z: number): number {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z)
  let sum = 0, wsum = 0
  for (let k = -1; k <= 2; k++) for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) {
    const dx = x - (X + i), dy = y - (Y + j), dz = z - (Z + k)
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 >= 4) continue
    const d = Math.sqrt(d2)
    const w = d < 1 ? 1.5 * d * d * d - 2.5 * d * d + 1 : -0.5 * d * d * d + 2.5 * d * d - 4 * d + 2 // Catmull-Rom kernel
    sum += w * rnd3(X + i, Y + j, Z + k); wsum += w
  }
  return wsum ? sum / wsum : 0
}

/** Sparse convolution noise (Lewis 1989) : random impulses per cell, through a kernel. */
function sparseConv(x: number, y: number, z: number): number {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z)
  let sum = 0
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = X + i, cy = Y + j, cz = Z + k
    for (let n = 0; n < 3; n++) {
      const px = cx + rnd3(cx + n * 17, cy, cz), py = cy + rnd3(cx, cy + n * 31, cz), pz = cz + rnd3(cx, cy, cz + n * 47)
      const a = rnd3(cx + n * 7, cy + n * 13, cz + n * 3) * 2 - 1
      const d2 = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2
      if (d2 < 1) sum += a * (1 - d2) * (1 - d2)
    }
  }
  return sum
}

/** Cellular noise (Worley 1996) : the nearest and second-nearest feature points. */
function cellular(x: number, y: number, z: number): [number, number] {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z)
  let f1 = 9, f2 = 9
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = X + i, cy = Y + j, cz = Z + k
    const px = cx + rnd3(cx, cy, cz + 101), py = cy + rnd3(cx + 57, cy, cz), pz = cz + rnd3(cx, cy + 89, cz)
    const d = Math.sqrt((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2)
    if (d < f1) { f2 = f1; f1 = d } else if (d < f2) f2 = d
  }
  return [f1, f2]
}

// Musgrave's fractal sums (Ebert et al., Texturing & Modeling, ch. 16), over gradient noise.
const OCT = 6, LAC = 2
function fbm(x: number, y: number, z: number, H = 1): number {
  let v = 0, f = 1
  for (let o = 0; o < OCT; o++) { v += gradient(x * f, y * f, z * f) * Math.pow(f, -H); f *= LAC }
  return v
}
function hetero(x: number, y: number, z: number): number {
  const off = 0.3
  let f = 1, v = off + gradient(x, y, z)
  for (let o = 1; o < OCT; o++) { f *= LAC; v += (gradient(x * f, y * f, z * f) + off) * Math.pow(f, -1) * v }
  return v
}
function multifractal(x: number, y: number, z: number): number {
  const off = 0.7
  let v = 1, f = 1
  for (let o = 0; o < OCT; o++) { v *= gradient(x * f, y * f, z * f) * Math.pow(f, -0.25) + off; f *= LAC }
  return v
}
function hybrid(x: number, y: number, z: number): number {
  const off = 0.7
  let f = 1, v = (gradient(x, y, z) + off), w = v
  for (let o = 1; o < OCT && w > 0.001; o++) {
    f *= LAC
    w = Math.min(1, w)
    const s = (gradient(x * f, y * f, z * f) + off) * Math.pow(f, -0.25)
    v += w * s; w *= s
  }
  return v
}
function ridged(x: number, y: number, z: number): number {
  const off = 1, gain = 2
  let s = off - Math.abs(gradient(x, y, z)); s *= s
  let v = s, w = 1, f = 1
  for (let o = 1; o < OCT; o++) {
    f *= LAC
    w = Math.max(0, Math.min(1, s * gain))
    s = off - Math.abs(gradient(x * f, y * f, z * f)); s *= s; s *= w
    v += s * Math.pow(f, -1)
  }
  return v
}
function turbulence(x: number, y: number, z: number): number {
  let v = 0, f = 1
  for (let o = 0; o < OCT; o++) { v += Math.abs(gradient(x * f, y * f, z * f)) / f; f *= LAC }
  return v
}

/** One noise value at (x, y, z), by its basis (NOISE_BASES order). Any range : each
 *  channel is brought to 0..1 afterwards. */
export function noiseAt(basis: number, x: number, y: number, z: number): number {
  switch (basis) {
    case 0: { const s = x + y + z; return s - Math.floor(s) }
    case 1: return Math.sqrt(x * x + y * y + z * z)
    case 2: return Math.sin((x + y + z) * Math.PI * 2)
    case 3: return cellular(x, y, z)[0]
    case 4: return (Math.floor(x) + Math.floor(y) + Math.floor(z)) & 1
    case 5: {
      // distorted noise : the place itself pushed by a vector of noise first
      const d = 1.2
      return gradient(x + d * gradient(x + 5.2, y + 1.3, z + 2.8), y + d * gradient(x + 1.7, y + 9.2, z + 3.1), z + d * gradient(x + 8.3, y + 2.8, z + 7.4))
    }
    case 6: return gradient(x, y, z)
    case 7: return simplex(x, y, z)
    case 8: { const [a, b] = cellular(x, y, z); return b - a }
    case 9: return valueCubic(x, y, z)
    case 10: return valueConv(x, y, z)
    case 11: return sparseConv(x, y, z)
    case 12: return fbm(x, y, z)
    case 13: return hetero(x, y, z)
    case 14: return multifractal(x, y, z)
    case 15: return hybrid(x, y, z)
    case 16: return ridged(x, y, z)
    default: return turbulence(x, y, z)
  }
}

export interface NoiseParams {
  basis: number
  /** The field's own grid (a side). */
  dim: number
  scale: number
  origin: [number, number, number]
  /** Each axis ±1 (a negative one mirrors the field along it). */
  weight: [number, number, number]
  /** Its 0..1 values times this. */
  size: number
}

/** The noise field : dim × dim cells, twelve channels, each 0..1 (its own min to max)
 *  times SIZE. Channel c is the same field read at depth c (each value its own). */
export function noiseField(p: NoiseParams): Float32Array {
  const n = Math.max(2, Math.round(p.dim))
  const out = new Float32Array(n * n * PLANES)
  const lo = new Float32Array(PLANES).fill(Infinity), hi = new Float32Array(PLANES).fill(-Infinity)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i / n) * p.scale * p.weight[0] + p.origin[0]
    const y = (j / n) * p.scale * p.weight[1] + p.origin[1]
    for (let c = 0; c < PLANES; c++) {
      const z = c * 1.618 * p.weight[2] + p.origin[2]
      const v = noiseAt(p.basis, x, y, z)
      const o = (j * n + i) * PLANES + c
      out[o] = v
      if (v < lo[c]) lo[c] = v
      if (v > hi[c]) hi[c] = v
    }
  }
  for (let o = 0; o < out.length; o++) {
    const c = o % PLANES
    const span = hi[c] - lo[c]
    out[o] = (span > 1e-9 ? (out[o] - lo[c]) / span : 0) * p.size
  }
  return out
}

/** A grid of twelve-value cells resampled to another size by the nearest cell (cells
 *  repeat when it grows, drop when it shrinks). */
export function resampleNearest(src: Float32Array, sx: number, sy: number, dx: number, dy: number, into?: Float32Array): Float32Array {
  if (sx === dx && sy === dy) return src
  const out = into && into.length === dx * dy * PLANES ? into : new Float32Array(dx * dy * PLANES)
  for (let j = 0; j < dy; j++) {
    const ys = Math.min(sy - 1, Math.floor((j * sy) / dy))
    for (let i = 0; i < dx; i++) {
      const xs = Math.min(sx - 1, Math.floor((i * sx) / dx))
      out.set(src.subarray((ys * sx + xs) * PLANES, (ys * sx + xs + 1) * PLANES), (j * dx + i) * PLANES)
    }
  }
  return out
}

/** The whole chain : the shape (already turned), the noise multiplied into it on the
 *  noise's grid, and crossfaded back (`blend` past 1 goes beyond the noisy shape). */
// (the chain's working arrays, kept from frame to frame : no garbage every frame)
let sSmall: Float32Array = new Float32Array(0), sProd: Float32Array = new Float32Array(0), sBack: Float32Array = new Float32Array(0), sOut: Float32Array = new Float32Array(0), sTmp: Float32Array = new Float32Array(0)
const sized = (a: Float32Array, n: number): Float32Array => (a.length === n ? a : new Float32Array(n))

export function deformGrid(shape: Float32Array, nx: number, ny: number, noise: Float32Array | null, noiseDim: number, blend: number): Float32Array {
  if (!noise || blend === 0) return shape
  const ns = noiseDim * noiseDim * PLANES
  sSmall = sized(sSmall, ns)
  const small = resampleNearest(shape, nx, ny, noiseDim, noiseDim, sSmall)
  const prod = (sProd = sized(sProd, small.length))
  for (let o = 0; o < prod.length; o++) prod[o] = small[o] * noise[o]
  sBack = sized(sBack, shape.length)
  const back = resampleNearest(prod, noiseDim, noiseDim, nx, ny, sBack)
  const out = (sOut = sized(sOut, shape.length))
  for (let o = 0; o < out.length; o++) out[o] = shape[o] + (back[o] - shape[o]) * blend
  return out
}

/** Normals worked out again from the deformed grid's neighbours (the surface as it now
 *  is), written over the grid's own. */
export function gridNormals(g: Float32Array, nx: number, ny: number): void {
  const at = (i: number, j: number): number => (Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))) * PLANES
  const tmp = (sTmp = sized(sTmp, nx * ny * 3))
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = at(i + 1, j), b = at(i - 1, j), c = at(i, j + 1), d = at(i, j - 1)
    const ux = g[a] - g[b], uy = g[a + 1] - g[b + 1], uz = g[a + 2] - g[b + 2]
    const vx = g[c] - g[d], vy = g[c + 1] - g[d + 1], vz = g[c + 2] - g[d + 2]
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx
    const l = Math.hypot(x, y, z)
    const o = (j * nx + i) * PLANES
    if (l < 1e-9) { x = g[o + 5]; y = g[o + 6]; z = g[o + 7] } else { x /= -l; y /= -l; z /= -l }
    tmp[(j * nx + i) * 3] = x; tmp[(j * nx + i) * 3 + 1] = y; tmp[(j * nx + i) * 3 + 2] = z
  }
  for (let k = 0; k < nx * ny; k++) { const o = k * PLANES; g[o + 5] = tmp[k * 3]; g[o + 6] = tmp[k * 3 + 1]; g[o + 7] = tmp[k * 3 + 2] }
}

// ── The primitives, in the grid's order ──────────────────────────────────────

export interface Primitives {
  /** Triangles : vertex indices, three at a time. */
  tris: number[]
  /** Segments : vertex indices, two at a time. */
  segs: number[]
  /** Points : vertex indices. */
  pts: number[]
}

/** Cut the grid (nx × ny, row order) into what the draw mode makes. The surface modes
 *  (tri grid, quad grid) follow the grid's rows and columns; every other mode reads
 *  each ROW of vertices as its own list and joins it as that mode joins any list (a
 *  line strip draws each row as one line, a fan opens from each row's first vertex) :
 *  that is where the rings, scribbles, slivers and shards come from. */
export function primitives(mode: number, nx: number, ny: number): Primitives {
  const tris: number[] = [], segs: number[] = [], pts: number[] = []
  const name = DRAW_MODES[mode] ?? 'tri grid'
  if (name === 'tri grid' || name === 'quad grid') {
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1
      tris.push(a, c, b, b, c, d)
    }
    return { tris, segs, pts }
  }
  for (let j = 0; j < ny; j++) {
    const o = j * nx, n = nx
    switch (name) {
      case 'points':
        for (let k = 0; k < n; k++) pts.push(o + k)
        break
      case 'lines':
        for (let k = 0; k + 1 < n; k += 2) segs.push(o + k, o + k + 1)
        break
      case 'line strip':
        for (let k = 0; k + 1 < n; k++) segs.push(o + k, o + k + 1)
        break
      case 'line loop':
        for (let k = 0; k + 1 < n; k++) segs.push(o + k, o + k + 1)
        if (n > 2) segs.push(o + n - 1, o)
        break
      case 'triangles':
        for (let k = 0; k + 2 < n; k += 3) tris.push(o + k, o + k + 1, o + k + 2)
        break
      case 'tri fan':
      case 'polygon':
        for (let k = 1; k + 1 < n; k++) tris.push(o, o + k, o + k + 1)
        break
      case 'tri strip':
        for (let k = 0; k + 2 < n; k++) (k & 1 ? tris.push(o + k + 1, o + k, o + k + 2) : tris.push(o + k, o + k + 1, o + k + 2))
        break
      case 'quads':
        for (let k = 0; k + 3 < n; k += 4) tris.push(o + k, o + k + 1, o + k + 2, o + k, o + k + 2, o + k + 3)
        break
      case 'quad strip':
        for (let k = 0; k + 3 < n; k += 2) tris.push(o + k, o + k + 1, o + k + 3, o + k, o + k + 3, o + k + 2)
        break
    }
  }
  return { tris, segs, pts }
}
