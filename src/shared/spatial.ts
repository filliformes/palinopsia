// Space : Palinopsia's sound placed on a speaker array, the way the picture is
// placed on a dome. Two ways out of the Sonify engine besides stereo :
//
//   speakers : Palinopsia pans every voice itself onto a speaker layout (VBAP,
//              with a span), up to the 32 channels one audio output can carry.
//   objects  : every voice leaves on its own channel(s), and its position goes
//              over OSC to an object renderer that owns the room : SpatGRIS (what
//              the SAT Satosphère runs for its 93.5 system) or anything that
//              speaks ADM-OSC. The renderer pans; Palinopsia says where.
//
// Directions follow SpatGRIS (its OSC and its speaker setups) : azimuth in
// degrees CLOCKWISE seen from above, 0 = front, 90 = the audience's right;
// elevation in degrees above the horizon (90 = the zenith). As a unit vector :
// x right, y front, z up. The domemaster's own convention (shared/dome.ts : the
// front at the bottom of the master, the audience's right on its right) gives
// the same azimuth, so a voice that follows the picture lands where its
// picture is.
//
// Written for Palinopsia from the published methods : VBAP (Pulkki 1997, vector
// base amplitude panning), its spread (MDAP, Pulkki 1999), the speaker hull as
// the convex hull of the speaker directions. The speaker-setup reader reads
// SpatGRIS's documented file format; no SpatGRIS code is used. This app is
// GPL-3.0-or-later too, but with a section 7 permission of its own (NDI,
// LICENSE-EXCEPTIONS.md) that SpatGRIS's code does not carry, so none of it
// can come in.

import type { DomeConfig } from './dome'

export type SpaceMode = 'stereo' | 'speakers' | 'objects'
export type SpaceProtocol = 'spatgris' | 'adm'

/** The most channels one Web Audio output carries (Chromium's limit). */
export const SPACE_MAX_CH = 32

/** The Sonify voices in the worklet's order (its voice index), then the FX tail. */
export const SPACE_VOICES = ['spectra', 'orbit', 'flow', 'events', 'raster', 'sstv', 'filter', 'chord', 'collage', 'signal', 'assemblage'] as const
export type SpaceVoice = (typeof SPACE_VOICES)[number]
export const SPACE_FX = SPACE_VOICES.length // the FX tail's return : source 10
export const SPACE_SOURCES = SPACE_VOICES.length + 1
/** Collage pieces as sources of their own : the Collage voice's films arrive on
 *  the worklet's input 1 as the stereo bus (channels 0-1) and up to this many
 *  mono piece groups (channels 2-31). Sources 11.. in the matrix. */
export const SPACE_PIECES = 30
export const SPACE_PIECE0 = SPACE_SOURCES
export const SPACE_SRC_ALL = SPACE_SOURCES + SPACE_PIECES

/** What a modulator, a Meta knob or OSC can move on a voice's place. `span`
 *  sets both spreads; az is an offset while the voice follows the picture. */
export type SpaceField = 'az' | 'el' | 'width' | 'span' | 'spin'
export const SPACE_FIELDS: SpaceField[] = ['az', 'el', 'width', 'span', 'spin']
export const SPACE_FIELD_RANGE: Record<SpaceField, { min: number; max: number; def: number; label: string }> = {
  az: { min: -180, max: 180, def: 0, label: 'azimuth' },
  el: { min: -15, max: 90, def: 30, label: 'elevation' },
  width: { min: 0, max: 180, def: 60, label: 'width' },
  span: { min: 0, max: 1, def: 0.08, label: 'span' },
  spin: { min: -360, max: 360, def: 0, label: 'spin' }
}
export type SpaceModParam = `space.${SpaceVoice}.${SpaceField}`
export const spaceModParam = (v: SpaceVoice, f: SpaceField): SpaceModParam => `space.${v}.${f}`
export function parseSpaceModParam(p: string): { voice: SpaceVoice; field: SpaceField } | null {
  const m = /^space\.([a-z]+)\.([a-z]+)$/.exec(p)
  if (!m) return null
  const voice = m[1] as SpaceVoice, field = m[2] as SpaceField
  return (SPACE_VOICES as readonly string[]).includes(voice) && SPACE_FIELDS.includes(field) ? { voice, field } : null
}
/** A place's value for a field (span reads the horizontal spread). */
export function placeField(p: VoicePlace, f: SpaceField): number {
  return f === 'span' ? p.hspan : p[f]
}
/** The patch that sets a field (span sets both spreads). */
export function placePatch(f: SpaceField, v: number): Partial<VoicePlace> {
  return f === 'span' ? { hspan: v, vspan: v } : f === 'az' ? { az: wrap180(v) } : { [f]: v }
}

