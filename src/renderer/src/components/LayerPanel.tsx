// One layer strip (brief §10.2), compact form: opacity rides the header row;
// SRC A and SRC B sit side by side (their FX racks live BELOW as chips, so
// the columns stay narrow); every rack uses the chips layout — no blank
// space. Right-click anywhere on the strip: Init, Randomize layer, layer
// presets (save/apply/delete — app-persistent).

import { useState, type MouseEvent } from 'react'
import type { BlendMode } from '@shared/types'
import { BLEND_MODES } from '@shared/types'
import { GENERATORS } from '../shaders/isf'
import { useStore } from '../store'
import { BoundedNumberInput } from './BoundedNumberInput'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { FxRackPanel } from './FxRackPanel'
import { ConfirmModal, PromptModal } from './PromptModal'

export function LayerPanel({ index }: { index: number }): JSX.Element {
  const layer = useStore((s) => s.composition.layers[index])
  const setBlend = useStore((s) => s.setBlend)
  const setOpacity = useStore((s) => s.setOpacity)
  const toggleMute = useStore((s) => s.toggleMute)
  const toggleSolo = useStore((s) => s.toggleSolo)
  const toggleFeedback = useStore((s) => s.toggleFeedback)
  const setFeedbackAmount = useStore((s) => s.setFeedbackAmount)
  const setSourceMix = useStore((s) => s.setSourceMix)
  const setSourceBlend = useStore((s) => s.setSourceBlend)
  const setSourceShader = useStore((s) => s.setSourceShader)
  const setSelection = useStore((s) => s.setSelection)
  const selection = useStore((s) => s.selection)
  const collapsed = useStore((s) => !!s.collapsed[`layer${index}`])
  const toggleSection = useStore((s) => s.toggleSection)
  const initLayer = useStore((s) => s.initLayer)
  const randomizeLayer = useStore((s) => s.randomizeLayer)
  const layerPresets = useStore((s) => s.layerPresets)
  const saveLayerPreset = useStore((s) => s.saveLayerPreset)
  const applyLayerPreset = useStore((s) => s.applyLayerPreset)
  const deleteLayerPreset = useStore((s) => s.deleteLayerPreset)

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [savePrompt, setSavePrompt] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const isSelected = (slot: 'A' | 'B'): boolean =>
    selection?.type === 'source' && selection.layer === index && selection.slot === slot

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const menuItems: MenuItem[] = [
    { label: 'Init layer', onClick: () => initLayer(index) },
    { label: 'Randomize layer', onClick: () => randomizeLayer(index) },
    { divider: true, label: '' },
    { label: 'Save layer as preset…', onClick: () => setSavePrompt(true) },
    ...layerPresets.map((p) => ({
      label: p.name,
      onClick: () => applyLayerPreset(index, p.id),
      onDelete: () => setDeleteTarget({ id: p.id, name: p.name }),
      deleteTitle: `Delete layer preset "${p.name}"`
    }))
  ]

  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-panel p-2"
      onContextMenu={onContextMenu}
    >
      {/* Header: chevron · LAYER n · opacity · S/M/FB */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => toggleSection(`layer${index}`)}
          className="flex shrink-0 items-center gap-1"
          title={collapsed ? 'Expand layer' : 'Collapse layer'}
        >
          <span
            className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
          >
            ▶
          </span>
          <span className="font-mono text-[11px] text-muted">L{index + 1}</span>
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={layer.opacity}
          onChange={(e) => setOpacity(index, Number(e.target.value))}
          className="min-w-0 flex-1 accent-accent"
          title={`Opacity ${layer.opacity.toFixed(2)}`}
        />
        <div className="flex shrink-0 gap-1">
          <ToggleChip label="S" active={layer.solo} onClick={() => toggleSolo(index)} title="Solo" />
          <ToggleChip label="M" active={layer.mute} onClick={() => toggleMute(index)} title="Mute" />
          <ToggleChip
            label="FB"
            active={layer.feedback}
            onClick={() => toggleFeedback(index)}
            title="Feedback — this layer samples its own previous frame (trails)"
          />
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Sources side by side — compact: label + picker only */}
          <div className="grid min-w-0 grid-cols-2 gap-1">
            <SourceCell
              label="A"
              shaderId={layer.sourceA.shaderId}
              selected={isSelected('A')}
              onSelect={() => setSelection({ type: 'source', layer: index, slot: 'A' })}
              onPick={(id) => setSourceShader(index, 'A', id)}
            />
            <SourceCell
              label="B"
              shaderId={layer.sourceB?.shaderId ?? null}
              selected={isSelected('B')}
              onSelect={() => setSelection({ type: 'source', layer: index, slot: 'B' })}
              onPick={(id) => setSourceShader(index, 'B', id)}
            />
          </div>

          {/* Per-source FX as chips rows (only when the source exists) */}
          {layer.sourceA.shaderId && (
            <FxRackPanel scope={{ kind: 'sourceA', layer: index }} fx={layer.sourceAFx} label="A fx" chips />
          )}
          {layer.sourceB?.shaderId && (
            <FxRackPanel scope={{ kind: 'sourceB', layer: index }} fx={layer.sourceBFx} label="B fx" chips />
          )}

          {/* A/B mix: blend-mode combinator + depth (brief §4) */}
          {layer.sourceB?.shaderId && (
            <div className="flex min-w-0 items-center gap-1.5">
              <label className="w-8 shrink-0 font-mono text-[9px] text-muted">MIX</label>
              <select
                className="input select-compact w-20 shrink-0 text-[10px]"
                value={layer.sourceBlend}
                onChange={(e) => setSourceBlend(index, e.target.value as BlendMode)}
                title="How B combines with A — mix is the depth of the combination"
              >
                {BLEND_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={layer.sourceMix}
                onChange={(e) => setSourceMix(index, Number(e.target.value))}
                className="min-w-0 flex-1 accent-accent"
                title="Mix depth — 0 = A only, 1 = full blend result"
              />
            </div>
          )}

          {/* Layer FX rack — chips */}
          <FxRackPanel scope={{ kind: 'layer', layer: index }} fx={layer.fx} label="fx" chips />

          {/* Blend against the stack below */}
          <div className="flex min-w-0 items-center gap-1.5">
            <label className="w-8 shrink-0 font-mono text-[9px] text-muted">BLEND</label>
            <select
              className="input select-compact min-w-0 flex-1 text-[11px]"
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

          {/* Trail persistence — only while FB is on */}
          {layer.feedback && (
            <div className="flex min-w-0 items-center gap-1.5">
              <label className="w-8 shrink-0 font-mono text-[9px] text-muted">TRAIL</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={layer.feedbackAmount}
                onChange={(e) => setFeedbackAmount(index, Number(e.target.value))}
                className="min-w-0 flex-1 accent-accent"
                title="Feedback persistence — decay trails (capped below infinite bloom)"
              />
              <div className="w-11 shrink-0">
                <BoundedNumberInput
                  value={layer.feedbackAmount}
                  min={0}
                  max={1}
                  onChange={(v) => setFeedbackAmount(index, v)}
                  className="input w-full px-1 py-0.5 text-right text-[11px]"
                />
              </div>
            </div>
          )}
        </>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          header={`Layer ${index + 1}`}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
      {savePrompt && (
        <PromptModal
          title="Layer preset name?"
          placeholder="e.g. Contour + trails"
          confirmLabel="Save"
          onConfirm={(name) => {
            saveLayerPreset(index, name)
            setSavePrompt(false)
          }}
          onCancel={() => setSavePrompt(false)}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title={`Are you sure you want to delete the layer preset "${deleteTarget.name}"?`}
          onYes={() => {
            deleteLayerPreset(deleteTarget.id)
            setDeleteTarget(null)
          }}
          onNo={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function ToggleChip({
  label,
  active,
  onClick,
  title
}: {
  label: string
  active: boolean
  onClick: () => void
  title: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
        active
          ? 'bg-accent/20 text-accent ring-1 ring-accent'
          : 'bg-panel2 text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}

function SourceCell({
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
  return (
    <div
      onClick={onSelect}
      className={`flex min-w-0 items-center gap-1 rounded border px-1 py-0.5 transition-colors ${
        selected
          ? 'border-accent bg-panel2 ring-1 ring-accent'
          : 'border-border bg-panel2/50 hover:border-accent/50'
      }`}
    >
      <span className="shrink-0 font-mono text-[9px] text-muted">{label}</span>
      <select
        className="input select-compact min-w-0 flex-1 text-[11px]"
        value={shaderId ?? ''}
        onChange={(e) => onPick(e.target.value || null)}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">—</option>
        {GENERATORS.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </div>
  )
}
