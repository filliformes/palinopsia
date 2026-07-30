// Assemble — unit selection, the corpus map, and the time curves.
//
// The selection model is CataRT's, ported : every candidate unit is scored by a
// TARGET COST (how far it sits from the point we want in descriptor space) plus
// a CONCATENATION COST (how the join with the previous clip reads). Greedy
// nearest-neighbour rather than a Viterbi path — the same trade Schwarz made
// moving from Caterpillar to CataRT, and for the same reason: in 'live' mode the
// target isn't known in advance, so global optimisation has nothing to optimise.
//
// The similarity↔contrast dial is the one twist. Rather than always minimising
// the concatenation cost, it names a DESIRED join distance : 0 asks for the
// nearest neighbour (clips morph into each other), 1 asks for the farthest
// (every cut is a slap), and the middle asks for a mid-distance neighbour.

import {
  DESC_N,
  LIVE_DESC_N,
  distance,
  zscore,
  type AssembleClip,
  type AssembleCorpus,
  type AssembleParams,
  type AssembleUnit,
  type CurveShape
} from '@shared/assemble'

/**
 * Pick one candidate by Boltzmann sampling over cost — Schödl's eq. (2),
 * `P_ij ∝ exp(−D_{i+1,j}/σ)`, normalised over the row.
 *
 * `variety` is σ, expressed relative to the corpus's own distance scale so it
 * means the same thing on any folder. Schödl: "smaller values of σ emphasize
 * just the very best transitions, while larger values allow for greater variety
 * at the cost of poorer transitions." A top-k uniform draw (what this used to
 * do) is wrong for the same reason: it makes the best and the k-th best
 * candidate equally likely, so a clear winner gets diluted by also-rans.
 */
export function boltzmannPick(
  scored: Array<{ i: number; cost: number }>,
  sigma: number,
  rnd: number
): number {
  if (!scored.length) return -1
  let best = scored[0]
  for (const s of scored) if (s.cost < best.cost) best = s;
  if (sigma <= 1e-6) return best.i // σ→0 : always the single best transition
  // Offsetting by the minimum before exp() is the standard softmax
  // stabilisation — it cancels in the normalisation and stops exp() underflow
  // from making every weight zero.
  let total = 0
  const w = new Array<number>(scored.length)
  for (let k = 0; k < scored.length; k++) {
    w[k] = Math.exp(-(scored[k].cost - best.cost) / sigma)
    total += w[k]
  }
  if (!(total > 0)) return best.i
  let r = rnd * total
  for (let k = 0; k < scored.length; k++) {
    r -= w[k]
    if (r <= 0) return scored[k].i
  }
  return best.i
}

// ── Seeded RNG ───────────────────────────────────────────────────────────
// Generation must be reproducible : an assemblage saves its seed, and Variation
// is nothing more than the same recipe re-rolled at a neighbouring seed.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Time curves ──────────────────────────────────────────────────────────

/** Evaluate a curve shape at sequence position t (0..1) → 0..1. */
export function curveAt(shape: CurveShape, t: number, rnd = 0): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  switch (shape) {
    case 'rise':
      return x
    case 'fall':
      return 1 - x
    case 'accel':
      return x * x // slow start, late rush
    case 'decel':
      return 1 - (1 - x) * (1 - x)
    case 'arch':
      return Math.sin(x * Math.PI) // out and back
    case 'valley':
      return 1 - Math.sin(x * Math.PI)
    case 'scurve':
      return x * x * (3 - 2 * x)
    case 'step':
      return x < 0.5 ? 0 : 1
    case 'random':
      return rnd
    case 'flat':
    default:
      return 0.5
  }
}

/**
 * Turn a curve reading into a multiplier. Neutral (0.5) is always 1×; `amount`
 * opens the range symmetrically in octaves, so the curve dilates and compresses
 * time by the same factor either side of neutral.
 */
export function curveMul(shape: CurveShape, t: number, amount: number, rnd = 0): number {
  const c = curveAt(shape, t, rnd)
  return Math.pow(2, (c - 0.5) * 2 * amount * 3) // ±3 octaves at amount 1
}

// ── The corpus map (PCA) ─────────────────────────────────────────────────

