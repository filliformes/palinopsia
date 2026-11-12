// dataflou section of the Connect tab : Palinopsia as a node of the
// dataflou mesh. The ON pill joins or leaves it; the name and universe are the
// only settings (only nodes of the same universe see each other). Below, the
// monitor : every node on the network (online or remembered), the connections
// wired between them, and, opening a node, its parameters with a picker to wire
// one to Palinopsia (or Palinopsia to it). The node runs in main
// (src/main/dataflou); the value bridge is ../dataflou.ts.

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { dataflouBind, meshToModulator, openDataflouVisualizer, toggleDfWatch, useDataflouStatus, useDfWatches, wireToFreeMacro } from '../dataflou'
import { BoundedNumberInput } from './BoundedNumberInput'
import { showToast } from './Toast'
import { DF_DECLARE_SMALL, DF_DESTS, DF_SOURCES, dfSessionLabel, type DfIo, type DfIoRow, type DfNodeView, type DfParam, type DfSub, type DfValue, type DfWireOpt } from '@shared/dataflou'

const OUR_SOURCES = [
  ...DF_SOURCES.map((s) => ({ path: s.path, label: s.label })),
  ...DF_DESTS.filter((d) => d.bidir).map((d) => ({ path: d.path, label: d.label }))
]

const ago = (ms: number): string => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

