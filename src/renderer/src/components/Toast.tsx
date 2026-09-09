// A single toast line. Transient by default (auto-dismisses) for confirmations
// with no natural home — a recording saved, a panic fired. One at a time (a
// newer message replaces the older). `ms <= 0` makes it STICKY : it stays with
// a ✕ and wraps its full text, for actionable install-instruction errors that
// shouldn't vanish on a timer.

import { useSyncExternalStore } from 'react'

type ToastMsg = { id: number; text: string; kind: 'ok' | 'warn'; sticky: boolean }

let current: ToastMsg | null = null
let seq = 0
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}
function clearTimer(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

/** Show a toast. `kind` tints it (ok = accent, warn = danger). `ms <= 0` = sticky. */
export function showToast(text: string, kind: 'ok' | 'warn' = 'ok', ms = 3400): void {
  const sticky = ms <= 0
  current = { id: ++seq, text, kind, sticky }
  emit()
  clearTimer()
  if (!sticky)
    timer = setTimeout(() => {
      current = null
      timer = null
      emit()
    }, ms)
}

/** Dismiss the current toast (the sticky ✕). */
export function dismissToast(): void {
  clearTimer()
  current = null
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function snapshot(): ToastMsg | null {
  return current
}

/** Mount once near the app root. Renders the current toast (or nothing). */
export function Toaster(): JSX.Element | null {
  const msg = useSyncExternalStore(subscribe, snapshot)
  if (!msg) return null
  const tint = msg.kind === 'warn' ? 'border-danger/70 text-danger' : 'border-accent/70 text-text'
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[200] flex justify-center">
      <div
        key={msg.id}
        className={`pointer-events-auto flex items-start gap-2 rounded-md border bg-panel2/95 px-3 py-1.5 font-mono text-[11px] shadow-lg backdrop-blur ${tint} ${
          msg.sticky ? 'max-w-md' : 'max-w-[80vw]'
        }`}
        title={msg.sticky ? undefined : msg.text}
      >
        <span className={msg.sticky ? 'min-w-0 leading-snug' : 'min-w-0 truncate'}>{msg.text}</span>
        {msg.sticky && (
          <button
            onClick={dismissToast}
            className="shrink-0 leading-none opacity-70 transition-opacity hover:opacity-100"
            title="Dismiss"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
