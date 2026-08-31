// PromptModal : tiny centred modal for the two flows the preset system
// needs: a text prompt ("Preset name?") and a yes/no confirm ("Are you sure
// you want to delete X?"). Enter confirms, Escape cancels.

import { useEffect, useRef, useState, type ReactNode } from 'react'

export function PromptModal({
  title,
  placeholder,
  confirmLabel = 'OK',
  initial = '',
  onConfirm,
  onCancel
}: {
  title: string
  placeholder?: string
  confirmLabel?: string
  initial?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => inputRef.current?.select(), [])

  function submit(): void {
    if (value.trim()) onConfirm(value.trim())
  }

  return (
    <ModalShell onCancel={onCancel}>
      <div className="text-[12px] font-semibold">{title}</div>
      <input
        ref={inputRef}
        autoFocus
        className="input w-full text-[12px]"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="flex justify-end gap-2">
        <button className="btn text-[11px]" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-accent text-[11px]" onClick={submit} disabled={!value.trim()}>
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  )
}

export function ConfirmModal({
  title,
  yesLabel = 'Yes',
  noLabel = 'No',
  onYes,
  onNo
}: {
  title: string
  yesLabel?: string
  noLabel?: string
  onYes: () => void
  onNo: () => void
}): JSX.Element {
  useEffect(() => {
    // Only bind Escape here. Enter is deliberately NOT bound : a window-level
    // Enter→onYes would confirm regardless of focus, so pressing Enter on the
    // autoFocused "No" would still delete. Left unbound, Enter activates whichever
    // button is actually focused (the autoFocused "No" by default) via its click.
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onNo()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onNo])

  return (
    <ModalShell onCancel={onNo}>
      <div className="text-[12px]">{title}</div>
      <div className="flex justify-end gap-2">
        <button className="btn text-[11px]" onClick={onNo} autoFocus>
          {noLabel}
        </button>
        <button className="btn text-[11px] text-danger" onClick={onYes}>
          {yesLabel}
        </button>
      </div>
    </ModalShell>
  )
}

function ModalShell({
  children,
  onCancel
}: {
  children: ReactNode
  onCancel: () => void
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="flex w-72 flex-col gap-3 rounded-md border border-border bg-panel p-4 shadow-xl">
        {children}
      </div>
    </div>
  )
}
