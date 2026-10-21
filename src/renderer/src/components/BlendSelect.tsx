// BlendSelect : the blend-mode menu (a layer's A/B mode and its blend, in the
// layer strip and in the Mixer). The app's own list, not the system's : a
// native <select> flipped its popup ABOVE itself whenever the 20 modes did not
// fit below. This one always opens downward, right under its button, as tall
// as the room left to the window's bottom edge, and scrolls inside past that;
// the chosen mode is scrolled into view as it opens. The names it shows are
// the readable ones (abMix.ts BLEND_LABELS); what it stores is unchanged.
//
// The list opens in the window's menu host (ContextMenu.tsx MenuHost), never
// in place : no panel's overflow clips it and no dimmed (opacity 40 %) wrapper
// dims it. It is placed from viewport pixels divided by its own zoom (see
// uiZoom.ts), in the window its button lives in (the Output page can have a
// window of its own). The button is the only thing it puts in place, so a
// PinZone's bar (styles.css [data-pinned] > *:first-child) still lands on it.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { BlendMode } from '@shared/types'
import { BLEND_MODES } from '@shared/types'
import { useStore } from '../store'
import { blendAt, blendLabel } from './abMix'
import { menuHostOf } from './ContextMenu'
import { registerLiveOverlay } from './liveOverlay'
import { effectiveZoom } from './uiZoom'

const LABELS = BLEND_MODES.map(blendLabel)
const TYPED = LABELS.map((l) => l.toLowerCase())
const GAP = 1 // between the button and the list under it
const MARGIN = 6 // kept free under the list, above the window's bottom edge
const MIN_H = 44 // a button at the very bottom still shows about two rows
const TYPE_PAUSE = 900 // ms : a longer pause starts a new type-ahead word

/** Where a type-ahead word lands (-1 : nowhere). One letter again and again
 *  steps through the modes it starts, from the one after the highlighted;
 *  more letters find the first name they start, from the highlighted one
 *  ("lumak" finds luma key too : spaces count or not). */
function seek(text: string, from: number): number {
  const n = BLEND_MODES.length
  const one = [...text].every((c) => c === text[0])
  const q = one ? text[0] : text
  const bare = q.replace(/ /g, '')
  for (let k = 0; k < n; k++) {
    const i = (from + (one ? 1 : 0) + k) % n
    if (TYPED[i].startsWith(q) || (bare && TYPED[i].replace(/ /g, '').startsWith(bare))) return i
  }
  return -1
}

