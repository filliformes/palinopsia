// The Metasurface pad (Bencina, NIME 2005) : the scene bank as a CONTINUOUS plane.
// Each scene is a point; dragging the cursor over the plane blends between the nearest
// scenes (structure snaps to the nearest, numeric params ease). Drag a dot to arrange
// which scenes sit near which. Also driven by /opsia/surface x y (Pandore's Trill).
//
// Draw sequencer : flip to DRAW, sketch a path across the plane, then PLAY — the cursor
// auto-traces the drawing over `time` ms, in a direction (forward / backward / ping-pong),
// with a JUMP % that randomly teleports the playhead to other spots (a jitter). Modeled
// on dataFLOU's Gesture playback; the actual advance lives in App's render loop.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { nearestSurfaceScene, surfaceWeights } from '../surface'
import { MidiLearnOverlay } from './MidiLearnOverlay'

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** A distinct, calm hue per scene index (golden-angle spread). Returns 0..255 rgb. */
function sceneRGB(i: number): [number, number, number] {
  const h = ((i * 137.508) % 360) / 360
  const s = 0.5
  const l = 0.55
  const k = (nn: number): number => (nn + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (nn: number): number => l - a * Math.max(-1, Math.min(Math.min(k(nn) - 3, 9 - k(nn)), 1))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

/** The surface on/off toggle, lifted into the section header (merged with the
 *  "surface" title). Rendered inside the Collapsible's header button, so it stops
 *  propagation to avoid also toggling the collapse. */
export function SurfaceOnToggle(): JSX.Element {
  const active = useStore((s) => s.surface.active)
  const setSurfaceActive = useStore((s) => s.setSurfaceActive)
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        setSurfaceActive(!active)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          setSurfaceActive(!active)
        }
      }}
      className={`ml-1.5 rounded border px-1.5 py-0 font-mono text-[9px] normal-case transition-colors ${
        active ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:text-text'
      }`}
      title="When on, the output is a live blend of the scenes at the cursor, instead of the live composition"
    >
      {active ? '● on' : '○ off'}
    </span>
  )
}

