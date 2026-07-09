// AutoControls — themed controls generated from ISF INPUTS (brief §10.3).
// The dataFLOU Pool→auto-UI pattern applied to ISF: float→slider+number,
// bool→toggle, long→dropdown, color→swatch+alpha, point2D→XY pad, honouring
// each input's declared range and default. This is the simplexité payoff:
// the shader header IS the control surface.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import type { ModMode, ModTarget } from '@shared/types'
import type { IsfInputDesc } from '../shaders/isf/inputs'
import { registerLiveOverlay } from './liveOverlay'
import { useShallow } from 'zustand/react/shallow'
import { modTargetKey, useStore } from '../store'
import { BoundedNumberInput } from './BoundedNumberInput'

// When an ancestor (the Inspector) provides `onAssign`, clicking an M button
// opens the mod-assign in the Inspector's side panel instead of the little
// floating popover. `activeKey` highlights the M whose panel is open. Providers
// that don't set onAssign (Finishing view, dense stacks) keep the popover.
type BoundAssignment = { id: string; mod: number; depth: number; mode?: ModMode }
interface AssignCtx {
  onAssign?: (target: ModTarget, label: string) => void
  activeKey?: string | null
}
export const AssignContext = createContext<AssignCtx>({})

/** Assignments bound to one target (any modulator). useShallow so this
 *  fresh-array selector doesn't re-render every control on every store write. */
function useBound(targetKey: string | null): BoundAssignment[] {
  return useStore(
    useShallow((s) =>
      targetKey ? s.composition.modMatrix.filter((a) => modTargetKey(a.target) === targetKey) : []
    )
  )
}

