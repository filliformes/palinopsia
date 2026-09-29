// Motion field : dense optical flow on a small grayscale grid, reduced to a
// handful of descriptors (the camera's or the picture's motion, as control).
//
// Three-level pyramidal Lucas–Kanade (Lucas & Kanade 1981; Bouguet's pyramid) : the
// flow is solved at quarter resolution first, then refined level by level on a
// frame warped by it, so a fast hand (several grid cells a frame) is still read.
// Each pixel solves the 2×2 structure-tensor system over a small window, lightly
// regularised so flat, textureless areas read as still instead of as noise.
//
// From the field : quantity and direction of motion, and the two kinematic
// features of the flow gradient that neither a frame difference nor a landmark
// can give : DIVERGENCE (the field spreads out : something approaches the camera,
// arms open) and CURL (the field turns). Both come from an affine model fitted to
// the MOVING pixels (least squares), not from local derivatives : a hand sliding
// across a still room has sharp edges in its field that would read as a squeeze,
// where the fit sees what it is, a translation. They are the camera's reading of the
// motion archetypes the `motion` modulator draws (dilation / contraction /
// rotation). COHERENCE says whether everything moves together (a sweep, a crowd
// walking one way) or in all directions (a dance, a flicker).
//
// Pure and allocation-free after the first frame : the Body camera runs one on a
// 64×48 copy of each new camera frame (~1.6 ms), the vision bus on its 32×32
// sample of the picture (~0.6 ms), both measured in V8.

export interface FlowStats {
  energy: number // 0..1 : how much moves (mean speed over the frame)
  dirX: number // 0..1 : mean horizontal direction, 0.5 still, >0.5 moving right
  dirY: number // 0..1 : mean vertical direction, 0.5 still, >0.5 moving up
  divergence: number // 0..1 : 0.5 none, >0.5 spreading out (approach, opening), <0.5 closing in
  curl: number // 0..1 : 0.5 none, >0.5 turning clockwise on screen, <0.5 counter-clockwise
  coherence: number // 0..1 : 0 scattered motion, 1 everything moving the same way
  centroidX: number // 0..1 : where the motion is, horizontally
  centroidY: number // 0..1 : where the motion is, vertically (0 = top)
  area: number // 0..1 : share of the frame that moves
}

