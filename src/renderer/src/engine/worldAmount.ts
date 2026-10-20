// The World amount : how much of the active World's mood is on. 1 = all of it
// (what Apply sets), 0 = the mood the World found (the composition's
// `worldBase`), between = a blend, frame by frame, after modulation and the
// field macros, so a modulator, a Meta knob, MIDI or OSC can fade a World in and
// out live. It moves the Context and film keys the World set; the coupling and
// the World's audio routing stay as they are (the routing's own swing is part
// of the value that gets blended).
//
// Only the World's own change fades (`worldShift`, what Apply changed each key
// by) : each key plays its value now (your hand, your modulators, the macros,
// all kept) minus what is left out of that change, so below 1 a slider or an
// LFO still moves it. A morph eases the shift with everything else, so the fade
// never jumps when the World or the scene changes. A switch (the film hold, the
// gauge, the dirt, the blank leader) never blends : it goes back to what the
// World found under the halfway mark, and only while it still sits where the
// World put it (switch it by hand and it is yours).

import type { CompositionState, World } from '@shared/types'
import { frameVals } from './frameVals'
import { liveModValues } from './modulation'
import { fitToInput, isSwitchInput, stageDefault, worldKeyInput, worldShiftOf, worldStageOf } from '../worlds'

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

/** Fade the active World's own change on its keys toward the mood it found. */
export function applyWorldAmount(comp: AmountComp, c: CompositionState, world: World | undefined): number {
  const a = modded ?? base
  modded = null
  if (!world || a > 0.999 || !c.worldBase) return a
  const wb = c.worldBase
  const shift = worldShiftOf(c, world)
  const ctx = c.master.find((f) => f.shaderId === 'fx-context')
  const fin = c.master.find((f) => f.shaderId === 'fx-finalizer')
  // Texture off : the compositor holds the relief at 0 (from the same value),
  // and the amount must never bring it back.
  const pbrOff = !ctx || Math.round(typeof ctx.inputs.pbrTexture === 'number' ? ctx.inputs.pbrTexture : 0) === 0
  for (const k in shift) {
    const sh = shift[k]
    if (!Number.isFinite(sh) || Math.abs(sh) < 1e-6) continue // the World changed nothing here
    const sid = worldStageOf(k)
    const inst = sid === 'fx-context' ? ctx : sid === 'fx-finalizer' ? fin : undefined
    if (!inst || (k === 'pbrAmount' && pbrOff)) continue
    // What the session holds (a key it lacks : what the stage plays without it).
    const stored = typeof inst.inputs[k] === 'number' ? (inst.inputs[k] as number) : stageDefault(inst.shaderId, k)
    const key = `fx:master:${inst.id}:${k}`
    const d = worldKeyInput(inst.shaderId, k)
    let v: number
    if (isSwitchInput(d)) {
      if (!(k in wb) || Math.round(stored) !== Math.round(wb[k] + sh) || a >= 0.5) continue
      v = fitToInput(d, wb[k])
    } else v = fitToInput(d, (frameVals.get(key) ?? liveModValues.get(key) ?? stored) - (1 - a) * sh)
    comp.setFxInput(MASTER, inst.id, k, v)
    frameVals.set(key, v)
  }
  return a
}
