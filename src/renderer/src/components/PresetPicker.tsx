// PresetPicker — the Inspector's preset control. Custom dropdown (not a
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
  onChange
}: {
  shaderId: string
  values: Record<string, number | number[]>
  onChange: (name: string, value: number | number[]) => void
}): JSX.Element | null {
  const userPresets = useStore((s) => s.userShaderPresets[shaderId] ?? [])
  const addUserShaderPreset = useStore((s) => s.addUserShaderPreset)
  const deleteUserShaderPreset = useStore((s) => s.deleteUserShaderPreset)

  const factory = PRESETS_BY_ID[shaderId] ?? []
  const [open, setOpen] = useState(false)
  const [applied, setApplied] = useState<string | null>(null)
  const [addPrompt, setAddPrompt] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const down = (e: globalThis.MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', down)
    return () => window.removeEventListener('mousedown', down)
  }, [open])

  if (factory.length === 0 && userPresets.length === 0 && !shaderId) return null

  function apply(p: ShaderPreset): void {
    for (const [k, v] of Object.entries(p.values)) onChange(k, v)
    setApplied(p.name)
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
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="input select-compact w-36 truncate text-left text-[10px]"
        title="Presets"
      >
        {applied ?? 'presets…'}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 flex max-h-64 w-44 flex-col overflow-y-auto rounded border border-border bg-panel2 py-1 shadow-lg">
          {factory.map((p) => (
            <button
              key={p.name}
              onClick={() => apply(p)}
              className={`px-3 py-1 text-left text-[11px] transition-colors hover:bg-accent/15 hover:text-accent ${
                applied === p.name ? 'text-accent' : ''
              }`}
            >
              {p.name}
            </button>
          ))}
          {userPresets.length > 0 && <div className="my-1 border-t border-border" />}
          {userPresets.map((p) => (
            <div key={p.name} className="flex items-center">
              <button
                onClick={() => apply(p)}
                className={`flex-1 truncate px-3 py-1 text-left text-[11px] transition-colors hover:bg-accent/15 hover:text-accent ${
                  applied === p.name ? 'text-accent' : ''
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
      )}

      {addPrompt && (
        <PromptModal
          title="Preset name?"
          placeholder="e.g. My duotone"
          confirmLabel="Save"
          onConfirm={(name) => {
            addUserShaderPreset(shaderId, name, snapshotValues())
            setApplied(name)
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
            if (applied === deleteTarget) setApplied(null)
            setDeleteTarget(null)
          }}
          onNo={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
