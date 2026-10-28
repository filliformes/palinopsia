// Modulation panel (brief §10.4): the 8-modulator bank + the capped
// mod-matrix. Each card: type, clock (free Hz / BPM division), the active
// type's key parameters, output curve, and a live meter. The meters are
// painted by ONE rAF loop writing DOM styles directly from modEngine.values :
// modulation never re-renders React at 60 Hz.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ArpMode, AudioFeature, BodyFeature, LfoShape, ModulatorType, MotionShape, PhysicsMotion, StepCond, StepsConfig, VisionFeature } from '@shared/types'
import { BODY_FEATURE_GROUPS, FX_OPACITY_INPUT, MAX_MOD_ASSIGNMENTS, MOTION_SHAPES } from '@shared/types'
import { DIVISIONS, modEngine } from '../engine/modulation'
import { condLabel, parseStepCond, randomStepPattern, STEP_MAX, STEP_PROBS, stepLength, stepsOf, SWING_MAX, SWING_MIN, type ParsedCond } from '../engine/stepSeq'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { ownerWindow } from './ownerWindow'
import { commitNow, runSilently } from '../undo'
import { shapeActive } from '../engine/modShape'
import { DOME_MOD_RANGE } from '@shared/dome'
import { OUTX_MOD_RANGE } from '@shared/outXform'
import { auLabel } from '@shared/auMod'
import { AUDIO_BANDS, AUDIO_FEATURES } from '../engine/audioIn'
import { VISION_FEATURES } from '../engine/visionIn'
import { SHADER_BY_ID } from '../shaders/isf'
import { modTargetKey, useStore } from '../store'
import { useShallow } from 'zustand/react/shallow'
import type { ClipAudioSrc } from '@shared/types'
import { BoundedNumberInput } from './BoundedNumberInput'
import { modulatorBlurb } from '../shaders/isf/sourceBlurbs'
import { usePin } from './Pin'
import { modPin, PIN_WORDS } from '../persist'

// The type menu, in families (a new type goes in the one it belongs to) :
// shapes in time, patterns on a clock, chance, gestures with a body of their
// own, and what follows the room (the sound, the picture, the performer).
const MOD_GROUPS: Array<{ label: string; title: string; types: ModulatorType[] }> = [
  { label: 'waves', title: 'Shapes in time : a repeating wave, a one-shot sweep, an envelope', types: ['lfo', 'ramp', 'adsr'] },
  { label: 'rhythms', title: 'Patterns on a clock : a walk of levels, a drawn step sequence, euclidean pulses, a mutating loop, cells', types: ['arp', 'steps', 'euclid', 'turing', 'cellular'] },
  { label: 'random', title: 'Chance : random values, sample and hold, a glide, chaos', types: ['random', 'sh', 'slew', 'chaos'] },
  { label: 'gestures', title: 'Movement with a life of its own : drifting, traced, physical', types: ['organic', 'motion', 'physics'] },
  { label: 'listening', title: 'Follows the room : the sound, the picture, your body, a quality held steady', types: ['audio', 'vision', 'body', 'homeostat'] }
]
const CELL_RULES = [30, 90, 110, 150]
const LFO_SHAPES: LfoShape[] = ['sine', 'triangle', 'square', 'sawtooth', 'rndStep', 'rndSmooth', 'spastic']
const ARP_MODES: ArpMode[] = ['up', 'down', 'upDown', 'random', 'drunk']
const PHYSICS_MOTIONS: PhysicsMotion[] = ['bounce', 'spring', 'riser']

