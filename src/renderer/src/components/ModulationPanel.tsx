// Modulation panel (brief §10.4): the 8-modulator bank + the capped
// mod-matrix. Each card: type, clock (free Hz / BPM division), the active
// type's key parameters, output curve, and a live meter. The meters are
// painted by ONE rAF loop writing DOM styles directly from modEngine.values —
// modulation never re-renders React at 60 Hz.

import { useEffect, useRef, type ReactNode } from 'react'
import type { ArpMode, AudioFeature, LfoShape, ModulatorType, MotionShape, PhysicsMotion, VisionFeature } from '@shared/types'
import { MAX_MOD_ASSIGNMENTS, MOTION_SHAPES, WORLD_AUTOMOD_SLOT } from '@shared/types'
import { DIVISIONS, modEngine } from '../engine/modulation'
import { AUDIO_BANDS, AUDIO_FEATURES } from '../engine/audioIn'
import { VISION_FEATURES } from '../engine/visionIn'
import { SHADER_BY_ID } from '../shaders/isf'
import { modTargetKey, useStore } from '../store'
import { BoundedNumberInput } from './BoundedNumberInput'
import { modulatorBlurb } from '../shaders/isf/sourceBlurbs'

const MOD_TYPES: ModulatorType[] = ['lfo', 'ramp', 'adsr', 'arp', 'random', 'sh', 'slew', 'chaos', 'audio', 'vision', 'homeostat', 'organic', 'physics', 'motion']
const LFO_SHAPES: LfoShape[] = ['sine', 'triangle', 'square', 'sawtooth', 'rndStep', 'rndSmooth', 'spastic']
const ARP_MODES: ArpMode[] = ['up', 'down', 'upDown', 'random', 'drunk']
const PHYSICS_MOTIONS: PhysicsMotion[] = ['bounce', 'spring', 'riser']

// One explanation, shown wherever SLIP appears.
const SLIP_HELP =
  "SLIP : how far this modulator strays from its own pulse. The clock keeps ticking — some " +
  "ticks simply do not fire, so events stay ON the beat while becoming impossible to " +
  "anticipate. That is what makes it read as a cross-rhythm rather than as sloppiness, and " +
  "why it still works when the clock is BPM-synced. 0 = dead regular; 0.5 is roughly the " +
  "feel of Spastic; high = long, uneven holds. Every modulator slips on its own clock."

