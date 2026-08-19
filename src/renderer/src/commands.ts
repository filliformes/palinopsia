// Performance commands shared by the keyboard (App), the Transport buttons
// and the MIDI router : one canonical implementation each, so a hardware pad
// and the R key can never drift apart.

import { randomSonify } from './audio/autoSonify'
import { randomizeMetaKnobs } from './metaSmooth'
import type { RandomizeScope } from './randomize'
import { useStore } from './store'

/** Fire the Randomize mode the Transport's chevron currently points at
 *  (persisted in localStorage) at the persisted intensity. */
export function fireSelectedRandomize(): void {
  const raw = localStorage.getItem('opsia.randScope') as RandomizeScope | null
  const scope: RandomizeScope = raw ?? 'all'
  if (scope === 'meta') {
    randomizeMetaKnobs()
    return
  }
  if (scope === 'sonify') {
    const st = useStore.getState()
    st.setSonify(randomSonify(st.sonify))
    return
  }
  const i = Number(localStorage.getItem('opsia.randIntensity'))
  const intensity = Number.isFinite(i) && i > 0 ? i : 1
  useStore.getState().randomize(scope, intensity)
}

/** Fire a Variation at the Transport's persisted spread (the Vary button). */
export function fireVariation(): void {
  const v = Number(localStorage.getItem('opsia.varAmount'))
  const amt = Number.isFinite(v) && v > 0 ? v : 0.3
  useStore.getState().applyVariation(amt)
}

// Panic flush needs the live Compositor (which isn't in the store), so App
// registers a thunk here and the `0` key + the Transport button both fire it.
let panicFn: (() => void) | null = null
export function registerPanic(fn: (() => void) | null): void {
  panicFn = fn
}
/** Empty every self-feeding buffer (`Compositor.panic`) : the safety net. */
export function firePanic(): void {
  panicFn?.()
}
