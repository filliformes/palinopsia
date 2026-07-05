// FX rack UI, decomposed so layouts can place the pieces freely:
//   FxAddSelect — the "+ fx" picker for a scope
//   FxChips     — the rack's units as wrapping chips
//   FxRackPanel — label + add + chips on one wrapping row (master & co.)
// Locked units (the master Vibe Palette) render pinned: no bypass dot, no
// remove, no reorder — just the name (click to edit) and a pin glyph.

import type { FxInstance } from '@shared/types'
import { FX_SHADERS, SHADER_BY_ID } from '../shaders/isf'
import { useStore, type FxScope } from '../store'

export function FxAddSelect({ scope, className = '' }: { scope: FxScope; className?: string }): JSX.Element {
  const addFx = useStore((s) => s.addFx)
  return (
    <select
      className={`input select-compact text-[10px] ${className || 'w-20 shrink-0'}`}
      value=""
      onChange={(e) => {
        if (e.target.value) addFx(scope, e.target.value)
      }}
      title="Add an FX to this rack"
    >
      <option value="">+ fx</option>
      {FX_SHADERS.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  )
}

export function FxChips({ scope, fx }: { scope: FxScope; fx: FxInstance[] }): JSX.Element | null {
  const selection = useStore((s) => s.selection)
  if (fx.length === 0) return null
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {fx.map((f, i) => (
        <FxUnit
          key={f.id}
          f={f}
          i={i}
          count={fx.length}
          scope={scope}
          selected={selection?.type === 'fx' && selection.instId === f.id}
        />
      ))}
    </div>
  )
}

export function FxRackPanel({
  scope,
  fx,
  label
}: {
  scope: FxScope
  fx: FxInstance[]
  label: string
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {label && (
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted">
          {label}
        </span>
      )}
      <FxAddSelect scope={scope} />
      <FxChips scope={scope} fx={fx} />
    </div>
  )
}

function FxUnit({
  f,
  i,
  count,
  scope,
  selected
}: {
  f: FxInstance
  i: number
  count: number
  scope: FxScope
  selected: boolean
}): JSX.Element {
  const removeFx = useStore((s) => s.removeFx)
  const toggleFx = useStore((s) => s.toggleFx)
  const moveFx = useStore((s) => s.moveFx)
  const setSelection = useStore((s) => s.setSelection)

  if (f.locked) {
    // The pinned Vibe Palette — always on, always last, always editable.
    return (
      <span
        className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 ${
          selected ? 'border-accent2' : 'border-accent2/40'
        } bg-panel`}
        title="Vibe Palette — the always-on unified-look stage. Click to edit its colors."
      >
        <span className="font-mono text-[9px] text-accent2">◆</span>
        <button
          onClick={() => setSelection({ type: 'fx', scope, instId: f.id })}
          className={`text-[11px] transition-colors ${selected ? 'text-accent2' : 'hover:text-accent2'}`}
        >
          Vibe Palette
        </button>
      </span>
    )
  }

  return (
    <span
      className={`flex min-w-0 shrink-0 items-center gap-1 rounded border bg-panel px-1.5 py-0.5 ${
        selected ? 'border-accent/70' : 'border-border'
      }`}
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
          f.enabled ? '' : 'text-muted line-through'
        } ${selected ? 'text-accent' : 'hover:text-accent'}`}
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
        ←
      </button>
      <button
        className="shrink-0 px-0.5 font-mono text-[10px] text-muted hover:text-text disabled:opacity-30"
        onClick={() => moveFx(scope, f.id, 1)}
        disabled={i === count - 1}
        title="Move later in the chain"
      >
        →
      </button>
      <button
        className="shrink-0 px-0.5 font-mono text-[10px] text-muted hover:text-danger"
        onClick={() => removeFx(scope, f.id)}
        title="Remove from rack"
      >
        ×
      </button>
    </span>
  )
}
