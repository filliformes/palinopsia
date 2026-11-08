// A layer's four racks, by the FxScope kind that names them. One place for the
// mapping, so a fifth rack (or the Loop rack, the fourth) can't be forgotten in
// one of the dozen readers.

import type { FxInstance, LayerState } from '@shared/types'

export type LayerRackKind = 'layer' | 'sourceA' | 'sourceB' | 'loop'
export const LAYER_RACK_KINDS: LayerRackKind[] = ['sourceA', 'sourceB', 'layer', 'loop']

/** The LayerState property holding each rack. */
export const LAYER_RACK_PROP = {
  layer: 'fx',
  sourceA: 'sourceAFx',
  sourceB: 'sourceBFx',
  loop: 'loopFx'
} as const satisfies Record<LayerRackKind, keyof LayerState>

export function isLayerRackKind(k: string): k is LayerRackKind {
  return k === 'layer' || k === 'sourceA' || k === 'sourceB' || k === 'loop'
}

/** The rack a scope kind names on this layer (the Loop rack of a session saved
 *  before it existed reads empty). */
export function layerRackOf(l: LayerState, kind: LayerRackKind): FxInstance[] {
  return (l[LAYER_RACK_PROP[kind]] as FxInstance[] | undefined) ?? []
}

/** A layer rack's short name after its layer ('L2 FX', 'L2 A fx', 'L2 loop'). */
export const LAYER_RACK_SHORT: Record<LayerRackKind, string> = {
  layer: 'FX',
  sourceA: 'A fx',
  sourceB: 'B fx',
  loop: 'loop'
}
