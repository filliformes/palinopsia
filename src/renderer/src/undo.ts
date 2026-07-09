// Undo/redo : 100 levels over the composition.
//
// History lives OUTSIDE React (module state): a debounced subscriber watches
// the store's composition and, after 300 ms of quiet, commits the previous
// snapshot to the past stack. Slider drags and modulator sweeps therefore
// group into ONE undo step per gesture instead of hundreds. Compositions are
// immutable (every store action rebuilds), so snapshots are just references —
// no cloning cost.

import { useSyncExternalStore } from 'react'
import type { CompositionState } from '@shared/types'
import { useStore } from './store'
import { cancelMorph } from './morph'

const CAPACITY = 100
const QUIET_MS = 300

let past: CompositionState[] = []
let future: CompositionState[] = []
// The last state committed to history : the baseline the next edit diffs from.
let committed: CompositionState | null = null
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
  committed = useStore.getState().composition
  const unsub = useStore.subscribe((s) => {
    if (applying) return
    if (s.composition === committed) return
    // Debounce: commit the pre-edit baseline once the burst settles.
    if (quietTimer) clearTimeout(quietTimer)
    quietTimer = setTimeout(() => {
      quietTimer = null
      const cur = useStore.getState().composition
      if (committed && cur !== committed) {
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
 *  real history. The new composition becomes the baseline the next edit diffs from. */
export function runSilently(fn: () => void): void {
  applying = true
  try {
    fn()
  } finally {
    committed = useStore.getState().composition
    applying = false
  }
}

/** Flush any pending quiet-timer commit immediately (called before undo). */
function flushPending(): void {
  if (!quietTimer) return
  clearTimeout(quietTimer)
  quietTimer = null
  const cur = useStore.getState().composition
  if (committed && cur !== committed) {
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
  const cur = useStore.getState().composition
  future.push(cur)
  if (future.length > CAPACITY) future.shift()
  cancelMorph() // the composition is being swapped : don't ease toward a stale target
  applying = true
  useStore.setState({ composition: prev })
  committed = prev
  applying = false
  bump()
}

export function redo(): void {
  flushPending()
  const next = future.pop()
  if (!next) return
  const cur = useStore.getState().composition
  past.push(cur)
  if (past.length > CAPACITY) past.shift()
  cancelMorph() // the composition is being swapped : don't ease toward a stale target
  applying = true
  useStore.setState({ composition: next })
  committed = next
  applying = false
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
