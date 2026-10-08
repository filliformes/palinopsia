// The OSC monitor (OSC section) : every message coming in and going out, live.
// "log" lists them newest first; "latest" keeps one row per address with its
// last value, how many came and how long ago (the busy streams read better that
// way). Filters by direction and by address; pause freezes what is shown. It
// records only while it is open (oscMonitor.ts).

import { useEffect, useRef, useState } from 'react'
import { fmtOscArg, oscLog, watchOsc, clearOscLog, type OscArg, type OscLogEntry } from '../oscMonitor'

const MAX_LINES = 250
const chipCls = (on: boolean, tone: 'accent' | 'accent2' = 'accent'): string =>
  `shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
    on
      ? tone === 'accent' ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-accent2/20 text-accent2 ring-1 ring-accent2'
      : 'bg-panel2 text-muted hover:text-text'
  }`

function argsText(args: OscArg[]): string {
  if (!args.length) return ''
  const shown = args.slice(0, 6).map(fmtOscArg).join(' ')
  return args.length > 6 ? `${shown} … (${args.length})` : shown
}

/** performance.now() of an entry → the wall clock it happened at (mm:ss.mmm). */
function clock(t: number): string {
  const d = new Date(Date.now() - (performance.now() - t))
  return `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function age(t: number): string {
  const s = (performance.now() - t) / 1000
  return s < 1 ? 'now' : s < 60 ? `${Math.floor(s)}s` : `${Math.floor(s / 60)}m`
}

export function OscMonitor(): JSX.Element {
  const [mode, setMode] = useState<'log' | 'latest'>('log')
  const [showIn, setShowIn] = useState(true)
  const [showOut, setShowOut] = useState(true)
  const [filter, setFilter] = useState('')
  const [frozen, setFrozen] = useState<{ log: OscLogEntry[]; latest: Map<string, { e: OscLogEntry; n: number }> } | null>(null)
  const [, setTick] = useState(0)
  const seen = useRef(-1)

  // Keep messages while open; redraw a few times a second when something came.
  useEffect(() => watchOsc(), [])
  useEffect(() => {
    if (frozen) return
    const id = window.setInterval(() => {
      const v = oscLog().version
      // "latest" shows ages : it redraws even when nothing new came
      if (v !== seen.current || mode === 'latest') { seen.current = v; setTick((x) => x + 1) }
    }, 150)
    return () => window.clearInterval(id)
  }, [frozen, mode])

  const live = oscLog()
  const src = frozen ?? { log: live.log, latest: live.latest }
  const f = filter.trim().toLowerCase()
  const keep = (e: OscLogEntry): boolean =>
    (e.dir === 'in' ? showIn : showOut) && (!f || e.address.toLowerCase().includes(f))

  const lines: OscLogEntry[] = []
  for (let i = src.log.length - 1; i >= 0 && lines.length < MAX_LINES; i--) if (keep(src.log[i])) lines.push(src.log[i])
  const rows = [...src.latest.values()].filter((r) => keep(r.e)).sort((a, b) => a.e.address.localeCompare(b.e.address) || (a.e.dir < b.e.dir ? -1 : 1))

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <div className="flex overflow-hidden rounded ring-1 ring-border font-mono text-[9px]">
          <button onClick={() => setMode('log')} className={`px-1.5 py-0.5 ${mode === 'log' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text'}`} title="Every message, newest first">log</button>
          <button onClick={() => setMode('latest')} className={`px-1.5 py-0.5 ${mode === 'latest' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text'}`} title="One row per address : its last value, how many came, how long ago">latest</button>
        </div>
        <button onClick={() => setShowIn(!showIn)} className={chipCls(showIn)} title="Show what comes in">↙ in</button>
        <button onClick={() => setShowOut(!showOut)} className={chipCls(showOut, 'accent2')} title="Show what goes out">↗ out</button>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter /opsia/…"
          spellCheck={false}
          className="input h-[20px] min-w-[60px] flex-1 px-1.5 font-mono text-[9.5px]"
          title="Only the addresses containing this text"
        />
        <button
          onClick={() => setFrozen(frozen ? null : { log: [...live.log], latest: new Map(live.latest) })}
          className={chipCls(!!frozen)}
          title={frozen ? 'Resume : show the live traffic again' : 'Pause : freeze what is shown (messages keep coming)'}
        >
          {frozen ? '▶' : '⏸'}
        </button>
        <button onClick={() => { clearOscLog(); setFrozen(null) }} className={chipCls(false)} title="Clear the monitor">clear</button>
      </div>
      <div className="h-56 overflow-auto rounded border border-border bg-bg/60 px-1.5 py-1 font-mono text-[9.5px] leading-[1.5]">
        {mode === 'log' ? (
          lines.length ? lines.map((e, i) => (
            <div key={i} className="flex min-w-0 gap-1.5 whitespace-nowrap">
              <span className="shrink-0 text-muted/50">{clock(e.t)}</span>
              <span className={`shrink-0 ${e.dir === 'in' ? 'text-accent' : 'text-accent2'}`}>{e.dir === 'in' ? '↙' : '↗'}</span>
              <span className="shrink-0 text-text">{e.address}</span>
              <span className="min-w-0 truncate text-muted">{argsText(e.args)}</span>
              {e.peer && <span className="ml-auto shrink-0 pl-2 text-muted/50">{e.peer}</span>}
            </div>
          )) : <Empty />
        ) : (
          rows.length ? rows.map((r) => (
            <div key={`${r.e.dir}|${r.e.address}`} className="flex min-w-0 gap-1.5 whitespace-nowrap">
              <span className={`shrink-0 ${r.e.dir === 'in' ? 'text-accent' : 'text-accent2'}`}>{r.e.dir === 'in' ? '↙' : '↗'}</span>
              <span className="shrink-0 text-text">{r.e.address}</span>
              <span className="min-w-0 truncate text-muted">{argsText(r.e.args)}</span>
              <span className="ml-auto shrink-0 pl-2 text-muted/60">×{r.n}</span>
              <span className="w-8 shrink-0 text-right text-muted/50">{age(r.e.t)}</span>
            </div>
          )) : <Empty />
        )}
      </div>
      <span className="font-mono text-[8.5px] text-muted/70">
        {mode === 'log' ? `${lines.length} of the last ${src.log.length} messages` : `${rows.length} addresses`}
        {frozen ? ' · paused' : ''} · UDP only (the OSCQuery web stream is not shown)
      </span>
    </div>
  )
}

function Empty(): JSX.Element {
  return <div className="py-6 text-center text-muted/60">nothing yet : messages appear here as they come and go</div>
}
