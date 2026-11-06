// Liquid glass for the interface, only where it has something to bend : the picture, or
// the thing a hand is moving. A backdrop filter whose displacement map comes from the
// element's own rounded shape, so what lies behind bends at the rim and stays straight in
// the middle. It is DOM above the canvas : outputs, NDI and recordings never contain it.
//
// A map belongs to a size, so it is made again when the element resizes. The filter lives
// in the element's own document (a page in its own window has its own), under user-space
// units, with sRGB filtering : in linear light the displacement's zero would not be 0.5.

import { useEffect, useLayoutEffect, useSyncExternalStore, type RefObject } from 'react'

export interface GlassShape {
  /** Corner radius, CSS px. Past half the short side it is a pill. */
  radius?: number
  /** How far in from the edge the surface curves, CSS px. */
  bezel: number
  /** The strongest bend at the rim, CSS px. */
  scale: number
  /** Frost over what is behind, CSS px of blur. */
  blur?: number
  saturate?: number
}

const NS = 'http://www.w3.org/2000/svg'
const PROFILE = 2.4 // how fast the bend falls away from the rim
const MAP_EDGE = 320 // a big panel's map is coarser : it only has to be smooth

// ── on / off ──
const KEY = 'opsia.glass'
let on = (() => {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
})()
const listeners = new Set<() => void>()

function mark(): void {
  document.documentElement.setAttribute('data-glass', on ? 'on' : 'off')
}
mark()

export function glassEnabled(): boolean {
  return on
}
/** `keep : false` for this run only (an installation never needs it). */
export function setGlassEnabled(v: boolean, keep = true): void {
  on = v
  if (keep) {
    try {
      localStorage.setItem(KEY, v ? '1' : '0')
    } catch {
      /* private storage : for this run */
    }
  }
  mark()
  for (const l of listeners) l()
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
export function useGlassEnabled(): boolean {
  return useSyncExternalStore(subscribe, glassEnabled)
}

// ── the map ──
const maps = new Map<string, string>()

/** Depth inside a rounded box and the way to its nearest edge. */
function edge(px: number, py: number, w: number, h: number, r: number): { d: number; nx: number; ny: number } {
  const qx = Math.abs(px - w / 2) - (w / 2 - r)
  const qy = Math.abs(py - h / 2) - (h / 2 - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  const d = -(Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r)
  if (ox > 0 || oy > 0) {
    const l = Math.hypot(ox, oy) || 1
    return { d, nx: (ox / l) * Math.sign(px - w / 2), ny: (oy / l) * Math.sign(py - h / 2) }
  }
  return qx > qy ? { d, nx: Math.sign(px - w / 2), ny: 0 } : { d, nx: 0, ny: Math.sign(py - h / 2) }
}

function mapFor(w: number, h: number, r: number, bezel: number): string {
  const key = `${w}|${h}|${r}|${bezel}`
  const hit = maps.get(key)
  if (hit) return hit
  const q = Math.min(1, MAP_EDGE / Math.max(w, h))
  const W = Math.max(2, Math.round(w * q))
  const H = Math.max(2, Math.round(h * q))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d')
  if (!x) return ''
  const im = x.createImageData(W, H)
  const D = im.data
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const s = edge(((i + 0.5) / W) * w, ((j + 0.5) / H) * h, w, h, r)
      const m = Math.pow(1 - Math.max(0, Math.min(1, s.d / bezel)), PROFILE)
      const k = (j * W + i) * 4
      // (pulled in from the edge : the glass gathers what lies toward its middle)
      D[k] = 127.5 - 127.5 * s.nx * m
      D[k + 1] = 127.5 - 127.5 * s.ny * m
      D[k + 2] = 128
      D[k + 3] = 255
    }
  }
  x.putImageData(im, 0, 0)
  const url = c.toDataURL('image/png')
  if (maps.size > 96) maps.clear()
  maps.set(key, url)
  return url
}

// ── the filter ──
let serial = 0

function defsOf(doc: Document): SVGSVGElement {
  const id = 'opsia-glass-defs'
  const had = doc.getElementById(id) as unknown as SVGSVGElement | null
  if (had) return had
  const svg = doc.createElementNS(NS, 'svg')
  svg.id = id
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('style', 'position:fixed;width:0;height:0;left:-10px;top:-10px;pointer-events:none')
  doc.body.appendChild(svg)
  return svg
}

