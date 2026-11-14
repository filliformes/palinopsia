// The OSC section's destinations : where Palinopsia sends, one row each (oscDests.ts).
//   ● name  host : port   F M B   12/s   ✕
// F feedback (the live /opsia state, only what changes; its prefixes on a second line
// when open), M MARK (the output's scanline as sound), B the Body rules' OSC. The
// section's FEEDBACK and MARK buttons and the Body page's OSC switch stay the masters.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { applyOscOutput } from '../oscInput'
import { isPlausibleHost, isSelfDest, makeDest, type OscDest } from '../oscDests'
import { oscPeerRates } from '../oscMonitor'
import { numberBoxCh, numberBoxChars } from './numberBox'

const PORT_W = numberBoxCh(numberBoxChars(1, 65535, true))

const chip = (on: boolean, live: boolean): string =>
  `shrink-0 rounded px-1 font-mono text-[9px] leading-[14px] transition-colors ${
    on ? (live ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2' : 'bg-panel3 text-text ring-1 ring-border') : 'bg-panel2 text-muted/60 hover:text-text'
  }`

export function OscDestinations(): JSX.Element {
  const dests = useStore((s) => s.oscDests)
  const setDests = useStore((s) => s.setOscDests)
  const feedbackOn = useStore((s) => s.oscOutEnabled)
  const markOn = useStore((s) => s.markSignalEnabled)
  const bodyOn = useStore((s) => !!s.bodyControl.oscOut)
  // each destination's msg/s, read from the monitor's counters 4 times a second
  const [rates, setRates] = useState<Record<string, number>>({})
  useEffect(() => {
    const t = window.setInterval(() => setRates(oscPeerRates('out')), 250)
    return () => window.clearInterval(t)
  }, [])

  const update = (id: string, patch: Partial<OscDest>): void => {
    setDests(dests.map((d) => (d.id === id ? { ...d, ...patch } : d)))
    applyOscOutput() // a changed destination resyncs from scratch
  }
  const remove = (id: string): void => {
    setDests(dests.filter((d) => d.id !== id))
    applyOscOutput()
  }
  const add = (): void => {
    const last = dests[dests.length - 1]
    setDests([...dests, makeDest({ name: `out ${dests.length + 1}`, host: last?.host ?? '127.0.0.1', port: (last?.port ?? 9000) + 1 })])
    applyOscOutput()
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {dests.map((d, i) => {
        const dupOf = dests.findIndex((o, j) => j < i && o.host === d.host && o.port === d.port)
        return (
          <DestRow
            key={d.id}
            d={d}
            rate={rates[`${d.host}:${d.port}`] ?? 0}
            dupOf={dupOf >= 0 ? dests[dupOf].name : null}
            masters={{ feedback: feedbackOn, mark: markOn, body: bodyOn }}
            onChange={(p) => update(d.id, p)}
            onRemove={() => remove(d.id)}
          />
        )
      })}
      {dests.length === 0 && <span className="font-mono text-[9px] text-muted">no destination : nothing is sent</span>}
      <button
        onClick={add}
        disabled={dests.length >= 16}
        className="self-start rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-text disabled:opacity-40"
        title="Send to one more place (another computer, another program) : each destination picks what it receives"
      >
        + destination
      </button>
    </div>
  )
}