export function SurfacePad(): JSX.Element {
  const scenes = useStore((s) => s.scenes)
  const surface = useStore((s) => s.surface)
  const setSurfaceActive = useStore((s) => s.setSurfaceActive)
  const setSurfaceXY = useStore((s) => s.setSurfaceXY)
  const setScenePos = useStore((s) => s.setScenePos)
  const autoPlaceScenes = useStore((s) => s.autoPlaceScenes)
  const setSurfacePath = useStore((s) => s.setSurfacePath)
  const setSurfacePlay = useStore((s) => s.setSurfacePlay)
  const setSurfaceTimeMs = useStore((s) => s.setSurfaceTimeMs)
  const setSurfaceWay = useStore((s) => s.setSurfaceWay)
  const setSurfaceJump = useStore((s) => s.setSurfaceJump)
  const setSurfaceWiggle = useStore((s) => s.setSurfaceWiggle)
  const setSurfaceClosed = useStore((s) => s.setSurfaceClosed)
  const padRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ mode: 'cursor' | 'dot'; id?: string } | null>(null)

  // Draw mode : when on, pointer gestures RECORD a path instead of navigating.
  const [drawMode, setDrawMode] = useState(false)
  // In-progress recording lives in a ref (freshest per-event array); a tick
  // state forces the re-render that reads it (same pattern as dataFLOU).
  const drawingRef = useRef<{ x: number; y: number }[] | null>(null)
  const [drawTick, setDrawTick] = useState(0)

  const placed = scenes.filter((s) => s.surface)
  const nearest = placed.length && surface.active ? nearestSurfaceScene(placed, surface.x, surface.y) : -1

  // ── Territory map (#3) : paint the Voronoi regions of the placed scenes into a
  // low-res canvas (each pixel tinted by its nearest scene, faded toward the seams
  // where the nearest two are close). Recomputed only when a dot moves, not per frame.
  const posKey = placed.map((s) => `${s.id}:${s.surface!.x.toFixed(3)},${s.surface!.y.toFixed(3)}`).join('|')
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const N = 56
    cv.width = N
    cv.height = N
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, N, N)
    if (placed.length < 2) return
    const pts = placed.map((s) => s.surface!)
    const cols = placed.map((_, i) => sceneRGB(i))
    const img = ctx.createImageData(N, N)
    for (let yy = 0; yy < N; yy++) {
      for (let xx = 0; xx < N; xx++) {
        const x = (xx + 0.5) / N
        const y = (yy + 0.5) / N
        let b0 = Infinity
        let b1 = Infinity
        let bi = 0
        for (let i = 0; i < pts.length; i++) {
          const d = (pts[i].x - x) ** 2 + (pts[i].y - y) ** 2
          if (d < b0) {
            b1 = b0
            b0 = d
            bi = i
          } else if (d < b1) b1 = d
        }
        // Margin between nearest and second-nearest → bright at cell centres,
        // transparent at the seams (so boundaries read as soft edges).
        const margin = Math.sqrt(b1) - Math.sqrt(b0)
        const dom = Math.max(0, Math.min(1, margin * 5))
        const o = (yy * N + xx) * 4
        img.data[o] = cols[bi][0]
        img.data[o + 1] = cols[bi][1]
        img.data[o + 2] = cols[bi][2]
        img.data[o + 3] = Math.round(28 + dom * 74)
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [posKey, placed.length])

  // Blend readout (#3) : the top-two scenes by weight under the cursor, so you can
  // see which scenes you're between (and by how much) before you hear it.
  const blend = useMemo(() => {
    if (placed.length < 2 || !surface.active) return null
    const w = surfaceWeights(placed, surface.x, surface.y)
    const idx = w.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v)
    const top = idx.slice(0, 2).filter((e) => e.v > 0.005)
    return top.map((e) => ({ n: scenes.findIndex((z) => z.id === placed[e.i].id) + 1, pct: Math.round(e.v * 100) }))
  }, [placed, surface.x, surface.y, surface.active, scenes])

  const toXY = (e: React.PointerEvent): { x: number; y: number } => {
    const r = padRef.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }

  const onDown = (e: React.PointerEvent): void => {
    const p = toXY(e)
    padRef.current!.setPointerCapture(e.pointerId)
    if (drawMode) {
      // Start a fresh recording (crayon at the touch point).
      drawingRef.current = [p]
      setDrawTick((n) => n + 1)
      return
    }
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
    if (hitId) {
      drag.current = { mode: 'dot', id: hitId }
    } else {
      drag.current = { mode: 'cursor' }
      if (!surface.active) setSurfaceActive(true)
      // Hand-driving the cursor overrides auto-play so a tug always wins.
      if (surface.play) setSurfacePlay(false)
      setSurfaceXY(p.x, p.y)
    }
  }
  const onMove = (e: React.PointerEvent): void => {
    const p = toXY(e)
    if (drawMode) {
      const cur = drawingRef.current
      if (!cur) return
      // Skip near-duplicate points so a slow drag doesn't bloat the path.
      const last = cur[cur.length - 1]
      if ((last.x - p.x) ** 2 + (last.y - p.y) ** 2 > 0.005 * 0.005) {
        cur.push(p)
        setDrawTick((n) => n + 1)
      }
      return
    }
    const d = drag.current
    if (!d) return
    if (d.mode === 'cursor') setSurfaceXY(p.x, p.y)
    else if (d.id) setScenePos(d.id, p.x, p.y)
  }
  const onUp = (e: React.PointerEvent): void => {
    if (drawMode && drawingRef.current) {
      // Commit the recording (need ≥ 2 points to trace).
      if (drawingRef.current.length >= 2) setSurfacePath(drawingRef.current.slice())
      drawingRef.current = null
      setDrawTick((n) => n + 1)
    }
    drag.current = null
    try {
      padRef.current!.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }

  // Visible path = live recording (while drawing) or the committed gesture.
  void drawTick
  const visPath = drawingRef.current ?? surface.path
  const pathD =
    visPath.length > 0
      ? visPath.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') +
        // Close the outline when the sequencer treats the path as a loop (and it's
        // the committed path, not the in-progress recording).
        (surface.closed && !drawingRef.current ? ' Z' : '')
      : ''
  const hasPath = surface.path.length >= 2

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => autoPlaceScenes(true)}
          className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:text-text"
          title="Re-spread every scene evenly over the plane (a sunflower layout)"
        >
          arrange
        </button>
        <button
          onClick={() => {
            setDrawMode((v) => !v)
            if (surface.play) setSurfacePlay(false)
          }}
          className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
            drawMode ? 'border-accent2 bg-accent2/15 text-accent2' : 'border-border text-muted hover:text-text'
          }`}
          title="Draw a path across the plane. Then Play traces it automatically."
        >
          {drawMode ? '✎ drawing' : '✎ draw'}
        </button>
        {/* Learn hosts only : bind a hardware fader / joystick axis to the
            surface X / Y so the cursor can be driven from a controller. */}
        <span className="relative ml-auto flex shrink-0">
          <MidiLearnOverlay id="surface:x" />
          <span
            className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted"
            title="Bind MIDI to the Metasurface X axis"
          >
            X
          </span>
        </span>
        <span className="relative flex shrink-0">
          <MidiLearnOverlay id="surface:y" />
          <span
            className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted"
            title="Bind MIDI to the Metasurface Y axis"
          >
            Y
          </span>
        </span>
      </div>
      <div
        ref={padRef}
        className="relative mx-auto aspect-square w-full max-w-[260px] touch-none select-none overflow-hidden rounded-md border border-border bg-panel2/50"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / 0.04) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.04) 1px, transparent 1px)',
          backgroundSize: '25% 25%',
          cursor: drawMode ? 'crosshair' : 'default'
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {/* Territory map — the Voronoi regions of the placed scenes (soft seams). */}
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ imageRendering: 'auto' }}
        />
        {/* Drawn path overlay (0..1 user space). */}
        {pathD && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
          >
            <path
              d={pathD}
              fill="none"
              stroke="rgb(var(--c-accent2))"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="0.5 6"
              opacity={drawingRef.current ? 0.95 : 0.75}
              vectorEffect="non-scaling-stroke"
            />
            {visPath.length > 1 && (
              <>
                <circle cx={visPath[0].x} cy={visPath[0].y} r={0.018} fill="rgb(var(--c-accent2))" />
                <circle
                  cx={visPath[visPath.length - 1].x}
                  cy={visPath[visPath.length - 1].y}
                  r={0.018}
                  fill="rgb(var(--c-text))"
                  opacity={0.6}
                />
              </>
            )}
          </svg>
        )}
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
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] text-muted/70">
          {placed.length < 2
            ? 'save ≥ 2 scenes to play the surface'
            : drawMode
              ? 'drag on the plane to draw a path · Play traces it'
              : 'drag = navigate · drag a dot = move a scene'}
        </span>
        {blend && blend.length > 0 && (
          <span className="shrink-0 font-mono text-[9px] text-muted tabular-nums" title="Scenes you're between, by weight">
            {blend.map((b, i) => (
              <span key={b.n}>
                {i > 0 && ' · '}
                <span className="text-accent">{b.n}</span> {b.pct}%
              </span>
            ))}
          </span>
        )}
      </div>

      {/* Draw-sequencer transport — shown once there's a path to play. */}
      {hasPath && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border/70 bg-panel2/40 p-1.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSurfacePlay(!surface.play)}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                surface.play
                  ? 'border-accent2 bg-accent2/20 text-accent2'
                  : 'border-border text-muted hover:text-text'
              }`}
              title="Auto-trace the drawn path across the plane"
            >
              {surface.play ? '■ stop' : '▶ play'}
            </button>
            {/* way : direction of travel */}
            <div className="flex overflow-hidden rounded border border-border font-mono text-[10px]">
              {([
                ['forward', '→', 'forward'],
                ['backward', '←', 'backward'],
                ['pingpong', '⇄', 'ping-pong']
              ] as const).map(([w, glyph, label]) => (
                <button
                  key={w}
                  onClick={() => setSurfaceWay(w)}
                  className={`px-1.5 py-0.5 transition-colors ${
                    surface.way === w ? 'bg-accent2/20 text-accent2' : 'text-muted hover:text-text'
                  }`}
                  title={label}
                >
                  {glyph}
                </button>
              ))}
            </div>
            <button
              onClick={() => setSurfaceClosed(!surface.closed)}
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                surface.closed ? 'border-accent2 bg-accent2/20 text-accent2' : 'border-border text-muted hover:text-text'
              }`}
              title="Loop the path : connect the end back to the start so forward play flows around instead of teleporting"
            >
              ⟳ loop
            </button>
            <button
              onClick={() => {
                setSurfacePath([])
                setSurfacePlay(false)
              }}
              className="ml-auto rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:text-text"
              title="Erase the drawn path"
            >
              clear
            </button>
          </div>
          <label className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
            <span className="w-8">time</span>
            <input
              type="range"
              min={200}
              max={60000}
              step={100}
              value={surface.timeMs}
              onChange={(e) => setSurfaceTimeMs(Number(e.target.value))}
              className="flex-1 accent-accent2"
            />
            <span className="w-16 text-right tabular-nums text-text">
              {(surface.timeMs / 1000).toFixed(1)} s
            </span>
          </label>
          <label className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
            <span className="w-8">jump</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={surface.jump}
              onChange={(e) => setSurfaceJump(Number(e.target.value))}
              className="flex-1 accent-accent2"
              title="Chance the playhead randomly teleports to another spot on the path (jitter)"
            />
            <span className="w-16 text-right tabular-nums text-text">{surface.jump} %</span>
          </label>
          <label className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
            <span className="w-8">wiggle</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={surface.wiggle}
              onChange={(e) => setSurfaceWiggle(Number(e.target.value))}
              className="flex-1 accent-accent2"
              title="Smooth sinusoidal wobble around the traced position (a vibrato — unlike jump's teleports)"
            />
            <span className="w-16 text-right tabular-nums text-text">{surface.wiggle} %</span>
          </label>
        </div>
      )}
    </div>
  )
}
