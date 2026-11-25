// Complex Output : the screens' windows, and the frames in them.
//
// Each screen is a window of this same process (window.open on a blank page; main
// puts it on its display, main/complexOut.ts) with a canvas of its own. Once a frame
// the engine stops just before its picture goes on the canvas (Compositor.cxTap) :
// every source the slices take is put there in turn, the windows read it GPU to GPU,
// and draw. Nothing is read back, nothing crosses a process, nothing waits : the
// screens show the frame the preview shows, at the engine's own pace.
//
// The setup is the store's `complexOut`; while a hand drags in the editor, `draft`
// stands in for it (no React, no store write until the hand lets go).

import { cxBaseValue, cxColorAt, type CxScreen, type CxSetup, type CxSlice, type CxSource } from '@shared/complexOut'
import { CX_FRAME } from '@shared/types'
import type { Compositor } from '../engine/Compositor'
import { useStore } from '../store'
import { runSilently } from '../undo'
import { cxModKey, cxMods, setCxBaseOf } from './cxMods'
import { matchDisplay, type CxDisplay, type CxState } from './cxProblems'
import { CxRenderer, type CxDrawOpts } from './cxRender'

/** Anything else that draws a screen : the editor's two views. */
export interface CxPreview {
  canvas: HTMLCanvasElement
  renderer: CxRenderer | null
  /** what it shows now (null : nothing), and its slices */
  screen: () => CxScreen | null
  /** every slice, whatever is soloed or off (the input side) */
  raw?: boolean
}

interface Live {
  id: string
  win: Window
  canvas: HTMLCanvasElement
  r: CxRenderer
  where: string
  onGone: () => void
  boundsTimer: number
}

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]

class CxRuntime {
  displays: CxDisplay[] = []
  states: Record<string, CxState> = {}
  /** covering the controls' display was accepted (until the app closes) */
  allowOwn = false
  /** an installation : nobody to ask */
  unattended = false
  draft: CxSetup | null = null
  /** screens closed by hand (their window's own close, Esc) : not opened again by themselves */
  private dismissed = new Set<string>()
  private live = new Map<string, Live>()
  private opening = new Set<string>()
  private previews = new Set<CxPreview>()
  private identifyUntil = 0
  private listeners = new Set<() => void>()
  private started = false
  private syncing = false
  private again = false
  private comp: Compositor | null = null
  /** what a probe reads : ms spent on the last frame, frames drawn */
  stats = { ms: 0, frames: 0, worst: 0 }