/**
 * Project the corpus onto its two principal axes, normalized to 0..1, for the
 * scatter plot and for trajectory endpoints.
 *
 * Power iteration with deflation : ~30 lines, no dependency, and more than
 * adequate for a hand-designed ~15-dimensional descriptor space. (t-SNE/UMAP
 * earn their complexity on raw high-dimensional embeddings, not here.)
 */
export function corpusMap(
  units: AssembleUnit[],
  mean: number[],
  std: number[]
): { pos: Array<[number, number]>; axes: [number[], number[]] } {
  const n = units.length
  const zs = units.map((u) => zscore(u.desc, mean, std))
  const cov: number[][] = Array.from({ length: DESC_N }, () => new Array<number>(DESC_N).fill(0))
  for (const z of zs) {
    for (let i = 0; i < DESC_N; i++) for (let j = i; j < DESC_N; j++) cov[i][j] += z[i] * z[j];
  }
  for (let i = 0; i < DESC_N; i++) {
    for (let j = i; j < DESC_N; j++) {
      cov[i][j] /= Math.max(1, n)
      cov[j][i] = cov[i][j]
    }
  }

  const mulv = (m: number[][], v: number[]): number[] => {
    const out = new Array<number>(DESC_N).fill(0)
    for (let i = 0; i < DESC_N; i++) {
      let s = 0
      for (let j = 0; j < DESC_N; j++) s += m[i][j] * v[j];
      out[i] = s
    }
    return out
  }
  const norm = (v: number[]): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0))

  // Project `v` off `against` and renormalise (Gram-Schmidt).
  const orthonormal = (v: number[], against: number[] | null): number[] => {
    let out = v
    if (against) {
      const d = out.reduce((s, x, i) => s + x * against[i], 0)
      out = out.map((x, i) => x - d * against[i])
    }
    const n2 = norm(out)
    return n2 > 1e-9 ? out.map((x) => x / n2) : out
  }

  const power = (
    m: number[][],
    against: number[] | null = null,
    iters = 80
  ): { vec: number[]; val: number } => {
    // A fixed non-degenerate start beats Math.random() here : the map must be
    // identical every time the same corpus is opened.
    let v = orthonormal(
      Array.from({ length: DESC_N }, (_, i) => Math.sin(i * 1.7 + 0.3)),
      against
    )
    let val = 0
    for (let k = 0; k < iters; k++) {
      // Re-orthogonalising each step keeps the 2nd component from drifting back
      // onto the 1st when λ1 ≈ λ2, and — critically — means the early-out below
      // returns a vector that is still perpendicular to it. Returning the raw
      // start vector instead (as this did) collapsed a rank-1 corpus's map onto
      // a diagonal line rather than spreading it along one axis.
      const w = orthonormal(mulv(m, v), against)
      const nv = norm(mulv(m, v))
      if (nv < 1e-9) return { vec: v, val: 0 }
      v = w
      val = nv
    }
    return { vec: v, val }
  }

  const p1 = power(cov)
  // Deflate the dominant component so the second iteration finds the next axis.
  const cov2 = cov.map((row, i) => row.map((x, j) => x - p1.val * p1.vec[i] * p1.vec[j]))
  const p2 = power(cov2, p1.vec)

  const raw = zs.map(
    (z) =>
      [
        z.reduce((s, x, i) => s + x * p1.vec[i], 0),
        z.reduce((s, x, i) => s + x * p2.vec[i], 0)
      ] as [number, number]
  )
  // Normalize to 0..1 with a small margin so points don't sit on the frame.
  const fit = (vals: number[]): ((v: number) => number) => {
    // reduce, not Math.min(...vals) : spreading one argument per unit blows the
    // call stack somewhere north of ~100k units.
    let lo = Infinity
    let hi = -Infinity
    for (const v of vals) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const span = hi - lo
    return span > 1e-6 ? (v) => 0.04 + ((v - lo) / span) * 0.92 : () => 0.5
  }
  const fx = fit(raw.map((r) => r[0]))
  const fy = fit(raw.map((r) => r[1]))
  return { pos: raw.map((r) => [fx(r[0]), fy(r[1])] as [number, number]), axes: [p1.vec, p2.vec] }
}

