// PresetPicker : the Inspector's preset control. Custom dropdown (not a
// native select) so it can: keep the applied preset's name on the button,
// list factory + user presets (user ones deletable with a confirm), and
// offer "+ add preset…" which prompts for a name and saves the shader's
// CURRENT full input state app-wide (localStorage), not just in the session.

import { useEffect, useRef, useState } from 'react'
import { inputsForShader } from '../shaders/isf/inputs'
import { PRESETS_BY_ID, type ShaderPreset } from '../shaders/isf/presets'
import { useStore } from '../store'
import { ConfirmModal, PromptModal } from './PromptModal'

export function PresetPicker({
  shaderId,
  values,
  onChange,
  appliedName,
  onApplied,
  widthCh
}: {
  shaderId: string
  values: Record<string, number | number[]>
  onChange: (name: string, value: number | number[]) => void
  // Controlled applied-name (the Vibe shares it with P/Shift+P). When
  // provided, the picker displays it instead of its own local state.
  appliedName?: string | null
  onApplied?: (name: string | null) => void
  // Fixed button/menu width in `ch` (else the default w-36). Used by Finishing
  // Touches so the three finalizers share one exact width. Never exceeds its
  // container (max-w-full) so it stays inside a resized panel.
  widthCh?: number
}): JSX.Element | null {
  const userPresets = useStore((s) => s.userShaderPresets[shaderId] ?? [])
  const addUserShaderPreset = useStore((s) => s.addUserShaderPreset)
  const deleteUserShaderPreset = useStore((s) => s.deleteUserShaderPreset)

  const all = PRESETS_BY_ID[shaderId] ?? []
  const [open, setOpen] = useState(false)
  // A shader can carry 56 presets (the Vibe does), which is a long scroll for a
  // name you already know. Same filter as the other pickers.
  const [q, setQ] = useState('')
  const [localApplied, setLocalApplied] = useState<string | null>(null)
  const controlled = appliedName !== undefined
  const applied = controlled ? appliedName : localApplied
  const [addPrompt, setAddPrompt] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)
  // Keyboard cursor into the filtered list (factory then user), like SearchSelect.
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const down = (e: globalThis.MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', down)
    return () => window.removeEventListener('mousedown', down)
  }, [open])

  // Keep the highlighted row in view as the cursor moves.
  useEffect(() => {
    listRef.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open])

  const match = (n: string): boolean => {
    const s2 = q.trim().toLowerCase()
    if (!s2) return true
    const l = n.toLowerCase()
    if (l.includes(s2)) return true
    let i = 0
    for (const ch of l) if (ch === s2[i]) i++
    return i === s2.length
  }
  const factory = all.filter((p) => match(p.name))
  const users = userPresets.filter((p) => match(p.name))

  if (all.length === 0 && userPresets.length === 0 && !shaderId) return null

  function apply(p: ShaderPreset): void {
    for (const [k, v] of Object.entries(p.values)) onChange(k, v)
    setLocalApplied(p.name)
    onApplied?.(p.name)
    setOpen(false)
  }

  /** Full current state of every declared input (stored value or default). */
  function snapshotValues(): Record<string, number | number[]> {
    const out: Record<string, number | number[]> = {}
    for (const d of inputsForShader(shaderId)) {
      const cur = values[d.name]
      if (cur !== undefined) out[d.name] = cur
      else if (d.def !== undefined) out[d.name] = d.def
    }
    return out
  }

  return (
    <div ref={ref} className="relative min-w-0 max-w-full">
      <button
        onClick={() => {
          const opening = !open
          setQ('')
          setOpen(opening)
          if (opening) {
            // Open with the cursor on the currently-applied preset.
            const idx = [...all, ...userPresets].findIndex((p) => p.name === applied)
            setCursor(idx >= 0 ? idx : 0)
          }
        }}
        className={`input select-compact max-w-full truncate text-left text-[10px] ${widthCh ? '' : 'w-36'}`}
        style={widthCh ? { width: `${widthCh}ch` } : undefined}
        title="Presets"
      >
        {applied ?? 'presets…'}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1 flex max-h-64 max-w-[14rem] flex-col overflow-hidden rounded border border-border bg-panel2 py-1 shadow-lg"
          style={{ width: widthCh ? `${widthCh}ch` : '11rem' }}
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setCursor(0)
            }}
            onKeyDown={(e) => {
              const flat = [...factory, ...users]
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, flat.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              } else if (e.key === 'Enter' && flat.length > 0) {
                e.preventDefault()
                apply(flat[Math.max(0, Math.min(cursor, flat.length - 1))])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
              }
            }}
            placeholder="search…"
            spellCheck={false}
            className="input mx-1 mb-1 shrink-0 px-2 py-0.5 text-[11px]"
          />
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {factory.length + users.length === 0 && q.trim() !== '' && (
            <div className="px-3 py-1 text-[11px] text-muted">no match</div>
          )}
          {factory.map((p, i) => (
            <button
              key={p.name}
              data-cursor={i === cursor}
              onClick={() => apply(p)}
              className={`px-3 py-1 text-left text-[11px] transition-colors hover:bg-accent/15 hover:text-accent ${
                i === cursor ? 'bg-accent/15 text-accent' : applied === p.name ? 'text-accent' : ''
              }`}
            >
              {p.name}
            </button>
          ))}
          {users.length > 0 && <div className="my-1 border-t border-border" />}
          {users.map((p, j) => (
            <div key={p.name} className="flex items-center">
              <button
                data-cursor={factory.length + j === cursor}
                onClick={() => apply(p)}
                className={`flex-1 truncate px-3 py-1 text-left text-[11px] transition-colors hover:bg-accent/15 hover:text-accent ${
                  factory.length + j === cursor ? 'bg-accent/15 text-accent' : applied === p.name ? 'text-accent' : ''
                }`}
                title={`${p.name} (user preset)`}
              >
                {p.name}
              </button>
              <button
                onClick={() => setDeleteTarget(p.name)}
                className="px-2 font-mono text-[10px] text-muted hover:text-danger"
                title={`Delete preset "${p.name}"`}
              >
                ×
              </button>
            </div>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => {
              setOpen(false)
              setAddPrompt(true)
            }}
            className="px-3 py-1 text-left text-[11px] text-accent2 transition-colors hover:bg-accent/15"
          >
            ＋ add preset…
          </button>
          </div>
        </div>
      )}

      {addPrompt && (
        <PromptModal
          title="Preset name?"
          placeholder="e.g. My duotone"
          confirmLabel="Save"
          onConfirm={(name) => {
            addUserShaderPreset(shaderId, name, snapshotValues())
            setLocalApplied(name)
            onApplied?.(name)
            setAddPrompt(false)
          }}
          onCancel={() => setAddPrompt(false)}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title={`Are you sure you want to delete the preset "${deleteTarget}"?`}
          onYes={() => {
            deleteUserShaderPreset(shaderId, deleteTarget)
            if (applied === deleteTarget) {
              setLocalApplied(null)
              onApplied?.(null)
            }
            setDeleteTarget(null)
          }}
          onNo={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
