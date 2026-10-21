// Search everything : Ctrl/Cmd+K opens a palette over the app, a search field
// on top and the results under it, grouped by kind : sources, effects,
// parameters (every control of what is loaded), presets, master chains,
// Generate themes, pages and commands. Keyboard first (arrows, Enter, Esc),
// the mouse too. Empty, it shows your recent picks.
//
// What is found and what a pick does lives in searchIndex.ts; the matching is
// the app's own (SearchSelect's score : prefix, word, keywords, group,
// subsequence), plus several words at once ("mosh l2"). Each pick is one undo
// step, like the hand action it stands for.
//
// It opens in the window that has the keyboard (the Output page's own window
// hands its keys to the instrument : the palette still opens there), through
// that window's menu host, so nothing clips it and the UI zoom applies. Closed,
// it renders nothing and listens to nothing.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { commitNow } from '../undo'
import { buildSearchIndex, KIND_LABEL, rankSearch, targetsSummary, type SearchRow, type SearchKind } from '../searchIndex'
import { focusedHostDocument, menuHostOf } from './ContextMenu'
import { showToast } from './Toast'

// ── Open / closed (outside React : App's key handler toggles it) ─────────

let openIn: Document | null = null
// What had the focus when it opened : it gets it back when the palette goes.
let focusBefore: Element | null = null
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())
const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Ctrl/Cmd+K : open the palette in the window that has the keyboard, or close it. */
export function toggleSearch(): void {
  if (openIn) openIn = null
  else {
    openIn = focusedHostDocument()
    focusBefore = openIn.activeElement
  }
  emit()
}
export function closeSearch(): void {
  if (!openIn) return
  openIn = null
  emit()
}

// ── Recent picks (this computer's) ──────────────────────────────────────

const RECENT_KEY = 'opsia.searchRecent'
const RECENT_MAX = 12
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function remember(key: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...readRecent().filter((k) => k !== key)].slice(0, RECENT_MAX)))
  } catch {
    /* not remembered */
  }
}

// ── The palette ─────────────────────────────────────────────────────────

export function SearchEverything(): JSX.Element | null {
  const doc = useSyncExternalStore(subscribe, () => openIn)
  if (!doc) return null
  const host = menuHostOf(doc) ?? doc.body
  return createPortal(<Palette doc={doc} />, host)
}

