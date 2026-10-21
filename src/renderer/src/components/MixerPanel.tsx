// Mixer : the four layers side by side, one column each, top to bottom in the
// order the picture flows : A·B (how the two sources meet : the mode, the A–B
// crossfader, the HUE harmony, the CPL coupling to the sound), then LAYER (how
// the layer lands on the stack : opacity, speed, blend). Toggled in place of
// the layer strips with the M key (or the header button). The header carries
// the coupling master switch and the app-persistent mix presets (they keep the
// A·B part too).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AudioFeature, BlendMode, CouplingMode, LayerState, ModTarget, SourceSlot } from '@shared/types'
import { BLEND_MODES } from '@shared/types'
import { modTargetKey, useStore } from '../store'
import { AUDIO_FEATURES, AUDIO_BANDS, audioBus } from '../engine/audioIn'
import { liveCoupledMix } from '../engine/coupling'
import { liveModValues } from '../engine/modulation'
import { abSwatches, harmonizeRgb, wantAbSwatches } from '../engine/abHarmony'
import { SHADER_BY_ID } from '../shaders/isf'
import { AssignRow } from './AutoControls'
import { BoundedNumberInput } from './BoundedNumberInput'
import { MidiLearnOverlay } from './MidiLearnOverlay'
import { PromptModal } from './PromptModal'
import { registerLiveOverlay } from './liveOverlay'
import { couplingWords, mixTitle, mixWord } from './abMix'
import { useModSlide } from './useModSlide'
import { PinZone, usePin } from './Pin'
import { layerPin, layerSpeedPin } from '../persist'

const COUPLING_MODES: CouplingMode[] = ['off', 'lean', 'hocket', 'cut', 'gate', 'drift']
const COUPLING_TITLE =
  'How the sound moves this mix : lean (pushes toward B) · hocket (sets the balance, pumps) · cut (a flash to B on each hit) · gate (B while loud) · drift (slow momentum)'
type ModField = 'mix' | 'harmony'