export const SPACE_VOICE_LABEL: Record<SpaceVoice, string> = {
  spectra: 'Spectra', orbit: 'Orbit', flow: 'Flow', events: 'Events', raster: 'Raster',
  sstv: 'Transmission', filter: 'Filter', chord: 'Chord', collage: 'Collage', signal: 'Signal', assemblage: 'Assemblage'
}

export interface Speaker {
  id: number // its output channel, 1-based (a SpatGRIS speaker number)
  az: number
  el: number
  gainDb: number
  sub: boolean // direct out only : a subwoofer (fed the low end, never panned to)
}
export interface SpeakerLayout {
  name: string
  speakers: Speaker[]
}

/** Where one voice sits. `follow` : where it plays in the picture, through the
 *  dome mapping (or the flat-picture arc when the dome is off). */
export interface VoicePlace {
  follow: boolean
  az: number // degrees (fixed), or an offset added to the followed azimuth
  el: number // degrees (fixed); ignored while following
  width: number // degrees between the voice's left and right channels (its own stereo)
  hspan: number // 0..1 : spread around (1 = all the way round)
  vspan: number // 0..1 : spread up and down (1 = ±90°)
  spin: number // degrees per second, around the zenith
}

export interface SpaceConfig {
  mode: SpaceMode
  layoutKey: string // a built-in key, or 'file' for an imported setup
  layout: SpeakerLayout | null // the imported one (built-ins are made on the fly)
  firstChannel: number // 1-based : where Palinopsia's channels start on the output
  protocol: SpaceProtocol
  host: string // the renderer's IPv4 address
  port: number
  firstSource: number // SpatGRIS source / ADM object number of the first channel
  pairs: boolean // objects : each voice as a left/right pair of sources (else one mono source)
  rotate: number // degrees : turns the whole sound scene (line the sound's front up with the picture's)
  mirror: boolean // swaps left and right (a renderer or a room numbered the other way)
  flatWidth: number // dome off : the arc the flat picture spans in front, degrees
  flatLow: number // dome off : the elevation of the picture's bottom edge
  flatHigh: number // dome off : the elevation of its top edge
  subLevel: number // 0..1 : the low end sent to the subwoofers
  subXover: number // Hz
  glide: number // seconds : how softly a followed voice moves
  preview: boolean // headphones : the speakers (or objects) rendered binaurally to stereo
  pieces: number // 0 = off; else the Collage pieces as up to this many sources of their own
  voices: Record<SpaceVoice, VoicePlace>
}

const place = (p: Partial<VoicePlace>): VoicePlace => ({ follow: true, az: 0, el: 30, width: 60, hspan: 0.08, vspan: 0.08, spin: 0, ...p })

export function defaultVoicePlaces(): Record<SpaceVoice, VoicePlace> {
  return {
    spectra: place({}),
    orbit: place({ hspan: 0.15, vspan: 0.15 }),
    flow: place({ width: 90 }),
    events: place({ width: 90 }),
    raster: place({}),
    sstv: place({ width: 120 }),
    filter: place({}),
    chord: place({ follow: false, el: 90, width: 120, hspan: 0.3, vspan: 0.3 }), // from above
    collage: place({ width: 120, hspan: 0.25, vspan: 0.2 }),
    signal: place({ width: 90 }),
    assemblage: place({ width: 120, hspan: 0.2, vspan: 0.15 })
  }
}

