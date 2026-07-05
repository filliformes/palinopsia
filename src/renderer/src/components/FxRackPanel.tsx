// FX rack UI, decomposed so layouts can place the pieces freely:
//   FxAddSelect — the "+ fx" picker for a scope
//   FxChips     — the rack's units as wrapping chips
//   FxRackPanel — label + add + chips on one wrapping row (master & co.)
// Locked units (the master Vibe Palette) render pinned: no bypass dot, no
// remove, no reorder — just the name (click to edit) and a pin glyph.

import { useRef, type DragEvent } from 'react'
import type { FxInstance } from '@shared/types'
import { FX_GROUPS, SHADER_BY_ID } from '../shaders/isf'
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
      {FX_GROUPS.map((grp) => (
        <optgroup key={grp.group} label={grp.group}>
          {grp.shaders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export function FxChips({
  scope,
  fx,
  nowrap = false
}: {
  scope: FxScope
  fx: FxInstance[]
  nowrap?: boolean
}): JSX.Element | null {
  const selection = useStore((s) => s.selection)
  const reorderFx = useStore((s) => s.reorderFx)
  const dragId = useRef<string | null>(null)
  if (fx.length === 0) return null
  return (
    <div
      className={`flex min-w-0 items-center gap-1 ${nowrap ? 'flex-nowrap' : 'flex-wrap'}`}
      // Tail drop: releasing on the row (not on a chip) moves to the end.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e: DragEvent) => {
        e.preventDefault()
        if (dragId.current) reorderFx(scope, dragId.current, null)
        dragId.current = null
      }}
    >
      {fx.map((f, i) => (
        <FxUnit
          key={f.id}
          f={f}
          i={i}
          count={fx.length}
          scope={scope}
          selected={selection?.type === 'fx' && selection.instId === f.id}
          onDragStart={() => {
            dragId.current = f.id
          }}
          onDropOn={() => {
            if (dragId.current) reorderFx(scope, dragId.current, f.id)
            dragId.current = null
          }}
        />
      ))}
    </div>
  )
}

export function FxRackPanel({
  scope,
  fx,
  label,
  nowrap = false
}: {
  scope: FxScope
  fx: FxInstance[]
  label: string
  nowrap?: boolean
}): JSX.Element {
  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${nowrap ? 'flex-nowrap' : 'flex-wrap'}`}>
      {label && (
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted">
          {label}
        </span>
      )}
      <FxAddSelect scope={scope} />
      <FxChips scope={scope} fx={fx} nowrap={nowrap} />
    </div>
  )
}

function FxUnit({
  f,
  i,
  count,
  scope,
  selected,
  onDragStart,
  onDropOn
}: {
  f: FxInstance
  i: number
  count: number
  scope: FxScope
  selected: boolean
  onDragStart?: () => void
  onDropOn?: () => void
}): JSX.Element {
  const removeFx = useStore((s) => s.removeFx)
  const toggleFx = useStore((s) => s.toggleFx)
  const moveFx = useStore((s) => s.moveFx)
  const setSelection = useStore((s) => s.setSelection)

  if (f.locked) {
    // Pinned finalizers (Vibe → Context → Finalizer) — always last, unremovable,
    // bypassable. Each wears a different accent so they're easy to tell apart:
    // Vibe = accent2, Context = accent, Finalizer = active.
    const lockedName = SHADER_BY_ID[f.shaderId ?? '']?.name ?? f.shaderId
    // Literal class strings (Tailwind JIT needs them spelled out).
    const S =
      f.shaderId === 'fx-context'
        ? { on: 'border-accent', off: 'border-accent/40', bg: 'bg-accent', tx: 'text-accent', hv: 'hover:text-accent' }
        : f.shaderId === 'fx-finalizer'
          ? { on: 'border-active', off: 'border-active/40', bg: 'bg-active', tx: 'text-active', hv: 'hover:text-active' }
          : { on: 'border-accent2', off: 'border-accent2/40', bg: 'bg-accent2', tx: 'text-accent2', hv: 'hover:text-accent2' }
    const borderCls = selected ? S.on : S.off
    const dotCls = f.enabled ? S.bg : 'bg-panel3'
    const glyphCls = S.tx
    const nameCls = `${f.enabled ? '' : 'text-muted line-through'} ${selected ? S.tx : S.hv}`
    return (
      <span
        className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 ${borderCls} bg-panel`}
        title={`${lockedName} — a pinned finalizer stage. Dot bypasses; click the name to edit.`}
      >
        <button
          onClick={() => toggleFx(scope, f.id)}
          className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${dotCls}`}
          title={f.enabled ? `${lockedName} on — click to bypass` : `${lockedName} bypassed — click to enable`}
        />
        <span className={`font-mono text-[9px] ${glyphCls}`}>◆</span>
        <button
          onClick={() => setSelection({ type: 'fx', scope, instId: f.id })}
          className={`text-[11px] transition-colors ${nameCls}`}
        >
          {lockedName}
        </button>
      </span>
    )
  }

  return (
    <span
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation() // don't fall through to the row's tail drop
        onDropOn?.()
      }}
      className={`flex min-w-0 shrink-0 cursor-grab items-center gap-1 rounded border bg-panel px-1.5 py-0.5 ${
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
