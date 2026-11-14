// The OSC section's connections : who talks to Palinopsia and where it talks.
//   ↙ from   each sender (host:port) with its msg/s and when it was last heard;
//            opened, every address it sends, with its last value and what
//            Palinopsia makes of it : an /opsia control (✓), a learned control
//            (✓ learned → its target), an alias (✓ alias → its /opsia address),
//            the Resolume mapper's, or nothing (? not mapped : learn it or alias it)
//   ↗ to     each place Palinopsia sends to (the destinations, OSC Learn's answers,
//            the Resolume mapper), with its msg/s and its name when it is one of
//            the destinations
// The per-address lists are kept only while this view (or the monitor) is open.

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { fmtOscArg, oscPeerAddresses, oscPeers, watchOsc, type OscPeer } from '../oscMonitor'
import { classifyOscAddress, type OscClass } from '../oscClassify'

function ago(t: number): string {
  const s = (performance.now() - t) / 1000
  return s < 1 ? 'now' : s < 60 ? `${Math.floor(s)} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`
}

const CLASS_STYLE: Record<OscClass['kind'], string> = {
  opsia: 'text-accent',
  learned: 'text-accent',
  alias: 'text-accent',
  resolume: 'text-accent2',
  'opsia-unlisted': 'text-muted',
  unknown: 'text-danger'
}

export function OscConnections({ onAlias }: { onAlias?: (address: string) => void }): JSX.Element {
  const dests = useStore((s) => s.oscDests)
  const [, setTick] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  // keep the per-address lists while this view is open; redraw 4 times a second
  useEffect(() => {
    const close = watchOsc()
    const t = window.setInterval(() => setTick((n) => n + 1), 250)
    return () => {
      window.clearInterval(t)
      close()
    }
  }, [])
  const destName = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of dests) if (!m.has(`${d.host}:${d.port}`)) m.set(`${d.host}:${d.port}`, d.name)
    return m
  }, [dests])
  // a sender on the machine of a destination (not this computer : everything
  // local would read as every local destination's)
  const destHosts = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of dests) if (!d.host.startsWith('127.') && d.host !== 'localhost' && !m.has(d.host)) m.set(d.host, d.name)
    return m
  }, [dests])
  const ins = oscPeers('in')
  const outs = oscPeers('out')

  const peerRow = (p: OscPeer, dir: 'in' | 'out'): JSX.Element => {
    const name = dir === 'out' ? destName.get(p.key) : destHosts.get(p.key.split(':')[0])
    const isOpen = open === `${dir}|${p.key}`
    const live = p.rate > 0
    return (
      <div key={`${dir}|${p.key}`} className="flex min-w-0 flex-col">
        <button
          onClick={() => setOpen(isOpen ? null : `${dir}|${p.key}`)}
          className="flex min-w-0 items-center gap-1.5 font-mono text-[9px] hover:text-text"
          title={dir === 'in' ? 'Open : every address it sends, and what Palinopsia makes of it' : 'Open : every address sent there'}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${live ? (dir === 'in' ? 'bg-accent' : 'bg-accent2') : 'bg-panel3'}`} />
          <span className="min-w-0 truncate text-text">{p.key}</span>
          {name && <span className="shrink-0 text-muted">({dir === 'in' ? `host of ${name}` : name})</span>}
          <div className="flex-1" />
          <span className="shrink-0 tabular-nums text-muted">{p.rate}/s</span>
          <span className="w-10 shrink-0 text-right tabular-nums text-muted">{ago(p.lastAt)}</span>
          <span className={`shrink-0 text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>
        </button>
        {isOpen && <AddressList dir={dir} peer={p.key} onAlias={onAlias} />}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-1 rounded border border-border bg-panel2/40 p-1.5">
      <span className="font-mono text-[9px] font-semibold uppercase tracking-wide text-accent">↙ from</span>
      {ins.length === 0 && <span className="font-mono text-[9px] text-muted">nothing received yet (is OSC in listening ?)</span>}
      {ins.map((p) => peerRow(p, 'in'))}
      <span className="mt-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-accent2">↗ to</span>
      {outs.length === 0 && <span className="font-mono text-[9px] text-muted">nothing sent yet</span>}
      {outs.map((p) => peerRow(p, 'out'))}
    </div>
  )
}

function AddressList({ dir, peer, onAlias }: { dir: 'in' | 'out'; peer: string; onAlias?: (address: string) => void }): JSX.Element {
  const list = [...oscPeerAddresses(dir, peer).entries()].sort((a, b) => b[1].lastAt - a[1].lastAt).slice(0, 120)
  if (!list.length) {
    return <span className="ml-3 font-mono text-[9px] text-muted">open since a moment : the addresses appear as they arrive</span>
  }
  return (
    <div className="ml-3 flex min-w-0 flex-col">
      {list.map(([address, a]) => {
        const c = dir === 'in' ? classifyOscAddress(address) : null
        return (
          <div key={address} className="flex min-w-0 items-center gap-1.5 font-mono text-[9px]">
            <span className="min-w-0 truncate text-text" title={address}>
              {address}
            </span>
            {c && (
              <span className={`shrink-0 ${CLASS_STYLE[c.kind]}`} title={c.detail}>
                {c.kind === 'unknown' ? '? not mapped' : c.kind === 'opsia-unlisted' ? '/opsia, unlisted' : `✓ ${c.label}`}
              </span>
            )}
            {c?.kind === 'unknown' && onAlias && (
              <button onClick={() => onAlias(address)} className="shrink-0 rounded border border-border px-1 text-muted hover:text-text" title="Map this address to a Palinopsia control (an alias)">
                map…
              </button>
            )}
            <div className="flex-1" />
            <span className="max-w-[90px] shrink-0 truncate tabular-nums text-muted" title={a.args.map(fmtOscArg).join(' ')}>
              {a.args.slice(0, 3).map(fmtOscArg).join(' ')}
            </span>
            <span className="w-8 shrink-0 text-right tabular-nums text-muted">×{a.n}</span>
          </div>
        )
      })}
    </div>
  )
}