export function defaultSpaceConfig(): SpaceConfig {
  return {
    mode: 'stereo',
    layoutKey: 'dome13',
    layout: null,
    firstChannel: 1,
    protocol: 'spatgris',
    host: '127.0.0.1',
    port: 18032,
    firstSource: 1,
    pairs: true,
    rotate: 0,
    mirror: false,
    flatWidth: 120,
    flatLow: 0,
    flatHigh: 45,
    subLevel: 0.5,
    subXover: 90,
    glide: 0.25,
    preview: false,
    pieces: 0,
    voices: defaultVoicePlaces()
  }
}

const num = (v: unknown, d: number, lo: number, hi: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}

export function sanitizeVoicePlaces(raw: unknown): Record<SpaceVoice, VoicePlace> {
  const d = defaultVoicePlaces()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Partial<VoicePlace>>
  const out = {} as Record<SpaceVoice, VoicePlace>
  for (const k of SPACE_VOICES) {
    const v = r[k] ?? {}
    const dv = d[k]
    out[k] = {
      follow: typeof v.follow === 'boolean' ? v.follow : dv.follow,
      az: num(v.az, dv.az, -180, 180),
      el: num(v.el, dv.el, -90, 90),
      width: num(v.width, dv.width, 0, 180),
      hspan: num(v.hspan, dv.hspan, 0, 1),
      vspan: num(v.vspan, dv.vspan, 0, 1),
      spin: num(v.spin, dv.spin, -360, 360)
    }
  }
  return out
}

function sanitizeLayout(raw: unknown): SpeakerLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<SpeakerLayout>
  if (!Array.isArray(r.speakers)) return null
  const speakers: Speaker[] = []
  for (const s of r.speakers.slice(0, 256)) {
    if (!s || typeof s !== 'object') continue
    const id = Math.round(Number(s.id))
    if (!(id >= 1 && id <= 256)) continue
    speakers.push({ id, az: num(s.az, 0, -180, 180), el: num(s.el, 0, -90, 90), gainDb: num(s.gainDb, 0, -60, 12), sub: !!s.sub })
  }
  return speakers.length ? { name: typeof r.name === 'string' ? r.name.slice(0, 120) : 'imported', speakers } : null
}

/** A renderer's address the OSC sender takes : an IPv4 address (each part up
 *  to 255) or localhost. */
export function validSpaceHost(h: unknown): h is string {
  if (typeof h !== 'string') return false
  const t = h.trim()
  return t === 'localhost' || (/^(\d{1,3}\.){3}\d{1,3}$/.test(t) && t.split('.').every((p) => Number(p) <= 255))
}

export function sanitizeSpaceConfig(raw: unknown): SpaceConfig {
  const d = defaultSpaceConfig()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SpaceConfig>
  const layout = sanitizeLayout(r.layout)
  const key = typeof r.layoutKey === 'string' && (r.layoutKey === 'file' ? !!layout : r.layoutKey in BUILTIN_LAYOUTS) ? r.layoutKey : d.layoutKey
  return {
    mode: r.mode === 'speakers' || r.mode === 'objects' ? r.mode : 'stereo',
    layoutKey: key,
    layout,
    firstChannel: Math.round(num(r.firstChannel, d.firstChannel, 1, SPACE_MAX_CH)),
    protocol: r.protocol === 'adm' ? 'adm' : 'spatgris',
    host: validSpaceHost(r.host) ? r.host.trim() : d.host,
    port: Math.round(num(r.port, d.port, 1, 65535)),
    firstSource: Math.round(num(r.firstSource, d.firstSource, 1, 128)),
    pairs: typeof r.pairs === 'boolean' ? r.pairs : d.pairs,
    rotate: num(r.rotate, d.rotate, -180, 180),
    mirror: !!r.mirror,
    flatWidth: num(r.flatWidth, d.flatWidth, 10, 360),
    flatLow: num(r.flatLow, d.flatLow, -30, 90),
    flatHigh: num(r.flatHigh, d.flatHigh, -30, 90),
    subLevel: num(r.subLevel, d.subLevel, 0, 1),
    subXover: num(r.subXover, d.subXover, 40, 200),
    glide: num(r.glide, d.glide, 0, 2),
    preview: !!r.preview,
    pieces: Math.round(num(r.pieces, d.pieces, 0, SPACE_PIECES)),
    voices: sanitizeVoicePlaces(r.voices)
  }
}

