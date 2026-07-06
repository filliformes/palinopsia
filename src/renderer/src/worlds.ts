// World / diegesis biases (Slab 1). Selecting a World applies a curated bias to
// the whole composition: every layer's A/B coupling character + a Context mood
// nudge. It's a bias, not a lock — the user can tweak anything afterward.
//
// Context nudges stay inside the FINISHING-safe bands (bloom ≤ .35, haze ≤ .28,
// depth ≤ .5) so a World can never crush the output to black or blow it out.
// Vibe (the user's palette) is left untouched. Later slabs deepen each world's
// audio routing, source choices and finalizer mood.

import type { CompositionState, LayerCoupling, WorldMode } from '@shared/types'

interface WorldBias {
  label: string
  blurb: string
  coupling: LayerCoupling
  context: Record<string, number>
}

export const WORLD_BIAS: Record<WorldMode, WorldBias> = {
  // Abstract↔abstract concordance through texture — the default reactive world.
  synthetic: {
    label: 'Synthetic',
    blurb: 'Abstract concordance — audio leans the A/B texture (default).',
    coupling: { mode: 'lean', amount: 0.5, tightness: 0.7, feature: 'flux' },
    context: { trails: 0.22, blur: 0.08, bloom: 0.18, depth: 0.28, haze: 0.16 }
  },
  // Data remapped — crisp, digital; tight transient pump (Ikeda territory).
  parametric: {
    label: 'Parametric',
    blurb: 'Data-mapped — tight transient pump, crisp and digital.',
    coupling: { mode: 'hocket', amount: 0.7, tightness: 0.9, feature: 'transient' },
    context: { trails: 0.05, blur: 0.0, bloom: 0.05, depth: 0.15, haze: 0.03 }
  },
  // Image as a visual reading of the music — pitch-led.
  musical: {
    label: 'Musical',
    blurb: 'Visual reading of the music — pitch leads the balance.',
    coupling: { mode: 'lean', amount: 0.5, tightness: 0.6, feature: 'pitch' },
    context: { trails: 0.2, blur: 0.06, bloom: 0.22, depth: 0.25, haze: 0.1 }
  },
  // Two different musics — independent voices, no bond.
  incongruent: {
    label: 'Incongruent',
    blurb: 'Independent voices — coupling off, detached.',
    coupling: { mode: 'off', amount: 0.5, tightness: 0.7, feature: 'level' },
    context: { trails: 0.15, blur: 0.1, bloom: 0.1, depth: 0.3, haze: 0.06 }
  },
  // Affect over sync — warm, dreamy; a gentle level-led lean.
  sublimated: {
    label: 'Sublimated',
    blurb: 'Mood over sync — warm, dreamy, gently level-led.',
    coupling: { mode: 'lean', amount: 0.3, tightness: 0.4, feature: 'level' },
    context: { trails: 0.35, blur: 0.14, bloom: 0.28, depth: 0.4, haze: 0.28 }
  },
  // Absence as tension — stark near-black vignette (dropout arrives in Slab 3).
  monomedia: {
    label: 'Monomedia',
    blurb: 'Absence as tension — stark, near-black, uncoupled.',
    coupling: { mode: 'off', amount: 0.5, tightness: 0.7, feature: 'level' },
    context: { trails: 0.1, blur: 0.04, bloom: 0.0, depth: 0.5, haze: 0.0 }
  }
}

/** Apply a World's bias to a composition: set every layer's coupling and nudge
 *  the Context finalizer's mood. Returns a new composition (Vibe untouched). */
export function applyWorldToComposition(c: CompositionState, world: WorldMode): CompositionState {
  const bias = WORLD_BIAS[world]
  return {
    ...c,
    layers: c.layers.map((l) => ({ ...l, coupling: { ...bias.coupling } })),
    master: c.master.map((f) =>
      f.shaderId === 'fx-context' ? { ...f, inputs: { ...f.inputs, ...bias.context } } : f
    )
  }
}
