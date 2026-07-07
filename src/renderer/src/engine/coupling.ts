// Coupling engine (Slab 1 spine + Slab 2 mode catalogue). Binds a layer's two
// voices (source A + B) with an audio feature, writing the effective sourceMix
// onto the compositor each frame (post-modulation) and returning the coupled
// mixes so the output window can mirror them.
//
// Modes = the synchresis catalogue as A/B-balance behaviours:
//   lean   — audio leans the balance toward B (continuous, additive)
//   hocket — audio SETS the balance A↔B (interpolate; pumps at amount 1)
//   cut    — transient FLASHES to B, then releases (on-cut; percussive)
//   gate   — B while loud, A while quiet (sustained threshold)
//   drift  — slow momentum follow (congruent-movement; shares direction)
//
// `tightness` is the universal response-sharpness: for cut it's the release
// tail, for gate the edge hardness, for drift the follow speed, and for
// lean/hocket the vestigial↔obvious exponent.

import type { CompositionState } from '@shared/types'
import { audioBus } from './audioIn'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (a: number, b: number, x: number): number => {
  if (a === b) return x < a ? 0 : 1
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

// Per-layer runtime state (cut's decaying flash, drift's integrator). Fixed to
// the four layers; index-keyed, lazily created.
const state: Array<{ held: number }> = []

/** Clear the per-layer coupling state — call when the composition is replaced
 *  (scene recall / New / session load) so a stale cut/drift value can't seed
 *  the next scene's coupling. */
export function resetCouplingState(): void {
  state.length = 0
}

/**
 * Apply A/B coupling to every layer with a live B voice. Writes the coupled
 * sourceMix onto `comp.layers[i]` and returns the per-layer mixes (or null if
 * nothing is coupled). Inert until audio ingest is on.
 */
export function applyCoupling(
  comp: { layers: Array<{ sourceMix: number }> },
  c: CompositionState
): number[] | null {
  // Inert until audio ingest is on — otherwise a silent bus reads as "all A".
  if (audioBus.mode === 'off') return null
  let any = false
  const out = c.layers.map((l, i) => {
    const layer = comp.layers[i]
    const base = layer ? layer.sourceMix : (l.sourceMix ?? 0.5)
    const cp = l.coupling
    if (!layer || !cp || cp.mode === 'off') return base
    // Needs a real second voice — the crossfade is inert without B.
    if (!l.sourceB || l.sourceB.kind === 'none') return base
    if (!state[i]) state[i] = { held: 0 }
    const s = state[i]

    const raw = clamp01(audioBus.feature(cp.feature))
    const tight = clamp01(cp.tightness)
    const amt = clamp01(cp.amount)
    const shaped = Math.pow(raw, 1 + (1 - tight) * 3)
    const toB = (g: number): number => base + g * amt * (1 - base) // lean base→B by g

    let eff = base
    switch (cp.mode) {
      case 'lean':
        eff = toB(shaped)
        break
      case 'hocket':
        eff = base * (1 - amt) + shaped * amt
        break
      case 'cut':
        // Flash to B on a transient, then release. Tight = snappy short flash;
        // loose = a longer tail (release factor 0.60 … 0.98 per frame).
        if (raw > 0.4) s.held = 1
        else s.held *= 0.6 + tight * 0.38
        eff = toB(s.held)
        break
      case 'gate': {
        // B while loud, A while quiet; tightness hardens the edge.
        const lo = 0.5 - tight * 0.22
        eff = toB(smoothstep(lo, lo + 0.16, raw))
        break
      }
      case 'drift': {
        // Slow one-pole follow — momentum, not morphology (congruent movement).
        s.held += (raw - s.held) * (0.01 + tight * 0.06)
        eff = toB(s.held)
        break
      }
    }
    eff = clamp01(eff)
    layer.sourceMix = eff
    any = true
    return eff
  })
  return any ? out : null
}