// ── layouts ──────────────────────────────────────────────────────────────────

/** Rings of speakers, numbered from the lowest ring up, each ring clockwise
 *  from the speaker just left of the front (a front pair straddles 0°). */
function rings(name: string, spec: Array<[count: number, el: number]>): SpeakerLayout {
  const speakers: Speaker[] = []
  let id = 1
  for (const [count, el] of spec) {
    const step = 360 / count
    for (let i = 0; i < count; i++) {
      const az = count === 1 ? 0 : wrap180(-step / 2 + i * step)
      speakers.push({ id: id++, az, el, gainDb: 0, sub: false })
    }
  }
  return { name, speakers }
}

export const BUILTIN_LAYOUTS: Record<string, { label: string; make: () => SpeakerLayout }> = {
  quad: { label: 'Quad (4)', make: () => rings('Quad', [[4, 0]]) },
  ring8: { label: 'Ring of 8', make: () => rings('Ring of 8', [[8, 0]]) },
  ring16: { label: 'Ring of 16', make: () => rings('Ring of 16', [[16, 0]]) },
  dome13: { label: 'Dome 8 + 4 + 1 (13)', make: () => rings('Dome 8 + 4 + 1', [[8, 0], [4, 45], [1, 90]]) },
  dome25: { label: 'Dome 12 + 8 + 4 + 1 (25)', make: () => rings('Dome 12 + 8 + 4 + 1', [[12, 0], [8, 30], [4, 60], [1, 90]]) },
  dome29: { label: 'Dome 16 + 8 + 4 + 1 (29)', make: () => rings('Dome 16 + 8 + 4 + 1', [[16, 0], [8, 30], [4, 60], [1, 90]]) }
}

/** The layout a config plays on. */
export function activeLayout(c: SpaceConfig): SpeakerLayout {
  if (c.layoutKey === 'file' && c.layout) return c.layout
  return (BUILTIN_LAYOUTS[c.layoutKey] ?? BUILTIN_LAYOUTS.dome13).make()
}

/** How many output channels a layout needs : its highest speaker number. */
export function layoutChannels(l: SpeakerLayout): number {
  let m = 0
  for (const s of l.speakers) if (s.id > m) m = s.id
  return m
}

/** A SpatGRIS speaker setup (the `SPEAKER_SETUP` XML its speaker-setup window
 *  saves and the venues publish : `<SPEAKER_n STATE GAIN DIRECT_OUT_ONLY>` with a
 *  `<POSITION X Y Z/>` inside, x right, y front, z up). Speaker n plays on output
 *  channel n. Muted speakers are left out. Returns null with a reason. */
