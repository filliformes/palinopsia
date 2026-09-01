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
import { useStore } from './store'
import { cancelMorph } from './morph'
import { showToast } from './components/Toast'

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
    superFlicker: s.superFlicker
  }
}

// Reference-compare the watched slices : any change = a pending undo step.
function differs(a: Snapshot, b: Snapshot): boolean {
  return (
    a.composition !== b.composition ||
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
    a.superFlicker !== b.superFlicker
  )
}

function apply(s: Snapshot): void {
  cancelMorph() // the composition is being swapped : don't ease toward a stale target
  applying = true
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
    superFlicker: s.superFlicker
  })
  // Keep the persisted active-World id in step with what the user now sees.
  localStorage.setItem('opsia.world', s.world)
  // Sonify goes through setSonify so the sound engine (and its localStorage)
  // update too — but keep the machine-local on-state + output device as they are.
  const curSoni = useStore.getState().sonify
  useStore.getState().setSonify({ ...s.sonify, on: curSoni.on, sinkId: curSoni.sinkId })
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
  applying = true
  try {
    fn()
  } finally {
    committed = snap()
    applying = false
  }
}

/** Flush any pending quiet-timer commit immediately (called before undo). */
function flushPending(): void {
  if (!quietTimer) return
  clearTimeout(quietTimer)
  quietTimer = null
  const cur = snap()
  if (committed && differs(cur, committed)) {
    past.push(committed)
    if (past.length > CAPACITY) past.shift()
    future = []
    committed = cur
  }
}

// Name what a step touched, so the toast says "Undone · layers" not just "Undone".
// Leans on the reference-compare : the first slice whose reference differs wins.
function describeDiff(a: Snapshot, b: Snapshot): string {
  const c1 = a.composition, c2 = b.composition
  if (c1 !== c2) {
    if (c1.layers !== c2.layers) return 'layers'
    if (c1.modMatrix !== c2.modMatrix || c1.modulators !== c2.modulators) return 'modulation'
    if (c1.metaKnobs !== c2.metaKnobs) return 'meta knobs'
    if (c1.master !== c2.master) return 'master FX'
    if (c1.background !== c2.background) return 'background'
    return 'composition'
  }
  if (a.scenes !== b.scenes || a.activeSceneId !== b.activeSceneId) return 'scenes'
  if (a.sequence !== b.sequence) return 'sequencer'
  if (a.worlds !== b.worlds || a.world !== b.world) return 'world'
  if (a.sonify !== b.sonify) return 'sonify'
  if (a.surface !== b.surface) return 'surface'
  if (
    a.density !== b.density || a.gestureTexture !== b.gestureTexture || a.coalesce !== b.coalesce ||
    a.tonicity !== b.tonicity || a.shutter !== b.shutter || a.drift !== b.drift ||
    a.flow !== b.flow || a.superFlicker !== b.superFlicker
  ) return 'feel'
  if (a.vibePresetName !== b.vibePresetName) return 'vibe'
  if (a.name !== b.name) return 'name'
  return 'change'
}

export function undo(): void {
  flushPending()
  const prev = past.pop()
  if (!prev) return
  const cur = snap()
  future.push(cur)
  if (future.length > CAPACITY) future.shift()
  apply(prev)
  committed = prev
  bump()
  showToast(`Undone · ${describeDiff(prev, cur)}`)
}

export function redo(): void {
  flushPending()
  const next = future.pop()
  if (!next) return
  const cur = snap()
  past.push(cur)
  if (past.length > CAPACITY) past.shift()
  apply(next)
  committed = next
  bump()
  showToast(`Redone · ${describeDiff(next, cur)}`)
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
