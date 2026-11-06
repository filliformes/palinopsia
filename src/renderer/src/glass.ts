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

// ── a slider while it is held : its thumb becomes a clear lens ──
const LENS: GlassShape = { bezel: 10, scale: 14 }
const LENS_W = 42
const LENS_H = 24
const THUMB_W = 5 // styles.css : the slim slider's pill

/** Follows every horizontal slim slider of this document while it is held. */
export function installSliderLens(doc: Document): () => void {
  const win = doc.defaultView
  if (!win) return () => {}
  let held: HTMLInputElement | null = null
  let lens: HTMLDivElement | null = null
  let raf = 0

  const place = (): void => {
    const i = held
    const l = lens
    if (!i || !l) return
    if (!i.isConnected) return release()
    const r = i.getBoundingClientRect()
    const min = Number(i.min) || 0
    const max = i.max === '' ? 100 : Number(i.max)
    const frac = max > min ? Math.max(0, Math.min(1, (Number(i.value) - min) / (max - min))) : 0
    const z = i.offsetWidth > 0 ? r.width / i.offsetWidth : 1 // the UI zoom : the lens lives outside it
    const x = r.left + (THUMB_W * z) / 2 + frac * (r.width - THUMB_W * z)
    const w = LENS_W * z
    const h = LENS_H * z
    if (l.offsetWidth !== Math.round(w)) {
      l.style.width = `${w}px`
      l.style.height = `${h}px`
      applyGlass(l, w, h, LENS)
    }
    l.style.left = `${x - w / 2}px`
    l.style.top = `${r.top + r.height / 2 - h / 2}px`
    raf = win.requestAnimationFrame(place)
  }
  const release = (): void => {
    win.cancelAnimationFrame(raf)
    held?.classList.remove('is-held')
    held = null
    const l = lens
    lens = null
    if (!l) return
    l.classList.add('is-leaving')
    win.setTimeout(() => {
      dropGlass(l)
      l.remove()
    }, 110)
  }
  const down = (e: PointerEvent): void => {
    const t = e.target as HTMLInputElement | null
    if (!t || t.tagName !== 'INPUT' || t.type !== 'range' || t.disabled || e.button !== 0) return
    if (t.classList.contains('soni-main') || !win.getComputedStyle(t).writingMode.startsWith('horizontal')) return
    release()
    t.classList.add('is-held')
    if (!on) return void (held = t)
    held = t
    lens = doc.createElement('div')
    lens.className = 'glass-lens'
    doc.body.appendChild(lens)
    place()
  }
  const up = (): void => {
    if (held) release()
  }
  doc.addEventListener('pointerdown', down, true)
  win.addEventListener('pointerup', up, true)
  win.addEventListener('pointercancel', up, true)
  win.addEventListener('blur', up)
  return () => {
    release()
    doc.removeEventListener('pointerdown', down, true)
    win.removeEventListener('pointerup', up, true)
    win.removeEventListener('pointercancel', up, true)
    win.removeEventListener('blur', up)
  }
}

/** Mounts the lens in this document for as long as the component lives. */
export function useSliderLens(): void {
  useEffect(() => installSliderLens(document), [])
}
