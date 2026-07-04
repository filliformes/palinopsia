// One FX rack (per-source, per-layer, or master) — finite, reorderable ISF
// chains (brief §5, §10). Each unit: enable toggle, move up/down, remove.
// Clicking a unit's name selects it — the Inspector renders its ISF INPUTS
// as themed controls (the Phase-4 auto-UI).
//
// Two layouts: 'list' (vertical rows — layer strips) and 'chips' (inline
// wrapping pills — the master rack, where vertical rows wasted a whole
// region on blank space).

import type { FxInstance } from '@shared/types'
import { FX_SHADERS, SHADER_BY_ID } from '../shaders/isf'
import { useStore, type FxScope } from '../store'

export function FxRackPanel({
  scope,
  fx,
  label,
  compact = false,
  chips = false
}: {
  scope: FxScope
  fx: FxInstance[]
  label: string
  compact?: boolean
  chips?: boolean
}): JSX.Element {
  const addFx = useStore((s) => s.addFx)
  const selection = useStore((s) => s.selection)

  const isSelected = (instId: string): boolean =>
    selection?.type === 'fx' && selection.instId === instId

  const addSelect = (
    <select
      className={`input select-compact min-w-0 text-[10px] ${chips ? 'w-24 shrink-0' : 'flex-1'}`}
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
  )

  if (chips) {
    // Single wrapping row: label · add · pills. No blank body.
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {label && (
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted">
            {label}
          </span>
        )}
        {addSelect}
        {fx.map((f, i) => (
          <FxUnit
            key={f.id}
            f={f}
            i={i}
            count={fx.length}
            scope={scope}
            selected={isSelected(f.id)}
            pill
          />
        ))}
      </div>
    )
  }

  return (
    <div
      className={`flex min-w-0 flex-col gap-1 ${compact ? '' : 'rounded border border-border bg-panel2/40 p-1.5'}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="w-10 shrink-0 truncate font-mono text-[9px] uppercase tracking-wide text-muted">
          {label}
        </span>
        {addSelect}
      </div>
      {fx.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {fx.map((f, i) => (
            <FxUnit
              key={f.id}
              f={f}
              i={i}
              count={fx.length}
              scope={scope}
              selected={isSelected(f.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function FxUnit({
  f,
  i,
  count,
  scope,
  selected,
  pill = false
}: {
  f: FxInstance
  i: number
  count: number
  scope: FxScope
  selected: boolean
  pill?: boolean
}): JSX.Element {
  const removeFx = useStore((s) => s.removeFx)
  const toggleFx = useStore((s) => s.toggleFx)
  const moveFx = useStore((s) => s.moveFx)
  const setSelection = useStore((s) => s.setSelection)

  const Tag = pill ? 'span' : 'li'
  return (
    <Tag
      className={`flex min-w-0 items-center gap-1 rounded border bg-panel px-1.5 py-0.5 ${
        selected ? 'border-accent/70' : 'border-border'
      } ${pill ? 'shrink-0' : ''}`}
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
        className={`min-w-0 truncate text-left text-[11px] transition-colors ${
          pill ? '' : 'flex-1'
        } ${f.enabled ? '' : 'text-muted line-through'} ${
          selected ? 'text-accent' : 'hover:text-accent'
        }`}
        title="Edit this FX's controls in the Inspector"
      >
        {SHADER_BY_ID[f.shaderId ?? '']?.name ?? f.shaderId}
      </button>
      <button
        className="shrink-0 px-0.5 font-mono text-[10px] text-muted hover:text-text disabled:opacity-30"
        onClick={() => moveFx(scope, f.id, -1)}
        disabled={i === 0}
        title="Move earlier in the chain"
      >
        {pill ? '←' : '↑'}
      </button>
      <button
        className="shrink-0 px-0.5 font-mono text-[10px] text-muted hover:text-text disabled:opacity-30"
        onClick={() => moveFx(scope, f.id, 1)}
        disabled={i === count - 1}
        title="Move later in the chain"
      >
        {pill ? '→' : '↓'}
      </button>
      <button
        className="shrink-0 px-0.5 font-mono text-[10px] text-muted hover:text-danger"
        onClick={() => removeFx(scope, f.id)}
        title="Remove from rack"
      >
        ×
      </button>
    </Tag>
  )
}
