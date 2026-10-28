// Clicking the preview : the mouse on the preview canvas (and the big preview,
// V : the same canvas) as an input for the sources that take it (Marbling : a
// drop, a pour, a trail, a comb, a swirl). Body pinches come in here too
// (bodyTracker.ts, the Body page's "pinch = click"), each hand its own pointer,
// so two hands and the mouse can play at once.
//
// - The point under the cursor is mapped back to the FRAME through how the canvas
//   shows it (letterboxed in its box, then the keystone, the output transform or
//   the domemaster : engine/pointerMap.ts), through getBoundingClientRect (the UI
//   zoom is a CSS zoom : never devicePixelRatio).
// - It goes to the source SELECTED in the Inspector when that one takes the
//   pointer, else to the topmost visible layer whose source takes it, the
//   Background last. Chosen when the pointer goes down, kept until it lets go.
// - A mouse gesture is one undo step : it joins the slot's hand-made log when it
//   ends (the session and its scenes reopen the same picture). A body gesture is
//   live, like the automatic drops : a performer's hours of pinches would flood
//   the undo history and the session file.
// - Nothing changes for a session with no source that takes the pointer : the
//   cursor stays the arrow and a click does what it always did (nothing).

import { useStore } from './store'
import { commitNow } from './undo'
import { showToast } from './components/Toast'
import { SHADER_BY_ID } from './shaders/isf'
import type { Compositor } from './engine/Compositor'
import type { NativeGenerator } from './engine/nativeGenerators'
import { displayToFrame, frameToDisplay } from './engine/pointerMap'
import type { HandGestureLog } from '@shared/types'

type Target = { layer: number; slot: 'A' | 'B' } | 'bg'
interface Active { t: Target; eng: NativeGenerator; shaderId: string; moved: boolean; x0: number; y0: number }

/** The mouse's pointer id; each hand has its own (HAND_PID + 0 left, + 1 right). */
export const MOUSE_PID = 1
export const HAND_PID = 11
/** A body pointer must travel this far (frame heights) before it drags : a
 *  tracked hand never holds perfectly still. */
const BODY_DEAD = 0.018
/** The mouse : this many CSS pixels. */
const MOUSE_DEAD = 4

let getComp: () => Compositor | null = () => null
const active = new Map<number, Active>()
let trimWarned = false

export function setPointerHost(f: () => Compositor | null): void {
  getComp = f
}

// ── What the overlay shows (the hint, the hand cursors) ──────────────────

export interface HandCursor { pid: number; u: number; v: number; down: boolean }
export interface PointerView { hint: string | null; where: string | null; cursors: HandCursor[] }
let view: PointerView = { hint: null, where: null, cursors: [] }
const listeners = new Set<() => void>()
function setView(p: Partial<PointerView>): void {
  view = { ...view, ...p }
  for (const l of listeners) l()
}
export const pointerView = {
  subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  get: (): PointerView => view
}

/** The status line of the source a hint is about (drops, points), polled by the overlay. */
let hintEngine: NativeGenerator | null = null
export function hintStatus(): string {
  return hintEngine?.status?.() ?? ''
}

// ── Which source takes the pointer ──────────────────────────────────────

function engineAt(comp: Compositor, t: Target): { eng: NativeGenerator; shaderId: string } | null {
  const c = useStore.getState().composition
  const src = t === 'bg' ? c.background?.source : t.slot === 'A' ? c.layers[t.layer]?.sourceA : c.layers[t.layer]?.sourceB
  if (!src || src.kind !== 'generator' || !src.shaderId) return null
  const eng = comp.pointerEngine(t)
  return eng && eng.pointer ? { eng, shaderId: src.shaderId } : null
}

