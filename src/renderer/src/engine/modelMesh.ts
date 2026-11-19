// The Model source's meshes (engine/ModelSource.ts) : the built-in shapes made in
// code, and the one preparation every mesh goes through, a built-in shape or a file
// (engine/modelParse.ts, in workers/modelWorker.ts) : centred and fitted to the unit
// sphere, normals where it has none (smoothed, with a crease angle), texture
// coordinates where it has none (wrapped round it), and the list of its edges for the
// line looks. Pure math, no GL : it runs on the page and in the worker.
//
// Conventions, the same for every mesh :
//   - y up, the camera on +z looking at the origin, triangles counter-clockwise seen
//     from outside (each one checked against its own normals as it is laid);
//   - texture coordinates with v DOWN (row 0 of an image at v = 0, as glTF stores
//     them; OBJ and PLY count v up and are turned over when read);
//   - colors as RGBA bytes : the alpha byte says where the file's texture applies
//     (255) and where it does not (0).
//
// The platonic solids are public geometry (the golden ratio's coordinates).
// third-party: Platonic solid coordinates (public math)

export const MAX_TRIS = 2_000_000
export const MAX_POINTS = 4_000_000
/** Above this the line looks have no edges list (a mesh this dense draws as a solid
 *  mass of lines anyway, and its edges would cost hundreds of megabytes). */
export const MAX_EDGE_TRIS = 1_000_000

export interface MeshInfo {
  tris: number
  verts: number
  /** A point cloud : no faces at all (a scan). */
  points: boolean
  hasUV: boolean
  hasColor: boolean
  hasTex: boolean
  hasEdges: boolean
  format: string
  notes: string[]
}

export interface MeshData {
  pos: Float32Array
  nrm: Float32Array
  uv: Float32Array
  col: Uint8Array
  /** Triangles; null for a point cloud. */
  idx: Uint32Array | null
  /** 12 floats an edge : its two ends, then the normals of the two faces that meet
   *  there (the second all 0 on an open boundary). Null above MAX_EDGE_TRIS. */
  edges: Float32Array | null
  /** 2 a edge : the two faces (triangles) that meet there, the second 0xffffffff on an
   *  open boundary (the shards each take their own copy of a shared edge). Null with
   *  the edges. */
  edgeFaces: Uint32Array | null
  /** The file's base color texture, if any. */
  texture: ImageBitmap | null
  info: MeshInfo
}

/** What a parser hands over : flat arrays, anything optional left out. */
export interface RawMesh {
  pos: Float32Array
  nrm?: Float32Array | null
  uv?: Float32Array | null
  col?: Uint8Array | null
  idx?: Uint32Array | null
  texture?: ImageBitmap | null
  format: string
  notes?: string[]
  /** The file says it is Z up (STL : the 3D-printing convention) : turned to Y up. */
  zUp?: boolean
}

// ── Growable typed arrays (the parsers fill millions of numbers) ────────────────
export class GrowF32 {
  a: Float32Array
  n = 0
  constructor(cap = 1024) { this.a = new Float32Array(cap) }
  push(x: number): void {
    if (this.n >= this.a.length) { const b = new Float32Array(Math.max(64, this.a.length * 2)); b.set(this.a); this.a = b }
    this.a[this.n++] = x
  }
  push3(x: number, y: number, z: number): void { this.push(x); this.push(y); this.push(z) }
  done(): Float32Array { return this.a.slice(0, this.n) }
}
export class GrowU32 {
  a: Uint32Array
  n = 0
  constructor(cap = 1024) { this.a = new Uint32Array(cap) }
  push(x: number): void {
    if (this.n >= this.a.length) { const b = new Uint32Array(Math.max(64, this.a.length * 2)); b.set(this.a); this.a = b }
    this.a[this.n++] = x
  }
  done(): Uint32Array { return this.a.slice(0, this.n) }
}
export class GrowU8 {
  a: Uint8Array
  n = 0
  constructor(cap = 1024) { this.a = new Uint8Array(cap) }
  push(x: number): void {
    if (this.n >= this.a.length) { const b = new Uint8Array(Math.max(64, this.a.length * 2)); b.set(this.a); this.a = b }
    this.a[this.n++] = x
  }
  done(): Uint8Array { return this.a.slice(0, this.n) }
}

