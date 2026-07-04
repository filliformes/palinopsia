// One FX rack (per-source, per-layer, or master) — finite, reorderable ISF
// chains (brief §5, §10). Each unit: enable toggle, move up/down, remove.
// Parameter editing arrives with the auto-UI (Phase 4) — units run on their
// declared ISF defaults until then.

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
              <span
                className={`flex-1 truncate text-[11px] ${f.enabled ? '' : 'text-muted line-through'}`}
              >
                {SHADER_BY_ID[f.shaderId ?? '']?.name ?? f.shaderId}
              </span>
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
