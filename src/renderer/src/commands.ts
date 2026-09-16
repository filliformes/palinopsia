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

// Global freeze / hold : a latch the render loop ORs into its per-frame freeze
// (App reads isFrozen() each frame and calls comp.setFreeze). No Compositor ref
// needed here — the render loop already owns the freeze application. The button
// (and any indicator) subscribe so the UI reflects the latch state live.
let frozen = false
const freezeListeners = new Set<() => void>()
export function fireFreeze(): void {
  frozen = !frozen
  for (const l of freezeListeners) l()
}
export function isFrozen(): boolean {
  return frozen
}
/** Subscribe to freeze-latch changes (useSyncExternalStore-shaped). */
export function subscribeFrozen(cb: () => void): () => void {
  freezeListeners.add(cb)
  return () => freezeListeners.delete(cb)
}

// Recording toggle needs the canvas + a delivery format (App-side), so App
// registers the toggle thunk and the MIDI router / a pad fire it.
let recordToggleFn: (() => void) | null = null
export function registerRecordToggle(fn: (() => void) | null): void {
  recordToggleFn = fn
}
/** Start a take (default fast/no-reencode) or stop the running one. */
export function fireRecordToggle(): void {
  recordToggleFn?.()
}

// The Inspector's and Finishing tab's randomize dice act on the CURRENTLY-shown
// unit (selection-dependent), so those components register a thunk while mounted
// and a learned MIDI pad fires the same closure. Null when nothing is inspected.
let inspectorRandFn: (() => void) | null = null
export function registerInspectorRandomize(fn: (() => void) | null): void {
  inspectorRandFn = fn
}
export function fireInspectorRandomize(): void {
  inspectorRandFn?.()
}

// New / Load session are App-side (a save-before-leave step, a file dialog, a
// dropdown selection), so those components register their thunks and a learned
// pad fires the same closure.
let newSessionFn: (() => void) | null = null
export function registerNewSession(fn: (() => void) | null): void {
  newSessionFn = fn
}
export function fireNewSession(): void {
  newSessionFn?.()
}
let loadSessionFn: (() => void) | null = null
export function registerLoadSession(fn: (() => void) | null): void {
  loadSessionFn = fn
}
export function fireLoadSession(): void {
  loadSessionFn?.()
}
let openSessionFn: (() => void) | null = null
export function registerOpenSession(fn: (() => void) | null): void {
  openSessionFn = fn
}
export function fireOpenSession(): void {
  openSessionFn?.()
}
