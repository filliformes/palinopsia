// The Metasurface (Bencina, NIME 2005) : a CONTINUOUS scene-space. Scenes are points
// on a 2D plane; a cursor (x,y) blends between them by Gaussian weight, so dragging
// navigates smoothly through the bank instead of stepping scene-to-scene.
//
// STRUCTURE (shader ids, counts, enums, bools, modulator types) can't interpolate, so
// it SNAPS to the NEAREST scene; only NUMERIC params ease, and only across the scenes
// that SHARE that structure at each slot (a Datamosh's `refresh` means nothing to a
// Blur — a param only blends between scenes running the same shader there). The result
// is fed to the engine each frame while the Surface is active, down the same
// interpolated-composition path the global Morph already uses (zero React churn).

import type { CompositionState, FxInstance, LayerState, SceneEntry, SourceSlot } from '@shared/types'

interface Contrib {
  c: CompositionState
  w: number
}

/** How many nearest scenes contribute to a blend (a local natural-neighbour-ish
 *  neighbourhood). The support radius is adaptive : the distance to the K-th
 *  nearest scene, so density sets locality rather than a fixed radius. */
const SURFACE_K = 6

/** Locally-supported inverse-distance weight of every scene, normalized. Unlike a
 *  global IDW (where far scenes always tug and blends muddy as the bank grows), only
 *  the ~K nearest scenes contribute : each weight is IDW (so it still passes THROUGH
 *  the points — a scene dominates at its own dot) times a Wendland-style window that
 *  falls smoothly to zero at the K-th-neighbour radius. Closer to Bencina's natural-
 *  neighbour interpolation, and it keeps the plane's regions belonging to their own
 *  local scenes. */
export function surfaceWeights(scenes: SceneEntry[], x: number, y: number): number[] {
  const n = scenes.length
  const d2 = scenes.map((s) => {
    const p = s.surface ?? { x: 0.5, y: 0.5 }
    return (p.x - x) ** 2 + (p.y - y) ** 2
  })
  // Support radius = distance to the K-th nearest scene (adaptive locality).
  const sorted = [...d2].sort((a, b) => a - b)
  const rc = Math.max(sorted[Math.min(SURFACE_K, n - 1)], 1e-4)
  const raw = d2.map((d) => {
    if (d >= rc) return 0
    const t = 1 - d / rc // 1 at the point → 0 at the cutoff (smooth window in d²)
    return (1 / (d + 1e-4)) * t * t
  })
  const sum = raw.reduce((a, b) => a + b, 0)
  return sum > 1e-9 ? raw.map((w) => w / sum) : raw.map(() => 1 / Math.max(1, n))
}

/** Sample a drawn path at a normalized playhead in [0,1], linear-interpolating
 *  between adjacent points by index-fraction. `closed` connects the last point back
 *  to the first (the traversal wraps around the whole cycle, so forward looping flows
 *  instead of teleporting end→start). (0.5,0.5) for an empty path — the plane centre,
 *  so a cleared sequencer sits quiet.) */
export function samplePath(
  path: { x: number; y: number }[],
  ph01: number,
  closed = false
): { x: number; y: number } {
  const n = path.length
  if (n === 0) return { x: 0.5, y: 0.5 }
  if (n === 1) return { x: path[0].x, y: path[0].y }
  const u = Math.max(0, Math.min(1, ph01))
  // Open : n-1 segments over [0, n-1]. Closed : n segments (incl. last→first),
  // indices wrap so the closing edge is traversed too.
  const segs = closed ? n : n - 1
  const p = u * segs
  const i = Math.floor(p)
  const f = p - i
  const a = path[i % n]
  const b = path[(i + 1) % n]
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}

/** Index of the scene nearest the cursor (its structure becomes the base). */
export function nearestSurfaceScene(scenes: SceneEntry[], x: number, y: number): number {
  let best = 0
  let bd = Infinity
  for (let i = 0; i < scenes.length; i++) {
    const p = scenes[i].surface ?? { x: 0.5, y: 0.5 }
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}

/** Weighted average of a numeric getter over the contribs that supply a number. */
function wavg(contribs: Contrib[], get: (c: CompositionState) => number | undefined, fb: number): number {
  let s = 0
  let ws = 0
  for (const { c, w } of contribs) {
    const v = get(c)
    if (typeof v === 'number') {
      s += v * w
      ws += w
    }
  }
  return ws > 1e-6 ? s / ws : fb
}

/** Blend an input map : each numeric param a weighted average over the given rows
 *  (already filtered to the structurally-matching scenes); non-numbers hold the base. */
function blendInputs(
  base: Record<string, number | number[]>,
  rows: { inp: Record<string, number | number[]> | undefined; w: number }[]
): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {}
  const have = rows.filter((r) => r.inp)
  for (const key of Object.keys(base)) {
    const bv = base[key]
    if (typeof bv === 'number') {
      let s = 0
      let ws = 0
      for (const r of have) {
        const v = (r.inp as Record<string, number | number[]>)[key]
        if (typeof v === 'number') {
          s += v * r.w
          ws += r.w
        }
      }
      out[key] = ws > 1e-6 ? s / ws : bv
    } else if (Array.isArray(bv)) {
      out[key] = bv.map((be, i) => {
        if (typeof be !== 'number') return be
        let s = 0
        let ws = 0
        for (const r of have) {
          const arr = (r.inp as Record<string, number | number[]>)[key]
          const v = Array.isArray(arr) ? arr[i] : undefined
          if (typeof v === 'number') {
            s += v * r.w
            ws += r.w
          }
        }
        return ws > 1e-6 ? s / ws : be
      }) as number[]
    } else out[key] = bv
  }
  return out
}