// ── The built-in shapes ──────────────────────────────────────────────────────────
export const SHAPES = [
  'sphere', 'torus', 'cylinder', 'open cylinder', 'cube', 'open cube', 'plane', 'disc', 'cone', 'capsule',
  'tetrahedron', 'octahedron', 'dodecahedron', 'icosahedron', 'knot'
] as const
export const SHAPE_FILE = SHAPES.length // the last entry of the shape menu : the loaded file

type V3 = [number, number, number]

/** A small mesh builder : vertices with their normal and texture coordinates, and
 *  triangles laid counter-clockwise whatever order they are given in (each is checked
 *  against its own vertices' normals). */
class Builder {
  pos: number[] = []
  nrm: number[] = []
  uv: number[] = []
  idx: number[] = []
  get count(): number { return this.pos.length / 3 }
  v(p: V3, n: V3, u: number, v: number): number {
    const l = Math.hypot(n[0], n[1], n[2]) || 1
    this.pos.push(p[0], p[1], p[2])
    this.nrm.push(n[0] / l, n[1] / l, n[2] / l)
    this.uv.push(u, v)
    return this.count - 1
  }
  tri(a: number, b: number, c: number): void {
    const P = this.pos, N = this.nrm
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2]
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
    if (cx * cx + cy * cy + cz * cz < 1e-18) return // degenerate (a pole) : never laid
    const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]
    if (cx * nx + cy * ny + cz * nz < 0) this.idx.push(a, c, b)
    else this.idx.push(a, b, c)
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c)
    this.tri(a, c, d)
  }
  /** A flat face (any convex polygon) cut into a grid of `k` steps a side from its
   *  first vertex (k = 1 : one fan), each piece flat, for a shape that the wobble can
   *  bend. Texture coordinates : the face laid flat in its own plane. */
  flatTri(a: V3, b: V3, c: V3, k: number): void {
    // (outward : the solids stand round the origin, so a face looks away from it)
    let n = cross(sub(b, a), sub(c, a))
    if (dot(n, add(add(a, b), c)) < 0) n = scale(n, -1)
    const t = norm(sub(b, a)), s = norm(cross(n, t))
    const ctr = scale(add(add(a, b), c), 1 / 3)
    const uvOf = (p: V3): [number, number] => { const d = sub(p, ctr); return [0.5 + dot(d, t) * 0.7, 0.5 - dot(d, s) * 0.7] }
    const at = (i: number, j: number): number => {
      // the point i steps along a→b and j along a→c (i + j <= k)
      const p = add(a, add(scale(sub(b, a), i / k), scale(sub(c, a), j / k)))
      const [u, v] = uvOf(p)
      return this.v(p, n, u, v)
    }
    const row: number[][] = []
    for (let i = 0; i <= k; i++) { row[i] = []; for (let j = 0; j <= k - i; j++) row[i][j] = at(i, j) }
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k - i; j++) {
        this.tri(row[i][j], row[i + 1][j], row[i][j + 1])
        if (j < k - i - 1) this.tri(row[i + 1][j], row[i + 1][j + 1], row[i][j + 1])
      }
    }
  }
  flatPoly(pts: V3[], k: number): void {
    const c = scale(pts.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / pts.length)
    for (let i = 0; i < pts.length; i++) this.flatTri(c, pts[i], pts[(i + 1) % pts.length], k)
  }
  raw(name: string): RawMesh {
    return { pos: new Float32Array(this.pos), nrm: new Float32Array(this.nrm), uv: new Float32Array(this.uv), idx: new Uint32Array(this.idx), format: name }
  }
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/** A surface of revolution : a profile (radius, height, its normal in the r/y plane)
 *  turned round the y axis in `slices`, with the seam doubled for the texture. */
function lathe(B: Builder, prof: Array<{ r: number; y: number; nr: number; ny: number; v: number }>, slices: number): void {
  const base = B.count
  for (let i = 0; i < prof.length; i++) {
    const q = prof[i]
    for (let j = 0; j <= slices; j++) {
      const a = (j / slices) * Math.PI * 2
      const c = Math.cos(a), s = Math.sin(a)
      B.v([q.r * s, q.y, q.r * c], [q.nr * s, q.ny, q.nr * c], j / slices, q.v)
    }
  }
  const W = slices + 1
  for (let i = 0; i < prof.length - 1; i++) {
    for (let j = 0; j < slices; j++) {
      const a = base + i * W + j, b = a + 1, c = a + W + 1, d = a + W
      B.quad(a, b, c, d)
    }
  }
}

