// Undo/redo : 100 levels over the WHOLE session surface — composition, scene
// bank, sequence config, and the active World. New/Generate wipe scenes and
// the sequence too, so "one Ctrl+Z away" must restore all of it, not just the
// composition.
//
// History lives OUTSIDE React (module state): a debounced subscriber watches
// the store's watched slices and, after 300 ms of quiet, commits the previous
// snapshot to the past stack. Slider drags and modulator sweeps therefore
// group into ONE undo step per gesture instead of hundreds. Every watched
// slice is immutable (store actions rebuild them), so snapshots are just
// references — no cloning cost.

import { useSyncExternalStore } from 'react'
import type { CompositionState, SceneEntry, SequenceState, World } from '@shared/types'
import { saveUserWorlds, useStore } from './store'
import { cancelMorph } from './morph'
import { showToast } from './components/Toast'
import { tempoEdited } from './tempoEvents'

const CAPACITY = 100
const QUIET_MS = 300

type FullState = ReturnType<typeof useStore.getState>

// One undo step : references into the store's immutable slices.
interface Snapshot {
  composition: CompositionState
  scenes: SceneEntry[]
  activeSceneId: string | null
  sequence: SequenceState
  worlds: World[]
  world: string
  name: string
  vibePresetName: string | null
  // Also part of "the whole session surface": the sound patch, the field
  // macros / temperament, and the drawn surface gesture. Without these, Ctrl+Z
  // after a scene recall / Generate / Open reverted the picture but left the
  // sound, the theme's density/tonicity/drift/flow, or the gesture behind.
  sonify: FullState['sonify']
  surface: FullState['surface']
  density: number
  gestureTexture: number
  coalesce: number
  tonicity: number
  shutter: number
  drift: number
  flow: number
  superFlicker: number
  // The Audio Layer (its files and inputs, levels, mix) : New and Open replace
  // it too. Which live inputs are open is not in it (see apply).
  audioLayer: FullState['audioLayer']
  // What is persistent : New clears it, Open replaces it.
  pins: string[]
}

function snap(): Snapshot {
  const s = useStore.getState()
  return {
    composition: s.composition,
    scenes: s.scenes,
    activeSceneId: s.activeSceneId,
    sequence: s.sequence,
    worlds: s.worlds,
    world: s.world,
    name: s.name,
    vibePresetName: s.vibePresetName,
    sonify: s.sonify,
    surface: s.surface,
    density: s.density,
    gestureTexture: s.gestureTexture,
    coalesce: s.coalesce,
    tonicity: s.tonicity,
    shutter: s.shutter,
    drift: s.drift,
    flow: s.flow,
    superFlicker: s.superFlicker,
    audioLayer: s.audioLayer,
    pins: s.pins
  }
}

// The composition field by field : a copy with the same contents (the baseline
// given the Link session's tempo, see writeLinkTempo) is no change.
function sameComposition(a: CompositionState, b: CompositionState): boolean {
  if (a === b) return true
  const x = a as unknown as Record<string, unknown>
  const y = b as unknown as Record<string, unknown>
  for (const k in x) if (x[k] !== y[k]) return false
  for (const k in y) if (!(k in x)) return false
  return true
}

// Reference-compare the watched slices : any change = a pending undo step.
function differs(a: Snapshot, b: Snapshot): boolean {
  return (
    !sameComposition(a.composition, b.composition) ||
    a.scenes !== b.scenes ||
    a.activeSceneId !== b.activeSceneId ||
    a.sequence !== b.sequence ||
    a.worlds !== b.worlds ||
    a.world !== b.world ||
    a.name !== b.name ||
    a.vibePresetName !== b.vibePresetName ||
    a.sonify !== b.sonify ||
    a.surface !== b.surface ||
    a.density !== b.density ||
    a.gestureTexture !== b.gestureTexture ||
    a.coalesce !== b.coalesce ||
    a.tonicity !== b.tonicity ||
    a.shutter !== b.shutter ||
    a.drift !== b.drift ||
    a.flow !== b.flow ||
    a.superFlicker !== b.superFlicker ||
    a.audioLayer !== b.audioLayer ||
    a.pins !== b.pins
  )
}

/** The live inputs open after an undo : an undo never opens one by itself. A
 *  restored live slot stays open only when it is open now, on the same device;
 *  any other comes back closed (its open button). */
function keptOpen(restored: Snapshot['audioLayer']): FullState['audioLayerArmed'] {
  const cur = useStore.getState()
  const open = (sl: 'A' | 'B'): boolean => {
    const r = restored[sl], c = cur.audioLayer[sl]
    return r?.kind === 'live' && c?.kind === 'live' && cur.audioLayerArmed[sl] && (r.deviceId ?? '') === (c.deviceId ?? '')
  }
  return { A: open('A'), B: open('B') }
}

