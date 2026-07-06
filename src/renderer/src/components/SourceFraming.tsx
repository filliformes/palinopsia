// SourceFraming — zoom / pan / crop controls for a video or capture source,
// shown in its Inspector panel. Applied by the engine as a transform on upload.

import type { ReactNode } from 'react'
import type { SourceSlot } from '@shared/types'
import { useStore } from '../store'

function Slider({
  label,
  value,
  min,
  max,
  def,
  onChange,
  fmt
}: {
  label: string
  value: number
  min: number
  max: number
  def: number
  onChange: (v: number) => void
  fmt?: (v: number) => string
}): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-12 shrink-0 font-mono text-[9px] uppercase text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={(max - min) / 200}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(def)}
        className="min-w-0 flex-1 accent-accent"
        title={`${label} — double-click to reset (${def})`}
      />
      <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted">
        {(fmt ?? ((v) => v.toFixed(2)))(value)}
      </span>
    </div>
  )
}

// Two compact sliders sharing one line (Pan X/Y, Crop L/R, Crop T/B).
function MiniSlider({
  label,
  value,
  min,
  max,
  def,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  def: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <span className="shrink-0 font-mono text-[9px] uppercase text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={(max - min) / 200}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(def)}
        className="min-w-0 flex-1 accent-accent"
        title={`${label} — double-click to reset (${def})`}
      />
      <span className="w-8 shrink-0 text-right font-mono text-[9px] text-muted">{value.toFixed(2)}</span>
    </div>
  )
}

function PairRow({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex min-w-0 items-center gap-3">{children}</div>
}

export function SourceFraming({
  layer,
  slot,
  state
}: {
  layer: number
  slot: 'A' | 'B'
  state: SourceSlot
}): JSX.Element {
  const setSourceTransform = useStore((s) => s.setSourceTransform)
  const set = (patch: Parameters<typeof setSourceTransform>[2]): void =>
    setSourceTransform(layer, slot, patch)

  const zoom = state.zoom ?? 1
  const panX = state.panX ?? 0
  const panY = state.panY ?? 0
  const cropL = state.cropL ?? 0
  const cropR = state.cropR ?? 0
  const cropT = state.cropT ?? 0
  const cropB = state.cropB ?? 0

  return (
    <div className="flex flex-col gap-1 border-t border-border px-2 py-2">
      <div className="mb-0.5 flex items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted">framing</span>
        <div className="flex-1" />
        <button
          onClick={() =>
            set({ zoom: 1, panX: 0, panY: 0, cropL: 0, cropR: 0, cropT: 0, cropB: 0 })
          }
          className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-accent"
          title="Reset framing"
        >
          reset
        </button>
      </div>
      <Slider label="zoom" value={zoom} min={0.1} max={4} def={1} onChange={(v) => set({ zoom: v })} fmt={(v) => `${v.toFixed(2)}×`} />
      <PairRow>
        <MiniSlider label="pan x" value={panX} min={-1} max={1} def={0} onChange={(v) => set({ panX: v })} />
        <MiniSlider label="pan y" value={panY} min={-1} max={1} def={0} onChange={(v) => set({ panY: v })} />
      </PairRow>
      <PairRow>
        <MiniSlider label="crop l" value={cropL} min={0} max={0.9} def={0} onChange={(v) => set({ cropL: v })} />
        <MiniSlider label="crop r" value={cropR} min={0} max={0.9} def={0} onChange={(v) => set({ cropR: v })} />
      </PairRow>
      <PairRow>
        <MiniSlider label="crop t" value={cropT} min={0} max={0.9} def={0} onChange={(v) => set({ cropT: v })} />
        <MiniSlider label="crop b" value={cropB} min={0} max={0.9} def={0} onChange={(v) => set({ cropB: v })} />
      </PairRow>
    </div>
  )
}
