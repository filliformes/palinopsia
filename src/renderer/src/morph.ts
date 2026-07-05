// Global Morph — scene recalls and Randomize crossfade instead of snapping.
//
// The store holds the TARGET composition (so the UI shows the destination
// immediately). During a morph, the App render loop feeds the ENGINE an
// interpolated composition built from the pre-change state → the target, over
// `morphMs`. Structure (shader ids, counts, enums, bools, modulators) snaps to
// the target; only numeric params (inputs, opacities, layer opacity/speed/mix,
// bpm, meta-knob values) are eased. Zero React churn, one undo entry per change.

import type { CompositionState, FxInstance, LayerState, SourceSlot } from '@shared/types'

let state: { from: CompositionState; startMs: number; ms: number } | null = null

// A pending framebuffer crossfade the render loop should pick up. Set whenever
// a morph begins; the loop reads it once and tells the Compositor to dissolve
// the frozen old frame into the new scene — the only way a STRUCTURAL change
// (Randomize All swaps shaders) can visibly morph, since params snap.
let pendingCrossfadeMs: number | null = null

/** The render loop calls this once per frame; returns the ms for a crossfade
 *  that just began (and clears it), else null. */
export function consumeCrossfade(): number | null {
  const v = pendingCrossfadeMs
  pendingCrossfadeMs = null
  return v
}

/** Start easing FROM `from` toward whatever the store holds, over `ms`. */
export function beginMorph(from: CompositionState, ms: number, now: number): void {
  if (ms <= 20) {
    state = null // effectively instant — don't bother interpolating
    return
  }
  state = { from: structuredClone(from), startMs: now, ms }
  pendingCrossfadeMs = ms
}

export function morphActive(): boolean {
  return state !== null
}

const easeInOut = (k: number): number => k * k * (3 - 2 * k)

function lerpN(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

function lerpVal(av: unknown, bv: unknown, k: number): number | number[] | unknown {
  if (typeof av === 'number' && typeof bv === 'number') return lerpN(av, bv, k)
  if (Array.isArray(av) && Array.isArray(bv) && av.length === bv.length) {
    return bv.map((v, i) =>
      typeof av[i] === 'number' && typeof v === 'number' ? lerpN(av[i] as number, v, k) : v
    )
  }
  return bv // strings/bools/mismatch → snap to target
}

function lerpInputs(
  a: Record<string, number | number[]>,
  b: Record<string, number | number[]>,
  k: number
): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {}
  for (const key of Object.keys(b)) out[key] = lerpVal(a[key], b[key], k) as number | number[]
  return out
}

function lerpSlot(a: SourceSlot | null, b: SourceSlot | null, k: number): SourceSlot | null {
  if (!a || !b || a.shaderId !== b.shaderId) return b
  return { ...b, inputs: lerpInputs(a.inputs, b.inputs, k) }
}

// Match FX by position + shader id — same shader ⇒ ease its inputs + opacity.
function lerpFx(a: FxInstance[], b: FxInstance[], k: number): FxInstance[] {
  return b.map((bf, i) => {
    const af = a[i]
    if (!af || af.shaderId !== bf.shaderId) return bf
    return {
      ...bf,
      inputs: lerpInputs(af.inputs, bf.inputs, k),
      opacity: lerpN(af.opacity ?? 1, bf.opacity ?? 1, k)
    }
  })
}

function lerpComposition(a: CompositionState, b: CompositionState, k: number): CompositionState {
  return {
    ...b,
    bpm: lerpN(a.bpm, b.bpm, k),
    layers: b.layers.map((bl: LayerState, i: number) => {
      const al = a.layers[i]
      if (!al) return bl
      return {
        ...bl,
        opacity: lerpN(al.opacity, bl.opacity, k),
        feedbackAmount: lerpN(al.feedbackAmount, bl.feedbackAmount, k),
        sourceMix: lerpN(al.sourceMix, bl.sourceMix, k),
        speed: lerpN(al.speed, bl.speed, k),
        sourceA: lerpSlot(al.sourceA, bl.sourceA, k) as SourceSlot,
        sourceB: bl.sourceB ? lerpSlot(al.sourceB, bl.sourceB, k) : bl.sourceB,
        sourceAFx: lerpFx(al.sourceAFx, bl.sourceAFx, k),
        sourceBFx: lerpFx(al.sourceBFx, bl.sourceBFx, k),
        fx: lerpFx(al.fx, bl.fx, k)
      }
    }),
    master: lerpFx(a.master, b.master, k),
    metaKnobs: b.metaKnobs.map((bk, i) => {
      const ak = a.metaKnobs[i]
      return ak ? { ...bk, value: lerpN(ak.value, bk.value, k) } : bk
    })
  }
}

/** What the engine should render THIS frame: the eased composition, or the
 *  target unchanged once the morph completes. */
export function morphedComposition(now: number, target: CompositionState): CompositionState {
  if (!state) return target
  const k = (now - state.startMs) / state.ms
  if (k >= 1) {
    state = null
    return target
  }
  return lerpComposition(state.from, target, easeInOut(Math.max(0, k)))
}
