// Live modulation of the Complex Output (a modulator or a Macro knob on a screen's
// brightness, a slice's opacity, an on / off) : the modulation pass writes here every
// frame, the screens read it as they draw. Its own little module, so the modulation
// engine never imports the store's side (as lights/lightMods.ts).

import type { CxModField } from '@shared/complexOut'

export const cxMods = new Map<string, number>()
export const cxModKey = (who: string, field: CxModField): string => `${who}|${field}`

let baseOf: (who: string, field: CxModField) => number | null = () => null
export function setCxBaseOf(fn: (who: string, field: CxModField) => number | null): void {
  baseOf = fn
}
/** A control's own value now (null : its screen or slice is gone). */
export const cxBaseOf = (who: string, field: CxModField): number | null => baseOf(who, field)
