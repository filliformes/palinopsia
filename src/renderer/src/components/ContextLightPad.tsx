// Context's light pad : place the light by dragging, or DRAW a path and play it,
// with the Metasurface's draw sequencer (direction, loop, time, jump, wiggle).
// The pad keeps the composition's proportions so a spot on it is that spot on
// the picture. Beside it, Vibe Color lights the scene in the Vibe's colour.

import type { FxInstance } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_LIGHT_PATH, liveLight } from '../lightPath'
import { useStore } from '../store'
import { applyVibeColor } from '../vibeColor'
import { DrawPathTransport } from './DrawPathTransport'

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
const LIGHT_DEFAULT = [0.5, 0.55]

export function ContextLightPad({
  inst,
  onChange
}: {
  inst: FxInstance
  onChange: (n: string, v: number | number[]) => void
}): JSX.Element {
  const master = useStore((s) => s.composition.master)
  const compW = useStore((s) => s.compW)
  const compH = useStore((s) => s.compH)
  const setLightPath = useStore((s) => s.setContextLightPath)
  const lp = { ...DEFAULT_LIGHT_PATH, ...(inst.lightPath ?? {}) }
  const lv = inst.inputs.light
  const light = Array.isArray(lv) && lv.length >= 2 ? lv : LIGHT_DEFAULT
  const padRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [drawMode, setDrawMode] = useState(false)
  // The in-progress recording lives in a ref (freshest per event); a tick
  // re-renders the overlay that reads it (as on the Metasurface pad).
  const drawingRef = useRef<{ x: number; y: number }[] | null>(null)
  const [, setDrawTick] = useState(0)
  const hasPath = lp.path.length >= 2
  const playing = lp.play && hasPath

  // While playing, the glowing dot follows the traced light (rAF straight into
  // the DOM : the store holds the path, not every frame's position).
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = (): void => {
      const el = liveRef.current
      if (el) {
        el.style.left = `${liveLight.x * 100}%`
        el.style.bottom = `${liveLight.y * 100}%`
        el.style.opacity = liveLight.on ? '1' : '0'
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // Pointer → the light's own space (y up, like the ISF point).
  const toLight = (e: React.PointerEvent): { x: number; y: number } => {
    const r = padRef.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01(1 - (e.clientY - r.top) / r.height) }
  }
  const onDown = (e: React.PointerEvent): void => {
    const p = toLight(e)
    padRef.current!.setPointerCapture(e.pointerId)
    if (drawMode) {
      drawingRef.current = [p]
      setDrawTick((n) => n + 1)
      return
    }
    dragging.current = true
    // Hand-placing the light stops the path (a tug always wins, as on the Metasurface).
    if (lp.play) setLightPath({ play: false })
    onChange('light', [p.x, p.y])
  }
  const onMove = (e: React.PointerEvent): void => {
    const p = toLight(e)
    if (drawMode) {
      const cur = drawingRef.current
      if (!cur) return
      const last = cur[cur.length - 1]
      if ((last.x - p.x) ** 2 + (last.y - p.y) ** 2 > 0.005 * 0.005) {
        cur.push(p)
        setDrawTick((n) => n + 1)
      }
      return
    }
    if (dragging.current) onChange('light', [p.x, p.y])
  }
  const onUp = (e: React.PointerEvent): void => {
    if (drawMode && drawingRef.current) {
      if (drawingRef.current.length >= 2) setLightPath({ path: drawingRef.current.slice() })
      drawingRef.current = null
      setDrawTick((n) => n + 1)
    }
    dragging.current = false
    try {
      padRef.current!.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }

  const visPath = drawingRef.current ?? lp.path
  const pathD =
    visPath.length > 0
      ? visPath.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${1 - p.y}`).join(' ') +
        (lp.closed && !drawingRef.current ? ' Z' : '')
      : ''
  // The composition's proportions, kept readable (a very wide span or a tall
  // portrait still gets a usable pad).
  const aspect = Math.max(0.75, Math.min(2.4, compW / Math.max(1, compH)))

  return (
    <div className="flex flex-col gap-1.5 px-2 py-2">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted">light</span>
        <button
          onClick={() => {
            setDrawMode((v) => !v)
            if (lp.play) setLightPath({ play: false })
          }}
          className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
            drawMode ? 'border-accent2 bg-accent2/15 text-accent2' : 'border-border text-muted hover:text-text'
          }`}
          title="Draw a path for the light. Then Play makes the light travel along it."
        >
          {drawMode ? '✎ drawing' : '✎ draw'}
        </button>
        <button
          onClick={() => applyVibeColor(master, onChange)}
          className="ml-auto shrink-0 rounded border border-accent2/50 bg-accent2/10 px-1.5 py-0.5 font-mono text-[10px] text-accent2 hover:bg-accent2/20"
          title="Light the scene in the Vibe Palette's main color (the one it is painting with now, at full brightness; a light that is off is turned up)"
        >
          Vibe Color
        </button>
      </div>
      <div
        ref={padRef}
        className="relative mx-auto w-full max-w-[240px] touch-none select-none overflow-hidden rounded border border-border bg-panel2"
        style={{
          aspectRatio: String(aspect),
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / 0.04) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.04) 1px, transparent 1px)',
          backgroundSize: '25% 25%',
          cursor: 'crosshair'
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => {
          if (!drawMode) onChange('light', LIGHT_DEFAULT)
        }}
        title={drawMode ? 'Drag to draw the light’s path' : 'Drag to place the light · double-click to reset'}
      >
        {pathD && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
            <path
              d={pathD}
              fill="none"
              stroke="rgb(var(--c-accent2))"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="0.5 5"
              opacity={drawingRef.current ? 0.95 : 0.7}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
        {/* The placed light (dimmed while a path drives it). */}
        <div
          className={`pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-accent ${playing ? 'opacity-30' : ''}`}
          style={{ left: `${light[0] * 100}%`, bottom: `${light[1] * 100}%` }}
        />
        {playing && (
          <div
            ref={liveRef}
            className="pointer-events-none absolute z-10 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-accent2 bg-accent2/30 shadow-[0_0_8px_rgb(var(--c-accent2)/0.6)]"
            style={{ left: `${light[0] * 100}%`, bottom: `${light[1] * 100}%`, opacity: 0 }}
          />
        )}
      </div>
      <span className="font-mono text-[9px] text-muted/70">
        {drawMode
          ? 'drag on the pad to draw a path · Play makes the light travel it'
          : hasPath
            ? 'drag = place the light (stops the path) · ✎ draw = a new path'
            : 'drag = place the light · ✎ draw a path to animate it'}
      </span>
      {hasPath && (
        <DrawPathTransport
          cfg={lp}
          playing={lp.play}
          onPlay={(on) => setLightPath({ play: on })}
          onWay={(way) => setLightPath({ way })}
          onClosed={(closed) => setLightPath({ closed })}
          onClear={() => setLightPath({ path: [], play: false })}
          onTime={(timeMs) => setLightPath({ timeMs })}
          onJump={(jump) => setLightPath({ jump })}
          onWiggle={(wiggle) => setLightPath({ wiggle })}
          playTitle="Make the light travel along the drawn path"
        />
      )}
    </div>
  )
}