export function BlendSelect({
  value,
  onChange,
  className = '',
  style,
  title,
  fit = false,
  liveKey,
  disabled = false
}: {
  value: BlendMode
  onChange: (mode: BlendMode) => void
  /** Its look, as the select it replaces wore it ('input select-compact text-[10px]'…). */
  className?: string
  style?: CSSProperties
  title?: string
  /** As wide as the longest name, the same in every mode (an invisible stack of
   *  every name sizes it). Else its box sets the width and a long name is cut. */
  fit?: boolean
  /** A modulated blend's target key : the button shows the mode playing now
   *  (the live overlay paints it, never React). */
  liveKey?: string
  disabled?: boolean
}): JSX.Element {
  const uiZoom = useStore((s) => s.uiZoom) // a zoom change while open re-places it
  // Where the open list renders : the window's menu host (in place, without one).
  const [openIn, setOpenIn] = useState<HTMLElement | 'inline' | null>(null)
  const open = openIn !== null
  const [active, setActive] = useState(0) // the highlighted row (pointer or keys)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const liveRef = useRef<HTMLSpanElement | null>(null)
  const typed = useRef({ text: '', at: 0 })
  const pointer = useRef<{ x: number; y: number } | null>(null)
  // the latest of each, for the listeners set once per opening and the loop
  const latest = useRef({ value, onChange, active })
  latest.current = { value, onChange, active }

  const openList = (): void => {
    const doc = btnRef.current?.ownerDocument
    setActive(Math.max(0, BLEND_MODES.indexOf(value)))
    typed.current.text = ''
    pointer.current = null
    setOpenIn((doc && menuHostOf(doc)) || 'inline')
  }
  const pick = (mode: BlendMode): void => {
    setOpenIn(null)
    if (mode !== latest.current.value) latest.current.onChange(mode)
  }

  useEffect(() => {
    if (disabled) setOpenIn(null)
  }, [disabled])

  // Modulated : the mode playing now, from the shared loop; the stored one on
  // the frames nothing moves it.
  useEffect(() => {
    const el = liveRef.current
    if (!liveKey || !el) return
    const show = (mode: BlendMode): void => {
      const t = blendLabel(mode)
      if (el.textContent !== t) el.textContent = t
    }
    return registerLiveOverlay({
      key: liveKey,
      apply: (x) => show(blendAt(x)),
      idle: () => show(latest.current.value),
      view: el.ownerDocument.defaultView ?? undefined
    })
  }, [liveKey])

  // Under the button, before paint : its left edge (kept on screen), at least
  // its width, as tall as the room left below. Again on any scroll that moves
  // the button, a resize, a UI zoom.
  useLayoutEffect(() => {
    const btn = btnRef.current
    const view = btn?.ownerDocument.defaultView
    if (!open || !btn || !view) return
    const place = (): void => {
      const list = listRef.current
      if (!list) return
      // viewport pixels → the list's own (it sits in the zoomed chrome)
      const z = effectiveZoom(list)
      const b = btn.getBoundingClientRect()
      const top = b.bottom / z + GAP
      list.style.top = `${top}px`
      list.style.minWidth = `${b.width / z}px`
      list.style.maxHeight = `${Math.max(MIN_H, view.innerHeight / z - top - MARGIN)}px`
      list.style.left = `${Math.max(4, Math.min(b.left / z, view.innerWidth / z - list.offsetWidth - 4))}px`
    }
    place()
    const onScroll = (e: Event): void => {
      if (!listRef.current?.contains(e.target as Node)) place()
    }
    view.addEventListener('scroll', onScroll, true)
    view.addEventListener('resize', place)
    return () => {
      view.removeEventListener('scroll', onScroll, true)
      view.removeEventListener('resize', place)
    }
  }, [open, uiZoom])

  // Opening : the chosen mode in view, in the middle when the list scrolls.
  useLayoutEffect(() => {
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!open || !list || !row) return
    list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2
  }, [open])

  // The highlighted row stays in view while the keys walk the list.
  useEffect(() => {
    const list = listRef.current
    const row = list?.children[active] as HTMLElement | undefined
    if (!open || !list || !row) return
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
  }, [open, active])

  // While open, in its own window : a press anywhere else closes it, the
  // window losing focus too; the keys are the list's.
  useEffect(() => {
    const view = btnRef.current?.ownerDocument.defaultView
    if (!open || !view) return
    const down = (e: PointerEvent): void => {
      const t = e.target as Node
      if (listRef.current?.contains(t)) return
      // its own button toggles it (a right-click there : the pin menu, so it closes)
      if (e.button === 0 && btnRef.current?.contains(t)) return
      setOpenIn(null)
    }
    const key = (e: KeyboardEvent): void => {
      const n = BLEND_MODES.length
      const at = latest.current.active
      const t = typed.current
      const typing = !!t.text && performance.now() - t.at < TYPE_PAUSE
      if (e.key === 'Tab') {
        setOpenIn(null) // and the focus moves on as usual
        return
      }
      if (e.key === 'Escape') setOpenIn(null)
      else if (e.key === 'ArrowDown') setActive(Math.min(n - 1, at + 1))
      else if (e.key === 'ArrowUp') setActive(Math.max(0, at - 1))
      else if (e.key === 'PageDown') setActive(Math.min(n - 1, at + 5))
      else if (e.key === 'PageUp') setActive(Math.max(0, at - 5))
      else if (e.key === 'Home') setActive(0)
      else if (e.key === 'End') setActive(n - 1)
      else if (e.key === 'Enter' || (e.key === ' ' && !typing)) pick(BLEND_MODES[at])
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // type-ahead : the first letters of a name
        const now = performance.now()
        if (now - t.at > TYPE_PAUSE) t.text = ''
        t.at = now
        t.text += e.key.toLowerCase()
        const i = seek(t.text, at)
        if (i >= 0) setActive(i)
      } else if (!e.key.startsWith('Arrow')) return // (left / right : nothing, and no one else)
      // Swallowed in the CAPTURE phase, before the app's own handlers (a bare
      // letter's shortcut, Esc closing a page) can hear it : see ContextMenu.
      e.preventDefault()
      e.stopPropagation()
    }
    const blur = (): void => setOpenIn(null)
    view.addEventListener('pointerdown', down, true)
    view.addEventListener('keydown', key, true)
    view.addEventListener('blur', blur)
    return () => {
      view.removeEventListener('pointerdown', down, true)
      view.removeEventListener('keydown', key, true)
      view.removeEventListener('blur', blur)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const label = blendLabel(value)
  const cell = fit ? 'col-start-1 row-start-1' : 'truncate'
  const list = open ? (
    <div
      ref={listRef}
      role="listbox"
      // above every page and modal, as a right-click menu
      className="fixed z-[300] w-max overflow-y-auto overscroll-contain rounded border border-border bg-panel2 py-1 shadow-lg"
      // The focus stays on the button (its keys, its ring), and nothing under
      // the list hears it : React events bubble from a portal to the opener's
      // parents (the pin menu, the layer's own right-click menu).
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {BLEND_MODES.map((m, i) => (
        <div
          key={m}
          role="option"
          aria-selected={m === value}
          onMouseMove={(e) => {
            // a real move only : the list scrolling under a still pointer must
            // not take the row the keys are on
            const p = pointer.current
            if (p && p.x === e.clientX && p.y === e.clientY) return
            pointer.current = { x: e.clientX, y: e.clientY }
            if (i !== active) setActive(i)
          }}
          onClick={() => pick(m)}
          className={`flex cursor-default items-center whitespace-nowrap py-0.5 pl-1.5 pr-3 text-[11px] ${
            i === active ? 'bg-accent/15 text-accent' : m === value ? 'text-accent' : 'text-text'
          }`}
        >
          <span className="w-3.5 shrink-0 text-[10px]">{m === value ? '✓' : ''}</span>
          {LABELS[i]}
        </div>
      ))}
    </div>
  ) : null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpenIn(null) : openList())}
        onKeyDown={(e) => {
          // closed and focused : the arrows open it (Enter and Space click it)
          if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          e.stopPropagation()
          openList()
        }}
        // a select's look : its text left unless centered, one line, the
        // default arrow (the chevron is the select-compact background)
        className={`${fit ? 'inline-grid' : 'grid grid-cols-[minmax(0,1fr)]'} cursor-default whitespace-nowrap ${
          /\btext-center\b/.test(className) ? '' : 'text-left'
        } ${className}`}
        style={style}
      >
        {fit &&
          LABELS.map((l) => (
            <span key={l} aria-hidden className="invisible col-start-1 row-start-1">
              {l}
            </span>
          ))}
        {liveKey ? (
          // painted by the live overlay (React never writes it : its text would
          // be swapped under it), seeded at mount so it never shows empty
          <span
            key="live"
            ref={(el) => {
              liveRef.current = el
              if (el && !el.textContent) el.textContent = label
            }}
            className={cell}
          />
        ) : (
          <span key="base" className={cell}>
            {label}
          </span>
        )}
      </button>
      {openIn === 'inline' ? list : openIn && list ? createPortal(list, openIn) : null}
    </>
  )
}