export const STILL: FlowStats = {
  energy: 0, dirX: 0.5, dirY: 0.5, divergence: 0.5, curl: 0.5, coherence: 0,
  centroidX: 0.5, centroidY: 0.5, area: 0
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const bip = (x: number, scale: number): number => 0.5 + 0.5 * Math.tanh(x / scale)

// Gains (per second, frame-size units) : the useful range of each quantity maps
// to most of 0..1. Tuned on synthetic motion (flowField.test) : a whole frame
// panning a quarter-width a second reads ~0.6 energy, a steady 10 %/s zoom or a
// 15°/s turn reads ~0.8.
const G_ENERGY = 0.25 // frame-widths / s of mean speed
const G_DIR = 0.15 // frame-widths / s of mean velocity
const G_DIV = 0.08 // relative expansion / s
const G_CURL = 0.14 // radians / s (curl = 2 × angular speed)
const MOVING = 0.05 // frame-widths / s : a pixel faster than this "moves"
const RIDGE = 0.04 // frame-width² : slope penalty of the affine fit (see below)
const MATCH_ERR = 0.015 // intensity : a pixel this far off its warped match is half-trusted

export class FlowField {
  private w: number
  private h: number
  private has = false
  // Pyramids (level 0 = full resolution) of the previous and current frame, the
  // flow at each level, and scratch.
  private lw: number[] = []
  private lh: number[] = []
  private p0: Float32Array[] = []
  private p1: Float32Array[] = []
  private fu: Float32Array[] = []
  private fv: Float32Array[] = []
  private fc: Float32Array[] = []
  private scratch: Float32Array
  private smooth: FlowStats = { ...STILL }

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    let cw = w, ch = h
    for (let l = 0; l < LEVELS; l++) {
      this.lw.push(cw)
      this.lh.push(ch)
      const n = cw * ch
      this.p0.push(new Float32Array(n))
      this.p1.push(new Float32Array(n))
      this.fu.push(new Float32Array(n))
      this.fv.push(new Float32Array(n))
      this.fc.push(new Float32Array(n))
      cw >>= 1
      ch >>= 1
    }
    this.scratch = new Float32Array(w * h)
  }

  /** Forget the previous frame (a camera switch, a cut). */
  reset(): void {
    this.has = false
    this.smooth = { ...STILL }
  }

  /**
   * Feed one grayscale frame (w×h, 0..1, row-major, row 0 at the TOP unless
   * `bottomUp`) taken `dt` seconds after the previous one. Returns the motion
   * descriptors, lightly smoothed; STILL on the first frame. `mirror` flips the
   * horizontal sense (a selfie camera), so moving right reads as right.
   */
  push(gray: Float32Array, dt: number, bottomUp = false, mirror = false): FlowStats {
    const { w, h } = this
    // Gaussian-ish pyramid : a binomial blur before every decimation (a plain 2x2
    // average aliases fine texture, and the coarse flow then chases false matches).
    blur3(gray, w, h, this.p1[0], this.scratch)
    for (let l = 1; l < LEVELS; l++) {
      halve(this.p1[l - 1], this.lw[l - 1], this.lh[l - 1], this.p1[l])
      blur3(this.p1[l], this.lw[l], this.lh[l], this.p1[l], this.scratch)
    }
    if (!this.has) {
      for (let l = 0; l < LEVELS; l++) this.p0[l].set(this.p1[l])
      this.has = true
      return this.smooth
    }
    const sec = dt > 1e-3 ? Math.min(dt, 0.25) : 1 / 30
    // Coarse to fine : each level starts from the coarser flow, doubled.
    for (let l = LEVELS - 1; l >= 0; l--) {
      const lw = this.lw[l], lh = this.lh[l]
      const u = this.fu[l], v = this.fv[l]
      if (l === LEVELS - 1) {
        u.fill(0)
        v.fill(0)
      } else {
        const cu = this.fu[l + 1], cv = this.fv[l + 1], cw = this.lw[l + 1], chh = this.lh[l + 1]
        for (let y = 0; y < lh; y++) {
          const sy = Math.min(chh - 1, y >> 1)
          for (let x = 0; x < lw; x++) {
            const k = sy * cw + Math.min(cw - 1, x >> 1)
            u[y * lw + x] = cu[k] * 2
            v[y * lw + x] = cv[k] * 2
          }
        }
      }
      const iters = l === 0 ? 1 : 2
      for (let it = 0; it < iters; it++) lk(this.p0[l], this.p1[l], lw, lh, u, v, this.fc[l], this.scratch)
      // A 3×3 median, then a cap, before the flow is doubled for the next level :
      // where a window straddles an edge the solve can throw a wild vector, and
      // doubled twice it lands beyond what the finer passes can pull back.
      median3(u, lw, lh, this.scratch)
      median3(v, lw, lh, this.scratch)
      const cap = 2.5 * (1 << (LEVELS - 1 - l)) // px at this level : a fast hand is 4-8 px at full size
      for (let i = 0; i < lw * lh; i++) {
        const m = Math.hypot(u[i], v[i])
        if (m > cap) {
          u[i] *= cap / m
          v[i] *= cap / m
        }
      }
    }
    // Match quality : warp the frame by the final flow and compare. Pixels the
    // motion covered or uncovered (a hand's edges over the room) have no true
    // match, and their flow is noise : they are down-weighted below.
    {
      const I0 = this.p0[0], I1 = this.p1[0], U0 = this.fu[0], V0 = this.fv[0], E = this.scratch
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          E[i] = Math.abs(sample(I1, w, h, x + U0[i], y + V0[i]) - I0[i])
        }
      }
    }
    // This frame becomes the previous one.
    for (let l = 0; l < LEVELS; l++) {
      const t = this.p0[l]
      this.p0[l] = this.p1[l]
      this.p1[l] = t
    }
    const U = this.fu[0], V = this.fv[0], C = this.fc[0]

    // ── Reduce the field to descriptors (frame-width units per second). ──
    const ys = bottomUp ? -1 : 1 // grid y → screen y (down)
    const xs = mirror ? -1 : 1
    const unit = 1 / (w * sec) // px/frame → frame-widths/s
    let sw = 0, su = 0, sv = 0, sm = 0, cxs = 0, cys = 0, cm = 0, moving = 0, n = 0
    // Affine fit u = a0 + a1·x + a2·y (and v alike) over the moving pixels, in
    // screen-oriented, centred, frame-width coordinates : weighted normal equations.
    let S = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0, Syy = 0
    let Su = 0, Sxu = 0, Syu = 0, Sv = 0, Sxv = 0, Syv = 0
    // A band at the frame edge is left out : content entering the frame has no
    // match in the previous one, and its wrong flow would read as a squeeze.
    const B = Math.max(2, Math.round(w / 16))
    for (let y = B; y < h - B; y++) {
      for (let x = B; x < w - B; x++) {
        const i = y * w + x
        const c = C[i]
        const e = this.scratch[i] / MATCH_ERR
        // Trust : ~0 on flat areas (nothing to track) and where the match failed.
        const wt = c / (c + 2e-4) / (1 + e * e)
        const uu = U[i] * unit * xs
        const vv = V[i] * unit * ys // screen-down positive
        const m = Math.hypot(uu, vv)
        const sxp = xs > 0 ? x : w - 1 - x // screen position
        const syp = ys > 0 ? y : h - 1 - y
        sw += wt
        su += wt * uu
        sv += wt * vv
        sm += wt * m
        if (wt * m > MOVING) moving++
        cxs += wt * m * sxp
        cys += wt * m * syp
        cm += wt * m
        n++
        // Only what clearly moves shapes the fit : the still room's residual noise
        // outnumbers a hand and would read as a squeeze or a turn.
        const g = (m - MOVING) / (2 * MOVING)
        const fw = g <= 0 ? 0 : wt * (g >= 1 ? 1 : g * g * (3 - 2 * g))
        if (fw > 1e-3) {
          const X = (sxp - (w - 1) / 2) / w, Y = (syp - (h - 1) / 2) / w
          S += fw; Sx += fw * X; Sy += fw * Y
          Sxx += fw * X * X; Sxy += fw * X * Y; Syy += fw * Y * Y
          Su += fw * uu; Sxu += fw * X * uu; Syu += fw * Y * uu
          Sv += fw * vv; Sxv += fw * X * vv; Syv += fw * Y * vv
        }
      }
    }
    let div = 0, curl = 0
    const fitN = moving / Math.max(1, n)
    if (S > 1e-3 && fitN > 0.01) {
      // Ridge on the slopes : a compact moving region (a hand) barely determines a
      // gradient, and its edges' errors would read as a strong squeeze or turn. The
      // penalty is small next to the spread of a whole-frame zoom, large next to a
      // hand's, so gradients are believed in proportion to the region's extent.
      const ridge = S * RIDGE
      const af = solve3(S, Sx, Sy, Sxx + ridge, Sxy, Syy + ridge, Su, Sxu, Syu)
      const bf = solve3(S, Sx, Sy, Sxx + ridge, Sxy, Syy + ridge, Sv, Sxv, Syv)
      if (af && bf) {
        // Screen coordinates are y-down : div = du/dx + dv/dy, clockwise curl = dv/dx - du/dy.
        const gate = Math.min(1, fitN / 0.05) // fade in as more of the frame moves
        div = (af[1] + bf[2]) * gate
        curl = (bf[1] - af[2]) * gate
      }
    }
    const coherence = sm > 1e-6 ? clamp01(Math.hypot(su, sv) / sm) * clamp01((sm / n) / (G_ENERGY * 0.1)) : 0
    // A field that is mostly one translation (a hand sliding across, a pan) says
    // little about spreading or turning, and the edges it covers and uncovers bias
    // the fit : believe divergence and curl less the more coherent the motion is.
    // Real approaches and turns are incoherent (every direction at once) and pass.
    const kin = 1 - coherence * coherence
    const raw: FlowStats = {
      energy: clamp01(Math.tanh((sw > 0 ? sm / n : 0) / G_ENERGY)),
      dirX: bip(sw > 0 ? su / n : 0, G_DIR),
      dirY: bip(sw > 0 ? -sv / n : 0, G_DIR), // up positive
      divergence: bip(div * kin, G_DIV),
      curl: bip(curl * kin, G_CURL),
      coherence,
      centroidX: cm > 1e-6 ? clamp01(cxs / cm / (w - 1)) : 0.5,
      centroidY: cm > 1e-6 ? clamp01(cys / cm / (h - 1)) : 0.5,
      area: n ? clamp01(moving / n) : 0
    }
    // Light smoothing : the per-frame field is noisy; modulators smooth further.
    const s = this.smooth
    const a = 0.5
    for (const k in raw) {
      const key = k as keyof FlowStats
      s[key] += (raw[key] - s[key]) * a
    }
    return s
  }
}