/** A flat cap (a disc) at height y, facing up (dir 1) or down (-1), in rings for the wobble. */
function cap(B: Builder, r: number, y: number, dir: number, slices: number, rings: number): void {
  const base = B.count
  const n: V3 = [0, dir, 0]
  B.v([0, y, 0], n, 0.5, 0.5)
  for (let i = 1; i <= rings; i++) {
    const rr = (r * i) / rings
    for (let j = 0; j < slices; j++) {
      const a = (j / slices) * Math.PI * 2
      B.v([rr * Math.sin(a), y, rr * Math.cos(a)], n, 0.5 + 0.5 * (rr / r) * Math.sin(a), 0.5 - 0.5 * dir * (rr / r) * Math.cos(a))
    }
  }
  for (let j = 0; j < slices; j++) B.tri(base, base + 1 + j, base + 1 + ((j + 1) % slices))
  for (let i = 1; i < rings; i++) {
    const r0 = base + 1 + (i - 1) * slices, r1 = base + 1 + i * slices
    for (let j = 0; j < slices; j++) {
      const j1 = (j + 1) % slices
      B.quad(r0 + j, r1 + j, r1 + j1, r0 + j1)
    }
  }
}

/** A square grid face : centre c, its two half-axes u and v, `k` cells a side. */
function gridFace(B: Builder, c: V3, u: V3, v: V3, k: number): void {
  const n = norm(cross(u, v))
  const base = B.count
  for (let i = 0; i <= k; i++) {
    for (let j = 0; j <= k; j++) {
      const a = (i / k) * 2 - 1, b = (j / k) * 2 - 1
      B.v(add(c, add(scale(u, a), scale(v, b))), n, i / k, 1 - j / k)
    }
  }
  const W = k + 1
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const a = base + i * W + j
    B.quad(a, a + W, a + W + 1, a + 1)
  }
}

const PHI = (1 + Math.sqrt(5)) / 2

function platonic(kind: 'tetra' | 'octa' | 'dodeca' | 'icosa', k: number): Builder {
  const B = new Builder()
  if (kind === 'tetra') {
    const p: V3[] = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]
    for (const [a, b, c] of [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]) B.flatTri(p[a], p[b], p[c], k)
  } else if (kind === 'octa') {
    const p: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    for (const [a, b, c] of [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]]) B.flatTri(p[a], p[b], p[c], k)
  } else if (kind === 'icosa') {
    const t = PHI
    const p: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    for (const [a, b, c] of f) B.flatTri(p[a], p[b], p[c], k)
  } else {
    // the dodecahedron : the cube's corners and three golden rectangles; each of its
    // twelve faces is the five corners nearest one face direction (an icosahedron vertex)
    const t = PHI, s = 1 / PHI
    const p: V3[] = []
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) p.push([x, y, z])
    for (const a of [-1, 1]) for (const b of [-1, 1]) { p.push([0, a * s, b * t]); p.push([a * s, b * t, 0]); p.push([a * t, 0, b * s]) }
    // (the face directions are the cyclic turns of (0, phi, 1) : the icosahedron of the
    // other hand would pick five corners that are not one face)
    const dirs: V3[] = []
    for (const a of [-1, 1]) for (const b of [-1, 1]) { dirs.push([0, a * t, b]); dirs.push([a * t, b, 0]); dirs.push([b, 0, a * t]) }
    for (const d0 of dirs) {
      const d = norm(d0)
      const near = p.map((q, i) => ({ i, k: dot(norm(q), d) })).sort((a, b) => b.k - a.k).slice(0, 5).map((e) => p[e.i])
      // in order round the face
      const c = scale(near.reduce((acc, q) => add(acc, q), [0, 0, 0] as V3), 0.2)
      const ax = norm(sub(near[0], c)), ay = cross(d, ax)
      near.sort((a, b) => Math.atan2(dot(sub(a, c), ay), dot(sub(a, c), ax)) - Math.atan2(dot(sub(b, c), ay), dot(sub(b, c), ax)))
      B.flatPoly(near, k)
    }
  }
  return B
}

/** A built-in shape at `seg` segments (where the shape has any) and `thick` (the tube
 *  of the torus and the knot, 0..1). */
