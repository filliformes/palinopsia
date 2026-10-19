// The World amount : how much of the active World's mood is on. 1 = all of it
// (what Apply sets), 0 = the mood the World found (the composition's
// `worldBase`), between = a blend, frame by frame, after modulation and the
// field macros, so a modulator, a Meta knob, MIDI or OSC can fade a World in and
// out live. It moves the Context and film keys the World set; the coupling and
// the World's audio routing stay as they are (the routing's own swing is part
// of the value that gets blended).

import type { CompositionState, World } from '@shared/types'
import { frameVals } from './frameVals'
import { liveModValues } from './modulation'

let base = 1 // the store's value (the slider, OSC, MIDI)
let modded: number | null = null // a modulator's value this frame

export const worldAmountBase = (): number => base
export function setWorldAmountBase(v: number): void {
  base = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1))
}
/** A modulator drives it this frame (cleared every frame once read). */
export function setWorldAmountMod(v: number): void {
  modded = Math.max(0, Math.min(1, v))
}

type AmountComp = {
  setFxInput: (scope: { kind: 'master' }, instId: string, name: string, v: number) => void
}
const MASTER = { kind: 'master' as const }

/** Blend the active World's keys from the mood it found toward their values now. */
export function applyWorldAmount(comp: AmountComp, c: CompositionState, world: World | undefined): number {
  const a = modded ?? base
  modded = null
  if (!world || a > 0.999 || !c.worldBase) return a
  const wb = c.worldBase
  for (const inst of c.master) {
    const isCtx = inst.shaderId === 'fx-context'
    const isFin = inst.shaderId === 'fx-finalizer'
    if (!isCtx && !isFin) continue
    const keys = isCtx ? Object.keys(world.context).filter((k) => k !== 'blur') : Object.keys(world.finalizer ?? { filmHold: 0, filmDust: 0, filmScratch: 0, filmHair: 0 })
    for (const k of keys) {
      if (!(k in wb)) continue
      const key = `fx:master:${inst.id}:${k}`
      const now = frameVals.get(key) ?? (liveModValues.get(key) as number | undefined) ?? (typeof inst.inputs[k] === 'number' ? (inst.inputs[k] as number) : wb[k])
      let v = wb[k] + (now - wb[k]) * a
      if (k === 'filmHold') v = a >= 0.5 ? now : wb[k] // a mode, not a level : it switches halfway
      comp.setFxInput(MASTER, inst.id, k, v)
      frameVals.set(key, v)
    }
  }
  return a
}
