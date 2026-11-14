// The OSC section's map : every address Palinopsia answers to, in one table.
//   aliases   a controller's own address played onto an /opsia address, with its
//             input range, output range, curve and invert (editable; this computer)
//   learned   what OSC Learn learned (MIDI Learn, then move the control) : the
//             address, its target, its input range (editable) and where it is kept
//   /opsia    the built-in addresses (read-only : the ones OSCQuery advertises),
//             with their range, shown once a filter is typed
// A filter box searches all three. "map…" in the connections view opens it with an
// alias ready for the address it shows.

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { oscLeafList } from '../oscInput'
import { midiTargetLabel } from '../midi'
import { cleanAlias } from '../oscAliases'
import type { MappingScope, OscAlias, OscBinding } from '@shared/types'

const num = (s: string, d: number): number => {
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : d
}

function NumBox({ value, onCommit, w = 38, title }: { value: number; onCommit: (v: number) => void; w?: number; title: string }): JSX.Element {
  const [s, setS] = useState(String(value))
  useEffect(() => setS(String(value)), [value])
  return (
    <input
      value={s}
      onChange={(e) => setS(e.target.value)}
      onBlur={() => onCommit(num(s, value))}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="input px-0.5 py-0 text-right text-[10px] tabular-nums"
      style={{ width: w }}
      title={title}
    />
  )
}

