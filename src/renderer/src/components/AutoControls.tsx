// AutoControls : themed controls generated from ISF INPUTS (brief §10.3).
// The dataFLOU Pool→auto-UI pattern applied to ISF, honouring each input's
// declared range and default : since v1.3.2 every input is a BAR (Bar.tsx) :
// float → a filled bar, bool → a switch bar, long → segments (up to three
// choices) or a menu bar, color → a bar painted in it (+ its alpha), event → a
// button bar; point2D stays an XY pad. This is the simplexité payoff : the
// shader header IS the control surface.

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import type { ColorChannel, CompositionState, ModAssignment, ModMode, ModTarget } from '@shared/types'
import type { IsfInputDesc } from '../shaders/isf/inputs'
import { registerLiveOverlay } from './liveOverlay'
import { useShallow } from 'zustand/react/shallow'
import { isToggleTarget, modTargetKey, targetAlive, useStore } from '../store'
import { BoundedNumberInput } from './BoundedNumberInput'
import { showToast } from './Toast'
import { MAX_MOD_ASSIGNMENTS } from '@shared/types'
import { ModShapeEditor, ShapeToggle } from './ModShapeEditor'
import { PinZone } from './Pin'
import { partOf, withPartTarget } from '../modKey'
import { COLOR_PARTS, PART_WHERE, PART_WORD } from '../engine/colorParts'
import { liveColorValues } from '../engine/modulation'
import { AlphaCell, BarChip, BoolBar, ColorBar, DropBar, EventBar, FloatBar, SegBar, inkFor } from './Bar'

/** The modulation matrix is full : say so (a click that does nothing reads as
 *  broken), and how to make room. */
export function warnModMatrixFull(): void {
  showToast(
    `Modulation is full (${MAX_MOD_ASSIGNMENTS} of ${MAX_MOD_ASSIGNMENTS} bindings) : clear one to bind this (right-click an M to clear it, or see Modulate).`,
    'warn',
    6000
  )
}

// Clicking an M button opens the mod-assign in the provider's side panel (the
// Inspector, or the Finishing column) via `onAssign`. `activeKey` highlights the
// M whose panel is open.
type BoundAssignment = { id: string; mod: number; depth: number; mode?: ModMode }
interface AssignCtx {
  onAssign?: (target: ModTarget, label: string) => void
  activeKey?: string | null
}
export const AssignContext = createContext<AssignCtx>({})

/** Assignments bound to one target (any modulator). useShallow so this
 *  fresh-array selector doesn't re-render every control on every store write. */
export function useBound(targetKey: string | null): BoundAssignment[] {
  return useStore(
    useShallow((s) =>
      targetKey ? s.composition.modMatrix.filter((a) => modTargetKey(a.target) === targetKey) : []
    )
  )
}

// The M pill. Toggles the provider's mod-assign side panel. Highlights when
// bound OR when its panel is active.
export function ModButton({
  target,
  bound,
  label
}: {
  target: ModTarget
  bound: BoundAssignment[]
  label: string
}): JSX.Element {
  const { onAssign, activeKey } = useContext(AssignContext)
  const key = modTargetKey(target)
  const isBound = bound.length > 0
  const active = activeKey === key
  // Right-click = kill switch: clear EVERY modulation on this parameter :
  // all direct M1–8 bindings and every Meta knob carrying it as a destination.
  function clearAll(): void {
    const st = useStore.getState()
    for (const b of bound) st.removeAssignment(b.id)
    st.composition.metaKnobs.forEach((k, i) => {
      if (k.destinations.some((d) => modTargetKey(d) === key)) st.toggleMetaDest(i, target)
    })
  }
  return (
    <button
      onClick={() => onAssign?.(target, label)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation() // (the control's own menu, Persistent, is under it)
        clearAll()
      }}
      className={`shrink-0 rounded px-1 font-mono text-[9px] leading-4 transition-colors ${
        isBound
          ? 'bg-accent/20 text-accent ring-1 ring-accent'
          : active
            ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2'
            : 'bg-panel3/60 text-muted hover:text-text'
      }`}
      title={`Modulate ${label} : right-click clears all its modulation`}
    >
      M{isBound ? bound.map((b) => b.mod + 1).join('·') : ''}
    </button>
  )
}

type Value = number | number[]