// ── Generation ───────────────────────────────────────────────────────────

const MAX_CLIPS = 600

/**
 * The corpus's typical JOIN distance : the mean of `distance(tail_a, head_b)`
 * over a random sample of ordered pairs. This is the scale everything about
 * cutting is expressed in — the contrast dial asks for a fraction of it, and σ
 * is a multiple of it — so "similar" and "contrasting" mean the same thing
 * whether the corpus is thirty near-identical takes or a wild mixed bag.
 */
export function joinScale(
  zTail: number[][],
  zHead: number[][],
  w: number[],
  rng: () => number
): number {
  const n = zTail.length
  if (n < 2) return 1
  let s = 0
  const N = Math.min(400, n * 4)
  for (let k = 0; k < N; k++) {
    const a = (rng() * n) | 0
    let b = (rng() * n) | 0
    if (b === a) b = (a + 1) % n // a unit joined to itself is not a transition
    s += distance(zTail[a], zHead[b], w)
  }
  return Math.max(1e-3, (s / N) * 1.4)
}

export interface GenerateInput {
  corpus: AssembleCorpus
  params: AssembleParams
  seed: number
  /** PCA positions, so trajectory endpoints given in map space can be honoured. */
  map: Array<[number, number]>
  /** Live descriptor target (first LIVE_DESC_N axes) for 'live' mode; the
   *  generated edit then follows whatever the instrument was showing. */
  liveTarget?: number[] | null
}

/**
 * Build the edit decision list.
 *
 * Clips are chosen one at a time; each is given a screen duration from the
 * length curve and a playback rate from the speed curve. The two are
 * independent by design — a clip can be held long AND run fast, which is where
 * the interesting time-dilation lives.
 */
