// AutoControls — themed controls generated from ISF INPUTS (brief §10.3).
// The dataFLOU Pool→auto-UI pattern applied to ISF: float→slider+number,
// bool→toggle, long→dropdown, color→swatch+alpha, point2D→XY pad, honouring
// each input's declared range and default. This is the simplexité payoff:
// the shader header IS the control surface.

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { IsfInputDesc } from '../shaders/isf/inputs'
import { BoundedNumberInput } from './BoundedNumberInput'

type Value = number | number[]

export function AutoControls({
  inputs,
  values,
  onChange
}: {
  inputs: IsfInputDesc[]
  values: Record<string, Value>
  onChange: (name: string, value: Value) => void
}): JSX.Element {
  if (inputs.length === 0) {
    return <div className="p-2 text-[11px] text-muted">This shader exposes no controls.</div>
  }
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 p-2">
      {inputs.map((inp) => (
        <Control key={inp.name} inp={inp} value={values[inp.name]} onChange={onChange} />
      ))}
    </div>
  )
}

function Control({
  inp,
  value,
  onChange
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
}): JSX.Element | null {
  switch (inp.type) {
    case 'float':
      return <FloatControl inp={inp} value={value} onChange={onChange} />
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

// ── float → slider + number ──────────────────────────────────────────
function FloatControl({
  inp,
  value,
  onChange
}: {
  inp: IsfInputDesc
  value: Value | undefined
  onChange: (name: string, value: Value) => void
}): JSX.Element {
  const min = typeof inp.min === 'number' ? inp.min : 0
  const max = typeof inp.max === 'number' ? inp.max : 1
  const def = typeof inp.def === 'number' ? inp.def : min
  const v = typeof value === 'number' ? value : def
  const step = (max - min) / 200 || 0.005
  return (
    <div className="flex w-48 flex-col gap-0.5">
      <div className="flex items-center justify-between">
        {labelEl(inp)}
        <div className="w-14">
          <BoundedNumberInput value={v} min={min} max={max} onChange={(n) => onChange(inp.name, n)} />
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => onChange(inp.name, Number(e.target.value))}
        onDoubleClick={() => onChange(inp.name, def)}
        className="accent-accent"
        title={`${inp.label} — double-click to reset (${def})`}
      />
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
    <div className="flex flex-col gap-0.5">
      {labelEl(inp)}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={toHex(v)}
          onChange={(e) => onChange(inp.name, fromHex(e.target.value, alpha))}
          className="h-6 w-9 cursor-pointer rounded border border-border bg-panel2"
          title={`${inp.label} — RGB`}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={alpha}
          onChange={(e) => onChange(inp.name, [v[0], v[1], v[2], Number(e.target.value)])}
          className="w-16 accent-accent"
          title="Alpha"
        />
      </div>
    </div>
  )
}

// ── point2D → XY pad ─────────────────────────────────────────────────
function XYControl({
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