export function parseSpatGrisSetup(xml: string, name = 'imported'): { layout: SpeakerLayout | null; error?: string } {
  if (!/<SPEAKER_SETUP\b/.test(xml)) return { layout: null, error: 'not a SpatGRIS speaker setup (no SPEAKER_SETUP element)' }
  const speakers: Speaker[] = []
  const re = /<SPEAKER_(\d+)\b([^>]*)>([\s\S]*?)<\/SPEAKER_\1\s*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const id = Number(m[1])
    const attrs = m[2]
    const pos = /<POSITION\b([^>]*)\/?>/.exec(m[3])
    if (!pos || !(id >= 1 && id <= 256)) continue
    const a = (s: string, k: string): string | null => {
      const mm = new RegExp(`\\b${k}="([^"]*)"`).exec(s)
      return mm ? mm[1] : null
    }
    const state = (a(attrs, 'STATE') ?? 'normal').toLowerCase()
    if (state.includes('mute')) continue
    const x = Number(a(pos[1], 'X')), y = Number(a(pos[1], 'Y')), z = Number(a(pos[1], 'Z'))
    if (![x, y, z].every(Number.isFinite)) continue
    const { az, el } = vecToAzEl(x, y, z)
    speakers.push({
      id,
      az,
      el,
      gainDb: Number.isFinite(Number(a(attrs, 'GAIN'))) ? Number(a(attrs, 'GAIN')) : 0,
      sub: a(attrs, 'DIRECT_OUT_ONLY') === '1'
    })
  }
  if (!speakers.length) return { layout: null, error: 'no speakers in it' }
  speakers.sort((p, q) => p.id - q.id)
  return { layout: { name, speakers } }
}

// ── directions ───────────────────────────────────────────────────────────────

const D2R = Math.PI / 180
export const wrap180 = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180

export function azElToVec(az: number, el: number): [number, number, number] {
  const a = az * D2R, e = el * D2R
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)]
}
export function vecToAzEl(x: number, y: number, z: number): { az: number; el: number } {
  const r = Math.hypot(x, y, z) || 1
  const el = Math.asin(Math.max(-1, Math.min(1, z / r))) / D2R
  const az = Math.hypot(x, y) < 1e-9 ? 0 : Math.atan2(x, y) / D2R
  return { az: wrap180(az), el }
}

/** Where a point of the flat picture (x, y in 0..1, y DOWN from the top, the
 *  Sonify convention) lands in the room : through the dome mapping when the
 *  dome is on (the inverse of engine/dome.ts, mode by mode), else on the arc
 *  the flat picture spans in front. `spinDeg` : the dome stage's spin phase. */
