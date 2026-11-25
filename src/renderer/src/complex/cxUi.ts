// Complex Output : what the editor's window has in hand (nothing here is saved, or
// an undo step) : the step, the selection, the tool.

import { create } from 'zustand'
import { findSlice, type CxSetup, type CxWarp } from '@shared/complexOut'
import { useStore } from '../store'

export interface CxUi {
  step: 1 | 2
  screen: string | null
  slice: string | null
  /** a mask of the slice in hand, or of the screen */
  mask: string | null
  /** points of what is in hand (indices), on the side last touched */
  pts: number[]
  tool: 'points' | 'transform'
  snap: boolean
  /** the view the arrow keys move things in */
  side: 'in' | 'out'
  show: 'both' | 'stack' | 'in' | 'out'
  /** an outline being clicked, point by point (the screen's 0..1, or the slice's for its mask) */
  draw: { kind: 'poly' | 'mask'; pts: number[] } | null
  clip: CxWarp | null
  set: (p: Partial<CxUi>) => void
}

export const useCxUi = create<CxUi>((set) => ({
  step: 1,
  screen: null,
  slice: null,
  mask: null,
  pts: [],
  tool: 'points',
  snap: true,
  side: 'out',
  show: 'both',
  draw: null,
  clip: null,
  set: (p) => set(p)
}))

/** The selection, as far as it still exists in this setup. */
export function cxSelection(s: CxSetup, ui: Pick<CxUi, 'screen' | 'slice' | 'mask'>): {
  screen: CxSetup['screens'][number] | null
  slice: CxSetup['screens'][number]['slices'][number] | null
  mask: CxSetup['screens'][number]['masks'][number] | null
  maskOf: 'slice' | 'screen' | null
} {
  const f = ui.slice ? findSlice(s, ui.slice) : null
  const screen = f?.screen ?? s.screens.find((x) => x.id === ui.screen) ?? s.screens[0] ?? null
  const slice = f && f.screen === screen ? f.slice : null
  const own = slice?.masks.find((m) => m.id === ui.mask) ?? null
  const all = own ? null : screen?.masks.find((m) => m.id === ui.mask) ?? null
  return { screen, slice, mask: own ?? all, maskOf: own ? 'slice' : all ? 'screen' : null }
}

/** Pick a slice (and the screen it is on). */
export function pickSlice(id: string | null): void {
  const f = id ? findSlice(useStore.getState().complexOut, id) : null
  useCxUi.setState({ slice: f ? id : null, mask: null, pts: [], draw: null, ...(f ? { screen: f.screen.id } : {}) })
}
export const pickScreen = (id: string): void => useCxUi.setState({ screen: id, slice: null, mask: null, pts: [], draw: null })
