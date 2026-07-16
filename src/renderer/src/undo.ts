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

const CAPACITY = 100
const QUIET_MS = 300

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
    vibePresetName: s.vibePresetName
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
    a.vibePresetName !== b.vibePresetName
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
    vibePresetName: s.vibePresetName
  })
  // Keep the persisted active-World id in step with what the user now sees.
  localStorage.setItem('opsia.world', s.world)
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

export function undo(): void {
  flushPending()
  const prev = past.pop()
  if (!prev) return
  future.push(snap())
  if (future.length > CAPACITY) future.shift()
  apply(prev)
  committed = prev
  bump()
}

export function redo(): void {
  flushPending()
  const next = future.pop()
  if (!next) return
  past.push(snap())
  if (past.length > CAPACITY) past.shift()
  apply(next)
  committed = next
  bump()
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