function findTarget(): { t: Target; eng: NativeGenerator; shaderId: string } | null {
  const comp = getComp()
  if (!comp) return null
  const st = useStore.getState()
  const sel = st.selection
  // the selected source first
  if (sel?.type === 'source') {
    const t = { layer: sel.layer, slot: sel.slot }
    const e = engineAt(comp, t)
    if (e) return { t, ...e }
  } else if (sel?.type === 'background') {
    const e = engineAt(comp, 'bg')
    if (e) return { t: 'bg', ...e }
  }
  // then the topmost visible layer whose source takes it (the slot that shows most first)
  const layers = st.composition.layers
  const anySolo = layers.some((l) => l.solo)
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]
    if ((anySolo ? !l.solo : l.mute) || !(l.opacity > 0)) continue
    const mix = l.sourceB ? l.sourceMix : 0
    const order: Array<'A' | 'B'> = mix > 0.5 ? ['B', 'A'] : ['A', 'B']
    for (const slot of order) {
      if (slot === 'A' && mix >= 1 && l.sourceB) continue
      if (slot === 'B' && (!l.sourceB || mix <= 0)) continue
      const t = { layer: i, slot }
      const e = engineAt(comp, t)
      if (e) return { t, ...e }
    }
  }
  const bg = st.composition.background
  if (bg && bg.opacity > 0) {
    const e = engineAt(comp, 'bg')
    if (e) return { t: 'bg', ...e }
  }
  return null
}

const where = (t: Target, shaderId: string): string =>
  `${t === 'bg' ? 'Background' : `L${t.layer + 1} ${t.slot}`} · ${SHADER_BY_ID[shaderId]?.name ?? shaderId}`

// ── Pointers ────────────────────────────────────────────────────────────

function commitFor(t: Target, shaderId: string): (e: HandGestureLog) => void {
  return (entry) => {
    // its own undo step : whatever was settling closes first
    commitNow()
    const r = useStore.getState().appendHandOp(t, shaderId, entry)
    commitNow()
    if (r.trimmed && !trimWarned) {
      trimWarned = true
      showToast('The hand-made log is full : the oldest gestures leave the saved picture (their paint dissolves as the points budget needs)', 'warn', 5200)
    }
  }
}

/** A pointer goes down at the frame's (u, v) (v up). `log` : the mouse. */
function down(pid: number, u: number, v: number, mods: { shift?: boolean; alt?: boolean }, log: boolean): boolean {
  release(pid, 'cancel')
  const f = findTarget()
  if (!f) return false
  active.set(pid, { ...f, moved: false, x0: u, y0: v })
  f.eng.pointer!({ phase: 'down', pid, u, v, shift: mods.shift, alt: mods.alt, commit: log ? commitFor(f.t, f.shaderId) : undefined })
  return true
}

function move(pid: number, u: number, v: number, dead: number, aspect: number): void {
  const a = active.get(pid)
  if (!a) return
  if (!a.moved) {
    if (Math.hypot((u - a.x0) * aspect, v - a.y0) < dead) return
    a.moved = true
  }
  // the slot changed under the gesture (another source, a scene) : it ends there
  const comp = getComp()
  if (!comp || comp.pointerEngine(a.t) !== a.eng) { active.delete(pid); return }
  a.eng.pointer!({ phase: 'move', pid, u, v })
}

function release(pid: number, phase: 'up' | 'cancel'): void {
  const a = active.get(pid)
  if (!a) return
  active.delete(pid)
  const comp = getComp()
  if (comp && comp.pointerEngine(a.t) === a.eng) a.eng.pointer!({ phase, pid, u: a.x0, v: a.y0 })
}

const frameAspect = (): number => getComp()?.displayState().aspect ?? 16 / 9

// ── The preview canvas ──────────────────────────────────────────────────

/** The client point → the frame's uv, through the canvas box (object-fit
 *  contain) and how the canvas shows the frame. */
function toFrame(canvas: HTMLCanvasElement, cx: number, cy: number): [number, number] | null {
  const comp = getComp()
  if (!comp) return null
  const r = canvas.getBoundingClientRect()
  const cw = canvas.width, ch = canvas.height
  if (!r.width || !r.height || !cw || !ch) return null
  const s = Math.min(r.width / cw, r.height / ch)
  const dw = cw * s, dh = ch * s
  const nx = (cx - (r.left + (r.width - dw) / 2)) / dw
  const ny = (cy - (r.top + (r.height - dh) / 2)) / dh
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
  return displayToFrame(nx, ny, comp.displayState())
}

/** The frame's uv → CSS pixels inside the canvas's box (for a hand cursor). */
export function frameToCanvasPx(canvas: HTMLCanvasElement, u: number, v: number): [number, number] | null {
  const comp = getComp()
  if (!comp) return null
  const p = frameToDisplay(u, v, comp.displayState())
  if (!p) return null
  const cw = canvas.width, ch = canvas.height
  const bw = canvas.clientWidth, bh = canvas.clientHeight
  if (!bw || !bh || !cw || !ch) return null
  const s = Math.min(bw / cw, bh / ch)
  const dw = cw * s, dh = ch * s
  return [(bw - dw) / 2 + p[0] * dw, (bh - dh) / 2 + p[1] * dh]
}

