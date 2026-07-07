// BackgroundPanel — the Background slab's strip, pinned at the BOTTOM of the
// Layers column (matching the stack: it renders under everything). Compact by
// design: one source (curated ground set), a full FX rack, opacity + its own
// slow clock (default 0.25×), its own dice, and the preset bank (25 built-ins +
// user saves via right-click). The global Randomize never touches it — the
// ground stays put while the layers churn.

import { useState, type MouseEvent, type ReactNode } from 'react'
import { useStore } from '../store'
import { BG_PRESETS, BG_SOURCES, bgPresetToState } from '../bgPresets'
import { BoundedNumberInput } from './BoundedNumberInput'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { FxAddSelect, FxChips } from './FxRackPanel'
import { ConfirmModal, PromptModal } from './PromptModal'
import { useFlash } from './useFlash'

const BG_SOURCES_ALPHA = [...BG_SOURCES].sort((a, b) => a.name.localeCompare(b.name))

export function BackgroundPanel(): JSX.Element {
  const bg = useStore((s) => s.composition.background)
  const selection = useStore((s) => s.selection)
  const setSelection = useStore((s) => s.setSelection)
  const setBackgroundSource = useStore((s) => s.setBackgroundSource)
  const setBackgroundOpacity = useStore((s) => s.setBackgroundOpacity)
  const setBackgroundSpeed = useStore((s) => s.setBackgroundSpeed)
  const setBackgroundDepth = useStore((s) => s.setBackgroundDepth)
  const randomizeBg = useStore((s) => s.randomizeBg)
  const applyBgPreset = useStore((s) => s.applyBgPreset)
  const bgPresets = useStore((s) => s.bgPresets)
  const saveBgPreset = useStore((s) => s.saveBgPreset)
  const deleteBgPreset = useStore((s) => s.deleteBgPreset)

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [savePrompt, setSavePrompt] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [flashing, flash] = useFlash()

  const selected = selection?.type === 'background'
  const opacity = bg?.opacity ?? 1
  const speed = bg?.speed ?? 0.25
  const depth = bg?.depth ?? 0
  const shaderId = bg?.source.shaderId ?? null

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const menuItems: MenuItem[] = [
    { label: 'Init background', onClick: () => setBackgroundSource(null) },
    { label: 'Randomize background', onClick: () => { randomizeBg(); flash() } },
    { divider: true, label: '' },
    { label: 'Save background as preset…', onClick: () => setSavePrompt(true) },
    ...bgPresets.map((p) => ({
      label: p.name,
      onClick: () => applyBgPreset(p.bg),
      onDelete: () => setDeleteTarget({ id: p.id, name: p.name }),
      deleteTitle: `Delete background preset "${p.name}"`
    }))
  ]

  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 rounded-md border bg-panel p-2 transition-colors ${
        flashing ? 'animate-pulse border-danger ring-1 ring-danger' : 'border-border'
      }`}
      onContextMenu={onContextMenu}
      onClick={() => shaderId && setSelection({ type: 'background' })}
    >
      {/* Header: BG · source picker · +fx · dice · presets. flex-wrap so a narrow
          Inspector column drops the presets/dice to a second line instead of
          overflowing the section; the source select keeps a min width. */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span
          className={`w-[34px] shrink-0 font-mono text-[11px] font-bold ${
            selected ? 'text-accent' : shaderId ? 'text-text' : 'text-muted'
          }`}
          title="Background — the ground under the four layers (its own slow clock; the global Randomize never touches it)"
        >
          BG
        </span>
        <select
          className={`input select-compact min-w-[5rem] flex-1 text-[11px] ${selected ? 'border-accent' : ''}`}
          value={shaderId ?? ''}
          onChange={(e) => setBackgroundSource(e.target.value || null)}
          onClick={(e) => e.stopPropagation()}
          title="Background source — curated ground set"
        >
          <option value="">— none —</option>
          {BG_SOURCES_ALPHA.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <span onClick={(e) => e.stopPropagation()}>
          {/* snug fixed width — fits "+ fx" + arrow without clipping, but not as
              wide as the widest option ("Difference Bloom"). Popup still expands. */}
          <FxAddSelect scope={{ kind: 'background' }} className="w-16 shrink-0" />
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            randomizeBg()
            flash()
          }}
          title="Randomize the background only (source + params + FX; keeps opacity/speed)"
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] leading-none transition-colors ${
            flashing ? 'animate-pulse text-danger' : 'text-muted hover:bg-accent/15 hover:text-accent'
          }`}
        >
          ⚄
        </button>
        <select
          className="input select-compact w-[4.75rem] shrink-0 text-[10px]"
          value=""
          onChange={(e) => {
            const v = e.target.value
            if (!v) return
            if (v.startsWith('u:')) {
              const p = bgPresets.find((x) => x.id === v.slice(2))
              if (p) applyBgPreset(p.bg)
            } else {
              const p = BG_PRESETS.find((x) => x.id === v)
              if (p) applyBgPreset(bgPresetToState(p))
            }
          }}
          onClick={(e) => e.stopPropagation()}
          title="Background presets — 25 built-ins + yours (right-click the strip to save/delete)"
        >
          <option value="">presets</option>
          <optgroup label="Built-in">
            {BG_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
          {bgPresets.length > 0 && (
            <optgroup label="Yours">
              {bgPresets.map((p) => (
                <option key={p.id} value={`u:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* FX chips under the header, inside the gutter (like a layer strip). */}
      {bg && bg.fx.length > 0 && (
        <div className="min-w-0 pl-[40px]" onClick={(e) => e.stopPropagation()}>
          <FxChips scope={{ kind: 'background' }} fx={bg.fx} />
        </div>
      )}

      {/* OPAC + SPEED on one row. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <Label>OPAC</Label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={opacity}
          onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 accent-accent"
          title={`Background opacity ${opacity.toFixed(2)} — 0 = off`}
        />
        <div className="w-11 shrink-0" onClick={(e) => e.stopPropagation()}>
          <BoundedNumberInput
            value={opacity}
            min={0}
            max={1}
            onChange={setBackgroundOpacity}
            className="input w-full px-1 py-0.5 text-right text-[11px]"
          />
        </div>
        <Label>SPEED</Label>
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={speed}
          onChange={(e) => setBackgroundSpeed(Number(e.target.value))}
          onDoubleClick={() => setBackgroundSpeed(0.25)}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 accent-accent"
          title={`Background clock ${speed.toFixed(2)}× — grounds move slowly (double-click: 0.25×)`}
        />
        <div className="w-11 shrink-0" onClick={(e) => e.stopPropagation()}>
          <BoundedNumberInput
            value={speed}
            min={0}
            max={4}
            onChange={setBackgroundSpeed}
            className="input w-full px-1 py-0.5 text-right text-[11px]"
          />
        </div>
      </div>

      {/* DEPTH — the foreground casts a soft contact shadow onto the background
          (separation). Only meaningful with a background + content above it. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <Label>DEPTH</Label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={depth}
          onChange={(e) => setBackgroundDepth(Number(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 accent-accent2"
          title={`Depth ${depth.toFixed(2)} — foreground casts a soft shadow onto the background (0 = flat)`}
        />
        <div className="w-11 shrink-0" onClick={(e) => e.stopPropagation()}>
          <BoundedNumberInput
            value={depth}
            min={0}
            max={1}
            onChange={setBackgroundDepth}
            className="input w-full px-1 py-0.5 text-right text-[11px]"
          />
        </div>
        <div className="min-w-0 flex-1" />
        <span className="w-11 shrink-0" />
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} header="Background" items={menuItems} onClose={() => setMenu(null)} />
      )}
      {savePrompt && (
        <PromptModal
          title="Background preset name?"
          placeholder="e.g. Deep sea + grain"
          confirmLabel="Save"
          onConfirm={(name) => {
            saveBgPreset(name)
            setSavePrompt(false)
          }}
          onCancel={() => setSavePrompt(false)}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title={`Are you sure you want to delete the background preset "${deleteTarget.name}"?`}
          onYes={() => {
            deleteBgPreset(deleteTarget.id)
            setDeleteTarget(null)
          }}
          onNo={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function Label({ children }: { children: ReactNode }): JSX.Element {
  return (
    <label className="w-[34px] shrink-0 font-mono text-[9px] uppercase text-muted">{children}</label>
  )
}