export function generate({ corpus, params, seed, map, liveTarget }: GenerateInput): AssembleClip[] {
  const { units, mean, std } = corpus
  if (!units.length) return []
  const rng = mulberry32(seed)
  const z = units.map((u) => zscore(u.desc, mean, std))
  // Join vectors : how each unit ENDS and how each unit BEGINS. Older caches
  // predate these, so fall back to the unit mean.
  const zTail = units.map((u) => zscore(u.tail ?? u.desc, mean, std))
  const zHead = units.map((u) => zscore(u.head ?? u.desc, mean, std))
  const w = params.weights.length === DESC_N ? params.weights : new Array<number>(DESC_N).fill(1)

  // Reference scale for both the contrast dial and σ. Schödl sets σ from the
  // average of the TRANSITION matrix D, so this must be sampled over actual
  // joins — tail of one unit against head of another — not over unit means.
  // (Measuring it on the means was a real bug: a corpus whose shots all average
  // alike but begin and end very differently would collapse the dial to zero.)
  const dRef = joinScale(zTail, zHead, w, rng)

  // Trajectory endpoints are given in MAP space; convert to a target by finding
  // the units nearest those points and using their descriptor vectors.
  const nearestZ = (pt: [number, number]): number[] => {
    let best = 0
    let bd = Infinity
    for (let i = 0; i < map.length; i++) {
      const d = (map[i][0] - pt[0]) ** 2 + (map[i][1] - pt[1]) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return z[best]
  }
  const trajA = params.mode === 'trajectory' ? nearestZ(params.trajFrom) : null
  const trajB = params.mode === 'trajectory' ? nearestZ(params.trajTo) : null

  const clips: AssembleClip[] = []
  const recent: number[] = []
  let prev: number[] | null = null
  let t = 0
  const total = Math.max(1, params.duration)

  while (t < total && clips.length < MAX_CLIPS) {
    const progress = t / total

    // Where in descriptor space do we want to be at this moment?
    let target: number[] | null = null
    // Weights for the TARGET term only. In live mode the vision bus supplies
    // just the first LIVE_DESC_N axes, and leaving the rest at z=0 is NOT "no
    // pull" — z=0 is the corpus mean, so a distinctively grainy or bursty shot
    // gets penalised on axes the live target knows nothing about (and turning
    // its weight UP made it worse). Zero those weights instead.
    let tw = w
    if (params.mode === 'trajectory' && trajA && trajB) {
      target = trajA.map((a, i) => a + (trajB[i] - a) * progress)
    } else if (params.mode === 'live' && liveTarget && liveTarget.length) {
      target = new Array<number>(DESC_N).fill(0)
      const n = Math.min(liveTarget.length, LIVE_DESC_N)
      for (let i = 0; i < n; i++) target[i] = (liveTarget[i] - mean[i]) / std[i];
      tw = w.map((x, i) => (i < n ? x : 0))
    }

    const wantJoin = params.contrast * dRef
    const scored: Array<{ i: number; cost: number }> = []
    for (let i = 0; i < units.length; i++) {
      if (recent.includes(i)) continue
      // Target cost : does this unit sit where we want to be in the space?
      const tc = target ? distance(z[i], target, tw) : 0
      // Concatenation cost : how does the cut itself read? Compares how the
      // previous clip ENDS to how this one BEGINS (Schödl's successor rule),
      // then measures that against the distance the contrast dial asked for.
      const cc = prev ? Math.abs(distance(zHead[i], prev, w) - wantJoin) : 0
      scored.push({ i, cost: tc + cc })
    }
    if (!scored.length) {
      // Everything is inside the no-repeat window (a tiny corpus) : clear it
      // rather than stall, so a 5-unit folder still produces an edit.
      recent.length = 0
      continue
    }
    // Boltzmann draw over the costs : σ from the variety dial, scaled by the
    // corpus's own distance spread (Schödl sets σ from the mean of D).
    const bestIdx = boltzmannPick(scored, params.variety * dRef * 0.5, rng())
    if (bestIdx < 0) {
      recent.length = 0
      continue
    }

    const u = units[bestIdx]
    const lenMul = curveMul(params.lenShape, progress, params.lenAmount, rng())
    const spdMul = curveMul(params.spdShape, progress, params.spdAmount, rng())
    // Drawn unconditionally so a given seed replays identically whatever the
    // parameters (conditional draws would shift every later draw).
    const offsetDraw = rng()
    const speed = Math.min(8, Math.max(0.1, spdMul))
    // The CUT dial : 0 = the shot's own analysed length, else an absolute base
    // in seconds. The length curve breathes around whichever base is chosen.
    const base = params.baseCut > 0 ? params.baseCut : u.dur
    const durSec = Math.min(20, Math.max(0.05, base * lenMul))
    // When the cut is shorter than the shot, start it at a seeded random
    // moment INSIDE the shot — thirty 0.3s cuts of the same few opening
    // frames would read as a stutter, not an edit. Then keep the in-point
    // inside the file even when speed eats source fast.
    const consumed = durSec * speed
    const slack = Math.max(0, u.dur - consumed)
    const inSec = Math.max(0, Math.min(u.start + offsetDraw * slack, Math.max(0, u.fileDur - consumed)))

    clips.push({ unitId: u.id, file: u.file, fileName: u.fileName, inSec, durSec, speed })
    t += durSec
    prev = zTail[bestIdx] // the next join is measured from how THIS clip ends
    recent.push(bestIdx)
    while (recent.length > Math.min(params.noRepeat, Math.max(0, units.length - 2))) recent.shift();
  }
  // No silent caps : if the clip ceiling stopped us short of the requested
  // length, say so rather than quietly returning a shorter edit.
  if (clips.length >= MAX_CLIPS && t < total * 0.95) {
    console.warn(
      `[assemble] hit the ${MAX_CLIPS}-clip ceiling at ${t.toFixed(1)}s of a ` +
        `${total}s target — the corpus's units are very short. Raise the cut-length ` +
        `curve or the segmentation's minimum unit for a longer edit.`
    )
  }
  // Trim the last clip so the edit lands ON the requested duration instead of
  // overshooting it by up to a whole clip (which could be 20s).
  const last = clips[clips.length - 1]
  if (last && t > total) {
    const over = t - total
    if (last.durSec - over >= 0.08) last.durSec = last.durSec - over
  }
  return clips
}

/** Total screen time of an edit. */
export const edlDuration = (clips: AssembleClip[]): number =>
  clips.reduce((s, c) => s + c.durSec, 0)
