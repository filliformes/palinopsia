// What Palinopsia shows the dataflou mesh : ONE node, carrying only what is
// ticked here. Each group (Macro knobs, Layers, Feel… and each heading of the
// Body rule list's actions) is ticked whole (it then follows the group : a new
// scene's action appears by itself) or opened to tick single parameters. The
// gauge is the node's one DECLARE frame : past 32 KB the last actions are left out.

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { dataflouActions, useDataflouStatus } from '../dataflou'
import { DF_DECLARE_MAX, DF_DECLARE_SMALL, DF_PUBLISH_GROUPS, dfGroupOf } from '@shared/dataflou'

interface Group {
  key: string
  label: string
  items: Array<{ path: string; label: string; source: boolean }>
}

/** Every group the section offers : the fixed ones, then the actions' headings. */
function useGroups(open: boolean): Group[] {
  // the actions follow the session (scenes, rules, what is loaded) : re-read
  // while the list is open
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!open) return
    const t = window.setInterval(() => setTick((n) => n + 1), 2000)
    return () => window.clearInterval(t)
  }, [open])
  return useMemo(() => {
    const acts = new Map<string, Group>()
    for (const a of dataflouActions()) {
      const key = dfGroupOf(a.path, a.group)
      if (!acts.has(key)) acts.set(key, { key, label: `Actions : ${a.group}`, items: [] })
      acts.get(key)!.items.push({ path: a.path, label: a.label, source: false })
    }
    return [...DF_PUBLISH_GROUPS, ...acts.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, open])
}

