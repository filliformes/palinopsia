// The top bar's ■ Black (black.ts) : the whole show to black over the Morph
// time, and back. While a fade runs, a line runs clockwise round the button from
// the top, taking the fade's own time (as dataFLOU's scene fill shows a scene's) :
// red to black, the edge lit red when it lands; light on the way back, gone when
// the show is.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { MidiLearnOverlay } from './MidiLearnOverlay'

export function BlackButton(): JSX.Element {
  const black = useStore((s) => s.black)
  const fadeAt = useStore((s) => s.blackFadeAt)
  const fadeMs = useStore((s) => s.blackFadeMs)
  const morphSec = useStore((s) => s.morphMs / 1000)
  // while a fade runs, its edge stays plain so the line reads on it; lit (red)
  // once the show is out
  const [, redraw] = useState(0)
  const left = fadeAt + fadeMs - performance.now()
  const fading = fadeMs > 0 && left > 0
  useEffect(() => {
    if (!fading) return
    const t = setTimeout(() => redraw((n) => n + 1), left + 20)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fadeAt, fadeMs, fading])
  return (
    <span className="relative flex shrink-0">
      <MidiLearnOverlay id="fire:black" />
      <button
        onClick={() => useStore.getState().setBlack('toggle')}
        className={`btn relative text-[12px] ${!black ? '' : fading ? '!bg-danger/10 !text-danger' : '!border-danger !bg-danger/20 !text-danger'}`}
        title={`${black ? 'BLACK : the show is faded out. Click (or .) : it comes back' : 'Black (.) : the whole show fades to black'} over the Morph time (${morphSec < 10 ? morphSec.toFixed(1) : Math.round(morphSec)} s, the line round the button) : every layer, the Background, the films' sound, Sonify and the Audio Layer, on the preview and every output and recording. Nothing is moved : it dims what leaves, so everything keeps playing under it and comes back as it is then. MIDI / OSC learnable, /opsia/black`}
      >
        ■ Black
        {/* a new line at each press (a press mid-way starts the fade over) */}
        {fadeAt > 0 && fadeMs > 0 && <FadeLine key={fadeAt} out={black} at={fadeAt} ms={fadeMs} />}
      </button>
    </span>
  )
}

// The button's edge as one path, clockwise from the middle of its top, its
// corners rounded as .btn's (2 px), inset by half the stroke so it lies on the
// border. pathLength 1 : the dash runs 0 → 1 whatever the button's size.
function edgePath(w: number, h: number, s: number, r: number): string {
  const x0 = s, y0 = s, x1 = w - s, y1 = h - s
  return [
    `M ${w / 2} ${y0}`,
    `H ${x1 - r}`, `A ${r} ${r} 0 0 1 ${x1} ${y0 + r}`,
    `V ${y1 - r}`, `A ${r} ${r} 0 0 1 ${x1 - r} ${y1}`,
    `H ${x0 + r}`, `A ${r} ${r} 0 0 1 ${x0} ${y1 - r}`,
    `V ${y0 + r}`, `A ${r} ${r} 0 0 1 ${x0 + r} ${y0}`,
    `H ${w / 2}`
  ].join(' ')
}

function FadeLine({ out, at, ms }: { out: boolean; at: number; ms: number }): JSX.Element | null {
  const ref = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  // timed from the press, not from the mount : drawn again (the top bar redrawn)
  // it goes on where it was, and a fade already over is simply its end
  const [elapsed] = useState(() => Math.max(0, performance.now() - at))
  const [done, setDone] = useState(() => elapsed >= ms)
  // the button's border box (layout pixels : the UI zoom scales the line with it)
  useLayoutEffect(() => {
    const b = ref.current?.parentElement
    if (b) setBox({ w: b.offsetWidth, h: b.offsetHeight })
  }, [])
  if (done && !out) return null
  return (
    <svg
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute overflow-visible"
      // over the 1 px border (the button's own box starts inside it)
      style={{ left: -1, top: -1 }}
      width={box?.w ?? 0}
      height={box?.h ?? 0}
    >
      {box && (
        <path
          d={edgePath(box.w, box.h, 1, 2)}
          pathLength={1}
          fill="none"
          stroke={out ? 'rgb(var(--c-danger))' : 'rgb(var(--c-text))'}
          strokeWidth={2}
          strokeDasharray="1 1"
          style={done ? { strokeDashoffset: 0 } : { strokeDashoffset: 1, animation: `black-fade-line ${ms}ms linear -${Math.round(elapsed)}ms forwards` }}
          onAnimationEnd={() => setDone(true)}
        />
      )}
    </svg>
  )
}
