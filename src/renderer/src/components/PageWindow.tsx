// PageWindow : a page of the instrument in a window of its own, beside it (on a
// second screen, or just moved aside) : the Output page, so the mapping, the
// dome and the senders stay in view while you play; Body, to watch the camera
// and its rules; Sonify, to play the sound beside the picture; the Sequencer, to
// steer the auto-pilot beside the picture. The control
// window opens a blank page of its own and draws the page into it through a
// React portal : one app, one store, one engine, every control live. The window
// only borrows the control window's styles, theme and zoom, and hands its keys
// back to it, so the shortcuts still play the instrument from there.
// Asked for from the page's button (right-click), never remembered : the next
// time, the page opens in the app.

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BODY_PAGE_FRAME, OUTPUT_PAGE_FRAME, PAGE_WINDOW_TITLES, SEQUENCE_PAGE_FRAME, SONIFY_PAGE_FRAME } from '@shared/types'
import { useStore } from '../store'
import { watchUserInput } from '../sessionGuard'
import { Toaster, showToast } from './Toast'
import { MenuHost } from './ContextMenu'

export type WindowPage = 'output' | 'body' | 'sonify' | 'sequence'

/** Each page : its window's name (main allows only these), where its place is
 *  kept, its first size, what it is called, and how it closes (the page closes)
 *  or stays in the app (no window could open). */
const PAGES: Record<
  WindowPage,
  { frame: string; boundsKey: string; size: string; name: string; close: () => void; stayHere: () => void }
> = {
  output: {
    frame: OUTPUT_PAGE_FRAME,
    boundsKey: 'opsia.outputPageBounds',
    size: 'width=1360,height=860',
    name: 'The Output page',
    close: () => useStore.getState().setOutputPageOpen(false),
    stayHere: () => useStore.getState().setOutputPageWindow(false)
  },
  body: {
    frame: BODY_PAGE_FRAME,
    boundsKey: 'opsia.bodyPageBounds',
    size: 'width=1180,height=860',
    name: 'Body',
    close: () => useStore.getState().setBodyPageOpen(false),
    stayHere: () => useStore.getState().setBodyPageWindow(false)
  },
  sonify: {
    frame: SONIFY_PAGE_FRAME,
    boundsKey: 'opsia.sonifyPageBounds',
    size: 'width=1460,height=900',
    name: 'Sonify',
    close: () => useStore.getState().setSonifyPageOpen(false),
    stayHere: () => useStore.getState().setSonifyPageWindow(false)
  },
  sequence: {
    frame: SEQUENCE_PAGE_FRAME,
    boundsKey: 'opsia.sequencePageBounds',
    size: 'width=1360,height=860',
    name: 'The Sequencer',
    close: () => useStore.getState().setSequencePageOpen(false),
    stayHere: () => useStore.getState().setSequencePageWindow(false)
  }
}

// A window outlives a remount : React's development double-mount, a hot update.
// Its close waits a tick, and a mount in between keeps it. One per page.
const popups = new Map<WindowPage, Window>()
const closeTimers = new Map<WindowPage, ReturnType<typeof setTimeout>>()

function saveBounds(key: string, w: Window): void {
  try {
    if (w.closed || w.outerWidth < 200) return
    localStorage.setItem(key, JSON.stringify({ x: w.screenX, y: w.screenY, w: w.outerWidth, h: w.outerHeight }))
  } catch {
    /* not remembered */
  }
}

/** Where it was last time (main puts it back on a screen if that one is gone). */
function features(key: string, size: string): string {
  let b: { x: number; y: number; w: number; h: number } | null = null
  try {
    b = JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    b = null
  }
  const ok = b && [b.x, b.y, b.w, b.h].every(Number.isFinite)
  return ok ? `left=${b!.x},top=${b!.y},width=${b!.w},height=${b!.h}` : size
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

// Keys the pages open on the instrument take for themselves (Esc closes the page
// on top, the arrows step the World bank, Enter applies a World, Delete turns an
// EQ band off) and no shortcut uses : here they are this window's own (its
// buttons, its scroll, its menus), never a page's on the other screen.
const OWN_KEYS = new Set(['Escape', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'])

/** Typing in the window's own fields stays there; every other key goes to the
 *  instrument, as if pressed over it, but the page keys above. */
function forwardKeys(w: Window): () => void {
  const fwd = (e: KeyboardEvent): void => {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
    // (Esc still leaves MIDI Learn : its overlay covers this window too)
    if (OWN_KEYS.has(e.key) && !(e.key === 'Escape' && useStore.getState().midiLearnMode)) return
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

export function PageWindow({ page, children }: { page: WindowPage; children: ReactNode }): JSX.Element | null {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const uiZoom = useStore((s) => s.uiZoom)

  useEffect(() => {
    const p = PAGES[page]
    const pending = closeTimers.get(page)
    if (pending) {
      clearTimeout(pending)
      closeTimers.delete(page)
    }
    const kept = popups.get(page)
    let w = kept && !kept.closed ? kept : null
    if (!w) {
      w = window.open('', p.frame, features(p.boundsKey, p.size))
      if (!w) {
        showToast(`${p.name} could not open in a window : it stays here`, 'warn')
        p.stayHere()
        return
      }
      popups.set(page, w)
    }
    const doc = w.document
    doc.title = PAGE_WINDOW_TITLES[p.frame]
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
    // an edit here is your hands on the controls too (a session just opened
    // must not absorb it as the engine settling)
    const unInput = watchUserInput(w)

    // Closed from its own title bar : the page closes (next time it opens in
    // the app). Not when this closes it : the listener is gone by then.
    const onGone = (): void => {
      saveBounds(p.boundsKey, w!)
      if (popups.get(page) === w) popups.delete(page)
      p.close()
    }
    w.addEventListener('beforeunload', onGone)
    const keep = window.setInterval(() => saveBounds(p.boundsKey, w!), 5000)

    return () => {
      headObs.disconnect()
      rootObs.disconnect()
      if (queued) cancelAnimationFrame(queued)
      unKeys()
      unInput()
      w!.removeEventListener('beforeunload', onGone)
      window.clearInterval(keep)
      setHost(null)
      const gone = w!
      closeTimers.set(
        page,
        setTimeout(() => {
          closeTimers.delete(page)
          saveBounds(p.boundsKey, gone)
          gone.close()
          if (popups.get(page) === gone) popups.delete(page)
        }, 0)
      )
    }
  }, [page])

  if (!host) return null
  return createPortal(
    // the instrument's zoom, as over it (h-screen compensated by 1/zoom)
    <div className="flex flex-col bg-bg font-app text-text" style={{ zoom: uiZoom, height: `calc(100vh / ${uiZoom})` }}>
      {children}
      <Toaster undocked />
      <MenuHost />
    </div>,
    host
  )
}