/** Wires the preview canvas. Returns the detach. */
export function attachPreviewPointer(canvas: HTMLCanvasElement): () => void {
  let downAt: [number, number] | null = null
  const hover = (e: PointerEvent): void => {
    if (active.has(MOUSE_PID)) return
    const f = toFrame(canvas, e.clientX, e.clientY) ? findTarget() : null
    canvas.style.cursor = f ? 'crosshair' : ''
    hintEngine = f?.eng ?? null
    const hint = f ? f.eng.pointerHint?.() ?? 'click : play on the picture' : null
    const w = f ? where(f.t, f.shaderId) : null
    if (hint !== view.hint || w !== view.where) setView({ hint, where: w })
  }
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    const p = toFrame(canvas, e.clientX, e.clientY)
    if (!p) return
    if (!down(MOUSE_PID, p[0], p[1], { shift: e.shiftKey, alt: e.altKey }, true)) return
    e.preventDefault()
    downAt = [e.clientX, e.clientY]
    try { canvas.setPointerCapture(e.pointerId) } catch { /* gone */ }
  }
  const onMove = (e: PointerEvent): void => {
    if (!active.has(MOUSE_PID)) { hover(e); return }
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < MOUSE_DEAD) return
    downAt = null
    const a = active.get(MOUSE_PID)
    if (a) a.moved = true
    // every point the mouse passed through since the last event, for smooth strokes
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    for (const c of evs.length ? evs : [e]) {
      const p = toFrame(canvas, c.clientX, c.clientY)
      if (p) move(MOUSE_PID, p[0], p[1], 0, 1)
    }
  }
  const onUp = (e: PointerEvent): void => {
    if (!active.has(MOUSE_PID)) return
    release(MOUSE_PID, 'up')
    downAt = null
    try { canvas.releasePointerCapture(e.pointerId) } catch { /* gone */ }
    hover(e)
  }
  const onLost = (): void => {
    if (active.has(MOUSE_PID)) release(MOUSE_PID, 'up')
    downAt = null
  }
  const onLeave = (): void => {
    if (active.has(MOUSE_PID)) return
    canvas.style.cursor = ''
    hintEngine = null
    if (view.hint || view.where) setView({ hint: null, where: null })
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onLost)
  canvas.addEventListener('lostpointercapture', onLost)
  canvas.addEventListener('pointerleave', onLeave)
  return () => {
    onLost()
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onLost)
    canvas.removeEventListener('lostpointercapture', onLost)
    canvas.removeEventListener('pointerleave', onLeave)
    canvas.style.cursor = ''
  }
}

// ── Body pinches (bodyTracker.ts) ───────────────────────────────────────

/** A hand's pinch as a pointer : `down` when the pinch closes, `move` while it
 *  stays closed, `up` when it opens (or the hand leaves). (u, v) : the frame's
 *  uv (v up). Live : never logged. */
export function bodyPointer(pid: number, phase: 'down' | 'move' | 'up', u: number, v: number): void {
  if (phase === 'down') down(pid, u, v, {}, false)
  else if (phase === 'move') move(pid, u, v, BODY_DEAD, frameAspect())
  else release(pid, 'up')
}

/** Where each hand points now (lit while pinched), for the preview's cursors. */
export function setHandCursors(c: HandCursor[]): void {
  const prev = view.cursors
  if (!c.length && !prev.length) return
  if (c.length === prev.length && c.every((x, i) => x.pid === prev[i].pid && x.down === prev[i].down && Math.abs(x.u - prev[i].u) < 1e-4 && Math.abs(x.v - prev[i].v) < 1e-4)) return
  setView({ cursors: c })
}

// ── Remote events (OSC, actions) ────────────────────────────────────────

/** A drop / sprinkle / clear sent to a slot's engine directly (live, not logged). */
export function sourceEvent(t: Target, name: string, args: number[]): boolean {
  const comp = getComp()
  const eng = comp?.pointerEngine(t)
  if (!eng?.event) return false
  eng.event(name, args)
  return true
}
