// Feel : the global macro controls, moved out of the cramped Transport bar into
// their own right-column tab (beside Layers / Mixer / Finishing). Two groups :
// FIELD (spatial/material, rest at 0.5) and TEMPERAMENT (film character, rest at
// 0 except Flow at 0.5). Each row gets room for a wide slider + live readout +
// the two poles + a one-line description. Reach it with the G key.

import { useStore } from '../store'
import { MidiLearnOverlay } from './MidiLearnOverlay'

function FeelRow({
  label,
  left,
  right,
  value,
  neutral,
  desc,
  midiId,
  onChange
}: {
  label: string
  left: string
  right: string
  value: number
  neutral: number
  desc: string
  midiId: string
  onChange: (v: number) => void
}): JSX.Element {
  const active = Math.abs(value - neutral) > 0.02
  const bipolar = neutral > 0.02 && neutral < 0.98
  return (
    <div
      className={`rounded border px-2 py-1.5 transition-colors ${
        active ? 'border-accent/40 bg-panel2' : 'border-border bg-panel2/40'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold">{label}</span>
        <span className={`font-mono text-[10px] ${active ? 'text-accent' : 'text-muted'}`}>
          {value.toFixed(2)}
        </span>
      </div>
      <div className="relative">
        <MidiLearnOverlay id={midiId} />
        {bipolar && (
          // Centre tick for the 0.5-neutral (bipolar) macros.
          <div className="pointer-events-none absolute left-1/2 top-0 z-10 h-full w-px -translate-x-1/2 bg-border" />
        )}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(neutral)}
          className="relative w-full accent-accent"
          title={`${label} : drag · double-click resets to ${neutral === 0 ? 'off' : neutral.toFixed(2)}`}
        />
      </div>
      <div className="flex justify-between font-mono text-[9px] uppercase tracking-wide text-muted">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      <p className="mt-0.5 text-[9px] leading-tight text-muted">{desc}</p>
    </div>
  )
}

export function FeelPanel(): JSX.Element {
  const density = useStore((s) => s.density)
  const setDensity = useStore((s) => s.setDensity)
  const gestureTexture = useStore((s) => s.gestureTexture)
  const setGestureTexture = useStore((s) => s.setGestureTexture)
  const coalesce = useStore((s) => s.coalesce)
  const setCoalesce = useStore((s) => s.setCoalesce)
  const tonicity = useStore((s) => s.tonicity)
  const setTonicity = useStore((s) => s.setTonicity)
  const shutter = useStore((s) => s.shutter)
  const setShutter = useStore((s) => s.setShutter)
  const drift = useStore((s) => s.drift)
  const setDrift = useStore((s) => s.setDrift)
  const flow = useStore((s) => s.flow)
  const setFlow = useStore((s) => s.setFlow)
  const superFlicker = useStore((s) => s.superFlicker)
  const setSuperFlicker = useStore((s) => s.setSuperFlicker)

  // Return all eight macros to their rest values in one gesture (double-click
  // only resets one row) — the Feel counterpart to Modulation's global mute.
  const resetAll = (): void => {
    setDensity(0.5); setGestureTexture(0.5); setCoalesce(0.5); setFlow(0.5)
    setTonicity(0); setShutter(0); setDrift(0); setSuperFlicker(0)
  }
  const anyOff =
    Math.abs(density - 0.5) > 0.02 || Math.abs(gestureTexture - 0.5) > 0.02 ||
    Math.abs(coalesce - 0.5) > 0.02 || Math.abs(flow - 0.5) > 0.02 ||
    tonicity > 0.02 || shutter > 0.02 || drift > 0.02 || superFlicker > 0.02

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted">Feel · global macros</span>
        <button
          onClick={resetAll}
          disabled={!anyOff}
          className="rounded px-1 py-0.5 text-[12px] leading-none text-muted transition-colors hover:text-accent disabled:opacity-30"
          title="Reset all eight Feel macros to neutral"
        >
          ↺
        </button>
      </div>
      <section className="flex flex-col gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted">Field · spatial + material</span>
        <FeelRow
          label="Density" left="sparse" right="dense" value={density} neutral={0.5} midiId="field:density" onChange={setDensity}
          desc="Fades the upper layers out (sparse) or fills them in (dense)."
        />
        <FeelRow
          label="Gesture ⇄ Texture" left="gesture" right="texture" value={gestureTexture} neutral={0.5} midiId="field:gestureTexture" onChange={setGestureTexture}
          desc="Clean directional movement (sharpen) ↔ internalised churn (trails)."
        />
        <FeelRow
          label="Coalesce" left="grain" right="mass" value={coalesce} neutral={0.5} midiId="field:coalesce" onChange={setCoalesce}
          desc="Broken into grain/dither ↔ pulled into smooth mass (blur)."
        />
      </section>
      <section className="flex flex-col gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted">Temperament · film character</span>
        <FeelRow
          label="Flow ⇄ Interruption" left="interruption" right="flow" value={flow} neutral={0.5} midiId="field:flow" onChange={setFlow}
          desc="Stutter — frame-holds, breakup, blank stabs ↔ a liquid, continuous image."
        />
        <FeelRow
          label="Tonicity" left="off" right="colour" value={tonicity} neutral={0} midiId="field:tonicity" onChange={setTonicity}
          desc="Tonal/harmonic audio pulls colour in; noise pulls toward black-and-white (needs Audio on)."
        />
        <FeelRow
          label="Shutter" left="off" right="stepped" value={shutter} neutral={0} midiId="field:shutter" onChange={setShutter}
          desc="Global full-freeze stop-motion : low = chunky (~2fps) → high = fluid (~24fps)."
        />
        <FeelRow
          label="Drift" left="off" right="wander" value={drift} neutral={0} midiId="field:drift" onChange={setDrift}
          desc="Slow analog-instability wander over the grade + rare accidents."
        />
        <FeelRow
          label="Superimposition" left="off" right="strobe" value={superFlicker} neutral={0} midiId="field:superFlicker" onChange={setSuperFlicker}
          desc="Hypnagogic strobe : cross-cuts which layer shows on the drawn cadence."
        />
      </section>
    </div>
  )
}
