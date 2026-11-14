// OSC section of the Connect tab, in two clear halves and a monitor :
//   ↙ IN   what plays Palinopsia : listen on/off, the port, where to send
//   ↗ OUT  what Palinopsia sends : the destination, FEEDBACK (mirror the live
//          state), MARK (the output as sound); the body rules' OSC goes there too
//   monitor  every message both ways, live (OscMonitor)
// The header shows IN and OUT at a glance (a light that blinks with traffic and
// the msg/s), so it reads folded too. The heavy lifting is in oscInput.ts; the
// counters and the monitor's tap in oscMonitor.ts.

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { applyOscListen, applyOscOutput } from '../oscInput'
import { oscCounts, oscRates } from '../oscMonitor'
import { OscMonitor } from './OscMonitor'
import { OscDestinations } from './OscDestinations'
import { OscConnections } from './OscConnections'
import { OscMapTable } from './OscMapTable'

/** The IN section's multicast groups : joined beside the port, so messages sent to
 *  a group on the local network reach Palinopsia without being sent to it. */
function MulticastRow(): JSX.Element {
  const groups = useStore((s) => s.oscMulticast)
  const setGroups = useStore((s) => s.setOscMulticast)
  const status = useStore((s) => s.oscMulticastStatus)
  const enabled = useStore((s) => s.oscEnabled)
  const [txt, setTxt] = useState(groups.join(', '))
  useEffect(() => setTxt(groups.join(', ')), [groups])
  const commit = (): void => {
    const next = txt.split(/[,\s]+/).map((g) => g.trim()).filter(Boolean)
    if (next.join(',') === groups.join(',')) return
    setGroups(next)
    if (enabled) void applyOscListen()
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[9px]">
      <span className="shrink-0 uppercase text-muted">multicast</span>
      <input
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        placeholder="none (e.g. 239.0.0.1)"
        className="input min-w-[90px] flex-1 px-1 py-0 text-[10px]"
        title="Multicast groups to join (224.0.0.0 to 239.255.255.255, separated by commas) : whatever is sent to a group on this network, on the port above, reaches Palinopsia without being sent to it. Broadcasts (x.x.x.255) arrive without this."
      />
      {status?.joined.map((g) => (
        <span key={g} className="shrink-0 text-accent" title={`Joined ${g} : its messages arrive here`}>
          ✓ {g}
        </span>
      ))}
      {status?.failed.map((f) => (
        <span key={f.group} className="shrink-0 text-danger" title={f.error}>
          ✗ {f.group}
        </span>
      ))}
    </div>
  )
}
import { numberBoxCh, numberBoxChars } from './numberBox'

// a UDP port's box : as wide as "65535"
const PORT_W = numberBoxCh(numberBoxChars(1, 65535, true))

