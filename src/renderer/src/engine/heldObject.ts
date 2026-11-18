// A 3D object you can take in hand (the Model, Grid Mesh) : how the hand holds it,
// and what part of the picture it covers, for pointerInput.ts (drag to turn it,
// the wheel to bring it nearer).
//
// - HOW IT IS HELD : one hidden input, `orient`, a unit quaternion [x, y, z, w]
//   saved with the slot like any input (sessions, scenes, morphs, undo). It is the
//   OUTERMOST turn, round the object's center in the camera's own axes : a drag
//   turns it round the screen's up and right axes, whatever it already shows, and
//   everything the object does by itself (its spin, TURN, TILT, ROLL) happens in
//   the hand, so the spin goes on from wherever the hand left it. Absent (every
//   session and preset made before) it is no turn at all : the look is unchanged.
//   Euler angles could not carry this : a free turn written back into turn / tilt
//   / roll jumps through them (the gimbal), and fights a modulator on any of them.
// - WHAT IT COVERS : a coarse cover of the frame (cells about 1/128 of its width)
//   filled from the very projection the engine drew its last frame with, rebuilt
//   only when asked and at most every 120 ms (only while a pointer is over the
//   preview). Exact enough to tell two objects apart and the object from empty
//   picture, and never a readback of the picture (that would stall the GPU).

export type Quat = [number, number, number, number]
export const QUAT_ID: Quat = [0, 0, 0, 1]

/** The slot's `orient`, made safe : a unit quaternion, no turn when absent or bad. */
export function quatIn(v: unknown): Quat {
  if (!Array.isArray(v) || v.length < 4) return QUAT_ID
  const x = Number(v[0]), y = Number(v[1]), z = Number(v[2]), w = Number(v[3])
  const l = Math.hypot(x, y, z, w)
  if (!Number.isFinite(l) || l < 1e-6) return QUAT_ID
  return [x / l, y / l, z / l, w / l]
}

/** a then b on the outside : the turn b applied after a. */
export function quatMul(b: Quat, a: Quat): Quat {
  const [bx, by, bz, bw] = b, [ax, ay, az, aw] = a
  return [
    bw * ax + bx * aw + by * az - bz * ay,
    bw * ay - bx * az + by * aw + bz * ax,
    bw * az + bx * ay - by * ax + bz * aw,
    bw * aw - bx * ax - by * ay - bz * az
  ]
}

/** One frame height of drag turns it half a turn. */
const TURN_PER_HEIGHT = Math.PI

/** The hand's turn after a drag of (dx, dy) frame heights (x right, y up) : round
 *  the screen's up axis for the horizontal part, its right axis for the vertical,
 *  one turn round the axis across the drag for a diagonal (a trackball). */
export function dragTurn(q: Quat, dx: number, dy: number): Quat {
  const len = Math.hypot(dx, dy)
  if (!(len > 1e-7)) return q
  const ang = len * TURN_PER_HEIGHT
  // the axis across the drag, in the screen plane : (-dy, dx, 0) / len
  const s = Math.sin(ang / 2) / len
  const d: Quat = [-dy * s, dx * s, 0, Math.cos(ang / 2)]
  return quatIn(quatMul(d, q))
}

/** The turn as a 4x4 matrix (column-major, the engines' own layout). */
export function quatMat4(q: Quat): Float32Array {
  const [x, y, z, w] = q
  const m = new Float32Array(16)
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + z * w); m[2] = 2 * (x * z - y * w)
  m[4] = 2 * (x * y - z * w); m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z + x * w)
  m[8] = 2 * (x * z + y * w); m[9] = 2 * (y * z - x * w); m[10] = 1 - 2 * (x * x + y * y)
  m[15] = 1
  return m
}

/** True when the turn is none at all (the engines then skip it : bit for bit as before). */
export const isNoTurn = (q: Quat): boolean => q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1

/** Past this (clip space), a vertex is too near the camera's plane to be worth
 *  covering : a triangle spanning the whole grid from one would cost every cell. */
const FAR_NDC = 50

/** What part of the frame an object covers, on a coarse grid (v up). */
export class HitCover {
  private W = 0
  private H = 0
  private bits = new Uint8Array(0)
  private builtAt = -1e9
  /** Anything covered at all (an object off frame covers nothing). */
  any = false

  /** Older than `ms` : the engine fills it again before a hit is read. */
  stale(ms = 120): boolean {
    return performance.now() - this.builtAt > ms
  }

  /** Start a fresh cover for a frame of this aspect (width / height). */
  begin(aspect: number): void {
    const W = 128
    const H = Math.max(24, Math.min(256, Math.round(W / Math.max(0.2, aspect))))
    if (W * H !== this.bits.length) this.bits = new Uint8Array(W * H)
    else this.bits.fill(0)
    this.W = W
    this.H = H
    this.any = false
    this.builtAt = performance.now()
  }

