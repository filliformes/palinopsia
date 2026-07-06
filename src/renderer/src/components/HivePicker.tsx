// HivePicker — enter a HIVE sender's host and port for a live stream source.
// (HIVE auto-discovers via mDNS on its own tooling; here we connect directly,
// which its `hive-recv listen --host --port` mode also supports.)

import { useState } from 'react'

export function HivePicker({
  onPick,
  onCancel
}: {
  onPick: (host: string, port: number) => void
  onCancel: () => void
}): JSX.Element {
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('')

  const submit = (): void => {
    const p = Number(port)
    if (host.trim() && Number.isFinite(p) && p > 0) onPick(host.trim(), p)
  }

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
            className="rounded border border-accent bg-accent/15 px-3 py-1 font-mono text-[11px] text-accent hover:bg-accent/25"
          >
            connect
          </button>
        </div>
        <p className="text-[10px] leading-tight text-muted">
          Experimental — needs the host&apos;s HEVC hardware decoder. Capture / Live
          Input are the reliable live-in paths.
        </p>
      </div>
    </div>
  )
}
