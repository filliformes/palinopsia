// The Audio Layer under modulation (ModTarget kind 'au', shared/auMod.ts) : what
// the modulators and the Meta knobs put on its controls THIS frame. The
// modulation pass writes it (engine/modulation.ts), the engine takes it once a
// frame (audio/audioLayer.ts tick) and glides its gains there; a frame nothing
// writes, they go back to the stored values. Nothing here reaches the store.
// A leaf : the modulation pass can't import the engine (it imports Sonify,
// which imports the modulation pass).

import type { AudioLayerState } from '@shared/types'
import type { AuModTarget, AuSlotModField } from '@shared/auMod'

export type AuSlotMods = Partial<Record<AuSlotModField, number>>
export interface AuModFrame {
  volume?: number
  mix?: number
  A: AuSlotMods
  B: AuSlotMods
}

const EMPTY: AuModFrame = Object.freeze({ A: Object.freeze({}), B: Object.freeze({}) }) as AuModFrame
let frame: AuModFrame = EMPTY

// The layer's stored state (the engine's sync) : what a modulation swings around.
let base: AudioLayerState | null = null
export const auModBase = (): AudioLayerState | null => base
export function setAuModBase(st: AudioLayerState): void {
  base = st
}

/** A modulated value this frame, in the control's own units (a gain, a pan, a
 *  speed, a place 0..1). The last write of a frame wins. */
export function setAuMod(t: AuModTarget, v: number): void {
  if (!Number.isFinite(v)) return
  if (frame === EMPTY) frame = { A: {}, B: {} }
  if (t.slot) frame[t.slot][t.field] = v
  else frame[t.field] = v
}

/** This frame's values, once (the next frame starts empty). */
export function takeAuMods(): AuModFrame {
  const f = frame
  frame = EMPTY
  return f
}
