// Film homage : three global "temperament" controls that sit beside
// the field macros (engine/field.ts) and, like them, apply AFTER modulation each
// frame and rest at a neutral deadzone (0 = off) so they never fight manual /
// World / modulation when parked:
//
//  - TONICITY (thèse §3.10, "Mémoire : couleur, hauteur et timbre") : his
//    colour/pitch/timbre language: tonal, harmonic audio pulls COLOUR in, noisy /
//    percussive audio pulls the image toward black-and-white.
//  - SHUTTER (§1.7, Displacement) : his frame-by-frame montage at 12/24/48 fps:
//    holds the output for a few frames then jumps (stop-motion stepping).
//  - DRIFT (§1.8, "[Perte de] Contrôle") : his virtuosity-vs-accident: a slow
//    analog-style wander over the finishing grade, plus rare parameter "accidents".

import type { CompositionState } from '@shared/types'
import { audioBus } from './audioIn'
import { liveModValues } from './modulation'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d)
const MASTER = { kind: 'master' as const }

type MacroComp = {
  setFxInput: (scope: { kind: 'master' }, instId: string, name: string, v: number) => void
}

/** The exact master-FX input values a temperament pass applied this frame
 *  ({ instId: { input: value } }). Returned so the output window can mirror the
 *  result WITHOUT re-running the audio/random/time-dependent computation. */
export type MasterOverrides = Record<string, Record<string, number>>

/** Tonal audio → colour, noisy audio → monochrome (§3.10). `amount` 0 = off.
 *  Colour-ness is read from spectral flux (steady = tonal, churning = noisy);
 *  loudness gates the effect so silence stays neutral rather than forcing grey.
 *  Returns the applied overrides (or null) so the output mirror is exact. */
export function applyTonicity(comp: MacroComp, c: CompositionState, amount: number): MasterOverrides | null {
  if (amount < 0.02 || audioBus.mode === 'off') return null
  const vibe = c.master.find((f) => f.shaderId === 'fx-vibe')
  if (!vibe) return null
  const level = audioBus.feature('level')
  const flux = audioBus.feature('flux')
  const presence = clamp01((level - 0.02) / 0.18) // fade in over a low-level window
  const eff = amount * presence
  if (eff < 0.02) return null

  const colourness = clamp01(1 - flux * 1.2) // noisy (high flux) → 0 → grey
  const satFactor = 0.15 + colourness * 1.2 // noisy ≈ ×0.15, tonal ≈ ×1.35
  const liveVal = (name: string, d: number): number =>
    (liveModValues.get(`fx:master:${vibe.id}:${name}`) as number | undefined) ?? num(vibe.inputs[name], d)

  const ov: MasterOverrides = {}
  const set = (id: string, name: string, v: number): void => {
    comp.setFxInput(MASTER, id, name, v)
    ;(ov[id] ??= {})[name] = v
  }
  const baseSat = liveVal('saturation', 1) // Vibe saturation range 0..2
  set(vibe.id, 'saturation', clamp(baseSat * (1 - eff) + baseSat * satFactor * eff, 0, 2))
  const baseChroma = liveVal('chroma', 0.55) // range 0..1
  set(vibe.id, 'chroma', clamp01(baseChroma * (1 - eff) + baseChroma * satFactor * eff))
  return ov
}

// ── Shutter : GLOBAL full-freeze stop-motion ─────────────────────────
// This drives Compositor.setFreeze, which dead-holds the WHOLE presented frame
// (incl. warp/xfade). It is deliberately DISTINCT from the Cameraless film-hold
// (engine/cameraless.ts): that one is output-resample-only so upstream feedback
// keeps integrating and you see it stepped, plus gate-weave/blank/materiality.
let lastStep = -1
let holding = false
/** Returns whether THIS frame should hold (freeze) the last rendered frame.
 *  `shutter` 0 = off (always false); low = slow/chunky, →1 = fast/fluid. One
 *  fresh frame is let through each step; the rest are held. */
export function shutterHold(nowMs: number, shutter: number): boolean {
  if (shutter < 0.02) {
    lastStep = -1
    holding = false
    return false
  }
  const stepsPerSec = 2 + shutter * 22 // slow: 2 fps (chunky) → fast: 24 fps (fluid)
  const step = Math.floor((nowMs / 1000) * stepsPerSec)
  if (step !== lastStep) {
    lastStep = step
    holding = false // let this fresh frame through
    return false
  }
  holding = true
  return holding
}

/** Call when shutter is off: returns true once if a prior shutter run left the
 *  output frozen (so the caller can release the freeze), else false. */
export function shutterClear(): boolean {
  if (lastStep !== -1 || holding) {
    lastStep = -1
    holding = false
    return true
  }
  return false
}

// ── Drift : analog-instability temperament ───────────────────────────
// Rare "accident" state: a brief excursion re-rolled at intervals.
let accUntil = 0
let accSeed = 0
/** Slow wander over the finishing grade + rare accidents (§1.8). `drift` 0 = off.
 *  Bounded and additive on the live values, so it colours the temperament without
 *  ever running away or erasing a modulator on the same param. */
export function applyDrift(comp: MacroComp, c: CompositionState, drift: number, nowMs: number): MasterOverrides | null {
  if (drift < 0.02) return null
  const ov: MasterOverrides = {}
  const set = (id: string, name: string, v: number): void => {
    comp.setFxInput(MASTER, id, name, v)
    ;(ov[id] ??= {})[name] = v
  }
  const fin = c.master.find((f) => f.shaderId === 'fx-finalizer')
  const vibe = c.master.find((f) => f.shaderId === 'fx-vibe')
  const t = nowMs / 1000
  const finLive = (name: string, d: number): number =>
    (fin && (liveModValues.get(`fx:master:${fin.id}:${name}`) as number | undefined)) ?? (fin ? num(fin.inputs[name], d) : d)
  const vibeLive = (name: string, d: number): number =>
    (vibe && (liveModValues.get(`fx:master:${vibe.id}:${name}`) as number | undefined)) ?? (vibe ? num(vibe.inputs[name], d) : d)

  // Slow incommensurate wander (three primes so it never obviously repeats).
  const w1 = Math.sin(t * 0.23)
  const w2 = Math.sin(t * 0.37 + 1.7)
  const w3 = Math.sin(t * 0.53 + 4.1)

  // Occasional accident : a short, larger excursion (a "torrent of control data"
  // moment). Probability scales with drift; each lasts ~0.15–0.35 s.
  if (nowMs > accUntil && Math.random() < drift * 0.02) {
    accUntil = nowMs + 150 + Math.random() * 200
    accSeed = Math.random()
  }
  const acc = nowMs < accUntil ? (accSeed - 0.5) : 0

  if (fin) {
    set(fin.id, 'gamma', Math.max(0.4, finLive('gamma', 1) + w1 * 0.06 * drift + acc * 0.5 * drift))
    set(fin.id, 'rGain', Math.max(0, finLive('rGain', 1) + w2 * 0.05 * drift))
    set(fin.id, 'bGain', Math.max(0, finLive('bGain', 1) - w2 * 0.05 * drift))
    // Accidents briefly kick the grain/parasites (analog breakup on the excursion).
    if (acc !== 0) set(fin.id, 'parasites', clamp01(finLive('parasites', 0.1) + Math.abs(acc) * drift))
  }
  if (vibe) {
    set(vibe.id, 'contrast', clamp01(vibeLive('contrast', 0.5) + w3 * 0.05 * drift))
  }
  return ov
}
