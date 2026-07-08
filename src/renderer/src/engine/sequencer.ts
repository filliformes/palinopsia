// Generative scene / relation sequencer (macro-form engine) — S1 + S2.
// See docs/opsia-sequencer-spec.md. Ticked by the App render loop after
// applyProximity (a peer of coupling/proximity). Holds its runtime timers in
// module state the store never sees; advances by calling the store's
// `sequenceTo` action (wrapped in runSilently so auto-advances don't flood the
// 100-level undo history); and writes the Breathe + Climate-arc overlay onto the
// Context finalizer each frame — post-modulation, zero React churn.

import type { CompositionState, SceneEntry, SequenceState } from '@shared/types'
import { useStore } from '../store'
import { runSilently } from '../undo'
import { liveModValues } from './modulation'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d)

// ── Runtime state (never in the store) ──────────────────────────────────
let running = false
let dwellStart = 0
let nextDwellMs = 8000
let arcStart = 0
let breatheStart = 0
let lastArc = 0 // most recent arc intensity (for the UI meter)
const recent: string[] = [] // recently-visited scene ids (no-repeat window)

/** (Re)seed timers — on start, and whenever the scene set is replaced. */
function reset(now: number, seq: SequenceState): void {
  dwellStart = now
  arcStart = now
  breatheStart = now
  nextDwellMs = dwellMs(seq)
  recent.length = 0
}

function dwellMs(seq: SequenceState): number {
  const jitter = 1 + (Math.random() * 2 - 1) * clamp01(seq.dwellJitter)
  return Math.max(500, seq.dwell * 1000 * jitter)
}

// Triangle 0→1→0 over `lengthSec` — the Repose–Disturbance–Repose intensity.
function arcIntensity(now: number, lengthSec: number): number {
  if (lengthSec <= 0) return 0
  const p = ((now - arcStart) / 1000 / lengthSec) % 1
  return p < 0.5 ? p * 2 : (1 - p) * 2
}

// Which climates the arc favours at a given intensity (repose ↔ disturbance).
function arcFavours(intensity: number): string[] {
  if (intensity < 0.35) return ['release', 'resolution']
  if (intensity < 0.7) return ['expectation', 'tension']
  return ['tension']
}

/** Weighted pick of the next scene from the tags (§2 of the spec). */
function pickNext(
  scenes: SceneEntry[],
  seq: SequenceState,
  curId: string | null,
  arcInt: number
): SceneEntry | null {
  const others = scenes.filter((s) => s.id !== curId)
  if (others.length === 0) return null
  const fresh = others.filter((s) => !recent.includes(s.id))
  const pool = fresh.length ? fresh : others
  const cur = scenes.find((s) => s.id === curId)?.tags
  const favours = seq.mode === 'arc' ? arcFavours(arcInt) : []

  const weights = pool.map((s) => {
    if (seq.mode === 'shuffle') return 1
    let w = 1
    const t = s.tags
    if (t && cur) {
      if (t.world !== cur.world) w *= 0.45 // world changes are rarer, bigger punctuation
      w *= 1 - 0.5 * Math.abs((t.spaceTime ?? 0.5) - (cur.spaceTime ?? 0.5)) // prefer a modest Espace-temps step
    }
    if (seq.mode === 'arc' && t && favours.includes(t.climate)) w *= 1.7
    return Math.max(0.02, w)
  })

  let r = Math.random() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r <= 0) return pool[i]
  }
  return pool[pool.length - 1]
}

/** Morph ms for a transition: cut≈0, morph=set, auto=cut when the destination's
 *  Synchrèse is percussive (cut/hocket), morph otherwise. */
function transitionMs(seq: SequenceState, dest: SceneEntry): number {
  if (seq.transition === 'cut') return 0
  if (seq.transition === 'morph') return seq.crossfadeMs
  const s = dest.tags?.synchresis ?? []
  return s.includes('cut') || s.includes('hocket') ? 0 : seq.crossfadeMs
}

/** Breathe (Espace-temps) + Climate-arc overlay onto Context — post-modulation.
 *  Centres on the current scene's spaceTime tag, oscillates toward dense↔void;
 *  the arc lifts bloom/haze at its peak. All within Finishing-safe bands. */