  private mark(i: number, j: number): void {
    if (i < 0 || j < 0 || i >= this.W || j >= this.H) return
    this.bits[j * this.W + i] = 1
    this.any = true
  }

  /** A triangle, its corners in clip space (-1..1). */
  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void {
    if (!(Math.max(Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by), Math.abs(cx), Math.abs(cy)) < FAR_NDC)) return
    const W = this.W, H = this.H
    const px = (x: number): number => (x * 0.5 + 0.5) * W
    const py = (y: number): number => (y * 0.5 + 0.5) * H
    const x0 = px(ax), y0 = py(ay), x1 = px(bx), y1 = py(by), x2 = px(cx), y2 = py(cy)
    const i0 = Math.max(0, Math.floor(Math.min(x0, x1, x2))), i1 = Math.min(W - 1, Math.floor(Math.max(x0, x1, x2)))
    const j0 = Math.max(0, Math.floor(Math.min(y0, y1, y2))), j1 = Math.min(H - 1, Math.floor(Math.max(y0, y1, y2)))
    if (i0 > i1 || j0 > j1) return
    // a small one (the usual : a dense mesh) : its whole box
    if ((i1 - i0 + 1) * (j1 - j0 + 1) <= 4) {
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.mark(i, j)
      return
    }
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    if (Math.abs(area) < 1e-9) { this.segPx(x0, y0, x1, y1); this.segPx(x1, y1, x2, y2); return }
    for (let j = j0; j <= j1; j++) {
      const qy = j + 0.5
      for (let i = i0; i <= i1; i++) {
        const qx = i + 0.5
        const w0 = (x2 - x1) * (qy - y1) - (y2 - y1) * (qx - x1)
        const w1 = (x0 - x2) * (qy - y2) - (y0 - y2) * (qx - x2)
        const w2 = (x1 - x0) * (qy - y0) - (y1 - y0) * (qx - x0)
        if (area > 0 ? w0 >= 0 && w1 >= 0 && w2 >= 0 : w0 <= 0 && w1 <= 0 && w2 <= 0) this.mark(i, j)
      }
    }
    // (a sliver thinner than a cell : its corners at least)
    this.mark(Math.floor(x0), Math.floor(y0)); this.mark(Math.floor(x1), Math.floor(y1)); this.mark(Math.floor(x2), Math.floor(y2))
  }

  private segPx(x0: number, y0: number, x1: number, y1: number): void {
    const n = Math.min(4096, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1)
    for (let k = 0; k <= n; k++) {
      const t = k / n
      this.mark(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t))
    }
  }

  /** A line, its ends in clip space. */
  seg(ax: number, ay: number, bx: number, by: number): void {
    if (!(Math.max(Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by)) < FAR_NDC)) return
    const W = this.W, H = this.H
    this.segPx((ax * 0.5 + 0.5) * W, (ay * 0.5 + 0.5) * H, (bx * 0.5 + 0.5) * W, (by * 0.5 + 0.5) * H)
  }

  /** A point in clip space, `r` its radius in frame heights. */
  dot(x: number, y: number, r = 0): void {
    if (!(Math.abs(x) < FAR_NDC && Math.abs(y) < FAR_NDC)) return
    const W = this.W, H = this.H
    const ci = (x * 0.5 + 0.5) * W, cj = (y * 0.5 + 0.5) * H
    const rc = Math.min(8, r * H)
    if (rc < 0.75) { this.mark(Math.floor(ci), Math.floor(cj)); return }
    for (let j = Math.floor(cj - rc); j <= Math.floor(cj + rc); j++)
      for (let i = Math.floor(ci - rc); i <= Math.floor(ci + rc); i++)
        if (Math.hypot(i + 0.5 - ci, j + 0.5 - cj) <= rc + 0.5) this.mark(i, j)
  }

  /** Is the frame point (u, v : 0..1, v up) on the object (a cell's reach of slack). */
  hit(u: number, v: number, reach = 1): boolean {
    if (!this.any) return false
    const i = Math.floor(u * this.W), j = Math.floor(v * this.H)
    for (let dj = -reach; dj <= reach; dj++) {
      const y = j + dj
      if (y < 0 || y >= this.H) continue
      for (let di = -reach; di <= reach; di++) {
        const x = i + di
        if (x >= 0 && x < this.W && this.bits[y * this.W + x]) return true
      }
    }
    return false
  }
}

/** The sources the hand can hold, and their hidden inputs at rest : a preset or the
 *  Inspector's reset (↺) puts the object back as the preset or the factory shows it. */
export const HELD_AT_REST: Readonly<Record<string, Readonly<Record<string, number[]>>>> = {
  'gen-model': { orient: [0, 0, 0, 1] },
  'gen-gridmesh': { orient: [0, 0, 0, 1] }
}