export function buildShape(shape: number, seg: number, thick: number): RawMesh {
  const S = Math.max(3, Math.min(256, Math.round(seg)))
  const tk = Math.max(0.03, Math.min(0.95, thick))
  const B = new Builder()
  const name = SHAPES[Math.max(0, Math.min(SHAPES.length - 1, shape))] ?? 'sphere'
  const sub4 = Math.max(1, Math.min(32, Math.round(S / 4)))
  switch (name) {
    case 'sphere': {
      const rings = Math.max(2, Math.round(S / 2))
      const prof = []
      for (let i = 0; i <= rings; i++) {
        const th = (i / rings) * Math.PI
        prof.push({ r: Math.sin(th), y: Math.cos(th), nr: Math.sin(th), ny: Math.cos(th), v: i / rings })
      }
      lathe(B, prof, S)
      break
    }
    case 'capsule': {
      const r = 0.48, half = 0.48
      const hr = Math.max(2, Math.round(S / 4))
      const prof = []
      for (let i = 0; i <= hr; i++) { const th = (i / hr) * Math.PI / 2; prof.push({ r: r * Math.sin(th), y: half + r * Math.cos(th), nr: Math.sin(th), ny: Math.cos(th), v: 0 }) }
      for (let i = 0; i <= hr; i++) { const th = Math.PI / 2 + (i / hr) * Math.PI / 2; prof.push({ r: r * Math.sin(th), y: -half + r * Math.cos(th), nr: Math.sin(th), ny: Math.cos(th), v: 0 }) }
      const total = prof.length - 1
      prof.forEach((q, i) => { q.v = i / total })
      lathe(B, prof, S)
      break
    }
    case 'torus': {
      const R = 1 / (1 + tk), r = tk / (1 + tk)
      const minor = Math.max(3, Math.round(S / 2))
      const base = B.count
      for (let i = 0; i <= S; i++) {
        const a = (i / S) * Math.PI * 2
        for (let j = 0; j <= minor; j++) {
          const b = (j / minor) * Math.PI * 2
          const n: V3 = [Math.cos(b) * Math.cos(a), Math.sin(b), Math.cos(b) * Math.sin(a)]
          B.v([(R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a)], n, i / S, j / minor)
        }
      }
      const W = minor + 1
      for (let i = 0; i < S; i++) for (let j = 0; j < minor; j++) { const a = base + i * W + j; B.quad(a, a + W, a + W + 1, a + 1) }
      break
    }
    case 'cylinder':
    case 'open cylinder': {
      const r = 0.7, h = 0.7
      const prof = []
      for (let i = 0; i <= sub4; i++) prof.push({ r, y: h - (2 * h * i) / sub4, nr: 1, ny: 0, v: i / sub4 })
      lathe(B, prof, S)
      if (name === 'cylinder') { cap(B, r, h, 1, S, Math.max(1, Math.round(sub4 / 2))); cap(B, r, -h, -1, S, Math.max(1, Math.round(sub4 / 2))) }
      break
    }
    case 'cone': {
      const r = 0.8, h = 0.6
      // the side's normal leans up by the slope; the tip's ring is split per slice
      const sl = Math.hypot(r, 2 * h)
      const nr = (2 * h) / sl, ny = r / sl
      const prof = []
      for (let i = 0; i <= sub4 * 2; i++) { const f = i / (sub4 * 2); prof.push({ r: r * f, y: h - 2 * h * f, nr, ny, v: f }) }
      lathe(B, prof, S)
      cap(B, r, -h, -1, S, Math.max(1, sub4))
      break
    }
    case 'cube':
    case 'open cube': {
      const a = 0.577
      const faces: Array<[V3, V3, V3]> = [
        [[0, 0, a], [a, 0, 0], [0, a, 0]], [[0, 0, -a], [-a, 0, 0], [0, a, 0]],
        [[a, 0, 0], [0, 0, -a], [0, a, 0]], [[-a, 0, 0], [0, 0, a], [0, a, 0]],
        [[0, a, 0], [a, 0, 0], [0, 0, -a]], [[0, -a, 0], [a, 0, 0], [0, 0, a]]
      ]
      faces.forEach((f, i) => { if (name === 'cube' || i < 4) gridFace(B, f[0], f[1], f[2], sub4) })
      break
    }
    case 'plane':
      gridFace(B, [0, 0, 0], [0.707, 0, 0], [0, 0.707, 0], Math.max(1, Math.min(128, S)))
      break
    case 'disc': {
      // a disc facing the camera : the cap of a cylinder turned toward +z
      const C = new Builder()
      cap(C, 1, 0, 1, S, Math.max(1, Math.round(S / 4)))
      for (let i = 0; i < C.count; i++) {
        const x = C.pos[i * 3], z = C.pos[i * 3 + 2]
        B.v([x, -z, 0], [0, 0, 1], C.uv[i * 2], C.uv[i * 2 + 1])
      }
      for (let i = 0; i < C.idx.length; i += 3) B.tri(C.idx[i], C.idx[i + 1], C.idx[i + 2])
      break
    }
    case 'tetrahedron':
    case 'octahedron':
    case 'dodecahedron':
    case 'icosahedron': {
      const k = Math.max(1, Math.min(16, Math.round(S / 8)))
      const P = platonic(name === 'tetrahedron' ? 'tetra' : name === 'octahedron' ? 'octa' : name === 'dodecahedron' ? 'dodeca' : 'icosa', k)
      return P.raw(name)
    }
    case 'knot': {
      // the trefoil, a (2, 3) torus knot, as a tube; its frame follows the curve's bend
      const along = S * 4, round = Math.max(4, Math.round(S / 3))
      const rt = 0.08 + 0.32 * tk
      const curve = (t: number): V3 => {
        const q = 3 * t, p = 2 * t
        const rr = 2 + Math.cos(q)
        return [rr * Math.cos(p) * 0.36, Math.sin(q) * 0.36, rr * Math.sin(p) * 0.36]
      }
      const base = B.count
      const e = 1e-3
      for (let i = 0; i <= along; i++) {
        const t = (i / along) * Math.PI * 2
        const c = curve(t)
        const T = norm(sub(curve(t + e), curve(t - e)))
        let N = norm(sub(add(curve(t + e), curve(t - e)), scale(c, 2)))
        const Bn = norm(cross(T, N))
        N = cross(Bn, T)
        for (let j = 0; j <= round; j++) {
          const b = (j / round) * Math.PI * 2
          const n = add(scale(N, Math.cos(b)), scale(Bn, Math.sin(b)))
          B.v(add(c, scale(n, rt)), n, (i / along) * 6, j / round)
        }
      }
      const W = round + 1
      for (let i = 0; i < along; i++) for (let j = 0; j < round; j++) { const a = base + i * W + j; B.quad(a, a + W, a + W + 1, a + 1) }
      break
    }
  }
  return B.raw(name)
}

