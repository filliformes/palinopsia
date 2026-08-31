// Mixer : a compact 4-column surface: just each layer's Opacity, Speed and
// Blend, with no source/FX detail. Toggled in place of the layer strips with
// the M key (or the header button). Fills the full column height, with tall
// vertical faders. Carries its own app-persistent presets.

import { useState } from 'react'
import type { BlendMode } from '@shared/types'
import { BLEND_MODES } from '@shared/types'
import { useStore } from '../store'
import { BoundedNumberInput } from './BoundedNumberInput'
import { PromptModal } from './PromptModal'

export function MixerPanel(): JSX.Element {
  const layers = useStore((s) => s.composition.layers)
  const setOpacity = useStore((s) => s.setOpacity)
  const setLayerSpeed = useStore((s) => s.setLayerSpeed)
  const setBlend = useStore((s) => s.setBlend)
  const toggleMute = useStore((s) => s.toggleMute)
  const toggleSolo = useStore((s) => s.toggleSolo)
  const mixerPresets = useStore((s) => s.mixerPresets)
  const saveMixerPreset = useStore((s) => s.saveMixerPreset)
  const applyMixerPreset = useStore((s) => s.applyMixerPreset)
  const deleteMixerPreset = useStore((s) => s.deleteMixerPreset)
  const [savePrompt, setSavePrompt] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-md border border-border bg-panel p-2">
      {/* Header: title · presets · save */}
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
            onClick={() => setSavePrompt(true)}
            className="rounded border border-accent/50 bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] text-accent hover:bg-accent/20"
            title="Save the current opacity/speed/blend of all 4 layers as a mix"
          >
            + save
          </button>
        </div>
      </div>

      {/* Four columns : one per layer : filling the section height */}
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-2">
        {layers.map((l, i) => (
          <div
            key={l.id}
            className="flex min-h-0 flex-col items-center gap-2 rounded border border-border bg-panel2/50 p-1.5"
          >
            {/* Layer id + solo/mute : the same S/⊘ chips as the layer strips,
                so a blackout or solo is one click without leaving the Mixer. */}
            <div className="flex shrink-0 items-center gap-1">
              <span className="font-mono text-[10px] text-muted">L{i + 1}</span>
              <button
                onClick={() => toggleSolo(i)}
                className={`rounded px-1 py-0.5 font-mono text-[9px] leading-none transition-colors ${
                  l.solo ? 'bg-accent/25 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
                }`}
                title="Solo this layer"
              >
                S
              </button>
              <button
                onClick={() => toggleMute(i)}
                className={`rounded px-1 py-0.5 font-mono text-[9px] leading-none transition-colors ${
                  l.mute ? 'bg-accent/25 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
                }`}
                title="Mute this layer"
              >
                ⊘
              </button>
            </div>

            {/* Opacity then Speed stacked : one clean vertical column, each
                fader with its readout directly beneath it. */}
            <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2">
              <VFader
                label="OPA"
                value={l.opacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => setOpacity(i, v)}
              />
              <VFader
                label="SPD"
                value={l.speed}
                min={0}
                max={20}
                step={0.05}
                onChange={(v) => setLayerSpeed(i, v)}
              />
            </div>

            {/* Blend : full width, no native arrow / chevron, tiny padding so
                even the longest mode name ("difference") shows without cropping. */}
            <select
              className="input w-full shrink-0 appearance-none !px-1 !py-0.5 text-center !text-[9px]"
              style={{ backgroundImage: 'none' }}
              value={l.blend}
              onChange={(e) => setBlend(i, e.target.value as BlendMode)}
              title="Blend against the stack below"
            >
              {BLEND_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

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

// One tall vertical fader: label on top, the fader filling the column, an
// editable numeric readout at the bottom.
function VFader({
  label,
  value,
  min,
  max,
  step,
  neutral = 1,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  neutral?: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1">
      <span className="shrink-0 font-mono text-[9px] uppercase text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(neutral)}
        // Modern vertical range: writing-mode makes it vertical, rtl puts the
        // minimum at the bottom (up = more).
        style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
        className="min-h-[40px] flex-1 accent-accent"
        title={`${label} ${value.toFixed(2)} : double-click resets to ${neutral}`}
      />
      <BoundedNumberInput
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        // ! overrides the unlayered .input padding/font so the full number fits.
        className="input w-full shrink-0 !px-0.5 !py-0.5 text-center !text-[9px]"
      />
    </div>
  )
}