const LEVELS = 3

/** Solve the symmetric 3×3 normal equations [S Sx Sy; Sx Sxx Sxy; Sy Sxy Syy]·p = r
 *  (Cramer's rule); null when degenerate (the moving pixels all on one line). */
function solve3(
  S: number, Sx: number, Sy: number, Sxx: number, Sxy: number, Syy: number,
  r0: number, r1: number, r2: number
): [number, number, number] | null {
  const d = S * (Sxx * Syy - Sxy * Sxy) - Sx * (Sx * Syy - Sxy * Sy) + Sy * (Sx * Sxy - Sxx * Sy)
  if (Math.abs(d) < 1e-12) return null
  const d0 = r0 * (Sxx * Syy - Sxy * Sxy) - Sx * (r1 * Syy - Sxy * r2) + Sy * (r1 * Sxy - Sxx * r2)
  const d1 = S * (r1 * Syy - r2 * Sxy) - r0 * (Sx * Syy - Sxy * Sy) + Sy * (Sx * r2 - r1 * Sy)
  const d2 = S * (Sxx * r2 - Sxy * r1) - Sx * (Sx * r2 - r1 * Sy) + r0 * (Sx * Sxy - Sxx * Sy)
  return [d0 / d, d1 / d, d2 / d]
}

/** In-place 3×3 median (clamped edges), `tmp` holds a copy. */
function median3(a: Float32Array, w: number, h: number, tmp: Float32Array): void {
  tmp.set(a.subarray(0, w * h))
  const win = MED_WIN
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let k = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx
          win[k++] = tmp[yy * w + xx]
        }
      }
      // Partial insertion sort : the 5th smallest of 9.
      for (let i = 1; i < 9; i++) {
        const t = win[i]
        let j = i - 1
        while (j >= 0 && win[j] > t) {
          win[j + 1] = win[j]
          j--
        }
        win[j + 1] = t
      }
      a[y * w + x] = win[4]
    }
  }
}
const MED_WIN = new Float32Array(9)