export function pictureToDirection(
  x: number,
  yDown: number,
  dome: DomeConfig | null,
  aspect: number,
  spinDeg: number,
  flat: { width: number; low: number; high: number }
): { az: number; el: number } {
  const px = Math.max(0, Math.min(1, x))
  const py = 1 - Math.max(0, Math.min(1, yDown)) // GL : 0 at the bottom
  if (!dome || !dome.enabled) {
    return { az: (px - 0.5) * flat.width, el: flat.low + py * (flat.high - flat.low) }
  }
  const rot = dome.rotate + spinDeg
  if (dome.mode === 'wrap') {
    // the copy that sits on the front at rotation 0 (it turns with the spin)
    const top = Math.max(dome.top, dome.bottom + 1)
    return { az: wrap180((px - 0.5) * (360 / Math.max(1, dome.turns)) + rot), el: dome.bottom + py * (top - dome.bottom) }
  }
  if (dome.mode === 'screen') {
    const a = (dome.azimuth + rot) * D2R, e = dome.elevation * D2R
    // dome.ts's basis : x right, y up, z = −front
    const C: V3 = [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)]
    const upRef: V3 = Math.abs(C[1]) > 0.995 ? [Math.sin(a), 0, -Math.cos(a)] : [0, 1, 0]
    let R = norm(cross(C, upRef))
    let U = norm(cross(R, C))
    const ro = dome.roll * D2R
    if (ro !== 0) {
      const c = Math.cos(ro), s = Math.sin(ro)
      const R2: V3 = [R[0] * c + U[0] * s, R[1] * c + U[1] * s, R[2] * c + U[2] * s]
      U = [U[0] * c - R[0] * s, U[1] * c - R[1] * s, U[2] * c - R[2] * s]
      R = R2
    }
    const hw = Math.tan((Math.min(170, dome.width) * D2R) / 2)
    const hh = hw / Math.max(0.1, aspect)
    const sx = px * 2 - 1, sy = py * 2 - 1
    const D = norm([C[0] + sx * hw * R[0] + sy * hh * U[0], C[1] + sx * hw * R[1] + sy * hh * U[1], C[2] + sx * hw * R[2] + sy * hh * U[2]])
    return { az: wrap180(Math.atan2(D[0], -D[2]) / D2R), el: Math.asin(Math.max(-1, Math.min(1, D[1]))) / D2R }
  }
  // full dome (fisheye) : the frame → the master circle, as dome.ts reads it back
  let qx: number, qy: number
  if (dome.fit === 'fill') {
    const dx = px * 2 - 1, dy = py * 2 - 1 // square → disc (Fong's elliptical grid)
    qx = dx * Math.sqrt(Math.max(0, 1 - (dy * dy) / 2))
    qy = dy * Math.sqrt(Math.max(0, 1 - (dx * dx) / 2))
  } else if (dome.fit === 'cover') {
    qx = (px - 0.5) * 2 * aspect
    qy = (py - 0.5) * 2
  } else {
    const k = Math.sqrt(1 + aspect * aspect)
    qx = ((px - 0.5) * 2 * aspect) / k
    qy = ((py - 0.5) * 2) / k
  }
  // dome.ts : qq = rot(q) / scale − offset  →  q = rot⁻¹((qq + offset) · scale)
  const tx = (qx + dome.offsetX) * dome.scale, ty = (qy + dome.offsetY) * dome.scale
  const c = Math.cos(rot * D2R), s = Math.sin(rot * D2R)
  const mx = c * tx + s * ty, my = -s * tx + c * ty
  const r = Math.min(1, Math.hypot(mx, my)) // past the rim : on the rim
  const theta = (r * dome.aperture) / 2 // degrees from the zenith (equidistant)
  const az = r < 1e-6 ? 0 : Math.atan2(mx, -my) / D2R // 0 = front (the master's bottom)
  return { az: wrap180(az), el: 90 - theta }
}

type V3 = [number, number, number]
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

// ── VBAP ─────────────────────────────────────────────────────────────────────

/** A speaker layout ready to pan onto : its panned (non-sub) speakers as unit
 *  vectors and the triangles (or pairs, for a flat ring) between them, each with
 *  its inverted base. */
export interface Vbap {
  speakers: Speaker[] // the panned speakers (subs left out), in `gains` order
  dim: 2 | 3
  sets: Int16Array // 3 (or 2) speaker indices per set; an index ≥ speakers.length is the virtual nadir
  inv: Float64Array // 9 (or 4) per set : the inverted base
}

const EPS = 1e-6

export function buildVbap(layout: SpeakerLayout): Vbap {
  const sp = layout.speakers.filter((s) => !s.sub)
  const v = sp.map((s) => azElToVec(s.az, s.el))
  const flat = v.every((p) => Math.abs(p[2]) < 0.05)
  if (sp.length < 2) return { speakers: sp, dim: 2, sets: new Int16Array(0), inv: new Float64Array(0) }
  if (flat || sp.length < 3) {
    // a ring : neighbours by azimuth, 2D bases on the horizontal plane
    const order = sp.map((s, i) => ({ i, az: s.az })).sort((p, q) => p.az - q.az)
    const sets: number[] = []
    const inv: number[] = []
    for (let k = 0; k < order.length; k++) {
      const i = order[k].i, j = order[(k + 1) % order.length].i
      if (i === j) continue
      const a = [Math.sin(sp[i].az * D2R), Math.cos(sp[i].az * D2R)]
      const b = [Math.sin(sp[j].az * D2R), Math.cos(sp[j].az * D2R)]
      const det = a[0] * b[1] - a[1] * b[0]
      if (Math.abs(det) < 1e-9) continue // opposite or coincident : no base
      sets.push(i, j)
      // rows a, b ; g = p · M⁻¹
      inv.push(b[1] / det, -a[1] / det, -b[0] / det, a[0] / det)
    }
    return { speakers: sp, dim: 2, sets: Int16Array.from(sets), inv: Float64Array.from(inv) }
  }
  // 3D : the convex hull of the directions, closed underneath by a virtual
  // speaker at the nadir when nothing is below the horizon (a dome), so a
  // voice under the horizon lands on the lowest ring instead of nowhere.
  const pts: V3[] = v.map((p) => [p[0], p[1], p[2]] as V3)
  if (!pts.some((p) => p[2] < -0.1)) pts.push([0, 0, -1])
  const tris = convexHull(pts)
  const sets: number[] = []
  const inv: number[] = []
  for (const [i, j, k] of tris) {
    const m = invert3(pts[i], pts[j], pts[k])
    if (!m) continue
    sets.push(i, j, k)
    inv.push(...m)
  }
  return { speakers: sp, dim: 3, sets: Int16Array.from(sets), inv: Float64Array.from(inv) }
}

