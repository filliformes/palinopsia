// Per-frame master-FX write bus. The post-modulation passes (Proximity, the
// sequencer overlays, the field macros, the temperament macros) each write
// finishing params "additively on the live value" — but they used to read only
// liveModValues ?? the composition base, never each other's writes. So when TWO
// passes touched the same param (Gesture⇄Texture + Flow on Context trails;
// Proximity + Breathe + Coalesce + Flow on blur; Proximity + Long-Take on haze…)
// the later pass silently CLOBBERED the earlier one's contribution.
//
// Each pass now RECORDS what it wrote here (keyed `fx:master:<instId>:<name>`,
// the liveModValues convention) and reads this bus FIRST, so contributions stack
// in application order. Cleared at the top of each frame's apply chain, in both
// the control window and the output window.
export const frameVals = new Map<string, number>()

export const clearFrameVals = (): void => {
  frameVals.clear()
}