export function MixerPanel(): JSX.Element {
  const layers = useStore((s) => s.composition.layers)
  const couplingOn = useStore((s) => s.couplingOn)
  const setCouplingOn = useStore((s) => s.setCouplingOn)
  const mixerPresets = useStore((s) => s.mixerPresets)
  const saveMixerPreset = useStore((s) => s.saveMixerPreset)
  const applyMixerPreset = useStore((s) => s.applyMixerPreset)
  const deleteMixerPreset = useStore((s) => s.deleteMixerPreset)
  const [savePrompt, setSavePrompt] = useState(false)
  const [openMod, setOpenMod] = useState<{ layer: number; field: ModField } | null>(null)

  // The sources' colors for the HUE swatches : measured only while the Mixer is open.
  useEffect(() => {
    wantAbSwatches(true)
    return () => wantAbSwatches(false)
  }, [])

  // One loop paints what moves on its own : where the coupling puts each mix
  // (the white line on the crossfader, the word under it) and the sound
  // driving it (the CPL meter). Straight to the DOM, never through React.
  const ghostRefs = useRef<Array<HTMLSpanElement | null>>([])
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([])
  const meterRefs = useRef<Array<HTMLSpanElement | null>>([])
  useEffect(() => {
    let raf = 0
    const paint = (): void => {
      const st = useStore.getState()
      st.composition.layers.forEach((l, i) => {
        const live = liveCoupledMix[i]
        const ghost = ghostRefs.current[i]
        if (ghost) {
          ghost.style.display = live == null ? 'none' : 'block'
          if (live != null) ghost.style.left = `${live * 100}%`
        }
        const word = wordRefs.current[i]
        if (word) {
          const mod = liveModValues.get(modTargetKey({ kind: 'layer', layer: i, field: 'mix' }))
          const v = live ?? mod ?? l.sourceMix
          const text = `${mixWord(l.sourceBlend)} ${v.toFixed(2)}`
          if (word.textContent !== text) word.textContent = text // only on a change : no layout every frame
        }
        const meter = meterRefs.current[i]
        if (meter) {
          const hasB = !!l.sourceB && l.sourceB.kind !== 'none'
          const listening = hasB && st.couplingOn && audioBus.mode !== 'off' && l.coupling.mode !== 'off'
          const f = listening ? audioBus.feature(l.coupling.feature, l.coupling.band ?? 0) : 0
          meter.style.width = `${Math.max(0, Math.min(1, f)) * 100}%`
        }
      })
      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-md border border-border bg-panel p-2">
      {/* Header : title · presets · the coupling master switch · save */}
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted">Mixer</span>
        <div className="flex-1" />
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {mixerPresets.map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-1 rounded border border-border bg-panel2 px-1.5 py-0.5 font-mono text-[9px]"
            >
              <button
                onClick={() => applyMixerPreset(p.id)}
                className="text-muted hover:text-accent"
                title={`Apply mix "${p.name}"`}
              >
                {p.name}
              </button>
              <button
                onClick={() => deleteMixerPreset(p.id)}
                className="text-muted hover:text-danger"
                title={`Delete mix "${p.name}"`}
              >
                ×
              </button>
            </span>
          ))}
          <button
            onClick={() => setCouplingOn(!couplingOn)}
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
              couplingOn ? 'bg-accent/20 text-accent ring-1 ring-accent/60' : 'bg-panel3/60 text-muted hover:text-text'
            }`}
            title={
              couplingOn
                ? 'A/B coupling on : the sound moves each coupled layer\'s mix (the CPL rows below). Click to pause it on every layer at once'
                : 'A/B coupling paused : every mix sits where its slider is. Click to let the sound move them again'
            }
          >
            ≈ coupling {couplingOn ? 'on' : 'paused'}
          </button>
          <button
            onClick={() => setSavePrompt(true)}
            className="rounded border border-accent/50 bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] text-accent hover:bg-accent/20"
            title="Save this mix : each layer's opacity, speed and blend, and its A·B (mix, mode, hue, coupling)"
          >
            + save
          </button>
        </div>
      </div>

      {/* Four columns : one per layer : filling the section height */}
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-2">
        {layers.map((l, i) => (
          <MixerColumn
            key={l.id}
            index={i}
            layer={l}
            openMod={openMod}
            setOpenMod={setOpenMod}
            ghostRef={(el) => (ghostRefs.current[i] = el)}
            wordRef={(el) => (wordRefs.current[i] = el)}
            meterRef={(el) => (meterRefs.current[i] = el)}
          />
        ))}
      </div>

      {/* A column is too narrow for the modulator row : the one being edited
          opens here, the Mixer's full width. */}
      {openMod && (
        <ModAssignBar layer={openMod.layer} field={openMod.field} onClose={() => setOpenMod(null)} />
      )}

      {savePrompt && (
        <PromptModal
          title="Mix preset name?"
          placeholder="e.g. Fade B up"
          confirmLabel="Save"
          onConfirm={(name) => {
            saveMixerPreset(name)
            setSavePrompt(false)
          }}
          onCancel={() => setSavePrompt(false)}
        />
      )}
    </div>
  )
}

const slotName = (slot: SourceSlot | null | undefined): string | null => {
  if (!slot || slot.kind === 'none') return null
  if (slot.shaderId) return SHADER_BY_ID[slot.shaderId]?.name ?? slot.shaderId
  return slot.mediaName || slot.kind
}

function MixerColumn({
  index,
  layer: l,
  openMod,
  setOpenMod,
  ghostRef,
  wordRef,
  meterRef
}: {
  index: number
  layer: LayerState
  openMod: { layer: number; field: ModField } | null
  setOpenMod: (v: { layer: number; field: ModField } | null) => void
  ghostRef: (el: HTMLSpanElement | null) => void
  wordRef: (el: HTMLSpanElement | null) => void
  meterRef: (el: HTMLSpanElement | null) => void
}): JSX.Element {
  const setOpacity = useStore((s) => s.setOpacity)
  const setLayerSpeed = useStore((s) => s.setLayerSpeed)
  const setBlend = useStore((s) => s.setBlend)
  const toggleMute = useStore((s) => s.toggleMute)
  const toggleSolo = useStore((s) => s.toggleSolo)
  const setSourceMix = useStore((s) => s.setSourceMix)
  const setSourceBlend = useStore((s) => s.setSourceBlend)
  const setHarmony = useStore((s) => s.setHarmony)
  const setCoupling = useStore((s) => s.setCoupling)
  const couplingOn = useStore((s) => s.couplingOn)
  const audioOff = useStore((s) => !s.audioEnabled)
  const anySolo = useStore((s) => s.composition.layers.some((x) => x.solo))

  const a = slotName(l.sourceA)
  const b = slotName(l.sourceB)
  const hasB = b !== null
  const keyOf = (field: ModField | 'opacity' | 'blend'): string => modTargetKey({ kind: 'layer', layer: index, field })
  const boundCount = useStore(
    useShallow((s) => {
      const onMeta = (k: string): boolean => s.composition.metaKnobs.some((m) => m.destinations.some((d) => modTargetKey(d) === k))
      const count = (k: string): number => s.composition.modMatrix.filter((x) => modTargetKey(x.target) === k).length + (onMeta(k) ? 1 : 0)
      return [count(keyOf('mix')), count(keyOf('harmony')), count(keyOf('opacity')), count(keyOf('blend'))]
    })
  )
  const [mixBound, hueBound, opaBound, blendBound] = [boundCount[0] > 0, boundCount[1] > 0, boundCount[2] > 0, boundCount[3] > 0]

  // Bound sliders follow their live value (the app-wide behaviour), the blend
  // menu its live mode; a drag on a modulated slider moves its base by as much
  // as the thumb moves.
  const mixRef = useRef<HTMLInputElement | null>(null)
  const hueRef = useRef<HTMLInputElement | null>(null)
  const blendRef = useRef<HTMLSelectElement | null>(null)
  useEffect(() => {
    const offs: Array<() => void> = []
    if (mixBound && mixRef.current) offs.push(registerLiveOverlay({ el: mixRef.current, key: keyOf('mix'), format: (x) => String(x) }))
    if (hueBound && hueRef.current) offs.push(registerLiveOverlay({ el: hueRef.current, key: keyOf('harmony'), format: (x) => String(x) }))
    if (blendBound && blendRef.current)
      offs.push(registerLiveOverlay({
        el: blendRef.current,
        key: keyOf('blend'),
        format: (x) => BLEND_MODES[Math.max(0, Math.min(BLEND_MODES.length - 1, Math.round(x)))] ?? BLEND_MODES[0]
      }))
    return () => offs.forEach((o) => o())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixBound, hueBound, blendBound, index])
  const mixSlide = useModSlide(mixBound, l.sourceMix, 0, 1, (v) => setSourceMix(index, v))
  const hueSlide = useModSlide(hueBound, l.harmony, -1, 1, (v) => setHarmony(index, Math.abs(v) < 0.04 ? 0 : v))

  // The HUE swatches : A's color and where B lands (its mean through the
  // harmony), from the engine's few-times-a-second measure.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 250)
    return () => window.clearInterval(id)
  }, [])
  const sw = abSwatches[index]
  const css = (c: number[] | null | undefined): string =>
    c ? `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})` : 'rgb(var(--c-panel3))'
  const swA = hasB ? css(sw?.a) : css(null)
  const swB = hasB && sw ? css(harmonizeRgb(sw.b, sw.a, sw.b, l.harmony, sw.side)) : css(null)

  const coupled = couplingOn && hasB && l.coupling.mode !== 'off'
  const cplOff = l.coupling.mode === 'off'
  // the whole layer persistent : its column wears the pin's color (right-click
  // its header to pin or unpin, as on the layer itself)
  const whole = usePin(layerPin(index), `L${index + 1}, the whole layer`)

  return (
    <div
      className="flex min-h-0 min-w-0 flex-col gap-1.5 rounded border border-border bg-panel2/50 p-1.5"
      style={whole.pinned ? { borderColor: 'rgb(var(--c-pin) / 0.75)' } : undefined}
    >
      {/* Layer id + solo/mute : one click without leaving the Mixer. */}
      <div className="flex shrink-0 items-center gap-1" onContextMenu={whole.onContextMenu}>
        {whole.menu}
        <span
          className="font-mono text-[10px]"
          style={{ color: whole.pinned ? 'rgb(var(--c-pin))' : 'rgb(var(--c-muted))' }}
          title={whole.pinned ? 'Persistent : no scene, Randomize or Generate changes this layer (right-click to unpin)' : 'Right-click : make the whole layer persistent'}
        >
          L{index + 1}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => toggleSolo(index)}
          className={`rounded px-1 py-0.5 font-mono text-[9px] leading-none transition-colors ${
            l.solo ? 'bg-accent/25 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
          }`}
          title="Solo this layer"
        >
          S
        </button>
        <button
          onClick={() => toggleMute(index)}
          className={`rounded px-1 py-0.5 font-mono text-[9px] leading-none transition-colors ${
            l.mute ? 'bg-accent/25 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
          }`}
          title="Mute this layer"
        >
          ⊘
        </button>
      </div>
      {/* What is being mixed */}
      <div className="shrink-0 font-mono text-[9px] leading-tight" title={`A : ${a ?? 'empty'} · B : ${b ?? 'none'}`}>
        <div className="truncate text-text/80">A {a ?? 'empty'}</div>
        <div className={`truncate ${hasB ? 'text-accent' : 'text-muted/60'}`}>B {b ?? 'none'}</div>
      </div>

      {/* ── A·B : how the two sources meet. Asleep (dimmed) without a B. */}
      <Section label="A·B">
        <ModChip count={boundCount[0]} open={openMod?.layer === index && openMod.field === 'mix'} onToggle={() => setOpenMod(openMod?.layer === index && openMod.field === 'mix' ? null : { layer: index, field: 'mix' })} target={{ kind: 'layer', layer: index, field: 'mix' }} what="A/B mix" />
      </Section>
      <div className={`flex shrink-0 flex-col gap-1 ${hasB ? '' : 'opacity-40'}`} title={hasB ? undefined : 'No Source B : pick one in the layer and these mix it with A'}>
        <select
          className="input w-full appearance-none !px-1 !py-0.5 text-center !text-[9px]"
          style={{ backgroundImage: 'none' }}
          value={l.sourceBlend}
          onChange={(e) => setSourceBlend(index, e.target.value as BlendMode)}
          title="How B meets A : the crossfader below is what this mode makes of it"
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <PinZone pin={modTargetKey({ kind: 'layer', layer: index, field: 'mix' })} label={`L${index + 1} A·B mix`}>
        <div className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 font-mono text-[9px] text-text/80">A</span>
          <span className="relative flex min-w-0 flex-1">
            <MidiLearnOverlay id={`layer:${index}:mix`} />
            <input
              ref={mixRef}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={l.sourceMix}
              {...mixSlide}
              onDoubleClick={() => setSourceMix(index, 0.5)}
              className={`w-full min-w-0 ${mixBound ? 'accent-accent2' : 'accent-accent'}`}
              title={mixBound ? `${mixTitle(l.sourceBlend)} : modulated (a drag moves the base by as much as you move it)` : mixTitle(l.sourceBlend)}
            />
            {/* where the coupling puts it now */}
            <span
              ref={ghostRef}
              className="pointer-events-none absolute -bottom-0.5 -top-0.5 w-0.5 -translate-x-1/2 rounded bg-text"
              style={{ display: 'none' }}
              title="Where the sound puts the mix now"
            />
          </span>
          <span className="shrink-0 font-mono text-[9px] text-accent">B</span>
        </div>
        </PinZone>
        {/* the Mixer's loop writes it (never React : its text would be swapped
            under it), seeded at mount so it never shows empty */}
        <span
          ref={(el) => {
            wordRef(el)
            if (el && !el.textContent) el.textContent = `${mixWord(l.sourceBlend)} ${l.sourceMix.toFixed(2)}`
          }}
          className={`block text-center font-mono text-[9px] tabular-nums ${mixBound ? 'text-accent2' : coupled ? 'text-accent' : 'text-muted'}`}
          title={mixTitle(l.sourceBlend)}
        />
      </div>

      {/* ── HUE : B's colors set against A's. Middle : B untouched. */}
      <Section label="HUE">
        <ModChip count={boundCount[1]} open={openMod?.layer === index && openMod.field === 'harmony'} onToggle={() => setOpenMod(openMod?.layer === index && openMod.field === 'harmony' ? null : { layer: index, field: 'harmony' })} target={{ kind: 'layer', layer: index, field: 'harmony' }} what="A/B hue" />
      </Section>
      <div className={`flex shrink-0 flex-col gap-0.5 ${hasB ? '' : 'opacity-40'}`}>
        <PinZone pin={modTargetKey({ kind: 'layer', layer: index, field: 'harmony' })} label={`L${index + 1} A·B hue`}>
        <div className="flex min-w-0 items-center gap-1">
          <span className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-border" style={{ background: swA }} title="A's color (its average)" />
          <span className="relative flex min-w-0 flex-1">
            <MidiLearnOverlay id={`layer:${index}:harmony`} />
            <input
              ref={hueRef}
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={l.harmony}
              {...hueSlide}
              onDoubleClick={() => setHarmony(index, 0)}
              className={`w-full min-w-0 ${hueBound ? 'accent-accent2' : 'accent-accent'}`}
              title={`Harmony ${l.harmony.toFixed(2)} : left pulls B onto A's colors (matched), right pushes it onto their opposite (clashing), the middle leaves B as it is. Double-click : the middle`}
            />
            <span className="pointer-events-none absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-muted/50" />
          </span>
          <span className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-border" style={{ background: swB }} title="Where B's color lands" />
        </div>
        </PinZone>
        <div className="flex justify-between font-mono text-[9px] leading-none text-muted/80">
          <span>match</span>
          <span>clash</span>
        </div>
      </div>

      {/* ── CPL : the sound moving the mix. */}
      <Section label={audioOff ? 'CPL · no audio in' : 'CPL'} />
      <div className={`flex shrink-0 flex-col gap-1 ${hasB ? '' : 'opacity-40'}`} title={audioOff ? 'The audio input is off (audio tab) : the coupling waits for it' : undefined}>
        {/* the mode, then what drives it on a line of its own (side by side,
            a column cut the words short); a band's number beside the word band */}
        <select
          className={`input w-full appearance-none !px-0.5 !py-0.5 text-center !text-[9px] ${coupled ? 'text-accent' : ''}`}
          style={{ backgroundImage: 'none' }}
          value={l.coupling.mode}
          onChange={(e) => setCoupling(index, { mode: e.target.value as CouplingMode })}
          title={COUPLING_TITLE}
        >
          {COUPLING_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div className="flex min-w-0 gap-1">
          <select
            className="input min-w-0 flex-1 appearance-none !px-0.5 !py-0.5 text-center !text-[9px]"
            style={{ backgroundImage: 'none' }}
            value={l.coupling.feature}
            onChange={(e) => setCoupling(index, { feature: e.target.value as AudioFeature })}
            title="What in the sound drives it (transient and flux read best)"
            disabled={cplOff}
          >
            {AUDIO_FEATURES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          {l.coupling.feature === 'band' && !cplOff && (
            <select
              className="input min-w-0 flex-1 appearance-none !px-0.5 !py-0.5 text-center !text-[9px]"
              style={{ backgroundImage: 'none' }}
              value={l.coupling.band ?? 0}
              onChange={(e) => setCoupling(index, { band: Number(e.target.value) })}
              title="Which band of the spectrum (1 : the lowest)"
            >
              {Array.from({ length: AUDIO_BANDS }, (_, k) => (
                <option key={k} value={k}>
                  {k + 1}
                </option>
              ))}
            </select>
          )}
        </div>
        {/* the sound it listens to, live */}
        <span className="relative block h-1.5 overflow-hidden rounded-sm bg-panel3/70" title={cplOff ? 'Coupling off' : `What it hears : ${couplingWords(l.coupling)}`}>
          <span ref={meterRef} className="absolute inset-y-0 left-0 bg-accent" style={{ width: 0 }} />
        </span>
        <div className={`flex justify-around ${cplOff ? 'opacity-40' : ''}`}>
          <MiniKnob
            label="amt"
            value={l.coupling.amount}
            def={0.5}
            onChange={(v) => setCoupling(index, { amount: v })}
            title="How far the sound moves the mix"
          />
          <MiniKnob
            label="tight"
            value={l.coupling.tightness}
            def={0.7}
            onChange={(v) => setCoupling(index, { tightness: v })}
            title="Loose : only the peaks, softly. Tight : every bit of it, sharply (the flash's length, the gate's edge, the drift's speed)"
          />
        </div>
      </div>

      {/* ── LAYER : how it lands on the stack. */}
      <Section label="LAYER">
        {/* a modulated opacity : what it is now (read with the swatches, 4 times a second) */}
        <ActiveTag a={a} b={b} mute={l.mute} solo={l.solo} anySolo={anySolo} opacity={opaBound ? (liveModValues.get(keyOf('opacity')) ?? l.opacity) : l.opacity} />
      </Section>
      <div className="flex min-h-0 w-full flex-1 gap-1">
        <PinZone pin={modTargetKey({ kind: 'layer', layer: index, field: 'opacity' })} label={`L${index + 1} opacity`}>
          <VFader label="OPA" value={l.opacity} min={0} max={1} step={0.01} onChange={(v) => setOpacity(index, v)} midiId={`layer:${index}:opacity`} liveKey={opaBound ? keyOf('opacity') : undefined} />
        </PinZone>
        <PinZone pin={layerSpeedPin(index)} label={`L${index + 1} speed`}>
          <VFader label="SPD" value={l.speed} min={0} max={20} step={0.05} onChange={(v) => setLayerSpeed(index, v)} />
        </PinZone>
      </div>
      <PinZone pin={modTargetKey({ kind: 'layer', layer: index, field: 'blend' })} label={`L${index + 1} blend`}>
      <select
        ref={blendRef}
        className={`input w-full shrink-0 appearance-none !px-1 !py-0.5 text-center !text-[9px] ${blendBound ? 'text-accent2 ring-1 ring-accent2' : ''}`}
        style={{ backgroundImage: 'none' }}
        value={l.blend}
        onChange={(e) => setBlend(index, e.target.value as BlendMode)}
        title={blendBound ? 'How this layer lands on the layers below : modulated, it shows the mode playing now' : 'How this layer lands on the layers below'}
      >
        {BLEND_MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      </PinZone>
    </div>
  )
}

// A section's title, a line above it, an optional control at its right.
function Section({ label, children }: { label: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-between border-t border-border/70 pt-1 font-mono text-[9px] uppercase tracking-wide text-muted">
      <span className="truncate">{label}</span>
      {children}
    </div>
  )
}

// Does the layer show in the stack ? Active : it has a source and nothing
// hides it (the same rule the compositor draws by : a soloed layer elsewhere
// hides every other one, else mute does). The title says why not.
function ActiveTag({ a, b, mute, solo, anySolo, opacity }: { a: string | null; b: string | null; mute: boolean; solo: boolean; anySolo: boolean; opacity: number }): JSX.Element {
  const why =
    a === null && b === null
      ? 'no source : pick one in the layer'
      : anySolo && !solo
        ? 'another layer is soloed'
        : !anySolo && mute
          ? 'muted'
          : opacity <= 0
            ? 'opacity at 0'
            : null
  return (
    <span
      className={`shrink-0 normal-case tracking-normal ${why ? 'text-muted/60' : 'text-accent'}`}
      title={why ? `Inactive : ${why}` : 'Active : this layer shows in the stack'}
    >
      {why ? 'inactive' : 'active'}
    </span>
  )
}

// The M chip : opens this control's modulator row (under the columns).
// Right-click clears its modulation.
function ModChip({ count, open, onToggle, target, what }: { count: number; open: boolean; onToggle: () => void; target: ModTarget; what: string }): JSX.Element {
  const key = modTargetKey(target)
  return (
    <button
      onClick={onToggle}
      onContextMenu={(e) => {
        e.preventDefault()
        const st = useStore.getState()
        st.composition.modMatrix.filter((a) => modTargetKey(a.target) === key).forEach((a) => st.removeAssignment(a.id))
        st.composition.metaKnobs.forEach((k, i) => {
          if (k.destinations.some((d) => modTargetKey(d) === key)) st.toggleMetaDest(i, target)
        })
      }}
      className={`shrink-0 rounded px-1 font-mono text-[9px] normal-case leading-4 tracking-normal transition-colors ${
        count > 0
          ? 'bg-accent/20 text-accent ring-1 ring-accent'
          : open
            ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2'
            : 'bg-panel3/60 text-muted hover:text-text'
      }`}
      title={`Modulate the ${what} : a modulator or a Meta knob moves it. Right-click clears its modulation.`}
    >
      M
    </button>
  )
}

function ModAssignBar({ layer, field, onClose }: { layer: number; field: ModField; onClose: () => void }): JSX.Element {
  const target: ModTarget = { kind: 'layer', layer, field }
  const key = modTargetKey(target)
  const bound = useStore(useShallow((s) => s.composition.modMatrix.filter((a) => modTargetKey(a.target) === key)))
  return (
    <div className="shrink-0 rounded border border-accent2/40 bg-panel2/60 p-1.5">
      <div className="mb-1 flex items-center gap-2 font-mono text-[9px] text-muted">
        <span className="uppercase tracking-wide">L{layer + 1} {field === 'mix' ? 'A/B mix' : 'A/B hue'} : modulation</span>
        <div className="flex-1" />
        <button onClick={onClose} className="text-muted hover:text-text" title="Close">
          ×
        </button>
      </div>
      <AssignRow target={target} bound={bound} />
    </div>
  )
}

// A small knob : drag up and down (Shift : finer), double-click resets.
function MiniKnob({ label, value, def, onChange, title }: { label: string; value: number; def: number; onChange: (v: number) => void; title: string }): JSX.Element {
  const drag = useRef<{ y: number; v: number; id: number } | null>(null)
  const PX = 26
  const r = PX / 2 - 3, c = PX / 2
  const rad = (deg: number): number => ((deg - 90) * Math.PI) / 180
  const a0 = 225, a = a0 + Math.max(0, Math.min(1, value)) * 270
  const pt = (deg: number): string => `${c + r * Math.cos(rad(deg))} ${c + r * Math.sin(rad(deg))}`
  const down = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    // on the knob's own box : the value arc leaves the DOM at 0, and a capture
    // on it went with it (the drag then stuck to the mouse)
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, v: value, id: e.pointerId }
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    onChange(Math.max(0, Math.min(1, d.v + (d.y - e.clientY) / (e.shiftKey ? 600 : 150))))
  }
  const up = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.id === e.pointerId) drag.current = null
  }
  return (
    <div className="flex flex-col items-center gap-0.5" title={`${title} : ${value.toFixed(2)} (drag up/down, Shift finer, double-click resets)`}>
      <div
        className="cursor-ns-resize"
        style={{ width: PX, height: PX, touchAction: 'none' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onDoubleClick={() => onChange(def)}
      >
        <svg width={PX} height={PX}>
          <path d={`M ${pt(a0)} A ${r} ${r} 0 1 1 ${pt(a0 + 270)}`} fill="none" stroke="rgb(var(--c-panel3))" strokeWidth={3} strokeLinecap="round" />
          {value > 0.005 && (
            <path d={`M ${pt(a0)} A ${r} ${r} 0 ${a - a0 > 180 ? 1 : 0} 1 ${pt(a)}`} fill="none" stroke="rgb(var(--c-accent))" strokeWidth={3} strokeLinecap="round" />
          )}
        </svg>
      </div>
      <span className="font-mono text-[9px] leading-none text-muted">
        {label} {value.toFixed(2)}
      </span>
    </div>
  )
}

// One vertical fader : label on top, the fader filling the column, an editable
// readout at the bottom (rounded : a long float clipped in the box; from 10 up,
// one decimal, so "12.4" fits where "12.35" was cut). With a liveKey (it is
// modulated) the thumb and the number follow the live value, and a drag moves
// the base by as much as the thumb moves.
function VFader({
  label,
  value,
  min,
  max,
  step,
  neutral = 1,
  onChange,
  midiId,
  liveKey
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  neutral?: number
  onChange: (v: number) => void
  midiId?: string
  liveKey?: string
}): JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!liveKey || !el) return
    return registerLiveOverlay({ el, key: liveKey, format: (x) => String(x) })
  }, [liveKey])
  const slide = useModSlide(!!liveKey, value, min, max, onChange)
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center gap-1">
      <span className="shrink-0 font-mono text-[9px] uppercase text-muted">{label}</span>
      <span className="relative flex min-h-[40px] flex-1 justify-center">
        {midiId && <MidiLearnOverlay id={midiId} />}
        <input
          ref={ref}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          {...slide}
          onDoubleClick={() => onChange(neutral)}
          // Modern vertical range: writing-mode makes it vertical, rtl puts the
          // minimum at the bottom (up = more).
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
          className={`min-h-[40px] flex-1 ${liveKey ? 'accent-accent2' : 'accent-accent'}`}
          title={liveKey ? `${label} ${value.toFixed(2)} : modulated (a drag moves the base by as much as you move it)` : `${label} ${value.toFixed(2)} : double-click resets to ${neutral}`}
        />
      </span>
      <BoundedNumberInput
        value={Math.round(value * 100) / 100}
        min={min}
        max={max}
        maxFrac={Math.abs(value) >= 10 ? 1 : 2}
        liveKey={liveKey}
        onChange={onChange}
        // ! overrides the unlayered .input padding/font so the full number fits.
        className="input w-full shrink-0 !px-0.5 !py-0.5 text-center !text-[9px]"
      />
    </div>
  )
}
