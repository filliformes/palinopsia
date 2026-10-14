// SourceFraming : fit / mirror / zoom / pan / crop / feather controls for a video
// or capture source, and its People mode, shown in its Inspector panel. Applied by
// the engine as a transform on upload (Compositor XFORM_FS; People : personMask.ts).

import { useEffect, useState, type ReactNode } from 'react'
import type { SourceSlot } from '@shared/types'
import { useStore } from '../store'
import { personStatus, type PersonStatus } from '../engine/personMask'

function Slider({
  label,
  value,
  min,
  max,
  def,
  onChange,
  fmt,
  hint
}: {
  label: string
  value: number
  min: number
  max: number
  def: number
  onChange: (v: number) => void
  fmt?: (v: number) => string
  /** What the control does (the tooltip, before the reset note). */
  hint?: string
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
        title={`${hint ? hint + ' ' : `${label} : `}double-click to reset (${def})`}
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
  onChange,
  hint
}: {
  label: string
  value: number
  min: number
  max: number
  def: number
  onChange: (v: number) => void
  hint?: string
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
        title={`${hint ? hint + ' ' : `${label} : `}double-click to reset (${def})`}
      />
      <span className="w-8 shrink-0 text-right font-mono text-[9px] text-muted">{value.toFixed(2)}</span>
    </div>
  )
}

