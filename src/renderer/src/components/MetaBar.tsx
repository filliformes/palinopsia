// Macro Controller (brief §6; formerly Meta, the code keeps the meta names :
// metaKnobs, kind 'meta', `meta:<i>` MIDI ids) : 16 macro knobs, one flat bank. Each tile
// matches the modulator-card chrome: bordered, aligned rows, everything
// legible at a glance. A knob shows: dial (destination count under it),
// name (double-click renames), curve, range (min..max : where a full turn
// lands), CC learn, and an M button binding MODULATORS to the knob : modulated
// knobs' dials move live (accent2 arc). The title row carries a capsule per
// destination (like the Modulation row's), so what the knobs drive is in view
// even folded.

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { ModCurve } from '@shared/types'
import { META_KNOB_COUNT } from '@shared/types'
import { knobOut, metaLiveValues } from '../engine/modulation'
import {
  commitKnob,
  knobDisplayValue,
  knobDisplayVersion,
  setKnobImmediate,
  setKnobTarget,
  shuffleMetaValues,
  subscribeKnobDisplay
} from '../metaSmooth'
import { useShallow } from 'zustand/react/shallow'
import { modTargetKey, useStore } from '../store'
import { MidiLearnOverlay } from './MidiLearnOverlay'
import { useFlash } from './useFlash'
import { warnModMatrixFull } from './AutoControls'
import { PinZone } from './Pin'
import { BoundedNumberInput } from './BoundedNumberInput'
import { describeModTarget } from './ModulationPanel'

const KNOB_PX = 44
const ARC_SWEEP_DEG = 270
const DRAG_PIXELS_FOR_FULL_RANGE = 200
const CURVES: ModCurve[] = [
  'linear', 'log', 'exp', 'geom', 'easeIn', 'easeOut', 'cubic', 'sqrt',
  'sigmoid', 'smoothstep', 'db', 'gamma', 'step', 'invert'
]

