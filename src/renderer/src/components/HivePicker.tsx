// HivePicker : a HIVE stream for a live source. The senders seen on the network
// (mDNS, _hive._udp) are listed : one picked by name is found again there on every
// reconnect, wherever its sender moves. Or type a host and port by hand.

import { useEffect, useState } from 'react'

export function HivePicker({
  onPick,
  onCancel
}: {
  onPick: (host: string, port: number, name?: string) => void
  onCancel: () => void
}): JSX.Element {
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('')
  // the senders on the network, looked at again every second while open
  const [found, setFound] = useState<Array<{ name: string; host: string; port: number }>>([])
  useEffect(() => {
    let live = true
    const look = (): void => { void window.api.hiveBrowse().then((l) => { if (live) setFound(l) }).catch(() => {}) }
    look()
    const t = window.setInterval(look, 1000)
    return () => { live = false; window.clearInterval(t) }
  }, [])

  const submit = (): void => {
    const p = Number(port)
    if (host.trim() && Number.isFinite(p) && p > 0) onPick(host.trim(), p)
  }

  // Esc closes, matching every other modal in the app.
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-border bg-panel p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">📡 HIVE stream</span>
          <button onClick={onCancel} className="font-mono text-[11px] text-muted hover:text-text">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[9px] uppercase text-muted">on the network</span>
          {found.length === 0 && <span className="font-mono text-[10px] text-muted">no HIVE sender seen yet (looking…)</span>}
          {found.map((f) => (
            <button
              key={f.name}
              onClick={() => onPick(f.host, f.port, f.name)}
              className="flex items-center justify-between gap-2 rounded border border-border bg-panel2 px-2 py-1 text-left text-[12px] hover:border-accent"
              title="Connect by name : Palinopsia finds this sender again if its address or port changes"
            >
              <span className="min-w-0 truncate">{f.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted">{f.host}:{f.port}</span>
            </button>
          ))}
          <span className="mt-1 font-mono text-[9px] uppercase text-muted">or by address</span>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <span className="w-10 shrink-0 font-mono text-[9px] uppercase">host</span>
          <input
            className="input min-w-0 flex-1 px-2 py-1 text-[12px]"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="127.0.0.1"
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <span className="w-10 shrink-0 font-mono text-[9px] uppercase">port</span>
          <input
            autoFocus
            className="input w-28 px-2 py-1 text-[12px]"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="e.g. 49200"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-border px-3 py-1 font-mono text-[11px] text-muted hover:text-text"
          >
            cancel
          </button>
          <button
            onClick={submit}
            disabled={!(host.trim() && Number(port) > 0)}
            className="rounded border border-accent bg-accent/15 px-3 py-1 font-mono text-[11px] text-accent hover:bg-accent/25 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-accent/15"
            title={host.trim() && Number(port) > 0 ? 'Connect to the HIVE stream' : 'Enter a host and a port first'}
          >
            connect
          </button>
        </div>
        <p className="text-[10px] leading-tight text-muted">
          Experimental : needs the host&apos;s HEVC hardware decoder. Capture / Live
          Input are the reliable live-in paths.
        </p>
      </div>
    </div>
  )
}
