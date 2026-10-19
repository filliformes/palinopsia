// An assemblage placed from outside the Assemble tab : the layer menu's
// "Assemblage…" and the Inspector's new / vary. The latest saved edit, or a fresh
// one cut from the corpus in memory with the tab's recipe (the corpus is there
// once the tab has analyzed its folder this run).

import type { Assemblage, AssembleParams } from '@shared/assemble'
import { generate } from './match'
import { liveDescriptor } from './liveMatch'
import { useStore } from '../store'

/** A new edit from the corpus in memory (null without one, or when the recipe
 *  finds nothing). `params` : another recipe than the tab's (vary keeps the
 *  edit's own). */
export function freshAssemblage(seed = (Math.random() * 2 ** 32) >>> 0, name = 'new edit', params?: AssembleParams): Assemblage | null {
  const st = useStore.getState()
  const corpus = st.assembleCorpus
  if (!corpus || !corpus.units.length) return null
  const p = params ?? st.assembleParams
  const clips = generate({ corpus, params: p, seed, map: st.assembleMap, liveTarget: p.mode === 'live' ? liveDescriptor() : null })
  if (!clips.length) return null
  return { id: `asm-${seed.toString(36)}-${Date.now().toString(36)}`, name, clips, seed, params: { ...p }, folder: corpus.folder, createdAt: Date.now() }
}

/** The menu's "Assemblage…" : the latest saved edit on this slot (else a fresh
 *  one), selected so the Inspector shows its controls. False when there is
 *  nothing to play yet (no saved edit, no corpus). */
export function placeAssemblage(layer: number, slot: 'A' | 'B'): boolean {
  const st = useStore.getState()
  const a = st.assemblages[0] ?? freshAssemblage()
  if (!a) return false
  st.setSourceAssemble(layer, slot, a)
  st.setSelection({ type: 'source', layer, slot })
  return true
}
