// Complex Output : the model of the multi-screen mapping. Screens (each a window
// on a projector, or a plain window), and on each the slices : which part of the
// picture, or of one layer, goes where on that screen, how it is bent, cut,
// colored and blended into its neighbours.
//
// Coordinates : the input in the source's 0..1, the output in the screen's 0..1,
// both x to the right and y DOWN (the way they are drawn and typed). Soft widths
// are in the screen's own pixels.
//
// Everything that comes from a file, a session, localStorage or a message goes
// through sanitizeSetup : the rest of the code trusts what it reads.

// third-party: STLT (its user guide, as the inspiration for the screens, slices, masks and problem list; no code)

/** The picture as the output shows it (the domemaster while the dome is on), the
 *  flat picture even then, or one layer alone. */
export type CxSource = 'master' | 'flat' | 'layer:0' | 'layer:1' | 'layer:2' | 'layer:3'
export const CX_SOURCES: CxSource[] = ['master', 'flat', 'layer:0', 'layer:1', 'layer:2', 'layer:3']
export const CX_SOURCE_LABEL: Record<CxSource, string> = {
  master: 'the picture', flat: 'the flat picture', 'layer:0': 'layer 1', 'layer:1': 'layer 2', 'layer:2': 'layer 3', 'layer:3': 'layer 4'
}

export type CxWarpType = 'corners' | 'grid' | 'curve' | 'bezier' | 'poly'
export interface CxWarp {
  type: CxWarpType
  /** cells across and down (corners, poly : 1) */
  cols: number
  rows: number
  /** x, y pairs : corners TL TR BR BL · grid and curve (cols+1)(rows+1) points, row by
   *  row from the top · bezier the whole net (3 cols+1)(3 rows+1) · poly its outline */
  pts: number[]
}

export interface CxMask {
  id: string
  name: string
  on: boolean
  /** add : the picture shows inside it · cut : it hides what is inside */
  mode: 'add' | 'cut'
  /** x, y pairs (a closed outline) : a slice's masks in the slice's own 0..1, a screen's in the screen's */
  pts: number[]
  /** the outline rounded through its points */
  smooth: boolean
  /** the edge's width, in screen pixels */
  soft: number
}

export interface CxEdges {
  on: boolean
  /** widths, in shares of the slice (0..0.95) */
  l: number
  r: number
  t: number
  b: number
  /** how steep the ramp is around its middle */
  power: number
  /** the projector's own response */
  gamma: number
  /** the light in the middle of the ramp (0.5 : the two add up to 1) */
  lum: number
  /** the black raised outside the ramps, to meet the doubled black inside them */
  black: number
}

export interface CxColor {
  brightness: number
  contrast: number
  gamma: number
  r: number
  g: number
  b: number
}

export interface CxSlice extends CxColor {
  id: string
  name: string
  on: boolean
  solo: boolean
  locked: boolean
  opacity: number
  source: CxSource
  /** rect : the corners stay a rectangle · quad : four free corners · poly : an
   *  outline, its points pinned on the output one for one */
  inKind: 'rect' | 'quad' | 'poly'
  /** x, y pairs : TL TR BR BL, or the outline */
  input: number[]
  flipX: boolean
  flipY: boolean
  /** quarter turns clockwise of the picture in the slice */
  turn: number
  warp: CxWarp
  edges: CxEdges
  masks: CxMask[]
}

/** Where a screen goes. A display is found again by its id, else by its name and size. */
export interface CxTarget {
  kind: 'display' | 'window' | 'none'
  displayId?: number
  label?: string
  dw?: number
  dh?: number
  /** a plain window's place (DIP) */
  x?: number
  y?: number
  ww?: number
  wh?: number
}

export interface CxScreen extends CxColor {
  id: string
  name: string
  on: boolean
  w: number
  h: number
  target: CxTarget
  card: boolean
  slices: CxSlice[]
  masks: CxMask[]
}

export interface CxSetup {
  v: 1
  screens: CxScreen[]
}

