// OutputPageWindow : the Output page in a window of its own, beside the
// instrument (on a second screen, or just moved aside), so the mapping, the
// dome and the senders stay in view while you play. The control window opens a
// blank page of its own and draws the page into it through a React portal : one
// app, one store, one engine, every control live. The window only borrows the
// control window's styles, theme and zoom, and hands its keys back to it, so
// the shortcuts still play the instrument from there.

import { useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { OUTPUT_PAGE_FRAME } from '@shared/types'
import { useStore } from '../store'
import { OutputPage } from './OutputPage'
import { Toaster, showToast } from './Toast'
import { MenuHost } from './ContextMenu'

const BOUNDS_KEY = 'opsia.outputPageBounds'

// The window outlives a remount : React's development double-mount, a hot
// update. Its close waits a tick, and a mount in between keeps it.
let popup: Window | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null

function saveBounds(w: Window): void {
  try {
    if (w.closed || w.outerWidth < 200) return
    localStorage.setItem(BOUNDS_KEY, JSON.stringify({ x: w.screenX, y: w.screenY, w: w.outerWidth, h: w.outerHeight }))
  } catch {
    /* not remembered */
  }
}

/** Where it was last time (main puts it back on a screen if that one is gone). */
function features(): string {
  let b: { x: number; y: number; w: number; h: number } | null = null
  try {
    b = JSON.parse(localStorage.getItem(BOUNDS_KEY) ?? 'null')
  } catch {
    b = null
  }
  const ok = b && [b.x, b.y, b.w, b.h].every(Number.isFinite)
  return ok ? `left=${b!.x},top=${b!.y},width=${b!.w},height=${b!.h}` : 'width=1360,height=860'
}

/** The control window's styles, copied in (and again whenever they change : a
 *  hot update rewrites them). New copies go in before the old leave, so the
 *  page never shows unstyled. */
function copyStyles(to: Document): void {
  const old = [...to.head.querySelectorAll('[data-opsia-style]')]
  for (const n of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    const c = to.importNode(n, true) as HTMLElement
    if (n instanceof HTMLLinkElement) (c as HTMLLinkElement).href = n.href // absolute : the blank page has no base of its own
    c.setAttribute('data-opsia-style', '')
    to.head.appendChild(c)
  }
  for (const n of old) n.remove()
}

function copyRootAttributes(to: Document): void {
  for (const a of ['data-theme', 'class', 'lang']) {
    const v = document.documentElement.getAttribute(a)
    if (v == null) to.documentElement.removeAttribute(a)
    else to.documentElement.setAttribute(a, v)
  }
}

/** Typing in the window's own fields stays there; every other key goes to the
 *  instrument, as if pressed over it. */
function forwardKeys(w: Window): () => void {
  const fwd = (e: KeyboardEvent): void => {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
    const copy = new KeyboardEvent(e.type, {
      key: e.key,
      code: e.code,
      location: e.location,
      repeat: e.repeat,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(copy)
    if (copy.defaultPrevented) e.preventDefault()
  }
  w.addEventListener('keydown', fwd)
  w.addEventListener('keyup', fwd)
  return () => {
    w.removeEventListener('keydown', fwd)
    w.removeEventListener('keyup', fwd)
  }
}

export function OutputPageWindow({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }): JSX.Element | null {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const uiZoom = useStore((s) => s.uiZoom)

  useEffect(() => {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
    let w = popup && !popup.closed ? popup : null
    if (!w) {
      w = window.open('', OUTPUT_PAGE_FRAME, features())
      if (!w) {
        showToast('The Output page could not open in a window : it stays here', 'warn')
        useStore.getState().setOutputPageWindow(false)
        return
      }
      popup = w
    }
    const doc = w.document
    doc.title = 'Palinopsia · Output'
    doc.body.replaceChildren() // a reused window (after a hot update) : start clean
    doc.body.className = document.body.className
    doc.body.style.margin = '0'
    copyStyles(doc)
    copyRootAttributes(doc)
    const root = doc.createElement('div')
    doc.body.appendChild(root)
    setHost(root)

    let queued = 0
    const resync = (): void => {
      if (queued) return
      queued = requestAnimationFrame(() => {
        queued = 0
        if (!w!.closed) copyStyles(doc)
      })
    }
    const headObs = new MutationObserver(resync)
    headObs.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true })
    const rootObs = new MutationObserver(() => copyRootAttributes(doc))
    rootObs.observe(document.documentElement, { attributes: true })
    const unKeys = forwardKeys(w)

    // Closed from its own title bar : the page closes (next time it opens in
    // the app). Not when this closes it : the listener is gone by then.
    const onGone = (): void => {
      saveBounds(w!)
      popup = null
      useStore.getState().setOutputPageOpen(false)
    }
    w.addEventListener('beforeunload', onGone)
    const keep = window.setInterval(() => saveBounds(w!), 5000)

    return () => {
      headObs.disconnect()
      rootObs.disconnect()
      if (queued) cancelAnimationFrame(queued)
      unKeys()
      w!.removeEventListener('beforeunload', onGone)
      window.clearInterval(keep)
      setHost(null)
      const gone = w!
      closeTimer = setTimeout(() => {
        closeTimer = null
        saveBounds(gone)
        gone.close()
        if (popup === gone) popup = null
      }, 0)
    }
  }, [])

  if (!host) return null
  return createPortal(
    // the instrument's zoom, as over it (h-screen compensated by 1/zoom)
    <div className="flex flex-col bg-bg font-app text-text" style={{ zoom: uiZoom, height: `calc(100vh / ${uiZoom})` }}>
      <OutputPage canvasRef={canvasRef} inWindow />
      <Toaster undocked />
      <MenuHost />
    </div>,
    host
  )
}