/** Bends what lies behind `el`, as a shape of w x h CSS px. */
export function applyGlass(el: HTMLElement, w: number, h: number, s: GlassShape): void {
  if (w < 2 || h < 2) return
  const doc = el.ownerDocument
  const r = Math.min(s.radius ?? 999, Math.min(w, h) / 2)
  const url = mapFor(w, h, r, s.bezel)
  if (!url) return
  let id = el.dataset.glassId
  let f = id ? (doc.getElementById(id) as unknown as SVGFilterElement | null) : null
  if (!f) {
    id = `opsia-glass-${++serial}`
    f = doc.createElementNS(NS, 'filter') as SVGFilterElement
    f.id = id
    f.setAttribute('filterUnits', 'userSpaceOnUse')
    f.setAttribute('primitiveUnits', 'userSpaceOnUse')
    f.setAttribute('color-interpolation-filters', 'sRGB')
    defsOf(doc).appendChild(f)
    el.dataset.glassId = id
  }
  f.setAttribute('x', '0')
  f.setAttribute('y', '0')
  f.setAttribute('width', String(w))
  f.setAttribute('height', String(h))
  const blur = s.blur ?? 0
  f.innerHTML =
    `<feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>` +
    (blur > 0 ? `<feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="b"/>` : '') +
    `<feDisplacementMap in="${blur > 0 ? 'b' : 'SourceGraphic'}" in2="m" scale="${s.scale}" xChannelSelector="R" yChannelSelector="G"/>` +
    (s.saturate ? `<feColorMatrix type="saturate" values="${s.saturate}"/>` : '')
  el.style.backdropFilter = `url(#${id})`
  el.style.borderRadius = `${r}px`
}

export function dropGlass(el: HTMLElement): void {
  const id = el.dataset.glassId
  if (id) el.ownerDocument.getElementById(id)?.remove()
  delete el.dataset.glassId
  el.style.backdropFilter = ''
}

/** Keeps `ref`'s element in glass while it lives : its size followed, the setting obeyed.
 *  `shape` must be a constant (the effect does not watch it). */
export function useGlass(ref: RefObject<HTMLElement | null>, shape: GlassShape, active = true): void {
  const enabled = useGlassEnabled()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (!enabled || !active) {
      dropGlass(el)
      return
    }
    let lastW = -1
    let lastH = -1
    const fit = (): void => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w === lastW && h === lastH) return
      lastW = w
      lastH = h
      applyGlass(el, w, h, shape)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => {
      ro.disconnect()
      dropGlass(el)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, active])
}

// ── motion ──
// The interface's small animations have their own switch, not the system's reduce-motion :
// Windows reports that whenever its animation effects are off, often just for speed, and
// these only ever answer a hand or a change of scene, a few pixels for half a second.
const MOTION_KEY = 'opsia.motion'
let moving = (() => {
  try {
    return localStorage.getItem(MOTION_KEY) !== '0'
  } catch {
    return true
  }
})()
const motionListeners = new Set<() => void>()

export function motionEnabled(): boolean {
  return moving
}
export function setMotionEnabled(v: boolean): void {
  moving = v
  try {
    localStorage.setItem(MOTION_KEY, v ? '1' : '0')
  } catch {
    /* private storage : for this run */
  }
  for (const l of motionListeners) l()
}
export function useMotionEnabled(): boolean {
  return useSyncExternalStore((l) => {
    motionListeners.add(l)
    return () => motionListeners.delete(l)
  }, motionEnabled)
}
/** How much slower this runs : 1, but in a test copy, to look at it frame by frame. */
export function motionSlow(): number {
  if (!import.meta.env.VITE_OPSIA_TEST) return 1
  return (window as unknown as { __glassSlow?: number }).__glassSlow ?? 1
}

