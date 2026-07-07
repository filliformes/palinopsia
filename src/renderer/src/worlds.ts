// Worlds (diegesis) — editable, saveable presets. A World biases the whole
// composition when selected: every layer's A/B coupling character, a Context
// mood nudge, and an optional audio-routing default (an audio modulator on the
// reserved slot 8 → a Context input). Vibe (the user's palette) is left alone.
//
// Context nudges stay inside the FINISHING-safe bands (bloom ≤ .35, haze ≤ .28,
// depth ≤ .5) so a World can never crush/blow the output. Built-ins ship here;
// user worlds live in the store (persisted to localStorage).

import type { CompositionState, World } from '@shared/types'
import { WORLD_AUTOMOD_SLOT } from '@shared/types'
import { makeDefaultModulator } from './engine/modulation'

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

export const BUILTIN_WORLDS: World[] = [
  {
    id: 'synthetic',
    name: 'Synthetic',
    builtin: true,
    blurb: 'Abstract concordance — audio leans the A/B texture (default).',
    coupling: { mode: 'lean', amount: 0.5, tightness: 0.7, feature: 'flux' },
    context: { trails: 0.22, blur: 0.08, bloom: 0.18, depth: 0.28, haze: 0.16 },
    autoMod: { feature: 'flux', target: 'haze', depth: 0.4 }
  },
  {
    id: 'parametric',
    name: 'Parametric',
    builtin: true,
    blurb: 'Data-mapped — transient cut, crisp and digital.',
    coupling: { mode: 'cut', amount: 0.8, tightness: 0.9, feature: 'transient' },
    context: { trails: 0.05, blur: 0.0, bloom: 0.05, depth: 0.15, haze: 0.03 },
    autoMod: { feature: 'transient', target: 'bloom', depth: 0.5 }
  },
  {
    id: 'musical',
    name: 'Musical',
    builtin: true,
    blurb: 'Visual reading of the music — pitch drifts the balance.',
    coupling: { mode: 'drift', amount: 0.6, tightness: 0.6, feature: 'pitch' },
    context: { trails: 0.2, blur: 0.06, bloom: 0.22, depth: 0.25, haze: 0.1 },
    autoMod: { feature: 'centroid', target: 'bloom', depth: 0.35 }
  },
  {
    id: 'incongruent',
    name: 'Incongruent',
    builtin: true,
    blurb: 'Independent voices — coupling off, detached.',
    coupling: { mode: 'off', amount: 0.5, tightness: 0.7, feature: 'level' },
    context: { trails: 0.15, blur: 0.1, bloom: 0.1, depth: 0.3, haze: 0.06 },
    autoMod: null
  },
  {
    id: 'sublimated',
    name: 'Sublimated',
    builtin: true,
    blurb: 'Mood over sync — warm, dreamy, gently level-led.',
    coupling: { mode: 'lean', amount: 0.3, tightness: 0.4, feature: 'level' },
    context: { trails: 0.35, blur: 0.14, bloom: 0.28, depth: 0.4, haze: 0.28 },
    autoMod: { feature: 'level', target: 'trails', depth: 0.45 }
  },
  {
    id: 'monomedia',
    name: 'Monomedia',
    builtin: true,
    blurb: 'Absence as tension — stark, near-black, uncoupled.',
    coupling: { mode: 'off', amount: 0.5, tightness: 0.7, feature: 'level' },
    context: { trails: 0.1, blur: 0.04, bloom: 0.0, depth: 0.5, haze: 0.0 },
    autoMod: null
  }
]

/** A fresh user world, cloned from an existing one (defaults to Synthetic). */
export function cloneWorld(src: World, name: string): World {
  return {
    id: uid(),
    name,
    builtin: false,
    blurb: src.blurb,
    coupling: { ...src.coupling },
    context: { ...src.context },
    autoMod: src.autoMod ? { ...src.autoMod } : null
  }
}

/** Apply a World's bias to a composition: set every layer's coupling, nudge the
 *  Context finalizer's mood, and install (or clear) the World's audio-routing
 *  modulator on the reserved slot. Returns a new composition (Vibe untouched). */
export function applyWorldToComposition(c: CompositionState, world: World): CompositionState {
  const contextInst = c.master.find((f) => f.shaderId === 'fx-context')
  let next: CompositionState = {
    ...c,
    layers: c.layers.map((l) => ({ ...l, coupling: { ...world.coupling } })),
    master: c.master.map((f) =>
      f.shaderId === 'fx-context' ? { ...f, inputs: { ...f.inputs, ...world.context } } : f
    )
  }

  // Audio routing default — the World manages modulator slot WORLD_AUTOMOD_SLOT
  // and its single matrix assignment. Clear it first, then install if wanted.
  const slot = WORLD_AUTOMOD_SLOT
  const matrix = next.modMatrix.filter((a) => a.mod !== slot)
  const modulators = next.modulators.slice()
  const am = world.autoMod
  if (am && am.target !== 'none' && contextInst) {
    modulators[slot] = {
      ...makeDefaultModulator(),
      type: 'audio',
      enabled: true,
      audio: { feature: am.feature, band: 0, smooth: 0.2 }
    }
    matrix.push({
      id: uid(),
      mod: slot,
      target: { kind: 'fx', scope: { kind: 'master' }, instId: contextInst.id, input: am.target },
      depth: am.depth
    })
  } else {
    // No routing — leave the slot disabled so it stops driving anything.
    modulators[slot] = { ...modulators[slot], enabled: false }
  }
  next = { ...next, modulators, modMatrix: matrix }
  return next
}
