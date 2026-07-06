// OutputPanel — projection output controls: keystone/corner-pin warp with a
// draggable quad editor + alignment grid, for lining the image up on a
// projector. (Second-display output + Spout/NDI live here too as they land.)

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { DisplayInfo } from '@shared/types'
import { useStore } from '../store'

const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL']

export function OutputPanel(): JSX.Element {
  const outputActive = useStore((s) => s.outputActive)
  const setOutputActive = useStore((s) => s.setOutputActive)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [displayId, setDisplayId] = useState<number | null>(null)

  useEffect(() => {
    window.api
      .outputDisplays()
      .then((ds) => {
        setDisplays(ds)
        // Default to the first non-primary display (the projector), else primary.
        const target = ds.find((d) => !d.isPrimary) ?? ds[0]
        setDisplayId((cur) => cur ?? target?.id ?? null)
      })
      .catch(() => setDisplays([]))
  }, [])

  const openOutput = async (): Promise<void> => {
    if (displayId == null) return
    await window.api.outputOpen(displayId)
    setOutputActive(true)
  }
  const closeOutput = async (): Promise<void> => {
    await window.api.outputClose()
    setOutputActive(false)
  }

  const warpEnabled = useStore((s) => s.warpEnabled)
  const warpGrid = useStore((s) => s.warpGrid)
  const corners = useStore(useShallow((s) => s.warpCorners))
  const setWarpEnabled = useStore((s) => s.setWarpEnabled)
  const setWarpGrid = useStore((s) => s.setWarpGrid)
  const setWarpCorner = useStore((s) => s.setWarpCorner)
  const resetWarp = useStore((s) => s.resetWarp)

  const padRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef<number | null>(null)

  const posFromEvent = (e: ReactPointerEvent): [number, number] => {
    const el = padRef.current
    if (!el) return [0, 0]
    const r = el.getBoundingClientRect()
    return [
      Math.max(-0.5, Math.min(1.5, (e.clientX - r.left) / r.width)),
      Math.max(-0.5, Math.min(1.5, (e.clientY - r.top) / r.height))
    ]
  }

  const btn = (on: boolean): string =>
    `rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
      on ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:text-text'
    }`

  // The quad outline as an SVG polyline (percent coords).
  const pts = [0, 1, 2, 3].map((i) => `${corners[i * 2] * 100},${corners[i * 2 + 1] * 100}`).join(' ')

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-panel2/40 p-2">
      {/* Fullscreen output to a projector / 2nd display */}
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted">
          display
        </span>
        <select
          className="input select-compact min-w-0 flex-1 text-[10px]"
          value={displayId ?? ''}
          onChange={(e) => setDisplayId(Number(e.target.value))}
          disabled={outputActive}
        >
          {displays.length === 0 && <option value="">no displays</option>}
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} · {d.width}×{d.height}
              {d.isPrimary ? ' (primary)' : ''}
            </option>
          ))}
        </select>
        {outputActive ? (
          <button
            onClick={closeOutput}
            className="shrink-0 rounded border border-danger/60 bg-danger/15 px-2 py-0.5 font-mono text-[10px] text-danger transition-colors hover:bg-danger/25"
          >
            close
          </button>
        ) : (
          <button
            onClick={openOutput}
            disabled={displayId == null}
            className="shrink-0 rounded border border-accent bg-accent/15 px-2 py-0.5 font-mono text-[10px] text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
          >
            open ▶
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button onClick={() => setWarpEnabled(!warpEnabled)} className={btn(warpEnabled)}>
          warp {warpEnabled ? 'on' : 'off'}
        </button>
        <button onClick={() => setWarpGrid(!warpGrid)} className={btn(warpGrid)} title="Alignment grid + border overlay">
          grid
        </button>
        <div className="flex-1" />
        <button
          onClick={resetWarp}
          className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted hover:text-accent"
          title="Reset corners to a full rectangle"
        >
          reset
        </button>
      </div>

      {/* Draggable corner-pin editor (16:9). Drag a handle to move that corner. */}
      <div
        ref={padRef}
        className={`relative aspect-video w-full rounded border bg-black/40 ${
          warpEnabled ? 'border-border' : 'border-border/40 opacity-50'
        }`}
        style={{ touchAction: 'none' }}
        onPointerMove={(e) => {
          if (dragging.current === null) return
          const [x, y] = posFromEvent(e)
          setWarpCorner(dragging.current, x, y)
        }}
        onPointerUp={() => {
          dragging.current = null
        }}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points={pts} className="fill-accent/10 stroke-accent" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        </svg>
        {[0, 1, 2, 3].map((i) => (
          <button
            key={i}
            disabled={!warpEnabled}
            onPointerDown={(e) => {
              dragging.current = i
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            }}
            onDoubleClick={() => {
              const id = [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1]
              ][i]
              setWarpCorner(i, id[0], id[1])
            }}
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-bg bg-accent disabled:cursor-default disabled:opacity-40"
            style={{ left: `${corners[i * 2] * 100}%`, top: `${corners[i * 2 + 1] * 100}%` }}
            title={`${CORNER_LABELS[i]} corner — drag · double-click to reset`}
          />
        ))}
      </div>
      <p className="text-[10px] leading-tight text-muted">
        Drag the corners to keystone the output onto a projector. Turn on{' '}
        <span className="text-text">grid</span> to align, then off for the show.
      </p>
    </div>
  )
}
