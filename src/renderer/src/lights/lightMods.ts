// Live modulation of the Lights (a modulator or a Macro knob on a light slider) :
// the modulation pass writes here every frame, the Lights engine reads it. Its
// own little module, so the modulation engine never imports the store's side.

import type { LightModField } from '@shared/lights'

export const lightMods = new Map<string, number>()
export const lightModKey = (fixture: string, field: LightModField): string => `${fixture}|${field}`

/** A light slider's own value now (null : that fixture is gone), for the
 *  modulators that swing around it. Registered by the Lights runtime (it reads
 *  the store), so this module stays free of it. */
let baseOf: (fixture: string, field: LightModField) => number | null = () => null
export function setLightBaseOf(fn: (fixture: string, field: LightModField) => number | null): void {
  baseOf = fn
}
export const lightBaseOf = (fixture: string, field: LightModField): number | null => baseOf(fixture, field)
