// SharePicker : the Spout (Windows) or Syphon (macOS) senders running on this
// computer, for the "Spout / Syphon Input" layer source. Listing never opens a
// camera or touches the network : the senders are other programs here.

import { useCallback, useEffect, useState } from 'react'
import { shareInStats } from '../engine/shareIn'
import { shareInKind, type ShareInSender, type ShareInStatus } from '@shared/shareIn'
import { useStore } from '../store'

/** What a Spout / Syphon input layer is receiving, live. */
export function ShareInReadout({ name }: { name: string }): JSX.Element {
  const [s, setS] = useState<(ShareInStatus & { arriving: number }) | null>(null)
  useEffect(() => {
    const tick = (): void => setS(shareInStats(name))
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [name])
  const kind = shareInKind(window.api.platform) ?? 'Spout'
  const route = s?.route === 'gpu' ? 'shared on the graphics card' : s?.route === 'cpu' ? 'copied' : ''
  const text = !s
    ? 'starting…'
    : s.state === 'waiting'
      ? s.w
        ? 'the sender stopped : waiting for it to come back'
        : `waiting for “${name}” : start it, it is picked up by itself`
      : s.state === 'live'
        ? `${s.w}×${s.h} · ${s.arriving || s.fps} fps${route ? ` · ${route}` : ''}`
        : s.state === 'other-gpu'
          ? 'the sender draws on another graphics card : switching to copies…'
          : s.error || (s.state === 'unavailable' ? `no ${kind} module in this build` : s.state)
  return (
    <div
      className="px-3 pb-2 font-mono text-[10px] text-muted"
      title={`Received from another program on this computer : picture size, frames per second, and the route (shared on the graphics card : no copy at all; copied : read back through memory, when the sender is on another graphics card)`}
    >
      ⧉ {text}
    </div>
  )
}

export function SharePicker({
  onPick,
  onCancel
}: {
  onPick: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const [senders, setSenders] = useState<ShareInSender[] | null>(null)
  const [msg, setMsg] = useState('')
  const ownOn = useStore((s) => s.shareActive)
  const kind = shareInKind(window.api.platform) ?? 'Spout'

  const refresh = useCallback(async (): Promise<void> => {
    setSenders(null)
    setMsg('')
    try {
      const r = await window.api.shareInList()
      setSenders(r.senders)
      if (!r.ok) setMsg(r.message)
    } catch (e) {
      setSenders([])
      setMsg((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const what = kind === 'Syphon' ? 'Syphon server' : 'Spout sender'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-[13px] font-semibold">Choose a {what}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void refresh()}
              className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted hover:text-accent"
              title={`Look for ${kind} senders on this computer again`}
            >
              ⟳ rescan
            </button>
            <button
              onClick={onCancel}
              className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted hover:text-text"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {senders === null ? (
            <div className="p-6 text-center text-[12px] text-muted">Looking for {kind} senders on this computer…</div>
          ) : senders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-[12px] text-muted">
              {msg
                ? `${kind} input is not available : ${msg}.`
                : `No ${kind} senders on this computer. Start one in another program (its ${kind} output), then rescan. A sender that closes and comes back is picked up again by its name.`}
              <button
                onClick={() => void refresh()}
                className="rounded border border-accent/50 bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent hover:bg-accent/20"
              >
                ⟳ rescan
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {senders.map((s) => {
                // (Syphon lists a server as "app : name")
                const own = ownOn && (s.name === 'Palinopsia' || (kind === 'Syphon' && s.name.endsWith(' : Palinopsia')))
                return (
                  <button
                    key={s.name}
                    onClick={() => onPick(s.name)}
                    className="flex items-center gap-2 rounded border border-border bg-panel2 px-3 py-2 text-left text-[12px] transition-colors hover:border-accent hover:text-accent"
                    title={own ? `${s.name} : this app's own output, a loop back into the layer` : s.name}
                  >
                    <span className="text-[14px]">⧉</span>
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {own && <span className="shrink-0 font-mono text-[10px] text-muted">this output ↻</span>}
                    {s.w > 0 && (
                      <span className="shrink-0 font-mono text-[10px] text-muted">
                        {s.w}×{s.h}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className="border-t border-border px-4 py-1.5 text-[10px] text-muted">
          Full quality, no compression : the picture is shared on the graphics card when the sender draws on the same one.
        </div>
      </div>
    </div>
  )
}