export function MetaBar(): JSX.Element | null {
  const folded = useStore((s) => !!s.collapsed['meta'])
  const toggleSection = useStore((s) => s.toggleSection)
  const metaXYPads = useStore((s) => s.metaXYPads)
  const toggleMetaXYPads = useStore((s) => s.toggleMetaXYPads)
  // The row shows only when the MACRO button (Modulation row) says so. In MIDI
  // Learn mode it shows anyway, unfolded, so its knobs can be learned; it goes
  // away again with the mode (the per-machine choice is left as it was).
  const shown = useStore((s) => s.macroBar)
  const peek = useStore((s) => !s.macroBar && s.midiLearnMode)
  const collapsed = folded && !peek
  const [flashing, flash] = useFlash()
  // the knob whose capsule the pointer is on : its tile lights up
  const [hot, setHot] = useState<number | null>(null)
  const dests = useStore((s) => s.composition.metaKnobs.reduce((n, k) => n + k.destinations.length, 0))
  const onKnobs = useStore((s) => s.composition.metaKnobs.filter((k) => k.destinations.length > 0).length)

  if (!shown && !peek) return null
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 border-t bg-panel px-3 py-1.5 transition-colors ${
        flashing ? 'animate-pulse border-danger ring-1 ring-inset ring-danger' : 'border-border'
      }`}
    >
      <div className="flex w-full shrink-0 items-center gap-2">
        <button
          onClick={() => toggleSection('meta')}
          className="flex items-center gap-1.5"
          title={collapsed ? 'Expand the Macro knobs' : 'Collapse the Macro knobs'}
        >
          <span
            className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
          >
            ▶
          </span>
          {/* the destinations in use under the name, like Modulation's count */}
          <span className="flex flex-col items-start leading-none">
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Macro</span>
            <span
              className="mt-0.5 font-mono text-[9px] text-muted/80"
              title={dests ? `${dests} destination${dests > 1 ? 's' : ''} on ${onKnobs} knob${onKnobs > 1 ? 's' : ''}` : 'No destinations yet'}
            >
              {dests} dest
            </span>
          </span>
        </button>
        <span className="relative inline-flex">
          <MidiLearnOverlay id="rand:meta" />
          <button
            onClick={() => {
              shuffleMetaValues()
              flash()
            }}
            className={`rounded border px-1 font-mono text-[10px] leading-4 transition-colors ${
              flashing
                ? 'animate-pulse border-danger bg-danger/25 text-danger'
                : 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/20'
            }`}
            title="Randomize the knob positions (keeps bindings)"
          >
            ⚄
          </button>
        </span>
        <MacroDests onHot={setHot} />
        <button
          onClick={toggleMetaXYPads}
          className={`shrink-0 self-start rounded border px-1.5 font-mono text-[9px] leading-4 transition-colors ${
            metaXYPads
              ? 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/20'
              : 'border-border text-muted hover:text-text'
          }`}
          title={
            metaXYPads
              ? 'Knobs 13–16 are two XY performance pads : click to show them as knobs'
              : 'Knobs 13–16 are knobs : click to show them as two XY performance pads'
          }
        >
          {metaXYPads ? '⊞ XY' : '◎ 16'}
        </button>
      </div>
      {!collapsed && (
        // 16 tiles spread to fill the full width; columns never shrink below
        // the knob so it can't overlap, scrolling only on a very narrow window.
        <div
          className="grid gap-1.5 overflow-x-auto pb-1"
          style={{ gridTemplateColumns: `repeat(${META_KNOB_COUNT}, minmax(52px, 1fr))` }}
        >
          {metaXYPads ? (
            <>
              {Array.from({ length: 12 }, (_, i) => (
                <MetaKnobTile key={i} index={i} hot={hot === i} />
              ))}
              {/* Knobs 13–14 and 15–16 become two XY performance pads (each spans
                  the two knob columns it replaces). Configure their destinations /
                  names / bindings in knob mode (toggle top-right). */}
              <MetaXYPad key="xy1" xIndex={12} yIndex={13} hot={hot === 12 || hot === 13} />
              <MetaXYPad key="xy2" xIndex={14} yIndex={15} hot={hot === 14 || hot === 15} />
            </>
          ) : (
            Array.from({ length: META_KNOB_COUNT }, (_, i) => (
              <MetaKnobTile key={i} index={i} hot={hot === i} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// An XY performance pad over two Macro knobs (X = xIndex, Y = yIndex). Pure
// view/controller : it writes the same knob values a knob tile does, so the two
// knobs keep their destinations / bindings / CC / persistence. The handle reflects
// the LIVE (modulated) value. Configure the underlying knobs in knob mode.
function MetaXYPad({ xIndex, yIndex, hot }: { xIndex: number; yIndex: number; hot: boolean }): JSX.Element {
  const xName = useStore((s) => s.composition.metaKnobs[xIndex].name)
  const yName = useStore((s) => s.composition.metaKnobs[yIndex].name)
  const xSmooth = useStore((s) => s.composition.metaKnobs[xIndex].smoothMs)
  const ySmooth = useStore((s) => s.composition.metaKnobs[yIndex].smoothMs)
  const xDest = useStore((s) => s.composition.metaKnobs[xIndex].destinations.length)
  const yDest = useStore((s) => s.composition.metaKnobs[yIndex].destinations.length)

  const xKey = modTargetKey({ kind: 'meta', knob: xIndex } as const)
  const yKey = modTargetKey({ kind: 'meta', knob: yIndex } as const)
  const xMod = useStore(useShallow((s) => s.composition.modMatrix.some((a) => modTargetKey(a.target) === xKey)))
  const yMod = useStore(useShallow((s) => s.composition.modMatrix.some((a) => modTargetKey(a.target) === yKey)))
  const anyMod = xMod || yMod

  // Live position: the smoother's display value, painted at rAF while modulated.
  useSyncExternalStore(subscribeKnobDisplay, knobDisplayVersion)
  const [, setLiveTick] = useState(0)
  useEffect(() => {
    if (!anyMod) return
    let raf = 0
    const paint = (): void => { setLiveTick((n) => n + 1); raf = requestAnimationFrame(paint) }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [anyMod])
  const xVal = xMod ? (metaLiveValues.get(xIndex) ?? knobDisplayValue(xIndex)) : knobDisplayValue(xIndex)
  const yVal = yMod ? (metaLiveValues.get(yIndex) ?? knobDisplayValue(yIndex)) : knobDisplayValue(yIndex)

  const surfRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<number | null>(null)
  useEffect(() => () => { if (dragRef.current !== null) document.body.style.cursor = '' }, [])

  function setFromPointer(e: ReactPointerEvent<HTMLDivElement>): void {
    const el = surfRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)) // up = 1
    setKnobImmediate(xIndex, x)
    setKnobImmediate(yIndex, y)
  }
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = e.pointerId
    document.body.style.cursor = 'none'
    setFromPointer(e) // absolute : the dot jumps to the press point (pad idiom)
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    if (dragRef.current !== e.pointerId) return
    setFromPointer(e)
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>): void {
    if (dragRef.current !== e.pointerId) return
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    commitKnob(xIndex); commitKnob(yIndex) // one undo checkpoint per gesture
    dragRef.current = null
    document.body.style.cursor = ''
  }

  const dotColor = anyMod ? 'rgb(var(--c-accent2))' : 'rgb(var(--c-accent))'
  const highlight = xDest > 0 || yDest > 0 || anyMod

  return (
    <div
      className={`flex min-w-0 flex-col items-center gap-1 rounded border p-1.5 transition-colors ${
        highlight ? 'border-accent/40 bg-panel2' : 'border-border bg-panel2/40'
      } ${hot ? 'ring-1 ring-accent' : ''}`}
      style={{ gridColumn: 'span 2' }}
    >
      <div
        ref={surfRef}
        className="relative mx-auto w-full cursor-crosshair rounded border border-border bg-panel"
        style={{ maxWidth: 96, aspectRatio: '1 / 1', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => { setKnobTarget(xIndex, 0.5, xSmooth); setKnobTarget(yIndex, 0.5, ySmooth) }}
        title={`XY pad · X = ${xName} · Y = ${yName} · click/drag to move · double-click recenters`}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border/50" />
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-border/50" />
        </div>
        <div
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel"
          style={{ left: `${xVal * 100}%`, top: `${(1 - yVal) * 100}%`, backgroundColor: dotColor }}
        />
      </div>
      <div className="flex w-full items-center justify-between gap-1 font-mono text-[9px] leading-none text-muted">
        <span className="min-w-0 truncate" title={`X : ${xName}`}>X·{xName}</span>
        <span className="min-w-0 truncate text-right" title={`Y : ${yName}`}>{yName}·Y</span>
      </div>
    </div>
  )
}

function MetaKnobTile({ index, hot }: { index: number; hot: boolean }): JSX.Element {
  const knob = useStore((s) => s.composition.metaKnobs[index])
  const updateMetaKnob = useStore((s) => s.updateMetaKnob)
  const midiLearn = useStore((s) => s.midiLearn)
  const setMidiLearn = useStore((s) => s.setMidiLearn)
  const [renaming, setRenaming] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)

  // Which modulators drive this knob (target kind 'meta').
  const target = { kind: 'meta', knob: index } as const
  const targetKey = modTargetKey(target)
  // useShallow so all 16 always-mounted knob tiles don't re-render on every
  // store mutation (this selector builds a fresh array each call).
  const bound = useStore(
    useShallow((s) =>
      s.composition.modMatrix.filter((a) => modTargetKey(a.target) === targetKey)
    )
  )
  const isModulated = bound.length > 0

  // Dial position: the smoother's display value; while modulated, the live
  // modulated position (painted at rAF rate through local state : only
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

  // Restore the app-wide cursor if this tile unmounts mid-drag (it hides the
  // cursor on pointer-down and only restores on pointer-up/cancel otherwise).
  useEffect(() => () => { if (dragRef.current) document.body.style.cursor = '' }, [])

  // The capture goes on the dial's own box, never on what was pressed : the
  // value arc leaves the DOM at 0, and a capture on it went with it (the drag
  // then stuck to the mouse, with the app's cursor hidden).
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startValue: knobDisplayValue(index), pointerId: e.pointerId }
    document.body.style.cursor = 'none'
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const dy = d.startY - e.clientY
    const sensitivity = e.shiftKey ? 4 : 1
    const next = Math.max(0, Math.min(1, d.startValue + dy / (DRAG_PIXELS_FOR_FULL_RANGE * sensitivity)))
    // Direct 1:1 tracking : no tween lag (the pointer is the smoothing).
    setKnobImmediate(index, next)
  }
  function endDrag(): void {
    commitKnob(index) // one undo checkpoint per gesture
    dragRef.current = null
    document.body.style.cursor = ''
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    endDrag()
  }
  // The capture lost some other way (the release landed nowhere) : the drag ends.
  function onLostCapture(e: ReactPointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId === e.pointerId) endDrag()
  }

  // Dial geometry : min at 7:30, max at 4:30 (LaunchControl orientation).
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
    <PinZone pin={targetKey} label={`Macro ${index + 1} (${knob.name})`}>
    <div
      className={`flex min-w-0 flex-col items-center gap-1 rounded border p-1.5 transition-colors ${
        knob.destinations.length > 0 || isModulated
          ? 'border-accent/40 bg-panel2'
          : 'border-border bg-panel2/40'
      } ${hot ? 'ring-1 ring-accent' : ''}`}
    >
      <div
        className="relative cursor-pointer"
        style={{ width: KNOB_PX, height: KNOB_PX, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onLostCapture}
        onDoubleClick={() => setKnobTarget(index, 0, knob.smoothMs)}
        title={`${knob.name} : drag vertically · Shift = fine · double-click resets. The number is what it sends now, through its curve (${knob.curve}) and its range (${(knob.min ?? 0).toFixed(2)} to ${(knob.max ?? 1).toFixed(2)}).`}
      >
        <MidiLearnOverlay id={`meta:${index}`} />
        {/* What the knob sends now, through its curve : live (a drag, a glide,
            MIDI, a modulator), in the gap at the bottom of the arc. */}
        <span
          className={`pointer-events-none absolute inset-x-0 text-center font-mono text-[9px] leading-none tabular-nums ${isModulated ? 'text-accent2' : 'text-muted'}`}
          style={{ top: KNOB_PX - 9 }}
        >
          {knobOut(knob, display).toFixed(2)}
        </span>
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

      {/* destinations count : what this knob drives */}
      <span className="font-mono text-[9px] leading-none text-muted">
        {knob.destinations.length > 0 ? `${knob.destinations.length} dest` : 'no dest'}
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
          title={`${knob.name} : double-click to rename`}
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

      {/* after the curve, its range : the order the value takes */}
      <KnobRange index={index} lo={knob.min ?? 0} hi={knob.max ?? 1} modulated={isModulated} />

      <div className="flex w-full items-center justify-center gap-1">
        <button
          onClick={() => {
            if (learning) setMidiLearn(null)
            else if (knob.midiCc) updateMetaKnob(index, { midiCc: null })
            else setMidiLearn(index)
          }}
          className={`flex-1 rounded border px-1 py-px font-mono text-[9px] leading-none transition-colors ${
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
                ? `CC${knob.midiCc.number} ch${knob.midiCc.channel + 1} : click to clear`
                : 'MIDI learn'
          }
        >
          {learning ? '···' : knob.midiCc ? `CC${knob.midiCc.number}` : 'CC'}
        </button>
        <button
          onClick={() => setAssignOpen((o) => !o)}
          className={`flex-1 rounded px-1 py-px font-mono text-[9px] leading-none transition-colors ${
            isModulated
              ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2'
              : 'bg-panel3/60 text-muted hover:text-text'
          }`}
          title="Bind a modulator to this knob"
        >
          M{isModulated ? bound.map((b) => b.mod + 1).join('') : ''}
        </button>
      </div>

      {assignOpen && <KnobModAssign index={index} bound={bound} />}
    </div>
    </PinZone>
  )
}

