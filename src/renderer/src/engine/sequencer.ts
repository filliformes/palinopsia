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
import { liveModValues, modEngine } from './modulation'
import { audioBus } from './audioIn'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d)

// ── Runtime state (never in the store) ──────────────────────────────────
let running = false
let dwellStart = 0
let nextDwellMs = 8000
let arcStart = 0
let breatheStart = 0
let lastArc = 0 // most recent arc intensity (for the UI meter)
let stepCount = 0
const recent: string[] = [] // recently-visited scene ids (no-repeat window)

// ── S3 punctuation timers ────────────────────────────────────────────────
const CADENCE_MS = 900 // resolve-to-isomorphy pulse
const RUPTURE_MS = 700 // controlled-chaos burst (recall at midpoint)
const MONO_MS = 700 // monomedia drop (recall at trough)
let cadenceUntil = 0
let ruptureUntil = 0
let monoUntil = 0
let monoStyle: 'black' | 'freeze' = 'black'
let freezeHeld = false
// A recall deferred to a punctuation's midpoint/trough.
let pending: { id: string; variation: number; cross: number; at: number } | null = null

// ── S4 deferred advance (audio/chaos-armed) + play history ────────────────
let armed = false // dwell elapsed; waiting for a trigger event
let trigPrev = false // edge-detect the trigger signal
interface ScoreEntry { sceneId: string; name: string; atMs: number; world?: string; climate?: string; punct?: string }
const history: ScoreEntry[] = []
let historyStart = 0

/** (Re)seed timers — on start, and whenever the scene set is replaced. */
function reset(now: number, seq: SequenceState): void {
  dwellStart = now
  arcStart = now
  breatheStart = now
  nextDwellMs = dwellMs(seq)
  stepCount = 0
  cadenceUntil = ruptureUntil = monoUntil = 0
  pending = null
  armed = false
  trigPrev = false
  history.length = 0
  historyStart = now
  recent.length = 0
}

