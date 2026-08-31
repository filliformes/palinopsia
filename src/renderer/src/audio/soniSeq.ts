// The Sonify step sequencer's clock. Advances the store's `soniSeq` on its
// interval and applies each step to the sound engine — either loading a whole
// saved preset (structural change) or, with no preset, just setting which of the
// 8 voices are on (a rhythmic on/off pattern over the current sound). Driven from
// App's render loop (like tickSequencer). Every apply goes through setSonify
// wrapped in runSilently so the auto-advances never flood undo history.

import { useStore } from '../store'
import { runSilently } from '../undo'
import { loadSoniPreset } from './soniPresets'
import type { SoniConfig } from './sonify'

const VOICE_KEYS = ['spectra', 'orbit', 'flow', 'events', 'raster', 'sstv', 'filter', 'chord'] as const

let lastStepAt = 0
let wasOn = false

// ── Advance modes (ported from dataFLOU's factory.ts) ─────────────────────
// Bounce : forward order, but each cycle's step durations shrink geometrically
// (a bouncing ball settling) — the whole cycle still lasts stepMs·steps.
function bounceCoeff(decay: number): number {
  return 0.4 + (Math.max(0, Math.min(100, decay)) / 100) * 0.55 // [0.40, 0.95]
}
function bounceStepDuration(stepMs: number, steps: number, decay: number, i: number): number {
  const s = Math.max(1, Math.floor(steps))
  const e = bounceCoeff(decay)
  const total = Math.max(1, stepMs) * s
  const sumGeom = e === 1 ? s : (1 - Math.pow(e, s)) / (1 - e)
  return Math.max(1, (total / sumGeom) * Math.pow(e, ((i % s) + s) % s))
}
// Drift : a biased random walk over the steps, wrapping or reflecting at the ends.
function advanceDrift(pos: number, steps: number, bias: number, edge: 'wrap' | 'reflect'): number {
  const s = Math.max(1, Math.min(16, Math.floor(steps)))
  if (s <= 1) return 0
  const b = Math.max(-100, Math.min(100, bias)) / 100
  const absB = Math.abs(b)
  const pStay = (1 - absB) / 3
  const pFwd = b >= 0 ? pStay + b * (1 - pStay) : pStay * (1 + b)
  const pBack = 1 - pStay - pFwd
  const r = Math.random()
  const dir = r < pBack ? -1 : r < pBack + pStay ? 0 : 1
  let next = pos + dir
  if (edge === 'wrap') next = ((next % s) + s) % s
  else {
    if (next < 0) next = -next
    else if (next >= s) next = s - 1 - (next - (s - 1))
    next = Math.max(0, Math.min(s - 1, next))
  }
  return next
}

export function tickSonifySeq(now: number): void {
  const st = useStore.getState()
  const sq = st.soniSeq
  if (!sq.on) {
    wasOn = false
    return
  }
  const len = Math.max(1, sq.len)
  if (!wasOn) {
    // Just started : apply the current step immediately, then time from here.
    wasOn = true
    lastStepAt = now
    applyStep(sq.cur)
    return
  }
  // Bounce uses a per-step (accelerating) dwell; forward/drift use a uniform one.
  const dwell = sq.mode === 'bounce' ? bounceStepDuration(sq.stepMs, len, sq.bounceDecay, sq.cur) : sq.stepMs
  if (now - lastStepAt < dwell) return
  lastStepAt = now
  const next = sq.mode === 'drift' ? advanceDrift(sq.cur, len, sq.bias, sq.edge) : (sq.cur + 1) % len
  st.setSoniSeqCur(next)
  applyStep(next)
}

function applyVoiceMask(cur: SoniConfig, mask: boolean[]): SoniConfig {
  const next = { ...cur } as SoniConfig
  const rec = next as unknown as Record<string, { on: boolean }>
  const cr = cur as unknown as Record<string, { on: boolean }>
  VOICE_KEYS.forEach((k, vi) => {
    rec[k] = { ...cr[k], on: !!mask[vi] }
  })
  return next
}

function applyStep(i: number): void {
  const st = useStore.getState()
  const step = st.soniSeq.steps[i]
  if (!step) return
  const cur = st.sonify
  runSilently(() => {
    if (step.preset) {
      // A whole preset : keep the machine-local on-state + output device.
      const cfg = loadSoniPreset(step.preset)
      if (cfg) useStore.getState().setSonify({ ...cfg, on: cur.on, sinkId: cur.sinkId } as SoniConfig)
      return
    }
    useStore.getState().setSonify(applyVoiceMask(cur, step.voices))
  })
}
