// Modulation panel (brief §10.4): the 8-modulator bank + the capped
// mod-matrix. Each card: type, clock (free Hz / BPM division), the active
// type's key parameters, output curve, and a live meter. The meters are
// painted by ONE rAF loop writing DOM styles directly from modEngine.values —
// modulation never re-renders React at 60 Hz.

import { useEffect, useRef, type ReactNode } from 'react'
import type { ArpMode, AudioFeature, LfoShape, ModulatorType, MotionShape, PhysicsMotion } from '@shared/types'
import { MAX_MOD_ASSIGNMENTS, MOTION_SHAPES, WORLD_AUTOMOD_SLOT } from '@shared/types'
import { DIVISIONS, modEngine } from '../engine/modulation'
import { AUDIO_BANDS, AUDIO_FEATURES } from '../engine/audioIn'
import { SHADER_BY_ID } from '../shaders/isf'
import { modTargetKey, useStore } from '../store'
import { BoundedNumberInput } from './BoundedNumberInput'

const MOD_TYPES: ModulatorType[] = ['lfo', 'ramp', 'adsr', 'arp', 'random', 'sh', 'slew', 'chaos', 'audio', 'organic', 'physics', 'motion']
const LFO_SHAPES: LfoShape[] = ['sine', 'triangle', 'square', 'sawtooth', 'rndStep', 'rndSmooth', 'spastic']
const ARP_MODES: ArpMode[] = ['up', 'down', 'upDown', 'random', 'drunk']
const PHYSICS_MOTIONS: PhysicsMotion[] = ['bounce', 'spring', 'riser']