// Compact single-modulator assignment for a Macro knob: two rows of four
// modulator buttons (only ONE can drive a knob at a time) plus a full-width
// depth slider. No "mod"/"macro" text labels : the tiles are narrow.
function KnobModAssign({
  index,
  bound
}: {
  index: number
  bound: Array<{ id: string; mod: number; depth: number }>
}): JSX.Element {
  const assignMod = useStore((s) => s.assignMod)
  const removeAssignment = useStore((s) => s.removeAssignment)
  const setAssignmentDepth = useStore((s) => s.setAssignmentDepth)
  const target = { kind: 'meta', knob: index } as const
  // One modulator per knob : bound[0] is the current driver, if any.
  const current = bound[0]

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="grid grid-cols-4 gap-0.5">
        {Array.from({ length: 8 }, (_, i) => {
          const active = current?.mod === i
          return (
            <button
              key={i}
              onClick={() => {
                // Single-select: clear whatever drives this knob, then bind the
                // clicked modulator (unless it was already the active one).
                const keepDepth = current?.depth ?? 0.5
                bound.forEach((b) => removeAssignment(b.id))
                if (!active && !assignMod(i, target, keepDepth)) warnModMatrixFull()
              }}
              className={`rounded py-0.5 font-mono text-[9px] transition-colors ${
                active
                  ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2'
                  : 'bg-panel3/60 text-muted hover:text-text'
              }`}
              title={active ? `Unbind M${i + 1}` : `Bind M${i + 1} (replaces current)`}
            >
              {i + 1}
            </button>
          )
        })}
      </div>
      {current && (
        <input
          type="range"
          min={-10}
          max={10}
          step={0.05}
          value={current.depth}
          onChange={(e) => setAssignmentDepth(current.id, Number(e.target.value))}
          onDoubleClick={() => setAssignmentDepth(current.id, 0.5)}
          className="w-full accent-accent2"
          title={`M${current.mod + 1} depth ${current.depth.toFixed(2)} : bipolar swing around the base. Double-click : 0.5`}
        />
      )}
    </div>
  )
}