export function DataflouSection(): JSX.Element {
  const cfg = useStore((s) => s.dataflou)
  const setCfg = useStore((s) => s.setDataflou)
  const collapsed = useStore((s) => !!s.collapsed['dataflou'])
  const toggleSection = useStore((s) => s.toggleSection)
  const st = useDataflouStatus()
  const [name, setName] = useState(cfg.label)
  const [univ, setUniv] = useState(cfg.universe)
  const [open, setOpen] = useState<string | null>(null)
  const [shapeOf, setShapeOf] = useState<string | null>(null)
  useEffect(() => setName(cfg.label), [cfg.label])
  useEffect(() => setUniv(cfg.universe), [cfg.universe])

  // (our session node is ours : not one of the others)
  const others = st.nodes.filter((n) => !n.local && n.sku !== st.companion?.sku)
  const online = others.filter((n) => n.online).length
  const nameOf = (sku: string): string => (sku === st.sku ? st.label || 'palinopsia' : st.nodes.find((n) => n.sku === sku)?.label ?? sku.slice(0, 8))
  const connections = st.nodes.flatMap((n) =>
    Object.entries(n.subs).flatMap(([dest, list]) => list.map((s) => ({ node: n, dest, src: s })))
  )
  const state = !cfg.enabled ? 'off' : st.running ? 'on' : st.error ? 'error' : 'starting'
  const enterBlurs = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-border bg-panel px-3 py-1.5 text-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => toggleSection('dataflou')}
          className="flex shrink-0 items-center gap-1.5"
          title={collapsed ? 'Expand dataflou' : 'Collapse dataflou'}
        >
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">dataflou</span>
        </button>
        <button
          onClick={() => setCfg({ enabled: !cfg.enabled })}
          className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
            state === 'on'
              ? 'bg-accent/20 text-accent ring-1 ring-accent'
              : state === 'error'
                ? 'bg-danger/20 text-danger ring-1 ring-danger'
                : 'bg-panel2 text-muted hover:text-text'
          }`}
          title={cfg.enabled ? 'Leave the dataflou mesh' : 'Join the dataflou mesh : the nodes on this network see Palinopsia and can wire to it'}
        >
          {state === 'on' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
          {state === 'on' ? 'ON THE MESH' : state === 'error' ? 'FAILED' : state === 'starting' ? 'JOINING' : 'OFF'}
        </button>
        {st.running && (
          <span className="shrink-0 font-mono text-[9px] text-muted" title={`${online} of ${others.length} other nodes online`}>
            {online} {online === 1 ? 'node' : 'nodes'}
          </span>
        )}
        <div className="flex-1" />
        {st.running && (
          <span className="shrink-0 font-mono text-[9px] text-muted" title="values per second : received ↙ · sent ↗">
            ↙ {st.rxPerSec}/s ↗ {st.txPerSec}/s
          </span>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="font-mono text-[9px] uppercase text-muted">name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\s+/g, '-').slice(0, 32))}
              onBlur={() => setCfg({ label: name.trim() || 'palinopsia' })}
              onKeyDown={enterBlurs}
              className="input w-28 px-1 py-0.5 text-[11px]"
              title="How the other nodes see this Palinopsia"
            />
            <span className="font-mono text-[9px] uppercase text-muted">universe</span>
            <input
              value={univ}
              onChange={(e) => setUniv(e.target.value.slice(0, 32))}
              onBlur={() => setCfg({ universe: univ.trim() || 'default' })}
              onKeyDown={enterBlurs}
              className="input w-24 px-1 py-0.5 text-[11px]"
              title="Only nodes of the same universe see each other"
            />
            <button
              onClick={() => setCfg({ actions: !cfg.actions })}
              className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${cfg.actions ? 'border-accent/60 text-accent' : 'border-border text-muted hover:text-text'}`}
              title={
                'Every action of the Body rule list as a destination, a trigger each under act/ : it fires once as it goes on. ' +
                'The layers, Randomize, Generate, Macro, Feel, tempo and sound, Sonify, the transport and the output on this node; ' +
                'the scenes, Worlds, modulators, Body rules and the triggers of what is loaded (they follow the session) on a second node, ' +
                `${dfSessionLabel(cfg.label)}. On by default. Turn it off on a mesh that has a small board (Teensy, M5) : the trees then grow past what it takes.`
              }
            >
              actions : {cfg.actions ? 'on' : 'off'}
            </button>
            <button
              onClick={() =>
                void openDataflouVisualizer().then((r) => {
                  if (!r.ok) showToast(r.error ?? 'The visualizer could not open', 'warn')
                })
              }
              disabled={!st.running || !st.visualizerAvailable}
              className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] disabled:opacity-40 ${st.visualizer > 0 ? 'border-accent2/60 text-accent2' : 'border-border text-muted hover:text-text'}`}
              title={
                !st.visualizerAvailable
                  ? 'This build does not carry the mesh visualizer'
                  : st.running
                    ? 'The mesh visualizer in your browser : every node as a colored arc of its parameters, the wires between them, the values live. Drag a source onto a destination to wire them. Served by Palinopsia on this computer only.'
                    : 'Join the mesh first'
              }
            >
              visualizer ↗{st.visualizer > 0 ? ` (${st.visualizer})` : ''}
            </button>
          </div>
          <div className="font-mono text-[9px] leading-relaxed text-muted">
            {state === 'on' ? (
              <>
                on the mesh as <span className="text-accent">{st.label}</span> at{' '}
                <span className="text-text">{st.address}</span>:<span className="text-text">{st.tcpPort}</span> · publishes{' '}
                <span className="text-text">{DF_SOURCES.length}</span> sources and takes{' '}
                <span className="text-text">{DF_DESTS.length}</span> destinations (Macro knobs, layers, background, feel, scenes, randomize, output transform, BPM)
                {st.actions > 0 && (
                  <>
                    {' '}
                    + <span className="text-text">{st.actions}</span> actions from the Body rule list
                    {st.companion && (
                      <>
                        {' '}
                        (<span className="text-text">{st.actions - st.companion.actions}</span> here,{' '}
                        <span className="text-text">{st.companion.actions}</span> on <span className="text-accent">{st.companion.label}</span> : the scenes, Worlds,
                        modulators, Body rules and loaded triggers)
                      </>
                    )}
                  </>
                )}
                {st.actionsDropped > 0 && <span className="text-danger"> ({st.actionsDropped} left out : too many for one frame)</span>}
                {st.declareBytes > DF_DECLARE_SMALL && (
                  <span className="text-accent2">
                    {' '}
                    · {(st.declareBytes / 1024).toFixed(1)} KB : too big for a small board (Teensy, ESP32) on this universe
                  </span>
                )}
              </>
            ) : state === 'error' ? (
              <span className="text-danger">{st.error}</span>
            ) : (
              'join the mesh : the nodes on this network (same universe) see what Palinopsia senses and what plays it, and can wire to it'
            )}
          </div>

          {st.running && (
            <>
              {/* ── the network ── */}
              <div className="flex min-w-0 flex-col gap-0.5 rounded border border-accent/30 bg-panel2/40 p-1.5">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-wide text-accent">network</span>
                {others.length === 0 && (
                  <span className="font-mono text-[9px] text-muted">no other node yet on universe "{st.universe}"</span>
                )}
                {others.map((n) => (
                  <NodeRow key={n.sku} n={n} open={open === n.sku} onToggle={() => setOpen(open === n.sku ? null : n.sku)} ourSku={st.sku} />
                ))}
              </div>

              {/* ── what flows in and out, live ── */}
              <DataView running={st.running} />

              {/* ── the connections across the mesh ── */}
              <div className="flex min-w-0 flex-col gap-0.5 rounded border border-accent2/30 bg-panel2/40 p-1.5">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-wide text-accent2">
                  connections <span className="font-normal normal-case text-muted">({connections.length})</span>
                </span>
                {connections.length === 0 && (
                  <span className="font-mono text-[9px] text-muted">nothing wired yet : open a node above to wire it to Palinopsia</span>
                )}
                {connections.map(({ node, dest, src }) => {
                  const ours = node.local || node.sku === st.companion?.sku || src.sku === st.sku
                  const key = `${node.sku}/${dest}<${src.sku}/${src.path}`
                  // a wire into Palinopsia's main node : shaped here (⚙)
                  const shapeable = node.local && DF_DESTS.some((d) => d.path === dest)
                  const shaped = !!src.opt
                  return (
                    <div key={key} className="flex min-w-0 flex-col">
                    <div className="flex min-w-0 items-center gap-1 font-mono text-[9px]">
                      <span className={`min-w-0 truncate ${ours ? 'text-text' : 'text-muted'}`} title={`${nameOf(src.sku)}/${src.path} → ${node.label}/${dest}`}>
                        {nameOf(src.sku)}/{src.path} <span className="text-accent2">→</span> {node.local ? st.label : node.label}/{dest}
                      </span>
                      <div className="flex-1" />
                      {shapeable && (
                        <button
                          onClick={() => setShapeOf(shapeOf === key ? null : key)}
                          className={`shrink-0 rounded px-1 ${shapeOf === key ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2' : shaped ? 'text-accent2' : 'text-muted hover:text-text'}`}
                          title={`How this wire plays : the part of the range it covers, turned the other way, smoothed, and what happens when its source goes quiet${shaped ? ' (shaped)' : ''}`}
                        >
                          ⚙
                        </button>
                      )}
                      <button
                        onClick={() => void dataflouBind(node.sku, dest, src.sku, src.path, false)}
                        className="shrink-0 px-1 text-muted hover:text-danger"
                        title="Unwire"
                      >
                        ✕
                      </button>
                    </div>
                    {shapeOf === key && <WireShape dest={dest} src={src} />}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── the data view : what flows in and out, live ─────────────────────────────