/** Rows a, b, c → the inverse of [a; b; c] (so g = p · inv), or null. */
function invert3(a: V3, b: V3, c: V3): number[] | null {
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
  if (Math.abs(det) < 1e-9) return null
  const id = 1 / det
  return [
    (b[1] * c[2] - b[2] * c[1]) * id, (a[2] * c[1] - a[1] * c[2]) * id, (a[1] * b[2] - a[2] * b[1]) * id,
    (b[2] * c[0] - b[0] * c[2]) * id, (a[0] * c[2] - a[2] * c[0]) * id, (a[2] * b[0] - a[0] * b[2]) * id,
    (b[0] * c[1] - b[1] * c[0]) * id, (a[1] * c[0] - a[0] * c[1]) * id, (a[0] * b[1] - a[1] * b[0]) * id
  ]
}

/** Triangles of the convex hull of points on (or near) the unit sphere. Brute
 *  force over triplets (a setup is at most a couple of hundred speakers, done
 *  once); a face with more than three points on it (a square of four speakers)
 *  is fanned once instead of counted four times. */
function convexHull(p: V3[]): Array<[number, number, number]> {
  const n = p.length
  const seen = new Set<string>()
  const out: Array<[number, number, number]> = []
  const tol = 1e-7
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const nrm = cross(sub(p[j], p[i]), sub(p[k], p[i]))
        const ln = Math.hypot(nrm[0], nrm[1], nrm[2])
        if (ln < 1e-9) continue
        const nn: V3 = [nrm[0] / ln, nrm[1] / ln, nrm[2] / ln]
        const d = dot(nn, p[i])
        let pos = false, neg = false
        const on: number[] = []
        for (let q = 0; q < n; q++) {
          const sd = dot(nn, p[q]) - d
          if (sd > tol) pos = true
          else if (sd < -tol) neg = true
          else on.push(q)
          if (pos && neg) break
        }
        if (pos && neg) continue
        const key = on.join(',')
        if (seen.has(key)) continue
        seen.add(key)
        if (on.length === 3) { out.push([on[0], on[1], on[2]]); continue }
        // fan a polygon : order its points by angle around their centre
        const cx = on.reduce((s, q) => s + p[q][0], 0) / on.length
        const cy = on.reduce((s, q) => s + p[q][1], 0) / on.length
        const cz = on.reduce((s, q) => s + p[q][2], 0) / on.length
        const u = norm(sub(p[on[0]], [cx, cy, cz]))
        const w = cross(nn, u)
        const ord = on
          .map((q) => { const r = sub(p[q], [cx, cy, cz]); return { q, a: Math.atan2(dot(r, w), dot(r, u)) } })
          .sort((x, y) => x.a - y.a)
          .map((o) => o.q)
        for (let t = 1; t + 1 < ord.length; t++) out.push([ord[0], ord[t], ord[t + 1]])
      }
  return out
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Amplitude gains for one direction, added into `out` (one per panned speaker),
 *  scaled by `w`. Unnormalised sum : the caller normalises the power once. */
