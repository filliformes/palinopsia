// Meta Controller smoothing + destination fan-out (dataFLOU's metaSmooth
// pattern). The knob UI never applies values directly — it calls
// setKnobTarget(i, v, smoothMs) and this module tweens the DISPLAY value
// toward the target each rAF, applying every destination along the way, so
// what you see on the dial is exactly what the destinations receive. The
// committed knob.value lands in the store once the tween settles (one undo
// step per gesture, not per frame).
//
// Destinations are ISF float inputs (ModTarget); the knob's 0..1 position is
// shaped by its curve then mapped onto each target's declared range. Writes
// go through the store's normal actions, so modulation overlays them and
// they're OSC-visible later like any base value.

import type { ModTarget } from '@shared/types'
import { shapeCurve } from './engine/modulation'
import { inputsForShader } from './shaders/isf/inputs'
import { useStore } from './store'

const knobDisplay: number[] = []
const tweens: Array<{ from: number; to: number; startedAt: number; ms: number } | null> = []
let raf = 0

// UI subscription (knob dials re-render while tweening).
const listeners = new Set<() => void>()
let version = 0
function bump(): void {
  version++
  listeners.forEach((l) => l())
}

export function knobDisplayValue(i: number): number {
  return knobDisplay[i] ?? useStore.getState().composition.metaKnobs[i]?.value ?? 0
}

export function subscribeKnobDisplay(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export function knobDisplayVersion(): number {
  return version
}

/** Map the knob position onto one destination and write it to the store. */
function applyDest(target: ModTarget, shaped: number): void {
  if (target.kind === 'meta') return // knobs never chain into knobs
  const st = useStore.getState()
  const c = st.composition
  let shaderId: string | null = null
  if (target.kind === 'source') {
    const layer = c.layers[target.layer]
    const slot = target.slot === 'A' ? layer?.sourceA : layer?.sourceB
    shaderId = slot?.shaderId ?? null
  } else {
    const s = target.scope
    const arr =
      s.kind === 'master'
        ? c.master
        : s.kind === 'background'
          ? c.background?.fx
          : s.kind === 'layer'
            ? c.layers[s.layer]?.fx
            : s.kind === 'sourceA'
              ? c.layers[s.layer]?.sourceAFx
              : c.layers[s.layer]?.sourceBFx
    shaderId = arr?.find((f) => f.id === target.instId)?.shaderId ?? null
  }
  if (!shaderId) return
  const d = inputsForShader(shaderId).find((x) => x.name === target.input)
  if (!d || d.type !== 'float') return
  const min = typeof d.min === 'number' ? d.min : 0
  const max = typeof d.max === 'number' ? d.max : 1
  const value = min + shaped * (max - min)
  if (target.kind === 'source') {
    st.setSourceInput(target.layer, target.slot, target.input, value)
  } else {
    st.setFxInput(target.scope, target.instId, target.input, value)
  }
}

function applyKnob(i: number, v01: number): void {
  const knob = useStore.getState().composition.metaKnobs[i]
  if (!knob) return
  const shaped = shapeCurve(v01, knob.curve)
  for (const t of knob.destinations) applyDest(t, shaped)
}

function tick(): void {
  raf = 0
  const now = performance.now()
  let active = false
  for (let i = 0; i < tweens.length; i++) {
    const tw = tweens[i]
    if (!tw) continue
    const k = tw.ms <= 0 ? 1 : Math.min(1, (now - tw.startedAt) / tw.ms)
    knobDisplay[i] = tw.from + (tw.to - tw.from) * k
    applyKnob(i, knobDisplay[i])
    if (k >= 1) {
      tweens[i] = null
      // Commit the settled position — one store write per gesture end.
      useStore.getState().setMetaValue(i, knobDisplay[i])
    } else {
      active = true
    }
  }
  bump()
  if (active) raf = requestAnimationFrame(tick)
}

/** Move knob i toward v (0..1) over smoothMs, applying destinations en route.
 *  For MIDI CC (glide across 1/127 steps) and randomize — NOT mouse drag. */
export function setKnobTarget(i: number, v: number, smoothMs: number): void {
  const from = knobDisplayValue(i)
  const to = Math.max(0, Math.min(1, v))
  tweens[i] = { from, to, startedAt: performance.now(), ms: Math.max(0, smoothMs) }
  if (!raf) raf = requestAnimationFrame(tick)
}

/** Direct, UNSMOOTHED set — for live mouse drag (the pointer is its own
 *  smoothing; a tween on top only adds lag and the steppy burst-update feel).
 *  Cancels any glide, moves the dial + fans out to destinations immediately,
 *  and re-renders now. Does not commit to the store — call commitKnob on
 *  release so the gesture is a single undo step. */
export function setKnobImmediate(i: number, v: number): void {
  const val = v < 0 ? 0 : v > 1 ? 1 : v
  tweens[i] = null
  knobDisplay[i] = val
  applyKnob(i, val)
  bump()
}

/** Persist a knob's current display value to the store (undo checkpoint). */
export function commitKnob(i: number): void {
  useStore.getState().setMetaValue(i, knobDisplayValue(i))
}

/** Re-apply a knob's destinations at its current position (after re-binding). */
export function reapplyKnob(i: number): void {
  applyKnob(i, knobDisplayValue(i))
}

/** Glide every knob to a new random POSITION, keeping its bindings — the ⚄
 *  next to the Meta title (shuffle the macro positions). */
export function shuffleMetaValues(): void {
  const knobs = useStore.getState().composition.metaKnobs
  knobs.forEach((k, i) => setKnobTarget(i, Math.random(), k.smoothMs))
}

/** Full 'Randomize Meta Knobs': re-roll each knob's destinations (up to 8)
 *  AND its position — a fresh macro surface. The store sets bindings+values;
 *  the smoother then glides each knob to its new value, applying the new
 *  destinations along the way. */
export function randomizeMetaKnobs(): void {
  useStore.getState().randomizeMetaBank()
  const knobs = useStore.getState().composition.metaKnobs
  knobs.forEach((k, i) => setKnobTarget(i, k.value, k.smoothMs))
}
