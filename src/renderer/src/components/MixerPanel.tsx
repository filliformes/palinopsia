// Mixer — a compact 4-column surface: just each layer's Opacity, Speed and
// Blend, with no source/FX detail. Toggled in place of the layer strips with
// the M key (or the header button). Carries its own app-persistent presets.

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
  const toggleMixerView = useStore((s) => s.toggleMixerView)
  const mixerPresets = useStore((s) => s.mixerPresets)
  const saveMixerPreset = useStore((s) => s.saveMixerPreset)
  const applyMixerPreset = useStore((s) => s.applyMixerPreset)
  const deleteMixerPreset = useStore((s) => s.deleteMixerPreset)
  const [savePrompt, setSavePrompt] = useState(false)

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-panel p-2">
      {/* Header: title · presets · save · back to layers */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted">Mixer</span>
        <button
          onClick={() => toggleMixerView()}
          className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-accent"
          title="Back to the layer strips (M)"
        >
          ▸ layers
        </button>
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

      {/* Four columns — one per layer */}
      <div className="grid grid-cols-4 gap-2">
        {layers.map((l, i) => (
          <div
            key={l.id}
            className="flex min-w-0 flex-col gap-1.5 rounded border border-border bg-panel2/50 p-1.5"
          >
            <span className="text-center font-mono text-[10px] text-muted">L{i + 1}</span>

            <Field label="OPACITY">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={l.opacity}
                onChange={(e) => setOpacity(i, Number(e.target.value))}
                className="min-w-0 flex-1 accent-accent"
                title={`Opacity ${l.opacity.toFixed(2)}`}
              />
              <BoundedNumberInput
                value={l.opacity}
                min={0}
                max={1}
                onChange={(v) => setOpacity(i, v)}
                className="input w-11 shrink-0 px-1 py-0.5 text-right text-[10px]"
              />
            </Field>

            <Field label="SPEED">
              <input
                type="range"
                min={0}
                max={20}
                step={0.05}
                value={l.speed}
                onChange={(e) => setLayerSpeed(i, Number(e.target.value))}
                className="min-w-0 flex-1 accent-accent"
                title={`Speed ${l.speed.toFixed(2)}× (1 = realtime)`}
              />
              <BoundedNumberInput
                value={l.speed}
                min={0}
                max={20}
                onChange={(v) => setLayerSpeed(i, v)}
                className="input w-11 shrink-0 px-1 py-0.5 text-right text-[10px]"
              />
            </Field>

            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase text-muted">Blend</span>
              <select
                className="input select-compact min-w-0 text-[10px]"
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

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
    </div>
  )
}
