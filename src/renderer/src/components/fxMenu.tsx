// The FX right-click menu, shared by the rack chips and the Inspector header so
// the same effect offers the same actions wherever you reach it.
//
// Two pastes, because they answer different questions. "Paste settings" moves a
// dialled-in look onto another unit of the SAME shader — a Blur's inputs mean
// nothing to a Datamosh, so it is refused across shaders. "Paste as a new
// effect" drops a copy into a rack, which is only allowed where that rack can
// host the shader (`canHostFx`) : the sidechain nodes need a layer to read from,
// and Parallax needs the whole-picture depth map.

import type { FxScope, ModAssignment, ModTarget } from '@shared/types'
import { modTargetKey, useStore } from '../store'
import { canHostFx, hostRefusal } from '../fxScopes'
import { inputsForShader } from '../shaders/isf/inputs'
import type { MenuItem } from './ContextMenu'

/** The float (i.e. modulatable) inputs of a shader, as ModTargets built by `build`. */
export function floatModTargets(
  shaderId: string | null | undefined,
  build: (input: string) => ModTarget
): ModTarget[] {
  if (!shaderId) return []
  return inputsForShader(shaderId)
    .filter((i) => i.type === 'float')
    .map((i) => build(i.name))
}

/** Does the matrix carry any modulation on one of these candidate targets? */
export function hasModulationOn(matrix: ModAssignment[], candidates: ModTarget[]): boolean {
  if (!candidates.length) return false
  const keys = new Set(candidates.map(modTargetKey))
  return matrix.some((a) => keys.has(modTargetKey(a.target)))
}

/** Menu rows for one FX unit. `instId` null = the rack itself (paste-only). */
export function useFxMenuItems(
  scope: FxScope,
  instId: string | null,
  shaderId: string | null | undefined,
  close: () => void,
  // Locked finalizers (Vibe/Context/Finalizer) are singletons in no rack's
  // catalogue : copying one can only ever poison the clipboard (nowhere accepts
  // it, and the refusal message would be wrong), so they offer no Copy.
  locked = false
): MenuItem[] {
  const clip = useStore((s) => s.fxClipboard)
  const copyFx = useStore((s) => s.copyFx)
  const pasteFxSettings = useStore((s) => s.pasteFxSettings)
  const pasteFxAsNew = useStore((s) => s.pasteFxAsNew)
  const modMatrix = useStore((s) => s.composition.modMatrix)
  const randomizeModulation = useStore((s) => s.randomizeModulation)

  const run = (fn: () => void) => (): void => {
    fn()
    close()
  }
  const items: MenuItem[] = []

  // Modulation actions : "Assign and randomize" seeds+re-rolls random mod (source +
  // Mul) onto this FX's parameters ; "Randomize modulation" re-rolls only what's
  // already there, and shows only when this FX carries modulation.
  if (instId && shaderId) {
    const cands = floatModTargets(shaderId, (input) => ({ kind: 'fx', scope, instId, input }))
    if (cands.length) {
      items.push({
        label: 'Assign and randomize modulation',
        onClick: run(() => randomizeModulation(cands, true))
      })
      if (hasModulationOn(modMatrix, cands)) {
        items.push({
          label: 'Randomize modulation',
          onClick: run(() => randomizeModulation(cands, false))
        })
      }
      items.push({ label: '', divider: true })
    }
  }

  if (instId && !locked) {
    items.push({ label: 'Copy effect', onClick: run(() => copyFx(scope, instId)) })
  }

  if (!clip) {
    items.push({ label: 'Paste — nothing copied', disabled: true })
    return items
  }

  const sameShader = !!shaderId && shaderId === clip.shaderId
  if (instId) {
    items.push({
      label: sameShader ? `Paste settings from ${clip.name}` : `Paste settings — needs a ${clip.name}`,
      disabled: !sameShader,
      onClick: sameShader ? run(() => pasteFxSettings(scope, instId)) : undefined
    })
  }

  const hostable = canHostFx(scope, clip.shaderId)
  items.push({
    label: hostable ? `Paste ${clip.name} as a new effect` : `Paste ${clip.name} — ${hostRefusal(scope, clip.shaderId)}`,
    disabled: !hostable,
    onClick: hostable ? run(() => pasteFxAsNew(scope, instId)) : undefined
  })
  return items
}
