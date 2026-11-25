// Complex Output : the editor's two views (what each slice takes, where it goes),
// outside React : one canvas the engine draws the picture on, one over it for the
// outlines and the handles. A drag works on a draft of the setup the screens show
// at once (cxWindows.ts) and is written in the store when the hand lets go : one
// undo step, no React in between.
//
// The page sits under a CSS zoom and in a second document : every pointer is mapped
// through getBoundingClientRect, every listener is on the view's own window.

import { CX_MAX_PTS, CX_MAX_SLICES, cxColorAt, newMask, newSlice, patchScreen, patchSlice, type CxMask, type CxScreen, type CxSetup, type CxSlice, type CxSource } from '@shared/complexOut'
import { outputCanvas } from '../engine/outputCanvas'
import { useStore } from '../store'
import { bounds, evalWarp, flattenMask, insidePoly, invWarp, mapPoints, maskOnScreen, movePoint, segDistance, warpOutline } from './cxMath'
import { cxSelection, pickSlice, useCxUi } from './cxUi'
import { cxRuntime, type CxPreview } from './cxWindows'

type Side = 'in' | 'out'
interface Handle {
  i: number
  x: number
  y: number
  kind: 'point' | 'handle' | 'corner'
  /** a Bezier handle's knot, to draw the line to it */
  from?: number
}
interface Box {
  x: number
  y: number
  w: number
  h: number
}
type Drag =
  | { kind: 'pan'; px: number; py: number; vx: number; vy: number }
  | { kind: 'points'; base: CxSetup; idx: number[]; at: number; x0: number; y0: number; moved: boolean }
  | { kind: 'body'; base: CxSetup; x0: number; y0: number; moved: boolean }
  | { kind: 'scale'; base: CxSetup; box: Box; hx: number; hy: number; moved: boolean }
  | { kind: 'turn'; base: CxSetup; box: Box; a0: number; moved: boolean }
  | { kind: 'band'; x0: number; y0: number; x1: number; y1: number }

const GRAB = 9
const SNAP = 7
const PREVIEW_MAX = 1600

/** Put a new setup in (one undo step), from anywhere in the editor. */
export const commit = (f: (s: CxSetup) => CxSetup): void => useStore.getState().setComplexOut(f)

// ── Reading and writing the outline in hand ─────────────────────────────
/** The slice's handles on one side. */
function sliceHandles(s: CxSlice, side: Side, sel: Set<number>): Handle[] {
  const P = side === 'in' ? s.input : s.warp.pts
  const w = s.warp
  if (side === 'in' || w.type !== 'bezier') {
    const out: Handle[] = []
    for (let i = 0; i < P.length / 2; i++) out.push({ i, x: P[i * 2], y: P[i * 2 + 1], kind: 'point' })
    return out
  }
  const n = 3 * w.cols + 1, m = 3 * w.rows + 1
  const out: Handle[] = []
  const few = w.cols * w.rows <= 4
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      const kc = c % 3 === 0, kr = r % 3 === 0, i = r * n + c
      if (kc && kr) out.push({ i, x: P[i * 2], y: P[i * 2 + 1], kind: 'point' })
      else if (kc !== kr) {
        const from = kr ? r * n + (c % 3 === 1 ? c - 1 : c + 1) : (r % 3 === 1 ? r - 1 : r + 1) * n + c
        if (few || sel.has(from) || sel.has(i)) out.push({ i, x: P[i * 2], y: P[i * 2 + 1], kind: 'handle', from })
      }
    }
  }
  return out
}

/** What is in hand, as a list of points and a way to put other ones. */
interface Hold {
  pts: number[]
  handles: (sel: Set<number>) => Handle[]
  /** points moved by (dx, dy) in this view's 0..1 */
  move: (s: CxSetup, base: CxSetup, idx: number[], dx: number, dy: number, at: number, alt: boolean) => CxSetup
  put: (s: CxSetup, pts: number[]) => CxSetup
  line: number[]
  color: string
}

const setMask = (s: CxSetup, screen: string, slice: string | null, id: string, pts: number[]): CxSetup => {
  const f = (l: CxMask[]): CxMask[] => l.map((m) => (m.id === id ? { ...m, pts } : m))
  const sc = s.screens.find((x) => x.id === screen)
  if (!sc) return s
  return slice ? patchSlice(s, slice, { masks: f(sc.slices.find((l) => l.id === slice)?.masks ?? []) }) : patchScreen(s, screen, { masks: f(sc.masks) })
}

export class CxView {
  readonly gl: HTMLCanvasElement
  readonly over: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private win: Window
  private raf = 0
  private z = 1
  private px = 0
  private py = 0
  private drag: Drag | null = null
  private hover: { x: number; y: number } | null = null
  private guides: { x: number[]; y: number[] } = { x: [], y: [] }
  private note = ''
  private space = false
  private last: unknown[] = []
  private dirty = true
  private offs: Array<() => void> = []
  private preview: CxPreview
  private inScreen: { key: string; screen: CxScreen } | null = null