// ── Preparation ──────────────────────────────────────────────────────────────────

// Welding : vertices at the same place (after the fit) share one id. 17 bits an axis
// over -1..1 (a step of 1.5e-5 of the model's size) keeps the key under 2^53.
function weld(pos: Float32Array): { id: Uint32Array; count: number; first: Uint32Array } {
  const n = pos.length / 3
  const id = new Uint32Array(n)
  const map = new Map<number, number>()
  const firstL: number[] = []
  const Q = 65535
  for (let i = 0; i < n; i++) {
    const qx = Math.round((pos[i * 3] + 1) * Q), qy = Math.round((pos[i * 3 + 1] + 1) * Q), qz = Math.round((pos[i * 3 + 2] + 1) * Q)
    const key = (qx * 131072 + qy) * 131072 + qz
    let w = map.get(key)
    if (w === undefined) { w = firstL.length; map.set(key, w); firstL.push(i) }
    id[i] = w
  }
  return { id, count: firstL.length, first: Uint32Array.from(firstL) }
}

function faceNormals(pos: Float32Array, idx: Uint32Array): { fn: Float32Array; area: Float32Array } {
  const t = idx.length / 3
  const fn = new Float32Array(t * 3), area = new Float32Array(t)
  for (let f = 0; f < t; f++) {
    const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2]
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx
    const l = Math.hypot(x, y, z)
    area[f] = l * 0.5
    if (l > 1e-20) { fn[f * 3] = x / l; fn[f * 3 + 1] = y / l; fn[f * 3 + 2] = z / l }
  }
  return { fn, area }
}

/** Above this many corners at one point, its normal is the plain area-weighted mean. */
const CROWDED = 256

/** Normals for a mesh that came without : each corner the area-weighted mean of the
 *  faces round its point that bend less than the crease angle from its own face (a
 *  hard edge stays hard, a curved surface comes out smooth). Vertices are split where
 *  their corners disagree; with no texture or colors to keep apart, corners at one
 *  point with one normal are merged (an STL lists every triangle on its own). */