export function ModulationPanel(): JSX.Element {
  const modulators = useStore((s) => s.composition.modulators)
  const collapsed = useStore((s) => !!s.collapsed['modulation'])
  const toggleSection = useStore((s) => s.toggleSection)
  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-border bg-panel px-3 py-1.5">
      <div className="flex items-baseline gap-3">
        <button
          onClick={() => toggleSection('modulation')}
          className="flex shrink-0 items-center gap-1.5"
          title={collapsed ? 'Expand modulation' : 'Collapse modulation'}
        >
          <span
            className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
          >
            ▶
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
            Modulation
          </span>
        </button>
        <MatrixSummary />
      </div>
      {!collapsed && (
        // Eight equal columns across the full width : every card the same
        // size, so the section's shape never changes as types are swapped.
        <div className="grid min-w-0 grid-cols-8 gap-2 pb-1">
          {modulators.map((_, i) => (
            <ModCard key={i} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── One modulator card ────────────────────────────────────────────────
function ModCard({ index }: { index: number }): JSX.Element {
  const m = useStore((s) => s.composition.modulators[index])
  const update = useStore((s) => s.updateModulator)

  return (
    // Fixed height + min-w-0 so all eight cards are identical regardless of
    // type : the section keeps one silhouette as types are swapped.
    <div
      className={`flex h-36 min-w-0 flex-col gap-1 rounded border p-1.5 transition-colors ${
        m.enabled ? 'border-accent/60 bg-panel2' : 'border-border bg-panel2/40'
      }`}
    >
      <div className="flex items-center gap-1">
        <button
          onClick={() => update(index, { enabled: !m.enabled })}
          className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${
            m.enabled ? 'bg-accent' : 'bg-panel3'
          }`}
          title={m.enabled ? 'On : click to disable' : 'Off : click to enable'}
        />
        <span className="font-mono text-[10px] text-muted">M{index + 1}</span>
        {index === WORLD_AUTOMOD_SLOT && (
          <span
            className="shrink-0 font-mono text-[9px] text-accent2"
            title="Reserved for the active World's audio routing : set it in the World editor. Skipped by Randomize."
          >
            ⊛
          </span>
        )}
        <select
          className="input select-compact min-w-0 flex-1 text-[10px]"
          value={m.type}
          onChange={(e) => update(index, { type: e.target.value as ModulatorType })}
          title="The modulator's shape : what kind of moving signal this slot produces (LFO waves, ramp, ADSR envelope, arpeggio, random, sample&hold, slew, chaos, audio-follower, organic, physics, motion). Bind it to parameters with their M button."
        >
          {MOD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          onClick={() => modEngine.retrigger(index)}
          className="shrink-0 rounded bg-panel3/60 px-1 font-mono text-[9px] text-muted hover:text-accent"
          title="Retrigger : restart ramp/ADSR/arp from zero"
        >
          ⟳
        </button>
      </div>

      {/* live meter */}
      <Meter index={index} />

      {/* clock : everything except ramp/adsr/audio is clock-driven
          (audio is driven by the signal itself) */}
      {m.type !== 'ramp' && m.type !== 'adsr' && m.type !== 'audio' && (
        <div className="flex min-w-0 items-center gap-1">
          <button
            onClick={() => update(index, { sync: m.sync === 'bpm' ? 'free' : 'bpm' })}
            className={`shrink-0 rounded px-1 py-0.5 font-mono text-[9px] ${
              m.sync === 'bpm' ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'
            }`}
            title="Clock: free Hz or BPM-synced division"
          >
            {m.sync === 'bpm' ? 'BPM' : 'HZ'}
          </button>
          {m.sync === 'bpm' ? (
            <select
              className="input select-compact min-w-0 flex-1 text-[10px]"
              value={m.divisionIdx}
              onChange={(e) => update(index, { divisionIdx: Number(e.target.value) })}
              title="Note division : the modulator's rate as a fraction of the beat (locked to BPM)."
            >
              {DIVISIONS.map((d, i) => (
                <option key={d.label} value={i}>
                  {d.label}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                type="range"
                min={-2}
                max={1.3}
                step={0.01}
                value={Math.log10(Math.max(0.01, m.rateHz))}
                onChange={(e) => update(index, { rateHz: Math.pow(10, Number(e.target.value)) })}
                className="min-w-0 flex-1 accent-accent"
                title={`Rate: ${m.rateHz.toFixed(2)} Hz (log)`}
              />
              <BoundedNumberInput
                value={m.rateHz}
                min={0.01}
                max={20}
                onChange={(v) => update(index, { rateHz: v })}
                className="input w-12 shrink-0 px-0.5 py-0.5 text-right text-[9px]"
              />
            </>
          )}
          {/* Slew's target-pick mode rides the rate line to save a row. */}
          {m.type === 'slew' && (
            <button
              onClick={() => update(index, { slew: { ...m.slew, randomTarget: !m.slew.randomTarget } })}
              className={`shrink-0 rounded px-1 py-0.5 font-mono text-[9px] ${
                m.slew.randomTarget
                  ? 'bg-accent/20 text-accent ring-1 ring-accent'
                  : 'bg-panel3/60 text-muted'
              }`}
              title="Random target : slew toward a fresh random value each step (vs. alternating)"
            >
              RND
            </button>
          )}
          {/* S&H's smooth flag rides the rate line too, for the same reason. */}
          {m.type === 'sh' && (
            <button
              onClick={() => update(index, { sh: { ...m.sh, smooth: !m.sh.smooth } })}
              className={`shrink-0 rounded px-1 py-0.5 font-mono text-[9px] ${
                m.sh.smooth
                  ? 'bg-accent/20 text-accent ring-1 ring-accent'
                  : 'bg-panel3/60 text-muted'
              }`}
              title="Smooth : glide between held samples instead of stepping"
            >
              SMTH
            </button>
          )}
        </div>
      )}

      {/* type-specific params (output shaping lives on the Meta knobs, not
          here : modulators emit their raw signal) */}
      <TypeParams index={index} />
    </div>
  )
}

function TypeParams({ index }: { index: number }): JSX.Element | null {
  const m = useStore((s) => s.composition.modulators[index])
  const update = useStore((s) => s.updateModulator)

  switch (m.type) {
    case 'lfo':
      return (
        <Row label="SHAPE">
          <select
            className="input select-compact min-w-0 flex-1 text-[10px]"
            value={m.shape}
              title="LFO waveform : the shape of the repeating wave."
            onChange={(e) => update(index, { shape: e.target.value as LfoShape })}
          >
            {LFO_SHAPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Row>
      )
    case 'ramp':
      return (
        <>
          <NumRow label="MS" value={m.ramp.rampMs} min={50} max={120000}
            onChange={(v) => update(index, { ramp: { ...m.ramp, rampMs: v } })} />
          <NumRow label="CURVE%" value={m.ramp.curvePct} min={-100} max={100}
            onChange={(v) => update(index, { ramp: { ...m.ramp, curvePct: v } })} />
          <Row label="MODE">
            <select
              className="input select-compact min-w-0 flex-1 text-[10px]"
              value={m.ramp.mode}
              title="Ramp direction : normal (rise once), inverted (fall once), or loop (repeat)."
              onChange={(e) =>
                update(index, { ramp: { ...m.ramp, mode: e.target.value as 'normal' | 'inverted' | 'loop' } })
              }
            >
              <option value="loop">loop</option>
              <option value="normal">one-shot</option>
              <option value="inverted">inverted</option>
            </select>
          </Row>
        </>
      )
    case 'adsr':
      // a/d/s/r are little duration sliders (2×2); SUS level + LOOP share a row.
      return (
        <>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            <MiniSlider label="A" value={m.adsr.attackMs} min={0} max={30000}
              onChange={(v) => update(index, { adsr: { ...m.adsr, attackMs: v } })} />
            <MiniSlider label="D" value={m.adsr.decayMs} min={0} max={30000}
              onChange={(v) => update(index, { adsr: { ...m.adsr, decayMs: v } })} />
            <MiniSlider label="S" value={m.adsr.sustainMs} min={0} max={60000}
              onChange={(v) => update(index, { adsr: { ...m.adsr, sustainMs: v } })} />
            <MiniSlider label="R" value={m.adsr.releaseMs} min={0} max={30000}
              onChange={(v) => update(index, { adsr: { ...m.adsr, releaseMs: v } })} />
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <span className="w-10 shrink-0 font-mono text-[9px] text-muted">SUS</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={m.adsr.sustainLevel}
              onChange={(e) => update(index, { adsr: { ...m.adsr, sustainLevel: Number(e.target.value) } })}
              className="min-w-0 flex-1 accent-accent"
              title={`Sustain level ${m.adsr.sustainLevel.toFixed(2)}`}
            />
            <button
              onClick={() => update(index, { adsr: { ...m.adsr, loop: !m.adsr.loop } })}
              className={`shrink-0 rounded px-1 py-0.5 font-mono text-[9px] ${
                m.adsr.loop
                  ? 'bg-accent/20 text-accent ring-1 ring-accent'
                  : 'bg-panel3/60 text-muted'
              }`}
              title="Loop the envelope"
            >
              LOOP
            </button>
          </div>
        </>
      )
    case 'arp':
      return (
        <>
          <NumRow label="STEPS" value={m.arp.steps} min={2} max={16} integer
            onChange={(v) => update(index, { arp: { ...m.arp, steps: v } })} />
          <Row label="MODE">
            <select
              className="input select-compact min-w-0 flex-1 text-[10px]"
              value={m.arp.mode}
              title="Step order : how the arpeggiator walks its steps (up / down / up-down / random / drunk)."
              onChange={(e) => update(index, { arp: { ...m.arp, mode: e.target.value as ArpMode } })}
            >
              {ARP_MODES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Row>
        </>
      )
    case 'random':
      return (
        <SliderRow label="DIST" value={m.random.distribution} min={0} max={1}
          title="Distribution : 0.5 uniform · >0.5 centre-hug · <0.5 edge-weight"
          onChange={(v) => update(index, { random: { distribution: v } })} />
      )
    case 'sh':
      // SMTH lives on the rate line (see the clock row) : only PROB/DIST here.
      return (
        <>
          <SliderRow label="PROB" value={m.sh.probability} min={0} max={1}
            title="Chance a clock draws a fresh sample : below 1 locks patterns"
            onChange={(v) => update(index, { sh: { ...m.sh, probability: v } })} />
          <SliderRow label="DIST" value={m.sh.distribution} min={0} max={1}
            title="Distribution : 0.5 = uniform random · <0.5 favours the extremes · >0.5 hugs the centre"
            onChange={(v) => update(index, { sh: { ...m.sh, distribution: v } })} />
        </>
      )
    case 'slew':
      // RND lives on the rate line (see the clock row) : only RISE/FALL here.
      return (
        <>
          <NumRow label="RISE" value={m.slew.riseMs} min={1} max={10000}
            onChange={(v) => update(index, { slew: { ...m.slew, riseMs: v } })} />
          <NumRow label="FALL" value={m.slew.fallMs} min={1} max={10000}
            onChange={(v) => update(index, { slew: { ...m.slew, fallMs: v } })} />
        </>
      )
    case 'chaos':
      return (
        <SliderRow label="R" value={m.chaos.r} min={3.4} max={4} step={0.005}
          title="Logistic-map r : toward 4 = wilder"
          onChange={(v) => update(index, { chaos: { r: v } })} />
      )
    case 'audio': {
      const a = m.audio ?? { feature: 'level' as AudioFeature, band: 0, smooth: 0.2 }
      return (
        <>
          <Row label="FEAT">
            <select
              className="input select-compact min-w-0 flex-1 text-[10px]"
              value={a.feature}
              title="Which audio feature this modulator follows (level, flux, transient, centroid, band, pitch)."
              onChange={(e) => update(index, { audio: { ...a, feature: e.target.value as AudioFeature } })}
            >
              {AUDIO_FEATURES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Row>
          {a.feature === 'band' && (
            <NumRow label="BAND" value={a.band + 1} min={1} max={AUDIO_BANDS} integer
              onChange={(v) => update(index, { audio: { ...a, band: Math.round(v) - 1 } })} />
          )}
          <SliderRow label="SMOOTH" value={a.smooth} min={0} max={0.99}
            title="One-pole smoothing : 0 snaps to the signal, →1 glides"
            onChange={(v) => update(index, { audio: { ...a, smooth: v } })} />
        </>
      )
    }
    case 'organic': {
      const o = m.organic ?? { variation: 0.5 }
      return (
        <SliderRow label="VARY" value={o.variation} min={0} max={1}
          title="Irregularity : 0 near-periodic · →1 wanders (never repeats)"
          onChange={(v) => update(index, { organic: { variation: v } })} />
      )
    }
    case 'physics': {
      const p = m.physics ?? { motion: 'bounce' as PhysicsMotion, damping: 0.5 }
      return (
        <>
          <Row label="MOTION">
            <select
              className="input select-compact min-w-0 flex-1 text-[10px]"
              value={p.motion}
              title="Physics model : bounce (a ball), spring (damped oscillation), or riser (accelerating ramp)."
              onChange={(e) => update(index, { physics: { ...p, motion: e.target.value as PhysicsMotion } })}
            >
              {PHYSICS_MOTIONS.map((mo) => (
                <option key={mo} value={mo}>
                  {mo}
                </option>
              ))}
            </select>
          </Row>
          <SliderRow label="DAMP" value={p.damping} min={0} max={1}
            title="Damping : bounce restitution / spring settle"
            onChange={(v) => update(index, { physics: { ...p, damping: v } })} />
        </>
      )
    }
    case 'motion': {
      const mt = m.motion ?? { shape: 'oscillation' as MotionShape }
      return (
        <Row label="SHAPE">
          <select
            className="input select-compact min-w-0 flex-1 text-[10px]"
            value={mt.shape}
            onChange={(e) => update(index, { motion: { shape: e.target.value as MotionShape } })}
            title="Named motion archetype / force behaviour : a characteristic trajectory"
          >
            {MOTION_SHAPES.map((sh) => (
              <option key={sh} value={sh}>
                {sh}
              </option>
            ))}
          </select>
        </Row>
      )
    }
    default:
      return null
  }
}

// ── Small row helpers ─────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="w-10 shrink-0 font-mono text-[9px] text-muted">{label}</span>
      {children}
    </div>
  )
}

function NumRow({
  label, value, min, max, integer, onChange
}: {
  label: string; value: number; min: number; max: number; integer?: boolean
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <Row label={label}>
      <BoundedNumberInput
        value={value}
        min={min}
        max={max}
        integer={integer}
        onChange={onChange}
        className="input w-full min-w-0 px-1 py-0.5 text-right text-[10px]"
      />
    </Row>
  )
}

// A hair-thin label + a small slider : for the ADSR a/d/s/r segment durations,
// where four have to sit two-up in one card. Value lives in the tooltip.
function MiniSlider({
  label, value, min, max, onChange
}: {
  label: string; value: number; min: number; max: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="w-2.5 shrink-0 font-mono text-[9px] text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
        title={`${label} ${Math.round(value)} ms`}
      />
    </div>
  )
}

function SliderRow({
  label, value, min, max, step = 0.01, title, onChange
}: {
  label: string; value: number; min: number; max: number; step?: number; title?: string
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <Row label={label}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
        title={title}
      />
      {/* Every slider carries an editable numeric readout. */}
      <BoundedNumberInput
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        className="input w-12 shrink-0 px-0.5 py-0.5 text-right text-[9px]"
      />
    </Row>
  )
}


// ── Live meter : one rAF per meter, direct style writes ───────────────
function Meter({ index }: { index: number }): JSX.Element {
  const barRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    let raf = 0
    const paint = (): void => {
      const el = barRef.current
      if (el) el.style.width = `${Math.round(modEngine.values[index] * 100)}%`
      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [index])
  return (
    <div className="h-1 w-full overflow-hidden rounded bg-panel3/50">
      <div ref={barRef} className="h-full bg-accent/80" style={{ width: '0%' }} />
    </div>
  )
}

// ── Matrix summary : every assignment, with depth + remove ────────────
function MatrixSummary(): JSX.Element {
  const matrix = useStore((s) => s.composition.modMatrix)
  const composition = useStore((s) => s.composition)
  const removeAssignment = useStore((s) => s.removeAssignment)
  const setAssignmentDepth = useStore((s) => s.setAssignmentDepth)

  function describe(a: (typeof matrix)[number]): string {
    const t = a.target
    if (t.kind === 'source') return `L${t.layer + 1}·${t.slot} ${t.input}`
    if (t.kind === 'bgSource') return `BG ${t.input}`
    if (t.kind === 'meta') {
      const name = composition.metaKnobs[t.knob]?.name ?? `Knob ${t.knob + 1}`
      return `META K${t.knob + 1} (${name})`
    }
    const inst =
      t.scope.kind === 'master'
        ? composition.master.find((f) => f.id === t.instId)
        : t.scope.kind === 'background'
          ? composition.background?.fx.find((f) => f.id === t.instId)
          : (t.scope.kind === 'layer'
              ? composition.layers[t.scope.layer]?.fx
              : t.scope.kind === 'sourceA'
                ? composition.layers[t.scope.layer]?.sourceAFx
                : composition.layers[t.scope.layer]?.sourceBFx
            )?.find((f) => f.id === t.instId)
    const fxName = inst?.shaderId ? (SHADER_BY_ID[inst.shaderId]?.name ?? '?') : '?'
    const where =
      t.scope.kind === 'master' ? 'MST' : t.scope.kind === 'background' ? 'BG' : `L${t.scope.layer + 1}`
    return `${where}·${fxName} ${t.input}`
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <span className="font-mono text-[9px] text-muted">
        {matrix.length}/{MAX_MOD_ASSIGNMENTS}
      </span>
      {matrix.map((a) => (
        <span
          key={a.id}
          className="flex items-center gap-1 rounded border border-border bg-panel2 px-1.5 py-0.5 font-mono text-[9px]"
        >
          <span className="text-accent">M{a.mod + 1}</span>
          <span className="max-w-[160px] truncate text-muted" title={describe(a)}>
            {describe(a)}
          </span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={a.depth}
            onChange={(e) => setAssignmentDepth(a.id, Number(e.target.value))}
            className="w-14 accent-accent"
            title={`Depth ${a.depth.toFixed(2)} (bipolar)`}
          />
          <button
            onClick={() => removeAssignment(a.id)}
            className="text-muted hover:text-danger"
            title="Remove assignment"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  )
}
