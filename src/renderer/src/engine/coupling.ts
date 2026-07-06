// Coupling engine (Slab 1 — the spine of the audiovisual-reactivity chapter).
// Binds a layer's two "voices" (source A + B) with an audio feature: the A↔B
// balance leans toward B, or pumps A↔B, with the sound. Runs each frame after
// modulation, writing the effective sourceMix straight onto the compositor
// (never through React). Returns the coupled mixes so the output window can
// mirror them.
//
// `tightness` shapes the response obvious↔vestigial: at 1 the balance follows
// the feature linearly; toward 0 only strong peaks register (an exponent). This
// is the coupling-strength control the synchresis modes (Slab 2) will extend.

import type { CompositionState } from '@shared/types'
import { audioBus } from './audioIn'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Apply A/B coupling to every layer with a live B voice. Writes the coupled
 * sourceMix onto `comp.layers[i]` and returns a per-layer array of the applied
 * mixes (or null if nothing is coupled — so the caller can skip the push).
 */
export function applyCoupling(
  comp: { layers: Array<{ sourceMix: number }> },
  c: CompositionState
): number[] | null {
  // Inert until audio ingest is on — otherwise a silent bus would read as "all
  // A" and a coupled layer would look stuck (esp. hocket).
  if (audioBus.mode === 'off') return null
  let any = false
  const out = c.layers.map((l, i) => {
    const layer = comp.layers[i]
    const base = layer ? layer.sourceMix : (l.sourceMix ?? 0.5)
    const cp = l.coupling
    if (!layer || !cp || cp.mode === 'off') return base
    // Needs a real second voice — the crossfade is inert without B.
    if (!l.sourceB || l.sourceB.kind === 'none') return base

    const raw = clamp01(audioBus.feature(cp.feature))
    const tight = clamp01(cp.tightness)
    // Vestigial (only peaks) ↔ obvious (linear) via a response exponent.
    const shaped = Math.pow(raw, 1 + (1 - tight) * 3)
    const amt = clamp01(cp.amount)

    let eff = base
    if (cp.mode === 'lean') {
      // Audio leans the balance toward B; silence rests at the base mix.
      eff = base + shaped * amt * (1 - base)
    } else if (cp.mode === 'hocket') {
      // The signal sets the balance — A on silence, B on peaks; at amount 1
      // it fully pumps A↔B (the energy-transfer feel).
      eff = base * (1 - amt) + shaped * amt
    }
    eff = clamp01(eff)
    layer.sourceMix = eff
    any = true
    return eff
  })
  return any ? out : null
}
