// FX rack UI, decomposed so layouts can place the pieces freely:
//   FxAddSelect : the "+ fx" picker for a scope
//   FxChips     : the rack's units as wrapping chips
//   FxRackPanel : label + add + chips on one wrapping row (master & co.)
// Locked units (the master Vibe Palette) render pinned: no bypass dot, no
// remove, no reorder : just the name (click to edit) and a pin glyph.

import { Fragment, useState, type DragEvent, type MouseEvent } from 'react'
import type { FxInstance } from '@shared/types'
import { FX_GROUPS, SHADER_BY_ID } from '../shaders/isf'
import { blurbFor } from '../shaders/isf/shaderBlurbs'
import { keywordsFor } from '../shaders/isf/keywords'
import { sameFxScope, useStore, type FxScope } from '../store'
import { canHostFx, refusalPopup } from '../fxScopes'
import { showToast } from './Toast'
import { ContextMenu } from './ContextMenu'
import { useFxMenuItems } from './fxMenu'
import { SearchSelect, type SearchOption } from './SearchSelect'

// The unit being dragged, shared by every rack so a chip can be dropped into
// ANOTHER rack (a layer ↔ the Master FX) as well as reordered in its own.
let fxDrag: { scope: FxScope; instId: string; shaderId: string | null } | null = null

/** Drop the dragged unit into `scope` before `beforeId` (null = the end) : a
 *  reorder in its own rack, a MOVE into another (Ctrl or Alt = a copy), or a
 *  popup when that rack can't host it. */
function dropFx(scope: FxScope, beforeId: string | null, e: DragEvent): void {
  const d = fxDrag
  fxDrag = null
  if (!d) return
  const st = useStore.getState()
  if (sameFxScope(d.scope, scope)) {
    st.reorderFx(scope, d.instId, beforeId)
    return
  }
  if (!canHostFx(scope, d.shaderId)) {
    showToast(refusalPopup(scope, d.shaderId), 'warn')
    return
  }
  if (e.ctrlKey || e.altKey) st.copyFxTo(d.scope, d.instId, scope, beforeId)
  else st.moveFxTo(d.scope, d.instId, scope, beforeId)
}