export function OscMapTable({ prefill, onPrefillUsed }: { prefill?: string | null; onPrefillUsed?: () => void }): JSX.Element {
  const aliases = useStore((s) => s.oscAliases)
  const setAliases = useStore((s) => s.setOscAliases)
  const oscMap = useStore((s) => s.oscMap)
  const sessionOscMap = useStore((s) => s.sessionOscMap)
  const setOscBinding = useStore((s) => s.setOscBinding)
  const [filter, setFilter] = useState('')
  const [show, setShow] = useState<{ aliases: boolean; learned: boolean; opsia: boolean }>({ aliases: true, learned: true, opsia: true })
  const leaves = useMemo(() => oscLeafList(), [])
  const f = filter.trim().toLowerCase()
  const hit = (...xs: string[]): boolean => !f || xs.some((x) => x.toLowerCase().includes(f))

  // "map…" from the connections view : a new alias for that address
  useEffect(() => {
    if (!prefill) return
    const a = cleanAlias({ address: prefill, target: '/opsia/meta/1', inMin: 0, inMax: 1, outMin: 0, outMax: 1 })
    if (a && !aliases.some((x) => x.address === prefill)) setAliases([...aliases, a])
    setFilter(prefill)
    onPrefillUsed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  const updAlias = (id: string, patch: Partial<OscAlias>): void => {
    setAliases(aliases.map((a) => (a.id === id ? cleanAlias({ ...a, ...patch }) ?? a : a)))
  }
  const learned: Array<{ id: string; b: OscBinding; scope: MappingScope }> = [
    ...Object.entries(sessionOscMap).map(([id, b]) => ({ id, b, scope: 'session' as const })),
    ...Object.entries(oscMap).map(([id, b]) => ({ id, b, scope: 'computer' as const }))
  ]
  const chip = (on: boolean): string =>
    `rounded px-1.5 py-0.5 font-mono text-[9px] ${on ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'}`

  return (
    <div className="flex min-w-0 flex-col gap-1 rounded border border-border bg-panel2/40 p-1.5">
      <datalist id="opsia-osc-leaves">
        {leaves.map((l) => (
          <option key={l.path} value={l.path}>
            {l.desc}
          </option>
        ))}
      </datalist>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter : an address or a control"
          className="input min-w-[120px] flex-1 px-1 py-0.5 text-[10px]"
        />
        <button onClick={() => setShow({ ...show, aliases: !show.aliases })} className={chip(show.aliases)} title="Controller addresses mapped onto /opsia ones">
          aliases {aliases.length}
        </button>
        <button onClick={() => setShow({ ...show, learned: !show.learned })} className={chip(show.learned)} title="What OSC Learn learned">
          learned {learned.length}
        </button>
        <button onClick={() => setShow({ ...show, opsia: !show.opsia })} className={chip(show.opsia)} title="Palinopsia's own addresses (read-only)">
          /opsia {leaves.length}
        </button>
      </div>

      {show.aliases && (
        <div className="flex min-w-0 flex-col gap-1">
          {aliases
            .filter((a) => hit(a.address, a.target))
            .map((a) => (
              <div key={a.id} className="flex min-w-0 flex-col gap-0.5 border-l-2 border-accent/40 pl-1">
                <div className="flex min-w-0 items-center gap-1 font-mono text-[9px]">
                  <button
                    onClick={() => updAlias(a.id, { on: !a.on })}
                    className={`shrink-0 rounded px-1 ${a.on ? 'bg-accent/20 text-accent' : 'bg-panel3 text-muted'}`}
                    title={a.on ? 'On : click to stop it' : 'Off : click to play it'}
                  >
                    ALIAS
                  </button>
                  <AddrBox value={a.address} onCommit={(v) => updAlias(a.id, { address: v })} title="The controller's address (not /opsia)" />
                  <span className="shrink-0 text-muted">→</span>
                  <AddrBox value={a.target} list="opsia-osc-leaves" onCommit={(v) => updAlias(a.id, { target: v })} title="The /opsia address it plays (type to search)" />
                  <button onClick={() => setAliases(aliases.filter((x) => x.id !== a.id))} className="shrink-0 px-0.5 text-muted hover:text-danger" title="Remove this alias">
                    ✕
                  </button>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[9px] text-muted">
                  arg <NumBox value={a.arg} w={30} onCommit={(v) => updAlias(a.id, { arg: v })} title="Which argument of the message (0 = the first)" />
                  in <NumBox value={a.inMin} onCommit={(v) => updAlias(a.id, { inMin: v })} title="The controller's lowest value" />
                  <NumBox value={a.inMax} onCommit={(v) => updAlias(a.id, { inMax: v })} title="The controller's highest value" />
                  out <NumBox value={a.outMin} onCommit={(v) => updAlias(a.id, { outMin: v })} title="The value it sends at its lowest (0..1 for most controls)" />
                  <NumBox value={a.outMax} onCommit={(v) => updAlias(a.id, { outMax: v })} title="The value it sends at its highest" />
                  curve <NumBox value={a.curve} w={30} onCommit={(v) => updAlias(a.id, { curve: v })} title="1 linear · under 1 rises fast then slows · over 1 starts slow" />
                  <button onClick={() => updAlias(a.id, { invert: !a.invert })} className={`rounded px-1 ${a.invert ? 'bg-accent/20 text-accent' : 'bg-panel3 text-muted'}`} title="Turn it the other way">
                    inv
                  </button>
                </div>
              </div>
            ))}
          <button
            onClick={() => {
              const a = cleanAlias({ address: '/1/fader1', target: '/opsia/meta/1' })
              if (a) setAliases([...aliases, a])
            }}
            className="self-start rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-text"
            title="Map a controller's address onto a Palinopsia address (or use map… in the connections view)"
          >
            + alias
          </button>
        </div>
      )}

      {show.learned &&
        learned
          .filter(({ id, b }) => hit(b.address, midiTargetLabel(id)))
          .map(({ id, b, scope }) => (
            <div key={`${scope}|${id}`} className="flex min-w-0 items-center gap-1 border-l-2 border-accent2/40 pl-1 font-mono text-[9px]">
              <span className="shrink-0 rounded bg-accent2/15 px-1 text-accent2" title={`Learned with OSC Learn, kept on ${scope === 'session' ? 'this session' : 'this computer'}`}>
                {scope === 'session' ? 'SESSION' : 'LEARNED'}
              </span>
              <span className="min-w-0 truncate text-text" title={`${b.address}${b.host ? ` from ${b.host}` : ''}`}>
                {b.address}
                {b.arg ? ` [${b.arg}]` : ''}
              </span>
              <span className="shrink-0 text-muted">→</span>
              <span className="min-w-0 flex-1 truncate text-text" title={id}>
                {midiTargetLabel(id)}
              </span>
              {!b.bool && (
                <>
                  <NumBox value={b.min} onCommit={(v) => setOscBinding(id, { ...b, min: v }, scope)} title="The controller's lowest value (learned; edit to correct it)" />
                  <NumBox value={b.max} onCommit={(v) => setOscBinding(id, { ...b, max: v }, scope)} title="The controller's highest value" />
                </>
              )}
              <button onClick={() => setOscBinding(id, null, scope)} className="shrink-0 px-0.5 text-muted hover:text-danger" title="Forget this mapping">
                ✕
              </button>
            </div>
          ))}

      {show.opsia && (
        <div className="flex min-w-0 flex-col">
          {!f ? (
            <span className="font-mono text-[9px] text-muted">
              {leaves.length} built-in addresses (OSCQuery lists them too, on the OSC port + 1) : type above to find one
            </span>
          ) : (
            leaves
              .filter((l) => hit(l.path, l.desc))
              .slice(0, 200)
              .map((l) => (
                <div key={l.path} className="flex min-w-0 items-center gap-1 font-mono text-[9px]" title={l.desc}>
                  <span className="min-w-0 truncate text-text">{l.path}</span>
                  {l.int && <span className="shrink-0 text-accent2">int</span>}
                  <div className="flex-1" />
                  <span className="min-w-0 max-w-[50%] truncate text-muted">{l.desc}</span>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  )
}

function AddrBox({ value, onCommit, title, list }: { value: string; onCommit: (v: string) => void; title: string; list?: string }): JSX.Element {
  const [s, setS] = useState(value)
  useEffect(() => setS(value), [value])
  return (
    <input
      value={s}
      list={list}
      onChange={(e) => setS(e.target.value.trim())}
      onBlur={() => (s === value ? undefined : onCommit(s))}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="input min-w-0 flex-1 px-1 py-0 text-[10px]"
      title={title}
    />
  )
}
