// ContextMenu : shared right-click menu. Fixed-positioned at the cursor,
// closes on outside mousedown / Escape. Items can be actions, dividers, or
// rows with a trailing delete affordance (used by preset lists).
//
// It opens in the window's menu host (MenuHost, at the end of the zoomed
// chrome), never in place : under a dimmed control (opacity 40 %) a menu took
// the dimming, could not rise above that control's neighbours, and showed its
// tooltip over the items. React events still bubble from the menu to the
// component that opened it, so its stopPropagation rules hold.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { effectiveZoom } from './uiZoom'

// One host per window (the instrument, the Output page's own window).
const hosts = new Map<Document, HTMLElement>()

/** Where this window's menus open : put once at the end of the zoomed chrome
 *  (inside it, so a menu still measures the UI zoom; no box of its own). */
export function MenuHost(): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const doc = el.ownerDocument
    hosts.set(doc, el)
    return () => {
      if (hosts.get(doc) === el) hosts.delete(doc)
    }
  }, [])
  return <div ref={ref} className="contents" />
}

export interface MenuItem {
  label: string
  onClick?: () => void
  danger?: boolean
  divider?: boolean
  /** Greyed and non-interactive (e.g. Paste with an empty clipboard). */
  disabled?: boolean
  /** Optional trailing × : e.g. delete a preset without applying it. */
  onDelete?: () => void
  deleteTitle?: string
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  header
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  header?: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  // Which window it opened in : a hidden mark in place finds that window's
  // host before paint, and the menu renders there (a window without a host
  // keeps it in place).
  const markRef = useRef<HTMLSpanElement | null>(null)
  const [host, setHost] = useState<HTMLElement | 'inline' | null>(null)
  useLayoutEffect(() => {
    const doc = markRef.current?.ownerDocument
    const h = doc ? hosts.get(doc) : undefined
    setHost(h?.isConnected ? h : 'inline')
  }, [])
  // The cursor (x, y) is in viewport pixels; the menu sits in the zoomed chrome
  // (see uiZoom.ts) : measured before paint, so it opens right at the cursor.
  const [z, setZ] = useState(1)
  const uiZoom = useStore((s) => s.uiZoom) // a zoom change while open re-measures
  useLayoutEffect(() => {
    const zz = effectiveZoom(ref.current)
    if (Math.abs(zz - z) > 0.005) setZ(zz)
  }, [z, uiZoom, host])

  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // Escape closes the menu and MUST NOT also fire an App-level Escape (exit
      // MIDI-learn, close the page underneath). App's handler sits on window in
      // the bubble phase and is registered first, so listen in the CAPTURE phase
      // and swallow the event before it can reach those bubble listeners.
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  // Keep the whole menu inside the viewport : estimate its height, clamp the top
  // so it never runs off the bottom, and cap + scroll when the list is very long
  // (a layer/background with many saved presets used to spill off-screen).
  const vw = window.innerWidth / z, vh = window.innerHeight / z // the viewport in the menu's own pixels
  const estH = Math.min(items.length * 28 + 40, vh - 16)
  const top = Math.max(8, Math.min(y / z, vh - 8 - estH))
  const style: React.CSSProperties = {
    left: Math.min(x / z, vw - 220),
    top,
    maxHeight: vh - top - 8
  }

  const menu = (
    <div
      ref={ref}
      style={style}
      // above every page and modal : it is always the latest thing opened
      className="fixed z-[300] flex min-w-[180px] flex-col overflow-y-auto rounded border border-border bg-panel2 py-1 shadow-lg"
    >
      {header && (
        <div className="sticky top-0 z-10 border-b border-border bg-panel2 px-3 py-1 font-mono text-[9px] uppercase tracking-wide text-muted">
          {header}
        </div>
      )}
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="my-1 border-t border-border" />
        ) : (
          <div key={i} className="flex items-center">
            <button
              disabled={item.disabled}
              onClick={() => {
                item.onClick?.()
                onClose()
              }}
              className={`flex-1 px-3 py-1 text-left text-[11px] transition-colors ${
                item.disabled
                  ? 'cursor-default text-muted/40'
                  : `hover:bg-accent/15 ${item.danger ? 'text-danger hover:text-danger' : 'hover:text-accent'}`
              }`}
            >
              {item.label}
            </button>
            {item.onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  item.onDelete?.()
                  onClose()
                }}
                className="px-2 font-mono text-[10px] text-muted hover:text-danger"
                title={item.deleteTitle ?? 'Delete'}
              >
                ×
              </button>
            )}
          </div>
        )
      )}
    </div>
  )
  return (
    <>
      <span ref={markRef} hidden />
      {host === 'inline' ? menu : host ? createPortal(menu, host) : null}
    </>
  )
}