/** Edge-detected advance trigger for S4 (rising edge only). `mode` off = timer. */
function triggerFired(mode: SequenceState['audioAdvance']): boolean {
  if (mode === 'off') return false
  let sig = false
  if (mode === 'chaos') {
    // Any enabled chaos modulator crossing high.
    const cfgs = useStore.getState().composition.modulators
    for (let i = 0; i < cfgs.length; i++) {
      if (cfgs[i]?.enabled && cfgs[i].type === 'chaos' && (modEngine.values[i] ?? 0) > 0.82) {
        sig = true
        break
      }
    }
  } else if (audioBus.mode !== 'off') {
    const v = audioBus.feature(mode === 'onset' ? 'flux' : 'transient')
    sig = v > 0.45
  }
  const fired = sig && !trigPrev
  trigPrev = sig
  return fired
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

// The compositor surface the sequencer writes to.
interface SeqComp {
  setFxInput: (scope: { kind: 'master' }, instId: string, name: string, v: number) => void
  layers: Array<{ sourceMix: number }>
  setFreeze: (on: boolean) => void
}
const MASTER = { kind: 'master' as const }

function doRecall(id: string, variation: number, cross: number): void {
  runSilently(() => useStore.getState().sequenceTo(id, variation, cross))
}

// Cadence / Anchoring (Basanta #2): pull every layer's A/B mix toward isomorphy
// (fused = 0.5) by the decaying pulse — a felt "falling-together" arrival.
function writeCadence(comp: SeqComp, f: number): void {
  for (const L of comp.layers) {
    if (L) L.sourceMix = L.sourceMix + (0.5 - L.sourceMix) * f * 0.9
  }
}

// Rupture (Knight-Hill C#9): a controlled-chaos burst — Context bloom/trails/haze
// surge + a fast chroma throb on the Finalizer — that RESOLVES as it decays into
// the cut. On-brand (Context's gated exception), bounded, never a strobe.
function writeRupture(comp: SeqComp, c: CompositionState, now: number, f: number): void {
  const ctx = c.master.find((x) => x.shaderId === 'fx-context')
  if (ctx) {
    comp.setFxInput(MASTER, ctx.id, 'trails', clamp01(0.3 + f * 0.6))
    comp.setFxInput(MASTER, ctx.id, 'bloom', clamp01(0.2 + f * 0.5))
    comp.setFxInput(MASTER, ctx.id, 'haze', clamp01(0.05 + f * 0.2))
  }
  const fin = c.master.find((x) => x.shaderId === 'fx-finalizer')
  if (fin) {
    const throb = Math.sin(now * 0.05) * f * 0.3
    comp.setFxInput(MASTER, fin.id, 'sharpen', f * 1.4)
    comp.setFxInput(MASTER, fin.id, 'rGain', 1 + throb)
    comp.setFxInput(MASTER, fin.id, 'bGain', 1 - throb)
  }
}

// Monomedia drop (Boucher/Piché): drop one medium as a transition tension marker.
// 'black' fades the Finalizer to black at the trough; 'freeze' holds the last
// frame (the compositor does that) — either way audio continues underneath.
function writeMonoBlack(comp: SeqComp, c: CompositionState, now: number): void {
  const p = clamp01(1 - (monoUntil - now) / MONO_MS) // 0..1 across the drop
  const dark = 1 - Math.abs(2 * p - 1) // 0 at edges → 1 at the trough
  const g = clamp01(1 - dark)
  const fin = c.master.find((x) => x.shaderId === 'fx-finalizer')
  if (fin) {
    comp.setFxInput(MASTER, fin.id, 'rGain', g)
    comp.setFxInput(MASTER, fin.id, 'gGain', g)
    comp.setFxInput(MASTER, fin.id, 'bGain', g)
  }
}

/**
 * Tick the sequencer. Called every frame by the App loop (after proximity).
 * Reads its own state from the store; advances + writes overlays. Returns the
 * arc intensity (0..1) for the UI meter, or null when not running.
 */
export function tickSequencer(now: number, comp: SeqComp, c: CompositionState): number | null {
  const st = useStore.getState()
  const seq = st.sequence
  if (!seq.enabled || !seq.running) {
    if (running) {
      running = false
      if (freezeHeld) { comp.setFreeze(false); freezeHeld = false } // never leave the screen frozen
    }
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

  // A punctuation's deferred recall (rupture midpoint / monomedia trough).
  if (pending && now >= pending.at) {
    doRecall(pending.id, pending.variation, pending.cross)
    pending = null
  }

  // Pick + fire the next scene (normal / rupture / monomedia + cadence), and log
  // the AVU to the play history for the relation-score export.
  const advance = (): void => {
    const next = pickNext(scenes, seq, st.activeSceneId, arcInt)
    if (next) {
      stepCount++
      const doRupture = seq.ruptureChance > 0 && Math.random() < seq.ruptureChance
      const doMono = !doRupture && seq.monomediaChance > 0 && Math.random() < seq.monomediaChance
      let punct = ''
      if (doRupture) {
        ruptureUntil = now + RUPTURE_MS
        pending = { id: next.id, variation: seq.variation, cross: 0, at: now + RUPTURE_MS / 2 }
        punct = 'rupture'
      } else if (doMono) {
        monoUntil = now + MONO_MS
        monoStyle = seq.monomediaStyle
        if (monoStyle === 'freeze') { comp.setFreeze(true); freezeHeld = true }
        pending = { id: next.id, variation: seq.variation, cross: 0, at: now + MONO_MS / 2 }
        punct = `monomedia:${monoStyle}`
      } else {
        doRecall(next.id, seq.variation, transitionMs(seq, next))
        if (seq.cadenceEvery > 0 && stepCount % seq.cadenceEvery === 0) {
          cadenceUntil = now + CADENCE_MS
          punct = 'cadence'
        }
      }
      recent.push(next.id)
      while (recent.length > Math.max(0, seq.noRepeat)) recent.shift()
      history.push({
        sceneId: next.id,
        name: next.name,
        atMs: now - historyStart,
        world: next.tags?.world,
        climate: next.tags?.climate,
        punct: punct || undefined
      })
      if (history.length > 500) history.shift()
    }
    dwellStart = now
    nextDwellMs = dwellMs(seq)
    armed = false
  }

  // Advance when the dwell elapses (unless a punctuation is mid-flight). With
  // audio/chaos arming (S4) the dwell is a MINIMUM — the step fires on the next
  // transient/onset/chaos edge (Anchoring/Delayed synchresis · C#7).
  const busy = now < ruptureUntil || now < monoUntil || pending !== null
  const fired = triggerFired(seq.audioAdvance)
  if (!busy && scenes.length > 1) {
    const dwellElapsed = now - dwellStart >= nextDwellMs
    if (seq.audioAdvance === 'off') {
      if (dwellElapsed) advance()
    } else {
      if (dwellElapsed) armed = true
      if (armed && fired) advance()
    }
  }

  // Continuous overlay (Breathe + Arc).
  const curTags = scenes.find((s) => s.id === useStore.getState().activeSceneId)?.tags
  writeContextOverlay(comp, c, seq, now, curTags, arcInt)

  // ── S3 punctuation overlays ──
  if (now < cadenceUntil) writeCadence(comp, (cadenceUntil - now) / CADENCE_MS)
  if (now < ruptureUntil) writeRupture(comp, c, now, (ruptureUntil - now) / RUPTURE_MS)
  if (now < monoUntil) {
    if (monoStyle === 'black') writeMonoBlack(comp, c, now)
  } else if (freezeHeld) {
    comp.setFreeze(false) // release the freeze at the end of the drop
    freezeHeld = false
  }

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

/** True while the dwell has elapsed and the sequencer is waiting for an audio/
 *  chaos trigger to fire the next step (S4). */
export function sequencerArmed(): boolean {
  return running && armed
}

// ── Relation-score export (Boucher/Piché "future work": a representational
// score of ordered AVUs) ────────────────────────────────────────────────────
const fmtT = (ms: number): string => {
  const s = Math.round(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** The play history as a Markdown relation-score (ordered AVUs: time · scene ·
 *  Diégèse · Climat · punctuation). Empty string when nothing has played. */
export function sequencerScoreMarkdown(): string {
  if (history.length === 0) return ''
  const name = useStore.getState().name || 'Untitled'
  const lines = [
    `# Opsia relation-score — ${name}`,
    '',
    'Ordered AVUs as the macro-form sequencer played them.',
    '',
    '| time | scene | diégèse | climat | punctuation |',
    '|---|---|---|---|---|'
  ]
  for (const h of history) {
    lines.push(`| ${fmtT(h.atMs)} | ${h.name} | ${h.world ?? '—'} | ${h.climate ?? '—'} | ${h.punct ?? '·'} |`)
  }
  lines.push('', `_${history.length} AVUs · exported from Palinopsia._`)
  return lines.join('\n')
}