function DestRow({
  d, rate, dupOf, masters, onChange, onRemove
}: {
  d: OscDest
  rate: number
  dupOf: string | null
  masters: { feedback: boolean; mark: boolean; body: boolean }
  onChange: (p: Partial<OscDest>) => void
  onRemove: () => void
}): JSX.Element {
  const [name, setName] = useState(d.name)
  const [host, setHost] = useState(d.host)
  const [port, setPort] = useState(String(d.port))
  const [prefixes, setPrefixes] = useState(d.prefixes.join(', '))
  const [bad, setBad] = useState<'host' | 'port' | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => setName(d.name), [d.name])
  useEffect(() => setHost(d.host), [d.host])
  useEffect(() => setPort(String(d.port)), [d.port])
  useEffect(() => setPrefixes(d.prefixes.join(', ')), [d.prefixes])
  const flash = (f: 'host' | 'port'): void => {
    setBad(f)
    window.setTimeout(() => setBad((c) => (c === f ? null : c)), 700)
  }
  const enterBlurs = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }
  const self = isSelfDest(d)

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-1">
        <button
          onClick={() => onChange({ on: !d.on })}
          className={`h-2 w-2 shrink-0 rounded-full ${d.on ? (rate > 0 ? 'bg-accent2' : 'bg-accent2/50') : 'bg-panel3 ring-1 ring-border'}`}
          title={d.on ? 'On : click to stop sending here' : 'Off : click to send here'}
          aria-label={`${d.name} ${d.on ? 'on' : 'off'}`}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 24))}
          onBlur={() => onChange({ name: name.trim() || 'out' })}
          onKeyDown={enterBlurs}
          className="input w-[60px] px-1 py-0 text-[10px]"
          title="A name for this destination (Pandore, dataFLOU, TouchDesigner…)"
        />
        <input
          value={host}
          onChange={(e) => setHost(e.target.value.trim())}
          onBlur={() => {
            if (isPlausibleHost(host)) onChange({ host })
            else { setHost(d.host); flash('host') }
          }}
          onKeyDown={enterBlurs}
          className={`input w-[92px] px-1 py-0 text-[10px] ${bad === 'host' ? 'ring-1 ring-danger' : self ? 'ring-1 ring-danger/60' : ''}`}
          title="The receiver's IPv4 address (127.0.0.1 on this computer), or localhost. Names and broadcast addresses are not supported."
        />
        <span className="font-mono text-[9px] text-muted">:</span>
        <input
          value={port}
          onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={() => {
            const p = parseInt(port, 10)
            if (Number.isInteger(p) && p >= 1 && p <= 65535) onChange({ port: p })
            else { setPort(String(d.port)); flash('port') }
          }}
          onKeyDown={enterBlurs}
          className={`input box-content px-1 py-0 text-right text-[10px] tabular-nums ${bad === 'port' ? 'ring-1 ring-danger' : ''}`}
          style={{ width: PORT_W }}
          title="The receiver's UDP port : 1–65535"
        />
        <button
          onClick={() => onChange({ feedback: !d.feedback })}
          onContextMenu={(e) => { e.preventDefault(); setOpen(!open) }}
          className={chip(d.feedback, masters.feedback)}
          title={`F : FEEDBACK here, every /opsia value that changes${d.prefixes.length ? ` under ${d.prefixes.join(', ')}` : ''}${masters.feedback ? '' : ' (FEEDBACK is off above)'}. Right-click (or ⋯) : only some addresses.`}
        >
          F{d.prefixes.length ? '*' : ''}
        </button>
        <button
          onClick={() => onChange({ mark: !d.mark })}
          className={chip(d.mark, masters.mark)}
          title={`M : MARK here, the output's scanline as sound (/opsia/av/mark-*)${masters.mark ? '' : ' (MARK is off above)'}`}
        >
          M
        </button>
        <button
          onClick={() => onChange({ body: !d.body })}
          className={chip(d.body, masters.body)}
          title={`B : the Body rules' OSC here (/body/<rule>)${masters.body ? '' : ' (off on the Body page)'}`}
        >
          B
        </button>
        <button onClick={() => setOpen(!open)} className="shrink-0 px-0.5 font-mono text-[9px] text-muted hover:text-text" title="Only some addresses for FEEDBACK">
          ⋯
        </button>
        <div className="flex-1" />
        {self ? (
          <span className="shrink-0 font-mono text-[9px] text-danger" title="This is Palinopsia's own OSC input : nothing is sent here (it would loop)">
            own input
          </span>
        ) : dupOf ? (
          <span className="shrink-0 font-mono text-[9px] text-accent2" title={`The same address and port as ${dupOf} : sent once, with both rows' choices`}>
            = {dupOf}
          </span>
        ) : (
          <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted">{d.on && rate ? `${rate}/s` : ''}</span>
        )}
        <button onClick={onRemove} className="shrink-0 px-0.5 text-[10px] text-muted hover:text-danger" title="Remove this destination">
          ✕
        </button>
      </div>
      {open && (
        <div className="ml-3 flex min-w-0 items-center gap-1">
          <span className="shrink-0 font-mono text-[9px] text-muted">feedback only under</span>
          <input
            value={prefixes}
            onChange={(e) => setPrefixes(e.target.value)}
            onBlur={() =>
              onChange({
                prefixes: prefixes
                  .split(/[,\s]+/)
                  .map((p) => p.trim())
                  .filter((p) => p.startsWith('/'))
                  .slice(0, 16)
              })
            }
            onKeyDown={enterBlurs}
            placeholder="everything (e.g. /opsia/layer1, /opsia/meta)"
            className="input min-w-0 flex-1 px-1 py-0 text-[10px]"
            title="Address prefixes, separated by commas : only the /opsia values under them are mirrored here. Empty : everything."
          />
        </div>
      )}
    </div>
  )
}