function writeContextOverlay(
  comp: { setFxInput: (scope: { kind: 'master' }, instId: string, name: string, v: number) => void },
  c: CompositionState,
  seq: SequenceState,
  now: number,
  curTags: SceneEntry['tags'],
  arcInt: number
): void {
  const breatheOn = seq.breathe.amount > 0.001 && seq.breathe.periodSec > 0
  const arcOn = seq.arc.enabled
  if (!breatheOn && !arcOn) return
  const ctx = c.master.find((f) => f.shaderId === 'fx-context')
  if (!ctx) return

  const center = curTags ? clamp01(curTags.spaceTime) : 0.5
  let s = center
  if (breatheOn) {
    const phase = ((now - breatheStart) / 1000 / seq.breathe.periodSec) * Math.PI * 2
    s = clamp01(center + Math.sin(phase) * 0.5 * clamp01(seq.breathe.amount))
  }
  // s: 0 full/present → 1 void/distant. Map to Context mood (safe bands).
  const scope = { kind: 'master' as const }
  const set = (name: string, v: number): void => comp.setFxInput(scope, ctx.id, name, clamp01(v))
  // Blend from the live/base value so we don't hard-stomp a modulated Context.
  const cur = (name: string, d: number): number =>
    liveModValues.get(`fx:master:${ctx.id}:${name}`) ?? num(ctx.inputs[name], d)
  if (breatheOn) {
    set('haze', 0.02 + s * 0.3) // void → hazier
    set('depth', 0.15 + s * 0.4) // void → deeper vignette
    set('blur', s * 0.14) // void → softer
  }
  if (arcOn) {
    // Disturbance peak lifts bloom + a touch of haze on top of whatever's there.
    set('bloom', cur('bloom', 0.3) + arcInt * 0.14)
    if (!breatheOn) set('haze', cur('haze', 0.15) + arcInt * 0.1)
  }
}

/**
 * Tick the sequencer. Called every frame by the App loop (after proximity).
 * Reads its own state from the store; advances + writes overlays. Returns the
 * arc intensity (0..1) for the UI meter, or null when not running.
 */
export function tickSequencer(
  now: number,
  comp: { setFxInput: (scope: { kind: 'master' }, instId: string, name: string, v: number) => void },
  c: CompositionState
): number | null {
  const st = useStore.getState()
  const seq = st.sequence
  if (!seq.enabled || !seq.running) {
    if (running) running = false
    return null
  }
  const scenes = st.scenes
  if (scenes.length === 0) return null
  if (!running) {
    running = true
    reset(now, seq)
    if (st.activeSceneId) recent.push(st.activeSceneId)
  }

  const arcInt = arcIntensity(now, seq.arc.enabled ? seq.arc.lengthSec : 0)

  // Advance when the dwell elapses (and there's somewhere to go).
  if (now - dwellStart >= nextDwellMs && scenes.length > 1) {
    const next = pickNext(scenes, seq, st.activeSceneId, arcInt)
    if (next) {
      const cross = transitionMs(seq, next)
      runSilently(() => useStore.getState().sequenceTo(next.id, seq.variation, cross))
      recent.push(next.id)
      while (recent.length > Math.max(0, seq.noRepeat)) recent.shift()
    }
    dwellStart = now
    nextDwellMs = dwellMs(seq)
  }

  // Continuous overlay (Breathe + Arc).
  const curTags = scenes.find((s) => s.id === useStore.getState().activeSceneId)?.tags
  writeContextOverlay(comp, c, seq, now, curTags, arcInt)
  lastArc = arcInt
  return arcInt
}

/** Latest arc intensity 0..1 (for the UI meter). */
export function sequencerArcIntensity(): number {
  return running ? lastArc : 0
}

/** Manual "skip →" from the UI — advance now (respects transition + variation). */
export function sequencerSkip(): void {
  const st = useStore.getState()
  const seq = st.sequence
  if (st.scenes.length < 2) return
  const arcInt = arcIntensity(performance.now(), seq.arc.enabled ? seq.arc.lengthSec : 0)
  const next = pickNext(st.scenes, seq, st.activeSceneId, arcInt)
  if (!next) return
  runSilently(() => useStore.getState().sequenceTo(next.id, seq.variation, transitionMs(seq, next)))
  recent.push(next.id)
  while (recent.length > Math.max(0, seq.noRepeat)) recent.shift()
  dwellStart = performance.now()
  nextDwellMs = dwellMs(seq)
}

/** ms remaining until the next auto-advance (for the UI countdown). */
export function sequencerCountdownMs(): number {
  return running ? Math.max(0, nextDwellMs - (performance.now() - dwellStart)) : 0
}