function addPoint(v: Vbap, az: number, el: number, w: number, out: Float64Array): void {
  const n = v.speakers.length
  if (n === 0) return
  if (n === 1) { out[0] += w; return }
  const p = azElToVec(az, el)
  let best = -1, bestMin = -Infinity
  const g = [0, 0, 0]
  const stride = v.dim
  const sets = v.sets.length / stride
  for (let t = 0; t < sets; t++) {
    const o = t * stride * stride
    let g0: number, g1: number, g2 = 0
    if (v.dim === 2) {
      const len = Math.hypot(p[0], p[1]) || 1
      const x = p[0] / len, y = p[1] / len
      g0 = x * v.inv[o] + y * v.inv[o + 2]
      g1 = x * v.inv[o + 1] + y * v.inv[o + 3]
    } else {
      g0 = p[0] * v.inv[o] + p[1] * v.inv[o + 3] + p[2] * v.inv[o + 6]
      g1 = p[0] * v.inv[o + 1] + p[1] * v.inv[o + 4] + p[2] * v.inv[o + 7]
      g2 = p[0] * v.inv[o + 2] + p[1] * v.inv[o + 5] + p[2] * v.inv[o + 8]
    }
    const mn = v.dim === 2 ? Math.min(g0, g1) : Math.min(g0, g1, g2)
    if (mn > bestMin) { bestMin = mn; best = t; g[0] = g0; g[1] = g1; g[2] = g2 }
    if (mn >= -EPS) break
  }
  // no base at all (two opposite speakers) : the nearest one
  if (best < 0) { out[nearestSpeaker(v, p)] += w; return }
  const idx = best * stride
  let pw = 0
  const real = [false, false, false]
  for (let k = 0; k < stride; k++) {
    const s = v.sets[idx + k]
    const gk = Math.max(0, g[k])
    if (s < n) { real[k] = true; pw += gk * gk }
  }
  // the virtual nadir's share is dropped and the rest brought back to unit power
  if (pw > 1e-12) {
    const norm = 1 / Math.sqrt(pw)
    for (let k = 0; k < stride; k++) if (real[k]) out[v.sets[idx + k]] += Math.max(0, g[k]) * norm * w
    return
  }
  // Outside every speaker pair or triangle (an imported setup with a gap of 180°
  // or more, every speaker on one side) : the nearest speaker, never silence.
  out[nearestSpeaker(v, p)] += w
}

function nearestSpeaker(v: Vbap, p: number[]): number {
  let near = 0, dot = -Infinity
  for (let i = 0; i < v.speakers.length; i++) {
    const q = azElToVec(v.speakers[i].az, v.speakers[i].el)
    const d = q[0] * p[0] + q[1] * p[1] + q[2] * p[2]
    if (d > dot) { dot = d; near = i }
  }
  return near
}

/** The gains for a voice at (az, el) spread by (hspan, vspan) : one per panned
 *  speaker, unit power. A span is many points (MDAP) summed : the source
 *  becomes a patch of the dome instead of a point. */
export function spaceGains(v: Vbap, az: number, el: number, hspan: number, vspan: number, out: Float64Array): void {
  out.fill(0)
  if (hspan < 0.005 && vspan < 0.005) {
    addPoint(v, az, el, 1, out)
  } else {
    const ha = hspan * 180, va = vspan * 90
    for (const fe of [-1, -0.5, 0, 0.5, 1])
      for (const fa of [-1, -0.5, 0, 0.5, 1]) {
        const e = Math.max(-90, Math.min(90, el + fe * va))
        addPoint(v, wrap180(az + fa * ha), e, 1, out)
      }
  }
  let pw = 0
  for (let i = 0; i < out.length; i++) pw += out[i] * out[i]
  if (pw > 1e-12) {
    const k = 1 / Math.sqrt(pw)
    for (let i = 0; i < out.length; i++) out[i] *= k
  }
}