export function FxAddSelect({ scope, className = '' }: { scope: FxScope; className?: string }): JSX.Element {
  const addFx = useStore((s) => s.addFx)
  // Right-click the picker : paste into this rack (an EMPTY rack has no chip to
  // right-click). Drop a dragged unit on it : it lands at the end.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuItems = useFxMenuItems(scope, null, null, () => setMenu(null))
  const [over, setOver] = useState(false)
  // Which nodes a rack can host is `canHostFx` : one rule, shared with paste.
  const groups =
    scope.kind === 'layer'
      ? FX_GROUPS
      : FX_GROUPS.map((g) => ({
          ...g,
          shaders: g.shaders.filter((f) => canHostFx(scope, f.id))
        })).filter((g) => g.shaders.length > 0)
  const options: SearchOption[] = groups.flatMap((grp) =>
    grp.shaders.map((f) => ({ value: f.id, label: f.name, group: grp.group, keywords: keywordsFor(f.id), title: blurbFor(f.id) }))
  )
  return (
    <span
      className={`flex min-w-0 rounded ${className || 'w-20 shrink-0'} ${over ? 'ring-1 ring-accent' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      onDragOver={(e) => {
        if (!fxDrag) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        dropFx(scope, null, e)
      }}
    >
      <SearchSelect
        className="w-full min-w-0 text-[10px]"
        value=""
        options={options}
        placeholder="+ fx"
        resetAfterPick
        onChange={(v) => {
          if (v) addFx(scope, v)
        }}
        title="Add an FX to this rack (type to search by name or family). Right-click : paste. Drop an effect here : it joins this rack."
      />
      {menu && <ContextMenu x={menu.x} y={menu.y} header="This rack" items={menuItems} onClose={() => setMenu(null)} />}
    </span>
  )
}

export function FxChips({
  scope,
  fx,
  nowrap = false,
  leading
}: {
  scope: FxScope
  fx: FxInstance[]
  nowrap?: boolean
  // Rendered as the FIRST item inside the same wrap flow (the "+ fx" picker), so
  // it stays put at the front and the chips flow after it and wrap underneath,
  // rather than the picker being stranded alone on its own line.
  leading?: JSX.Element
}): JSX.Element | null {
  const selection = useStore((s) => s.selection)
  // While dragging, which chip we'd drop BEFORE (an id), or the tail ('__tail__').
  // Drives the insertion bar so you see where the unit will land : red when this
  // rack can't host it (the drop then explains why).
  const [overId, setOverId] = useState<string | null>(null)
  const refused = !!fxDrag && !sameFxScope(fxDrag.scope, scope) && !canHostFx(scope, fxDrag.shaderId)
  const bar = <span className={`h-4 w-0.5 shrink-0 self-center rounded ${refused ? 'bg-danger' : 'bg-accent'}`} />
  if (fx.length === 0 && !leading) return null
  return (
    <div
      className={`flex min-w-0 items-center gap-1 ${nowrap ? 'flex-nowrap' : 'grow flex-wrap'}`}
      // Tail drop: releasing on the row (not on a chip) moves to the end.
      onDragOver={(e) => {
        if (!fxDrag) return
        e.preventDefault()
        setOverId('__tail__')
      }}
      onDragLeave={() => setOverId(null)}
      // A drag dropped OUTSIDE any chip/row still fires dragend on the source
      // (which bubbles here) : clear the pending unit so it can't leak into the
      // next unrelated drop and silently move a stale unit.
      onDragEnd={() => {
        fxDrag = null
        setOverId(null)
      }}
      onDrop={(e: DragEvent) => {
        e.preventDefault()
        setOverId(null)
        dropFx(scope, null, e)
      }}
    >
      {leading}
      {fx.map((f, i) => (
        <Fragment key={f.id}>
          {overId === f.id && fxDrag && fxDrag.instId !== f.id && bar}
          <FxUnit
            f={f}
            i={i}
            count={fx.length}
            scope={scope}
            selected={selection?.type === 'fx' && selection.instId === f.id}
            onDragStart={(e) => {
              fxDrag = { scope, instId: f.id, shaderId: f.shaderId ?? null }
              e.dataTransfer.effectAllowed = 'copyMove'
              e.dataTransfer.setData('text/plain', f.shaderId ?? '')
            }}
            onOver={() => setOverId(f.id)}
            onDropOn={(e) => {
              setOverId(null)
              // Dropped on a pinned finalizer : that means "at the end".
              dropFx(scope, f.locked ? null : f.id, e)
            }}
          />
        </Fragment>
      ))}
      {overId === '__tail__' && fxDrag && bar}
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
      {/* "+ fx" rides in the SAME wrap flow as the chips (as the first item), so it
          stays at the front and the chips flow after it and wrap underneath. */}
      <FxChips scope={scope} fx={fx} nowrap={nowrap} leading={<FxAddSelect scope={scope} />} />
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
  onDropOn,
  onOver
}: {
  f: FxInstance
  i: number
  count: number
  scope: FxScope
  selected: boolean
  onDragStart?: (e: DragEvent) => void
  onDropOn?: (e: DragEvent) => void
  onOver?: () => void
}): JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuItems = useFxMenuItems(scope, f.id, f.shaderId, () => setMenu(null), !!f.locked)
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }
  const fxMenu = menu ? (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      header={SHADER_BY_ID[f.shaderId ?? '']?.name ?? f.shaderId}
      items={menuItems}
      onClose={() => setMenu(null)}
    />
  ) : null
  const removeFx = useStore((s) => s.removeFx)
  const toggleFx = useStore((s) => s.toggleFx)
  const moveFx = useStore((s) => s.moveFx)
  const setSelection = useStore((s) => s.setSelection)
  const showFinishingSub = useStore((s) => s.showFinishingSub)

  if (f.locked) {
    // Pinned finalizers (Vibe → Context → Finalizer) : always last, unremovable,
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
        title={`${lockedName} : a pinned finalizer stage. Dot bypasses; click the name to edit.`}
        onContextMenu={onContextMenu}
      >
        {fxMenu}
        <button
          onClick={() => toggleFx(scope, f.id)}
          className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${dotCls}`}
          title={f.enabled ? `${lockedName} on : click to bypass` : `${lockedName} bypassed : click to enable`}
        />
        <span className={`font-mono text-[9px] ${glyphCls}`}>◆</span>
        <button
          onClick={() => showFinishingSub(f.shaderId ?? '')}
          className={`text-[11px] transition-colors ${nameCls}`}
        >
          {lockedName}
        </button>
      </span>
    )
  }

  return (
    <span
      draggable={!menu}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation() // so the row's tail-drop indicator doesn't override this chip
        onOver?.()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation() // don't fall through to the row's tail drop
        onDropOn?.(e)
      }}
      title="Drag to reorder, or into another rack (a layer ↔ the Master FX) to move it there; hold Ctrl or Alt while dropping to copy instead. Right-click for copy and paste." 
      className={`flex min-w-0 shrink-0 cursor-grab items-center gap-1 rounded border bg-panel px-1.5 py-0.5 ${
        selected ? 'border-accent/70' : 'border-border'
      }`}
    >
      <button
        onClick={() => toggleFx(scope, f.id)}
        className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${
          f.enabled ? 'bg-accent' : 'bg-panel3'
        }`}
        title={f.enabled ? 'Enabled : click to bypass' : 'Bypassed : click to enable'}
      />
      <button
        onClick={() => setSelection({ type: 'fx', scope, instId: f.id })}
        className={`min-w-0 truncate text-left text-[11px] transition-colors ${
          f.enabled ? '' : 'text-muted line-through'
        } ${selected ? 'text-accent' : 'hover:text-accent'}`}
        title={blurbFor(f.shaderId) ?? "Edit this FX's controls in the Inspector"}
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
      {fxMenu}
    </span>
  )
}
