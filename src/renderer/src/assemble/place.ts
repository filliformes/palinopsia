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

// Where each corpus unit sits on the Assemble map, 0..1 both ways (the map's
// own bounds), for Sonify's Assemblage voice : its note and its pan. Rebuilt
// when the corpus or the map changes; null without one (a stable place is used).
let placeCache: { units: unknown; map: unknown; byId: Map<string, [number, number]> } | null = null
export function unitPlace(unitId: string): [number, number] | null {
  const st = useStore.getState()
  const corpus = st.assembleCorpus
  const map = st.assembleMap
  if (!corpus || !map?.length || map.length !== corpus.units.length) return null
  if (!placeCache || placeCache.units !== corpus.units || placeCache.map !== map) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const [x, y] of map) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    const sx = x1 > x0 ? 1 / (x1 - x0) : 0, sy = y1 > y0 ? 1 / (y1 - y0) : 0
    const byId = new Map<string, [number, number]>()
    corpus.units.forEach((u, i) => byId.set(u.id, [sx ? (map[i][0] - x0) * sx : 0.5, sy ? (map[i][1] - y0) * sy : 0.5]))
    placeCache = { units: corpus.units, map, byId }
  }
  return placeCache.byId.get(unitId) ?? null
}