function apply(s: Snapshot): void {
  cancelMorph() // the composition is being swapped : don't ease toward a stale target
  // Your Worlds as undo / redo leaves them are what the next launch opens with,
  // as after any edit (else a World undone came back at the next launch, and
  // one brought back by undo was gone again).
  if (s.worlds !== useStore.getState().worlds) saveUserWorlds(s.worlds)
  applying = true
  const armed = keptOpen(s.audioLayer)
  useStore.setState({
    composition: s.composition,
    scenes: s.scenes,
    activeSceneId: s.activeSceneId,
    sequence: s.sequence,
    worlds: s.worlds,
    world: s.world,
    name: s.name,
    vibePresetName: s.vibePresetName,
    surface: s.surface,
    density: s.density,
    gestureTexture: s.gestureTexture,
    coalesce: s.coalesce,
    tonicity: s.tonicity,
    shutter: s.shutter,
    drift: s.drift,
    flow: s.flow,
    superFlicker: s.superFlicker,
    audioLayer: s.audioLayer,
    audioLayerArmed: armed,
    pins: s.pins
  })
  // Keep the persisted active-World id in step with what the user now sees.
  localStorage.setItem('opsia.world', s.world)
  // Sonify goes through setSonify so the sound engine (and its localStorage)
  // update too — but keep the machine-local on-state + output device as they are.
  // A step that left the sound alone leaves it alone here too : the same object
  // stays, so the step's other side still compares equal on the sound.
  const curSoni = useStore.getState().sonify
  if (s.sonify !== curSoni) useStore.getState().setSonify({ ...s.sonify, on: curSoni.on, sinkId: curSoni.sinkId })
  applying = false
}

let past: Snapshot[] = []
let future: Snapshot[] = []
// The last state committed to history : the baseline the next edit diffs from.
let committed: Snapshot | null = null
let quietTimer: ReturnType<typeof setTimeout> | null = null
// True while undo()/redo() applies a snapshot, so the subscriber ignores it.
let applying = false

// UI badge subscribers (header buttons show enabled/disabled).
const listeners = new Set<() => void>()
let version = 0
function bump(): void {
  version++
  listeners.forEach((l) => l())
}

export function initUndo(): () => void {
  committed = snap()
  const unsub = useStore.subscribe(() => {
    if (applying) return
    if (committed && !differs(snap(), committed)) return
    // Debounce: commit the pre-edit baseline once the burst settles.
    if (quietTimer) clearTimeout(quietTimer)
    quietTimer = setTimeout(() => {
      quietTimer = null
      const cur = snap()
      if (committed && differs(cur, committed)) {
        past.push(committed)
        if (past.length > CAPACITY) past.shift()
        future = [] // a fresh edit invalidates the redo branch
        committed = cur
        bump()
      }
    }, QUIET_MS)
  })
  return unsub
}

/** Run a store mutation WITHOUT recording an undo step : for the auto-sequencer,
 *  which changes the composition every few seconds and would otherwise evict all
 *  real history. The new state becomes the baseline the next edit diffs from. */
export function runSilently(fn: () => void): void {
  // An edit still inside its quiet window is the user's : commit it first.
  // Without this the silent change became the baseline with that edit folded
  // into it, and an auto-fire (a sequencer step, a modulated Vary) landing
  // within 300 ms of a drag took the drag out of the undo history.
  if (!applying && flushPending()) bump()
  applying = true
  try {
    fn()
  } finally {
    committed = snap()
    applying = false
  }
}

/** The tempo of the Ableton Link session, written here by ./link.ts : nobody's
 *  edit, so never an undo step, and unlike runSilently it leaves an edit still
 *  in its quiet window alone. A linked app's tempo ramp writes it every frame
 *  for seconds : through runSilently each write closed the edit in progress, so
 *  a fader drag during the ramp became one undo step per frame and evicted the
 *  history. The baseline takes the new tempo, so the edit's step never
 *  carries it. */
export function writeLinkTempo(bpm: number): void {
  applying = true
  try {
    useStore.setState((s) => ({ composition: { ...s.composition, bpm } }))
  } finally {
    applying = false
  }
  if (!quietTimer || !committed) committed = snap()
  else committed = { ...committed, composition: { ...committed.composition, bpm } }
}

/** Flush any pending quiet-timer commit immediately (called before undo and
 *  before a silent change). True when it committed a step. */
function flushPending(): boolean {
  if (!quietTimer) return false
  clearTimeout(quietTimer)
  quietTimer = null
  const cur = snap()
  if (committed && differs(cur, committed)) {
    past.push(committed)
    if (past.length > CAPACITY) past.shift()
    future = []
    committed = cur
    return true
  }
  return false
}

/** Close the step now instead of after the quiet window : the agent (MCP)
 *  calls it before and after each change, so every change it makes is ONE undo
 *  step of its own, never folded into the performer's edit around it. */
export function commitNow(): void {
  if (flushPending()) bump()
}

