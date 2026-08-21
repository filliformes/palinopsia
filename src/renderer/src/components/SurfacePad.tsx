// The Metasurface pad (Bencina, NIME 2005) : the scene bank as a CONTINUOUS plane.
// Each scene is a point; dragging the cursor over the plane blends between the nearest
// scenes (structure snaps to the nearest, numeric params ease). Drag a dot to arrange
// which scenes sit near which. Also driven by /opsia/surface x y (Pandore's Trill).

import { useRef } from 'react'
import { useStore } from '../store'
import { nearestSurfaceScene } from '../surface'

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

export function SurfacePad(): JSX.Element {
  const scenes = useStore((s) => s.scenes)
  const surface = useStore((s) => s.surface)
  const setSurfaceActive = useStore((s) => s.setSurfaceActive)
  const setSurfaceXY = useStore((s) => s.setSurfaceXY)
  const setScenePos = useStore((s) => s.setScenePos)
  const autoPlaceScenes = useStore((s) => s.autoPlaceScenes)
  const padRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'cursor' | 'dot'; id?: string } | null>(null)

  const placed = scenes.filter((s) => s.surface)
  const nearest = placed.length && surface.active ? nearestSurfaceScene(placed, surface.x, surface.y) : -1

  const toXY = (e: React.PointerEvent): { x: number; y: number } => {
    const r = padRef.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }

  const onDown = (e: React.PointerEvent): void => {
    const p = toXY(e)
    // grab the nearest dot if the pointer landed on one (within ~4% of the plane)
    let hitId: string | undefined
    let hd = 0.04 * 0.04
    for (const s of placed) {
      const d = (s.surface!.x - p.x) ** 2 + (s.surface!.y - p.y) ** 2
      if (d < hd) {
        hd = d
        hitId = s.id
      }
    }
    padRef.current!.setPointerCapture(e.pointerId)
    if (hitId) {
      drag.current = { mode: 'dot', id: hitId }
    } else {
      drag.current = { mode: 'cursor' }
      if (!surface.active) setSurfaceActive(true)
      setSurfaceXY(p.x, p.y)
    }
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const p = toXY(e)
    if (d.mode === 'cursor') setSurfaceXY(p.x, p.y)
    else if (d.id) setScenePos(d.id, p.x, p.y)
  }
  const onUp = (e: React.PointerEvent): void => {
    drag.current = null
    try {
      padRef.current!.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setSurfaceActive(!surface.active)}
          className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
            surface.active
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-border text-muted hover:text-text'
          }`}
          title="When on, the output is a live blend of the scenes at the cursor, instead of the live composition"
        >
          {surface.active ? '● surface on' : '○ surface off'}
        </button>
        <button
          onClick={() => autoPlaceScenes(true)}
          className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:text-text"
          title="Re-spread every scene evenly over the plane (a sunflower layout)"
        >
          arrange
        </button>
        <span className="font-mono text-[9px] text-muted/70">
          {placed.length < 2
            ? 'save ≥ 2 scenes to play the surface'
            : 'drag = navigate · drag a dot = move a scene'}
        </span>
      </div>
      <div
        ref={padRef}
        className="relative mx-auto aspect-square w-full max-w-[260px] touch-none select-none overflow-hidden rounded-md border border-border bg-panel2/50"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / 0.04) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.04) 1px, transparent 1px)',
          backgroundSize: '25% 25%'
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {placed.map((s, i) => {
          const idx = scenes.findIndex((z) => z.id === s.id)
          const isNear = nearest === i
          return (
            <div
              key={s.id}
              className={`pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border font-mono transition-colors ${
                isNear
                  ? 'z-10 h-5 w-5 border-accent bg-accent/25 text-[9px] text-accent ring-1 ring-accent'
                  : 'h-3.5 w-3.5 border-muted/60 bg-panel3 text-[8px] text-muted'
              }`}
              style={{ left: `${s.surface!.x * 100}%`, top: `${s.surface!.y * 100}%` }}
              title={s.name}
            >
              {idx + 1}
            </div>
          )
        })}
        {surface.active && placed.length >= 2 && (
          <div
            className="pointer-events-none absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent2 bg-accent2/30 shadow-[0_0_8px_rgb(var(--c-accent2)/0.6)]"
            style={{ left: `${surface.x * 100}%`, top: `${surface.y * 100}%` }}
          />
        )}
      </div>
    </div>
  )
}
