// dataflou section of the audio/midi/osc tab : Palinopsia as a node of the
// dataflou mesh. The ON pill joins or leaves it; the name and universe are the
// only settings (only nodes of the same universe see each other). Below, the
// monitor : every node on the network (online or remembered), the connections
// wired between them, and, opening a node, its parameters with a picker to wire
// one to Palinopsia (or Palinopsia to it). The node runs in main
// (src/main/dataflou); the value bridge is ../dataflou.ts.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { dataflouBind, useDataflouStatus } from '../dataflou'
import { DF_DESTS, DF_SOURCES, type DfNodeView, type DfParam } from '@shared/dataflou'

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
  useEffect(() => setName(cfg.label), [cfg.label])
  useEffect(() => setUniv(cfg.universe), [cfg.universe])

  const others = st.nodes.filter((n) => !n.local)
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
          <div className="flex min-w-0 items-center gap-1.5">
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
          </div>
          <div className="font-mono text-[9px] leading-relaxed text-muted">
            {state === 'on' ? (
              <>
                on the mesh as <span className="text-accent">{st.label}</span> at{' '}
                <span className="text-text">{st.address}</span>:<span className="text-text">{st.tcpPort}</span> · publishes{' '}
                <span className="text-text">{DF_SOURCES.length}</span> sources and takes{' '}
                <span className="text-text">{DF_DESTS.length}</span> destinations (Meta knobs, layers, feel, scenes, BPM)
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

              {/* ── the connections across the mesh ── */}
              <div className="flex min-w-0 flex-col gap-0.5 rounded border border-accent2/30 bg-panel2/40 p-1.5">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-wide text-accent2">
                  connections <span className="font-normal normal-case text-muted">({connections.length})</span>
                </span>
                {connections.length === 0 && (
                  <span className="font-mono text-[9px] text-muted">nothing wired yet : open a node above to wire it to Palinopsia</span>
                )}
                {connections.map(({ node, dest, src }) => {
                  const ours = node.local || src.sku === st.sku
                  return (
                    <div key={`${node.sku}/${dest}<${src.sku}/${src.path}`} className="flex min-w-0 items-center gap-1 font-mono text-[9px]">
                      <span className={`min-w-0 truncate ${ours ? 'text-text' : 'text-muted'}`} title={`${nameOf(src.sku)}/${src.path} → ${node.label}/${dest}`}>
                        {nameOf(src.sku)}/{src.path} <span className="text-accent2">→</span> {node.local ? st.label : node.label}/{dest}
                      </span>
                      <div className="flex-1" />
                      <button
                        onClick={() => void dataflouBind(node.sku, dest, src.sku, src.path, false)}
                        className="shrink-0 px-1 text-muted hover:text-danger"
                        title="Unwire"
                      >
                        ✕
                      </button>
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
      {isSource && (
        <select
          value=""
          onChange={(e) => e.target.value && void dataflouBind(ourSku, e.target.value, n.sku, p.path, true)}
          className={select}
          title="Wire this to one of Palinopsia's destinations"
        >
          <option value="">→ Palinopsia…</option>
          {DF_DESTS.map((d) => (
            <option key={d.path} value={d.path}>
              {d.label}
            </option>
          ))}
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
