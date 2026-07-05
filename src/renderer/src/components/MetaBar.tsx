// Meta Controller (brief §6) — 16 macro knobs, one flat bank. Each tile
// matches the modulator-card chrome: bordered, aligned rows, everything
// legible at a glance. A knob shows: dial (destination count under it),
// name (double-click renames), CC learn, curve, and an M button binding
// MODULATORS to the knob — modulated knobs' dials move live (accent2 arc).

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { ModCurve } from '@shared/types'
import { META_KNOB_COUNT } from '@shared/types'
import { metaLiveValues } from '../engine/modulation'
import {
  commitKnob,
  knobDisplayValue,
  knobDisplayVersion,
  setKnobImmediate,
  setKnobTarget,
  subscribeKnobDisplay
} from '../metaSmooth'
import { modTargetKey, useStore } from '../store'
import { AssignRow } from './AutoControls'

const KNOB_PX = 44
const ARC_SWEEP_DEG = 270
const DRAG_PIXELS_FOR_FULL_RANGE = 200
const CURVES: ModCurve[] = [
  'linear', 'log', 'exp', 'geom', 'easeIn', 'easeOut', 'cubic', 'sqrt',
  'sigmoid', 'smoothstep', 'db', 'gamma', 'step', 'invert'
]

export function MetaBar(): JSX.Element {
  const collapsed = useStore((s) => !!s.collapsed['meta'])
  const toggleSection = useStore((s) => s.toggleSection)

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-border bg-panel px-3 py-1.5">
      <button
        onClick={() => toggleSection('meta')}
        className="flex shrink-0 items-center gap-1.5 self-start"
        title={collapsed ? 'Expand Meta Controller' : 'Collapse Meta Controller'}
      >
        <span
          className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
        >
          ▶
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Meta</span>
      </button>
      {!collapsed && (
        // 16 tiles spread to fill the full width; columns never shrink below
        // the knob so it can't overlap, scrolling only on a very narrow window.
        <div
          className="grid gap-1.5 overflow-x-auto pb-1"
          style={{ gridTemplateColumns: `repeat(${META_KNOB_COUNT}, minmax(52px, 1fr))` }}
        >
          {Array.from({ length: META_KNOB_COUNT }, (_, i) => (
            <MetaKnobTile key={i} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}

function MetaKnobTile({ index }: { index: number }): JSX.Element {
  const knob = useStore((s) => s.composition.metaKnobs[index])
  const updateMetaKnob = useStore((s) => s.updateMetaKnob)
  const midiLearn = useStore((s) => s.midiLearn)
  const setMidiLearn = useStore((s) => s.setMidiLearn)
  const [renaming, setRenaming] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)

  // Which modulators drive this knob (target kind 'meta').
  const target = { kind: 'meta', knob: index } as const
  const targetKey = modTargetKey(target)
  const bound = useStore((s) =>
    s.composition.modMatrix.filter((a) => modTargetKey(a.target) === targetKey)
  )
  const isModulated = bound.length > 0

  // Dial position: the smoother's display value; while modulated, the live
  // modulated position (painted at rAF rate through local state — only
  // modulated knobs pay this cost).
  useSyncExternalStore(subscribeKnobDisplay, knobDisplayVersion)
  const [liveTick, setLiveTick] = useState(0)
  useEffect(() => {
    if (!isModulated) return
    let raf = 0
    const paint = (): void => {
      setLiveTick((n) => n + 1)
      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [isModulated])
  void liveTick
  const display = isModulated
    ? (metaLiveValues.get(index) ?? knobDisplayValue(index))
    : knobDisplayValue(index)

  const dragRef = useRef<{ startY: number; startValue: number; pointerId: number } | null>(null)

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startValue: knobDisplayValue(index), pointerId: e.pointerId }
    document.body.style.cursor = 'none'
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const dy = d.startY - e.clientY
    const sensitivity = e.shiftKey ? 4 : 1
    const next = Math.max(0, Math.min(1, d.startValue + dy / (DRAG_PIXELS_FOR_FULL_RANGE * sensitivity)))
    // Direct 1:1 tracking — no tween lag (the pointer is the smoothing).
    setKnobImmediate(index, next)
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    commitKnob(index) // one undo checkpoint per gesture
    dragRef.current = null
    document.body.style.cursor = ''
  }

  // Dial geometry — min at 7:30, max at 4:30 (LaunchControl orientation).
  const cx = KNOB_PX / 2
  const cy = KNOB_PX / 2
  const radius = KNOB_PX / 2 - 5
  const rad = (deg: number): number => ((deg - 90) * Math.PI) / 180
  const startDeg = 225
  const currentDeg = startDeg + display * ARC_SWEEP_DEG
  const arcStart = rad(startDeg)
  const arcEnd = rad(currentDeg)
  const largeArc = currentDeg - startDeg > 180 ? 1 : 0
  const bgEnd = rad(startDeg + ARC_SWEEP_DEG)
  const arcColor = isModulated ? 'rgb(var(--c-accent2))' : 'rgb(var(--c-accent))'

  const learning = midiLearn === index

  return (
    <div
      className={`flex min-w-0 flex-col items-center gap-1 rounded border p-1.5 transition-colors ${
        knob.destinations.length > 0 || isModulated
          ? 'border-accent/40 bg-panel2'
          : 'border-border bg-panel2/40'
      }`}
    >
      <div
        className="relative cursor-pointer"
        style={{ width: KNOB_PX, height: KNOB_PX, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setKnobTarget(index, 0, knob.smoothMs)}
        title={`${knob.name} — drag vertically · Shift = fine · double-click resets`}
      >
        <svg width={KNOB_PX} height={KNOB_PX} className="absolute inset-0">
          <path
            d={`M ${cx + radius * Math.cos(arcStart)} ${cy + radius * Math.sin(arcStart)}
                A ${radius} ${radius} 0 1 1 ${cx + radius * Math.cos(bgEnd)} ${cy + radius * Math.sin(bgEnd)}`}
            fill="none"
            stroke="rgb(var(--c-panel3))"
            strokeWidth={3}
            strokeLinecap="round"
          />
          {display > 0.001 && (
            <path
              d={`M ${cx + radius * Math.cos(arcStart)} ${cy + radius * Math.sin(arcStart)}
                  A ${radius} ${radius} 0 ${largeArc} 1 ${cx + radius * Math.cos(arcEnd)} ${cy + radius * Math.sin(arcEnd)}`}
              fill="none"
              stroke={arcColor}
              strokeWidth={3}
              strokeLinecap="round"
            />
          )}
          <circle cx={cx} cy={cy} r={radius - 4} fill="rgb(var(--c-panel))" stroke="rgb(var(--c-border))" />
          <line
            x1={cx + (radius - 8) * Math.cos(rad(currentDeg))}
            y1={cy + (radius - 8) * Math.sin(rad(currentDeg))}
            x2={cx + radius * Math.cos(rad(currentDeg))}
            y2={cy + radius * Math.sin(rad(currentDeg))}
            stroke={arcColor}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* destinations count — what this knob drives */}
      <span className="font-mono text-[8px] leading-none text-muted">
        {knob.destinations.length > 0 ? `${knob.destinations.length} dest` : '—'}
      </span>

      {renaming ? (
        <input
          autoFocus
          className="input w-full px-0.5 py-0 text-center text-[9px]"
          defaultValue={knob.name}
          onBlur={(e) => {
            updateMetaKnob(index, { name: e.target.value.trim() || knob.name })
            setRenaming(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <button
          onDoubleClick={() => setRenaming(true)}
          className="w-full truncate text-center font-mono text-[9px] text-muted hover:text-text"
          title={`${knob.name} — double-click to rename`}
        >
          {knob.name}
        </button>
      )}

      {/* Curve select gets its OWN full-width row so the expressive-function
          names (smoothstep, sigmoid, gamma…) are readable. */}
      <select
        className="input select-compact w-full px-1 py-0.5 text-[9px]"
        value={knob.curve}
        onChange={(e) => updateMetaKnob(index, { curve: e.target.value as ModCurve })}
        title="Output curve (expressive shaping)"
      >
        {CURVES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <div className="flex w-full items-center justify-center gap-1">
        <button
          onClick={() => {
            if (learning) setMidiLearn(null)
            else if (knob.midiCc) updateMetaKnob(index, { midiCc: null })
            else setMidiLearn(index)
          }}
          className={`flex-1 rounded border px-1 py-px font-mono text-[8px] leading-none transition-colors ${
            learning
              ? 'animate-pulse border-accent bg-accent/25 text-accent'
              : knob.midiCc
                ? 'border-accent2 text-accent2'
                : 'border-border text-muted hover:text-text'
          }`}
          title={
            learning
              ? 'Waiting for a CC… click to cancel'
              : knob.midiCc
                ? `CC${knob.midiCc.number} ch${knob.midiCc.channel + 1} — click to clear`
                : 'MIDI learn'
          }
        >
          {learning ? '···' : knob.midiCc ? `CC${knob.midiCc.number}` : 'CC'}
        </button>
        <button
          onClick={() => setAssignOpen((o) => !o)}
          className={`flex-1 rounded px-1 py-px font-mono text-[8px] leading-none transition-colors ${
            isModulated
              ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2'
              : 'bg-panel3/60 text-muted hover:text-text'
          }`}
          title="Bind a modulator to this knob"
        >
          M{isModulated ? bound.map((b) => b.mod + 1).join('') : ''}
        </button>
      </div>

      {assignOpen && (
        <div className="w-full">
          <AssignRow target={target} bound={bound} hideMeta />
        </div>
      )}
    </div>
  )
}