export function ModulationPanel(): JSX.Element {
  const modulators = useStore((s) => s.composition.modulators)
  const collapsed = useStore((s) => !!s.collapsed['modulation'])
  const toggleSection = useStore((s) => s.toggleSection)
  const modBypass = useStore((s) => s.modBypass)
  const toggleModBypass = useStore((s) => s.toggleModBypass)
  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-border bg-panel px-3 py-1.5">
      <div className="flex items-center gap-3">
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
        {/* Far right of the title row : one click freezes every modulator so all
            sliders revert to their base. A live "hold everything still". */}
        <button
          onClick={toggleModBypass}
          className={`ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide transition-colors ${
            modBypass
              ? 'bg-danger/20 text-danger ring-1 ring-danger'
              : 'bg-panel3/60 text-muted hover:text-accent'
          }`}
          title={
            modBypass
              ? 'Modulation muted : every modulator output is frozen and all controls sit at their base values. Click to resume modulation.'
              : 'Mute all modulation : freeze every modulator in one click (controls revert to their base values).'
          }
        >
          {modBypass ? '⊘ muted' : 'active'}
        </button>
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
          title={
            modulatorBlurb(m.type) ??
            'The modulator type : what kind of moving signal this slot produces. Bind it to parameters with their M button.'
          }
        >
          {MOD_TYPES.map((t) => (
            <option key={t} value={t} title={modulatorBlurb(t)}>
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
      {m.type !== 'ramp' && m.type !== 'adsr' && m.type !== 'audio' && m.type !== 'vision' && m.type !== 'homeostat' && (
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
                max={1.699}
                step={0.01}
                value={Math.log10(Math.max(0.01, m.rateHz))}
                onChange={(e) => update(index, { rateHz: Math.pow(10, Number(e.target.value)) })}
                className="min-w-0 flex-1 accent-accent"
                title={`Rate: ${m.rateHz.toFixed(2)} Hz (log)`}
              />
              <BoundedNumberInput
                value={m.rateHz}
                min={0.01}
                max={50}
                maxFrac={2}
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
        <>
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
          {(m.shape === 'rndStep' || m.shape === 'rndSmooth') && (
            <SliderRow label="SLIP" value={m.slip ?? 0} min={0} max={1}
              title={SLIP_HELP}
              onChange={(v) => update(index, { slip: v })} />
          )}
          {m.shape === 'spastic' && (
            <Row label="THROW">
              <select
                className="input select-compact min-w-0 flex-1 text-[10px]"
                value={m.spasticMode ?? 'binary'}
                title="What Spastic throws each cycle : binary snaps between the two extremes; float lands anywhere in between."
                onChange={(e) =>
                  update(index, { spasticMode: e.target.value as 'binary' | 'float' })
                }
              >
                <option value="binary">binary</option>
                <option value="float">float</option>
              </select>
            </Row>
          )}
        </>
      )
    case 'ramp':
      return (
        <>
          <SliderRow label="MS" value={m.ramp.rampMs} min={50} max={120000} log integer
            title="Ramp time : how long the sweep takes, in milliseconds (log track)."

            onChange={(v) => update(index, { ramp: { ...m.ramp, rampMs: v } })} />
          <SliderRow label="CURVE%" value={m.ramp.curvePct} min={-100} max={100} step={1} integer
            title="Ramp shape : negative eases in, positive eases out, 0 is linear."

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
          {/* Tighter than the card's own gap-1 : four rows plus SUS have to
              live inside the fixed h-36 silhouette. */}
          <div className="flex min-w-0 flex-col gap-0.5">
            <MiniSlider label="A" name="Attack time" value={m.adsr.attackMs} min={0} max={30000}
              onChange={(v) => update(index, { adsr: { ...m.adsr, attackMs: v } })} />
            <MiniSlider label="D" name="Decay time" value={m.adsr.decayMs} min={0} max={30000}
              onChange={(v) => update(index, { adsr: { ...m.adsr, decayMs: v } })} />
            <MiniSlider label="S" name="Sustain time" value={m.adsr.sustainMs} min={0} max={60000}
              onChange={(v) => update(index, { adsr: { ...m.adsr, sustainMs: v } })} />
            <MiniSlider label="R" name="Release time" value={m.adsr.releaseMs} min={0} max={30000}
              onChange={(v) => update(index, { adsr: { ...m.adsr, releaseMs: v } })} />
          </div>
          <div className="flex min-w-0 items-center gap-1" title="Sustain level : the height the envelope holds at, not a duration.">
            <span
              className="w-10 shrink-0 cursor-help font-mono text-[9px] text-muted underline decoration-dotted underline-offset-2"
              title="Sustain level : the height the envelope holds at, not a duration."
            >
              SUS
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={m.adsr.sustainLevel}
              onChange={(e) => update(index, { adsr: { ...m.adsr, sustainLevel: Number(e.target.value) } })}
              className="min-w-0 flex-1 accent-accent"
              title={'Sustain level : the height the envelope holds at, not a duration.'}
            />
            <BoundedNumberInput
              value={Math.round(m.adsr.sustainLevel * 100) / 100}
              min={0}
              max={1}
              onChange={(v) => update(index, { adsr: { ...m.adsr, sustainLevel: v } })}
              className="input w-10 shrink-0 px-0.5 py-0.5 text-right text-[9px]"
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
          <SliderRow label="STEPS" value={m.arp.steps} min={2} max={16} step={1} integer
            title="How many evenly spaced levels the register walks."
            onChange={(v) => update(index, { arp: { ...m.arp, steps: Math.round(v) } })} />
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
          <SliderRow label="SLIP" value={m.slip ?? 0} min={0} max={1}
            title={SLIP_HELP}
            onChange={(v) => update(index, { slip: v })} />
        </>
      )
    case 'random':
      return (
        <>
          <SliderRow label="SLIP" value={m.slip ?? 0} min={0} max={1}
            title={SLIP_HELP}
            onChange={(v) => update(index, { slip: v })} />
          <SliderRow label="DIST" value={m.random.distribution} min={0} max={1}
            title="Distribution : 0.5 uniform · >0.5 centre-hug · <0.5 edge-weight"
            onChange={(v) => update(index, { random: { distribution: v } })} />
        </>
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
          <SliderRow label="RISE" value={m.slew.riseMs} min={1} max={10000} log integer
            title="Rise time : how long it takes to climb to a new target (log track)."

            onChange={(v) => update(index, { slew: { ...m.slew, riseMs: v } })} />
          <SliderRow label="FALL" value={m.slew.fallMs} min={1} max={10000} log integer
            title="Fall time : how long it takes to drop to a new target (log track)."

            onChange={(v) => update(index, { slew: { ...m.slew, fallMs: v } })} />
        </>
      )
    case 'chaos':
      return (
        <>
          <SliderRow label="SLIP" value={m.slip ?? 0} min={0} max={1}
            title={SLIP_HELP}
            onChange={(v) => update(index, { slip: v })} />
          <SliderRow label="R" value={m.chaos.r} min={3.4} max={4} step={0.005}
            title="Logistic-map r : toward 4 = wilder"
            onChange={(v) => update(index, { chaos: { r: v } })} />
        </>
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
    case 'vision': {
      const vc = m.vision ?? { feature: 'brightness' as VisionFeature, smooth: 0.3 }
      return (
        <>
          <Row label="READ">
            <select
              className="input select-compact min-w-0 flex-1 text-[10px]"
              value={vc.feature}
              title="Which picture feature this modulator follows : the composited image played back as control (brightness, contrast, motion, edge-density, entropy, bright-mass X/Y, warmth). The return path : the picture drives parameters, and streams to Pandore over /opsia/vision/*."
              onChange={(e) => update(index, { vision: { ...vc, feature: e.target.value as VisionFeature } })}
            >
              {VISION_FEATURES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Row>
          <SliderRow label="SMOOTH" value={vc.smooth} min={0} max={0.99}
            title="One-pole smoothing of the picture feature : 0 snaps, →1 glides"
            onChange={(v) => update(index, { vision: { ...vc, smooth: v } })} />
        </>
      )
    }
    case 'homeostat': {
      const h = m.homeostat ?? { feature: 'edges' as VisionFeature, setpoint: 0.5, gain: 0.4, adapt: 0.3 }
      return (
        <>
          <Row label="WATCH">
            <select
              className="input select-compact min-w-0 flex-1 text-[10px]"
              value={h.feature}
              title="Which picture feature the controller regulates : it watches this and pushes the bound param to hold it steady. edges/motion/contrast ≈ energy. A negative-feedback loop → parks the rig at edge-of-chaos. It regulates around a self-adapting baseline, so features that sit high or low still give full range."
              onChange={(e) => update(index, { homeostat: { ...h, feature: e.target.value as VisionFeature } })}
            >
              {VISION_FEATURES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Row>
          <SliderRow label="SET" value={h.setpoint} min={0} max={1}
            title="Setpoint, relative to the baseline : 0.5 = hold the feature where it's been; above/below biases it higher/lower. Bind in REPLACE mode; the depth's sign sets which way it pushes (flip it if the loop runs to a rail)."
            onChange={(v) => update(index, { homeostat: { ...h, setpoint: v } })} />
          <SliderRow label="GAIN" value={h.gain} min={0} max={1}
            title="Grip : how tightly it holds the feature — one knob for both sensitivity (how much a small swing fills the range) and drive strength. Turn UP when the feature barely moves (e.g. edges stays near the top); too high hunts/oscillates."
            onChange={(v) => update(index, { homeostat: { ...h, gain: v } })} />
          <SliderRow label="ADAPT" value={h.adapt} min={0} max={1}
            title="How fast the baseline re-centres : LOW holds a fixed level (absolute-ish); HIGH only fights quick swings and lets slow drift through. Raise it if the loop keeps pinning a rail."
            onChange={(v) => update(index, { homeostat: { ...h, adapt: v } })} />
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
function Row({
  label,
  title,
  children
}: {
  label: string
  title?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1" title={title}>
      <span
        className={`w-10 shrink-0 font-mono text-[9px] text-muted ${
          title ? 'cursor-help underline decoration-dotted underline-offset-2' : ''
        }`}
        title={title}
      >
        {label}
      </span>
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

// One ADSR segment : hair-thin label, slider, editable readout. These used to
// sit TWO-UP, which left the slider narrower than its own thumb and effectively
// undraggable. One per row gives it real travel, and four rows fit because an
// envelope card carries no clock row. The value is STORED in ms and shown in
// SECONDS: five digits of milliseconds will not fit beside a slider, and
// seconds is the readable unit for an envelope anyway.
function MiniSlider({
  label, name, value, min, max, onChange
}: {
  label: string; name: string; value: number; min: number; max: number
  onChange: (v: number) => void
}): JSX.Element {
  const help = name + ' : ' + (value / 1000).toFixed(2) + ' s'
  return (
    <div className="flex min-w-0 items-center gap-1" title={help}>
      <span className="w-2.5 shrink-0 cursor-help font-mono text-[9px] text-muted" title={help}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
        title={help}
      />
      {/* One decimal : the box renders String(value), so a raw ms/1000 would
          read "1.073" and clip in a cell this narrow. The row's tooltip keeps
          the exact figure. */}
      <BoundedNumberInput
        value={Math.round(value / 100) / 10}
        min={min / 1000}
        max={max / 1000}
        onChange={(v) => onChange(Math.round(v * 1000))}
        className="input w-9 shrink-0 px-0.5 py-0.5 text-right text-[9px]"
      />
    </div>
  )
}

function SliderRow({
  label, value, min, max, step = 0.01, title, integer, log, onChange
}: {
  label: string; value: number; min: number; max: number; step?: number; title?: string
  integer?: boolean
  // Log track : a linear slider over 50…120000 ms puts everything usable in the
  // first 2% of its travel. The readout box stays linear either way.
  log?: boolean
  onChange: (v: number) => void
}): JSX.Element {
  const useLog = !!log && min > 0
  const toPos = (v: number): number => (useLog ? Math.log10(Math.max(min, v)) : v)
  const emit = (p: number): void => {
    const v = useLog ? Math.pow(10, p) : p
    onChange(integer ? Math.round(v) : v)
  }
  return (
    <Row label={label} title={title}>
      <input
        type="range"
        min={toPos(min)}
        max={toPos(max)}
        step={useLog ? 0.001 : step}
        value={toPos(value)}
        onChange={(e) => emit(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
        title={title}
      />
      {/* Every slider carries an editable numeric readout, shown to at most
          three decimals so a slider landing on 0.079577… doesn't clip. */}
      <BoundedNumberInput
        value={value}
        min={min}
        max={max}
        integer={integer}
        maxFrac={3}
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
    if (t.kind === 'sonify') return `SONIFY ${t.param}`
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