function autoNormals(m: { pos: Float32Array; uv: Float32Array | null; col: Uint8Array | null; idx: Uint32Array }, creaseDeg = 40): { pos: Float32Array; nrm: Float32Array; uv: Float32Array | null; col: Uint8Array | null; idx: Uint32Array } {
  const { pos, idx } = m
  const W = weld(pos)
  const { fn, area } = faceNormals(pos, idx)
  // the corners round each welded point (compressed rows)
  const cnt = new Uint32Array(W.count + 1)
  for (let i = 0; i < idx.length; i++) cnt[W.id[idx[i]] + 1]++
  for (let i = 0; i < W.count; i++) cnt[i + 1] += cnt[i]
  const fill = cnt.slice(0, W.count)
  const corners = new Uint32Array(idx.length)
  for (let i = 0; i < idx.length; i++) corners[fill[W.id[idx[i]]]++] = i
  const cosC = Math.cos((creaseDeg * Math.PI) / 180)
  const keepApart = !!(m.uv || m.col)
  const outPos = new GrowF32(pos.length), outN = new GrowF32(pos.length)
  const outUV = m.uv ? new GrowF32(m.uv.length) : null
  const outCol = m.col ? new GrowU8(m.col.length) : null
  const outIdx = new Uint32Array(idx.length)
  const emit = (ov: number, nx: number, ny: number, nz: number): number => {
    const out = outPos.n / 3
    outPos.push3(pos[ov * 3], pos[ov * 3 + 1], pos[ov * 3 + 2])
    outN.push3(nx, ny, nz)
    if (outUV && m.uv) { outUV.push(m.uv[ov * 2]); outUV.push(m.uv[ov * 2 + 1]) }
    if (outCol && m.col) for (let j = 0; j < 4; j++) outCol.push(m.col[ov * 4 + j])
    return out
  }
  // per point, the vertices already made : [orig vertex, nx, ny, nz, out index]
  const made: number[] = []
  const byOv = new Map<number, number>()
  for (let w = 0; w < W.count; w++) {
    // A point a great many faces meet at (a fan's hub, a damaged file's one point
    // under thousands of corners) : comparing every corner with every other would
    // cost their count squared, so it takes the area-weighted mean of all of them.
    if (cnt[w + 1] - cnt[w] > CROWDED) {
      let nx = 0, ny = 0, nz = 0
      for (let k = cnt[w]; k < cnt[w + 1]; k++) {
        const f = (corners[k] / 3) | 0
        nx += fn[f * 3] * area[f]; ny += fn[f * 3 + 1] * area[f]; nz += fn[f * 3 + 2] * area[f]
      }
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l; ny /= l; nz /= l
      byOv.clear()
      let one = -1
      for (let k = cnt[w]; k < cnt[w + 1]; k++) {
        const c = corners[k], ov = idx[c]
        let out = keepApart ? byOv.get(ov) ?? -1 : one
        if (out < 0) {
          out = emit(ov, nx, ny, nz)
          if (keepApart) byOv.set(ov, out)
          else one = out
        }
        outIdx[c] = out
      }
      continue
    }
    made.length = 0
    for (let k = cnt[w]; k < cnt[w + 1]; k++) {
      const c = corners[k], f = (c / 3) | 0
      let nx = 0, ny = 0, nz = 0
      for (let k2 = cnt[w]; k2 < cnt[w + 1]; k2++) {
        const f2 = (corners[k2] / 3) | 0
        const d = fn[f * 3] * fn[f2 * 3] + fn[f * 3 + 1] * fn[f2 * 3 + 1] + fn[f * 3 + 2] * fn[f2 * 3 + 2]
        if (d >= cosC || f2 === f) { nx += fn[f2 * 3] * area[f2]; ny += fn[f2 * 3 + 1] * area[f2]; nz += fn[f2 * 3 + 2] * area[f2] }
      }
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l; ny /= l; nz /= l
      const ov = idx[c]
      let out = -1
      for (let q = 0; q < made.length; q += 5) {
        if (keepApart && made[q] !== ov) continue
        if (made[q + 1] * nx + made[q + 2] * ny + made[q + 3] * nz > 0.9995) { out = made[q + 4]; break }
      }
      if (out < 0) {
        out = emit(ov, nx, ny, nz)
        made.push(ov, nx, ny, nz, out)
      }
      outIdx[c] = out
    }
  }
  return { pos: outPos.done(), nrm: outN.done(), uv: outUV ? outUV.done() : null, col: outCol ? outCol.done() : null, idx: outIdx }
}

/** The edges : one per pair of welded points two faces share, with both faces'
 *  normals (the line looks keep a crease, a silhouette or an open boundary), and
 *  which two faces they are (the shards). */
