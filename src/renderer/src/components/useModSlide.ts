// A modulated slider's thumb shows the live value (liveOverlay), not the base.
// Grabbing it set the base to wherever the modulator happened to be (a jump),
// and the slider kept the focus after the release, so the thumb froze there
// (the overlay skips the focused element) : the modulation looked stopped.
// Here, as in AutoControls' FloatControl : a drag (or an arrow key) moves the
// base by as much as the thumb moves, from where it was grabbed, and the
// release lets go of the focus so the thumb follows the modulator again.
// For the hand-built sliders : the layer strip's opacity and A·B mix, the
// Mixer's A·B, HUE and OPA.

import { useRef, type ChangeEvent, type KeyboardEvent, type PointerEvent } from 'react'

type Slide = {
  onPointerDown: (e: PointerEvent<HTMLInputElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  onPointerUp: (e: PointerEvent<HTMLInputElement>) => void
  onKeyUp: () => void
}

/** Spread onto a range input in place of its onChange. `base` is the stored
 *  value React renders; `set` gets the new base. */
export function useModSlide(modulated: boolean, base: number, min: number, max: number, set: (v: number) => void): Slide {
  const grab = useRef<{ base: number; shown: number } | null>(null)
  const onGrab = (el: HTMLInputElement): void => {
    grab.current = modulated ? { base, shown: Number(el.value) } : null
  }
  return {
    onPointerDown: (e) => onGrab(e.currentTarget),
    onKeyDown: (e) => {
      if (!grab.current) onGrab(e.currentTarget)
    },
    onChange: (e) => {
      const x = Number(e.currentTarget.value)
      const g = grab.current
      set(Math.max(min, Math.min(max, g && modulated ? g.base + (x - g.shown) : x)))
    },
    onPointerUp: (e) => {
      grab.current = null
      if (modulated) e.currentTarget.blur()
    },
    onKeyUp: () => {
      grab.current = null
    }
  }
}
