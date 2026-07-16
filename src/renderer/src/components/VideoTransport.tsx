// VideoTransport : play/pause, direction, loop, speed, and a scrub timeline
// with draggable in/out points + a live playhead, for a selected video source.
// The playhead is painted straight from the engine's videoPlayheads map in a
// rAF loop (no React re-renders), like the modulated sliders.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ModTarget, SourceSlot } from '@shared/types'
import { useShallow } from 'zustand/react/shallow'
import { videoKey, videoPlayheads } from '../engine/videoState'
import { modTargetKey, useStore } from '../store'
import { AssignRow } from './AutoControls'

const SMIN = 1 / 28
const SMAX = 128
const tFromSpeed = (s: number): number => Math.log(s / SMIN) / Math.log(SMAX / SMIN)
const speedFromT = (t: number): number => SMIN * Math.pow(SMAX / SMIN, t)

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtSpeed(s: number): string {
  if (s >= 1) return `${s.toFixed(s < 10 ? 2 : s < 100 ? 1 : 0)}×`
  return `1/${(1 / s).toFixed(s > 0.1 ? 1 : 0)}×`
}

export function VideoTransport({
  layer,
  slot,
  state
}: {
  layer: number
  slot: 'A' | 'B'
  state: SourceSlot
}): JSX.Element {
  const setVideoPlayback = useStore((s) => s.setVideoPlayback)
  const set = (patch: Parameters<typeof setVideoPlayback>[2]): void =>
    setVideoPlayback(layer, slot, patch)

  const playing = state.videoPlaying ?? true
  const direction = state.videoDirection ?? (state.videoReverse ? 'reverse' : 'forward')
  const loop = state.videoLoop ?? true
  const speed = state.videoSpeed ?? 1
  const inN = state.videoIn ?? 0
  const outN = state.videoOut ?? 1

  const key = videoKey(layer, slot)
  const barRef = useRef<HTMLDivElement | null>(null)
  const playheadRef = useRef<HTMLDivElement | null>(null)
  const timeRef = useRef<HTMLSpanElement | null>(null)
  const durRef = useRef<HTMLSpanElement | null>(null)
  const dragging = useRef<'in' | 'out' | null>(null)

  // Live playhead + time labels, painted from the engine each frame.
  useEffect(() => {
    let raf = 0
    const paint = (): void => {
      const ph = videoPlayheads.get(key)
      if (ph && ph.duration > 0) {
        const p = Math.max(0, Math.min(1, ph.time / ph.duration))
        if (playheadRef.current) playheadRef.current.style.left = `${p * 100}%`
        if (timeRef.current) timeRef.current.textContent = fmt(ph.time)
        if (durRef.current) durRef.current.textContent = fmt(ph.duration)
      }
      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [key])

  const posFromEvent = (e: ReactPointerEvent): number => {
    const el = barRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }
  const startDrag = (which: 'in' | 'out') => (e: ReactPointerEvent) => {
    e.stopPropagation()
    dragging.current = which
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent): void => {
    if (!dragging.current) return
    const p = posFromEvent(e)
    if (dragging.current === 'in') set({ videoIn: Math.min(p, outN - 0.01) })
    else set({ videoOut: Math.max(p, inN + 0.01) })
  }
  const endDrag = (): void => {
    dragging.current = null
  }

  const btn = (on: boolean): string =>
    `rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
      on ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:text-text'
    }`

  return (
    <div className="flex flex-col gap-2 border-t border-border px-2 py-2">
      {/* Transport row */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => set({ videoPlaying: !playing })}
          className={btn(playing)}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸ pause' : '▶ play'}
        </button>
        <button
          onClick={() =>
            set({
              videoDirection:
                direction === 'forward' ? 'reverse' : direction === 'reverse' ? 'pendulum' : 'forward'
            })
          }
          className={btn(direction !== 'forward')}
          title={`Play mode: ${direction} : click to cycle forward → reverse → pendulum`}
        >
          {direction === 'forward' ? 'fwd ▶' : direction === 'reverse' ? '◀ rev' : '⇄ pend'}
        </button>
        <button
          onClick={() => set({ videoLoop: !loop })}
          className={btn(loop)}
          title={loop ? 'Looping between in/out' : 'Play once, hold at end'}
        >
          ⟲ loop
        </button>
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-muted">
          <span ref={timeRef}>0:00</span> / <span ref={durRef}>0:00</span>
        </span>
      </div>

      {/* Timeline : inset with the same flanking widths as the Speed row so it
          lines up to the exact width of the Speed slider. */}
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0" />
        <div
          ref={barRef}
          className="relative h-6 min-w-0 flex-1 select-none rounded bg-panel2"
          onPointerMove={onMove}
          onPointerUp={endDrag}
        >
        <div
          className="absolute inset-y-0 bg-accent/15"
          style={{ left: `${inN * 100}%`, right: `${(1 - outN) * 100}%` }}
        />
        <div
          className="absolute inset-y-0 -ml-1 w-2 cursor-ew-resize rounded-l bg-accent/80 hover:bg-accent"
          style={{ left: `${inN * 100}%` }}
          onPointerDown={startDrag('in')}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          title={`In point : ${(inN * 100).toFixed(0)}%`}
        />
        <div
          className="absolute inset-y-0 -ml-1 w-2 cursor-ew-resize rounded-r bg-accent/80 hover:bg-accent"
          style={{ left: `${outN * 100}%` }}
          onPointerDown={startDrag('out')}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          title={`Out point : ${(outN * 100).toFixed(0)}%`}
        />
        <div
          ref={playheadRef}
          className="pointer-events-none absolute inset-y-0 w-px bg-text"
          style={{ left: '0%' }}
        />
        </div>
        <span className="w-12 shrink-0" />
      </div>

      {/* Speed */}
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-muted">speed</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={tFromSpeed(speed)}
          onChange={(e) => set({ videoSpeed: speedFromT(Number(e.target.value)) })}
          onDoubleClick={() => set({ videoSpeed: 1 })}
          className="min-w-0 flex-1 accent-accent"
          title={`Clip speed ${fmtSpeed(speed)} : double-click to reset (×layer ×global)`}
        />
        <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted">
          {fmtSpeed(speed)}
        </span>
      </div>

      {/* Modulation : the playhead (position) + clip speed as mod targets. */}
      <VideoModRow layer={layer} slot={slot} />
    </div>
  )
}

// Bind a modulator to the video PLAYHEAD (position 0..1 within the trim : a saw
// LFO = a loop, S&H = jump-cuts, audio = a sound-driven scrub) or to the clip
// SPEED (rate multiplier). On imported/converted all-intra clips the seeks are
// frame-accurate, so a modulated playhead reads smooth.
function VideoModRow({ layer, slot }: { layer: number; slot: 'A' | 'B' }): JSX.Element {
  const [open, setOpen] = useState<'position' | 'speed' | null>(null)
  const posTarget: ModTarget = { kind: 'source', layer, slot, input: 'position' }
  const spdTarget: ModTarget = { kind: 'source', layer, slot, input: 'speed' }
  const posKey = modTargetKey(posTarget)
  const spdKey = modTargetKey(spdTarget)
  const posBound = useStore(
    useShallow((s) => s.composition.modMatrix.filter((a) => modTargetKey(a.target) === posKey))
  )
  const spdBound = useStore(
    useShallow((s) => s.composition.modMatrix.filter((a) => modTargetKey(a.target) === spdKey))
  )
  const mBtn = (label: string, which: 'position' | 'speed', bound: { length: number }): JSX.Element => (
    <button
      onClick={() => setOpen((o) => (o === which ? null : which))}
      className={`rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
        bound.length > 0
          ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2'
          : 'bg-panel3/60 text-muted hover:text-text'
      }`}
      title={`Bind a modulator to the ${which === 'position' ? 'playhead (a saw LFO loops, S&H jump-cuts, audio scrubs)' : 'clip speed'}`}
    >
      M·{label}
    </button>
  )
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-muted">mod</span>
        {mBtn('playhead', 'position', posBound)}
        {mBtn('speed', 'speed', spdBound)}
      </div>
      {open === 'position' && <AssignRow target={posTarget} bound={posBound} />}
      {open === 'speed' && <AssignRow target={spdTarget} bound={spdBound} />}
    </div>
  )
}