export function AutoControls({
  inputs,
  values,
  onChange,
  modTargetFor,
  layout = 'wrap',
  dim,
  bare = false,
  rgbOnly = false,
  cols
}: {
  inputs: IsfInputDesc[]
  values: Record<string, Value>
  onChange: (name: string, value: Value) => void
  // Inputs to show greyed out (they do nothing right now),
  // name → the reason (first in the bar's tooltip).
  dim?: Record<string, string>
  // When provided, every bar grows its M chip, which binds a modulator to this
  // input (the capped mod-matrix, brief §6).
  modTargetFor?: (inputName: string) => ModTarget
  // 'wrap' (default) and 'twoRow' (the FX band; the name is history) : the bars
  // in a grid of equal columns, as many as the width holds, row by row (no
  // horizontal scroll), the XY pads standing at the right.
  // 'vertical' : a titled column (GroupedControls) or a Finishing section : the
  // bars in as many columns as ITS width holds (one in a column, two in the
  // Finishing column), in the order given.
  layout?: 'wrap' | 'twoRow' | 'vertical'
  // Vertical : no padding of its own (it sits in a column that has it).
  bare?: boolean
  // Vertical : exactly this many columns, filled top to bottom then left to
  // right (a group spread over two columns of a grouped panel still reads down).
  cols?: number
  // The shader reads its colors' RGB only (the Finishing stages) : a color bar
  // is its color and its hex value, no alpha doing nothing.
  rgbOnly?: boolean
}): JSX.Element {
  if (inputs.length === 0) {
    return <div className="p-2 text-[11px] text-muted">This shader exposes no controls.</div>
  }
  // Context's `lightOrder` bool renders as a small PRE/POST toggle inside the
  // light's glow bar instead of a bar of its own.
  const hasLightOrder =
    inputs.some((i) => i.name === 'lightOrder') && inputs.some((i) => i.name === 'lightGlow')
  const visible = (arr: IsfInputDesc[]): IsfInputDesc[] => arr.filter((i) => !(hasLightOrder && i.name === 'lightOrder'))
  const renderControl = (inp: IsfInputDesc): JSX.Element => (
    <Control
      key={inp.name}
      inp={inp}
      value={values[inp.name]}
      onChange={onChange}
      modTargetFor={modTargetFor}
      rgbOnly={rgbOnly}
      dimReason={dim?.[inp.name]}
      labelExtra={hasLightOrder && inp.name === 'lightGlow' ? <LightOrderToggle values={values} onChange={onChange} /> : undefined}
    />
  )
  // A greyed bar does nothing right now : faded, the reason in its tooltip.
  const cell = (inp: IsfInputDesc): JSX.Element =>
    dim?.[inp.name] ? (
      <div key={inp.name} className="min-w-0 opacity-40" title={dim[inp.name]}>
        {renderControl(inp)}
      </div>
    ) : (
      renderControl(inp)
    )
  if (layout === 'vertical') {
    const list = visible(inputs)
    return (
      <div
        className={`grid gap-x-1.5 gap-y-[2px] ${cols ? 'grid-flow-col' : 'grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]'} ${bare ? '' : 'px-2 py-1'}`}
        style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(list.length / cols)}, auto)` } : undefined}
      >
        {list.map(cell)}
      </div>
    )
  }
  // XY pads (point2D) are tall : in the flow, one stretched its whole row and
  // left the rest of it blank (Ramps' center). They stand at the RIGHT and the
  // bars fill the width beside them. COMPACT inputs (small switches and menus)
  // close the flow, as their cluster did.
  const pads = inputs.filter((i) => i.type === 'point2D')
  const flow = visible(inputs).filter((i) => i.type !== 'point2D')
  const ordered = [...flow.filter((i) => !i.compact), ...flow.filter((i) => i.compact)]
  return (
    <div className={`flex gap-4 p-2 ${layout === 'twoRow' ? 'items-center' : 'items-start'}`}>
      <FlowGrid n={ordered.length}>{ordered.map(cell)}</FlowGrid>
      {pads.length > 0 && <div className="flex shrink-0 items-start gap-4">{pads.map(cell)}</div>}
    </div>
  )
}

/** The flow's grid : as many 12rem columns as its width holds; when the bars
 *  need more than one row, the rows are balanced (five bars : three and two, not
 *  four and a lone one), the columns widening to fill the row. */
function FlowGrid({ n, children }: { n: number; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = (): void => setWidth((w) => (Math.abs(w - el.clientWidth) > 1 ? el.clientWidth : w))
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fit = Math.max(1, Math.floor((width + 8) / (192 + 8)))
  const rows = Math.ceil(n / fit)
  const cols = rows <= 1 ? fit : Math.ceil(n / rows)
  return (
    <div
      ref={ref}
      className={`grid min-w-0 flex-1 items-start gap-x-2 gap-y-[3px] ${width ? '' : 'grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]'}`}
      style={width ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
    >
      {children}
    </div>
  )
}

// A control's pin key (null : no target, no Persistent menu).
function pinOf(modTargetFor: ((inputName: string) => ModTarget) | undefined, name: string): string | null {
  const t = modTargetFor?.(name)
  return t ? modTargetKey(t) : null
}

function Control({
  inp,
  value,
  onChange,
  modTargetFor,
  labelExtra,
  rgbOnly = false,
  dimReason
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
  modTargetFor?: (inputName: string) => ModTarget
  labelExtra?: JSX.Element
  rgbOnly?: boolean
  dimReason?: string
}): JSX.Element | null {
  const el = controlFor({ inp, value, onChange, modTargetFor, labelExtra, rgbOnly, dimReason })
  // Every control with a target can be pinned (a color or a pad too : the key is
  // the input's, whether or not the matrix can modulate it).
  return el ? <PinZone pin={pinOf(modTargetFor, inp.name)} label={inp.label}>{el}</PinZone> : el
}

function controlFor({
  inp,
  value,
  onChange,
  modTargetFor,
  labelExtra,
  rgbOnly,
  dimReason
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
  modTargetFor?: (inputName: string) => ModTarget
  labelExtra?: JSX.Element
  rgbOnly: boolean
  dimReason?: string
}): JSX.Element | null {
  switch (inp.type) {
    case 'float':
      return <FloatControl inp={inp} value={value} onChange={onChange} modTargetFor={modTargetFor} labelExtra={labelExtra} dimReason={dimReason} />
    case 'bool':
      return <BoolControl inp={inp} value={value} onChange={onChange} modTargetFor={modTargetFor} dimReason={dimReason} />
    case 'event':
      return <EventControl inp={inp} onChange={onChange} modTargetFor={modTargetFor} dimReason={dimReason} />
    case 'long':
      return <EnumControl inp={inp} value={value} onChange={onChange} modTargetFor={modTargetFor} dimReason={dimReason} />
    case 'color':
      return <ColorControl inp={inp} value={value} onChange={onChange} modTargetFor={modTargetFor} rgbOnly={rgbOnly} dimReason={dimReason} />
    case 'point2D':
      return <XYControl inp={inp} value={value} onChange={onChange} />
    default:
      return null
  }
}

function labelEl(inp: IsfInputDesc): JSX.Element {
  // Clamp to ONE line (ellipsis + full text in the tooltip) so a long label
  // can't wrap to two lines and shove its pad down.
  return (
    <span
      className="line-clamp-1 min-w-0 font-mono text-[9px] uppercase tracking-wide text-muted"
      title={inp.hint ?? inp.label}
    >
      {inp.display ?? inp.label}
    </span>
  )
}

/** A bar's tooltip : why it is greyed (first), what it does, how it plays. */
function tipFor(inp: IsfInputDesc, dimReason: string | undefined, how: string): string {
  // (a row that shows a shorter name keeps the full one here)
  const named = inp.display && inp.display !== inp.label ? `${inp.label} : ` : ''
  return [dimReason, inp.hint ? named + inp.hint : named ? inp.label : '', how].filter(Boolean).join(' · ')
}

/** Decimals a number box shows for a range this wide : 100 or more none, 10 one,
 *  1 two, 0.1 three, less four. Enough to read a slider, never so many it clips. */
export function fracFor(span: number): number {
  const s = Math.abs(span)
  return s >= 100 ? 0 : s >= 10 ? 1 : s >= 1 ? 2 : s >= 0.1 ? 3 : 4
}

// ── the M chip at a bar's end ───────────────────────────────────────────
/** Clear EVERY modulation on one parameter : its M1–8 bindings and every
 *  Macro knob carrying it as a destination. */
function clearModulation(target: ModTarget, bound: BoundAssignment[]): void {
  const st = useStore.getState()
  for (const b of bound) st.removeAssignment(b.id)
  const key = modTargetKey(target)
  st.composition.metaKnobs.forEach((k, i) => {
    if (k.destinations.some((d) => modTargetKey(d) === key)) st.toggleMetaDest(i, target)
  })
}

/** A bar's M : opens the provider's Modulate panel (a click again closes it),
 *  shows the modulators bound (M6, M1·2), a right-click clears them all. */
export function ModChip({
  target,
  bound,
  label,
  small = false
}: {
  target: ModTarget
  bound: BoundAssignment[]
  label: string
  small?: boolean
}): JSX.Element {
  const { onAssign, activeKey } = useContext(AssignContext)
  const isBound = bound.length > 0
  return (
    <BarChip
      text={`M${isBound ? bound.map((b) => b.mod + 1).join('·') : ''}`}
      bound={isBound}
      active={activeKey === modTargetKey(target)}
      label={label}
      small={small}
      title={`Modulate ${label} : right-click clears all its modulation`}
      onClick={() => onAssign?.(target, label)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation() // (the control's own menu, Persistent, is under it)
        clearModulation(target, bound)
      }}
    />
  )
}

// ── float → a filled bar ──────────────────────────────────────────────
function FloatControl({
  inp,
  value,
  onChange,
  modTargetFor,
  labelExtra,
  dimReason
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
  modTargetFor?: (inputName: string) => ModTarget
  labelExtra?: JSX.Element
  dimReason?: string
}): JSX.Element {
  const min = typeof inp.min === 'number' ? inp.min : 0
  const max = typeof inp.max === 'number' ? inp.max : 1
  const def = typeof inp.def === 'number' ? inp.def : min
  const raw = typeof value === 'number' ? value : def
  const target = modTargetFor?.(inp.name)
  const targetKey = target ? modTargetKey(target) : null
  const bound = useBound(targetKey)
  const isModulated = bound.length > 0
  // A MODULATED bar's fill plays the live value and its pointer stays on the
  // stored one; a drag moves the stored value by as much as you move (Bar.tsx).
  const how = isModulated
    ? 'modulated : the fill plays the live value, the pointer stays on the stored one; a drag moves the stored value by as much as you move'
    : `drag (Shift : finer), double-click resets (${fracFor(max - min) === 0 || inp.integer ? Math.round(def) : def}), click the number to type`
  return (
    <FloatBar
      label={inp.display ?? inp.label}
      title={tipFor(inp, dimReason, how)}
      value={raw}
      min={min}
      max={max}
      def={def}
      integer={!!inp.integer}
      frac={fracFor(max - min)}
      onChange={(n) => onChange(inp.name, inp.integer ? Math.round(n) : n)}
      modulated={isModulated}
      liveKey={targetKey}
      chip={target ? <ModChip target={target} bound={bound} label={inp.label} /> : undefined}
      extra={labelExtra}
    />
  )
}

// Inline binding row: modulators M1–8 (with depth) and Meta knobs K1–K16.
// Exported : MetaBar reuses it for binding modulators TO knobs (hideMeta).
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
  // A toggle runs one law in both modes (modulation.ts toggleFromMod) : no chip.
  const toggle = useStore((s) => isToggleTarget(s, target))
  // Which Meta knobs already carry this input as a destination. useShallow so
  // this fresh boolean-array selector doesn't re-render on every store change.
  const metaBound = useStore(
    useShallow((s) =>
      s.composition.metaKnobs.map((k) =>
        k.destinations.some((d) => modTargetKey(d) === targetKey)
      )
    )
  )
  // Live bindings only : a dead one (its effect removed) is cleared to make room.
  const used = useStore((s) => s.composition.modMatrix.filter((a) => targetAlive(s.composition, a.target, s.audioLayer)).length)
  const full = used >= MAX_MOD_ASSIGNMENTS
  // the binding whose shaping is open under its row (one at a time)
  const [shapeOpen, setShapeOpen] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-panel2/60 p-1">
      <div className="flex min-w-0 items-center gap-1">
        <span className="w-8 shrink-0 font-mono text-[9px] uppercase text-muted">mod</span>
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
                  // Cap reached (the matrix stays legible by design) : say so.
                  else if (!assignMod(i, target, 0.5)) warnModMatrixFull()
                }}
                className={`min-w-0 flex-1 rounded px-0.5 py-0.5 font-mono text-[9px] transition-colors ${
                  existing
                    ? 'bg-accent/25 text-accent ring-1 ring-accent'
                    : full
                      ? 'bg-panel3/30 text-muted/50'
                      : 'bg-panel3/60 text-muted hover:text-text'
                }`}
                title={
                  existing
                    ? `Unbind M${i + 1}`
                    : full
                      ? `Modulation is full (${used} of ${MAX_MOD_ASSIGNMENTS}) : clear a binding first`
                      : `Bind M${i + 1}`
                }
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
          <div key={b.id} className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="w-8 shrink-0 font-mono text-[9px] text-accent">M{b.mod + 1}</span>
            {/* Mode: Multiply (scale the base : default) ↔ Replace (swing over it).
                A toggle has one law, so it shows a fixed label instead. */}
            {toggle ? (
              <span
                className="shrink-0 cursor-help rounded bg-panel3/60 px-1 py-0.5 font-mono text-[9px] uppercase text-muted"
                title="Toggle : at depth 1 it follows the modulator (on while it is in its upper half). Less depth leans toward the stored state : stored off, it switches on only near the peaks; stored on, it switches off only near the troughs. Negative depth inverts the modulator."
              >
                tgl
              </span>
            ) : (
              <button
                onClick={() => setAssignmentMode(b.id, mult ? 'replace' : 'multiply')}
                className={`shrink-0 rounded px-1 py-0.5 font-mono text-[9px] uppercase transition-colors ${
                  mult
                    ? 'bg-accent/20 text-accent ring-1 ring-accent'
                    : 'bg-accent2/20 text-accent2 ring-1 ring-accent2'
                }`}
                title={
                  mult
                    ? 'Multiply : the modulator scales the base value (|depth| = amount). Click for Replace.'
                    : 'Replace : the modulator swings the value around the base. Click for Multiply.'
                }
              >
                {mult ? 'mul' : 'rep'}
              </button>
            )}
            <input
              type="range"
              min={-10}
              max={10}
              step={0.01}
              value={b.depth}
              onChange={(e) => setAssignmentDepth(b.id, Number(e.target.value))}
              // Back to 0.5, the depth a new binding starts at (like every slider's double-click).
              onDoubleClick={() => setAssignmentDepth(b.id, 0.5)}
              className={`min-w-0 flex-1 ${mult ? 'accent-accent' : 'accent-accent2'}`}
              title={
                mult
                  ? `Amount ${b.depth.toFixed(2)} : how deeply the modulator scales the base (− inverts). Double-click : 0.5`
                  : `Depth ${b.depth.toFixed(2)} : bipolar swing around the base value. Double-click : 0.5`
              }
            />
            {/* The slider gave no readout of the depth : a bipolar ±1 box, so
                you can see and set it exactly. The box's fixed width shrinks the
                flex-1 slider to fit, keeping the row its current size. */}
            <BoundedNumberInput
              value={b.depth}
              min={-10}
              max={10}
              maxFrac={2}
              onChange={(v) => setAssignmentDepth(b.id, v)}
              className="input w-12 shrink-0 px-1 py-0.5 text-right text-[9px]"
            />
            {/* the binding's shaping : combine, threshold, integrate */}
            <ShapeToggle id={b.id} open={shapeOpen === b.id} onToggle={() => setShapeOpen(shapeOpen === b.id ? null : b.id)} />
          </div>
          {shapeOpen === b.id && <ModShapeEditor id={b.id} />}
          </div>
        )
      })}
      {/* Macro knobs : K1..K16; a knob drives this input absolutely through
          its curve over the input's declared range (up to 8 dests/knob).
          EXACTLY two rows, row-major: K1–K9 then K10–K16 (with the MOD line
          above, the whole panel is the fixed three-row shape). */}
      {!hideMeta && (
        <div className="flex min-w-0 items-start gap-1">
          <span className="w-8 shrink-0 pt-0.5 font-mono text-[9px] uppercase text-muted">macro</span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {[metaBound.slice(0, 9), metaBound.slice(9)].map((row, r) => (
              <div key={r} className="flex min-w-0 gap-0.5">
                {row.map((on, j) => {
                  const i = r * 9 + j
                  return (
                    <button
                      key={i}
                      onClick={() => toggleMetaDest(i, target)}
                      className={`min-w-0 flex-1 rounded px-0.5 py-0.5 font-mono text-[9px] transition-colors ${
                        on
                          ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2'
                          : 'bg-panel3/60 text-muted hover:text-text'
                      }`}
                      title={`${on ? 'Unbind' : 'Bind'} Macro knob ${i + 1}`}
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

// Context's Light PRE/POST toggle : a tiny chip inside the light's glow bar
// that flips the `lightOrder` bool. POST (default) adds the key light after
// haze + vignette (+ any hard master FX below) so it always reads; PRE is the
// old order (before them, so they can wash / darken it).
function LightOrderToggle({
  values,
  onChange
}: {
  values: Record<string, Value>
  onChange: (name: string, value: Value) => void
}): JSX.Element {
  const post = (typeof values.lightOrder === 'number' ? values.lightOrder : 1) >= 0.5
  return (
    <button
      onClick={() => onChange('lightOrder', post ? 0 : 1)}
      className={`shrink-0 rounded px-1 font-mono text-[9px] leading-[14px] uppercase transition-colors ${
        post
          ? 'bg-accent/20 text-accent ring-1 ring-accent'
          : 'bg-accent2/20 text-accent2 ring-1 ring-accent2'
      }`}
      title={
        post
          ? 'Light POST : light added after haze + vignette (and any hard master FX below), so it always reads. Click for PRE.'
          : 'Light PRE : light added before haze + vignette, which can wash / darken it (the old order). Click for POST.'
      }
    >
      {post ? 'POST' : 'PRE'}
    </button>
  )
}

// ── bool → the whole bar is the switch ─────────────────────────────────
function BoolControl({
  inp,
  value,
  onChange,
  modTargetFor,
  dimReason
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
  modTargetFor?: (inputName: string) => ModTarget
  dimReason?: string
}): JSX.Element {
  const def = typeof inp.def === 'number' ? inp.def : 0
  // A modulated switch fills in accent2 and shows its LIVE state as the
  // modulator flips it : the shared overlay repaints it each frame (React keeps
  // rendering the stored state).
  const target = modTargetFor?.(inp.name)
  const targetKey = target ? modTargetKey(target) : null
  const bound = useBound(targetKey)
  const isModulated = bound.length > 0
  const on = (typeof value === 'number' ? value : def) >= 0.5
  return (
    <BoolBar
      label={inp.display ?? inp.label}
      title={tipFor(inp, dimReason, isModulated ? 'modulated : showing the live state; a click sets the stored one' : 'click to switch')}
      value={on}
      onChange={(o) => onChange(inp.name, o ? 1 : 0)}
      modulated={isModulated}
      liveKey={targetKey}
      chip={target ? <ModChip target={target} bound={bound} label={inp.label} /> : undefined}
    />
  )
}

// ── event → a button bar ──────────────────────────────────────────────
function EventControl({
  inp,
  onChange,
  modTargetFor,
  dimReason
}: {
  inp: IsfInputDesc
  onChange: (name: string, value: Value) => void
  modTargetFor?: (inputName: string) => ModTarget
  dimReason?: string
}): JSX.Element {
  // An `event` input is a MOMENTARY trigger : a press pulses it 1 → 0 so the
  // engine sees a rising edge (fire) then re-arms. Its M binds a modulator to
  // drive it (a square LFO / sample&hold / audio edge); OSC fires it too.
  // Hold the deferred 1 → 0 reset in a ref and cancel it when this control
  // unmounts or its shader/slot changes : the `inp` descriptor is cached per
  // shader (inputsForShader), so it only changes on a real swap. Without this a
  // reset armed on shader A but landing after a swap would plant a stray
  // `name → 0` on whatever shader now occupies the slot.
  const fireTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (fireTimer.current !== null) {
        window.clearTimeout(fireTimer.current)
        fireTimer.current = null
      }
    },
    [inp]
  )
  const target = modTargetFor?.(inp.name)
  const bound = useBound(target ? modTargetKey(target) : null)
  return (
    <EventBar
      label={inp.display ?? inp.label}
      title={[dimReason, inp.hint ?? `${inp.label} : fire (momentary trigger; bind M for rhythmic auto-fire)`].filter(Boolean).join(' · ')}
      onFire={() => {
        if (fireTimer.current !== null) window.clearTimeout(fireTimer.current)
        onChange(inp.name, 1)
        fireTimer.current = window.setTimeout(() => {
          onChange(inp.name, 0)
          fireTimer.current = null
        }, 140)
      }}
      chip={target ? <ModChip target={target} bound={bound} label={inp.label} /> : undefined}
    />
  )
}

// ── long → segments (up to three choices) or a menu bar ────────────────
/** Segments only while they read whole in the narrowest bar (12rem, its M
 *  included : the name at ~7.2 px a letter, each choice at ~6.4 px plus its
 *  padding); a longer set is a menu bar, never clipped words. */
function segmentsFit(name: string, options: Array<{ label: string }>): boolean {
  if (options.length > 3) return false
  const w = name.length * 7.2 + 16 + options.reduce((s, o) => s + o.label.length * 6.4 + 10, 0) + 26
  return w <= 192
}

function enumOptions(inp: IsfInputDesc): Array<{ value: number; label: string }> {
  const values = inp.values ?? []
  const labels = inp.labels ?? values.map(String)
  return values.map((v, i) => ({ value: v, label: labels[i] ?? String(v) }))
}

function EnumControl({
  inp,
  value,
  onChange,
  modTargetFor,
  dimReason
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
  modTargetFor?: (inputName: string) => ModTarget
  dimReason?: string
}): JSX.Element {
  const def = typeof inp.def === 'number' ? inp.def : 0
  const v = typeof value === 'number' ? value : def
  const options = useMemo(() => enumOptions(inp), [inp])
  const target = modTargetFor?.(inp.name)
  const targetKey = target ? modTargetKey(target) : null
  const bound = useBound(targetKey)
  const isModulated = bound.length > 0
  // A modulated menu shows the LIVE choice (the engine snaps enums to declared
  // values) in accent2; picking sets the stored one.
  const props = {
    label: inp.display ?? inp.label,
    title: tipFor(inp, dimReason, isModulated ? 'modulated : showing the live choice; picking sets the stored one' : ''),
    options,
    value: v,
    onChange: (n: number) => onChange(inp.name, n),
    modulated: isModulated,
    liveKey: targetKey,
    chip: target ? <ModChip target={target} bound={bound} label={inp.label} /> : undefined
  }
  return segmentsFit(props.label, options) ? <SegBar {...props} /> : <DropBar {...props} />
}

// ── long → a compact menu bar for a section header (no name) ────────────
// The switch that turns a whole Finishing section on / off or picks its mode
// (3D stereo, film hold, output shape…) : same live overlay + M as EnumControl.
export function EnumSwitch({
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
  const options = useMemo(() => enumOptions(inp), [inp])
  const target = modTargetFor?.(inp.name)
  const targetKey = target ? modTargetKey(target) : null
  const bound = useBound(targetKey)
  const isModulated = bound.length > 0
  return (
    // (the header folds on a click or Enter : not when it is this switch's)
    <span className="flex w-[9.5rem] min-w-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DropBar
        bare
        className="w-full"
        label={inp.label}
        title={(inp.hint ?? inp.label) + (isModulated ? ' (modulated : picking sets the stored one)' : '')}
        options={options}
        value={v}
        onChange={(n) => onChange(inp.name, n)}
        modulated={isModulated}
        liveKey={targetKey}
        chip={target ? <ModChip small target={target} bound={bound} label={inp.label} /> : undefined}
      />
    </span>
  )
}

// ── color : hex helpers ──────────────────────────────────────────────
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

// ── color → a bar painted in it + its alpha, its parts modulatable ─────
// The bar opens the color picker : its pad (saturation across, brightness up)
// and its slider (the hue). Those parts, and alpha, are modulated like any
// float, in the picker's own space (engine/colorParts.ts) : ONE M at the bar's
// end, the Modulate panel picks the part (ColorPartSwitch). A driven color's
// bar is painted in the color it plays (edged in accent2), its alpha cell
// fills to its live alpha. (The palette strip and the World still use the
// classic pill, ColorModButton.)

/** The Finishing stages read their colors' RGB only (FinishingSections' rgbOnly) :
 *  no alpha part there. */
const RGB_ONLY_SHADERS = new Set(['fx-vibe', 'fx-context', 'fx-finalizer'])
const RGB_PARTS: ColorChannel[] = ['h', 's', 'v']

function rgbOnlyTarget(c: CompositionState, t: ModTarget): boolean {
  if (t.kind !== 'fx' || t.scope.kind !== 'master') return false
  const sid = c.master.find((f) => f.id === t.instId)?.shaderId
  return !!sid && RGB_ONLY_SHADERS.has(sid)
}

/** A color control's part targets, the bindings on them and whether anything
 *  drives them (a modulator, or a Meta knob carrying one). */
export function useColorParts(
  base: ModTarget | undefined,
  rgbOnly: boolean
): { targets: ModTarget[]; bound: ModAssignment[]; driven: boolean } {
  const baseKey = base ? modTargetKey(base) : ''
  const targets = useMemo(
    () => (base ? (rgbOnly ? RGB_PARTS : COLOR_PARTS).flatMap((ch) => withPartTarget(base, ch) ?? []) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseKey, rgbOnly]
  )
  const keys = useMemo(() => new Set(targets.map(modTargetKey)), [targets])
  const bound = useStore(
    useShallow((s) => (keys.size ? s.composition.modMatrix.filter((a) => keys.has(modTargetKey(a.target))) : []))
  )
  const knobbed = useStore(
    (s) => keys.size > 0 && s.composition.metaKnobs.some((k) => k.destinations.some((d) => keys.has(modTargetKey(d))))
  )
  return { targets, bound, driven: bound.length > 0 || knobbed }
}

/** The M of a color : one for all its parts. A click opens the Modulate panel on
 *  the part already bound (else the hue), and closes it from any of them; lit
 *  while a part is bound; a right-click clears all of them. */
export function ColorModButton({
  targets,
  bound,
  label
}: {
  targets: ModTarget[]
  bound: ModAssignment[]
  label: string
}): JSX.Element {
  const { onAssign, activeKey } = useContext(AssignContext)
  const keys = targets.map(modTargetKey)
  const open = targets.find((_, i) => keys[i] === activeKey)
  const first = targets.find((_, i) => bound.some((a) => modTargetKey(a.target) === keys[i]))
  const isBound = bound.length > 0
  const mods = [...new Set(bound.map((a) => a.mod + 1))].sort((a, b) => a - b)
  const now = targets
    .map((t, i) => {
      const on = bound.filter((a) => modTargetKey(a.target) === keys[i]).map((a) => `M${a.mod + 1}`)
      const ch = partOf(t)
      return on.length && ch ? `${PART_WORD[ch]} ${on.join(' ')}` : ''
    })
    .filter(Boolean)
    .join(', ')
  function clearAll(): void {
    const st = useStore.getState()
    for (const b of bound) st.removeAssignment(b.id)
    const ks = new Set(keys)
    st.composition.metaKnobs.forEach((k, i) => {
      for (const d of k.destinations) if (ks.has(modTargetKey(d))) useStore.getState().toggleMetaDest(i, d)
    })
  }
  return (
    <button
      onClick={() => onAssign?.(open ?? first ?? targets[0], label)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation() // (the control's own menu, Persistent, is under it)
        clearAll()
      }}
      className={`shrink-0 rounded px-1 font-mono text-[9px] leading-4 transition-colors ${
        isBound
          ? 'bg-accent/20 text-accent ring-1 ring-accent'
          : open
            ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2'
            : 'bg-panel3/60 text-muted hover:text-text'
      }`}
      title={`Modulate ${label} : its hue (the picker's color slider), saturation and brightness (its pad, across and up)${targets.length > 3 ? ' or alpha' : ''}${now ? ` (now : ${now})` : ''}. Right-click clears all its modulation`}
    >
      M{isBound ? mods.join('·') : ''}
    </button>
  )
}

