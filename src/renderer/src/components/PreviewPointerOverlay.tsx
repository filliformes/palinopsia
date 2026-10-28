// Over the preview (never in the composition or the output) : what a click does
// on the source under the cursor, and where each pinching hand points (lit while
// it pinches). See pointerInput.ts.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { pointerView, hintStatus, frameToCanvasPx } from '../pointerInput'

export default function PreviewPointerOverlay({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }): JSX.Element | null {
  const v = useSyncExternalStore(pointerView.subscribe, pointerView.get)
  const [status, setStatus] = useState('')
  // the source's own line (drops, points), while the hint shows
  useEffect(() => {
    if (!v.hint) return
    setStatus(hintStatus())
    const id = window.setInterval(() => setStatus(hintStatus()), 300)
    return () => window.clearInterval(id)
  }, [v.hint])
  const cv = canvasRef.current
  const dots = cv
    ? v.cursors.map((c) => ({ c, p: frameToCanvasPx(cv, c.u, c.v) })).filter((d): d is { c: typeof d.c; p: [number, number] } => !!d.p)
    : []
  if (!v.hint && !dots.length) return null
  return (
    <>
      {v.hint && (
        <div className="pointer-events-none absolute left-2 top-2 max-w-[70%] rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-muted">
          <span className="text-text/80">{v.where}</span> · {v.hint}
          {status && <span className="text-muted/70"> · {status}</span>}
        </div>
      )}
      {dots.map(({ c, p }) => (
        <div
          key={c.pid}
          className="pointer-events-none absolute rounded-full"
          style={{
            left: p[0] - 9,
            top: p[1] - 9,
            width: 18,
            height: 18,
            border: `2px solid ${c.down ? 'rgb(255 142 15)' : 'rgb(255 255 255 / 0.7)'}`,
            background: c.down ? 'rgb(255 142 15 / 0.35)' : 'transparent',
            boxShadow: '0 0 0 1px rgb(0 0 0 / 0.6)'
          }}
        />
      ))}
    </>
  )
}
