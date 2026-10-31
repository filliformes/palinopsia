// The slider pointer : how a bar (Bar.tsx) marks its stored value. One setting
// per machine (localStorage), like the UI theme and the zoom, chosen in the UI
// tab. It lives on the root element as `data-pointer` and the bars draw it in
// CSS (styles.css, "Bars") : switching it repaints every bar without
// re-rendering one. Page windows copy the attribute (PageWindow.tsx).

import { useSyncExternalStore } from 'react'

export type SliderPointer = 'line' | 'notch' | 'cap' | 'edge' | 'ruler'

export const SLIDER_POINTERS: Array<{ id: SliderPointer; label: string; hint: string }> = [
  { id: 'line', label: 'line', hint: 'A thin bright line across the bar, glowing in the accent color' },
  { id: 'notch', label: 'notch', hint: 'Two small triangles on the top and bottom edges' },
  { id: 'cap', label: 'cap', hint: 'A small fader cap with a groove' },
  { id: 'edge', label: 'lit edge', hint: 'No marker : the fill fades in from its start and ends in a solid band (a tick shows the stored value while it is modulated)' },
  { id: 'ruler', label: 'ruler', hint: 'Ticks every tenth along the bottom, a tall tick at the value' }
]

const KEY = 'opsia.sliderPointer'
const DEFAULT: SliderPointer = 'line'

function load(): SliderPointer {
  try {
    const v = localStorage.getItem(KEY)
    if (v && SLIDER_POINTERS.some((p) => p.id === v)) return v as SliderPointer
  } catch {
    /* storage refused : the default */
  }
  return DEFAULT
}

let current: SliderPointer = load()
const listeners = new Set<() => void>()

function apply(p: SliderPointer): void {
  document.documentElement.setAttribute('data-pointer', p)
}
apply(current)

export function setSliderPointer(p: SliderPointer): void {
  if (p === current) return
  current = p
  apply(p)
  try {
    localStorage.setItem(KEY, p)
  } catch {
    /* storage refused : this run only */
  }
  for (const l of listeners) l()
}

export function useSliderPointer(): SliderPointer {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}