export function DataflouPublish(): JSX.Element {
  const publish = useStore((s) => s.dataflou.publish)
  const setCfg = useStore((s) => s.setDataflou)
  const st = useDataflouStatus()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const groups = useGroups(open)
  const pub = useMemo(() => new Set(publish), [publish])

  const write = (next: Set<string>): void => setCfg({ publish: [...next] })
  const isOn = (g: Group, path: string): boolean => pub.has(`g:${g.key}`) || pub.has(`p:${path}`)
  const countOn = (g: Group): number => (pub.has(`g:${g.key}`) ? g.items.length : g.items.filter((i) => pub.has(`p:${i.path}`)).length)

  const toggleGroup = (g: Group): void => {
    const next = new Set(pub)
    const all = pub.has(`g:${g.key}`)
    for (const i of g.items) next.delete(`p:${i.path}`)
    if (all) next.delete(`g:${g.key}`)
    else next.add(`g:${g.key}`)
    write(next)
  }
  const toggleItem = (g: Group, path: string): void => {
    const next = new Set(pub)
    if (next.has(`g:${g.key}`)) {
      // the whole group was on : every other one stays, one by one
      next.delete(`g:${g.key}`)
      for (const i of g.items) if (i.path !== path) next.add(`p:${i.path}`)
    } else if (next.has(`p:${path}`)) next.delete(`p:${path}`)
    else next.add(`p:${path}`)
    // every one of them ticked : the whole group (it then follows the group)
    if (!next.has(`g:${g.key}`) && g.items.length > 0 && g.items.every((i) => next.has(`p:${i.path}`))) {
      for (const i of g.items) next.delete(`p:${i.path}`)
      next.add(`g:${g.key}`)
    }
    write(next)
  }

  const total = groups.reduce((n, g) => n + countOn(g), 0)
  const fill = Math.min(1, st.declareBytes / DF_DECLARE_MAX)

  return (
    <div className="flex min-w-0 flex-col gap-1 rounded border border-border bg-panel2/40 p-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          onClick={() => setOpen(!open)}
          className="flex shrink-0 items-center gap-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-text"
          title="Choose what this node shows the mesh : the others can wire only to what is published here"
        >
          <span className={`text-muted transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          publish
          <span className="font-normal normal-case text-muted">({total})</span>
        </button>
        {/* the node's one frame : how full */}
        <div
          className="relative h-1.5 min-w-[40px] flex-1 overflow-hidden rounded-full bg-panel3"
          title={
            st.running
              ? `The node's declaration : ${(st.declareBytes / 1024).toFixed(1)} KB of ${(DF_DECLARE_MAX / 1024).toFixed(1)} KB (one frame). ` +
                `A small board (Teensy, ESP32) takes about ${(DF_DECLARE_SMALL / 1024).toFixed(0)} KB.`
              : 'Join the mesh to measure the declaration'
          }
        >
          <div
            className={`absolute inset-y-0 left-0 ${st.actionsDropped > 0 ? 'bg-danger' : st.declareBytes > DF_DECLARE_SMALL ? 'bg-accent2' : 'bg-accent'}`}
            style={{ width: `${(st.running ? fill : 0) * 100}%` }}
          />
        </div>
        {st.running && (
          <span className="shrink-0 font-mono text-[9px] text-muted">
            {(st.declareBytes / 1024).toFixed(1)}/{(DF_DECLARE_MAX / 1024).toFixed(1)} KB
          </span>
        )}
      </div>
      {st.running && st.actionsDropped > 0 && (
        <span className="font-mono text-[9px] text-danger">
          {st.actionsDropped} published actions left out : one frame holds no more. Untick a group to make room.
        </span>
      )}
      {open && (
        <div className="flex min-w-0 flex-col">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <button
              onClick={() => write(new Set(['g:meta']))}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-text"
              title="Publish the 16 Macro knobs only (the default)"
            >
              Macros only
            </button>
            <button
              onClick={() => write(new Set(DF_PUBLISH_GROUPS.map((g) => `g:${g.key}`)))}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-text"
              title="Every parameter and source, without the actions"
            >
              all but actions
            </button>
            <button
              onClick={() => write(new Set())}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-text"
              title="Publish nothing : the node stays on the mesh, seen but with nothing to wire"
            >
              none
            </button>
          </div>
          {groups.map((g) => {
            const n = countOn(g)
            const state = n === 0 ? 'none' : n === g.items.length ? 'all' : 'some'
            return (
              <div key={g.key} className="flex min-w-0 flex-col">
                <div className="flex min-w-0 items-center gap-1 font-mono text-[9px]">
                  <button
                    onClick={() => toggleGroup(g)}
                    className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border text-[8px] leading-none ${
                      state === 'none' ? 'border-border text-transparent' : 'border-accent bg-accent/20 text-accent'
                    }`}
                    title={state === 'all' ? `Unpublish ${g.label}` : `Publish all of ${g.label} (and what it gains later)`}
                    aria-label={`${g.label} : ${state}`}
                  >
                    {state === 'all' ? '✓' : state === 'some' ? '–' : ''}
                  </button>
                  <button
                    onClick={() => setExpanded(expanded === g.key ? null : g.key)}
                    className={`min-w-0 flex-1 truncate text-left ${state === 'none' ? 'text-muted' : 'text-text'} hover:text-accent`}
                    title="Choose its parameters one by one"
                  >
                    {g.label}
                  </button>
                  <span className="shrink-0 text-muted">
                    {n}/{g.items.length}
                  </span>
                </div>
                {expanded === g.key && (
                  <div className="ml-4 flex min-w-0 flex-col">
                    {g.items.map((i) => (
                      <label key={i.path} className="flex min-w-0 cursor-pointer items-center gap-1 font-mono text-[9px]">
                        <input type="checkbox" checked={isOn(g, i.path)} onChange={() => toggleItem(g, i.path)} className="h-2.5 w-2.5 shrink-0 accent-accent" />
                        <span className={`min-w-0 truncate ${isOn(g, i.path) ? 'text-text' : 'text-muted'}`} title={i.path}>
                          {i.label}
                        </span>
                        {i.source && <span className="shrink-0 text-accent2" title="Also a source : the mesh can read it">↗</span>}
                      </label>
                    ))}
                    {g.items.length === 0 && <span className="font-mono text-[9px] text-muted">nothing in it now</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