/** Separable [1 2 1]/4 blur (clamped edges); `dst` may be `src`. */
function blur3(src: Float32Array, w: number, h: number, dst: Float32Array, tmp: Float32Array): void {
  for (let y = 0; y < h; y++) {
    const r = y * w
    for (let x = 0; x < w; x++) {
      const l = src[r + (x > 0 ? x - 1 : x)], c = src[r + x], rr = src[r + (x < w - 1 ? x + 1 : x)]
      tmp[r + x] = (l + 2 * c + rr) * 0.25
    }
  }
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w, r = y * w, dn = (y < h - 1 ? y + 1 : y) * w
    for (let x = 0; x < w; x++) dst[r + x] = (tmp[up + x] + 2 * tmp[r + x] + tmp[dn + x]) * 0.25
  }
}

/** Box-average a w×h grid down to (w>>1)×(h>>1). */
function halve(src: Float32Array, w: number, h: number, dst: Float32Array): void {
  const hw = w >> 1, hh = h >> 1
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const i = 2 * y * w + 2 * x
      dst[y * hw + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]) * 0.25
    }
  }
}

/** Bilinear sample with clamped edges. */
function sample(img: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0) x = 0
  else if (x > w - 1) x = w - 1
  if (y < 0) y = 0
  else if (y > h - 1) y = h - 1
  const x0 = x | 0, y0 = y | 0
  const x1 = x0 < w - 1 ? x0 + 1 : x0
  const y1 = y0 < h - 1 ? y0 + 1 : y0
  const fx = x - x0, fy = y - y0
  const a = img[y0 * w + x0], b = img[y0 * w + x1]
  const c = img[y1 * w + x0], d = img[y1 * w + x1]
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy
}

/**
 * One Lucas–Kanade refinement : `u`/`v` hold the prior flow (px) and receive
 * prior + residual. `I1` is warped back by the prior, the 2×2 system is summed
 * over a 5×5 window and regularised. `conf` receives the smaller eigenvalue of
 * the structure tensor (how trackable each pixel is).
 */
function lk(
  I0: Float32Array, I1: Float32Array, w: number, h: number,
  u: Float32Array, v: Float32Array, conf: Float32Array, scratch: Float32Array
): void {
  // I1 warped by the prior flow : I1(x + u, y + v).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      scratch[i] = sample(I1, w, h, x + u[i], y + v[i])
    }
  }
  const R = 2
  const lambda = 1e-4
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy
        if (yy < 1 || yy > h - 2) continue
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx
          if (xx < 1 || xx > w - 2) continue
          const k = yy * w + xx
          // Gradients of the mean of both frames (symmetric : less bias).
          const ix = ((I0[k + 1] - I0[k - 1]) + (scratch[k + 1] - scratch[k - 1])) * 0.25
          const iy = ((I0[k + w] - I0[k - w]) + (scratch[k + w] - scratch[k - w])) * 0.25
          const it = scratch[k] - I0[k]
          a11 += ix * ix
          a12 += ix * iy
          a22 += iy * iy
          b1 += ix * it
          b2 += iy * it
        }
      }
      const i = y * w + x
      const t11 = a11 + lambda, t22 = a22 + lambda
      const det = t11 * t22 - a12 * a12
      const tr = a11 + a22
      conf[i] = Math.max(0, (tr - Math.sqrt(Math.max(0, (a11 - a22) * (a11 - a22) + 4 * a12 * a12))) * 0.5)
      if (det <= 1e-12) continue
      // Residual that brings the warped I1 back onto I0 : (A)·d = −b.
      const du = -(t22 * b1 - a12 * b2) / det
      const dv = -(t11 * b2 - a12 * b1) / det
      // A single step never moves more than 2 px (the linearisation's range).
      u[i] += du > 2 ? 2 : du < -2 ? -2 : du
      v[i] += dv > 2 ? 2 : dv < -2 ? -2 : dv
    }
  }
}
