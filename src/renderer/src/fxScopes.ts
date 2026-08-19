// Which FX may live in which rack.
//
// This used to live inside the "+ fx" picker, which meant the rule existed only
// where a unit is ADDED. Copy/paste needs the same answer, and two copies of a
// rule like this drift — so it lives here, and the picker reads it too.

import type { FxScope } from '@shared/types'
import { FX_SHADERS, NATIVE_NODES, SHADER_BY_ID } from './shaders/isf'

// The SELF-CONTAINED native nodes : they work on whatever signal enters, needing
// no external input, so any rack can host them now that master / source /
// background all get a node context.
const SELF_CONTAINED = new Set([
  'node-datamosh',
  'node-feedback',
  'node-reponse',
  'node-chronoscan',
  'node-sediment',
  'node-scanner',
  'node-autocutter',
  'node-eternalism',
  'node-afterimage',
  'node-pulfrich',
  'node-corrode',
  'node-decimate',
  'node-melt'
])

/** Can `shaderId` be placed in this rack?
 *
 *  A LAYER rack takes everything. Elsewhere the two SIDECHAIN nodes (Transfert,
 *  Convolution) are out — they read another layer as their input, which only a
 *  layer rack can resolve — and Parallax needs the whole-picture depth map, so
 *  it is master-only among the non-layer racks. The pinned finalizers (Vibe,
 *  Context, Finalizer) are in no rack's catalogue at all : they are placed by
 *  the app, never by hand. */
export function canHostFx(scope: FxScope, shaderId: string | null | undefined): boolean {
  if (!shaderId) return false
  const def = SHADER_BY_ID[shaderId]
  if (!def) return false
  // Locked finalizers are excluded from FX_SHADERS, which is exactly the test.
  const addable = FX_SHADERS.some((f) => f.id === shaderId) || NATIVE_NODES.some((f) => f.id === shaderId)
  if (!addable) return false
  if (!def.native) return true
  if (scope.kind === 'layer') return true
  if (SELF_CONTAINED.has(shaderId)) return true
  return scope.kind === 'master' && shaderId === 'node-parallax'
}

/** Human-readable reason a paste is refused, for a disabled menu row : it names
 *  WHERE the shader can go, computed from the same rule, so the message is never
 *  wrong (Parallax is layer-or-master, the sidechain nodes are layer-only). */
export function hostRefusal(scope: FxScope, shaderId: string | null | undefined): string {
  if (!shaderId) return 'nothing copied'
  const name = SHADER_BY_ID[shaderId]?.name ?? shaderId
  const inLayer = canHostFx({ kind: 'layer', layer: 0 }, shaderId)
  const inMaster = canHostFx({ kind: 'master' }, shaderId)
  if (inLayer && inMaster) return `${name} needs a layer or the master rack`
  if (inLayer) return `${name} is layer-only`
  return `${name} can't go here` // finalizers etc : in no rack's catalogue
}