  // ── for React : the windows' and displays' state ──
  version = 0
  subscribe = (fn: () => void): (() => void) => {
    this.start()
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  snapshot = (): number => this.version
  private bump(): void {
    this.version++
    for (const l of this.listeners) l()
  }

  setup(): CxSetup {
    return this.draft ?? useStore.getState().complexOut
  }

  private start(): void {
    if (this.started) return
    this.started = true
    setCxBaseOf((who, field) => cxBaseValue(useStore.getState().complexOut, who, field))
    useStore.subscribe((s, p) => {
      if (s.complexOut === p.complexOut && s.complexLive === p.complexLive) return
      if (s.complexLive !== p.complexLive) this.dismissed.clear()
      void this.sync()
    })
    window.api.onComplexDisplays(() => void this.refreshDisplays())
    void this.refreshDisplays()
    window.addEventListener('beforeunload', () => this.closeAll())
  }

  async refreshDisplays(): Promise<void> {
    try {
      this.displays = await window.api.complexDisplays()
    } catch {
      /* none told : the windows still work */
    }
    this.bump()
    await this.sync()
  }

  /** Cover the display the controls are on (asked for in the page). */
  acceptOwn(): void {
    this.allowOwn = true
    void this.sync()
  }
  /** A screen closed by hand opens again. */
  reopen(id: string): void {
    this.dismissed.delete(id)
    void this.sync()
  }

  identify(ms = 3000): void {
    this.identifyUntil = performance.now() + ms
    const names: Record<string, string> = {}
    this.setup().screens.forEach((sc) => {
      const d = matchDisplay(sc, this.displays)
      if (d && sc.on) names[String(d.id)] = sc.name
    })
    // where a screen is open its own window shows its number : only the displays need one
    void window.api.complexIdentify(names).catch(() => {})
  }

  /** Windows opened, closed and moved to match the setup. */
  async sync(): Promise<void> {
    this.start()
    if (this.syncing) {
      this.again = true
      return
    }
    this.syncing = true
    try {
      const st = useStore.getState()
      const states: Record<string, CxState> = {}
      const wanted = new Set<string>()
      for (const sc of st.complexOut.screens) {
        states[sc.id] = 'closed'
        if (!st.complexLive || !sc.on || sc.target.kind === 'none') continue
        let where = 'window'
        let d: CxDisplay | null = null
        if (sc.target.kind === 'display') {
          d = matchDisplay(sc, this.displays)
          if (!d) {
            states[sc.id] = 'missing'
            continue
          }
          if (d.isControl && !this.allowOwn && !this.unattended) {
            states[sc.id] = 'held'
            continue
          }
          where = `display:${d.id}:${d.width}x${d.height}`
        }
        if (this.dismissed.has(sc.id)) continue
        wanted.add(sc.id)
        const open = this.live.get(sc.id)
        if (open && open.where !== where) this.close(sc.id)
        if (!this.live.has(sc.id)) states[sc.id] = (await this.open(sc, d, where)) ? 'open' : 'failed'
        else states[sc.id] = 'open'
      }
      for (const id of [...this.live.keys()]) if (!wanted.has(id)) this.close(id)
      this.states = states
    } finally {
      this.syncing = false
    }
    this.bump()
    if (this.again) {
      this.again = false
      await this.sync()
    }
  }

  private async open(sc: CxScreen, d: CxDisplay | null, where: string): Promise<boolean> {
    if (this.opening.has(sc.id)) return false
    this.opening.add(sc.id)
    let win: Window | null = null
    try {
      const title = `Palinopsia · ${sc.name}`
      const t = sc.target
      const fit = Math.min(1, 960 / sc.w, 600 / sc.h)
      const ok = await window.api.complexPrepare(
        sc.id,
        d ? { kind: 'display', displayId: d.id, title } : { kind: 'window', x: t.x, y: t.y, w: t.ww ?? Math.round(sc.w * fit), h: t.wh ?? Math.round(sc.h * fit), title }
      )
      if (!ok) return false
      win = window.open('', CX_FRAME + sc.id)
      if (!win) return false
      const doc = win.document
      doc.title = title
      doc.body.replaceChildren()
      doc.documentElement.style.cssText = 'background:#000;height:100%'
      doc.body.style.cssText = `margin:0;height:100%;overflow:hidden;background:#000;${d ? 'cursor:none' : ''}`
      const canvas = doc.createElement('canvas')
      canvas.width = sc.w
      canvas.height = sc.h
      canvas.style.cssText = 'display:block;width:100vw;height:100vh;object-fit:contain;background:#000'
      doc.body.appendChild(canvas)
      const r = new CxRenderer(canvas)
      const id = sc.id
      const w = win
      // closed from its own title bar : it stays closed until asked for again
      const onGone = (): void => {
        const l = this.live.get(id)
        if (!l || l.win !== w) return
        this.live.delete(id)
        window.clearInterval(l.boundsTimer)
        l.r.dispose()
        // (an installation's screen never stays dark : it opens again, as its single output does)
        if (this.unattended) window.setTimeout(() => void this.sync(), 3000)
        else {
          this.dismissed.add(id)
          void this.sync()
        }
      }
      w.addEventListener('beforeunload', onGone)
      this.keys(w, id)
      const l: Live = { id, win: w, canvas, r, where, onGone, boundsTimer: d ? 0 : window.setInterval(() => void this.keepBounds(id), 3000) }
      this.live.set(id, l)
      return true
    } catch (e) {
      console.error('[complex] a screen could not open :', (e as Error).message)
      try {
        win?.close()
      } catch {
        /* gone already */
      }
      return false
    } finally {
      this.opening.delete(sc.id)
    }
  }

  /** Esc : a screen over the controls closes; elsewhere the keyboard goes back to
   *  them; an installation wants it held 1.5 s (as its single output). A file
   *  dropped on it does nothing. */
  private keys(w: Window, id: string): void {
    let hold = 0
    const exit = (e: KeyboardEvent): boolean => e.key === 'Escape' || e.key.toLowerCase() === 'o'
    w.addEventListener('keydown', (e) => {
      if (e.repeat) return
      if (this.unattended) {
        if (!exit(e)) return
        window.clearTimeout(hold)
        hold = window.setTimeout(() => void window.api.kioskExit(), 1500)
        return
      }
      if (e.key !== 'Escape') return
      const sc = useStore.getState().complexOut.screens.find((x) => x.id === id)
      const d = sc ? matchDisplay(sc, this.displays) : null
      if (d?.isControl) {
        this.dismissed.add(id)
        void this.sync()
      }
      void window.api.complexFocusControls()
    })
    w.addEventListener('keyup', (e) => { if (exit(e)) window.clearTimeout(hold) })
    w.addEventListener('blur', () => window.clearTimeout(hold))
    for (const t of ['dragover', 'drop'] as const) w.addEventListener(t, (e) => e.preventDefault())
    w.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  /** A plain window's place, kept without a step in the undo history. */
  private async keepBounds(id: string): Promise<void> {
    const b = await window.api.complexBounds(id).catch(() => null)
    const st = useStore.getState()
    const sc = st.complexOut.screens.find((x) => x.id === id)
    if (!b || !sc || sc.target.kind !== 'window' || this.draft) return
    const t = sc.target
    if (t.x === b.x && t.y === b.y && t.ww === b.w && t.wh === b.h) return
    runSilently(() => st.setComplexOut((s) => ({ ...s, screens: s.screens.map((x) => (x.id === id ? { ...x, target: { kind: 'window', x: b.x, y: b.y, ww: b.w, wh: b.h } } : x)) })))
  }

  private close(id: string): void {
    const l = this.live.get(id)
    if (!l) return
    this.live.delete(id)
    window.clearInterval(l.boundsTimer)
    l.win.removeEventListener('beforeunload', l.onGone)
    l.r.dispose()
    try {
      l.win.close()
    } catch {
      /* gone already */
    }
  }
  closeAll(): void {
    for (const id of [...this.live.keys()]) this.close(id)
  }
  isOpen(id: string): boolean {
    return this.live.has(id)
  }
  /** A screen's canvas (tests read its pixels). */
  canvasOf(id: string): HTMLCanvasElement | null {
    return this.live.get(id)?.canvas ?? null
  }

  addPreview(p: CxPreview): () => void {
    this.start()
    this.previews.add(p)
    return () => {
      this.previews.delete(p)
      p.renderer?.dispose()
      p.renderer = null
    }
  }

  /** Called every frame, before the engine draws it. */
  frame(comp: Compositor): void {
    if (!this.started) this.start()
    if (this.comp && this.comp !== comp) this.comp.cxTap = null
    this.comp = comp
    comp.cxTap = this.live.size || this.previews.size ? this.tap : null
  }

  private shownOf(sc: CxScreen, solo: boolean): CxSlice[] {
    return sc.slices.filter((l) => ((cxMods.get(cxModKey(l.id, 'on')) ?? (l.on ? 1 : 0)) >= 0.5) && (!solo || l.solo))
  }

  private tap = (put: (key: CxSource) => boolean, canvas: HTMLCanvasElement, show: number): void => {
    const t0 = performance.now()
    const setup = this.setup()
    const solo = setup.screens.some((s) => s.slices.some((l) => l.solo && l.on))
    let n = 0
    const tags = new Map<string, { n: number; rgb: [number, number, number] }>()
    for (const s of setup.screens) for (const l of s.slices) tags.set(l.id, { n: ++n, rgb: rgbOf(cxColorAt(n - 1)) })
    const jobs: Array<{ r: CxRenderer; sc: CxScreen; slices: CxSlice[]; opts: Partial<CxDrawOpts> }> = []
    const identify = t0 < this.identifyUntil
    for (const l of this.live.values()) {
      const i = setup.screens.findIndex((s) => s.id === l.id)
      if (i < 0 || l.win.closed) continue
      const sc = setup.screens[i]
      if (l.canvas.width !== sc.w || l.canvas.height !== sc.h) {
        l.canvas.width = sc.w
        l.canvas.height = sc.h
      }
      if (l.win.document.visibilityState === 'hidden') continue
      const on = (cxMods.get(cxModKey(sc.id, 'on')) ?? 1) >= 0.5
      jobs.push({ r: l.r, sc, slices: on ? this.shownOf(sc, solo) : [], opts: { identify: identify ? String(i + 1) : null } })
    }
    // the editor's views : every other frame while the screens play
    const views = !this.live.size || this.stats.frames % 2 === 0
    for (const p of views ? this.previews : []) {
      if (!p.canvas.isConnected || p.canvas.width < 4) continue
      const sc = p.screen()
      if (!sc) continue
      if (!p.renderer) p.renderer = new CxRenderer(p.canvas)
      jobs.push({ r: p.renderer, sc, slices: p.raw ? sc.slices : this.shownOf(sc, solo), opts: { identify: null } })
    }
    const wants = new Map<CxSource, CxRenderer[]>()
    for (const j of jobs) {
      const keys = new Set<CxSource>()
      for (const s of j.slices) if (!j.sc.card) keys.add(s.source)
      j.r.keepOnly(keys)
      for (const k of keys) {
        const a = wants.get(k)
        if (a) a.push(j.r)
        else wants.set(k, [j.r])
      }
    }
    for (const [key, rs] of wants) if (put(key)) for (const r of rs) r.upload(key, canvas)
    for (const j of jobs) {
      j.r.draw(j.sc, {
        slices: j.slices,
        brightness: cxMods.get(cxModKey(j.sc.id, 'brightness')) ?? j.sc.brightness,
        opacityOf: (s) => cxMods.get(cxModKey(s.id, 'opacity')) ?? s.opacity,
        show,
        identify: null,
        tag: (s) => tags.get(s.id) ?? { n: 0, rgb: [1, 1, 1] },
        ...j.opts
      })
    }
    const ms = performance.now() - t0
    this.stats.ms = ms
    this.stats.worst = Math.max(this.stats.worst, ms)
    this.stats.frames++
  }
}

export const cxRuntime = new CxRuntime()
// A hot update runs this module again : the old copy's windows close with it.
if (import.meta.hot) {
  const g = globalThis as { __opsiaComplex?: CxRuntime }
  g.__opsiaComplex?.closeAll()
  g.__opsiaComplex = cxRuntime
}