// The M pill. In Inspector context it toggles the side panel; elsewhere it opens
// the legacy anchored popover. Highlights when bound OR when its panel is active.
function ModButton({
  target,
  bound,
  label
}: {
  target: ModTarget
  bound: BoundAssignment[]
  label: string
}): JSX.Element {
  const { onAssign, activeKey } = useContext(AssignContext)
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const key = modTargetKey(target)
  useEffect(() => setOpen(false), [key])
  const isBound = bound.length > 0
  const active = activeKey === key
  // Right-click = kill switch: clear EVERY modulation on this parameter —
  // all direct M1–8 bindings and every Meta knob carrying it as a destination.
  function clearAll(): void {
    const st = useStore.getState()
    for (const b of bound) st.removeAssignment(b.id)
    st.composition.metaKnobs.forEach((k, i) => {
      if (k.destinations.some((d) => modTargetKey(d) === key)) st.toggleMetaDest(i, target)
    })
  }
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (onAssign ? onAssign(target, label) : setOpen((o) => !o))}
        onContextMenu={(e) => {
          e.preventDefault()
          clearAll()
        }}
        className={`shrink-0 rounded px-1 font-mono text-[9px] leading-4 transition-colors ${
          isBound
            ? 'bg-accent/20 text-accent ring-1 ring-accent'
            : active
              ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2'
              : open
                ? 'bg-panel3 text-text'
                : 'bg-panel3/60 text-muted hover:text-text'
        }`}
        title={`Modulate ${label} — right-click clears all its modulation`}
      >
        M{isBound ? bound.map((b) => b.mod + 1).join('') : ''}
      </button>
      {!onAssign && open && (
        <AssignPopover target={target} bound={bound} anchor={btnRef} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

type Value = number | number[]

export function AutoControls({
  inputs,
  values,
  onChange,
  modTargetFor,
  layout = 'wrap'
}: {
  inputs: IsfInputDesc[]
  values: Record<string, Value>
  onChange: (name: string, value: Value) => void
  // When provided, float controls grow an "M" button that binds a modulator
  // to this input (the capped mod-matrix, brief §6).
  modTargetFor?: (inputName: string) => ModTarget
  // 'wrap' (default): flex-wrap, height follows param count.
  // 'twoRow': a fixed two-row grid that fills top→bottom then flows into new
  //   columns, overflowing horizontally — the Inspector's shape never changes.
  // 'vertical': one full-width control per row, stacked — for narrow tall panels
  //   (the Finishing Touches finalizers).
  layout?: 'wrap' | 'twoRow' | 'vertical'
}): JSX.Element {
  if (inputs.length === 0) {
    return <div className="p-2 text-[11px] text-muted">This shader exposes no controls.</div>
  }
  // posX + posY collapse into one "POS" cell with the two sliders side by side.
  const hasPosPair =
    inputs.some((i) => i.name === 'posX') && inputs.some((i) => i.name === 'posY')
  const visible = (arr: IsfInputDesc[]): IsfInputDesc[] =>
    hasPosPair ? arr.filter((i) => i.name !== 'posY') : arr
  const renderControl = (inp: IsfInputDesc, dense = false): JSX.Element =>
    hasPosPair && inp.name === 'posX' ? (
      <PosPairControl key="pos" inputs={inputs} values={values} onChange={onChange} />
    ) : (
      <Control
        key={inp.name}
        inp={inp}
        value={values[inp.name]}
        onChange={onChange}
        modTargetFor={modTargetFor}
        dense={dense}
      />
    )
  if (layout === 'vertical') {
    // Full-width controls stacked, one dense single-line row each (label · slider
    // · M · number) — `[&>*]:w-full` overrides each control's fixed w-44.
    return (
      <div className="flex flex-col gap-0.5 px-2 py-1 [&>*]:w-full">
        {visible(inputs).map((inp) => renderControl(inp, true))}
      </div>
    )
  }
  if (layout === 'twoRow') {
    // XY pads (point2D) are tall — flowing them through the two-row grid
    // leaves a ragged column and dead space. Pull them out and stand them to
    // the RIGHT of the scalar controls, vertically centred.
    const pads = inputs.filter((i) => i.type === 'point2D')
    // COMPACT-flagged inputs (small toggles / tiny enums) stack together into
    // ONE cluster cell instead of a full cell each — tighter panels, no scroll.
    const compact = inputs.filter((i) => i.type !== 'point2D' && i.compact)
    const rest = inputs.filter((i) => i.type !== 'point2D' && !i.compact)
    const compactCell =
      compact.length > 0 ? (
        <CompactCluster key="compact" inputs={compact} values={values} onChange={onChange} />
      ) : null
    // Too few controls to justify two rows → lay them in a single row and
    // centre the whole group (both axes) instead of a sparse, top-left grid.
    const singleRow = rest.length + (compactCell ? 1 : 0) <= 4
    return (
      <div className={`flex h-full items-center gap-5 p-2 ${singleRow ? 'justify-center' : ''}`}>
        {singleRow ? (
          <div className="flex items-center gap-5">
            {visible(rest).map((inp) => renderControl(inp))}
            {compactCell}
          </div>
        ) : (
          <div
            className="grid grid-flow-col content-start gap-x-5 gap-y-2"
            style={{ gridTemplateRows: 'repeat(2, min-content)', gridAutoColumns: '11rem' }}
          >
            {visible(rest).map((inp) => renderControl(inp))}
            {compactCell}
          </div>
        )}
        {pads.length > 0 && (
          <div className="flex shrink-0 items-center gap-5">
            {pads.map((inp) => (
              <Control
                key={inp.name}
                inp={inp}
                value={values[inp.name]}
                onChange={onChange}
                modTargetFor={modTargetFor}
              />
            ))}
          </div>
        )}
      </div>
    )
  }
  // 'wrap' — items-start so every control's label sits on the same top line
  // (colours, sliders and enums have different heights; aligning tops keeps the
  // label row straight).
  return (
    <div className="flex flex-wrap items-start gap-x-5 gap-y-2 p-2">
      {visible(inputs).map((inp) => renderControl(inp))}
    </div>
  )
}

// posX + posY as two sliders on ONE line (a compact stand-in for an XY pad).
function PosPairControl({
  inputs,
  values,
  onChange
}: {
  inputs: IsfInputDesc[]
  values: Record<string, Value>
  onChange: (name: string, value: Value) => void
}): JSX.Element {
  const dx = inputs.find((i) => i.name === 'posX')
  const dy = inputs.find((i) => i.name === 'posY')
  const rng = (d?: IsfInputDesc): [number, number, number] => {
    const mn = typeof d?.min === 'number' ? d.min : -1
    const mx = typeof d?.max === 'number' ? d.max : 1
    const df = typeof d?.def === 'number' ? d.def : 0
    return [mn, mx, df]
  }
  const [minx, maxx, defx] = rng(dx)
  const [miny, maxy, defy] = rng(dy)
  const vx = typeof values.posX === 'number' ? values.posX : defx
  const vy = typeof values.posY === 'number' ? values.posY : defy
  // One row per axis: label · slider · number box (editable, like every float).
  const axis = (
    label: string,
    v: number,
    min: number,
    max: number,
    def: number,
    name: string
  ): JSX.Element => (
    <div className="flex min-w-0 items-center gap-1">
      <span className="w-3 shrink-0 font-mono text-[9px] text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={(max - min) / 200 || 0.01}
        value={v}
        onChange={(e) => onChange(name, Number(e.target.value))}
        onDoubleClick={() => onChange(name, def)}
        className="min-w-0 flex-1 accent-accent"
        title={`${name} ${v.toFixed(2)} — double-click to reset`}
      />
      <div className="w-12 shrink-0">
        <BoundedNumberInput
          value={v}
          min={min}
          max={max}
          onChange={(n) => onChange(name, n)}
          className="input w-full px-1 py-0.5 text-right text-[11px]"
        />
      </div>
    </div>
  )
  return (
    <div className="flex w-44 min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-wide text-muted">pos</span>
      {axis('X', vx, minx, maxx, defx, 'posX')}
      {axis('Y', vy, miny, maxy, defy, 'posY')}
    </div>
  )
}

function Control({
  inp,
  value,
  onChange,
  modTargetFor,
  dense = false
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
  modTargetFor?: (inputName: string) => ModTarget
  dense?: boolean
}): JSX.Element | null {
  switch (inp.type) {
    case 'float':
      return <FloatControl inp={inp} value={value} onChange={onChange} modTargetFor={modTargetFor} dense={dense} />
    case 'bool':
    case 'event':
      return <BoolControl inp={inp} value={value} onChange={onChange} modTargetFor={modTargetFor} />
    case 'long':
      return <EnumControl inp={inp} value={value} onChange={onChange} modTargetFor={modTargetFor} />
    case 'color':
      return <ColorControl inp={inp} value={value} onChange={onChange} />
    case 'point2D':
      return <XYControl inp={inp} value={value} onChange={onChange} />
    default:
      return null
  }
}

function labelEl(inp: IsfInputDesc): JSX.Element {
  return (
    <span className="font-mono text-[9px] uppercase tracking-wide text-muted" title={inp.hint ?? inp.name}>
      {inp.label}
    </span>
  )
}

// ── float → slider + number (+ optional mod-assign) ──────────────────
function FloatControl({
  inp,
  value,
  onChange,
  modTargetFor,
  dense = false
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
  modTargetFor?: (inputName: string) => ModTarget
  dense?: boolean
}): JSX.Element {
  const min = typeof inp.min === 'number' ? inp.min : 0
  const max = typeof inp.max === 'number' ? inp.max : 1
  const def = typeof inp.def === 'number' ? inp.def : min
  const v = typeof value === 'number' ? value : def
  const step = (max - min) / 200 || 0.005
  const target = modTargetFor?.(inp.name)
  const targetKey = target ? modTargetKey(target) : null
  const bound = useBound(targetKey)
  const isModulated = bound.length > 0

  // Modulated sliders MOVE with the live value (dataFLOU behaviour): one rAF
  // writes the thumb position straight to the DOM — React keeps rendering the
  // BASE value; the live overlay never causes re-renders. Paused while the
  // user is dragging this slider.
  const sliderRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const el = sliderRef.current
    if (!isModulated || !targetKey || !el) return
    return registerLiveOverlay({ el, key: targetKey, format: (x) => String(x) })
  }, [isModulated, targetKey])

  // Dense single-line layout (Finishing view): label · slider · M · number,
  // all on one row so the stack takes minimal vertical space.
  if (dense) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="w-20 shrink-0 truncate font-mono text-[9px] uppercase tracking-wide text-muted"
            title={inp.hint ?? inp.label}
          >
            {inp.label}
          </span>
          <input
            ref={sliderRef}
            type="range"
            min={min}
            max={max}
            step={step}
            value={v}
            onChange={(e) => onChange(inp.name, Number(e.target.value))}
            onDoubleClick={() => onChange(inp.name, def)}
            className={`min-w-0 flex-1 ${isModulated ? 'accent-accent2' : 'accent-accent'}`}
            title={
              (inp.hint ? inp.hint + ' · ' : '') +
              (isModulated
                ? `${inp.label} — modulated (drag sets the base)`
                : `${inp.label} — double-click to reset (${def})`)
            }
          />
          {target && <ModButton target={target} bound={bound} label={inp.label} />}
          <div className="w-12 shrink-0">
            <BoundedNumberInput
              value={v}
              min={min}
              max={max}
              onChange={(n) => onChange(inp.name, n)}
              liveKey={isModulated ? (targetKey ?? undefined) : undefined}
              className="input w-full px-1 py-0.5 text-right text-[11px]"
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-44 min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        {labelEl(inp)}
        <div className="flex shrink-0 items-center gap-1">
          {target && <ModButton target={target} bound={bound} label={inp.label} />}
          <div className="w-14">
            <BoundedNumberInput
              value={v}
              min={min}
              max={max}
              onChange={(n) => onChange(inp.name, n)}
              liveKey={isModulated ? (targetKey ?? undefined) : undefined}
              className="input w-full px-1 py-0.5 text-right text-[11px]"
            />
          </div>
        </div>
      </div>
      <input
        ref={sliderRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => onChange(inp.name, Number(e.target.value))}
        onDoubleClick={() => onChange(inp.name, def)}
        className={`min-w-0 ${isModulated ? 'accent-accent2' : 'accent-accent'}`}
        title={
          (inp.hint ? inp.hint + ' · ' : '') +
          (isModulated
            ? `${inp.label} — modulated (moving with the live value; drag sets the base)`
            : `${inp.label} — double-click to reset (${def})`)
        }
      />
    </div>
  )
}