// One explanation, shown wherever SLIP appears.
const SLIP_HELP =
  "SLIP : how far this modulator strays from its own pulse. The clock keeps ticking, but some " +
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
  const used = useStore((s) => s.composition.modMatrix.length)
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
          {/* the bindings in use under the name, so the bindings themselves
              start at the left edge of the row, like the other live sections */}
          <span className="flex flex-col items-start leading-none">
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
              Modulation
            </span>
            <span
              className={`mt-0.5 font-mono text-[9px] ${used >= MAX_MOD_ASSIGNMENTS ? 'text-danger' : 'text-muted/80'}`}
              title={`${used} of the ${MAX_MOD_ASSIGNMENTS} modulation bindings in use`}
            >
              {used}/{MAX_MOD_ASSIGNMENTS}
            </span>
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
  // How many matrix targets this modulator drives : a glance at what's wired.
  const drives = useStore((s) => s.composition.modMatrix.filter((a) => a.mod === index).length)
  // the card persistent (right-click) : its configuration rides every scene,
  // dice and Generate; a gold border, a gold name
  const pin = usePin(modPin(index), `M${index + 1}`, PIN_WORDS.mod)

  return (
    // Fixed height + min-w-0 so all eight cards are identical regardless of
    // type : the section keeps one silhouette as types are swapped. Sized for
    // the tallest type (euclid : 4 param rows + the BPM division select); the
    // params region below scrolls as a safety net so nothing ever crosses the
    // border even at large UI zoom.
    <div
      className={`flex h-40 min-w-0 flex-col gap-1 rounded border p-1.5 transition-colors ${
        m.enabled ? 'border-accent/60 bg-panel2' : 'border-border bg-panel2/40'
      }`}
      style={pin.pinned ? { borderColor: 'rgb(var(--c-pin) / 0.8)' } : undefined}
      onContextMenu={pin.onContextMenu}
    >
      {pin.menu}
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => update(index, { enabled: !m.enabled })}
          className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${
            m.enabled ? 'bg-accent' : 'bg-panel3'
          }`}
          title={m.enabled ? 'On : click to disable' : 'Off : click to enable'}
        />
        <span
          className="font-mono text-[10px]"
          style={{ color: pin.pinned ? 'rgb(var(--c-pin))' : 'rgb(var(--c-muted))' }}
          title={pin.pinned ? 'Persistent : no scene, dice or Generate changes this modulator (right-click to unpin)' : 'Right-click : make this modulator persistent'}
        >
          M{index + 1}
        </span>
        {drives > 0 && (
          <span
            className="shrink-0 font-mono text-[9px] leading-4 text-accent"
            title={`Drives ${drives} parameter${drives === 1 ? '' : 's'} in the matrix`}
          >
            →{drives}
          </span>
        )}
        {m.fromWorld && (
          <span
            className="shrink-0 font-mono text-[9px] text-accent2"
            title="Installed by the World's audio routing : set it in the World editor (W). Randomize leaves it alone. Change it or its bindings here and it becomes yours."
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
          {MOD_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label} title={g.title}>
              {g.types.map((t) => (
                <option key={t} value={t} title={modulatorBlurb(t)}>
                  {t}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          onClick={() => modEngine.retrigger(index)}
          className="shrink-0 rounded bg-panel3/60 px-1 font-mono text-[9px] text-muted hover:text-accent"
          title="Retrigger : re-sync this modulator to NOW. A running LFO / Euclid / Turing / Cellular / arp snaps back to the start of its cycle (line it up on a downbeat), Steps back to step 1 of a new first pass (with Ableton Link enabled its steps stay on the shared bar and only the passes count anew), and Ramp / ADSR / Riser restart from zero. Modulators that run on their own clock (Random / S&H / Slew / Chaos) or follow a signal (Audio / Vision) don't move."
        >
          ⟳
        </button>
      </div>

      {/* live meter */}
      <Meter index={index} />

      {/* clock : everything except ramp/adsr/audio is clock-driven
          (audio is driven by the signal itself) */}
      {m.type !== 'ramp' && m.type !== 'adsr' && m.type !== 'audio' && m.type !== 'vision' && m.type !== 'body' && m.type !== 'homeostat' && (
        <div className="flex min-w-0 shrink-0 items-center gap-1">
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
          {/* Steps' FILL rides the rate line too : the card's one performance button. */}
          {m.type === 'steps' && <FillButton index={index} />}
        </div>
      )}

      {/* type-specific params (output shaping lives on the Meta knobs, not
          here : modulators emit their raw signal). Bounded + scrollable so a
          param-heavy type (euclid) can never spill past the card border. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        <TypeParams index={index} />
      </div>
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
          {m.shape === 'spastic' && <SpasticHoldRow index={index} />}
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
            title="Distribution : 0.5 uniform · >0.5 center-hug · <0.5 edge-weight"
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
            title="Distribution : 0.5 = uniform random · <0.5 favors the extremes · >0.5 hugs the center"
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
    case 'euclid':
      return (
        // Tighter than the card's own gap-1 (as ADSR) : four rows under the
        // BPM division select overflowed the fixed card by 1 px.
        <div className="flex min-w-0 flex-col gap-0.5">
          <SliderRow label="STEPS" value={m.euclid.steps} min={2} max={32} step={1} integer
            title="Euclidean : total steps the pattern spans."
            onChange={(v) => update(index, { euclid: { ...m.euclid, steps: Math.round(v), pulses: Math.min(m.euclid.pulses, Math.round(v)) } })} />
          <SliderRow label="PULSES" value={m.euclid.pulses} min={0} max={m.euclid.steps} step={1} integer
            title="How many onsets, spread as evenly as possible across the steps (a gate on each)."
            onChange={(v) => update(index, { euclid: { ...m.euclid, pulses: Math.round(v) } })} />
          <SliderRow label="DECAY" value={m.euclid.decay ?? 0.35} min={0} max={1}
            title="Release each pulse fades over : 0 = a hard on/off gate · up = a soft pluck/swell that rides between beats."
            onChange={(v) => update(index, { euclid: { ...m.euclid, decay: v } })} />
          <SliderRow label="SLIP" value={m.slip ?? 0} min={0} max={1}
            title={SLIP_HELP}
            onChange={(v) => update(index, { slip: v })} />
        </div>
      )
    case 'turing':
      return (
        <>
          <SliderRow label="LENGTH" value={m.turing.length} min={2} max={16} step={1} integer
            title="Shift-register length : how many steps before the sequence loops."
            onChange={(v) => update(index, { turing: { ...m.turing, length: Math.round(v) } })} />
          <SliderRow label="MUTATE" value={m.turing.mutate} min={0} max={1}
            title="Chance a step rewrites the loop : 0 = locked forever · 1 = never repeats."
            onChange={(v) => update(index, { turing: { ...m.turing, mutate: v } })} />
          <SliderRow label="SLIP" value={m.slip ?? 0} min={0} max={1}
            title={SLIP_HELP}
            onChange={(v) => update(index, { slip: v })} />
        </>
      )
    case 'cellular':
      return (
        <>
          <Row label="RULE">
            <select
              className="input select-compact min-w-0 flex-1 text-[10px]"
              value={m.cellular.rule}
              title="Wolfram rule : 30 chaotic · 90 fractal (Sierpiński) · 110 complex · 150 additive."
              onChange={(e) => update(index, { cellular: { ...m.cellular, rule: Number(e.target.value) } })}
            >
              {CELL_RULES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Row>
          <SliderRow label="CELLS" value={m.cellular.cells} min={8} max={48} step={1} integer
            title="Automaton width : the output is the fraction of live cells."
            onChange={(v) => update(index, { cellular: { ...m.cellular, cells: Math.round(v) } })} />
          <SliderRow label="SLIP" value={m.slip ?? 0} min={0} max={1}
            title={SLIP_HELP}
            onChange={(v) => update(index, { slip: v })} />
        </>
      )
    case 'steps':
      return <StepsParams index={index} />
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
          <ClipFromRow value={a.src} onChange={(src) => update(index, { audio: { ...a, src } })} />
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
    case 'body': {
      const bc = m.body ?? { feature: 'handRightHeight' as BodyFeature, smooth: 0.3 }
      return (
        <>
          <div className="flex min-w-0 items-center gap-1">
            <select
              className="input select-compact min-w-0 flex-1 text-[10px]"
              value={bc.feature}
              title="Which body feature this modulator follows : the live camera of the performer (hand height / side / openness, a hand's shape : finger curls, pinches, roll, facing, span; hands apart, whole-body motion, lean, arm span, stance, hands-up, the face, the silhouette zones, the motion field). Turn embodied control on and pick a camera on the Body page (B)."
              onChange={(e) => update(index, { body: { ...bc, feature: e.target.value as BodyFeature } })}
            >
              {BODY_FEATURE_GROUPS.map((g) => (
                <optgroup key={g.title} label={g.title}>
                  {g.keys.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <SliderRow label="SMOOTH" value={bc.smooth} min={0} max={0.99}
            title="One-pole smoothing of the body feature : 0 snaps, →1 glides"
            onChange={(v) => update(index, { body: { ...bc, smooth: v } })} />
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
            title="Grip : how tightly it holds the feature. One knob for both sensitivity (how much a small swing fills the range) and drive strength. Turn UP when the feature barely moves (e.g. edges stays near the top); too high hunts/oscillates."
            onChange={(v) => update(index, { homeostat: { ...h, gain: v } })} />
          <SliderRow label="ADAPT" value={h.adapt} min={0} max={1}
            title="How fast the baseline re-centers : LOW holds a fixed level (absolute-ish); HIGH only fights quick swings and lets slow drift through. Raise it if the loop keeps pinning a rail."
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
            title="Named motion archetype / force behavior : a characteristic trajectory"
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

// ── Steps : the 16-step strip, its condition menu, FILL ───────────────
const STEPS_LEN_HELP =
  'LENGTH : how many of the 16 steps play before the pattern starts again (1 to 16). The steps ' +
  'past it keep their values, dimmed, so a shorter pattern can grow back. Right-click a step : ' +
  'the pattern ends there.'
const STEPS_SWING_HELP =
  'SWING : every second step (2, 4, 6...) lands late, for a looser groove. 50 % is straight; ' +
  '75 % pushes it half a step late, as far as it goes, so it never reaches the step after it. ' +
  'On the Hz clock, the BPM divisions and with Ableton Link alike.'
const STEPS_GLIDE_HELP =
  'GLIDE : how much of a step the output takes to slide to the next value. 0 = hard steps; ' +
  '1 = it slides the whole step long, a continuous line through the values.'

function StepsParams({ index }: { index: number }): JSX.Element {
  const m = useStore((s) => s.composition.modulators[index])
  const update = useStore((s) => s.updateModulator)
  const sc = stepsOf(m)
  const set = (patch: Partial<StepsConfig>): void => update(index, { steps: { ...sc, ...patch } })
  const len = stepLength(sc)
  const swing = Math.round(sc.swing)
  const label = 'shrink-0 cursor-help font-mono text-[9px] text-muted underline decoration-dotted underline-offset-2'
  return (
    <>
      <StepStrip index={index} />
      {/* length and swing share a row (two-digit boxes : the input's own side
          padding leaves w-7 room for "16", w-8 for "75") so the swing slider
          keeps ~58 px of travel at zoom 1; glide has the full row under it */}
      <div className="flex min-w-0 shrink-0 items-center gap-1">
        <span className={label} title={STEPS_LEN_HELP}>
          LEN
        </span>
        <BoundedNumberInput
          value={len}
          min={1}
          max={STEP_MAX}
          integer
          onChange={(v) => set({ length: Math.round(v) })}
          className="input w-7 shrink-0 px-0.5 py-0.5 text-right text-[9px]"
          title={STEPS_LEN_HELP}
        />
        <span className={`${label} ml-0.5`} title={STEPS_SWING_HELP}>
          SWG
        </span>
        <input
          type="range"
          min={SWING_MIN}
          max={SWING_MAX}
          step={1}
          value={swing}
          onChange={(e) => set({ swing: Number(e.target.value) })}
          className="min-w-0 flex-1 accent-accent"
          title={`${STEPS_SWING_HELP} Now ${swing} %.`}
        />
        <BoundedNumberInput
          value={swing}
          min={SWING_MIN}
          max={SWING_MAX}
          integer
          onChange={(v) => set({ swing: v })}
          className="input w-8 shrink-0 px-0.5 py-0.5 text-right text-[9px]"
          title={`${STEPS_SWING_HELP} Now ${swing} %.`}
        />
      </div>
      <SliderRow label="GLIDE" value={sc.glide} min={0} max={1}
        title={STEPS_GLIDE_HELP}
        onChange={(v) => set({ glide: v })} />
    </>
  )
}

// A press that moves less than this (px) is a click (play / rest); past it the
// press draws.
const STEP_DEAD_PX = 3

type StripMenu = { x: number; y: number; step: number; view: 'main' | 'prob' | 'ab' }

function stepTitle(i: number, v: number, on: boolean, c: ParsedCond, past: boolean): string {
  const what = on
    ? `${v.toFixed(2)}, ${c.kind === 'always' ? 'plays every time' : `plays ${condLabel(c)}`}`
    : `a rest (its ${v.toFixed(2)} kept)`
  return (
    `Step ${i + 1}${past ? ' (past the length)' : ''} : ${what}. Drag up or down to draw ` +
    '(across the steps to draw several), click : play or rest, right-click : when it plays, ' +
    'the length, what a silent step does, randomize.'
  )
}

// Under each step, what its condition is, at a glance : a chance fills its
// share of the mark, a pass of every few lights its slot of them; FILL marks in
// the accent (solid : only in a fill, faint : only outside one), first in the
// text color (solid : only the first time, faint : every time but).
function StepMark({ c }: { c: ParsedCond }): JSX.Element {
  const base = 'h-[2px] shrink-0 rounded-[1px]'
  switch (c.kind) {
    case 'prob':
      return (
        <div className={`${base} bg-accent2/25`}>
          <div className="h-full rounded-[1px] bg-accent2" style={{ width: `${c.p}%` }} />
        </div>
      )
    case 'ab': {
      const a = ((c.a - 1) / c.b) * 100
      const b = (c.a / c.b) * 100
      const dim = 'rgb(var(--c-accent2) / 0.25)'
      return (
        <div
          className={base}
          style={{ background: `linear-gradient(to right, ${dim} ${a}%, rgb(var(--c-accent2)) ${a}% ${b}%, ${dim} ${b}%)` }}
        />
      )
    }
    case 'fill':
      return <div className={`${base} bg-accent`} />
    case 'notFill':
      return <div className={`${base} bg-accent/35`} />
    case 'first':
      return <div className={`${base} bg-text/80`} />
    case 'notFirst':
      return <div className={`${base} bg-text/30`} />
    default:
      return <div className={base} />
  }
}

// A:B in a grid : one row per B (of 2 ... of 8), A across it.
function AbGrid({ cur, onPick }: { cur: ParsedCond; onPick: (a: number, b: number) => void }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-1.5">
      {[2, 3, 4, 5, 6, 7, 8].map((b) => (
        <div key={b} className="flex items-center gap-0.5">
          <span className="w-9 shrink-0 font-mono text-[9px] text-muted">of {b}</span>
          {Array.from({ length: b }, (_, j) => j + 1).map((a) => {
            const sel = cur.kind === 'ab' && cur.a === a && cur.b === b
            return (
              <button
                key={a}
                onClick={() => onPick(a, b)}
                className={`h-4 w-4 shrink-0 rounded-sm font-mono text-[9px] leading-4 transition-colors ${
                  sel ? 'bg-accent/25 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:bg-accent/15 hover:text-accent'
                }`}
                title={`${a}:${b} : plays on pass ${a} of every ${b}`}
              >
                {a}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function StepStrip({ index }: { index: number }): JSX.Element {
  const m = useStore((s) => s.composition.modulators[index])
  const update = useStore((s) => s.updateModulator)
  const sc = stepsOf(m)
  const len = stepLength(sc)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null) // step 1's bar track : the height values are drawn against
  const colRefs = useRef<Array<HTMLDivElement | null>>([])
  const [menu, setMenu] = useState<StripMenu | null>(null)
  const gesture = useRef<{ id: number; x0: number; y0: number; step: number; drawing: boolean; before: number[]; lastX: number; lastY: number } | null>(null)

  // What is in the store now (a gesture writes onto that, never onto an older render)
  const live = (): StepsConfig => stepsOf(useStore.getState().composition.modulators[index])
  const write = (next: StepsConfig): void => update(index, { steps: next })

  // The playhead : one rAF writing a data attribute straight to the DOM (no
  // re-render at frame rate, like the meter) : "hit" when the step played,
  // "miss" when it came and stayed silent.
  useEffect(() => {
    const win = ownerWindow(boxRef.current)
    let raf = 0
    let shown = ''
    const paint = (): void => {
      const mm = useStore.getState().composition.modulators[index]
      const v = modEngine.stepView(index)
      const playing = !!mm?.enabled && mm.type === 'steps' && !!v?.run && !v.due
      const key = playing && v ? `${v.idx}:${v.fired ? 'hit' : 'miss'}` : ''
      if (key !== shown) {
        shown = key
        colRefs.current.forEach((el, i) => {
          if (!el) return
          if (playing && v && i === v.idx) el.dataset.play = v.fired ? 'hit' : 'miss'
          else delete el.dataset.play
        })
      }
      raf = win.requestAnimationFrame(paint)
    }
    raf = win.requestAnimationFrame(paint)
    return () => win.cancelAnimationFrame(raf)
  }, [index])

  // Pointer → step and value through the boxes on screen (the UI zoom is a CSS
  // zoom : client pixels and layout pixels differ, the boxes already agree).
  const stepAtX = (clientX: number): number => {
    const r = boxRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(STEP_MAX - 1, Math.floor(((clientX - r.left) / Math.max(1, r.width)) * STEP_MAX)))
  }
  const valueAtY = (clientY: number): number => {
    const r = (trackRef.current ?? boxRef.current!).getBoundingClientRect()
    const v = 1 - (clientY - r.top) / Math.max(1, r.height)
    return Math.round(Math.max(0, Math.min(1, v)) * 100) / 100
  }

  const onDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    gesture.current = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, step: stepAtX(e.clientX), drawing: false,
      before: live().values.slice(), lastX: e.clientX, lastY: e.clientY
    }
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    if (!g.drawing) {
      if (Math.abs(e.clientX - g.x0) < STEP_DEAD_PX && Math.abs(e.clientY - g.y0) < STEP_DEAD_PX) return
      g.drawing = true
    }
    // Every step the pointer crossed since the last move takes the stroke's
    // height where it crossed that step's middle (a fast sweep skips none).
    const cur = live()
    const values = cur.values.slice()
    const r = boxRef.current!.getBoundingClientRect()
    const a = stepAtX(g.lastX)
    const b = stepAtX(e.clientX)
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
      if (i === b) {
        values[i] = valueAtY(e.clientY)
        continue
      }
      const cx = r.left + ((i + 0.5) / STEP_MAX) * r.width
      const t = Math.max(0, Math.min(1, (cx - g.lastX) / (e.clientX - g.lastX || 1)))
      values[i] = valueAtY(g.lastY + (e.clientY - g.lastY) * t)
    }
    g.lastX = e.clientX
    g.lastY = e.clientY
    // live while drawing (the engine plays the stroke as it goes), but silently :
    // the stroke becomes ONE undo step when it ends, however long it pauses
    if (values.some((v, i) => v !== cur.values[i])) runSilently(() => write({ ...cur, values }))
  }
  const endStroke = (g: NonNullable<typeof gesture.current>): void => {
    const after = live()
    if (after.values.every((v, i) => v === g.before[i])) return
    // back to before the stroke without a step, then the stroke as one edit,
    // closed at once
    runSilently(() => write({ ...after, values: g.before }))
    write(after)
    commitNow()
  }
  const onUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    gesture.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    if (g.drawing) return endStroke(g)
    // a click : the step plays or rests
    const cur = live()
    const on = cur.on.slice()
    on[g.step] = !on[g.step]
    write({ ...cur, on })
  }
  const onCancel = (e: React.PointerEvent<HTMLDivElement>): void => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    gesture.current = null
    if (g.drawing) endStroke(g)
  }
  const onContext = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation() // (the card's own menu, Persistent, is under it)
    setMenu({ x: e.clientX, y: e.clientY, step: stepAtX(e.clientX), view: 'main' })
  }

  let menuEl: ReactNode = null
  if (menu) {
    const k = menu.step
    const cur = parseStepCond(sc.cond[k])
    const close = (): void => setMenu(null)
    const view = (v: StripMenu['view']) => (): void => setMenu({ ...menu, view: v })
    const tick = (b: boolean): string => (b ? '✓ ' : '')
    const setCond = (c: StepCond): void => {
      const s = live()
      const cond = s.cond.slice()
      cond[k] = c
      write({ ...s, cond })
    }
    let header = `Step ${k + 1} · ${condLabel(cur)}`
    let body: ReactNode = undefined
    let items: MenuItem[]
    if (menu.view === 'prob') {
      header = `Step ${k + 1} · plays by chance`
      items = [
        { label: '‹ back', keepOpen: true, onClick: view('main') },
        { label: '', divider: true },
        ...STEP_PROBS.map((p): MenuItem => ({
          label: `${tick(cur.kind === 'prob' && cur.p === p)}${p} % of the time`,
          onClick: () => setCond(`p${p}` as StepCond)
        }))
      ]
    } else if (menu.view === 'ab') {
      header = `Step ${k + 1} · on pass A of every B`
      body = (
        <AbGrid
          cur={cur}
          onPick={(a, b) => {
            setCond(`${a}:${b}` as StepCond)
            close()
          }}
        />
      )
      items = [
        { label: '', divider: true },
        { label: '‹ back', keepOpen: true, onClick: view('main') }
      ]
    } else {
      const on = !!sc.on[k]
      const anyCond = sc.cond.some((c) => parseStepCond(c).kind !== 'always')
      items = [
        { label: `${tick(cur.kind === 'always')}always`, onClick: () => setCond('always'), title: 'Plays every time round' },
        {
          label: `${tick(cur.kind === 'prob')}by chance${cur.kind === 'prob' ? ` (${cur.p} %)` : ''} ▸`,
          keepOpen: true,
          onClick: view('prob'),
          title: 'Plays only some of the time, drawn anew each time round : the rhythm stays on the grid, some of its steps drop out'
        },
        {
          label: `${tick(cur.kind === 'ab')}on some passes${cur.kind === 'ab' ? ` (${cur.a}:${cur.b})` : ''} ▸`,
          keepOpen: true,
          onClick: view('ab'),
          title: 'Plays on one pass of every few through the pattern (1:2 the first of every two, 2:4 the second of every four...), counted from the start, so a short pattern becomes a longer phrase'
        },
        { label: `${tick(cur.kind === 'fill')}only in a fill`, onClick: () => setCond('fill'), title: 'Plays only while FILL is on' },
        { label: `${tick(cur.kind === 'notFill')}only outside a fill`, onClick: () => setCond('!fill'), title: 'Falls silent while FILL is on' },
        {
          label: `${tick(cur.kind === 'first')}only the first time through`,
          onClick: () => setCond('first'),
          title: 'Plays on the first pass only. A run starts when the card is turned on, retriggered, a session loads, or Ableton Link starts playing'
        },
        { label: `${tick(cur.kind === 'notFirst')}every time but the first`, onClick: () => setCond('!first'), title: 'Silent on the first pass, then plays every time' },
        { label: '', divider: true },
        {
          label: on ? 'make it a rest' : 'make it play',
          onClick: () => {
            const s = live()
            const o = s.on.slice()
            o[k] = !o[k]
            write({ ...s, on: o })
          }
        },
        {
          label: `the pattern ends here (${k + 1} step${k ? 's' : ''})`,
          disabled: len === k + 1,
          onClick: () => write({ ...live(), length: k + 1 })
        },
        { label: '', divider: true },
        {
          label: `${tick(sc.rest !== 'zero')}a silent step holds the value`,
          onClick: () => write({ ...live(), rest: 'hold' }),
          title: 'A rest, or a step whose condition is not met, leaves the output where the last step put it'
        },
        {
          label: `${tick(sc.rest === 'zero')}a silent step drops to 0`,
          onClick: () => write({ ...live(), rest: 'zero' }),
          title: 'A rest, or a step whose condition is not met, sends the output to 0 (through the glide)'
        },
        { label: '', divider: true },
        {
          label: 'clear all conditions',
          disabled: !anyCond,
          onClick: () => write({ ...live(), cond: new Array<StepCond>(STEP_MAX).fill('always') })
        },
        {
          label: 'randomize the pattern',
          onClick: () => write({ ...live(), ...randomStepPattern() }),
          title: 'New values, a few rests and a few conditions; the length, swing and glide stay'
        }
      ]
    }
    menuEl = <ContextMenu x={menu.x} y={menu.y} header={header} body={body} items={items} onClose={close} />
  }

  return (
    <>
      <div
        ref={boxRef}
        className="flex min-h-[24px] min-w-0 flex-1 cursor-ns-resize touch-none select-none gap-px"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onContextMenu={onContext}
      >
        {Array.from({ length: STEP_MAX }, (_, i) => {
          const v = Math.max(0, Math.min(1, Number(sc.values[i]) || 0))
          const on = !!sc.on[i]
          const c = parseStepCond(sc.cond[i])
          return (
            <div
              key={i}
              ref={(el) => {
                colRefs.current[i] = el
              }}
              className={`group flex min-w-0 flex-1 flex-col gap-px ${i >= len ? 'opacity-30' : ''}`}
              title={stepTitle(i, v, on, c, i >= len)}
            >
              <div
                ref={i === 0 ? trackRef : undefined}
                className="relative min-h-0 flex-1 overflow-hidden rounded-[1px] bg-panel3/40 group-data-[play=hit]:bg-panel3 group-data-[play=miss]:bg-panel3/80 group-data-[play=hit]:ring-1 group-data-[play=hit]:ring-inset group-data-[play=hit]:ring-text/50 group-data-[play=miss]:ring-1 group-data-[play=miss]:ring-inset group-data-[play=miss]:ring-muted/60"
              >
                <div
                  className={`absolute inset-x-0 bottom-0 ${on ? 'bg-accent/55 group-data-[play=hit]:bg-accent' : 'border border-muted/70'}`}
                  style={{ height: `${v * 100}%` }}
                />
              </div>
              <StepMark c={c} />
            </div>
          )
        })}
      </div>
      {menuEl}
    </>
  )
}

// FILL : held = on while pressed (the drum-machine way), Shift-click = kept on
// until the next Shift-click. Lit while on; solid while kept on.
function FillButton({ index }: { index: number }): JSX.Element {
  const on = useSyncExternalStore(modEngine.onFill, () => modEngine.fill(index))
  const latched = useSyncExternalStore(modEngine.onFill, () => modEngine.fillLatched(index))
  const release = (): void => modEngine.setFillHeld(index, false)
  return (
    <button
      onPointerDown={(e) => {
        if (e.button !== 0) return
        if (e.shiftKey) return modEngine.setFillLatch(index, !modEngine.fillLatched(index))
        e.currentTarget.setPointerCapture(e.pointerId)
        modEngine.setFillHeld(index, true)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      className={`shrink-0 touch-none rounded px-1 py-0.5 font-mono text-[9px] ${
        latched
          ? 'bg-accent text-bg ring-1 ring-accent'
          : on
            ? 'bg-accent/20 text-accent ring-1 ring-accent'
            : 'bg-panel3/60 text-muted hover:text-accent'
      }`}
      title={
        'FILL : hold it down and the steps set to play only in a fill come in, while those set to ' +
        'play only outside one fall silent. Shift-click keeps it on (Shift-click again to let it go). ' +
        `A Body rule or a MIDI pad can switch it too (MOD ${index + 1} fill on/off).${latched ? ' Kept on now.' : ''}`
      }
    >
      FILL
    </button>
  )
}

// ── Small row helpers ─────────────────────────────────────────────────
// Where an audio modulator listens : the audio input (the audio tab), or a
// layer slot's clip, a film's soundtrack or an audio file, read at its playhead.
function ClipFromRow({ value, onChange }: { value: ClipAudioSrc | undefined; onChange: (v: ClipAudioSrc | undefined) => void }): JSX.Element {
  const slots = useStore(
    useShallow((s) => [
      ...s.composition.layers.flatMap((l, li) =>
        (['A', 'B'] as const).flatMap((sl) => {
          const x = sl === 'A' ? l.sourceA : l.sourceB
          return x && (x.kind === 'video' || x.kind === 'audio') ? [`${li}:${sl}:${x.kind}:${x.mediaName ?? ''}`] : []
        })
      ),
      // the Audio Layer : its whole sound (live input included), then its files
      // (a live input alone has no file to read at a playhead)
      ...(s.audioLayer.A || s.audioLayer.B ? ['-1:all:mix:the whole layer'] : []),
      ...(['A', 'B'] as const).flatMap((sl) => {
        const x = s.audioLayer[sl]
        return x?.kind === 'file' ? [`-1:${sl}:audio:${x.mediaName ?? ''}`] : []
      })
    ])
  )
  const where = (l: number, s: string): string => (l < 0 ? `AU ${s}` : `L${l + 1}${s}`)
  const cur = value ? `${value.layer}:${value.slot}` : ''
  const known = !value || slots.some((k) => k.startsWith(cur + ':'))
  return (
    <Row label="FROM" title="Where it listens : the audio input (the audio tab); the sound of a film or an audio file on a layer or on the Audio Layer (AU A / B), read where its playhead is (at any speed, reversed or scrubbed; a stopped clip is silent); or the Audio Layer's whole sound (AU all : both slots mixed, a live input too, after their volumes, analysed as it plays)">
      <select
        className="input select-compact min-w-0 flex-1 text-[10px]"
        value={cur}
        onChange={(e) => {
          const v = e.target.value
          if (!v) return onChange(undefined)
          const [l, s] = v.split(':')
          onChange({ layer: Number(l), slot: s === 'B' ? 'B' : s === 'all' ? 'all' : 'A' })
        }}
      >
        <option value="">audio input</option>
        {slots.map((k) => {
          const [l, s, kind, ...name] = k.split(':')
          return (
            <option key={k} value={`${l}:${s}`}>
              {`${where(Number(l), s)} ${kind === 'mix' ? '🎚' : kind === 'audio' ? '🔊' : '🎞'} ${name.join(':') || kind}`}
            </option>
          )
        })}
        {!known && value && <option value={cur}>{`${where(value.layer, value.slot)} (no clip there now)`}</option>}
      </select>
    </Row>
  )
}

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
      {/* Four characters at most, in a box as wide as SUS's beside it (w-9 cut
          "0.96" and "3.45") : two decimals under 10 s (maxFrac drops trailing
          zeros, so 0.55 s reads "0.55", not "0.6"), one from 10 s ("12.5"). A raw
          ms/1000 would read "1.073" and clip; the row's tooltip keeps the exact
          figure. */}
      <BoundedNumberInput
        value={value / 1000}
        min={min / 1000}
        max={max / 1000}
        maxFrac={value >= 10000 ? 1 : 2}
        onChange={(v) => onChange(Math.round(v * 1000))}
        className="input w-10 shrink-0 px-0.5 py-0.5 text-right text-[9px]"
      />
    </div>
  )
}

// Spastic's HOLD : 0 (the far left) = off, it stays up until the next throw;
// else a log track over 5 ms … 10 s.
const HOLD_MIN = 5
const HOLD_MAX = 10000
function SpasticHoldRow({ index }: { index: number }): JSX.Element {
  const m = useStore((s) => s.composition.modulators[index])
  const update = useStore((s) => s.updateModulator)
  const ms = Math.max(0, m.spasticHold ?? 0)
  const pos = ms <= 0 ? 0 : Math.max(0.001, Math.min(1, Math.log(Math.max(HOLD_MIN, ms) / HOLD_MIN) / Math.log(HOLD_MAX / HOLD_MIN)))
  const title =
    'HOLD : how long each throw stays up before it drops straight back to the bottom, in ' +
    'milliseconds. The rate then only sets WHEN it may rise (once in a while, as the coin ' +
    'decides); the time up is this. 0 (far left) = off : it stays up until the next throw.'
  return (
    <Row label="HOLD" title={title}>
      <input
        type="range" min={0} max={1} step={0.001} value={pos}
        onChange={(e) => {
          const p = Number(e.target.value)
          update(index, { spasticHold: p <= 0 ? 0 : Math.round(HOLD_MIN * Math.pow(HOLD_MAX / HOLD_MIN, p)) })
        }}
        className="min-w-0 flex-1 accent-accent"
        title={title}
      />
      <BoundedNumberInput
        value={ms}
        min={0}
        max={HOLD_MAX}
        integer
        onChange={(v) => update(index, { spasticHold: v })}
        className="input w-12 shrink-0 px-0.5 py-0.5 text-right text-[9px]"
      />
    </Row>
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
    <div className="h-1 w-full shrink-0 overflow-hidden rounded bg-panel3/50">
      <div ref={barRef} className="h-full bg-accent/80" style={{ width: '0%' }} />
    </div>
  )
}

// What a binding's shaping does, in a few words (the chip's tooltip).
function shapeSummary(s: import('@shared/types').ModShape): string {
  const ops: Record<string, string> = { add: '+', sub: '−', mul: '×', min: 'min', max: 'max' }
  const parts: string[] = []
  if (s.with?.length && s.op) parts.push(`combined ${ops[s.op]} ${s.with.map((m) => `M${m + 1}`).join(', ')}`)
  if ((s.threshold ?? 0) > 0) parts.push(`threshold ${s.threshold!.toFixed(2)} (${s.thresholdMode === 'gate' ? 'gate' : 'cut'})`)
  if (s.integrate === 'flow') parts.push(`integrated (flow ${s.rate ?? 0.25}/s, ${s.ends === 'wrap' ? 'wrap' : 'bounce'})`)
  if (s.integrate === 'step') parts.push(`integrated (a notch of ${s.step ?? 0.125} per hit, ${s.ends === 'wrap' ? 'wrap' : 'bounce'})`)
  return `Shaped : ${parts.join(' · ')}`
}

// ── Matrix summary : every assignment, with depth + remove ────────────
function MatrixSummary(): JSX.Element {
  const matrix = useStore((s) => s.composition.modMatrix)
  const composition = useStore((s) => s.composition)
  const removeAssignment = useStore((s) => s.removeAssignment)
  const setAssignmentDepth = useStore((s) => s.setAssignmentDepth)
  const toggleAssignmentMuted = useStore((s) => s.toggleAssignmentMuted)

  function describe(a: (typeof matrix)[number]): string {
    const t = a.target
    if (t.kind === 'source') return `L${t.layer + 1}·${t.slot} ${t.input}`
    if (t.kind === 'bgSource') return `BG ${t.input}`
    if (t.kind === 'meta') {
      const name = composition.metaKnobs[t.knob]?.name ?? `Knob ${t.knob + 1}`
      return `META K${t.knob + 1} (${name})`
    }
    if (t.kind === 'sonify') return t.param.startsWith('space.') ? `SPACE ${t.param.slice(6).replace('.', ' ')}` : `SONIFY ${t.param}`
    if (t.kind === 'layer') {
      // `vary` is a trigger, so it is named as one : the row fires on a
      // crossing rather than holding a value, which the panel should not hide.
      const f = t.field === 'mix' ? 'A/B mix' : t.field === 'harmony' ? 'A/B hue' : t.field === 'vary' ? 'vary ▸' : t.field
      return `L${t.layer + 1} ${f}`
    }
    if (t.kind === 'bg') return `BG ${t.field === 'depth' ? 'shadow' : t.field}`
    if (t.kind === 'dome') return `Dome ${DOME_MOD_RANGE[t.field].label}`
    if (t.kind === 'outx') return `Output ${OUTX_MOD_RANGE[t.field].label}`
    if (t.kind === 'world') return 'World amount'
    if (t.kind === 'au') return auLabel(t)
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
    const inputLabel = t.input === FX_OPACITY_INPUT ? 'opacity' : t.input
    return `${where}·${fxName} ${inputLabel}`
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {matrix.map((a) => (
        <span
          key={a.id}
          onClick={() => toggleAssignmentMuted(a.id)}
          className={`flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] transition-opacity ${
            a.muted ? 'border-border/50 bg-panel2/40 opacity-50' : 'border-border bg-panel2 hover:border-accent/50'
          }`}
          title={a.muted ? `${describe(a)} : off. Click to turn it on.` : `${describe(a)} : click to turn it off (depth and binding are kept)`}
        >
          <span className={a.muted ? 'text-muted' : 'text-accent'}>M{a.mod + 1}</span>
          {shapeActive(a.shape) && (
            <span className="text-accent2" title={shapeSummary(a.shape!)}>⌇</span>
          )}
          <span className={`max-w-[160px] truncate text-muted ${a.muted ? 'line-through' : ''}`}>
            {describe(a)}
          </span>
          <input
            type="range"
            min={-10}
            max={10}
            step={0.05}
            value={a.depth}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setAssignmentDepth(a.id, Number(e.target.value))}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setAssignmentDepth(a.id, 0.5)
            }}
            className="w-14 accent-accent"
            title={`Depth ${a.depth.toFixed(2)} (bipolar). Double-click : 0.5`}
          />
          <button
            onClick={(e) => {
              e.stopPropagation()
              removeAssignment(a.id)
            }}
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