// ── a slider while it is held ──
// Its thumb becomes a clear lens and its line a string : the line bends toward the hand,
// and rings for a moment when let go, harder the faster the hand was going. All of it is
// drawn over the slider, whose own thumb and line hide meanwhile (is-held in styles.css).
const LENS: GlassShape = { bezel: 10, scale: 14 }
const LENS_W = 42
const LENS_H = 24
// the slim slider, as styles.css draws it
const THUMB_W = 8
const THUMB_H = 15
const TRACK_INSET = 2
const LINE_REST = 4
const LINE_HELD = 5
const PULL = 9 // CSS px : the furthest the hand bends the string
const STIFFNESS = 900 // rings at about 5 Hz
const DAMPING = 13 // and is gone in about half a second
const PLUCK_MIN = 1.5 // CSS px : even a click rings a little
const PLUCK_FAST = 2.5 // CSS px more, for a hand going fast
const SVG_NS = NS

interface Hold {
  input: HTMLInputElement
  lens: HTMLDivElement | null
  svg: SVGSVGElement
  fill: SVGPathElement
  rest: SVGPathElement
  pill: SVGRectElement
  down: boolean
  pointerX: number
  pointerY: number
  speed: number // CSS px a second, along the slider
  movedAt: number
  y: number
  v: number
  width: number
}