function PairRow({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex min-w-0 items-center gap-3">{children}</div>
}

// A row of mutually exclusive buttons (fit, mirror, People mode).
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  className = ''
}: {
  label: string
  value: T
  options: Array<{ v: T; label: string; title: string }>
  onChange: (v: T) => void
  className?: string
}): JSX.Element {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span className="w-12 shrink-0 font-mono text-[9px] uppercase text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            title={o.title}
            className={`rounded border px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
              value === o.v ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:text-text'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** What People finds, under its controls. */
function PeopleReadout({ layer, slot }: { layer: number; slot: 'A' | 'B' }): JSX.Element {
  const [s, setS] = useState<PersonStatus | null>(null)
  useEffect(() => {
    const tick = (): void => {
      const v = personStatus(layer, slot)
      setS(v ? { ...v } : null)
    }
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [layer, slot])
  const text =
    !s || s.state === 'loading'
      ? 'loading the body model…'
      : s.state === 'failed'
        ? `the body model did not load : ${s.error}`
        : s.people === 0
          ? `nobody found · ${s.ms} ms`
          : `${s.people} ${s.people === 1 ? 'person' : 'people'} · ${s.ms} ms`
  return (
    <div
      className="pl-[54px] font-mono text-[9px] text-muted"
      title="How many people the body model finds in this picture, and how long one look takes (it runs beside the picture, never holding it up)"
    >
      {text}
    </div>
  )
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
  const fit = state.fit ?? 'stretch'
  const feather = state.feather ?? 0
  const mirror = state.mirror ?? 'off'
  const person = state.person ?? 'off'
  const people = state.personCount ?? 2
  const blur = state.personBlur ?? 0.5
  const soft = state.personSoft ?? 0.3

  return (
    <div className="flex flex-col gap-1 border-t border-border px-2 py-2">
      <div className="mb-0.5 flex items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted">framing</span>
        <div className="flex-1" />
        <button
          onClick={() =>
            set({ zoom: 1, panX: 0, panY: 0, cropL: 0, cropR: 0, cropT: 0, cropB: 0, fit: 'stretch', feather: 0 })
          }
          className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-accent"
          title="Reset framing (the mirror stays : it is how the camera hangs)"
        >
          reset
        </button>
      </div>
      {/* fit and mirror share one line, split like the pan and crop pairs below */}
      <PairRow>
        <Choice
          className="min-w-0 flex-1"
          label="fit"
          value={fit}
          onChange={(v) => set({ fit: v })}
          options={[
            { v: 'stretch', label: 'stretch', title: 'The whole picture over the whole layer, whatever its shape (a portrait phone or a 4:3 camera gets stretched)' },
            { v: 'cover', label: 'cover', title: 'The picture fills the layer with its shape kept : what sticks out is cut' },
            { v: 'contain', label: 'contain', title: 'All of the picture, its shape kept : the rest of the layer stays transparent' }
          ]}
        />
        <Choice
          className="min-w-0 flex-1"
          label="mirror"
          value={mirror}
          onChange={(v) => set({ mirror: v })}
          options={[
            { v: 'off', label: 'off', title: 'The picture the way it arrives' },
            { v: 'x', label: 'left-right', title: 'Turned left to right, like a mirror : the selfie view of a webcam (you move right, the picture moves right)' },
            { v: 'y', label: 'upside down', title: 'Turned top to bottom : for a camera hung or mounted upside down' },
            { v: 'xy', label: 'both', title: 'Both at once : the picture turned half a turn' }
          ]}
        />
      </PairRow>
      <Slider label="zoom" value={zoom} min={0.1} max={4} def={1} onChange={(v) => set({ zoom: v })} fmt={(v) => `${v.toFixed(2)}×`} />
      <PairRow>
        <MiniSlider label="pan x" value={panX} min={-1} max={1} def={0} onChange={(v) => set({ panX: v })} />
        <MiniSlider label="pan y" value={panY} min={-1} max={1} def={0} onChange={(v) => set({ panY: v })} />
      </PairRow>
      <PairRow>
        <MiniSlider label="crop l" value={cropL} min={0} max={0.9} def={0} onChange={(v) => set({ cropL: v })} hint="Cuts this edge of the picture away (transparent there); the rest stays where it is, never stretched. Zoom to fill again." />
        <MiniSlider label="crop r" value={cropR} min={0} max={0.9} def={0} onChange={(v) => set({ cropR: v })} hint="Cuts this edge of the picture away (transparent there); the rest stays where it is, never stretched. Zoom to fill again." />
      </PairRow>
      <PairRow>
        <MiniSlider label="crop t" value={cropT} min={0} max={0.9} def={0} onChange={(v) => set({ cropT: v })} hint="Cuts this edge of the picture away (transparent there); the rest stays where it is, never stretched. Zoom to fill again." />
        <MiniSlider label="crop b" value={cropB} min={0} max={0.9} def={0} onChange={(v) => set({ cropB: v })} hint="Cuts this edge of the picture away (transparent there); the rest stays where it is, never stretched. Zoom to fill again." />
      </PairRow>
      <Slider label="feather" value={feather} min={0} max={0.5} def={0} onChange={(v) => set({ feather: v })} hint="Softens the edge of the picture (its crop's, or its own when zoomed out), up to half the layer's height. 0 : a crisp edge." />
      {(state.kind === 'video' || state.kind === 'capture') && (
        <>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-wide text-muted">people</span>
          </div>
          <Choice
            label="mode"
            value={person}
            onChange={(v) => set({ person: v })}
            options={[
              { v: 'off', label: 'off', title: 'The picture as it is' },
              { v: 'cutout', label: 'cut out', title: 'Only the people : everything around them transparent' },
              { v: 'blur', label: 'blur', title: 'The people sharp, everything around them blurred' },
              { v: 'remove', label: 'remove', title: 'The room with the people taken out (transparent where they are)' },
              { v: 'matte', label: 'matte', title: 'The people in white on black : to key another layer or feed a Matte node' }
            ]}
          />
          {person !== 'off' && (
            <>
              <Slider
                label="people"
                value={people}
                min={1}
                max={4}
                def={2}
                onChange={(v) => set({ personCount: Math.round(v) })}
                fmt={(v) => String(Math.round(v))}
                hint="How many people to look for, up to 4 (each is found on its own; more costs a little more time per look)." 
              />
              {person === 'blur' && (
                <Slider label="blur" value={blur} min={0} max={1} def={0.5} onChange={(v) => set({ personBlur: v })} hint="How much the room around the people is blurred." />
              )}
              <Slider label="edge" value={soft} min={0} max={1} def={0.3} onChange={(v) => set({ personSoft: v })} hint="The outline of the people : 0 a hard cut, 1 a soft fade." />
              <PeopleReadout layer={layer} slot={slot} />
            </>
          )}
        </>
      )}
    </div>
  )
}