/** A source slot : structure from base, inputs blended over the slots sharing its shader. */
function blendSlot(
  base: SourceSlot | null | undefined,
  contribs: Contrib[],
  get: (c: CompositionState) => SourceSlot | null | undefined
): SourceSlot | null {
  if (!base || !base.shaderId) return base ?? null
  const rows = contribs
    .map((ct) => ({ slot: get(ct.c), w: ct.w }))
    .filter((r) => r.slot && r.slot.shaderId === base.shaderId)
    .map((r) => ({ inp: r.slot!.inputs, w: r.w }))
  return { ...base, inputs: blendInputs(base.inputs, rows) }
}

/** An FX rack : each unit's structure from base, inputs + opacity blended over the
 *  units at the same position sharing its shader. */
function blendFx(baseFx: FxInstance[], contribs: Contrib[], get: (c: CompositionState) => FxInstance[]): FxInstance[] {
  return baseFx.map((bf, i) => {
    if (!bf.shaderId) return bf
    const matching = contribs.filter((ct) => {
      const f = get(ct.c)[i]
      return f && f.shaderId === bf.shaderId
    })
    const rows = matching.map((ct) => ({ inp: get(ct.c)[i]?.inputs, w: ct.w }))
    return {
      ...bf,
      inputs: blendInputs(bf.inputs, rows),
      opacity: wavg(matching, (c) => get(c)[i]?.opacity, bf.opacity ?? 1)
    }
  })
}

/** Blend all contribs onto `base`'s structure. */
export function blendComposition(base: CompositionState, contribs: Contrib[]): CompositionState {
  return {
    ...base,
    bpm: wavg(contribs, (c) => c.bpm, base.bpm),
    layers: base.layers.map(
      (bl: LayerState, i: number): LayerState => ({
        ...bl,
        opacity: wavg(contribs, (c) => c.layers[i]?.opacity, bl.opacity),
        feedbackAmount: wavg(contribs, (c) => c.layers[i]?.feedbackAmount, bl.feedbackAmount),
        sourceMix: wavg(contribs, (c) => c.layers[i]?.sourceMix, bl.sourceMix),
        speed: wavg(contribs, (c) => c.layers[i]?.speed ?? 1, bl.speed ?? 1),
        sourceA: blendSlot(bl.sourceA, contribs, (c) => c.layers[i]?.sourceA) as SourceSlot,
        sourceB: bl.sourceB ? blendSlot(bl.sourceB, contribs, (c) => c.layers[i]?.sourceB) : bl.sourceB,
        sourceAFx: blendFx(bl.sourceAFx, contribs, (c) => c.layers[i]?.sourceAFx ?? []),
        sourceBFx: blendFx(bl.sourceBFx, contribs, (c) => c.layers[i]?.sourceBFx ?? []),
        fx: blendFx(bl.fx, contribs, (c) => c.layers[i]?.fx ?? [])
      })
    ),
    background: base.background
      ? {
          ...base.background,
          opacity: wavg(contribs, (c) => c.background?.opacity, base.background.opacity),
          speed: wavg(contribs, (c) => c.background?.speed, base.background.speed),
          depth: wavg(contribs, (c) => c.background?.depth ?? 0, base.background.depth ?? 0),
          source: blendSlot(base.background.source, contribs, (c) => c.background?.source) as SourceSlot,
          fx: blendFx(base.background.fx, contribs, (c) => c.background?.fx ?? [])
        }
      : base.background,
    master: blendFx(base.master, contribs, (c) => c.master),
    metaKnobs: base.metaKnobs.map((bk, i) => ({
      ...bk,
      value: wavg(contribs, (c) => c.metaKnobs[i]?.value, bk.value)
    }))
  }
}

/** The composition to render at cursor (x,y). Null if fewer than two placed scenes.
 *  `baseIndex` (into the placed array) forces which scene supplies the STRUCTURE —
 *  the caller passes its hysteretic held index so the base doesn't flip the instant
 *  the cursor crosses a Voronoi seam (params still blend by weight regardless). When
 *  omitted / out of range, the true nearest is used. */
export function surfaceComposition(
  scenes: SceneEntry[],
  x: number,
  y: number,
  baseIndex?: number
): CompositionState | null {
  const placed = scenes.filter((s) => s.surface)
  if (placed.length < 2) return null
  const w = surfaceWeights(placed, x, y)
  const ni =
    baseIndex != null && baseIndex >= 0 && baseIndex < placed.length
      ? baseIndex
      : nearestSurfaceScene(placed, x, y)
  const contribs: Contrib[] = placed.map((s, i) => ({ c: s.composition, w: w[i] }))
  return blendComposition(placed[ni].composition, contribs)
}

/** Even, organic spread over the plane (a Vogel / sunflower spiral), for scenes that
 *  haven't been placed by hand. Returns a fresh position per index. */
export function autoSurfacePos(index: number, total: number): { x: number; y: number } {
  const golden = 2.399963229728653
  const r = Math.sqrt((index + 0.5) / Math.max(1, total)) * 0.42
  const a = index * golden
  return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) }
}