/** The Modulate panel's part switch, when it modulates a color : hue,
 *  saturation, brightness (and alpha), each lit while something drives it, and
 *  where the picker shows the one open. */
export function ColorPartSwitch({
  target,
  onPick
}: {
  target: ModTarget
  onPick: (t: ModTarget) => void
}): JSX.Element | null {
  const ch = partOf(target)
  const noAlpha = useStore((s) => rgbOnlyTarget(s.composition, target))
  const chs = noAlpha ? RGB_PARTS : COLOR_PARTS
  const lit = useStore(
    useShallow((s) =>
      chs.map((c) => {
        const t = withPartTarget(target, c)
        const k = t ? modTargetKey(t) : ''
        return (
          s.composition.modMatrix.some((a) => modTargetKey(a.target) === k) ||
          s.composition.metaKnobs.some((kn) => kn.destinations.some((d) => modTargetKey(d) === k))
        )
      })
    )
  )
  if (!ch) return null
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 gap-0.5">
        {chs.map((c, i) => (
          <button
            key={c}
            onClick={() => {
              const t = withPartTarget(target, c)
              if (t && c !== ch) onPick(t)
            }}
            className={`min-w-0 flex-auto truncate rounded px-1 py-0.5 font-mono text-[9px] transition-colors ${
              lit[i] ? 'bg-accent/20 text-accent' : c === ch ? 'bg-accent2/25 text-accent2' : 'bg-panel3/60 text-muted hover:text-text'
            } ${c === ch ? 'ring-1 ring-accent2' : ''}`}
            title={`${PART_WORD[c]} : ${PART_WHERE[c]}${lit[i] ? ' (modulated)' : ''}`}
          >
            {PART_WORD[c]}
          </button>
        ))}
      </div>
      <span className="truncate font-mono text-[9px] text-muted">{PART_WHERE[ch]}</span>
    </div>
  )
}

