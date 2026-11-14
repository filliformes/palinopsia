// Feel : whole-picture dials over everything at once, in their own right-column
// tab (G). Each rides on top of your settings (it writes the engine, never your
// sliders) and saves with the session; each rests at a point that changes
// nothing. Two groups : FIELD (space and matter, rest at 0.5) and TEMPERAMENT
// (time and color, rest at 0 except Interruption ⇄ Flow at 0.5). A dial that
// cannot act now (Tonicity with the audio input off, Superimposition with one
// visible layer) is greyed with the reason, and still moves.

import type { ReactNode } from 'react'
import { useStore } from '../store'
import { Blink } from './Blink'
import { MidiLearnOverlay } from './MidiLearnOverlay'
import { feelOffRest } from '../feelState'

function FeelRow({
  label,
  left,
  right,
  value,
  neutral,
  desc,
  hint,
  midiId,
  onChange,
  dim,
  extra
}: {
  label: string
  left: string
  right: string
  value: number
  neutral: number
  desc: string
  /** What it does, for the hover (the double-click note is added). */
  hint: string
  midiId: string
  onChange: (v: number) => void
  /** Why it cannot act now : greyed with this reason (it still moves). */
  dim?: string
  /** A small control beside the readout (Proximity's ◑). */
  extra?: ReactNode
}): JSX.Element {
  const active = Math.abs(value - neutral) > 0.02
  const bipolar = neutral > 0.02 && neutral < 0.98
  const rest = neutral === 0 ? 'off' : `rest (${neutral.toFixed(2)})`
  return (
    <div
      className={`rounded border px-2 py-1.5 transition-colors ${
        active ? 'border-accent/40 bg-panel2' : 'border-border bg-panel2/40'
      } ${dim ? 'opacity-50' : ''}`}
      title={dim ? `${label} : ${dim}. It still moves, and acts as soon as it can.` : undefined}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold">{label}</span>
        <span className="flex items-baseline gap-1.5">
          {extra}
          <span className={`font-mono text-[10px] ${active ? 'text-accent' : 'text-muted'}`}>
            {value.toFixed(2)}
          </span>
        </span>
      </div>
      <div className="relative">
        <MidiLearnOverlay id={midiId} />
        {bipolar && (
          // Centre tick for the dials that rest in the middle.
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
          title={`${hint} Double-click : ${rest}.`}
        />
      </div>
      <div className="flex justify-between font-mono text-[9px] uppercase tracking-wide text-muted">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      <p className="mt-0.5 text-[9px] leading-tight text-muted">{dim ? `${desc} (${dim})` : desc}</p>
    </div>
  )
}

export function FeelPanel(): JSX.Element {
  const density = useStore((s) => s.density)
  const setDensity = useStore((s) => s.setDensity)
  const proximity = useStore((s) => s.proximity)
  const setProximity = useStore((s) => s.setProximity)
  const proximityAudio = useStore((s) => s.proximityAudio)
  const setProximityAudio = useStore((s) => s.setProximityAudio)
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
  // what a dial needs to act : the audio input (Tonicity), two visible layers
  // (Superimposition)
  const audioOn = useStore((s) => s.audioEnabled)
  const visible = useStore((s) => s.composition.layers.filter((L) => L && !L.mute && L.opacity > 0.001 && L.sourceA.kind !== 'none').length)

  // Every dial back to rest in one gesture (double-click resets one row).
  const resetAll = (): void => {
    setDensity(0.5); setProximity(0.5); setProximityAudio(false); setGestureTexture(0.5); setCoalesce(0.5); setFlow(0.5)
    setTonicity(0); setShutter(0); setDrift(0); setSuperFlicker(0)
  }
  const off = feelOffRest({ density, proximity, proximityAudio, gestureTexture, coalesce, flow, tonicity, shutter, drift, superFlicker })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span
          className="font-mono text-[9px] uppercase tracking-wide text-muted"
          title="Whole-picture dials : they bend everything at once, on top of your layers and Finishing (your sliders stay where they are). They save with the session; each rests at a point that changes nothing."
        >
          Feel : whole-picture dials
        </span>
        <button
          onClick={resetAll}
          disabled={!off.length}
          className="relative rounded px-1 py-0.5 text-[12px] leading-none text-muted transition-colors hover:text-accent disabled:opacity-30"
          title={off.length ? `Every Feel dial back to rest (the middle, or off) : ${off.join(' · ')}` : 'Every Feel dial is at rest'}
        >
          ↺
          <Blink />
        </button>
      </div>
      <section className="flex flex-col gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted" title="How full, how far and how sharp the picture is">Field · space and matter</span>
        <FeelRow
          label="Density" left="sparse" right="dense" value={density} neutral={0.5} midiId="field:density" onChange={setDensity}
          desc="Thins the upper layers out (L4 first) or fills every layer in. The faders stay put."
          hint="Density : left fades the upper layers toward one voice, right pushes every layer toward full."
        />
        <FeelRow
          label="Proximity" left="far" right="close" value={proximity} neutral={0.5} midiId="transport:prox" onChange={setProximity}
          desc="Far : hazy, soft, a deeper vignette. Close : sharp, with more bloom."
          hint="Proximity : far in the haze, or close and bright."
          extra={
            <button
              onClick={() => setProximityAudio(!proximityAudio)}
              className={`shrink-0 rounded px-1 font-mono text-[9px] leading-tight ${
                proximityAudio ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'
              }`}
              title={`Follow the sound : the brighter the sound, the closer the picture comes (${proximityAudio ? 'on' : 'off'}; it needs the audio input)`}
            >
              ◑
            </button>
          }
        />
        <FeelRow
          label="Gesture ⇄ Texture" left="crisp" right="smeared" value={gestureTexture} neutral={0.5} midiId="field:gestureTexture" onChange={setGestureTexture}
          desc="Left sharpens, so movement reads as clean strokes. Right adds trails, so it churns into a surface."
          hint="Gesture ⇄ Texture : sharpen on the left, trails on the right."
        />
        <FeelRow
          label="Coalesce" left="grain" right="mass" value={coalesce} neutral={0.5} midiId="field:coalesce" onChange={setCoalesce}
          desc="Left breaks the picture into dither grain. Right melts it into one soft mass (it adds blur)."
          hint="Coalesce : dither on the left, blur on the right."
        />
      </section>
      <section className="flex flex-col gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted" title="How the picture moves through time, and how the sound and chance move its color">Temperament · time and color</span>
        <FeelRow
          label="Interruption ⇄ Flow" left="interruption" right="flow" value={flow} neutral={0.5} midiId="field:flow" onChange={setFlow}
          desc="Left stutters : held frames, breakup, short black cuts. Right runs liquid : trails, softness, less grain."
          hint="Interruption ⇄ Flow : a broken passage on the left, a liquid one on the right."
        />
        <FeelRow
          label="Tonicity" left="off" right="full" value={tonicity} neutral={0} midiId="field:tonicity" onChange={setTonicity}
          desc="Tonal sound brings color in, noisy sound drains it toward gray."
          hint="Tonicity : how much the sound colors the picture."
          dim={audioOn ? undefined : 'the audio input is off (Connect, A)'}
        />
        <FeelRow
          label="Shutter" left="off" right="24 fps" value={shutter} neutral={0} midiId="field:shutter" onChange={setShutter}
          desc="Steps the whole output like stop-motion. Just past off is the choppiest (2 fps); further right gets smoother."
          hint="Shutter : 2 frames a second just past off, 24 at the right end."
        />
        <FeelRow
          label="Wander" left="off" right="wander" value={drift} neutral={0} midiId="field:drift" onChange={setDrift}
          desc="A slow, never-repeating sway of the grade (gamma, warm and cool, contrast), with rare short glitches."
          hint="Wander : the grade sways on its own, so a still passage breathes."
        />
        <FeelRow
          label="Superimposition" left="off" right="hard cut" value={superFlicker} neutral={0} midiId="field:superFlicker" onChange={setSuperFlicker}
          desc="Flickers between your layers, one at a time, at the film rate."
          hint="Superimposition : how hard the other layers drop out while one shows."
          dim={visible >= 2 ? undefined : 'it needs two visible layers'}
        />
      </section>
    </div>
  )
}
