// Blink : a one-shot flash over a button, so a fired action is SEEN.
//
// Two ways to drive it :
//   · `n` given : it blinks each time `n` changes. For actions that can fire
//     without a click (a modulator, a MIDI pad, a key, OSC), whose store action
//     keeps a count : the Vary buttons, the global Randomize.
//   · `n` absent : it blinks on a click of the button it sits in. For one-shot
//     local actions (the return-to-default buttons), so they need no count, no
//     hook and no change to their own onClick.
//
// The flash is an overlay remounted per fire (keyed on a count), so it replays
// every time instead of only the first, and a fast modulator blinks on every
// beat. The parent button must be `relative`. A disabled button fires no click,
// so it never blinks.
//
// A click blink is drawn OVER the page, at the button's place, rather than
// inside it : a return-to-default disables its own button the moment it acts
// (nothing left to reset), or removes it (the record folder back at its
// default), and the flash inside went down to 30 % or vanished with it.

import { useEffect, useRef } from 'react'

export type BlinkColor = 'accent' | 'accent2' | 'text'

export function Blink({ n, color = 'text' }: { n?: number; color?: BlinkColor }): JSX.Element | null {
  const anchor = useRef<HTMLSpanElement | null>(null)
  const driven = n !== undefined
  // The count as it stood when this button mounted : a count is store state
  // and outlives the button, so reopening a panel after any fire replayed the
  // last blink as if it had just happened. Only a change SINCE mount blinks.
  const atMount = useRef(n)

  useEffect(() => {
    if (driven) return
    const btn = anchor.current?.parentElement
    if (!btn) return
    const onClick = (): void => flashOver(btn, color)
    btn.addEventListener('click', onClick)
    return () => btn.removeEventListener('click', onClick)
  }, [driven, color])

  const count = driven && n !== atMount.current ? (n as number) : 0
  return (
    <>
      {/* an invisible anchor, so the listener can find its button before the first blink */}
      {!driven && <span ref={anchor} className="hidden" aria-hidden="true" />}
      {count > 0 && <span key={count} className={`fire-blink c-${color}`} aria-hidden="true" />}
    </>
  )
}

/** One flash over `btn`, on the page itself : it outlives the button. */
function flashOver(btn: HTMLElement, color: BlinkColor): void {
  const r = btn.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return
  const el = document.createElement('span')
  el.className = `fire-blink c-${color}`
  el.setAttribute('aria-hidden', 'true')
  Object.assign(el.style, {
    position: 'fixed',
    inset: 'auto',
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    borderRadius: getComputedStyle(btn).borderRadius,
    zIndex: '9999'
  })
  const done = (): void => el.remove()
  el.addEventListener('animationend', done)
  window.setTimeout(done, 600) // the animation is 280 ms : a backstop
  document.body.appendChild(el)
}
