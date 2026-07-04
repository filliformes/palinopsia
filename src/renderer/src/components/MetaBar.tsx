// Meta Controller bar (brief §6/§10.4) — 32 macro knobs across 4 banks of 8.
// The knob visual + drag behaviour follow dataFLOU's MetaKnob (270° arc,
// LaunchControl orientation, 200px vertical travel, Shift = fine, double-
// click resets); the value you see IS the value the destinations receive —
// the dial reads from the smoother's display value, never applies directly.
//
// Per knob: CC learn (arm → next CC binds; click again to clear), rename on
// double-click of the name, smoothing + curve in the knob's title strip.

import {
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { ModCurve } from '@shared/types'
import { META_BANKS } from '@shared/types'
import { knobDisplayValue, knobDisplayVersion, setKnobTarget, subscribeKnobDisplay } from '../metaSmooth'
import { useStore } from '../store'

const KNOB_PX = 44
const ARC_SWEEP_DEG = 270
const DRAG_PIXELS_FOR_FULL_RANGE = 200
const CURVES: ModCurve[] = [
  'linear', 'log', 'exp', 'geom', 'easeIn', 'easeOut', 'cubic', 'sqrt',
  'sigmoid', 'smoothstep', 'db', 'gamma', 'step', 'invert'
]

export function MetaBar(): JSX.Element {
  const bank = useStore((s) => s.metaBank)
  const setBank = useStore((s) => s.setMetaBank)
  const collapsed = useStore((s) => !!s.collapsed['meta'])
  const toggleSection = useStore((s) => s.toggleSection)

  return (
    <div className="flex min-w-0 flex-col border-t border-border bg-panel px-3 py-1">
      <div className="flex items-center gap-3">
        <button
          onClick={() => toggleSection('meta')}
          className="flex shrink-0 items-center gap-1.5"
          title={collapsed ? 'Expand Meta Controller' : 'Collapse Meta Controller'}
        >
          <span
            className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
          >
            ▶
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Meta</span>
        </button>
        <div className="flex gap-0.5">
          {Array.from({ length: META_BANKS }, (_, b) => (
            <button
              key={b}
              onClick={() => setBank(b)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                bank === b
                  ? 'bg-accent/20 text-accent ring-1 ring-accent'
                  : 'bg-panel2 text-muted hover:text-text'
              }`}
            >
              {String.fromCharCode(65 + b)}
            </button>
          ))}
        </div>
      </div>
      {!collapsed && (
        <div className="flex min-w-0 items-start gap-1 overflow-x-auto py-1">
          {Array.from({ length: 8 }, (_, i) => (
            <MetaKnob key={bank * 8 + i} index={bank * 8 + i} />
          ))}
        </div>
      )}
    </div>
  )
}

function MetaKnob({ index }: { index: number }): JSX.Element {
  const knob = useStore((s) => s.composition.metaKnobs[index])
  const updateMetaKnob = useStore((s) => s.updateMetaKnob)
  const midiLearn = useStore((s) => s.midiLearn)
  const setMidiLearn = useStore((s) => s.setMidiLearn)
  const [renaming, setRenaming] = useState(false)

  // Display value from the smoother — re-renders while tweening.
  useSyncExternalStore(subscribeKnobDisplay, knobDisplayVersion)
  const display = knobDisplayValue(index)

  const dragRef = useRef<{ startY: number; startValue: number; pointerId: number } | null>(null)

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startValue: display, pointerId: e.pointerId }
    document.body.style.cursor = 'none' // hardware-DAW convention
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const dy = d.startY - e.clientY
    const sensitivity = e.shiftKey ? 4 : 1
    const next = Math.max(0, Math.min(1, d.startValue + dy / (DRAG_PIXELS_FOR_FULL_RANGE * sensitivity)))
    setKnobTarget(index, next, knob.smoothMs)
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    dragRef.current = null
    document.body.style.cursor = ''
  }

  // Geometry — deg 0 = 12 o'clock, clockwise; min at 7:30, max at 4:30.
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

  const learning = midiLearn === index

  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-0.5 select-none">
      <div
        className="relative cursor-pointer"
        style={{ width: KNOB_PX, height: KNOB_PX, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setKnobTarget(index, 0, knob.smoothMs)}
        title={`${knob.name} — drag vertically · Shift = fine · double-click resets · ${knob.destinations.length}/8 destinations`}
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
              stroke="rgb(var(--c-accent))"
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
            stroke="rgb(var(--c-accent))"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
        {knob.destinations.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent2" />
        )}
      </div>

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
          className="w-full truncate text-center font-mono text-[9px] text-muted"
          title="Double-click to rename"
        >
          {knob.name}
        </button>
      )}

      <div className="flex items-center gap-0.5">
        {/* CC learn: arm → next CC binds; click again clears the binding. */}
        <button
          onClick={() => {
            if (learning) setMidiLearn(null)
            else if (knob.midiCc) updateMetaKnob(index, { midiCc: null })
            else setMidiLearn(index)
          }}
          className={`rounded border px-1 py-px font-mono text-[8px] leading-none transition-colors ${
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
        <select
          className="input select-compact w-9 px-0.5 py-0 text-[8px]"
          value={knob.curve}
          onChange={(e) => updateMetaKnob(index, { curve: e.target.value as ModCurve })}
          title="Output curve"
        >
          {CURVES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
