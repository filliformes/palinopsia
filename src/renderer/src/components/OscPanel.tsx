// OSC input panel — enable/disable the listener, set the port, and see where
// to point Pandore (this machine's addresses) + a live activity blink and the
// last received address. The heavy lifting is in oscInput.ts.

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { applyOscListen } from '../oscInput'

export function OscPanel(): JSX.Element {
  const oscEnabled = useStore((s) => s.oscEnabled)
  const oscPort = useStore((s) => s.oscPort)
  const oscListening = useStore((s) => s.oscListening)
  const oscAddresses = useStore((s) => s.oscAddresses)
  const setOscConfig = useStore((s) => s.setOscConfig)
  const [portStr, setPortStr] = useState(String(oscPort))
  const [last, setLast] = useState('')
  const dotRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => setPortStr(String(oscPort)), [oscPort])

  // Activity blink + last-address readout, straight from the IPC stream (no
  // store writes — this must not cause re-renders per message).
  useEffect(() => {
    return window.api.onOscReceived((batch) => {
      if (!batch.length) return
      setLast(batch[batch.length - 1].address)
      const el = dotRef.current
      if (el) {
        el.style.opacity = '1'
        window.setTimeout(() => {
          if (dotRef.current) dotRef.current.style.opacity = '0.2'
        }, 90)
      }
    })
  }, [])

  function toggle(): void {
    setOscConfig({ enabled: !oscEnabled })
    void applyOscListen()
  }
  function commitPort(): void {
    const p = parseInt(portStr, 10)
    if (Number.isInteger(p) && p >= 1 && p <= 65535) {
      setOscConfig({ port: p })
      if (oscEnabled) void applyOscListen()
    } else {
      setPortStr(String(oscPort))
    }
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-panel p-2 text-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={toggle}
          className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
            oscEnabled && oscListening
              ? 'bg-accent/20 text-accent ring-1 ring-accent'
              : oscEnabled
                ? 'bg-danger/20 text-danger ring-1 ring-danger'
                : 'bg-panel2 text-muted hover:text-text'
          }`}
          title={oscEnabled ? 'Stop listening for OSC' : 'Listen for OSC input'}
        >
          {oscEnabled && oscListening ? 'LISTENING' : oscEnabled ? 'BIND FAILED' : 'OSC OFF'}
        </button>
        <span className="font-mono text-[9px] uppercase text-muted">port</span>
        <input
          value={portStr}
          onChange={(e) => setPortStr(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commitPort}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="input w-16 px-1 py-0.5 text-right text-[11px]"
          title="Local UDP port to listen on (Pandore sends here)"
        />
        <div className="flex-1" />
        <span
          ref={dotRef}
          className="h-2 w-2 shrink-0 rounded-full bg-accent"
          style={{ opacity: 0.2 }}
          title="Inbound OSC activity"
        />
      </div>

      {/* Status line — tells the user exactly what to do next. */}
      {!oscEnabled ? (
        <div className="font-mono text-[9px] leading-relaxed text-muted">
          Not listening. Click <span className="text-text">OSC OFF</span> to enable, then point
          Pandore at this machine below.
        </div>
      ) : oscListening ? (
        <div className="font-mono text-[9px] leading-relaxed text-muted">
          Live — Pandore plays the instrument.
        </div>
      ) : (
        <div className="font-mono text-[9px] leading-relaxed text-danger">
          Couldn&apos;t bind port {oscPort} — it may be in use. Try another port.
        </div>
      )}

      {/* Where to send + how — shown always (greyed when off) so it's ready. */}
      <div
        className={`flex flex-col gap-0.5 rounded border border-border bg-panel2/40 p-1.5 font-mono text-[9px] leading-relaxed ${
          oscEnabled && oscListening ? 'text-muted' : 'text-muted/60'
        }`}
      >
        <div>
          send OSC to{' '}
          <span className={oscEnabled && oscListening ? 'text-accent' : 'text-text'}>
            {oscAddresses.length ? oscAddresses.join(' · ') : 'localhost'}
          </span>{' '}
          : <span className={oscEnabled && oscListening ? 'text-accent' : 'text-text'}>{oscPort}</span>{' '}
          (UDP)
        </div>
        <div>
          values <span className="text-text">0.0–1.0</span> · addresses under{' '}
          <span className="text-text">/opsia/…</span>
        </div>
        <div className="text-muted/70">
          e.g. /opsia/meta/1 · /opsia/layer/1/opacity · /opsia/scene/2
        </div>
        <div>
          OSCQuery (auto-discovery) <span className="text-text">http://…:{oscPort + 1}</span>
        </div>
      </div>

      {last && (
        <div className="truncate font-mono text-[9px] text-accent/80" title={last}>
          ↙ {last}
        </div>
      )}
    </div>
  )
}
