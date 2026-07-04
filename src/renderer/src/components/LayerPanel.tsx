// One layer strip (brief §10.2). Source A/B pickers, blend + opacity, and the
// solo/mute/feedback toggles — reading and writing the store, which the
// Compositor samples each frame. The per-source FX slots and the finite
// per-layer FX rack land in Phase 3; the auto-generated ISF control panel
// (selecting a source renders its INPUTS) lands in Phase 4.

import type { BlendMode } from '@shared/types'
import { GENERATORS } from '../shaders/isf'
import { useStore } from '../store'
import { BoundedNumberInput } from './BoundedNumberInput'

const BLEND_MODES: BlendMode[] = [
  'normal',
  'add',
  'screen',
  'multiply',
  'difference',
  'overlay'
]

export function LayerPanel({ index }: { index: number }): JSX.Element {
  const layer = useStore((s) => s.composition.layers[index])
  const setBlend = useStore((s) => s.setBlend)
  const setOpacity = useStore((s) => s.setOpacity)
  const toggleMute = useStore((s) => s.toggleMute)
  const toggleSolo = useStore((s) => s.toggleSolo)
  const toggleFeedback = useStore((s) => s.toggleFeedback)
  const setFeedbackAmount = useStore((s) => s.setFeedbackAmount)
  const setSourceShader = useStore((s) => s.setSourceShader)
  const setSelection = useStore((s) => s.setSelection)
  const selection = useStore((s) => s.selection)

  const isSelected = (slot: 'A' | 'B'): boolean =>
    selection?.layer === index && selection.slot === slot

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-panel p-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted">LAYER {index + 1}</span>
        <div className="flex gap-1">
          <ToggleChip on={layer.solo} label="S" title="Solo" onClick={() => toggleSolo(index)} />
          <ToggleChip on={layer.mute} label="M" title="Mute" onClick={() => toggleMute(index)} />
          <ToggleChip
            on={layer.feedback}
            label="FB"
            title="Feedback — sample this layer's previous frame"
            onClick={() => toggleFeedback(index)}
          />
        </div>
      </div>

      {/* Source pickers — ISF generators (video / capture / HIVE arrive Phase 7) */}
      <div className="grid grid-cols-2 gap-1">
        <SourceSlot
          label="A"
          shaderId={layer.sourceA.shaderId}
          selected={isSelected('A')}
          onSelect={() => setSelection({ layer: index, slot: 'A' })}
          onPick={(id) => setSourceShader(index, 'A', id)}
        />
        <SourceSlot
          label="B"
          shaderId={layer.sourceB?.shaderId ?? null}
          selected={isSelected('B')}
          onSelect={() => setSelection({ layer: index, slot: 'B' })}
          onPick={(id) => setSourceShader(index, 'B', id)}
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="font-mono text-[10px] text-muted">BLEND</label>
        <select
          className="input flex-1 text-[12px]"
          value={layer.blend}
          onChange={(e) => setBlend(index, e.target.value as BlendMode)}
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="font-mono text-[10px] text-muted">OPACITY</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={layer.opacity}
          onChange={(e) => setOpacity(index, Number(e.target.value))}
          className="flex-1 accent-accent"
        />
        <div className="w-12">
          <BoundedNumberInput
            value={layer.opacity}
            min={0}
            max={1}
            onChange={(v) => setOpacity(index, v)}
          />
        </div>
      </div>

      {/* Trail persistence — only meaningful while FB is on */}
      {layer.feedback && (
        <div className="flex items-center gap-2">
          <label className="font-mono text-[10px] text-muted">TRAILS</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={layer.feedbackAmount}
            onChange={(e) => setFeedbackAmount(index, Number(e.target.value))}
            className="flex-1 accent-accent"
            title="Feedback persistence — decay trails (capped below infinite bloom)"
          />
          <div className="w-12">
            <BoundedNumberInput
              value={layer.feedbackAmount}
              min={0}
              max={1}
              onChange={(v) => setFeedbackAmount(index, v)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function ToggleChip({
  on,
  label,
  title,
  onClick
}: {
  on: boolean
  label: string
  title: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] leading-none transition-colors ${
        on
          ? 'bg-accent/20 text-accent ring-1 ring-accent'
          : 'bg-panel2 text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}

function SourceSlot({
  label,
  shaderId,
  selected,
  onSelect,
  onPick
}: {
  label: string
  shaderId: string | null
  selected: boolean
  onSelect: () => void
  onPick: (id: string | null) => void
}): JSX.Element {
  // NOTE: the B slot writes to the store today, but the engine renders only
  // source A until the A/B source mixer lands (Phase 3) — flagged in the title.
  const bPending = label === 'B'
  return (
    <div
      onClick={onSelect}
      className={`flex flex-col gap-0.5 rounded border px-1.5 py-1 transition-colors ${
        selected
          ? 'border-accent bg-panel2 ring-1 ring-accent'
          : 'border-border bg-panel2/50 hover:border-accent/50'
      }`}
      title={bPending ? 'Source B — mixed with A when the source mixer lands (Phase 3)' : undefined}
    >
      <span className="font-mono text-[9px] text-muted">
        SRC {label}
        {bPending && shaderId ? ' · pending' : ''}
      </span>
      <select
        className="input w-full text-[11px]"
        value={shaderId ?? ''}
        onChange={(e) => onPick(e.target.value || null)}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">— none —</option>
        {GENERATORS.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </div>
  )
}