  constructor(private host: HTMLElement, readonly side: Side) {
    const doc = host.ownerDocument
    this.win = doc.defaultView ?? window
    this.gl = doc.createElement('canvas')
    this.over = doc.createElement('canvas')
    this.gl.style.cssText = 'position:absolute;background:#000;pointer-events:none'
    this.over.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline:none'
    this.over.tabIndex = 0
    host.append(this.gl, this.over)
    this.ctx = this.over.getContext('2d')!
    this.preview = { canvas: this.gl, renderer: null, screen: () => this.previewScreen(), raw: side === 'in' }
    this.offs.push(cxRuntime.addPreview(this.preview))
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions): void => {
      this.over.addEventListener(t, f as EventListener, o)
      this.offs.push(() => this.over.removeEventListener(t, f as EventListener))
    }
    on('pointerdown', (e) => this.down(e))
    on('pointermove', (e) => this.moveTo(e))
    on('pointerup', (e) => this.up(e))
    on('pointercancel', (e) => this.up(e))
    on('lostpointercapture', () => this.finish())
    on('pointerleave', () => { this.hover = null; this.dirty = true })
    on('dblclick', (e) => this.double(e))
    on('contextmenu', (e) => e.preventDefault())
    on('wheel', (e) => this.wheel(e), { passive: false })
    on('keydown', (e) => this.key(e))
    on('keyup', (e) => { if (e.key === ' ') { this.space = false; this.dirty = true } })
    on('blur', () => { this.space = false })
    const ro = new ResizeObserver(() => { this.dirty = true })
    ro.observe(host)
    this.offs.push(() => ro.disconnect())
    const loop = (): void => {
      this.raf = this.win.requestAnimationFrame(loop)
      this.paint()
    }
    this.raf = this.win.requestAnimationFrame(loop)
  }

  dispose(): void {
    this.finish()
    try {
      this.win.cancelAnimationFrame(this.raf)
    } catch {
      /* its window is gone */
    }
    for (const f of this.offs) f()
    this.gl.remove()
    this.over.remove()
  }

  fit(): void {
    this.z = 1
    this.px = this.py = 0
    this.dirty = true
  }

  // ── What is shown ──
  private sel(): ReturnType<typeof cxSelection> {
    return cxSelection(cxRuntime.setup(), useCxUi.getState())
  }
  private source(): CxSource {
    const { slice, screen } = this.sel()
    return slice?.source ?? screen?.slices[0]?.source ?? 'master'
  }
  private size(): { w: number; h: number } {
    if (this.side === 'in') {
      const c = outputCanvas()
      return { w: c?.width || 1920, h: c?.height || 1080 }
    }
    const sc = this.sel().screen
    return { w: sc?.w ?? 1920, h: sc?.h ?? 1080 }
  }
  private previewScreen(): CxScreen | null {
    const { screen } = this.sel()
    if (this.side === 'out') return screen
    const { w, h } = this.size(), source = this.source()
    const key = `${w}x${h}:${source}`
    if (this.inScreen?.key !== key) {
      const l = newSlice('source', { source })
      this.inScreen = { key, screen: { id: 'in', name: '', on: true, w, h, target: { kind: 'none' }, card: false, slices: [l], masks: [], brightness: 1, contrast: 1, gamma: 1, r: 1, g: 1, b: 1 } }
    }
    return this.inScreen.screen
  }

  /** The picture's box in this view, in the view's own layout px. */
  private box(): Box {
    const vw = this.over.clientWidth, vh = this.over.clientHeight
    const { w, h } = this.size()
    const m = Math.min(28, vw * 0.06, vh * 0.06)
    const k = Math.max(0.0001, Math.min((vw - 2 * m) / w, (vh - 2 * m) / h)) * this.z
    return { x: vw / 2 - (w * k) / 2 + this.px, y: vh / 2 - (h * k) / 2 + this.py, w: w * k, h: h * k }
  }
  private point(e: { clientX: number; clientY: number }): { x: number; y: number; vx: number; vy: number } {
    const r = this.over.getBoundingClientRect()
    const vx = (e.clientX - r.left) * (this.over.clientWidth / Math.max(1, r.width)), vy = (e.clientY - r.top) * (this.over.clientHeight / Math.max(1, r.height))
    const b = this.box()
    return { x: (vx - b.x) / b.w, y: (vy - b.y) / b.h, vx, vy }
  }

  /** The thing in hand on this side. */
  private hold(setup: CxSetup = cxRuntime.setup()): Hold | null {
    const ui = useCxUi.getState()
    const { screen, slice, mask, maskOf } = cxSelection(setup, ui)
    if (!screen) return null
    if (mask && this.side === 'out') {
      const of = maskOf === 'slice' ? slice : null
      const warp = of?.warp ?? null
      const toView = (x: number, y: number): [number, number] => (warp ? evalWarp(warp, x, y) : [x, y])
      const fromView = (x: number, y: number): [number, number] => (warp ? invWarp(warp, x, y, true) ?? [x, y] : [x, y])
      const shown = mapPoints(mask.pts, toView)
      return {
        pts: shown,
        line: warp ? maskOnScreen(warp, mask) : flattenMask(mask),
        color: mask.mode === 'add' ? '#7dff9a' : '#ffffff',
        handles: () => Array.from({ length: shown.length / 2 }, (_, i) => ({ i, x: shown[i * 2], y: shown[i * 2 + 1], kind: 'point' as const })),
        move: (s, _base, idx, dx, dy) => {
          const p = [...mask.pts]
          for (const i of idx) {
            const q = fromView(shown[i * 2] + dx, shown[i * 2 + 1] + dy)
            p[i * 2] = q[0]
            p[i * 2 + 1] = q[1]
          }
          return setMask(s, screen.id, of?.id ?? null, mask.id, p)
        },
        put: (s, p) => setMask(s, screen.id, of?.id ?? null, mask.id, mapPoints(p, fromView))
      }
    }
    if (!slice || mask) return null
    const side = this.side
    const color = cxColorAt(this.number(setup, slice.id) - 1)
    const key = side === 'in' ? 'input' : 'warp'
    const pts = side === 'in' ? slice.input : slice.warp.pts
    const write = (s: CxSetup, p: number[]): CxSetup => patchSlice(s, slice.id, key === 'input' ? { input: p } : { warp: { ...slice.warp, pts: p } })
    return {
      pts,
      line: side === 'in' ? slice.input : warpOutline(slice.warp),
      color,
      handles: (sel) => sliceHandles(slice, side, sel),
      move: (s, _base, idx, dx, dy, at, alt) => {
        if (side === 'in' && slice.inKind === 'rect' && !alt && idx.length === 1) {
          // the corner opposite stays : the rectangle follows
          const b = bounds(slice.input)
          const right = at === 1 || at === 2, low = at === 2 || at === 3
          const x = (right ? b.x + b.w : b.x) + dx, y = (low ? b.y + b.h : b.y) + dy
          const fx = right ? b.x : b.x + b.w, fy = low ? b.y : b.y + b.h
          const x0 = Math.min(x, fx), x1 = Math.max(x, fx), y0 = Math.min(y, fy), y1 = Math.max(y, fy)
          return write(s, [x0, y0, x1, y0, x1, y1, x0, y1])
        }
        if (side === 'in') {
          const p = [...slice.input]
          for (const i of idx) {
            p[i * 2] += dx
            p[i * 2 + 1] += dy
          }
          const q = write(s, p)
          return slice.inKind === 'rect' && idx.length < 4 ? patchSlice(q, slice.id, { inKind: 'quad' }) : q
        }
        let w = slice.warp
        // (a Bezier knot brings its handles : never moved twice)
        const n = 3 * w.cols + 1
        const knots = w.type === 'bezier' ? idx.filter((i) => (i % n) % 3 === 0 && Math.floor(i / n) % 3 === 0) : idx
        for (const i of knots.length ? knots : idx) w = movePoint(w, i, dx, dy, alt)
        return patchSlice(s, slice.id, { warp: w })
      },
      put: write
    }
  }
  private number(s: CxSetup, id: string): number {
    let n = 0
    for (const sc of s.screens) for (const l of sc.slices) { n++; if (l.id === id) return n }
    return 0
  }

  // ── Snapping ──
  private snapTo(xs: number[], ys: number[], off: boolean): { dx: number; dy: number } {
    this.guides = { x: [], y: [] }
    const ui = useCxUi.getState()
    if (off || !ui.snap) return { dx: 0, dy: 0 }
    const b = this.box()
    const { screen, slice, mask } = this.sel()
    const cx = [0, 0.5, 1], cy = [0, 0.5, 1]
    for (const l of screen?.slices ?? []) {
      if (l.id === slice?.id && !mask) continue
      const p = this.side === 'in' ? l.input : l.warp.type === 'bezier' ? warpOutline({ ...l.warp, type: 'corners', cols: 1, rows: 1, pts: [evalWarp(l.warp, 0, 0), evalWarp(l.warp, 1, 0), evalWarp(l.warp, 1, 1), evalWarp(l.warp, 0, 1)].flat() }) : l.warp.pts
      if (p.length > 400) continue
      for (let i = 0; i < p.length; i += 2) {
        cx.push(p[i])
        cy.push(p[i + 1])
      }
    }
    if (this.side === 'in') {
      // the other screens' inputs too : a picture split over projectors meets edge to edge
      for (const sc of cxRuntime.setup().screens) if (sc !== screen) for (const l of sc.slices) { const q = bounds(l.input); cx.push(q.x, q.x + q.w); cy.push(q.y, q.y + q.h) }
    }
    const best = (vals: number[], to: number[], size: number): { d: number; at: number | null } => {
      let d = SNAP / size, at: number | null = null
      for (const v of vals) for (const t of to) if (Math.abs(t - v) < Math.abs(d)) { d = t - v; at = t }
      return at === null ? { d: 0, at } : { d, at }
    }
    const x = best(xs, cx, b.w), y = best(ys, cy, b.h)
    if (x.at !== null) this.guides.x.push(x.at)
    if (y.at !== null) this.guides.y.push(y.at)
    return { dx: x.d, dy: y.d }
  }

  // ── Pointer ──
  private down(e: PointerEvent): void {
    this.over.focus({ preventScroll: true })
    const ui = useCxUi.getState()
    if (ui.side !== this.side) ui.set({ side: this.side, pts: [] })
    const p = this.point(e)
    if (e.button === 1 || (e.button === 0 && this.space)) {
      this.over.setPointerCapture(e.pointerId)
      this.drag = { kind: 'pan', px: p.vx, py: p.vy, vx: this.px, vy: this.py }
      e.preventDefault()
      return
    }
    if (e.button !== 0) return
    if (ui.draw && this.side === 'out') {
      this.drawPoint(p.x, p.y)
      return
    }
    this.over.setPointerCapture(e.pointerId)
    const b = this.box()
    const base = useStore.getState().complexOut
    const h = this.hold()
    const { screen, slice } = this.sel()
    const locked = !!slice?.locked && !ui.mask
    if (h && !locked) {
      if (ui.tool === 'transform' && !ui.mask) {
        const g = this.gizmo(h)
        if (g) {
          if (Math.hypot(p.vx - g.turn.x, p.vy - g.turn.y) < GRAB + 2) {
            const q = g.box
            this.drag = { kind: 'turn', base, box: q, a0: this.angle(p, q), moved: false }
            return
          }
          const hit = g.grips.find((k) => Math.hypot(p.vx - k.vx, p.vy - k.vy) < GRAB)
          if (hit) {
            this.drag = { kind: 'scale', base, box: g.box, hx: hit.hx, hy: hit.hy, moved: false }
            return
          }
        }
      } else {
        const sel = new Set(ui.pts)
        let best: Handle | null = null, bd = GRAB
        for (const k of h.handles(sel)) {
          const d = Math.hypot(p.vx - (b.x + k.x * b.w), p.vy - (b.y + k.y * b.h)) - (k.kind === 'handle' ? 0 : 0.5)
          if (d < bd) { bd = d; best = k }
        }
        if (best) {
          const i = best.i
          let idx = ui.pts
          if (e.shiftKey && !sel.has(i)) idx = [...idx, i]
          else if (!sel.has(i)) idx = [i]
          ui.set({ pts: idx })
          this.drag = { kind: 'points', base, idx, at: i, x0: p.x, y0: p.y, moved: false }
          return
        }
      }
      if (insidePoly(h.line, p.x, p.y) || this.onLine(h.line, p.x, p.y)) {
        if (!e.shiftKey) ui.set({ pts: [] })
        this.drag = { kind: 'body', base, x0: p.x, y0: p.y, moved: false }
        return
      }
    }
    // another slice, the one on top first
    const under = [...(screen?.slices ?? [])].reverse().find((l) => (this.side === 'in' ? l.source === this.source() : l.on) && insidePoly(this.side === 'in' ? l.input : warpOutline(l.warp), p.x, p.y))
    if (under) {
      pickSlice(under.id)
      if (!under.locked) this.drag = { kind: 'body', base, x0: p.x, y0: p.y, moved: false }
      return
    }
    this.drag = { kind: 'band', x0: p.x, y0: p.y, x1: p.x, y1: p.y }
  }

  /** On the outline itself (a hair outside it is still it : a double click there adds a point). */
  private onLine(line: number[], x: number, y: number): boolean {
    const b = this.box(), n = line.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) if (segDistance(x * b.w, y * b.h, line[j * 2] * b.w, line[j * 2 + 1] * b.h, line[i * 2] * b.w, line[i * 2 + 1] * b.h) < GRAB - 2) return true
    return false
  }

  private angle(p: { x: number; y: number }, q: Box): number {
    const b = this.box()
    return Math.atan2((p.y - q.y - q.h / 2) * b.h, (p.x - q.x - q.w / 2) * b.w)
  }

  private moveTo(e: PointerEvent): void {
    const p = this.point(e)
    this.hover = { x: p.x, y: p.y }
    const d = this.drag
    this.dirty = true
    if (!d) return
    if (d.kind === 'pan') {
      this.px = d.vx + p.vx - d.px
      this.py = d.vy + p.vy - d.py
      return
    }
    if (d.kind === 'band') {
      d.x1 = p.x
      d.y1 = p.y
      return
    }
    const b = this.box()
    if (!d.moved && (d.kind === 'points' || d.kind === 'body') && Math.hypot((p.x - d.x0) * b.w, (p.y - d.y0) * b.h) < 3) return
    d.moved = true
    const h = this.hold(d.base)
    if (!h) return
    const size = this.size()
    const off = e.ctrlKey || e.metaKey
    if (d.kind === 'points' || d.kind === 'body') {
      let dx = p.x - d.x0, dy = p.y - d.y0
      if (e.shiftKey) {
        if (Math.abs(dx * b.w) > Math.abs(dy * b.h)) dy = 0
        else dx = 0
      }
      if (d.kind === 'points') {
        const at = { x: h.pts[d.at * 2] + dx, y: h.pts[d.at * 2 + 1] + dy }
        const s = this.snapTo([at.x], [at.y], off)
        if (!e.shiftKey || dx) dx += s.dx
        if (!e.shiftKey || dy) dy += s.dy
        // whole pixels, as every number shows them
        const q = { x: Math.round((h.pts[d.at * 2] + dx) * size.w * 4) / 4 / size.w, y: Math.round((h.pts[d.at * 2 + 1] + dy) * size.h * 4) / 4 / size.h }
        if (dx) dx = q.x - h.pts[d.at * 2]
        if (dy) dy = q.y - h.pts[d.at * 2 + 1]
        cxRuntime.draft = h.move(d.base, d.base, d.idx, dx, dy, d.at, e.altKey)
        this.note = `${(q.x * size.w).toFixed(2).replace(/\.?0+$/, '')}, ${(q.y * size.h).toFixed(2).replace(/\.?0+$/, '')}`
      } else {
        const q = bounds(h.line)
        const s = this.snapTo([q.x + dx, q.x + q.w / 2 + dx, q.x + q.w + dx], [q.y + dy, q.y + q.h / 2 + dy, q.y + q.h + dy], off)
        if (!e.shiftKey || dx) dx += s.dx
        if (!e.shiftKey || dy) dy += s.dy
        if (!this.guides.x.length && dx) dx = Math.round(dx * size.w) / size.w
        if (!this.guides.y.length && dy) dy = Math.round(dy * size.h) / size.h
        cxRuntime.draft = h.put(d.base, mapPoints(h.pts, (x, y) => [x + dx, y + dy]))
        this.note = `${Math.round((q.x + dx) * size.w)}, ${Math.round((q.y + dy) * size.h)}`
      }
      return
    }
    const q = d.box
    if (d.kind === 'scale') {
      const cx = q.x + q.w / 2, cy = q.y + q.h / 2
      const ax = e.altKey ? cx : d.hx < 0 ? q.x + q.w : q.x, ay = e.altKey ? cy : d.hy < 0 ? q.y + q.h : q.y
      const s = this.snapTo(d.hx ? [p.x] : [], d.hy ? [p.y] : [], off)
      const ex = d.hx < 0 ? q.x : q.x + q.w, ey = d.hy < 0 ? q.y : q.y + q.h
      let kx = d.hx ? (p.x + s.dx - ax) / (ex - ax || 1e-9) : 1, ky = d.hy ? (p.y + s.dy - ay) / (ey - ay || 1e-9) : 1
      if (e.shiftKey && d.hx && d.hy) kx = ky = Math.abs(kx) > Math.abs(ky) ? kx : ky
      kx = Math.abs(kx) < 0.002 ? 0.002 : kx
      ky = Math.abs(ky) < 0.002 ? 0.002 : ky
      cxRuntime.draft = h.put(d.base, mapPoints(h.pts, (x, y) => [ax + (x - ax) * kx, ay + (y - ay) * ky]))
      this.note = `${Math.round(q.w * Math.abs(kx) * size.w)} × ${Math.round(q.h * Math.abs(ky) * size.h)}`
    } else {
      this.guides = { x: [], y: [] }
      let a = this.angle(p, q) - d.a0
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12)
      const cx = (q.x + q.w / 2) * size.w, cy = (q.y + q.h / 2) * size.h, co = Math.cos(a), si = Math.sin(a)
      cxRuntime.draft = h.put(d.base, mapPoints(h.pts, (x, y) => {
        const ux = x * size.w - cx, uy = y * size.h - cy
        return [(cx + ux * co - uy * si) / size.w, (cy + ux * si + uy * co) / size.h]
      }))
      this.note = `${((a * 180) / Math.PI).toFixed(1)}°`
    }
  }

  private up(e: PointerEvent): void {
    const d = this.drag
    if (d?.kind === 'band') {
      const b = this.box()
      const small = Math.hypot((d.x1 - d.x0) * b.w, (d.y1 - d.y0) * b.h) < 4
      const h = this.hold()
      const ui = useCxUi.getState()
      if (small) {
        if (ui.mask || ui.pts.length) ui.set({ pts: [], mask: null })
        else if (ui.slice) ui.set({ slice: null })
      } else if (h) {
        const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1)
        const got = h.handles(new Set(ui.pts)).filter((k) => k.kind === 'point' && k.x >= x0 && k.x <= x1 && k.y >= y0 && k.y <= y1).map((k) => k.i)
        ui.set({ pts: e.shiftKey ? [...new Set([...ui.pts, ...got])] : got })
      }
    }
    this.finish()
  }
  /** The hand let go : the draft becomes the setup (one step). */
  private finish(): void {
    if (!this.drag) return
    const d = this.drag
    this.drag = null
    this.guides = { x: [], y: [] }
    this.note = ''
    this.dirty = true
    const draft = cxRuntime.draft
    cxRuntime.draft = null
    if (draft && d.kind !== 'pan' && d.kind !== 'band') {
      // (what moved meanwhile elsewhere, a fader over OSC, is kept : only this thing is taken from the draft)
      const { screen, slice, mask, maskOf } = this.sel()
      if (!screen) return
      const from = draft.screens.find((s) => s.id === screen.id)
      if (!from) return
      commit((s) => {
        if (mask && maskOf === 'screen') return patchScreen(s, screen.id, { masks: from.masks })
        const l = from.slices.find((x) => x.id === slice?.id)
        return l ? patchSlice(s, l.id, { input: l.input, inKind: l.inKind, warp: l.warp, masks: l.masks }) : s
      })
    }
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault()
    e.stopPropagation()
    const p = this.point(e)
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016))
    const z = Math.min(60, Math.max(0.2, this.z * k))
    this.z = z
    // the point under the pointer stays there
    const b = this.box()
    this.px += p.vx - (b.x + p.x * b.w)
    this.py += p.vy - (b.y + p.y * b.h)
    this.dirty = true
  }

  // ── Outlines : adding, drawing, taking points away ──
  private double(e: MouseEvent): void {
    const ui = useCxUi.getState()
    if (ui.draw) {
      this.endDraw(true)
      return
    }
    const p = this.point(e)
    const b = this.box()
    const { slice, mask, maskOf, screen } = this.sel()
    const near = (line: number[]): { i: number; x: number; y: number } | null => {
      let best = GRAB, hit: { i: number; x: number; y: number } | null = null
      const n = line.length / 2
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        const ax = line[i * 2] * b.w, ay = line[i * 2 + 1] * b.h, cx = line[j * 2] * b.w, cy = line[j * 2 + 1] * b.h
        const d = segDistance(p.x * b.w, p.y * b.h, ax, ay, cx, cy)
        if (d < best) {
          best = d
          const k = Math.min(1, Math.max(0, ((p.x * b.w - ax) * (cx - ax) + (p.y * b.h - ay) * (cy - ay)) / Math.max(1e-9, (cx - ax) ** 2 + (cy - ay) ** 2)))
          hit = { i, x: k, y: 0 }
        }
      }
      return hit
    }
    const insert = (pts: number[], i: number, k: number): number[] => {
      const j = (i + 1) % (pts.length / 2)
      const o = [...pts]
      o.splice((i + 1) * 2, 0, pts[i * 2] + (pts[j * 2] - pts[i * 2]) * k, pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * k)
      return o
    }
    const h = this.hold()
    if (h && screen && mask && this.side === 'out' && mask.pts.length < CX_MAX_PTS * 2) {
      const n = near(h.pts)
      if (n) {
        const pts = insert(mask.pts, n.i, n.x)
        commit((s) => setMask(s, screen.id, maskOf === 'slice' ? slice!.id : null, mask.id, pts))
        ui.set({ pts: [n.i + 1] })
        return
      }
    }
    if (h && slice && !mask && slice.warp.type === 'poly' && !slice.locked && slice.input.length < CX_MAX_PTS * 2) {
      const n = near(h.pts)
      if (n) {
        commit((s) => patchSlice(s, slice.id, { input: insert(slice.input, n.i, n.x), warp: { ...slice.warp, pts: insert(slice.warp.pts, n.i, n.x) } }))
        ui.set({ pts: [n.i + 1] })
        return
      }
    }
    if (!h || !insidePoly(h.line, p.x, p.y)) this.fit()
  }

  private drawPoint(x: number, y: number): void {
    const ui = useCxUi.getState()
    const d = ui.draw
    if (!d) return
    const b = this.box()
    const s = this.snapTo([x], [y], false)
    const q = [x + s.dx, y + s.dy]
    if (d.pts.length >= 6 && Math.hypot((d.pts[0] - x) * b.w, (d.pts[1] - y) * b.h) < GRAB) {
      this.endDraw(true)
      return
    }
    if (d.pts.length < CX_MAX_PTS * 2) ui.set({ draw: { ...d, pts: [...d.pts, q[0], q[1]] } })
    this.guides = { x: [], y: [] }
    this.dirty = true
  }
  private endDraw(keep: boolean): void {
    const ui = useCxUi.getState()
    const d = ui.draw
    ui.set({ draw: null })
    this.dirty = true
    if (!d || !keep) return
    // a double click put its point twice
    const pts = d.pts.filter((_, i) => {
      const k = i - (i % 2)
      return k < 2 || Math.hypot(d.pts[k] - d.pts[k - 2], d.pts[k + 1] - d.pts[k - 1]) > 1e-4
    })
    if (pts.length < 6) return
    const { screen, slice } = this.sel()
    if (!screen) return
    if (d.kind === 'poly') {
      const l = newSlice(`Polygon ${screen.slices.filter((x) => x.warp.type === 'poly').length + 1}`, { inKind: 'poly', input: [...pts], warp: { type: 'poly', cols: 1, rows: 1, pts }, source: slice?.source ?? 'master' })
      if (screen.slices.length < CX_MAX_SLICES) commit((s) => patchScreen(s, screen.id, { slices: [...s.screens.find((x) => x.id === screen.id)!.slices, l] }))
      pickSlice(l.id)
    } else addMask(slice ? mapPoints(pts, (x, y) => invWarp(slice.warp, x, y, true) ?? [x, y]) : pts)
  }

  // ── Keys (this view has the focus) ──
  private key(e: KeyboardEvent): void {
    const ui = useCxUi.getState()
    const take = (): void => {
      e.preventDefault()
      e.stopPropagation() // not the instrument's
    }
    if (e.key === ' ') {
      this.space = true
      this.dirty = true
      take()
      return
    }
    if (ui.draw) {
      if (e.key === 'Enter') { this.endDraw(true); take() }
      else if (e.key === 'Escape') { this.endDraw(false); take() }
      else if (e.key === 'Backspace') { ui.set({ draw: { ...ui.draw, pts: ui.draw.pts.slice(0, -2) } }); take() }
      return
    }
    if (e.key === 'Escape') {
      if (this.drag) {
        cxRuntime.draft = null
        this.drag = null
        this.guides = { x: [], y: [] }
        this.note = ''
        this.dirty = true
      } else if (ui.pts.length) ui.set({ pts: [] })
      else if (ui.mask) ui.set({ mask: null })
      else if (ui.slice) ui.set({ slice: null })
      take()
      return
    }
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (arrow && !e.ctrlKey && !e.metaKey) {
      const h = this.hold()
      const { slice } = this.sel()
      if (h && (!slice?.locked || ui.mask)) {
        const size = this.size(), k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
        const dx = (arrow[0] * k) / size.w, dy = (arrow[1] * k) / size.h
        commit((s) => (ui.pts.length ? h.move(s, s, ui.pts, dx, dy, ui.pts[0], true) : h.put(s, mapPoints(h.pts, (x, y) => [x + dx, y + dy]))))
      }
      take()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteInHand()
      take()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      duplicateInHand()
      take()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      const h = this.hold()
      if (h) ui.set({ pts: h.handles(new Set()).filter((k) => k.kind === 'point').map((k) => k.i) })
      take()
    }
  }

  // ── Drawing the overlay ──
  private gizmo(h: Hold): { box: Box; turn: { x: number; y: number }; grips: Array<{ hx: number; hy: number; vx: number; vy: number }> } | null {
    const q = bounds(h.line), b = this.box()
    if (!(q.w >= 0)) return null
    const X = (x: number): number => b.x + x * b.w, Y = (y: number): number => b.y + y * b.h
    const grips: Array<{ hx: number; hy: number; vx: number; vy: number }> = []
    for (const hy of [-1, 0, 1]) for (const hx of [-1, 0, 1]) if (hx || hy) grips.push({ hx, hy, vx: X(q.x + (q.w * (hx + 1)) / 2), vy: Y(q.y + (q.h * (hy + 1)) / 2) })
    return { box: q, turn: { x: X(q.x + q.w / 2), y: Y(q.y) - 26 }, grips }
  }

  private paint(): void {
    const ui = useCxUi.getState()
    const setup = cxRuntime.setup()
    const r = this.over.getBoundingClientRect()
    const now = [setup, ui, r.width, r.height, this.z, this.px, this.py, this.size().w, this.size().h, this.win.devicePixelRatio]
    if (!this.dirty && now.length === this.last.length && now.every((v, i) => v === this.last[i])) return
    this.last = now
    this.dirty = false
    const b = this.box()
    const g = this.gl.style
    g.left = `${b.x}px`
    g.top = `${b.y}px`
    g.width = `${b.w}px`
    g.height = `${b.h}px`
    const dpr = this.win.devicePixelRatio || 1
    const shown = (r.width / Math.max(1, this.over.clientWidth)) * dpr
    const size = this.size()
    const k = Math.min(1, (b.w * shown) / size.w, PREVIEW_MAX / Math.max(size.w, size.h))
    const gw = Math.max(16, Math.round(size.w * k)), gh = Math.max(16, Math.round(size.h * k))
    if (this.gl.width !== gw || this.gl.height !== gh) {
      this.gl.width = gw
      this.gl.height = gh
    }
    const pw = Math.max(1, Math.round(r.width * dpr)), ph = Math.max(1, Math.round(r.height * dpr))
    if (this.over.width !== pw || this.over.height !== ph) {
      this.over.width = pw
      this.over.height = ph
    }
    const c = this.ctx
    const s = pw / Math.max(1, this.over.clientWidth)
    c.setTransform(s, 0, 0, s, 0, 0)
    c.clearRect(0, 0, this.over.clientWidth, this.over.clientHeight)
    const X = (x: number): number => b.x + x * b.w, Y = (y: number): number => b.y + y * b.h
    const path = (p: number[], close = true): void => {
      c.beginPath()
      for (let i = 0; i < p.length; i += 2) c.lineTo(X(p[i]), Y(p[i + 1]))
      if (close) c.closePath()
    }
    c.strokeStyle = 'rgba(255,255,255,0.35)'
    c.lineWidth = 1
    c.strokeRect(Math.round(b.x) - 0.5, Math.round(b.y) - 0.5, Math.round(b.w) + 1, Math.round(b.h) + 1)
    const { screen, slice, mask } = cxSelection(setup, ui)
    if (!screen) return
    const src = this.source()
    const label = (t: string, x: number, y: number, color: string, on: boolean): void => {
      c.font = '600 11px ui-monospace, Consolas, monospace'
      const w = c.measureText(t).width + 8
      c.fillStyle = on ? color : 'rgba(0,0,0,0.65)'
      c.fillRect(x - w / 2, y - 8, w, 16)
      c.fillStyle = on ? '#000' : color
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(t, x, y + 0.5)
    }
    const one = (l: CxSlice, sel: boolean, faint: boolean): void => {
      const color = cxColorAt(this.number(setup, l.id) - 1)
      const p = this.side === 'in' ? l.input : warpOutline(l.warp)
      c.globalAlpha = faint ? 0.25 : l.on ? 1 : 0.4
      c.setLineDash(l.on ? [] : [5, 4])
      path(p)
      if (sel) {
        c.lineWidth = 3.5
        c.strokeStyle = 'rgba(0,0,0,0.6)'
        c.stroke()
      }
      c.strokeStyle = color
      c.lineWidth = sel ? 1.75 : 1
      c.stroke()
      c.setLineDash([])
      if (!faint) {
        const q = bounds(p)
        label(`${this.number(setup, l.id)}${sel ? ` ${l.name}` : ''}${l.locked ? ' 🔒' : ''}`, X(q.x + q.w / 2), Y(q.y + q.h / 2), color, sel)
        if (this.side === 'in' && sel && l.inKind !== 'poly') {
          // which corner is the slice's first
          const a = l.input
          c.fillStyle = color
          c.beginPath()
          c.moveTo(X(a[0]), Y(a[1]))
          c.lineTo(X(a[0] + (a[2] - a[0]) * 0.06), Y(a[1] + (a[3] - a[1]) * 0.06))
          c.lineTo(X(a[0] + (a[6] - a[0]) * 0.06), Y(a[1] + (a[7] - a[1]) * 0.06))
          c.fill()
        }
      }
      c.globalAlpha = 1
    }
    if (this.side === 'in') {
      for (const sc of setup.screens) if (sc !== screen) for (const l of sc.slices) if (l.source === src && l.on) one(l, false, true)
    }
    for (const l of screen.slices) if (l.id !== slice?.id) one(l, false, this.side === 'in' && l.source !== src)
    if (slice) {
      one(slice, true, false)
      if (this.side === 'out') this.sliceLines(slice, X, Y, path)
    }
    // masks : the screen's, and the slice's in hand
    if (this.side === 'out') {
      const line = (m: CxMask, p: number[]): void => {
        c.setLineDash([6, 4])
        c.globalAlpha = m.on ? (m.id === mask?.id ? 1 : 0.6) : 0.25
        path(p)
        c.lineWidth = 3
        c.strokeStyle = 'rgba(0,0,0,0.55)'
        c.stroke()
        c.lineWidth = 1.25
        c.strokeStyle = m.mode === 'add' ? '#7dff9a' : '#ffffff'
        c.stroke()
        c.setLineDash([])
        c.globalAlpha = 1
      }
      for (const m of screen.masks) line(m, flattenMask(m))
      for (const m of slice?.masks ?? []) line(m, maskOnScreen(slice!.warp, m))
    }
    const h = this.hold()
    if (h && !(slice?.locked && !mask)) {
      if (ui.tool === 'transform' && !mask) {
        const z = this.gizmo(h)
        if (z) {
          c.strokeStyle = '#fff'
          c.lineWidth = 1
          c.setLineDash([3, 3])
          c.strokeRect(X(z.box.x), Y(z.box.y), z.box.w * b.w, z.box.h * b.h)
          c.setLineDash([])
          c.beginPath()
          c.moveTo(z.turn.x, z.turn.y)
          c.lineTo(z.turn.x, Y(z.box.y))
          c.stroke()
          c.fillStyle = h.color
          for (const k of z.grips) { c.fillRect(k.vx - 4, k.vy - 4, 8, 8); c.strokeRect(k.vx - 4, k.vy - 4, 8, 8) }
          c.beginPath()
          c.arc(z.turn.x, z.turn.y, 5, 0, 7)
          c.fill()
          c.stroke()
        }
      } else {
        const active = ui.side === this.side
        const sel = new Set(active ? ui.pts : [])
        const hs = h.handles(sel)
        const by = new Map(hs.map((k) => [k.i, k]))
        c.lineWidth = 1
        for (const k of hs) {
          if (k.kind !== 'handle' || k.from === undefined) continue
          const f = by.get(k.from)
          if (!f) continue
          c.strokeStyle = 'rgba(255,255,255,0.6)'
          c.beginPath()
          c.moveTo(X(f.x), Y(f.y))
          c.lineTo(X(k.x), Y(k.y))
          c.stroke()
        }
        for (const k of hs) {
          const on = sel.has(k.i), x = X(k.x), y = Y(k.y), q = k.kind === 'handle' ? 3 : 4
          c.fillStyle = on ? '#fff' : h.color
          c.strokeStyle = on ? h.color : '#000'
          c.lineWidth = on ? 2 : 1
          c.beginPath()
          if (k.kind === 'handle') c.arc(x, y, q, 0, 7)
          else c.rect(x - q, y - q, q * 2, q * 2)
          c.fill()
          c.stroke()
        }
      }
    }
    if (ui.draw && this.side === 'out') {
      const p = [...ui.draw.pts, ...(this.hover ? [this.hover.x, this.hover.y] : [])]
      c.strokeStyle = '#fff'
      c.lineWidth = 1.5
      path(p, false)
      c.stroke()
      c.fillStyle = '#fff'
      for (let i = 0; i < ui.draw.pts.length; i += 2) { c.beginPath(); c.arc(X(ui.draw.pts[i]), Y(ui.draw.pts[i + 1]), i ? 3 : 5, 0, 7); c.fill() }
      label('click the points · Enter or the first point closes · Esc', this.over.clientWidth / 2, 16, '#fff', false)
    }
    if (this.drag?.kind === 'band') {
      const d = this.drag
      c.strokeStyle = 'rgba(255,255,255,0.8)'
      c.fillStyle = 'rgba(255,255,255,0.08)'
      c.setLineDash([4, 3])
      c.fillRect(X(d.x0), Y(d.y0), (d.x1 - d.x0) * b.w, (d.y1 - d.y0) * b.h)
      c.strokeRect(X(d.x0), Y(d.y0), (d.x1 - d.x0) * b.w, (d.y1 - d.y0) * b.h)
      c.setLineDash([])
    }
    c.strokeStyle = '#ff4fd8'
    c.lineWidth = 1
    for (const x of this.guides.x) { c.beginPath(); c.moveTo(X(x), 0); c.lineTo(X(x), this.over.clientHeight); c.stroke() }
    for (const y of this.guides.y) { c.beginPath(); c.moveTo(0, Y(y)); c.lineTo(this.over.clientWidth, Y(y)); c.stroke() }
    const at = this.note || (this.hover ? `${Math.round(this.hover.x * size.w)}, ${Math.round(this.hover.y * size.h)}` : '')
    if (at) {
      c.font = '10px ui-monospace, Consolas, monospace'
      c.textAlign = 'right'
      c.textBaseline = 'bottom'
      c.fillStyle = this.note ? '#fff' : 'rgba(255,255,255,0.5)'
      c.fillText(at, this.over.clientWidth - 8, this.over.clientHeight - 6)
    }
    this.over.style.cursor = this.drag?.kind === 'pan' || this.space ? 'grab' : ui.draw && this.side === 'out' ? 'crosshair' : 'default'
  }

  /** The bends and the soft edges of the slice in hand. */
  private sliceLines(l: CxSlice, X: (x: number) => number, Y: (y: number) => number, path: (p: number[], close?: boolean) => void): void {
    const c = this.ctx
    const w = l.warp
    if (w.type !== 'poly' && w.type !== 'corners') {
      c.strokeStyle = cxColorAt(this.number(cxRuntime.setup(), l.id) - 1)
      c.globalAlpha = 0.55
      c.lineWidth = 1
      const steps = w.type === 'grid' ? 1 : 8
      for (let i = 1; i < w.cols; i++) { const p: number[] = []; for (let k = 0; k <= w.rows * steps; k++) p.push(...evalWarp(w, i / w.cols, k / (w.rows * steps))); path(p, false); c.stroke() }
      for (let j = 1; j < w.rows; j++) { const p: number[] = []; for (let k = 0; k <= w.cols * steps; k++) p.push(...evalWarp(w, k / (w.cols * steps), j / w.rows)); path(p, false); c.stroke() }
      c.globalAlpha = 1
    }
    if (!l.edges.on || w.type === 'poly') return
    c.setLineDash([2, 4])
    c.strokeStyle = '#ffd166'
    const e = l.edges
    const run = (f: (k: number) => [number, number]): void => {
      const p: number[] = []
      for (let k = 0; k <= 24; k++) { const q = f(k / 24); p.push(...evalWarp(w, q[0], q[1])) }
      path(p, false)
      c.stroke()
    }
    if (e.l > 0.0005) run((k) => [e.l, k])
    if (e.r > 0.0005) run((k) => [1 - e.r, k])
    if (e.t > 0.0005) run((k) => [k, e.t])
    if (e.b > 0.0005) run((k) => [k, 1 - e.b])
    c.setLineDash([])
  }
}