// What a connected scenario needs to see : what comes INTO Palinopsia over a
// wire (in ↙), the outside values you chose to WATCH (◉, from the node list :
// wired or not), and what Palinopsia SENDS over a wire (out ↗); each with its
// value now, its last seconds as a line, where it comes from or goes, how many a
// second. Palinopsia's own values that other nodes merely monitor (a visualizer
// page asks for all of them) are not wires : one line says who, and how many.
// Asked of main ten times a second, only while it is open.
const HIST = 80
function numOf(v: DfValue | null): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (Array.isArray(v)) return v.length >= 3 ? (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255 : typeof v[0] === 'number' ? v[0] : null
  return null
}
function fmt(v: DfValue | null): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  if (typeof v === 'number') return Math.abs(v) >= 100 ? v.toFixed(0) : String(Math.round(v * 1000) / 1000)
  if (Array.isArray(v)) return v.length >= 3 ? `${v.slice(0, 3).join(' ')}` : v.join(' ')
  return `"${String(v).slice(0, 24)}"`
}
function Spark({ pts }: { pts: number[] }): JSX.Element {
  const W = 64, H = 14
  if (pts.length < 2) return <svg width={W} height={H} />
  let lo = Infinity, hi = -Infinity
  for (const p of pts) { if (p < lo) lo = p; if (p > hi) hi = p }
  const span = hi - lo || 1
  const d = pts.map((p, i) => `${((i / (HIST - 1)) * W).toFixed(1)},${(H - 1 - ((p - lo) / span) * (H - 2)).toFixed(1)}`).join(' ')
  return (
    <svg width={W} height={H} className="shrink-0">
      <polyline points={d} fill="none" stroke="rgb(var(--c-accent))" strokeWidth={1} />
    </svg>
  )
}
function DataView({ running }: { running: boolean }): JSX.Element {
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem('opsia.dfData') !== '0' } catch { return true } })
  const [io, setIo] = useState<DfIo[]>([])
  const hist = useRef(new Map<string, number[]>())
  useEffect(() => {
    try { localStorage.setItem('opsia.dfData', open ? '1' : '0') } catch { /* private */ }
    if (!open || !running) return
    let alive = true
    const tick = (): void => {
      void window.api.dataflouIo().then((list) => {
        if (!alive) return
        const keep = new Set<string>()
        for (const n of list) {
          for (const [dir, rows] of [['in', n.in], ['out', n.out], ['watch', n.watched ?? []]] as const) {
            for (const r of rows) {
              const k = `${n.sku}|${dir}|${r.path}|${r.peers.join(',')}`
              keep.add(k)
              const x = numOf(r.value)
              if (x === null) continue
              const h = hist.current.get(k) ?? []
              h.push(x)
              if (h.length > HIST) h.shift()
              hist.current.set(k, h)
            }
          }
        }
        for (const k of [...hist.current.keys()]) if (!keep.has(k)) hist.current.delete(k)
        setIo(list)
      }).catch(() => { /* main busy : the next one */ })
    }
    tick()
    const id = window.setInterval(tick, 100)
    return () => { alive = false; window.clearInterval(id) }
  }, [open, running])
  const total = io.reduce((n, x) => n + x.in.length + x.out.length + (x.watched?.length ?? 0), 0)
  const row = (sku: string, dir: 'in' | 'out' | 'watch', r: DfIoRow): JSX.Element => {
    const k = `${sku}|${dir}|${r.path}|${r.peers.join(',')}`
    const stale = !r.live || r.ageMs === null || r.ageMs > 2000
    const colour = Array.isArray(r.value) && r.value.length >= 3
    return (
      <div key={k} className={`flex min-w-0 items-center gap-1.5 font-mono text-[9px] ${stale ? 'text-muted' : 'text-text'}`}
        title={`${dir === 'in' ? `${r.peers.join(', ')} → ${r.path}` : `${r.path} → ${r.peers.join(', ')}`}${r.ageMs !== null ? ` · last ${(r.ageMs / 1000).toFixed(1)} s ago` : ' · nothing yet'}${r.live ? '' : ' · not connected'}`}>
        <span className={`w-3 shrink-0 ${dir === 'in' ? 'text-accent2' : dir === 'watch' ? 'text-text' : 'text-accent'}`}>{dir === 'in' ? '↙' : dir === 'watch' ? '◉' : '↗'}</span>
        <span className="w-28 shrink-0 truncate">{r.label}</span>
        {colour ? (
          <span className="h-3 w-16 shrink-0 rounded-sm border border-border" style={{ background: `rgb(${(r.value as number[]).slice(0, 3).join(',')})` }} />
        ) : (
          <Spark pts={hist.current.get(k) ?? []} />
        )}
        <span className="w-14 shrink-0 truncate text-right">{fmt(r.value)}</span>
        <span className="min-w-0 flex-1 truncate text-muted">{dir === 'in' ? 'from ' : dir === 'watch' ? '' : 'to '}{r.peers.join(', ')}</span>
        <span className="w-9 shrink-0 text-right text-muted">{r.perSec}/s</span>
        {dir === 'watch' && r.sku && (
          <button onClick={() => toggleDfWatch(r.sku!, r.path)} className="shrink-0 px-0.5 text-muted hover:text-danger" title="Stop watching this value">
            ✕
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded border border-border bg-panel2/40 p-1.5">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-left" title="What flows in and out of Palinopsia on the mesh, live">
        <span className={`font-mono text-[9px] text-muted transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-wide text-text">data</span>
        <span className="font-mono text-[9px] text-muted">in ↙ · watching ◉ · out ↗{open ? ` (${total})` : ''}</span>
      </button>
      {open && (
        <>
          {total === 0 && (
            <span className="font-mono text-[9px] text-muted">
              nothing flows yet : wire a source to Palinopsia (or Palinopsia to a destination), or open a node in the network above and watch one of its values (◉)
            </span>
          )}
          {/* in : what plays Palinopsia over a wire, from either of its nodes */}
          {io.some((n) => n.in.length) && <span className="mt-0.5 font-mono text-[8px] uppercase tracking-wide text-muted">into Palinopsia</span>}
          {io.flatMap((n) => n.in.map((r) => row(n.sku, 'in', r)))}
          {/* watched : outside values, wired or not */}
          {io.some((n) => n.watched?.length) && <span className="mt-0.5 font-mono text-[8px] uppercase tracking-wide text-muted">watching</span>}
          {io.flatMap((n) => (n.watched ?? []).map((r) => row(n.sku, 'watch', r)))}
          {/* out : Palinopsia's values wired to other nodes */}
          {io.some((n) => n.out.length) && <span className="mt-0.5 font-mono text-[8px] uppercase tracking-wide text-muted">from Palinopsia</span>}
          {io.flatMap((n) => n.out.map((r) => row(n.sku, 'out', r)))}
          {/* monitored, not wired : one line */}
          {io.some((n) => n.watchedBy?.length) && (
            <span className="mt-0.5 font-mono text-[9px] text-muted" title="A visualizer page (or a node watching) asks for every value of Palinopsia to show it : these are not wires, and they cost nothing on Palinopsia's side to speak of">
              monitored : {io.flatMap((n) => n.watchedBy ?? []).map((w) => `${w.count} values by ${w.label}`).join(' · ')}
            </span>
          )}
        </>
      )}
    </div>
  )
}

/** A wire into Palinopsia, shaped : the part of the destination's range it covers,
 *  turned the other way, smoothed, and on loss hold or glide back. */
function WireShape({ dest, src }: { dest: string; src: DfSub }): JSX.Element {
  const d = DF_DESTS.find((x) => x.path === dest)
  const o: DfWireOpt = src.opt ?? {}
  const num = d?.type === 'number'
  // a scene number is never smoothed nor glided back (each step would recall one)
  const glides = num && !d?.discrete
  const set = (p: Partial<DfWireOpt>): void => {
    const next = { ...o, ...p }
    void window.api.dataflouWireOpt({ dest, sku: src.sku, path: src.path, opt: next })
  }
  const box = 'input w-11 px-0.5 py-0 text-center text-[9px]'
  const chip = (on: boolean): string => `rounded px-1 ${on ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2' : 'bg-panel3/60 text-muted hover:text-text'}`
  return (
    <div className="ml-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-l border-accent2/40 py-0.5 pl-2 font-mono text-[9px] text-muted">
      {num && (
        <span className="flex items-center gap-1" title="The part of the destination's range this wire covers (0 to 1) : the source's whole sweep lands between these">
          range
          <BoundedNumberInput fixedWidth className={box} value={o.lo ?? 0} min={0} max={1} maxFrac={2} onCommit={(v) => set({ lo: v })} />
          to
          <BoundedNumberInput fixedWidth className={box} value={o.hi ?? 1} min={0} max={1} maxFrac={2} onCommit={(v) => set({ hi: v })} />
        </span>
      )}
      <button onClick={() => set({ invert: !o.invert })} className={chip(!!o.invert)} title="Turned the other way : the source's low end plays the high end">
        invert
      </button>
      {glides && (
        <span className="flex items-center gap-1" title="Smoothing : the control glides to each new value over about this long (ms; 0 : at once). For a jittery sensor. Shared by every wire into this control : the longest counts">
          smooth
          <BoundedNumberInput fixedWidth integer className={box} value={o.slewMs ?? 0} min={0} max={10000} onCommit={(v) => set({ slewMs: v })} />
          ms
        </span>
      )}
      {glides && (
        <span className="flex items-center gap-1" title="When the source goes quiet for 2 s (a glove out of battery, a computer asleep) : hold its last value, or glide back to where the control was before the wire played it. Shared by every wire into this control : one asking to glide back is enough">
          on loss
          <button onClick={() => set({ onLoss: o.onLoss === 'return' ? 'hold' : 'return', returnSec: o.returnSec ?? 2 })} className={chip(o.onLoss === 'return')}>
            {o.onLoss === 'return' ? 'glide back' : 'hold'}
          </button>
          {o.onLoss === 'return' && (
            <>
              over
              <BoundedNumberInput fixedWidth className={box} value={o.returnSec ?? 2} min={0.1} max={60} maxFrac={1} onCommit={(v) => set({ returnSec: v })} />
              s
            </>
          )}
        </span>
      )}
      {src.opt && (
        <button onClick={() => void window.api.dataflouWireOpt({ dest, sku: src.sku, path: src.path, opt: null })} className="px-0.5 text-muted hover:text-danger" title="Back to a plain wire">
          reset
        </button>
      )}
    </div>
  )
}

function NodeRow({ n, open, onToggle, ourSku }: { n: DfNodeView; open: boolean; onToggle: () => void; ourSku: string }): JSX.Element {
  const params = n.params.filter((p) => p.kind === 'param')
  const sources = params.filter((p) => p.flow !== 'destination')
  const dests = params.filter((p) => p.flow !== 'source')
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-1.5 font-mono text-[9px]">
        <button onClick={onToggle} className="flex min-w-0 items-center gap-1.5 text-left" title={open ? 'Close' : 'Open : its parameters, to wire them'}>
          <span className={`text-muted transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${n.online ? 'bg-accent' : 'bg-muted/40'}`} />
          <span className={`truncate ${n.online ? 'text-text' : 'text-muted'}`}>{n.label}</span>
          <span className="truncate text-muted">{n.product}</span>
        </button>
        <div className="flex-1" />
        <span className="shrink-0 text-muted" title={`${sources.length} sources · ${dests.length} destinations`}>
          ↗{sources.length} ↙{dests.length}
        </span>
        <span className="shrink-0 text-muted" title={n.connected ? 'connected directly' : n.online ? 'known through another node' : 'offline : remembered until forgotten'}>
          {n.online ? (n.address || (n.connected ? 'linked' : 'via mesh')) : `offline ${ago(n.lastSeenMs)}`}
        </span>
        {!n.online && (
          <button onClick={() => void window.api.dataflouForget(n.sku)} className="shrink-0 px-1 text-muted hover:text-danger" title="Forget this node (on every node of the mesh)">
            forget
          </button>
        )}
      </div>
      {open && (
        <div className="ml-3 mt-0.5 flex max-h-56 min-w-0 flex-col gap-0.5 overflow-y-auto border-l border-border pl-2">
          {params.length === 0 && <span className="font-mono text-[9px] text-muted">no parameters declared</span>}
          {params.map((p) => (
            <ParamRow key={p.path} p={p} n={n} ourSku={ourSku} />
          ))}
        </div>
      )}
    </div>
  )
}

function ParamRow({ p, n, ourSku }: { p: DfParam; n: DfNodeView; ourSku: string }): JSX.Element {
  const watching = useDfWatches().some((w) => w.sku === n.sku && w.path === p.path)
  // dataflou casts between bool, numbers, vectors and colors, never into a string
  const castable = p.type !== 'string' && p.type !== 'blob'
  const isSource = p.flow !== 'destination' && castable
  const isDest = p.flow !== 'source' && castable
  const segs = p.path.split('/')
  const group = segs.length > 1 ? segs[segs.length - 2] : ''
  const range = p.type === 'number' ? `${+p.min.toFixed(3)}..${+p.max.toFixed(3)}${p.unit ? ` ${p.unit}` : ''}` : p.type
  const select = 'min-w-0 max-w-[118px] shrink rounded bg-panel2 px-1 py-0 font-mono text-[9px] text-muted hover:text-text'
  return (
    <div className="flex min-w-0 items-center gap-1 font-mono text-[9px]" title={`${p.path} · ${p.flow} · ${range}${p.desc ? ` · ${p.desc}` : ''}`}>
      <span className={`shrink-0 ${p.flow === 'source' ? 'text-accent2' : p.flow === 'destination' ? 'text-accent' : 'text-text'}`}>
        {p.flow === 'source' ? '↗' : p.flow === 'destination' ? '↙' : '↕'}
      </span>
      <span className="min-w-0 truncate text-text">
        {group && <span className="text-muted">{group} · </span>}
        {p.label || segs[segs.length - 1]}
      </span>
      <span className="shrink-0 text-muted">{range}</span>
      <div className="flex-1" />
      <button
        onClick={() => toggleDfWatch(n.sku, p.path)}
        className={`shrink-0 rounded px-1 ${watching ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'text-muted hover:text-text'}`}
        title={watching ? 'Watched in the data view : click to stop' : 'Watch this value in the data view, live (wired or not)'}
      >
        ◉
      </button>
      {isSource && (
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value
            const src = { sku: n.sku, path: p.path, label: p.label }
            if (v === '__macro__') void wireToFreeMacro(src)
            else if (v === '__mod__') meshToModulator(src)
            else if (v) void dataflouBind(ourSku, v, n.sku, p.path, true)
          }}
          className={select}
          title="Wire this to Palinopsia : a free Macro knob (then give it any controls, with its range and curve), a free modulator (then bind it to any control with its M), or one of Palinopsia's destinations"
        >
          <option value="">→ Palinopsia…</option>
          <option value="__macro__">◈ a free Macro knob</option>
          <option value="__mod__">◈ a free modulator</option>
          <optgroup label="a destination">
            {DF_DESTS.map((d) => (
              <option key={d.path} value={d.path}>
                {d.label}
              </option>
            ))}
          </optgroup>
        </select>
      )}
      {isDest && (
        <select
          value=""
          onChange={(e) => e.target.value && void dataflouBind(n.sku, p.path, ourSku, e.target.value, true)}
          className={select}
          title="Feed this from one of Palinopsia's sources"
        >
          <option value="">← Palinopsia…</option>
          {OUR_SOURCES.map((s) => (
            <option key={s.path} value={s.path}>
              {s.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