// The binding row as a FIXED-position popover anchored to the M button — the
// Inspector band is `overflow-y-hidden` with a fixed height, so an inline panel
// would be clipped and would shove its sibling controls. Fixed positioning
// escapes the clip and leaves the row untouched.
function AssignPopover({
  target,
  bound,
  anchor,
  onClose
}: {
  target: ModTarget
  bound: Array<{ id: string; mod: number; depth: number }>
  anchor: RefObject<HTMLElement>
  onClose: () => void
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const W = 236
  const place = useCallback((): void => {
    const r = anchor.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: Math.max(6, Math.min(r.left, window.innerWidth - W - 6)) })
  }, [anchor])
  useLayoutEffect(() => place(), [place])
  // Follow the anchor when the Inspector scrolls or the window resizes (the
  // popover is position:fixed, so it would otherwise detach from the button).
  useEffect(() => {
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [place])
  useEffect(() => {
    const h = (e: MouseEvent): void => {
      if (ref.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [anchor, onClose])
  if (!pos) return null
  return (
    <div ref={ref} style={{ position: 'fixed', top: pos.top, left: pos.left, width: W, zIndex: 60 }}>
      <AssignRow target={target} bound={bound} />
    </div>
  )
}

// Inline binding row: modulators M1–8 (with depth) and Meta knobs K1–K16.
// Exported — MetaBar reuses it for binding modulators TO knobs (hideMeta).
export function AssignRow({
  target,
  bound,
  hideMeta = false
}: {
  target: ModTarget
  bound: Array<{ id: string; mod: number; depth: number; mode?: ModMode }>
  hideMeta?: boolean
}): JSX.Element {
  const assignMod = useStore((s) => s.assignMod)
  const removeAssignment = useStore((s) => s.removeAssignment)
  const setAssignmentDepth = useStore((s) => s.setAssignmentDepth)
  const setAssignmentMode = useStore((s) => s.setAssignmentMode)
  const toggleMetaDest = useStore((s) => s.toggleMetaDest)
  const targetKey = modTargetKey(target)
  // Which Meta knobs already carry this input as a destination. useShallow so
  // this fresh boolean-array selector doesn't re-render on every store change.
  const metaBound = useStore(
    useShallow((s) =>
      s.composition.metaKnobs.map((k) =>
        k.destinations.some((d) => modTargetKey(d) === targetKey)
      )
    )
  )
  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-panel2/60 p-1">
      <div className="flex min-w-0 items-center gap-1">
        <span className="w-8 shrink-0 font-mono text-[8px] uppercase text-muted">mod</span>
        {/* Buttons share the row's width evenly so the panel stays inside its
            margins at ANY width (main side panel, popover, Finishing column). */}
        <div className="flex min-w-0 flex-1 gap-0.5">
          {Array.from({ length: 8 }, (_, i) => {
            const existing = bound.find((b) => b.mod === i)
            return (
              <button
                key={i}
                onClick={() => {
                  if (existing) removeAssignment(existing.id)
                  else if (!assignMod(i, target, 0.5)) {
                    // Cap reached — the matrix stays legible by design.
                  }
                }}
                className={`min-w-0 flex-1 rounded px-0.5 py-0.5 font-mono text-[9px] transition-colors ${
                  existing
                    ? 'bg-accent/25 text-accent ring-1 ring-accent'
                    : 'bg-panel3/60 text-muted hover:text-text'
                }`}
                title={existing ? `Unbind M${i + 1}` : `Bind M${i + 1}`}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
      </div>
      {bound.map((b) => {
        const mode: ModMode = b.mode ?? 'replace'
        const mult = mode === 'multiply'
        return (
          <div key={b.id} className="flex items-center gap-1">
            <span className="w-8 shrink-0 font-mono text-[9px] text-accent">M{b.mod + 1}</span>
            {/* Mode: Multiply (scale the base — default) ↔ Replace (swing over it). */}
            <button
              onClick={() => setAssignmentMode(b.id, mult ? 'replace' : 'multiply')}
              className={`shrink-0 rounded px-1 py-0.5 font-mono text-[8px] uppercase transition-colors ${
                mult
                  ? 'bg-accent/20 text-accent ring-1 ring-accent'
                  : 'bg-accent2/20 text-accent2 ring-1 ring-accent2'
              }`}
              title={
                mult
                  ? 'Multiply — the modulator scales the base value (|depth| = amount). Click for Replace.'
                  : 'Replace — the modulator swings the value around the base. Click for Multiply.'
              }
            >
              {mult ? 'mul' : 'rep'}
            </button>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={b.depth}
              onChange={(e) => setAssignmentDepth(b.id, Number(e.target.value))}
              className={`min-w-0 flex-1 ${mult ? 'accent-accent' : 'accent-accent2'}`}
              title={
                mult
                  ? `Amount ${b.depth.toFixed(2)} — how deeply the modulator scales the base (− inverts)`
                  : `Depth ${b.depth.toFixed(2)} — bipolar swing around the base value`
              }
            />
          </div>
        )
      })}
      {/* Meta knobs — K1..K16; a knob drives this input absolutely through
          its curve over the input's declared range (up to 8 dests/knob).
          EXACTLY two rows, row-major: K1–K9 then K10–K16 (with the MOD line
          above, the whole panel is the fixed three-row shape). */}
      {!hideMeta && (
        <div className="flex min-w-0 items-start gap-1">
          <span className="w-8 shrink-0 pt-0.5 font-mono text-[8px] uppercase text-muted">meta</span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {[metaBound.slice(0, 9), metaBound.slice(9)].map((row, r) => (
              <div key={r} className="flex min-w-0 gap-0.5">
                {row.map((on, j) => {
                  const i = r * 9 + j
                  return (
                    <button
                      key={i}
                      onClick={() => toggleMetaDest(i, target)}
                      className={`min-w-0 flex-1 rounded px-0.5 py-0.5 font-mono text-[8px] transition-colors ${
                        on
                          ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2'
                          : 'bg-panel3/60 text-muted hover:text-text'
                      }`}
                      title={`${on ? 'Unbind' : 'Bind'} Meta knob ${i + 1}`}
                    >
                      K{i + 1}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── COMPACT cluster — small toggles / tiny enums stacked in one cell ──
// Inputs flagged "COMPACT": true land here: label left, a tiny control right,
// one line each. Keeps utility switches (invert · bidir · flow res) from
// spending a full grid cell apiece.
function CompactCluster({
  inputs,
  values,
  onChange
}: {
  inputs: IsfInputDesc[]
  values: Record<string, Value>
  onChange: (name: string, value: Value) => void
}): JSX.Element {
  return (
    <div className="flex w-44 min-w-0 flex-col gap-1">
      {inputs.map((inp) => {
        const def = typeof inp.def === 'number' ? inp.def : 0
        const raw = values[inp.name]
        const v = typeof raw === 'number' ? raw : def
        if (inp.type === 'long') {
          return (
            <div key={inp.name} className="flex items-center justify-between gap-2">
              {labelEl(inp)}
              <select
                className="input select-compact w-12 shrink-0 !px-1 !py-0 text-[10px]"
                value={v}
                onChange={(e) => onChange(inp.name, Number(e.target.value))}
                title={inp.label}
              >
                {(inp.values ?? []).map((val, i) => (
                  <option key={val} value={val}>
                    {inp.labels?.[i] ?? val}
                  </option>
                ))}
              </select>
            </div>
          )
        }
        const on = v >= 0.5
        return (
          <div key={inp.name} className="flex items-center justify-between gap-2">
            {labelEl(inp)}
            <button
              onClick={() => onChange(inp.name, on ? 0 : 1)}
              className={`shrink-0 rounded px-1.5 py-0 font-mono text-[9px] leading-4 transition-colors ${
                on ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
              }`}
              title={inp.label}
            >
              {on ? 'ON' : 'OFF'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// A label row with an optional M pill on the right (enum / bool controls).
function LabelRow({
  inp,
  modTargetFor
}: {
  inp: IsfInputDesc
  modTargetFor?: (inputName: string) => ModTarget
}): JSX.Element {
  const target = modTargetFor?.(inp.name)
  const bound = useBound(target ? modTargetKey(target) : null)
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      {labelEl(inp)}
      {target && <ModButton target={target} bound={bound} label={inp.label} />}
    </div>
  )
}

// ── bool → toggle chip (+ optional mod-assign) ───────────────────────
function BoolControl({
  inp,
  value,
  onChange,
  modTargetFor
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
  modTargetFor?: (inputName: string) => ModTarget
}): JSX.Element {
  const def = typeof inp.def === 'number' ? inp.def : 0
  const on = (typeof value === 'number' ? value : def) >= 0.5
  return (
    <div className="flex w-24 min-w-0 flex-col items-start gap-0.5">
      <LabelRow inp={inp} modTargetFor={modTargetFor} />
      <button
        onClick={() => onChange(inp.name, on ? 0 : 1)}
        className={`rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
          on ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
        }`}
      >
        {on ? 'ON' : 'OFF'}
      </button>
    </div>
  )
}

// ── long → dropdown (+ optional mod-assign) ──────────────────────────
function EnumControl({
  inp,
  value,
  onChange,
  modTargetFor
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
  modTargetFor?: (inputName: string) => ModTarget
}): JSX.Element {
  const def = typeof inp.def === 'number' ? inp.def : 0
  const v = typeof value === 'number' ? value : def
  const values = inp.values ?? []
  const labels = inp.labels ?? values.map(String)
  const target = modTargetFor?.(inp.name)
  const targetKey = target ? modTargetKey(target) : null
  const bound = useBound(targetKey)
  const isModulated = bound.length > 0
  // A modulated dropdown tracks the LIVE selection (the engine snaps enums to
  // declared values, so the live value always matches an <option>) and turns
  // accent2 like modulated sliders. React keeps rendering the BASE value; the
  // shared overlay repaints the DOM selection each rAF, skipped while focused.
  const selRef = useRef<HTMLSelectElement | null>(null)
  useEffect(() => {
    const el = selRef.current
    if (!isModulated || !targetKey || !el) return
    return registerLiveOverlay({ el, key: targetKey, format: (x) => String(Math.round(x)) })
  }, [isModulated, targetKey])
  return (
    <div className="flex w-44 min-w-0 flex-col gap-0.5">
      <LabelRow inp={inp} modTargetFor={modTargetFor} />
      <select
        ref={selRef}
        className={`input text-[11px] ${isModulated ? '!border-accent2 !text-accent2' : ''}`}
        value={v}
        onChange={(e) => onChange(inp.name, Number(e.target.value))}
        title={
          isModulated
            ? `${inp.label} — modulated (showing the live selection; picking sets the base)`
            : (inp.hint ?? inp.label)
        }
      >
        {values.map((val, i) => (
          <option key={val} value={val}>
            {labels[i] ?? val}
          </option>
        ))}
      </select>
    </div>
  )
}

// ── color → swatch + alpha ───────────────────────────────────────────
function toHex(c: number[]): string {
  const h = (x: number): string =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`
}

function fromHex(hex: string, alpha: number): number[] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return [r, g, b, alpha]
}

function ColorControl({
  inp,
  value,
  onChange
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
}): JSX.Element {
  const def = Array.isArray(inp.def) ? inp.def : [1, 1, 1, 1]
  const v = Array.isArray(value) && value.length >= 3 ? value : def
  const alpha = v[3] ?? 1
  return (
    <div className="flex w-44 min-w-0 flex-col gap-0.5">
      {labelEl(inp)}
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="color"
          value={toHex(v)}
          onChange={(e) => onChange(inp.name, fromHex(e.target.value, alpha))}
          className="h-6 w-9 shrink-0 cursor-pointer rounded border border-border bg-panel2"
          title={`${inp.label} — RGB`}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={alpha}
          onChange={(e) => onChange(inp.name, [v[0], v[1], v[2], Number(e.target.value)])}
          className="min-w-0 flex-1 accent-accent"
          title="Alpha"
        />
      </div>
    </div>
  )
}

// ── point2D → XY pad ─────────────────────────────────────────────────
export function XYControl({
  inp,
  value,
  onChange
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
}): JSX.Element {
  const min = Array.isArray(inp.min) ? inp.min : [0, 0]
  const max = Array.isArray(inp.max) ? inp.max : [1, 1]
  const def = Array.isArray(inp.def) ? inp.def : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2]
  const v = Array.isArray(value) && value.length >= 2 ? value : def
  const nx = (v[0] - min[0]) / (max[0] - min[0] || 1)
  const ny = (v[1] - min[1]) / (max[1] - min[1] || 1)
  const padRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)

  function setFromPointer(e: ReactPointerEvent): void {
    const el = padRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    // Screen y grows downward; ISF point space grows upward.
    const py = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))
    onChange(inp.name, [min[0] + px * (max[0] - min[0]), min[1] + py * (max[1] - min[1])])
  }

  return (
    <div className="flex flex-col gap-0.5">
      {labelEl(inp)}
      <div
        ref={padRef}
        className="relative h-20 w-20 cursor-crosshair rounded border border-border bg-panel2"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          dragging.current = true
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          setFromPointer(e)
        }}
        onPointerMove={(e) => {
          if (dragging.current) setFromPointer(e)
        }}
        onPointerUp={() => {
          dragging.current = false
        }}
        onDoubleClick={() => onChange(inp.name, def)}
        title={`${inp.label} — drag · double-click to reset`}
      >
        <div
          className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${nx * 100}%`, bottom: `${ny * 100}%` }}
        />
      </div>
    </div>
  )
}