function Palette({ doc }: { doc: Document }): JSX.Element {
  const win = doc.defaultView ?? window
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const [expanded, setExpanded] = useState<Set<SearchKind>>(() => new Set())
  const [recent] = useState(readRecent)
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // What the index reads : rebuilt when any of it changes under the palette
  // (not on the tempo a linked app writes every frame).
  const layers = useStore((s) => s.composition.layers)
  const master = useStore((s) => s.composition.master)
  const background = useStore((s) => s.composition.background)
  const metaKnobs = useStore((s) => s.composition.metaKnobs)
  const selection = useStore((s) => s.selection)
  const userShaders = useStore((s) => s.userShaders)
  const userShaderPresets = useStore((s) => s.userShaderPresets)
  const layerPresets = useStore((s) => s.layerPresets)
  const mixerPresets = useStore((s) => s.mixerPresets)
  const bgPresets = useStore((s) => s.bgPresets)
  const learn = useStore((s) => s.midiLearnMode)
  const domeOn = useStore((s) => s.dome.enabled)
  const items = useMemo(
    () => buildSearchIndex(useStore.getState()),
    // the store's slices the index reads (read whole through getState)
    [layers, master, background, metaKnobs, selection, userShaders, userShaderPresets, layerPresets, mixerPresets, bgPresets, learn, domeOn]
  )
  const summary = useMemo(() => targetsSummary(useStore.getState()), [layers, background, selection])

  const query = q.trim().toLowerCase()
  const sections = useMemo(() => rankSearch(items, query, recent, expanded), [items, query, recent, expanded])
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections])
  // where each kind starts among the rows : Tab jumps between them
  const starts = useMemo(() => {
    const out: number[] = []
    let n = 0
    for (const s of sections) {
      out.push(n)
      n += s.rows.length
    }
    return out
  }, [sections])

  useEffect(() => setCursor(0), [query])
  useEffect(() => {
    if (cursor >= rows.length && rows.length) setCursor(rows.length - 1)
  }, [rows.length, cursor])
  // keep the highlighted row in view while arrowing through
  useEffect(() => {
    listRef.current?.querySelector('[data-cursor="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, rows])

  // Esc closes it, before anything under it hears the key (the page under it,
  // MIDI Learn, the cheat-sheet) : the capture phase, swallowed. The window
  // going away (the Output page's, closed) closes it too. What had the focus
  // gets it back.
  useEffect(() => {
    const before = focusBefore as HTMLElement | null
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeSearch()
    }
    win.addEventListener('keydown', key, true)
    win.addEventListener('pagehide', closeSearch)
    return () => {
      win.removeEventListener('keydown', key, true)
      win.removeEventListener('pagehide', closeSearch)
      if (before && before.isConnected && doc.activeElement === doc.body) before.focus?.({ preventScroll: true })
    }
  }, [doc, win])

  const pick = (row: SearchRow | undefined): void => {
    if (!row) return
    if ('more' in row) {
      setExpanded((cur) => new Set(cur).add(row.more))
      return
    }
    const it = row.item
    if (it.refused) {
      showToast(`${it.label} : ${it.refused}`, 'warn')
      return
    }
    closeSearch()
    remember(it.key)
    // A control picked from the Output page's window is shown on the instrument.
    if (it.reveals && doc !== document) window.focus()
    void (async () => {
      // one undo step : what was being edited closes first, the pick is its own
      commitNow()
      try {
        await it.run()
      } catch (err) {
        console.error('[search] pick failed:', (err as Error).message)
      } finally {
        commitNow()
      }
    })()
  }

  const move = (by: number): void => {
    if (!rows.length) return
    setCursor((c) => Math.max(0, Math.min(rows.length - 1, c + by)))
  }

  let idx = -1
  return (
    <div
      className="fixed inset-0 z-[250] flex flex-col items-center bg-black/45 px-4 pb-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeSearch()
      }}
    >
      <div className="h-[9%] min-h-[16px] shrink-0" onMouseDown={() => closeSearch()} />
      <div
        role="dialog"
        aria-label="Search everything"
        className="flex max-h-[560px] min-h-0 w-[620px] max-w-full flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        // Clicks on the palette's chrome keep the focus in the field (else the
        // bare-key shortcuts would fire under it); rows pick on their click.
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) e.preventDefault()
        }}
      >
        <input
          ref={inputRef}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search sources, effects, parameters, presets, themes, pages…"
          spellCheck={false}
          className="input m-2 shrink-0 px-2.5 py-1.5 text-[13px]"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              move(1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              move(-1)
            } else if (e.key === 'PageDown') {
              e.preventDefault()
              move(8)
            } else if (e.key === 'PageUp') {
              e.preventDefault()
              move(-8)
            } else if (e.key === 'Tab') {
              // the next kind (Shift : the one before); the focus stays here
              e.preventDefault()
              if (!starts.length) return
              const at = e.shiftKey ? [...starts].reverse().find((x) => x < cursor) : starts.find((x) => x > cursor)
              setCursor(at ?? (e.shiftKey ? starts[starts.length - 1] : 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              pick(rows[cursor])
            } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
              // the same key closes it (the Output page's window keeps a field's keys)
              e.preventDefault()
              e.stopPropagation()
              closeSearch()
            }
          }}
        />
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto border-t border-border pb-1">
          {rows.length === 0 && <div className="px-3 py-3 text-[11px] text-muted">Nothing matches.</div>}
          {sections.map((sec) => (
            <div key={sec.title}>
              <div className="sticky top-0 z-10 bg-panel px-3 pb-0.5 pt-1.5 font-mono text-[9px] uppercase tracking-wide text-accent2">
                {sec.title}
              </div>
              {sec.rows.map((row, ri) => {
                idx++
                const i = idx
                const on = i === cursor
                if ('more' in row)
                  return (
                    <button
                      key={`more:${row.more}`}
                      type="button"
                      tabIndex={-1}
                      data-cursor={on ? '1' : '0'}
                      onMouseMove={() => !on && setCursor(i)}
                      onClick={() => pick(row)}
                      className={`block w-full px-3 py-[3px] text-left font-mono text-[10px] ${on ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'}`}
                    >
                      + {row.count} more {KIND_LABEL[row.more].toLowerCase()}
                    </button>
                  )
                const it = row.item
                return (
                  <button
                    key={`${sec.title}:${ri}:${it.key}`}
                    type="button"
                    tabIndex={-1}
                    data-cursor={on ? '1' : '0'}
                    title={it.refused ?? it.title ?? it.hint}
                    onMouseMove={() => !on && setCursor(i)}
                    onClick={() => pick(row)}
                    className={`flex w-full min-w-0 items-baseline gap-2 px-3 py-[3px] text-left text-[11px] ${
                      on ? 'bg-accent/15 text-accent' : 'text-text'
                    } ${it.refused ? 'opacity-50' : ''}`}
                  >
                    <span className="max-w-[45%] shrink-0 truncate">{it.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-muted">{it.refused ?? it.hint}</span>
                    {it.group && (
                      <span className="max-w-[32%] shrink-0 truncate font-mono text-[9px] uppercase tracking-wide text-muted/80">
                        {it.group}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-1 font-mono text-[9px] text-muted">
          <span className="shrink-0">↑ ↓ choose · Tab next kind · Enter pick · Esc close</span>
          <span className="min-w-0 flex-1 truncate text-right" title="Where a picked source or effect goes : it follows the selection">
            {summary}
          </span>
        </div>
      </div>
    </div>
  )
}