export function buildEdges(pos: Float32Array, idx: Uint32Array): { edges: Float32Array; faces: Uint32Array } {
  const W = weld(pos)
  const { fn } = faceNormals(pos, idx)
  const t = idx.length / 3
  const map = new Map<number, number>()
  const ea = new GrowU32(t * 2), eb = new GrowU32(t * 2), f0 = new GrowU32(t * 2), f1 = new GrowU32(t * 2)
  const NONE = 0xffffffff
  for (let f = 0; f < t; f++) {
    if (fn[f * 3] === 0 && fn[f * 3 + 1] === 0 && fn[f * 3 + 2] === 0) continue
    for (let k = 0; k < 3; k++) {
      const a = W.id[idx[f * 3 + k]], b = W.id[idx[f * 3 + ((k + 1) % 3)]]
      if (a === b) continue
      const lo = a < b ? a : b, hi = a < b ? b : a
      const key = lo * W.count + hi
      const e = map.get(key)
      if (e === undefined) { map.set(key, ea.n); ea.push(lo); eb.push(hi); f0.push(f); f1.push(NONE) }
      else if (f1.a[e] === NONE) f1.a[e] = f
    }
  }
  const n = ea.n
  const out = new Float32Array(n * 12)
  const faces = new Uint32Array(n * 2)
  for (let e = 0; e < n; e++) {
    faces[e * 2] = f0.a[e]
    faces[e * 2 + 1] = f1.a[e]
    const a = W.first[ea.a[e]] * 3, b = W.first[eb.a[e]] * 3, fa = f0.a[e] * 3, fb = f1.a[e]
    const o = e * 12
    out[o] = pos[a]; out[o + 1] = pos[a + 1]; out[o + 2] = pos[a + 2]
    out[o + 3] = pos[b]; out[o + 4] = pos[b + 1]; out[o + 5] = pos[b + 2]
    out[o + 6] = fn[fa]; out[o + 7] = fn[fa + 1]; out[o + 8] = fn[fa + 2]
    if (fb !== NONE) { out[o + 9] = fn[fb * 3]; out[o + 10] = fn[fb * 3 + 1]; out[o + 11] = fn[fb * 3 + 2] }
  }
  return { edges: out, faces }
}

/** A raw mesh made ready to draw : checked against the caps, centred and fitted to
 *  the unit sphere, its normals, texture coordinates and colors filled in, its edges
 *  listed. Throws with a message for the person when it cannot be drawn. */
