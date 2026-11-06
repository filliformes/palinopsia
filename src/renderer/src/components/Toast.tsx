// A single toast line. Transient by default (auto-dismisses) for confirmations
// with no natural home : a recording saved, a panic fired. One at a time (a
// newer message replaces the older). `ms <= 0` makes it STICKY : it stays with
// a ✕ and wraps its full text, for actionable install-instruction errors that
// shouldn't vanish on a timer.
//
// It passes over the top of the picture, in glass, in the same place every time. When
// the picture is covered (a page over it) or too small, it docks in the empty middle of
// the bottom toolbar (ToastDock), over nothing; too narrow a window falls back to the
// bottom center of the window.

import { useCallback, useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { glassEnabled, useGlass, type GlassShape } from '../glass'

type ToastMsg = { id: number; text: string; kind: 'ok' | 'warn'; sticky: boolean }

let current: ToastMsg | null = null
let dockEl: HTMLElement | null = null
let seq = 0
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}
function clearTimer(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

/** Show a toast. `kind` tints it (ok = accent, warn = danger). `ms <= 0` = sticky. */
export function showToast(text: string, kind: 'ok' | 'warn' = 'ok', ms = 3400): void {
  const sticky = ms <= 0
  current = { id: ++seq, text, kind, sticky }
  emit()
  clearTimer()
  if (!sticky)
    timer = setTimeout(() => {
      current = null
      timer = null
      emit()
    }, ms)
}

/** Dismiss the current toast (the sticky ✕). */
export function dismissToast(): void {
  clearTimer()
  current = null
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function snapshot(): ToastMsg | null {
  return current
}
function dockSnapshot(): HTMLElement | null {
  return dockEl
}

/** The toast's home : the bottom toolbar's empty middle. */
export function ToastDock({ className }: { className?: string }): JSX.Element {
  const ref = useCallback((el: HTMLDivElement | null) => {
    dockEl = el
    emit()
  }, [])
  return <div ref={ref} className={className} />
}

/** The picture a message can pass over : the preview. */
let pictureEl: HTMLElement | null = null
export function usePictureToastDock(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    pictureEl = ref.current
    return () => {
      pictureEl = null
    }
  }, [ref])
}
/** The picture, if nothing covers it and it can hold a message. */
function freePicture(): HTMLElement | null {
  const el = pictureEl
  if (!el || !el.isConnected || el.clientWidth < DOCK_MIN_W || el.clientHeight < 90) return null
  const r = el.getBoundingClientRect()
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + 30)
  return top && el.contains(top) ? el : null
}

const TOAST_GLASS: GlassShape = { radius: 16, bezel: 12, scale: 26, blur: 2.2, saturate: 1.5 }

const DOCK_MIN_W = 180 // narrower than this, the toast would be a sliver : use the window

function ToastBox({ msg, wide, glass = false }: { msg: ToastMsg; wide: boolean; glass?: boolean }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  useGlass(ref, TOAST_GLASS, glass)
  const look = glass
    ? 'glass rounded-2xl px-3.5 py-2 font-app text-[12px] font-medium'
    : `rounded-md border bg-panel2/95 px-3 py-1.5 font-mono text-[11px] shadow-lg backdrop-blur ${msg.kind === 'warn' ? 'border-danger/70 text-danger' : 'border-accent/70 text-text'}`
  return (
    <div
      ref={ref}
      className={`pointer-events-auto flex items-start gap-2 ${look} ${wide ? 'max-w-full' : msg.sticky ? 'max-w-md' : 'max-w-[80vw]'}`}
      title={msg.sticky ? undefined : msg.text}
    >
      {glass && msg.kind === 'warn' && <span className="mt-[3px] h-2 w-2 shrink-0 rounded-full bg-danger" />}
      <span className={msg.sticky ? 'min-w-0 leading-snug' : 'min-w-0 truncate'}>{msg.text}</span>
      {msg.sticky && (
        <button
          onClick={dismissToast}
          className="shrink-0 leading-none opacity-70 transition-opacity hover:opacity-100"
          title="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  )
}

/** Mount once near the app root. Renders the current toast (or nothing).
 *  `undocked` : at the bottom of its own window (the Output page's window,
 *  which has no toolbar dock), the same toast as the instrument's. */
export function Toaster({ undocked = false }: { undocked?: boolean } = {}): JSX.Element | null {
  const msg = useSyncExternalStore(subscribe, snapshot)
  const dockEl0 = useSyncExternalStore(subscribe, dockSnapshot)
  const dock = undocked ? null : dockEl0
  if (!msg) return null
  const docked = !!dock && dock.isConnected && dock.clientWidth >= DOCK_MIN_W
  const picture = !undocked && glassEnabled() ? freePicture() : null
  if (picture) {
    return createPortal(
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[6] flex justify-center">
        <ToastBox key={msg.id} msg={msg} wide glass />
      </div>,
      picture
    )
  }
  const box = <ToastBox key={msg.id} msg={msg} wide={docked} />
  if (docked) {
    // Centered in the dock; a sticky (wrapping) one grows upward from the bar.
    return createPortal(
      <div className={`pointer-events-none absolute inset-0 z-[200] flex justify-center ${msg.sticky ? 'items-end' : 'items-center'}`}>
        {box}
      </div>,
      dock!
    )
  }
  return <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[200] flex justify-center">{box}</div>
}