/** Follows every horizontal slim slider of this document while it is held. */
export function installSliderLens(doc: Document): () => void {
  const win = doc.defaultView
  if (!win) return () => {}
  let hold: Hold | null = null
  let raf = 0
  let last = 0

  const finish = (): void => {
    win.cancelAnimationFrame(raf)
    const h = hold
    hold = null
    if (!h) return
    h.input.classList.remove('is-held')
    h.svg.remove()
    if (h.lens) {
      dropGlass(h.lens)
      h.lens.remove()
    }
  }

  const frame = (now: number): void => {
    const h = hold
    if (!h) return
    if (!h.input.isConnected) return finish()
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)) / motionSlow()
    last = now
    const i = h.input
    const r = i.getBoundingClientRect()
    const z = i.offsetWidth > 0 ? r.width / i.offsetWidth : 1 // the UI zoom : all this lives outside it
    const mid = r.top + r.height / 2
    if (h.down) {
      // a soft limit : the further the hand, the less the string follows
      const pull = PULL * z
      const want = moving ? pull * Math.tanh((h.pointerY - mid) / (pull * 2.2)) : 0
      h.y += (want - h.y) * (1 - Math.exp(-dt * 30))
      h.width = LINE_HELD * z
    } else {
      h.v += (-STIFFNESS * h.y - DAMPING * h.v) * dt
      h.y += h.v * dt
      h.width += (LINE_REST * z - h.width) * (1 - Math.exp(-dt * 12))
      if (Math.abs(h.y) < 0.1 * z && Math.abs(h.v) < 3 * z) return finish()
    }
    const min = Number(i.min) || 0
    const max = i.max === '' ? 100 : Number(i.max)
    const frac = max > min ? Math.max(0, Math.min(1, (Number(i.value) - min) / (max - min))) : 0
    const tw = THUMB_W * z
    const x = r.left + TRACK_INSET * z + tw / 2 + frac * (r.width - 2 * TRACK_INSET * z - tw)
    const left = r.left + h.width / 2
    const right = r.right - h.width / 2
    const crest = mid + h.y
    // two arcs meeting flat at the thumb, each pinned at its end of the slider
    h.fill.setAttribute('d', `M${left} ${mid}Q${x - (x - left) * 0.35} ${crest} ${x} ${crest}`)
    h.rest.setAttribute('d', `M${x} ${crest}Q${x + (right - x) * 0.35} ${crest} ${right} ${mid}`)
    h.fill.setAttribute('stroke-width', String(h.width))
    h.rest.setAttribute('stroke-width', String(h.width))
    h.pill.setAttribute('x', String(x - tw / 2))
    h.pill.setAttribute('y', String(crest - (THUMB_H * z) / 2))
    h.pill.setAttribute('width', String(tw))
    h.pill.setAttribute('height', String(THUMB_H * z))
    h.pill.setAttribute('rx', String(tw / 2))
    const l = h.lens
    if (l) {
      const w = LENS_W * z
      const lh = LENS_H * z
      if (l.offsetWidth !== Math.round(w)) {
        l.style.width = `${w}px`
        l.style.height = `${lh}px`
        applyGlass(l, w, lh, LENS)
      }
      l.style.left = `${x - w / 2}px`
      l.style.top = `${crest - lh / 2}px`
    }
    raf = win.requestAnimationFrame(frame)
  }

  const release = (): void => {
    const h = hold
    if (!h || !h.down) return
    h.down = false
    if (!moving) return finish()
    // a hand at rest has no speed, whatever it last moved at
    const speed = win.performance.now() - h.movedAt > 90 ? 0 : h.speed
    const z = h.input.offsetWidth > 0 ? h.input.getBoundingClientRect().width / h.input.offsetWidth : 1
    const amp = (PLUCK_MIN + PLUCK_FAST * Math.min(1, speed / 700)) * z
    // pulled far enough, the pull is the pluck; else a little kick
    if (Math.abs(h.y) < amp) h.v = amp * Math.sqrt(STIFFNESS)
    const l = h.lens
    if (l) {
      h.pill.style.visibility = 'visible'
      l.classList.add('is-leaving')
      win.setTimeout(() => {
        dropGlass(l)
        l.remove()
        if (hold === h) h.lens = null
      }, 110)
    }
  }

  const down = (e: PointerEvent): void => {
    const t = e.target as HTMLInputElement | null
    if (!t || t.tagName !== 'INPUT' || t.type !== 'range' || t.disabled || e.button !== 0) return
    if (t.classList.contains('soni-main') || !win.getComputedStyle(t).writingMode.startsWith('horizontal')) return
    finish()
    const cs = win.getComputedStyle(t)
    const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement
    svg.setAttribute('class', 'glass-string')
    svg.setAttribute('aria-hidden', 'true')
    const arc = (color: string): SVGPathElement => {
      const a = doc.createElementNS(SVG_NS, 'path') as SVGPathElement
      a.setAttribute('fill', 'none')
      a.setAttribute('stroke', color)
      a.setAttribute('stroke-linecap', 'round')
      svg.appendChild(a)
      return a
    }
    const fill = arc(cs.getPropertyValue('--q-fill').trim())
    const rest = arc(cs.getPropertyValue('--q-rest').trim())
    const pill = doc.createElementNS(SVG_NS, 'rect') as SVGRectElement
    pill.setAttribute('fill', cs.getPropertyValue('--q-tick').trim())
    svg.appendChild(pill)
    doc.body.appendChild(svg)
    let lens: HTMLDivElement | null = null
    if (on) {
      lens = doc.createElement('div')
      lens.className = 'glass-lens'
      doc.body.appendChild(lens)
    }
    pill.style.visibility = lens ? 'hidden' : 'visible'
    t.classList.add('is-held')
    const z = t.offsetWidth > 0 ? t.getBoundingClientRect().width / t.offsetWidth : 1
    hold = {
      input: t,
      lens,
      svg,
      fill,
      rest,
      pill,
      down: true,
      pointerX: e.clientX,
      pointerY: e.clientY,
      speed: 0,
      movedAt: 0,
      y: 0,
      v: 0,
      width: LINE_REST * z
    }
    last = win.performance.now()
    frame(last)
  }
  const move = (e: PointerEvent): void => {
    const h = hold
    if (!h || !h.down) return
    const now = win.performance.now()
    const ms = Math.max(1, now - h.movedAt)
    if (h.movedAt) h.speed += (Math.abs(e.clientX - h.pointerX) * (1000 / ms) - h.speed) * 0.4
    h.movedAt = now
    h.pointerX = e.clientX
    h.pointerY = e.clientY
  }
  doc.addEventListener('pointerdown', down, true)
  doc.addEventListener('pointermove', move, true)
  win.addEventListener('pointerup', release, true)
  win.addEventListener('pointercancel', release, true)
  win.addEventListener('blur', release)
  return () => {
    finish()
    doc.removeEventListener('pointerdown', down, true)
    doc.removeEventListener('pointermove', move, true)
    win.removeEventListener('pointerup', release, true)
    win.removeEventListener('pointercancel', release, true)
    win.removeEventListener('blur', release)
  }
}

/** Mounts the lens in this document for as long as the component lives. */
export function useSliderLens(): void {
  useEffect(() => installSliderLens(document), [])
}