// ── What the buttons and the keys share ─────────────────────────────────
export function addMask(pts?: number[], over: Partial<CxMask> = {}): void {
  const ui = useCxUi.getState()
  const { screen, slice } = cxSelection(useStore.getState().complexOut, ui)
  if (!screen) return
  const list = slice ? slice.masks : screen.masks
  const m = newMask(`Mask ${list.length + 1}`, pts, over)
  commit((s) => (slice ? patchSlice(s, slice.id, { masks: [...slice.masks, m] }) : patchScreen(s, screen.id, { masks: [...screen.masks, m] })))
  ui.set({ mask: m.id, pts: [], tool: 'points' })
}

export function deleteInHand(): void {
  const ui = useCxUi.getState()
  const { screen, slice, mask, maskOf } = cxSelection(useStore.getState().complexOut, ui)
  if (!screen) return
  if (mask) {
    if (ui.pts.length) {
      const left = mask.pts.filter((_, i) => !ui.pts.includes(Math.floor(i / 2)))
      if (left.length >= 6) commit((s) => setMask(s, screen.id, maskOf === 'slice' ? slice!.id : null, mask.id, left))
      ui.set({ pts: [] })
      return
    }
    commit((s) => (maskOf === 'slice' ? patchSlice(s, slice!.id, { masks: slice!.masks.filter((m) => m !== mask) }) : patchScreen(s, screen.id, { masks: screen.masks.filter((m) => m !== mask) })))
    ui.set({ mask: null })
    return
  }
  if (!slice || slice.locked) return
  if (ui.pts.length) {
    // a point of a polygon goes from both sides; other warps keep their points
    if (slice.warp.type !== 'poly') return
    const keep = (p: number[]): number[] => p.filter((_, i) => !ui.pts.includes(Math.floor(i / 2)))
    const input = keep(slice.input)
    if (input.length >= 6) commit((s) => patchSlice(s, slice.id, { input, warp: { ...slice.warp, pts: keep(slice.warp.pts) } }))
    ui.set({ pts: [] })
    return
  }
  const i = screen.slices.indexOf(slice)
  commit((s) => patchScreen(s, screen.id, { slices: screen.slices.filter((l) => l !== slice) }))
  const next = screen.slices[i + 1] ?? screen.slices[i - 1]
  ui.set({ slice: next && next !== slice ? next.id : null, pts: [] })
}

export function duplicateInHand(): void {
  const ui = useCxUi.getState()
  const { screen, slice } = cxSelection(useStore.getState().complexOut, ui)
  if (!screen || !slice || screen.slices.length >= CX_MAX_SLICES) return
  const d = 24
  const copy: CxSlice = { ...slice, id: newSlice('').id, name: `${slice.name} copy`.slice(0, 60), solo: false, locked: false, input: [...slice.input], edges: { ...slice.edges }, masks: slice.masks.map((m) => ({ ...m, id: newMask('').id })), warp: { ...slice.warp, pts: slice.warp.pts.map((v, i) => v + d / (i % 2 ? screen.h : screen.w)) } }
  const at = screen.slices.indexOf(slice) + 1
  commit((s) => patchScreen(s, screen.id, { slices: [...screen.slices.slice(0, at), copy, ...screen.slices.slice(at)] }))
  ui.set({ slice: copy.id, pts: [], mask: null })
}