export function OscPanel(): JSX.Element {
  const oscEnabled = useStore((s) => s.oscEnabled)
  const oscPort = useStore((s) => s.oscPort)
  const oscListening = useStore((s) => s.oscListening)
  const oscAddresses = useStore((s) => s.oscAddresses)
  const setOscConfig = useStore((s) => s.setOscConfig)
  const oscOutEnabled = useStore((s) => s.oscOutEnabled)
  const setOscOutConfig = useStore((s) => s.setOscOutConfig)
  const markSignalEnabled = useStore((s) => s.markSignalEnabled)
  const setMarkSignal = useStore((s) => s.setMarkSignal)
  const collapsed = useStore((s) => !!s.collapsed['osc'])
  const toggleSection = useStore((s) => s.toggleSection)
  const [portStr, setPortStr] = useState(String(oscPort))
  const [last, setLast] = useState('')
  // A rejected port/host edit briefly flashes the field red instead of silently
  // snapping back with no explanation.
  const [invalid, setInvalid] = useState<'port' | null>(null)
  const flashInvalid = (f: 'port'): void => {
    setInvalid(f)
    window.setTimeout(() => setInvalid((c) => (c === f ? null : c)), 700)
  }

  useEffect(() => setPortStr(String(oscPort)), [oscPort])

  // Activity lights, msg/s and the last inbound address : polled from the
  // monitor's counters, never a re-render per message.
  const inDot = useRef<HTMLSpanElement | null>(null)
  const outDot = useRef<HTMLSpanElement | null>(null)
  const lastRef = useRef('')
  const [rate, setRate] = useState({ in: 0, out: 0 })
  // one pane at a time under the section : the monitor, the connections, the map
  const [pane, setPane] = useState<'monitor' | 'links' | 'map' | null>(null)
  const [mapPrefill, setMapPrefill] = useState<string | null>(null)
  const openPane = (p: 'monitor' | 'links' | 'map'): void => {
    setPane(pane === p && !collapsed ? null : p)
    if (collapsed) toggleSection('osc')
  }
  useEffect(() => {
    const unsub = window.api.onOscReceived((batch) => {
      if (batch.length) lastRef.current = batch[batch.length - 1].address
    })
    let seenIn = oscCounts.in, seenOut = oscCounts.out, n = 0
    const id = window.setInterval(() => {
      const light = (el: HTMLSpanElement | null, moved: boolean): void => { if (el) el.style.opacity = moved ? '1' : '0.2' }
      light(inDot.current, oscCounts.in !== seenIn)
      light(outDot.current, oscCounts.out !== seenOut)
      seenIn = oscCounts.in
      seenOut = oscCounts.out
      if (++n % 4 === 0) {
        const r = oscRates()
        setRate((p) => (p.in === r.in && p.out === r.out ? p : { ...r }))
        setLast((p) => (p === lastRef.current ? p : lastRef.current))
      }
    }, 120)
    return () => { unsub(); window.clearInterval(id) }
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
      flashInvalid('port')
    }
  }
  function toggleOut(): void {
    setOscOutConfig({ enabled: !oscOutEnabled })
    applyOscOutput()
  }
  const inState = oscEnabled && oscListening ? 'live' : oscEnabled ? 'bind failed' : 'off'
  const outOn = oscOutEnabled || markSignalEnabled
  const enterBlurs = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-border bg-panel px-3 py-1.5 text-[11px]">
      {/* Section header : chevron + title, then IN and OUT at a glance and the monitor. */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => toggleSection('osc')}
          className="flex shrink-0 items-center gap-1.5"
          title={collapsed ? 'Expand OSC' : 'Collapse OSC'}
        >
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">OSC</span>
        </button>
        <span
          className={`flex shrink-0 items-center gap-1 font-mono text-[9px] ${inState === 'live' ? 'text-accent' : inState === 'off' ? 'text-muted' : 'text-danger'}`}
          title={`OSC in : ${inState}${inState === 'live' ? ` on port ${oscPort}, ${rate.in} msg/s` : ''}`}
        >
          <span ref={inDot} className="h-2 w-2 shrink-0 rounded-full bg-accent" style={{ opacity: 0.2 }} />
          ↙ in {inState === 'live' ? `${rate.in}/s` : inState}
        </span>
        <span
          className={`flex shrink-0 items-center gap-1 font-mono text-[9px] ${rate.out || outOn ? 'text-accent2' : 'text-muted'}`}
          title={`OSC out : ${rate.out} msg/s${oscOutEnabled ? ' · FEEDBACK on' : ''}${markSignalEnabled ? ' · MARK on' : ''}`}
        >
          <span ref={outDot} className="h-2 w-2 shrink-0 rounded-full bg-accent2" style={{ opacity: 0.2 }} />
          ↗ out {rate.out ? `${rate.out}/s` : outOn ? 'on' : 'off'}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => openPane('links')}
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
            pane === 'links' && !collapsed ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
          }`}
          title="Connections : who sends to Palinopsia (each sender, what it sends, what is understood and what is not) and where Palinopsia sends"
        >
          links
        </button>
        <button
          onClick={() => openPane('map')}
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
            pane === 'map' && !collapsed ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
          }`}
          title="The map : every address Palinopsia answers to (aliases, OSC Learn, the built-in /opsia ones), editable"
        >
          map
        </button>
        <button
          onClick={() => openPane('monitor')}
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
            pane === 'monitor' && !collapsed ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
          }`}
          title="OSC monitor : see every message coming in and going out"
        >
          monitor
        </button>
      </div>

      {!collapsed && (
        <>
          {/* ── IN : what plays Palinopsia ── */}
          <div className="flex min-w-0 flex-col gap-1 rounded border border-accent/30 bg-panel2/40 p-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="w-9 shrink-0 font-mono text-[9px] font-semibold uppercase tracking-wide text-accent"
                title="Messages that play Palinopsia (Pandore, TouchOSC, any OSC sender)"
              >
                ↙ in
              </span>
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
                {oscEnabled && oscListening ? 'LISTENING' : oscEnabled ? 'BIND FAILED' : 'OFF'}
              </button>
              <span className="font-mono text-[9px] uppercase text-muted">port</span>
              <input
                value={portStr}
                onChange={(e) => setPortStr(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={commitPort}
                onKeyDown={enterBlurs}
                className={`input box-content px-1 py-0.5 text-right text-[11px] tabular-nums ${invalid === 'port' ? 'ring-1 ring-danger' : ''}`}
                style={{ width: PORT_W }}
                title="Local UDP port to listen on (Pandore sends here) : 1–65535"
              />
              <div className="flex-1" />
              <span className="font-mono text-[9px] text-muted">{inState === 'live' ? `${rate.in} msg/s` : ''}</span>
            </div>
            <div className={`font-mono text-[9px] leading-relaxed ${oscListening ? 'text-muted' : 'text-muted/60'}`}>
              send to{' '}
              <span className={oscListening ? 'text-accent' : 'text-text'}>
                {oscAddresses.length ? oscAddresses.join(' · ') : 'localhost'}
              </span>
              :<span className={oscListening ? 'text-accent' : 'text-text'}>{oscPort}</span> (UDP) · values{' '}
              <span className="text-text">0–1</span> · e.g. <span className="text-text">/opsia/macro/1</span> · OSCQuery{' '}
              <span className="text-text">:{oscPort + 1}</span>
            </div>
            <MulticastRow />
            <div
              className="font-mono text-[9px] leading-relaxed text-muted"
              title="Any address outside /opsia (a phone or tablet layout, a patch, another program) : turn on MIDI Learn, click a control, move the controller's. Its mappings, ranges and reply ports are in the MIDI section's list."
            >
              any other address : <span className="text-text">OSC Learn</span> (MIDI Learn, then move it)
            </div>
            {last && oscEnabled && (
              <div className="truncate font-mono text-[9px] text-accent/80" title={last}>
                last ↙ {last}
              </div>
            )}
          </div>

          {/* ── OUT : what Palinopsia sends, to one or more destinations ── */}
          <div className="flex min-w-0 flex-col gap-1 rounded border border-accent2/30 bg-panel2/40 p-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className="w-9 shrink-0 font-mono text-[9px] font-semibold uppercase tracking-wide text-accent2"
                title="Messages Palinopsia sends, to every destination below (Pandore, dataFLOU, any OSC receiver)"
              >
                ↗ out
              </span>
              <button
                onClick={toggleOut}
                className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
                  oscOutEnabled ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2' : 'bg-panel2 text-muted hover:text-text'
                }`}
                title={
                  oscOutEnabled
                    ? 'FEEDBACK on : stop mirroring the live state'
                    : 'FEEDBACK : mirror the live state over OSC (every /opsia value that changes) to each destination ticked F'
                }
              >
                {oscOutEnabled ? 'FEEDBACK ●' : 'FEEDBACK'}
              </button>
              <button
                onClick={() => setMarkSignal({ enabled: !markSignalEnabled })}
                className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
                  markSignalEnabled ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2' : 'bg-panel2 text-muted hover:text-text'
                }`}
                title={
                  markSignalEnabled
                    ? 'MARK on : stop sending the drawn optical soundtrack'
                    : 'MARK : send a scanline of the output as sound (/opsia/av/mark-signal, mark-level, mark-centroid, mark-flux) to each destination ticked M'
                }
              >
                {markSignalEnabled ? 'MARK ●' : 'MARK'}
              </button>
              <div className="flex-1" />
              <span className="font-mono text-[9px] text-muted">{rate.out ? `${rate.out} msg/s` : ''}</span>
            </div>
            <OscDestinations />
            <span className="font-mono text-[8.5px] leading-snug text-muted/70">
              F feedback · M mark · B the Body rules' OSC. OSC Learn answers each controller at its own reply port (MIDI section); the Resolume mapper
              sends to its own address (Resolume section).
            </span>
          </div>

          {/* ── MONITOR : the traffic both ways ── */}
          {pane === 'monitor' && <OscMonitor />}
          {pane === 'links' && <OscConnections onAlias={(addr) => { setMapPrefill(addr); setPane('map') }} />}
          {pane === 'map' && <OscMapTable prefill={mapPrefill} onPrefillUsed={() => setMapPrefill(null)} />}
        </>
      )}
    </div>
  )
}
