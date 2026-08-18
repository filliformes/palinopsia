// SearchSelect : a native <select> replacement whose first element is a search
// field. Click it, type, hit Enter.
//
// The long pickers in this app — 51 FX + 15 nodes, 32 generators, 76 Generate
// themes — are exactly the lists a native <select> handles worst: its type-ahead
// only matches from the first letter. Here the query filters, and it matches the
// entry's GROUP too, so "glitch" surfaces a whole family, while a subsequence
// match means "atct" still finds Autocutter.
//
// Grouping survives filtering rather than collapsing into a flat ranked list :
// which family an effect belongs to is half of what you read when browsing this
// vocabulary. Within a group the best matches rise, and groups are ordered by
// their best match, so the top row is always the strongest hit while the shape
// of the menu stays recognisable.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export interface SearchOption {
  value: string
  label: string
  /** Optional group heading; also searched, so a family name finds its members. */
  group?: string
  title?: string
  /** Rendered before the label (the source picker's glyphs). */
  prefix?: string
}

/** Match `q` against one option. Lower is better; null = no match.
 *  0 prefix - 1 word-start - 2 substring - 3 group hit - 4 subsequence. */
function score(opt: SearchOption, q: string): number | null {
  if (!q) return 0
  const label = opt.label.toLowerCase()
  const group = (opt.group ?? '').toLowerCase()
  if (label.startsWith(q)) return 0
  if (label.split(/[\s\-/()]+/).some((w) => w.startsWith(q))) return 1
  if (label.includes(q)) return 2
  if (group.includes(q)) return 3
  // Subsequence : the query's letters appear in order.
  let i = 0
  for (const ch of label) if (ch === q[i]) i++
  return i === q.length ? 4 : null
}

export function SearchSelect({
  value,
  options,
  onChange,
  placeholder = 'select…',
  className = '',
  title,
  resetAfterPick = false,
  menuWidth = 232
}: {
  value: string
  options: SearchOption[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  title?: string
  /** Action pickers ("+ fx") always show the placeholder, never the last pick. */
  resetAfterPick?: boolean
  menuWidth?: number
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const [rect, setRect] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const query = q.trim().toLowerCase()
  const groups = useMemo(() => {
    const scored = options
      .map((o, i) => ({ o, i, s: score(o, query) }))
      .filter((x): x is { o: SearchOption; i: number; s: number } => x.s !== null)
    const byGroup = new Map<string, { o: SearchOption; i: number; s: number }[]>()
    for (const x of scored) {
      const g = x.o.group ?? ''
      const arr = byGroup.get(g)
      if (arr) arr.push(x)
      else byGroup.set(g, [x])
    }
    return [...byGroup.entries()]
      .map(([g, items]) => ({
        group: g,
        best: Math.min(...items.map((x) => x.s)),
        items: items.sort((a, b) => a.s - b.s || a.i - b.i)
      }))
      .sort((a, b) => a.best - b.best)
  }, [options, query])

  const flat = useMemo(() => groups.flatMap((g) => g.items.map((x) => x.o)), [groups])

  useEffect(() => setCursor(0), [query])

  // Anchor in VIEWPORT space : the racks live inside scrollable, clipping
  // columns where an absolutely-positioned menu gets cut off.
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const b = btnRef.current?.getBoundingClientRect()
      if (!b) return
      const room = window.innerHeight - b.bottom
      setRect({
        left: Math.max(4, Math.min(b.left, window.innerWidth - menuWidth - 4)),
        top: room > 260 ? b.bottom + 2 : b.top - 2,
        below: room > 260
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, menuWidth])

  useEffect(() => {
    if (!open) return
    const down = (e: globalThis.MouseEvent): void => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    window.addEventListener('mousedown', down)
    return () => window.removeEventListener('mousedown', down)
  }, [open])

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-cursor="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, cursor])

  const pick = (v: string): void => {
    onChange(v)
    setOpen(false)
    setQ('')
  }

  const current = options.find((o) => o.value === value)
  const shown = resetAfterPick
    ? placeholder
    : current
      ? `${current.prefix ?? ''}${current.label}`
      : placeholder

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        onClick={(e) => {
          e.stopPropagation()
          setQ('')
          setOpen((o) => !o)
        }}
        className={`input select-compact truncate text-left ${className}`}
      >
        {shown}
      </button>
      {open && rect && (
        <div
          ref={popRef}
          style={{
            left: rect.left,
            ...(rect.below ? { top: rect.top } : { bottom: window.innerHeight - rect.top }),
            width: menuWidth
          }}
          className="fixed z-50 flex max-h-[17rem] flex-col overflow-hidden rounded border border-border bg-panel2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search…"
            spellCheck={false}
            className="input m-1 shrink-0 px-2 py-1 text-[11px]"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, flat.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (flat[cursor]) pick(flat[cursor].value)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation() // don't also close the page behind us
                setOpen(false)
              }
            }}
          />
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-1">
            {flat.length === 0 && <div className="px-3 py-2 text-[11px] text-muted">no match</div>}
            {groups.map((g) => (
              <div key={g.group || '_'}>
                {g.group && (
                  <div className="px-2 pb-0.5 pt-1 font-mono text-[9px] uppercase tracking-wide text-muted">
                    {g.group}
                  </div>
                )}
                {g.items.map(({ o }) => {
                  const idx = flat.indexOf(o)
                  return (
                    <button
                      key={o.value}
                      type="button"
                      data-cursor={idx === cursor ? '1' : '0'}
                      title={o.title}
                      onMouseEnter={() => setCursor(idx)}
                      onClick={() => pick(o.value)}
                      className={`block w-full truncate px-3 py-0.5 text-left text-[11px] transition-colors ${
                        idx === cursor ? 'bg-accent/15 text-accent' : 'hover:text-accent'
                      } ${o.value === value && !resetAfterPick ? 'text-accent' : ''}`}
                    >
                      {o.prefix}
                      {o.label}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
