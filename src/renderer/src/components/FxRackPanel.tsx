// One FX rack (per-source, per-layer, or master) — finite, reorderable ISF
// chains (brief §5, §10). Each unit: enable toggle, move up/down, remove.
// Clicking a unit's name selects it — the Inspector renders its ISF INPUTS
// as themed controls (the Phase-4 auto-UI).

import type { FxInstance } from '@shared/types'
import { FX_SHADERS, SHADER_BY_ID } from '../shaders/isf'
import { useStore, type FxScope } from '../store'

export function FxRackPanel({
  scope,
  fx,
  label,
  compact = false
}: {
  scope: FxScope
  fx: FxInstance[]
  label: string
  compact?: boolean
}): JSX.Element {
  const addFx = useStore((s) => s.addFx)
  const removeFx = useStore((s) => s.removeFx)
  const toggleFx = useStore((s) => s.toggleFx)
  const moveFx = useStore((s) => s.moveFx)
  const selection = useStore((s) => s.selection)
  const setSelection = useStore((s) => s.setSelection)

  const isSelected = (instId: string): boolean =>
    selection?.type === 'fx' &&
    selection.instId === instId

  return (
    <div className={`flex flex-col gap-1 ${compact ? '' : 'rounded border border-border bg-panel2/40 p-1.5'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted">{label}</span>
        <select
          className="input max-w-[110px] text-[10px]"
          value=""
          onChange={(e) => {
            if (e.target.value) addFx(scope, e.target.value)
          }}
          title="Add an FX to this rack"
        >
          <option value="">+ add fx</option>
          {FX_SHADERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      {fx.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {fx.map((f, i) => (
            <li
              key={f.id}
              className="flex items-center gap-1 rounded border border-border bg-panel px-1.5 py-0.5"
            >
              <button
                onClick={() => toggleFx(scope, f.id)}
                className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${
                  f.enabled ? 'bg-accent' : 'bg-panel3'
                }`}
                title={f.enabled ? 'Enabled — click to bypass' : 'Bypassed — click to enable'}
              />
              <button
                onClick={() => setSelection({ type: 'fx', scope, instId: f.id })}
                className={`flex-1 truncate text-left text-[11px] transition-colors ${
                  f.enabled ? '' : 'text-muted line-through'
                } ${isSelected(f.id) ? 'text-accent' : 'hover:text-accent'}`}
                title="Edit this FX's controls in the Inspector"
              >
                {SHADER_BY_ID[f.shaderId ?? '']?.name ?? f.shaderId}
              </button>
              <button
                className="px-0.5 font-mono text-[10px] text-muted hover:text-text disabled:opacity-30"
                onClick={() => moveFx(scope, f.id, -1)}
                disabled={i === 0}
                title="Move earlier in the chain"
              >
                ↑
              </button>
              <button
                className="px-0.5 font-mono text-[10px] text-muted hover:text-text disabled:opacity-30"
                onClick={() => moveFx(scope, f.id, 1)}
                disabled={i === fx.length - 1}
                title="Move later in the chain"
              >
                ↓
              </button>
              <button
                className="px-0.5 font-mono text-[10px] text-muted hover:text-danger"
                onClick={() => removeFx(scope, f.id)}
                title="Remove from rack"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