export function prepareMesh(raw: RawMesh, withEdges = true): MeshData {
  const notes = [...(raw.notes ?? [])]
  let pos = raw.pos
  let idx = raw.idx && raw.idx.length >= 3 ? raw.idx : null
  // (the file's normals only when there is one a vertex and every one is a number :
  // else the Model makes its own, never a NaN that would black out the shading)
  let nrm = raw.nrm && raw.nrm.length === pos.length && raw.nrm.every(Number.isFinite) ? raw.nrm : null
  if (raw.nrm && !nrm) notes.push('its normals are damaged : the Model made its own')
  let uv = raw.uv && raw.uv.length === (pos.length / 3) * 2 ? raw.uv : null
  let col = raw.col && raw.col.length === (pos.length / 3) * 4 ? raw.col : null
  let vcount = pos.length / 3
  if (!vcount) throw new Error('the file holds no geometry')
  if (idx) {
    if (idx.length % 3) idx = idx.slice(0, idx.length - (idx.length % 3))
    const tris = idx.length / 3
    if (tris > MAX_TRIS) throw new Error(`${tris.toLocaleString('en-US')} triangles : the Model draws up to ${(MAX_TRIS / 1e6).toFixed(0)} million (simplify it in a 3D editor first)`)
    for (let i = 0; i < idx.length; i++) if (idx[i] >= vcount) throw new Error('the file is damaged : a face points past its vertices')
  } else if (vcount > MAX_POINTS) {
    // a scan with more points than the Model draws : every k-th one, evenly
    const k = Math.ceil(vcount / MAX_POINTS)
    const keep = Math.floor(vcount / k)
    const pick = <T extends Float32Array | Uint8Array>(a: T | null, w: number): T | null => {
      if (!a) return null
      const out = new (a.constructor as { new (n: number): T })(keep * w)
      for (let i = 0; i < keep; i++) for (let j = 0; j < w; j++) out[i * w + j] = a[i * k * w + j]
      return out
    }
    pos = pick(pos, 3)!
    nrm = pick(nrm, 3)
    uv = pick(uv, 2)
    col = pick(col, 4)
    notes.push(`${vcount.toLocaleString('en-US')} points : every ${k === 2 ? 'second' : k === 3 ? 'third' : k + 'th'} one drawn`)
    vcount = keep
  }
  // Z up (STL) to Y up
  if (raw.zUp) {
    pos = pos.slice()
    for (let i = 0; i < pos.length; i += 3) { const y = pos[i + 1]; pos[i + 1] = pos[i + 2]; pos[i + 2] = -y }
    if (nrm) { nrm = nrm.slice(); for (let i = 0; i < nrm.length; i += 3) { const y = nrm[i + 1]; nrm[i + 1] = nrm[i + 2]; nrm[i + 2] = -y } }
  }
  // the fit : the box's centre to the origin, the farthest point at 1
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2]
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) throw new Error('the file is damaged : a vertex is not a number')
    if (x < x0) x0 = x; if (x > x1) x1 = x
    if (y < y0) y0 = y; if (y > y1) y1 = y
    if (z < z0) z0 = z; if (z > z1) z1 = z
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2
  let r2 = 0
  for (let i = 0; i < pos.length; i += 3) {
    const dx = pos[i] - cx, dy = pos[i + 1] - cy, dz = pos[i + 2] - cz
    const d = dx * dx + dy * dy + dz * dz
    if (d > r2) r2 = d
  }
  const k = r2 > 0 ? 1 / Math.sqrt(r2) : 1
  const fitted = pos === raw.pos ? new Float32Array(pos.length) : pos
  for (let i = 0; i < pos.length; i += 3) {
    fitted[i] = (pos[i] - cx) * k; fitted[i + 1] = (pos[i + 1] - cy) * k; fitted[i + 2] = (pos[i + 2] - cz) * k
  }
  pos = fitted
  // normals
  if (!nrm && idx) {
    const a = autoNormals({ pos, uv, col, idx })
    pos = a.pos; nrm = a.nrm; uv = a.uv; col = a.col; idx = a.idx
    vcount = pos.length / 3
  } else if (nrm) {
    nrm = nrm === raw.nrm ? nrm.slice() : nrm
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2])
      if (l > 1e-12) { nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l }
    }
  } else {
    nrm = new Float32Array(pos.length) // a point cloud without normals : beads lit as seen
  }
  // A file whose triangles run against its own normals (exported mirrored) : turned
  // over, so its outside is what the camera sees as the front (glass shows its front).
  if (idx && raw.nrm) {
    let agree = 0
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2]
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
      const d = (uy * vz - uz * vy) * (nrm![a] + nrm![b] + nrm![c]) + (uz * vx - ux * vz) * (nrm![a + 1] + nrm![b + 1] + nrm![c + 1]) + (ux * vy - uy * vx) * (nrm![a + 2] + nrm![b + 2] + nrm![c + 2])
      if (d > 0) agree++
    }
    if (agree * 2 < idx.length / 3) {
      idx = idx === raw.idx ? idx.slice() : idx
      for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x }
      notes.push('its faces were turned the wrong way : turned over')
    }
  }
  // texture coordinates : wrapped round it from its centre where the file has none
  const hasUV = !!uv
  if (!uv) {
    uv = new Float32Array(vcount * 2)
    for (let i = 0; i < vcount; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
      const l = Math.hypot(x, y, z) || 1
      uv[i * 2] = 0.5 + Math.atan2(x, z) / (Math.PI * 2)
      uv[i * 2 + 1] = Math.acos(Math.max(-1, Math.min(1, y / l))) / Math.PI
    }
  }
  const hasColor = !!col
  if (!col) col = new Uint8Array(vcount * 4).fill(255).map((v, i) => ((i & 3) === 3 ? 0 : v))
  let hasTex = false
  if (raw.texture) for (let i = 3; i < col.length; i += 4) if (col[i] > 127) { hasTex = true; break }
  // a texture no face uses : its memory let go now
  if (raw.texture && !hasTex) raw.texture.close()
  const tris = idx ? idx.length / 3 : 0
  const ed = withEdges && idx && tris <= MAX_EDGE_TRIS ? buildEdges(pos, idx) : null
  if (idx && tris > MAX_EDGE_TRIS) notes.push('too dense for wireframe and edges : those looks draw it solid')
  return {
    pos, nrm: nrm!, uv, col, idx, edges: ed ? ed.edges : null, edgeFaces: ed ? ed.faces : null,
    texture: hasTex ? raw.texture ?? null : null,
    info: { tris, verts: vcount, points: !idx, hasUV, hasColor, hasTex, hasEdges: !!ed, format: raw.format, notes }
  }
}
