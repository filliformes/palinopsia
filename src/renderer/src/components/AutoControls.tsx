// AutoControls — themed controls generated from ISF INPUTS (brief §10.3).
// The dataFLOU Pool→auto-UI pattern applied to ISF: float→slider+number,
// bool→toggle, long→dropdown, color→swatch+alpha, point2D→XY pad, honouring
// each input's declared range and default. This is the simplexité payoff:
// the shader header IS the control surface.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ModTarget } from '@shared/types'
import { liveModValues } from '../engine/modulation'
import type { IsfInputDesc } from '../shaders/isf/inputs'
import { modTargetKey, useStore } from '../store'
import { BoundedNumberInput } from './BoundedNumberInput'

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
    const rest = inputs.filter((i) => i.type !== 'point2D')
    // Too few controls to justify two rows → lay them in a single row and
    // centre the whole group (both axes) instead of a sparse, top-left grid.
    const singleRow = rest.length <= 4
    return (
      <div className={`flex h-full items-center gap-5 p-2 ${singleRow ? 'justify-center' : ''}`}>
        {singleRow ? (
          <div className="flex items-center gap-5">{visible(rest).map((inp) => renderControl(inp))}</div>
        ) : (
          <div
            className="grid grid-flow-col content-start gap-x-5 gap-y-2"
            style={{ gridTemplateRows: 'repeat(2, min-content)', gridAutoColumns: '11rem' }}
          >
            {visible(rest).map((inp) => renderControl(inp))}
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
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 p-2">{visible(inputs).map((inp) => renderControl(inp))}</div>
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
  const axis = (
    label: string,
    v: number,
    min: number,
    max: number,
    def: number,
    name: string
  ): JSX.Element => (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <span className="font-mono text-[9px] text-muted">{label}</span>
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
    </div>
  )
  return (
    <div className="flex w-44 min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-wide text-muted">pos</span>
      <div className="flex min-w-0 items-center gap-2">
        {axis('X', vx, minx, maxx, defx, 'posX')}
        {axis('Y', vy, miny, maxy, defy, 'posY')}
      </div>
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
      return <BoolControl inp={inp} value={value} onChange={onChange} />
    case 'long':
      return <EnumControl inp={inp} value={value} onChange={onChange} />
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
    <span className="font-mono text-[9px] uppercase tracking-wide text-muted" title={inp.name}>
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
  const [assignOpen, setAssignOpen] = useState(false)
  const target = modTargetFor?.(inp.name)
  const targetKey = target ? modTargetKey(target) : null
  // Existing assignments on this input (any modulator).
  const bound = useStore((s) =>
    targetKey
      ? s.composition.modMatrix.filter((a) => modTargetKey(a.target) === targetKey)
      : []
  )
  const isModulated = bound.length > 0

  // Modulated sliders MOVE with the live value (dataFLOU behaviour): one rAF
  // writes the thumb position straight to the DOM — React keeps rendering the
  // BASE value; the live overlay never causes re-renders. Paused while the
  // user is dragging this slider.
  const sliderRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (!isModulated || !targetKey) return
    let raf = 0
    const paint = (): void => {
      const el = sliderRef.current
      const live = liveModValues.get(targetKey)
      if (el && live !== undefined && document.activeElement !== el) {
        el.value = String(live)
      }
      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [isModulated, targetKey])

  // Dense single-line layout (Finishing view): label · slider · M · number,
  // all on one row so the stack takes minimal vertical space.
  if (dense) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="w-16 shrink-0 truncate font-mono text-[9px] uppercase tracking-wide text-muted"
            title={inp.name}
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
              isModulated
                ? `${inp.label} — modulated (drag sets the base)`
                : `${inp.label} — double-click to reset (${def})`
            }
          />
          {target && (
            <button
              onClick={() => setAssignOpen((o) => !o)}
              className={`shrink-0 rounded px-1 font-mono text-[9px] leading-4 transition-colors ${
                bound.length > 0
                  ? 'bg-accent/20 text-accent ring-1 ring-accent'
                  : assignOpen
                    ? 'bg-panel3 text-text'
                    : 'bg-panel3/60 text-muted hover:text-text'
              }`}
              title="Bind a modulator to this input"
            >
              M{bound.length > 0 ? bound.map((b) => b.mod + 1).join('') : ''}
            </button>
          )}
          <div className="w-12 shrink-0">
            <BoundedNumberInput
              value={v}
              min={min}
              max={max}
              onChange={(n) => onChange(inp.name, n)}
              className="input w-full px-1 py-0.5 text-right text-[11px]"
            />
          </div>
        </div>
        {assignOpen && target && <AssignRow target={target} bound={bound} />}
      </div>
    )
  }

  return (
    <div className="flex w-44 min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        {labelEl(inp)}
        <div className="flex shrink-0 items-center gap-1">
          {target && (
            <button
              onClick={() => setAssignOpen((o) => !o)}
              className={`rounded px-1 font-mono text-[9px] leading-4 transition-colors ${
                bound.length > 0
                  ? 'bg-accent/20 text-accent ring-1 ring-accent'
                  : assignOpen
                    ? 'bg-panel3 text-text'
                    : 'bg-panel3/60 text-muted hover:text-text'
              }`}
              title="Bind a modulator to this input"
            >
              M{bound.length > 0 ? bound.map((b) => b.mod + 1).join('') : ''}
            </button>
          )}
          <div className="w-14">
            <BoundedNumberInput
              value={v}
              min={min}
              max={max}
              onChange={(n) => onChange(inp.name, n)}
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
          isModulated
            ? `${inp.label} — modulated (moving with the live value; drag sets the base)`
            : `${inp.label} — double-click to reset (${def})`
        }
      />
      {assignOpen && target && <AssignRow target={target} bound={bound} />}
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
  bound: Array<{ id: string; mod: number; depth: number }>
  hideMeta?: boolean
}): JSX.Element {
  const assignMod = useStore((s) => s.assignMod)
  const removeAssignment = useStore((s) => s.removeAssignment)
  const setAssignmentDepth = useStore((s) => s.setAssignmentDepth)
  const toggleMetaDest = useStore((s) => s.toggleMetaDest)
  const targetKey = modTargetKey(target)
  // Which Meta knobs already carry this input as a destination.
  const metaBound = useStore((s) =>
    s.composition.metaKnobs.map((k) =>
      k.destinations.some((d) => modTargetKey(d) === targetKey)
    )
  )
  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-panel2/60 p-1">
      <div className="flex min-w-0 items-center gap-1">
        <span className="w-8 shrink-0 font-mono text-[8px] uppercase text-muted">mod</span>
        <div className="flex flex-wrap gap-0.5">
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
                className={`rounded px-1 py-0.5 font-mono text-[9px] transition-colors ${
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
      {bound.map((b) => (
        <div key={b.id} className="flex items-center gap-1">
          <span className="w-8 shrink-0 font-mono text-[9px] text-accent">M{b.mod + 1}</span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={b.depth}
            onChange={(e) => setAssignmentDepth(b.id, Number(e.target.value))}
            className="min-w-0 flex-1 accent-accent"
            title={`Depth ${b.depth.toFixed(2)} — bipolar swing around the base value`}
          />
        </div>
      ))}
      {/* Meta knobs — K1..K16; a knob drives this input absolutely through
          its curve over the input's declared range (up to 8 dests/knob). */}
      {!hideMeta && (
        <div className="flex min-w-0 items-center gap-1">
          <span className="w-8 shrink-0 font-mono text-[8px] uppercase text-muted">meta</span>
          <div className="flex flex-wrap gap-0.5">
            {metaBound.map((on, i) => (
              <button
                key={i}
                onClick={() => toggleMetaDest(i, target)}
                className={`rounded px-1 py-0.5 font-mono text-[8px] transition-colors ${
                  on
                    ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2'
                    : 'bg-panel3/60 text-muted hover:text-text'
                }`}
                title={`${on ? 'Unbind' : 'Bind'} Meta knob ${i + 1}`}
              >
                K{i + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── bool → toggle chip ───────────────────────────────────────────────
function BoolControl({
  inp,
  value,
  onChange
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
}): JSX.Element {
  const def = typeof inp.def === 'number' ? inp.def : 0
  const on = (typeof value === 'number' ? value : def) >= 0.5
  return (
    <div className="flex flex-col items-start gap-0.5">
      {labelEl(inp)}
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

// ── long → dropdown ──────────────────────────────────────────────────
function EnumControl({
  inp,
  value,
  onChange
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
}): JSX.Element {
  const def = typeof inp.def === 'number' ? inp.def : 0
  const v = typeof value === 'number' ? value : def
  const values = inp.values ?? []
  const labels = inp.labels ?? values.map(String)
  return (
    <div className="flex flex-col gap-0.5">
      {labelEl(inp)}
      <select
        className="input text-[11px]"
        value={v}
        onChange={(e) => onChange(inp.name, Number(e.target.value))}
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