export const CX_MAX_SCREENS = 16
export const CX_MAX_SLICES = 64
export const CX_MAX_MASKS = 24
export const CX_MAX_PTS = 64
export const CX_MAX_CELLS = 24
export const CX_MAX_EDGE = 8192

export const CX_COLOR: CxColor = { brightness: 1, contrast: 1, gamma: 1, r: 1, g: 1, b: 1 }
export const CX_EDGES: CxEdges = { on: false, l: 0, r: 0, t: 0, b: 0, power: 2, gamma: 2.2, lum: 0.5, black: 0 }
export const CX_EMPTY: CxSetup = { v: 1, screens: [] }

/** What a modulator, a Macro knob, MIDI or OSC can move. `who` : a screen's or a slice's id. */
export type CxModField = 'brightness' | 'opacity' | 'on'
export const CX_MOD_RANGE: Record<CxModField, { min: number; max: number; label: string }> = {
  brightness: { min: 0, max: 2, label: 'brightness' },
  opacity: { min: 0, max: 1, label: 'opacity' },
  on: { min: 0, max: 1, label: 'on / off' }
}

/** The colors that tell the slices apart, the same one for a slice everywhere. */
const HUES = ['#f2a33a', '#4fb3ff', '#8fd14f', '#ff6f91', '#b48cff', '#2fd0b5', '#ffd166', '#ff8a5c', '#7fa8ff', '#d48cff', '#9ad7c1', '#e0e06a']
export const cxColorAt = (i: number): string => HUES[((i % HUES.length) + HUES.length) % HUES.length]

let seq = 0
export const cxId = (p: string): string => `${p}${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`

export const rectPts = (x: number, y: number, w: number, h: number): number[] => [x, y, x + w, y, x + w, y + h, x, y + h]

export function newSlice(name: string, over: Partial<CxSlice> = {}): CxSlice {
  return {
    ...CX_COLOR, id: cxId('l'), name, on: true, solo: false, locked: false, opacity: 1, source: 'master', inKind: 'rect', input: rectPts(0, 0, 1, 1),
    flipX: false, flipY: false, turn: 0, warp: { type: 'corners', cols: 1, rows: 1, pts: rectPts(0, 0, 1, 1) }, edges: { ...CX_EDGES }, masks: [], ...over
  }
}
export function newScreen(name: string, over: Partial<CxScreen> = {}): CxScreen {
  return { ...CX_COLOR, id: cxId('s'), name, on: true, w: 1920, h: 1080, target: { kind: 'none' }, card: false, slices: [newSlice('Slice 1')], masks: [], ...over }
}
export function newMask(name: string, pts = rectPts(0.25, 0.25, 0.5, 0.5), over: Partial<CxMask> = {}): CxMask {
  return { id: cxId('m'), name, on: true, mode: 'cut', pts, smooth: false, soft: 0, ...over }
}

/** A copy of a slice (or a screen, a mask) with ids of its own. */
export const copyMask = (m: CxMask): CxMask => ({ ...m, id: cxId('m'), pts: [...m.pts] })
export const copySlice = (s: CxSlice): CxSlice => ({ ...s, id: cxId('l'), input: [...s.input], warp: { ...s.warp, pts: [...s.warp.pts] }, edges: { ...s.edges }, masks: s.masks.map(copyMask) })
export const copyScreen = (s: CxScreen): CxScreen => ({ ...s, id: cxId('s'), target: { kind: 'none' }, slices: s.slices.map(copySlice), masks: s.masks.map(copyMask) })

/** How many points a warp of this shape holds. */
export const warpCount = (type: CxWarpType, cols: number, rows: number): number =>
  type === 'corners' ? 4 : type === 'bezier' ? (3 * cols + 1) * (3 * rows + 1) : (cols + 1) * (rows + 1)

// ── Reading what we did not write ──────────────────────────────────────
type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const num = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const str = (v: unknown, d: string): string => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : d)
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : [])
const pairs = (v: unknown, lo = -4, hi = 5): number[] | null =>
  Array.isArray(v) && v.length % 2 === 0 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (v as number[]).map((n) => Math.min(hi, Math.max(lo, n))) : null

