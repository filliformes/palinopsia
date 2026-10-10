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

import { useEffect, useRef, useState } from 'react'

export type BlinkColor = 'accent' | 'accent2' | 'text'

export function Blink({ n, color = 'text' }: { n?: number; color?: BlinkColor }): JSX.Element | null {
  const [local, setLocal] = useState(0)
  const ref = useRef<HTMLSpanElement | null>(null)
  const anchor = useRef<HTMLSpanElement | null>(null)
  const driven = n !== undefined

  useEffect(() => {
    if (driven) return
    const btn = anchor.current?.parentElement
    if (!btn) return
    const onClick = (): void => setLocal((c) => c + 1)
    btn.addEventListener('click', onClick)
    return () => btn.removeEventListener('click', onClick)
  }, [driven])

  const count = driven ? (n as number) : local
  return (
    <>
      {/* an invisible anchor, so the listener can find its button before the first blink */}
      {!driven && <span ref={anchor} className="hidden" aria-hidden="true" />}
      {count > 0 && <span key={count} ref={ref} className={`fire-blink c-${color}`} aria-hidden="true" />}
    </>
  )
}