/** A readout's text, written into React's own text node (replacing the node
 *  would leave React updating a detached one). */
function setText(el: HTMLElement | null, s: string): void {
  const n = el?.firstChild
  if (n && n.nodeType === 3 && n.nodeValue !== s) n.nodeValue = s
}

/** A color's M chip : one for all its parts (ColorModButton's rules : a click
 *  opens the Modulate panel on the part already bound, else the hue; a
 *  right-click clears them all), the modulators of every part in it. */
function ColorModChip({
  targets,
  bound,
  label
}: {
  targets: ModTarget[]
  bound: ModAssignment[]
  label: string
}): JSX.Element {
  const { onAssign, activeKey } = useContext(AssignContext)
  const keys = targets.map(modTargetKey)
  const open = targets.find((_, i) => keys[i] === activeKey)
  const first = targets.find((_, i) => bound.some((a) => modTargetKey(a.target) === keys[i]))
  const mods = [...new Set(bound.map((a) => a.mod + 1))].sort((a, b) => a - b)
  const now = targets
    .map((t, i) => {
      const on = bound.filter((a) => modTargetKey(a.target) === keys[i]).map((a) => `M${a.mod + 1}`)
      const ch = partOf(t)
      return on.length && ch ? `${PART_WORD[ch]} ${on.join(' ')}` : ''
    })
    .filter(Boolean)
    .join(', ')
  return (
    <BarChip
      text={`M${mods.length ? mods.join('·') : ''}`}
      bound={bound.length > 0}
      active={!!open}
      label={label}
      title={`Modulate ${label} : its hue (the picker's color slider), saturation and brightness (its pad, across and up)${targets.length > 3 ? ' or alpha' : ''}${now ? ` (now : ${now})` : ''}. Right-click clears all its modulation`}
      onClick={() => onAssign?.(open ?? first ?? targets[0], label)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation() // (the control's own menu, Persistent, is under it)
        const st = useStore.getState()
        for (const b of bound) st.removeAssignment(b.id)
        const ks = new Set(keys)
        st.composition.metaKnobs.forEach((k, i) => {
          for (const d of k.destinations) if (ks.has(modTargetKey(d))) useStore.getState().toggleMetaDest(i, d)
        })
      }}
    />
  )
}

