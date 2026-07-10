// OSC input panel : enable/disable the listener, set the port, and see where
// to point Pandore (this machine's addresses) + a live activity blink and the
// last received address. The heavy lifting is in oscInput.ts.

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { applyOscListen, applyOscOutput } from '../oscInput'

export function OscPanel(): JSX.Element {
  const oscEnabled = useStore((s) => s.oscEnabled)
  const oscPort = useStore((s) => s.oscPort)
  const oscListening = useStore((s) => s.oscListening)
  const oscAddresses = useStore((s) => s.oscAddresses)
  const setOscConfig = useStore((s) => s.setOscConfig)
  const oscOutEnabled = useStore((s) => s.oscOutEnabled)
  const oscOutHost = useStore((s) => s.oscOutHost)
  const oscOutPort = useStore((s) => s.oscOutPort)
  const setOscOutConfig = useStore((s) => s.setOscOutConfig)
  const markSignalEnabled = useStore((s) => s.markSignalEnabled)
  const setMarkSignal = useStore((s) => s.setMarkSignal)
  const collapsed = useStore((s) => !!s.collapsed['osc'])
  const toggleSection = useStore((s) => s.toggleSection)
  const [portStr, setPortStr] = useState(String(oscPort))
  const [outHostStr, setOutHostStr] = useState(oscOutHost)
  const [outPortStr, setOutPortStr] = useState(String(oscOutPort))
  const [last, setLast] = useState('')
  const dotRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => setPortStr(String(oscPort)), [oscPort])
  useEffect(() => setOutHostStr(oscOutHost), [oscOutHost])
  useEffect(() => setOutPortStr(String(oscOutPort)), [oscOutPort])

  // Activity blink + last-address readout, straight from the IPC stream (no
  // store writes : this must not cause re-renders per message).
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
  function toggleOut(): void {
    setOscOutConfig({ enabled: !oscOutEnabled })
    applyOscOutput()
  }
  function commitOutHost(): void {
    const h = outHostStr.trim()
    if (h) {
      setOscOutConfig({ host: h })
      if (oscOutEnabled) applyOscOutput()
    } else {
      setOutHostStr(oscOutHost)
    }
  }
  function commitOutPort(): void {
    const p = parseInt(outPortStr, 10)
    if (Number.isInteger(p) && p >= 1 && p <= 65535) {
      setOscOutConfig({ port: p })
      if (oscOutEnabled) applyOscOutput()
    } else {
      setOutPortStr(String(oscOutPort))
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1 border-t border-border bg-panel px-3 py-1.5 text-[11px]">
      {/* Section header : matches Modulation / Meta (chevron + title collapse),
          with the enable button + live status + activity dot riding the header so
          the OSC state stays visible even when the section is collapsed. */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => toggleSection('osc')}
          className="flex shrink-0 items-center gap-1.5"
          title={collapsed ? 'Expand OSC' : 'Collapse OSC'}
        >
          <span
            className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
          >
            ▶
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">OSC</span>
        </button>
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
        <span
          className={`font-mono text-[9px] ${
            oscEnabled && oscListening
              ? 'text-accent'
              : oscEnabled
                ? 'text-danger'
                : 'text-muted'
          }`}
        >
          {oscEnabled && oscListening ? 'live' : oscEnabled ? 'bind failed' : 'not listening'}
        </span>
        <div className="flex-1" />
        <span
          ref={dotRef}
          className="h-2 w-2 shrink-0 rounded-full bg-accent"
          style={{ opacity: 0.2 }}
          title="Inbound OSC activity"
        />
      </div>

      {!collapsed && (
        <>
          {/* Port row. */}
          <div className="flex min-w-0 items-center gap-2">
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
          </div>

          {/* The send-target + outbound controls only matter once OSC is on. */}
          {oscEnabled && (
            <>
          <div
            className={`flex flex-col gap-0.5 rounded border border-border bg-panel2/40 p-1.5 font-mono text-[9px] leading-relaxed ${
              oscListening ? 'text-muted' : 'text-muted/60'
            }`}
          >
            <div>
              send →{' '}
              <span className={oscListening ? 'text-accent' : 'text-text'}>
                {oscAddresses.length ? oscAddresses.join(' · ') : 'localhost'}
              </span>
              :<span className={oscListening ? 'text-accent' : 'text-text'}>{oscPort}</span> (UDP) ·
              values <span className="text-text">0–1</span> · <span className="text-text">/opsia/…</span>
            </div>
            <div>
              e.g. <span className="text-text">/opsia/meta/1</span> ·{' '}
              <span className="text-text">/opsia/layer/1/opacity</span> · OSCQuery{' '}
              <span className="text-text">:{oscPort + 1}</span>
            </div>
          </div>

          {last && (
            <div className="truncate font-mono text-[9px] text-accent/80" title={last}>
              ↙ {last}
            </div>
          )}

          {/* Outbound to Pandore (one line) : FEEDBACK mirrors our live state back
              so its UI tracks ours; MARK sends a scanline of the output as sound
              (the animated-sound loop). Both share the host:port on the right.
              Lives inside the OSC toggle : hidden until OSC is enabled. */}
          <div className="flex min-w-0 items-center gap-1.5 border-t border-border/60 pt-1">
        <button
          onClick={toggleOut}
          className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
            oscOutEnabled
              ? 'bg-accent/20 text-accent ring-1 ring-accent'
              : 'bg-panel2 text-muted hover:text-text'
          }`}
          title={oscOutEnabled ? 'FEEDBACK on : stop mirroring live state to Pandore' : 'FEEDBACK : mirror live state to Pandore over OSC'}
        >
          {oscOutEnabled ? 'FDBK →' : 'FDBK'}
        </button>
        <button
          onClick={() => setMarkSignal({ enabled: !markSignalEnabled })}
          className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
            markSignalEnabled
              ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2'
              : 'bg-panel2 text-muted hover:text-text'
          }`}
          title={
            markSignalEnabled
              ? 'MARK→SND on : stop sending the drawn optical soundtrack to Pandore (/opsia/av/mark-*)'
              : 'MARK→SND : send a scanline of the output to Pandore as sound (/opsia/av/mark-*), the animated-sound loop. Uses the host/port here.'
          }
        >
          {markSignalEnabled ? 'MARK →' : 'MARK'}
        </button>
        <div className="flex-1" />
        <input
          value={outHostStr}
          onChange={(e) => setOutHostStr(e.target.value)}
          onBlur={commitOutHost}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="input w-20 px-1 py-0.5 text-[11px]"
          title="Destination host (Pandore's IP : 127.0.0.1 if same machine). Shared by FEEDBACK + MARK."
        />
        <span className="font-mono text-[9px] uppercase text-muted">:</span>
        <input
          value={outPortStr}
          onChange={(e) => setOutPortStr(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commitOutPort}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
            className="input w-12 px-1 py-0.5 text-right text-[11px]"
            title="Destination UDP port Pandore receives on"
          />
          </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