const seen = new Set<string>()
function ownId(v: unknown, p: string): string {
  let id = typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : cxId(p)
  if (seen.has(id)) id = cxId(p)
  seen.add(id)
  return id
}

const color = (o: Obj): CxColor => ({
  brightness: num(o.brightness, 1, 0, 2), contrast: num(o.contrast, 1, 0, 2), gamma: num(o.gamma, 1, 0.2, 4),
  r: num(o.r, 1, 0, 2), g: num(o.g, 1, 0, 2), b: num(o.b, 1, 0, 2)
})

function readMask(v: unknown, i: number): CxMask | null {
  const o = obj(v)
  const p = pairs(o.pts)
  if (!p || p.length < 6 || p.length > CX_MAX_PTS * 2) return null
  return { id: ownId(o.id, 'm'), name: str(o.name, `Mask ${i + 1}`), on: bool(o.on, true), mode: o.mode === 'add' ? 'add' : 'cut', pts: p, smooth: bool(o.smooth, false), soft: num(o.soft, 0, 0, 1000) }
}
const readMasks = (v: unknown): CxMask[] => list(v, CX_MAX_MASKS).map(readMask).filter((m): m is CxMask => !!m)

function readSlice(v: unknown, i: number): CxSlice {
  const o = obj(v), w = obj(o.warp), e = obj(o.edges)
  let inKind: CxSlice['inKind'] = o.inKind === 'quad' ? 'quad' : o.inKind === 'poly' ? 'poly' : 'rect'
  let input = pairs(o.input)
  let type = (['corners', 'grid', 'curve', 'bezier', 'poly'] as const).find((t) => t === w.type) ?? 'corners'
  let cols = Math.round(num(w.cols, 1, 1, CX_MAX_CELLS)), rows = Math.round(num(w.rows, 1, 1, CX_MAX_CELLS))
  let wp = pairs(w.pts)
  if (inKind === 'poly' || type === 'poly') {
    // an outline and its pins go together, point for point
    const ok = input && wp && input.length === wp.length && input.length >= 6 && input.length <= CX_MAX_PTS * 2 && inKind === 'poly' && type === 'poly'
    if (!ok) { inKind = 'rect'; type = 'corners'; input = null; wp = null }
    cols = rows = 1
  } else if (!input || input.length !== 8) input = null
  if (!input) { input = rectPts(0, 0, 1, 1); inKind = 'rect' }
  if (type === 'corners') cols = rows = 1
  if (type !== 'poly' && (!wp || wp.length !== warpCount(type, cols, rows) * 2)) { type = 'corners'; cols = rows = 1; wp = null }
  if (!wp) wp = rectPts(0, 0, 1, 1)
  if (inKind === 'rect') {
    const xs = [input[0], input[2], input[4], input[6]], ys = [input[1], input[3], input[5], input[7]]
    const x = Math.min(...xs), y = Math.min(...ys)
    input = rectPts(x, y, Math.max(1e-4, Math.max(...xs) - x), Math.max(1e-4, Math.max(...ys) - y))
  }
  return {
    ...color(o), id: ownId(o.id, 'l'), name: str(o.name, `Slice ${i + 1}`), on: bool(o.on, true), solo: bool(o.solo, false), locked: bool(o.locked, false),
    opacity: num(o.opacity, 1, 0, 1), source: CX_SOURCES.find((s) => s === o.source) ?? 'master', inKind, input,
    flipX: bool(o.flipX, false), flipY: bool(o.flipY, false), turn: ((Math.round(num(o.turn, 0, -8, 8)) % 4) + 4) % 4,
    warp: { type, cols, rows, pts: wp },
    edges: {
      on: bool(e.on, false), l: num(e.l, 0, 0, 0.95), r: num(e.r, 0, 0, 0.95), t: num(e.t, 0, 0, 0.95), b: num(e.b, 0, 0, 0.95),
      power: num(e.power, 2, 0.5, 8), gamma: num(e.gamma, 2.2, 0.5, 4), lum: num(e.lum, 0.5, 0, 1), black: num(e.black, 0, 0, 0.5)
    },
    masks: readMasks(o.masks)
  }
}

