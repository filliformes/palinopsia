// A name that arrives : when it changes, its letters scramble and settle from left to
// right, in about a third of a second. Never on first show, and only for names : a value
// that moves all the time would never be readable. The real text holds the width from the
// first frame, so nothing around it jumps.

import { useLayoutEffect, useRef } from 'react'
import { motionEnabled, motionSlow } from '../glass'

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789/=+*#<>'
const MS = 360

export function ScrambleText({ text, className = '', title }: { text: string; className?: string; title?: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null)
  const was = useRef(text)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || was.current === text) return
    was.current = text
    const win = el.ownerDocument.defaultView
    if (!win || !motionEnabled()) return
    const t0 = win.performance.now()
    let raf = 0
    const tick = (now: number): void => {
      const p = (now - t0) / (MS * motionSlow())
      if (p >= 1) {
        el.textContent = text
        return
      }
      let s = ''
      for (let i = 0; i < text.length; i++) {
        const c = text[i]
        // the first letters settle first, each after a little of the scramble
        const settled = p > 0.2 + (0.75 * i) / Math.max(1, text.length)
        s += settled || c === ' ' ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      }
      el.textContent = s
      raf = win.requestAnimationFrame(tick)
    }
    raf = win.requestAnimationFrame(tick)
    return () => {
      win.cancelAnimationFrame(raf)
      el.textContent = text
    }
  }, [text])
  return (
    <span className={`relative inline-block truncate ${className}`} title={title}>
      <span className="invisible">{text}</span>
      <span ref={ref} className="absolute inset-0 overflow-hidden whitespace-nowrap">
        {text}
      </span>
    </span>
  )
}