// The title row's capsules : one per destination, knob by knob (like the
// Modulation row's chips). × takes the destination off its knob; the pointer on
// a capsule lights its knob up.
function MacroDests({ onHot }: { onHot: (k: number | null) => void }): JSX.Element {
  const composition = useStore((s) => s.composition)
  const toggleMetaDest = useStore((s) => s.toggleMetaDest)
  const chips = composition.metaKnobs.flatMap((k, i) => k.destinations.map((d) => ({ i, d, k })))
  // (the capsule under the pointer can go : its knob must not stay lit)
  useEffect(() => () => onHot(null), [onHot])
  if (!chips.length) {
    return (
      <div className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted/60">
        no destinations yet : a control&apos;s M puts it on a knob
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" onPointerLeave={() => onHot(null)}>
      {chips.map(({ i, d, k }) => {
        const what = describeModTarget(d, composition)
        const named = k.name !== `Knob ${i + 1}` ? ` (${k.name})` : ''
        const ranged = (k.min ?? 0) !== 0 || (k.max ?? 1) !== 1
        return (
          <span
            key={`${i}:${modTargetKey(d)}`}
            onPointerEnter={() => onHot(i)}
            className="flex items-center gap-1 rounded border border-border bg-panel2 px-1.5 py-0.5 font-mono text-[9px] hover:border-accent/50"
            title={`Knob ${i + 1}${named} drives ${what}${ranged ? ` over ${(k.min ?? 0).toFixed(2)} to ${(k.max ?? 1).toFixed(2)} of its range` : ''}`}
          >
            <span className="text-accent">K{i + 1}</span>
            <span className="max-w-[160px] truncate text-muted">{what}</span>
            <button
              onClick={() => toggleMetaDest(i, d)}
              className="text-muted hover:text-danger"
              title={`Take ${what} off knob ${i + 1}`}
            >
              ×
            </button>
          </span>
        )
      })}
    </div>
  )
}

// A knob's range : where a full turn lands, 0..1 of each destination's own
// range. A bar with its two ends (drag the nearer one; double-click : the full
// range) and the two numbers under it. Min above max turns the knob the other
// way. The destinations follow at once, the knob at rest or not.
function KnobRange({ index, lo, hi, modulated }: { index: number; lo: number; hi: number; modulated: boolean }): JSX.Element {
  const updateMetaKnob = useStore((s) => s.updateMetaKnob)
  const barRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: number; end: 'min' | 'max' } | null>(null)
  const round = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 100) / 100
  // A new end : the destinations move now. At rest, through the knob's own
  // overlay (as a drag of the dial would); a modulator already rewrites them
  // every frame, and an overlay would hold it still.
  function setEnd(end: 'min' | 'max', v: number): void {
    updateMetaKnob(index, { [end]: round(v) })
    if (!modulated) setKnobImmediate(index, knobDisplayValue(index))
  }
  function at(e: ReactPointerEvent<HTMLDivElement>): number {
    const r = barRef.current!.getBoundingClientRect() // (CSS zoom : the rect, never dpr)
    return (e.clientX - r.left) / Math.max(1, r.width)
  }
  function onDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    const x = at(e)
    const dl = Math.abs(x - lo), dh = Math.abs(x - hi)
    const end = dl < dh || (dl === dh && x < lo) ? 'min' : 'max'
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, end }
    setEnd(end, x)
  }
  function onMove(e: ReactPointerEvent<HTMLDivElement>): void {
    if (drag.current?.id !== e.pointerId) return
    setEnd(drag.current.end, at(e))
  }
  function onUp(e: ReactPointerEvent<HTMLDivElement>): void {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    commitKnob(index) // (the destinations' values settle in the session, one undo step)
  }
  const a = Math.min(lo, hi), b = Math.max(lo, hi)
  const flipped = lo > hi
  const full = lo === 0 && hi === 1 // (the default : quiet, so a set range stands out)
  const help = `Range : where a full turn of the knob lands, ${lo.toFixed(2)} to ${hi.toFixed(2)} of each destination's own range${flipped ? ' (min above max : it turns the other way)' : ''}. Drag an end · double-click : the full range.`
  return (
    <div className="flex w-full flex-col gap-0.5">
      <div
        ref={barRef}
        className="relative h-2.5 w-full cursor-ew-resize rounded-sm bg-panel3"
        style={{ touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => { updateMetaKnob(index, { min: undefined, max: undefined }); commitKnob(index) }}
        title={help}
      >
        <div
          className={`pointer-events-none absolute inset-y-0 rounded-sm ${full ? 'bg-accent/15' : flipped ? 'bg-accent/35' : 'bg-accent/60'}`}
          style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }}
        />
        {[lo, hi].map((v, n) => (
          <div
            key={n}
            className={`pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full ${full ? 'bg-muted/60' : 'bg-text'}`}
            style={{ left: `${v * 100}%` }}
          />
        ))}
      </div>
      <div className="flex w-full items-center gap-0.5">
        <BoundedNumberInput
          value={lo}
          min={0}
          max={1}
          maxFrac={2}
          fixedWidth
          className="input w-1/2 min-w-0 px-0.5 py-0 text-center text-[9px]"
          onCommit={(v) => { updateMetaKnob(index, { min: round(v) }); commitKnob(index) }}
          title={`Min : what the knob sends at its bottom, through its curve (0..1 of each destination's range). ${flipped ? 'Above max : the knob turns the other way.' : ''}`}
        />
        <BoundedNumberInput
          value={hi}
          min={0}
          max={1}
          maxFrac={2}
          fixedWidth
          className="input w-1/2 min-w-0 px-0.5 py-0 text-center text-[9px]"
          onCommit={(v) => { updateMetaKnob(index, { max: round(v) }); commitKnob(index) }}
          title="Max : what the knob sends at its top, through its curve (0..1 of each destination's range)."
        />
      </div>
    </div>
  )
}
