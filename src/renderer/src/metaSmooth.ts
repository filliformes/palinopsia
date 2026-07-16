// Meta Controller smoothing + destination fan-out (dataFLOU's metaSmooth
// pattern). The knob UI never applies values directly : it calls
// setKnobTarget(i, v, smoothMs) and this module tweens the DISPLAY value
// toward the target each rAF; the render loop reads `metaGlides` and fans the
// in-flight position out to every destination straight into the engine
// (applyMetaGlides in modulation.ts) — ZERO store writes per frame, so a
// gliding knob never churns React. The committed knob.value AND the final
// destination values land in the store once the tween settles (one undo step
// per gesture, not per frame).
//
// Destinations are ISF float inputs (ModTarget); the knob's 0..1 position is
// shaped by its curve then mapped onto each target's declared range. The
// settle-time writes go through the store's normal actions, so they persist,
// morph and stay OSC-visible like any base value.

import type { ModTarget } from '@shared/types'
import { withSonifyParam } from './audio/sonify'
import { shapeCurve, inputValueFrom01, SONIFY_MOD_DESCS } from './engine/modulation'
import { inputsForShader } from './shaders/isf/inputs'
import { useStore } from './store'

const knobDisplay: number[] = []
const tweens: Array<{ from: number; to: number; startedAt: number; ms: number } | null> = []
let raf = 0

// Knobs currently in-flight (gliding or dragged) : knob index → display 0..1.
// The render loop overlays these onto the engine each frame (applyMetaGlides)
// and mirrors them to the output window. Entries clear on settle/commit.
export const metaGlides = new Map<number, number>()

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

/** Map the knob position onto one destination and write it to the store.
 *  SETTLE-TIME ONLY : the per-frame path is the engine overlay (metaGlides). */
function applyDest(target: ModTarget, shaped: number): void {
  if (target.kind === 'meta') return // knobs never chain into knobs
  const st = useStore.getState()
  // Sonify probe destination : commit into the sonify config (real units).
  if (target.kind === 'sonify') {
    const d = SONIFY_MOD_DESCS[target.param]
    if (!d) return
    const v = d.min + Math.max(0, Math.min(1, shaped)) * (d.max - d.min)
    st.setSonify(withSonifyParam(st.sonify, target.param, v))
    return
  }
  const c = st.composition
  let shaderId: string | null = null
  if (target.kind === 'source') {
    const layer = c.layers[target.layer]
    const slot = target.slot === 'A' ? layer?.sourceA : layer?.sourceB
    shaderId = slot?.shaderId ?? null
  } else if (target.kind === 'bgSource') {
    shaderId = c.background?.source.shaderId ?? null
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
  if (!d) return
  const value = inputValueFrom01(d, shaped) // float span · enum snap · bool threshold
  if (value === null) return
  if (target.kind === 'source') {
    st.setSourceInput(target.layer, target.slot, target.input, value)
  } else if (target.kind === 'bgSource') {
    st.setBackgroundInput(target.input, value)
  } else {
    st.setFxInput(target.scope, target.instId, target.input, value)
  }
}

/** Commit a knob's final position to the store : knob.value + one fan-out of
 *  the final destination values. One store burst per gesture. */
function settle(i: number, v01: number): void {
  metaGlides.delete(i)
  const knob = useStore.getState().composition.metaKnobs[i]
  useStore.getState().setMetaValue(i, v01)
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
    if (k >= 1) {
      tweens[i] = null
      settle(i, knobDisplay[i])
    } else {
      // In flight : the render loop fans this out engine-side.
      metaGlides.set(i, knobDisplay[i])
      active = true
    }
  }
  bump()
  if (active) raf = requestAnimationFrame(tick)
}

/** Move knob i toward v (0..1) over smoothMs, applying destinations en route.
 *  For MIDI CC (glide across 1/127 steps) and randomize : NOT mouse drag. */
export function setKnobTarget(i: number, v: number, smoothMs: number): void {
  const from = knobDisplayValue(i)
  const to = Math.max(0, Math.min(1, v))
  tweens[i] = { from, to, startedAt: performance.now(), ms: Math.max(0, smoothMs) }
  if (!raf) raf = requestAnimationFrame(tick)
}

/** Direct, UNSMOOTHED set : for live mouse drag (the pointer is its own
 *  smoothing; a tween on top only adds lag and the steppy burst-update feel).
 *  Cancels any glide, moves the dial + registers the engine overlay, and
 *  re-renders now. Does not touch the store : call commitKnob on release so
 *  the gesture is a single undo step. */
export function setKnobImmediate(i: number, v: number): void {
  const val = v < 0 ? 0 : v > 1 ? 1 : v
  tweens[i] = null
  knobDisplay[i] = val
  metaGlides.set(i, val)
  bump()
}

/** Persist a knob's current display value to the store (undo checkpoint). */
export function commitKnob(i: number): void {
  settle(i, knobDisplayValue(i))
}

/** Glide every knob to a new random POSITION, keeping its bindings : the ⚄
 *  next to the Meta title (shuffle the macro positions). */
export function shuffleMetaValues(): void {
  const knobs = useStore.getState().composition.metaKnobs
  knobs.forEach((k, i) => setKnobTarget(i, Math.random(), k.smoothMs))
}

/** Full 'Randomize Meta Knobs': re-roll each knob's destinations (up to 8)
 *  AND its position : a fresh macro surface. The store sets bindings+values;
 *  the smoother then glides each knob to its new value, applying the new
 *  destinations along the way. */
export function randomizeMetaKnobs(): void {
  useStore.getState().randomizeMetaBank()
  const knobs = useStore.getState().composition.metaKnobs
  knobs.forEach((k, i) => setKnobTarget(i, k.value, k.smoothMs))
}
