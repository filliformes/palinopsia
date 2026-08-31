// A single transient toast line, auto-dismissing. For confirmations that have
// no natural home on-screen — a recording saved from the REC pill, a panic
// fired from the keyboard. One at a time (a newer message replaces the older);
// deliberately minimal so it never competes with the picture during a set.

import { useSyncExternalStore } from 'react'

type ToastMsg = { id: number; text: string; kind: 'ok' | 'warn' }

let current: ToastMsg | null = null
let seq = 0
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Show a transient toast. `kind` tints it (ok = accent, warn = danger). */
export function showToast(text: string, kind: 'ok' | 'warn' = 'ok', ms = 3400): void {
  current = { id: ++seq, text, kind }
  emit()
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    current = null
    timer = null
    emit()
  }, ms)
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
  const tint =
    msg.kind === 'warn'
      ? 'border-danger/70 text-danger'
      : 'border-accent/70 text-text'
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[200] flex justify-center">
      <div
        key={msg.id}
        className={`pointer-events-auto max-w-[80vw] truncate rounded-md border bg-panel2/95 px-3 py-1.5 font-mono text-[11px] shadow-lg backdrop-blur ${tint}`}
        title={msg.text}
      >
        {msg.text}
      </div>
    </div>
  )
}