/** The step changed the BPM and nothing else : a tempo typed, tapped, sent by
 *  MIDI or OSC. Undoing or redoing it is a tempo set by hand, so Ableton Link
 *  hears it like the edit itself (./tempoEvents.ts). Any other step that
 *  carries an older BPM leaves the tempo to Link while other apps are linked :
 *  ./link.ts writes the session's back, silently, before the next frame, rather
 *  than an undone layer edit setting every linked app's tempo. */
function onlyTempo(a: Snapshot, b: Snapshot): boolean {
  const c1 = a.composition as unknown as Record<string, unknown>
  const c2 = b.composition as unknown as Record<string, unknown>
  if (c1.bpm === c2.bpm) return false
  for (const k of Object.keys(a) as Array<keyof Snapshot>) if (k !== 'composition' && a[k] !== b[k]) return false
  for (const k in c1) if (k !== 'bpm' && c1[k] !== c2[k]) return false
  for (const k in c2) if (!(k in c1)) return false
  return true
}

// Name what a step touched, so the toast says "Undone · layers" not just "Undone".
// Leans on the reference-compare : the first slice whose reference differs wins.
function describeDiff(a: Snapshot, b: Snapshot): string {
  const c1 = a.composition, c2 = b.composition
  if (!sameComposition(c1, c2)) {
    if (c1.layers !== c2.layers) return 'layers'
    if (c1.modMatrix !== c2.modMatrix || c1.modulators !== c2.modulators) return 'modulation'
    if (c1.metaKnobs !== c2.metaKnobs) return 'meta knobs'
    if (c1.master !== c2.master) return 'master FX'
    if (c1.background !== c2.background) return 'background'
    if (c1.bpm !== c2.bpm) return 'tempo'
    return 'composition'
  }
  if (a.scenes !== b.scenes || a.activeSceneId !== b.activeSceneId) return 'scenes'
  if (a.sequence !== b.sequence) return 'sequencer'
  if (a.worlds !== b.worlds || a.world !== b.world) return 'world'
  if (a.sonify !== b.sonify) return 'sonify'
  if (a.audioLayer !== b.audioLayer) return 'audio layer'
  if (a.surface !== b.surface) return 'surface'
  if (
    a.density !== b.density || a.gestureTexture !== b.gestureTexture || a.coalesce !== b.coalesce ||
    a.tonicity !== b.tonicity || a.shutter !== b.shutter || a.drift !== b.drift ||
    a.flow !== b.flow || a.superFlicker !== b.superFlicker
  ) return 'feel'
  // a control or a layer made persistent, or let go
  if (a.pins !== b.pins) return 'persistent'
  if (a.vibePresetName !== b.vibePresetName) return 'vibe'
  if (a.name !== b.name) return 'name'
  return 'change'
}

// Coalesce a burst of undos/redos (holding Ctrl+Z) into ONE toast so it never
// nags : it fires ~260 ms after the LAST step, naming that step and, for a
// burst, how many were rolled together.
let toastTimer: ReturnType<typeof setTimeout> | null = null
let toastDir = ''
let toastLabel = ''
let toastCount = 0
function notifyHistory(dir: string, label: string): void {
  if (dir !== toastDir) toastCount = 0 // a direction flip restarts the tally
  toastDir = dir
  toastLabel = label
  toastCount++
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    showToast(`${toastDir} · ${toastLabel}${toastCount > 1 ? ` ×${toastCount}` : ''}`)
    toastTimer = null
    toastCount = 0
  }, 260)
}

export function undo(): void {
  flushPending()
  const prev = past.pop()
  if (!prev) return
  const cur = snap()
  future.push(cur)
  if (future.length > CAPACITY) future.shift()
  apply(prev)
  // what the store holds now (the sound is a fresh object when the step touched
  // it) : baselined on `prev` itself, the next store change of any kind read as
  // an edit, recorded a phantom step and threw the redo away
  committed = snap()
  bump()
  notifyHistory('Undone', describeDiff(prev, cur))
  // a tempo set by hand, undone by hand : Ableton Link hears it too
  if (onlyTempo(prev, cur)) tempoEdited(prev.composition.bpm)
}

export function redo(): void {
  flushPending()
  const next = future.pop()
  if (!next) return
  const cur = snap()
  past.push(cur)
  if (past.length > CAPACITY) past.shift()
  apply(next)
  committed = snap()
  bump()
  notifyHistory('Redone', describeDiff(next, cur))
  if (onlyTempo(next, cur)) tempoEdited(next.composition.bpm)
}

export function canUndo(): boolean {
  return past.length > 0 || quietTimer !== null
}
export function canRedo(): boolean {
  return future.length > 0
}

/** React hook for the header buttons : re-renders on history changes. */
export function useUndoState(): { undo: boolean; redo: boolean } {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version
  )
  return { undo: canUndo(), redo: canRedo() }
}