function readTarget(v: unknown): CxTarget {
  const o = obj(v)
  const n = (k: string, lo: number, hi: number): number | undefined => {
    const x = o[k]
    return typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : undefined
  }
  const t: CxTarget = { kind: o.kind === 'display' || o.kind === 'window' ? o.kind : 'none' }
  if (t.kind === 'display') {
    t.displayId = n('displayId', -1e15, 1e15)
    t.label = typeof o.label === 'string' ? o.label.slice(0, 80) : undefined
    t.dw = n('dw', 1, 32768)
    t.dh = n('dh', 1, 32768)
  } else if (t.kind === 'window') {
    t.x = n('x', -1e5, 1e5)
    t.y = n('y', -1e5, 1e5)
    t.ww = n('ww', 100, 32768)
    t.wh = n('wh', 80, 32768)
  }
  return t
}

function readScreen(v: unknown, i: number): CxScreen {
  const o = obj(v)
  return {
    ...color(o), id: ownId(o.id, 's'), name: str(o.name, `Screen ${i + 1}`), on: bool(o.on, true),
    w: Math.round(num(o.w, 1920, 16, CX_MAX_EDGE)), h: Math.round(num(o.h, 1080, 16, CX_MAX_EDGE)), target: readTarget(o.target), card: bool(o.card, false),
    slices: list(o.slices, CX_MAX_SLICES).map(readSlice), masks: readMasks(o.masks)
  }
}

/** A setup made whole and safe from anything. */
export function sanitizeSetup(v: unknown): CxSetup {
  seen.clear()
  const s: CxSetup = { v: 1, screens: list(obj(v).screens, CX_MAX_SCREENS).map(readScreen) }
  seen.clear()
  return s
}

// ── Finding and changing one thing in a setup ──────────────────────────
export function findSlice(s: CxSetup, id: string): { screen: CxScreen; slice: CxSlice; si: number; li: number } | null {
  for (let si = 0; si < s.screens.length; si++) {
    const li = s.screens[si].slices.findIndex((x) => x.id === id)
    if (li >= 0) return { screen: s.screens[si], slice: s.screens[si].slices[li], si, li }
  }
  return null
}
export const patchScreen = (s: CxSetup, id: string, p: Partial<CxScreen>): CxSetup =>
  s.screens.some((x) => x.id === id) ? { ...s, screens: s.screens.map((x) => (x.id === id ? { ...x, ...p } : x)) } : s
export function patchSlice(s: CxSetup, id: string, p: Partial<CxSlice>): CxSetup {
  const f = findSlice(s, id)
  return f ? patchScreen(s, f.screen.id, { slices: f.screen.slices.map((x) => (x.id === id ? { ...x, ...p } : x)) }) : s
}

/** A slice's number (and color) : its place in the whole setup, from 1. */
export function sliceNumber(s: CxSetup, id: string): number {
  let n = 0
  for (const sc of s.screens) for (const l of sc.slices) { n++; if (l.id === id) return n }
  return 0
}

/** The value a control stands at (null : its screen or slice is gone). */
export function cxBaseValue(s: CxSetup, who: string, field: CxModField): number | null {
  if (field === 'brightness') return s.screens.find((x) => x.id === who)?.brightness ?? null
  const l = findSlice(s, who)?.slice
  if (field === 'opacity') return l ? l.opacity : null
  const sc = l ? null : s.screens.find((x) => x.id === who)
  return l ? (l.on ? 1 : 0) : sc ? (sc.on ? 1 : 0) : null
}
export function cxSetValue(s: CxSetup, who: string, field: CxModField, v: number): CxSetup {
  const r = CX_MOD_RANGE[field]
  const x = Math.min(r.max, Math.max(r.min, Number.isFinite(v) ? v : r.min))
  if (cxBaseValue(s, who, field) === null) return s
  if (field === 'brightness') return patchScreen(s, who, { brightness: x })
  if (field === 'opacity') return patchSlice(s, who, { opacity: x })
  return findSlice(s, who) ? patchSlice(s, who, { on: x >= 0.5 }) : patchScreen(s, who, { on: x >= 0.5 })
}