function ColorControl({
  inp,
  value,
  onChange,
  modTargetFor,
  rgbOnly = false,
  dimReason
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
  modTargetFor?: (inputName: string) => ModTarget
  rgbOnly?: boolean
  dimReason?: string
}): JSX.Element {
  const def = Array.isArray(inp.def) ? inp.def : [1, 1, 1, 1]
  const v = Array.isArray(value) && value.length >= 3 ? value : def
  const alpha = v[3] ?? 1
  const base = modTargetFor?.(inp.name)
  const { targets, bound, driven } = useColorParts(base, rgbOnly)
  const colorKey = base ? modTargetKey(base) : null
  const alphaKey = targets[3] ? modTargetKey(targets[3]) : null
  const alphaBound = !!alphaKey && bound.some((a) => modTargetKey(a.target) === alphaKey)
  const zoneRef = useRef<HTMLLabelElement | null>(null)
  const hexRef = useRef<HTMLSpanElement | null>(null)
  const swatchRef = useRef<HTMLInputElement | null>(null)
  // the stored color, for the frames nothing plays it
  const baseRef = useRef({ hex: toHex(v), rgb: v })
  baseRef.current = { hex: toHex(v), rgb: v }

  // A driven color's bar is painted in what it plays (its ink and its hex too),
  // one shared rAF writing the DOM (never React). The picker edits the STORED
  // color; the modulation goes on over whatever is picked.
  useLayoutEffect(() => {
    const zone = zoneRef.current
    if (!driven || !colorKey || !zone) return
    let last = ''
    const paint = (): void => {
      const live = liveColorValues.get(colorKey)
      const hex = live ? toHex(live) : baseRef.current.hex
      setText(hexRef.current, hex)
      if (hex === last && zone.style.backgroundColor) return
      last = hex
      zone.style.backgroundColor = hex
      zone.style.color = inkFor(live ?? baseRef.current.rgb)
    }
    paint()
    const stop = registerLiveOverlay({ paint, view: zone.ownerDocument.defaultView ?? undefined })
    return () => {
      stop()
      zone.style.backgroundColor = baseRef.current.hex
      zone.style.color = inkFor(baseRef.current.rgb)
      setText(hexRef.current, baseRef.current.hex)
    }
  }, [driven, colorKey])

  const how = driven
    ? 'modulated : painted in the color it plays; a click picks the stored one'
    : 'click to pick (the pad : saturation across, brightness up; the slider : the hue)'
  return (
    <ColorBar
      label={inp.display ?? inp.label}
      title={tipFor(inp, dimReason, how)}
      hex={toHex(v)}
      rgb={v}
      painted={!driven}
      hexRef={hexRef}
      zoneRef={zoneRef}
      picker={{
        ref: swatchRef,
        value: toHex(v),
        onChange: (e) => onChange(inp.name, fromHex(e.currentTarget.value, alpha))
      }}
      driven={driven}
      alpha={
        rgbOnly ? undefined : (
          <AlphaCell
            value={alpha}
            def={typeof def[3] === 'number' ? def[3] : 1}
            onChange={(a) => onChange(inp.name, [v[0], v[1], v[2], a])}
            modulated={alphaBound}
            read={() => (colorKey ? liveColorValues.get(colorKey)?.[3] : undefined)}
          />
        )
      }
      chip={targets.length ? <ColorModChip targets={targets} bound={bound} label={inp.label} /> : undefined}
    />
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
        onPointerCancel={() => {
          dragging.current = false
        }}
        onDoubleClick={() => onChange(inp.name, def)}
        title={`${inp.label} : drag · double-click to reset`}
      >
        <div
          className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${nx * 100}%`, bottom: `${ny * 100}%` }}
        />
      </div>
    </div>
  )
}
