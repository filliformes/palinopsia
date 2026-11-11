// Lights : DMX fixtures mapped onto the picture (the Lights page, key T).
//
// Two halves, kept apart on purpose :
// - the RIG is the room : the fixtures (an LED bar, a small spot, a matrix), where
//   each sits on the picture, how it is patched (output, universe, address, its
//   channel layout) and the outputs themselves (an Enttec DMX USB Pro, Art-Net,
//   sACN, WLED). It belongs to this computer (localStorage), like a venue's patch.
// - the LOOK is the piece : what each fixture shows (the master, a layer, a color,
//   a gradient, nothing), the effect moving it, its level, plus the masters and
//   the light scenes. It is saved with the session.
// The TUNING (a grade per fixture : how this physical light renders the picture)
// lives in the rig, or, when `tuneScope` is 'look', travels with the session and
// the light scenes.
//
// Positions are in the picture, 0..1, x to the right and y DOWN (as drawn).

export type LightKind = 'strip' | 'spot' | 'matrix' | 'ring'
/** A matrix's first LED : the corner it starts in. */
export type LightCorner = 'tl' | 'tr' | 'bl' | 'br'
export type LightSourceKind = 'master' | 'layer' | 'color' | 'gradient' | 'off'
export type LightEffect =
  | 'none' | 'chase' | 'wave' | 'pulse' | 'sparkle' | 'audio' | 'beat' | 'presence'
  // the digital ones (lights/lightFx.ts) :
  | 'automaton' // a cellular automaton and its history, drawn across the room
  | 'life' // the Game of Life over the room
  | 'fireflies' // each pixel blinks on its own, they fall into step and out again
  | 'noise' // slow clouds of light drifting
  | 'hold' // each pixel freezes what it saw, then looks again
  | 'glitch' // blocks of wrong colors breaking in
  | 'binary' // the lights count the beats in binary
  | 'echo' // the picture as it was a moment ago
  | 'afterimage' // the complement of what the picture just was, fading
  | 'scan' // the lights slide across the picture and read it
  | 'bits' // every channel fully on or off : eight colors
/** The digital effects, in the menu's order. */
export const DIGITAL_EFFECTS: readonly LightEffect[] = ['afterimage', 'echo', 'hold', 'bits', 'glitch', 'scan', 'automaton', 'life', 'fireflies', 'noise', 'binary']
/** How an effect (and a fan) travels : through the room by where each pixel is, or
 *  light by light in an order, as a lighting console spreads a phase over a group. */
export type LightOrder = 'room' | 'ltr' | 'center' | 'random' | 'oddeven'
/** What the sound effect follows : the whole level, or one band of it. */
export type LightBand = 'level' | 'low' | 'mid' | 'high'
export type LightOutputKind = 'enttec' | 'artnet' | 'sacn' | 'wled'
export type LightTuneScope = 'rig' | 'look'
/** How a pixel reads the picture around it : the average of its patch, its most
 *  colorful part (a busy picture's average goes beige), or its brightest. */
export type LightSample = 'average' | 'vivid' | 'bright'

/** A grade for one physical light : how its LEDs render the color sent to them. */
export interface LightTune {
  brightness: number // 0..2, 1 = as is
  contrast: number // 0..2
  gamma: number // 0.5..3 : LEDs are linear, the picture is not (2 looks like the screen)
  saturation: number // 0..2
  hue: number // -180..180 degrees
  warmth: number // -1..1 : cooler .. warmer (a white balance)
  black: number // 0..0.3 : the floor under the color (an LED never quite off)
  smooth: number // 0..2 s : how slowly it follows (video flicker calmed)
}

export interface LightFixture {
  id: string
  name: string
  kind: LightKind
  // On the picture (0..1, y down). strip : a line from (x0,y0) to (x1,y1) (through
  // its bends), its pixels spread along it; spot : a disc at (x0,y0); matrix : a
  // rectangle; ring : a circle around (x0,y0), its first LED at (x1,y1).
  x0: number
  y0: number
  x1: number
  y1: number
  size: number // the sampled footprint around each pixel (0..0.3 of the frame height)
  pixels: number // strip : its LEDs (1..2048); spot : 1
  cols: number // matrix
  rows: number
  serpentine: boolean // matrix : wired back and forth (zigzag)
  reverse: boolean // strip / ring : the first LED at the other end (the ring : the other way round)
  bends: number[] // strip : the points it bends through, x y x y... (0..32 of them)
  start: LightCorner // matrix : the corner its first LED is in
  byCols: boolean // matrix : wired column by column instead of row by row
  layout: string // channels per pixel : RGB, GRB, RGBW, DRGB... (layoutTokens)
  head: string // channels sent once before the pixels (a bar's own dimmer and strobe : 'D S')
  tail: string // channels sent once after them
  profile: string // the profile it was set from ('' : its own channels)
  out: string // the output it is patched to ('' : none)
  universe: number // network outputs (Art-Net / sACN / WLED); an Enttec has one
  address: number // 1..512 : its first channel
  tune: LightTune
}

export interface LightOutput {
  id: string
  name: string
  kind: LightOutputKind
  enabled: boolean
  host: string // network outputs ('' for sACN : multicast)
  index: number // enttec : which one when several are plugged in (0 = the first)
  delay: number // 0..1000 ms : held back this long, so the lights land with a projector's picture
  sync: boolean // Art-Net : an ArtSync after each frame (nodes that know it show every universe together)
}

export interface LightGradient {
  stops: number[][] // 2..5 RGB colors, 0..1
  angle: number // degrees : the direction it runs across the room (along : unused)
  scale: number // 0.1..4 : how many times it fits across
  offset: number // 0..1
  speed: number // -2..2 : its drift (cycles a second, times the master speed)
  along: boolean // along each fixture instead of across the room
}

/** What one fixture shows. */
export interface LightLook {
  source: LightSourceKind
  layer: number // 0..3 when source is 'layer'
  sample: LightSample // the picture : how each pixel reads its patch
  hue: number // color : 0..360
  sat: number // 0..1
  val: number // 0..1
  gradient: LightGradient
  effect: LightEffect
  rate: number // 0..4 : the effect's speed (Hz, or beats for 'beat'), times the master speed
  depth: number // 0..1 : how much it moves the light
  width: number // 0.02..1 : a chase's band, a wave's length
  angle: number // degrees : the direction a chase or a wave travels
  level: number // 0..1 : this fixture's own fader
  order: LightOrder // through the room, or light by light (left to right, from the center...)
  wings: number // 1..4 : light by light, the order folded into mirrored parts
  fan: number // -180..180 degrees : a hue spread across the room or the order
  band: LightBand // the sound effect : the level or a band
  rule: number // 0..255 : the automaton's rule (30 : chaos, 90 : triangles, 110 : gliders)
}

export interface LightsMaster {
  brightness: number // 0..1 : the grand master
  speed: number // 0..4 : every effect's and gradient's clock
  blackSec: number // 0..20 : how long Black takes
  fadeSec: number // 0..20 : how long a light scene takes to come in
}

export interface LightScene {
  id: string
  name: string
  looks: Record<string, LightLook>
  master?: { brightness: number; speed: number }
  groups?: Record<string, number> // the group faders
  tunes?: Record<string, LightTune> // when the tuning travels with the look
  // as a cue :
  fade?: number // its own fade in (s; absent : the console's scene fade)
  follow?: number // the next cue goes this long after it is in (s; absent or 0 : waits for GO)
  link?: string // a Palinopsia scene : recalling it brings this cue
}

/** Lights that play together : a fader of their own on the console (a submaster),
 *  picked at once on the map to give them a look or a show. */
export interface LightGroup {
  id: string
  name: string
  members: string[] // fixture ids
}

/** A fixture's channels : what a real light expects, by name. A built-in one, or
 *  read from an Open Fixture Library file (one per mode). */
export interface LightProfile {
  id: string
  name: string
  kind: LightKind
  head: string
  layout: string
  tail: string
  pixels?: number // strip
  cols?: number // matrix
  rows?: number
  /** Per channel, what it does (the patch readout) : 'dimmer', 'red', 'strobe (held at 0)'... */
  labels?: string[]
}

export interface LightRig {
  fixtures: LightFixture[]
  outputs: LightOutput[]
  groups: LightGroup[]
  profiles: LightProfile[] // the ones imported on this computer
  tuneScope: LightTuneScope
  fps: number // 10..44 : DMX frames a second
  on: boolean // the lights send at all
}

/** The session's part. */
export interface LightsSession {
  looks: Record<string, LightLook>
  scenes: LightScene[]
  master: LightsMaster
  groups?: Record<string, number> // each group's fader (absent : 1)
  tunes?: Record<string, LightTune>
}

// ── defaults ────────────────────────────────────────────────────────────────

export const TUNE_DEFAULT: LightTune = { brightness: 1, contrast: 1, gamma: 2, saturation: 1, hue: 0, warmth: 0, black: 0, smooth: 0.08 }

export const GRADIENT_DEFAULT: LightGradient = {
  stops: [[0.9, 0.25, 0.1], [1, 0.62, 0.25], [0.35, 0.2, 0.8]],
  angle: 0, scale: 1, offset: 0, speed: 0.05, along: false
}

export const LOOK_DEFAULT: LightLook = {
  source: 'master', layer: 0, sample: 'average', hue: 30, sat: 0.6, val: 1, gradient: GRADIENT_DEFAULT,
  effect: 'none', rate: 0.5, depth: 0.6, width: 0.25, angle: 0, level: 1,
  order: 'room', wings: 1, fan: 0, band: 'level', rule: 30
}

export const MASTER_DEFAULT: LightsMaster = { brightness: 1, speed: 1, blackSec: 2, fadeSec: 1.5 }

export const RIG_DEFAULT: LightRig = { fixtures: [], outputs: [], groups: [], profiles: [], tuneScope: 'rig', fps: 40, on: true }

export const SESSION_DEFAULT: LightsSession = { looks: {}, scenes: [], master: MASTER_DEFAULT }

/** Channel layouts offered in the menu (any other string of tokens works too). */
export const LAYOUTS = ['RGB', 'GRB', 'BRG', 'BGR', 'RGBW', 'GRBW', 'DRGB', 'D16RGB', 'RGBD', 'DRGBW', 'D16RGBW', 'DRGBS', 'RGBWA', 'RGBWAU', 'W', 'L', 'L16', 'DCMY'] as const

/** The sliders a modulator or a Macro knob can move (ranges = the sliders'). A
 *  target on the masters carries fixture '', a group's fader `grp:<id>` (field level). */
export const GROUP_PREFIX = 'grp:'
export type LightModField =
  | 'level' | 'hue' | 'sat' | 'val' | 'gradOffset' | 'gradAngle' | 'gradScale'
  | 'rate' | 'depth' | 'width' | 'angle' | 'fan'
  | 'tuneBrightness' | 'tuneSaturation' | 'tuneHue' | 'tuneWarmth'
  | 'masterBrightness' | 'masterSpeed'
export const LIGHT_MOD_RANGE: Record<LightModField, { min: number; max: number; label: string }> = {
  level: { min: 0, max: 1, label: 'level' },
  hue: { min: 0, max: 360, label: 'hue' },
  sat: { min: 0, max: 1, label: 'saturation' },
  val: { min: 0, max: 1, label: 'brightness' },
  gradOffset: { min: 0, max: 1, label: 'gradient offset' },
  gradAngle: { min: -180, max: 180, label: 'gradient angle' },
  gradScale: { min: 0.1, max: 4, label: 'gradient scale' },
  rate: { min: 0, max: 4, label: 'effect rate' },
  depth: { min: 0, max: 1, label: 'effect depth' },
  width: { min: 0.02, max: 1, label: 'effect width' },
  angle: { min: -180, max: 180, label: 'effect angle' },
  fan: { min: -180, max: 180, label: 'fan' },
  tuneBrightness: { min: 0, max: 2, label: 'tune brightness' },
  tuneSaturation: { min: 0, max: 2, label: 'tune saturation' },
  tuneHue: { min: -180, max: 180, label: 'tune hue' },
  tuneWarmth: { min: -1, max: 1, label: 'tune warmth' },
  masterBrightness: { min: 0, max: 1, label: 'master' },
  masterSpeed: { min: 0, max: 4, label: 'speed' }
}
export const LIGHT_MASTER_FIELDS: LightModField[] = ['masterBrightness', 'masterSpeed']

// ── sanitizers (a file, a session, an older build : never trusted) ──────────

const num = (v: unknown, d: number, lo: number, hi: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d
  return n < lo ? lo : n > hi ? hi : n
}
const str = (v: unknown, d: string, max = 64): string => (typeof v === 'string' ? v.slice(0, max) : d)
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const rgb = (v: unknown, d: number[]): number[] =>
  Array.isArray(v) && v.length >= 3 ? [num(v[0], d[0], 0, 1), num(v[1], d[1], 0, 1), num(v[2], d[2], 0, 1)] : d.slice()
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)

export const KINDS: readonly LightKind[] = ['strip', 'spot', 'matrix', 'ring']
export const CORNERS: readonly LightCorner[] = ['tl', 'tr', 'bl', 'br']
export const SOURCES: readonly LightSourceKind[] = ['master', 'layer', 'color', 'gradient', 'off']
export const CLASSIC_EFFECTS: readonly LightEffect[] = ['none', 'chase', 'wave', 'pulse', 'sparkle', 'audio', 'beat', 'presence']
export const EFFECTS: readonly LightEffect[] = [...CLASSIC_EFFECTS, ...DIGITAL_EFFECTS]
export const ORDERS: readonly LightOrder[] = ['room', 'ltr', 'center', 'random', 'oddeven']
export const BANDS: readonly LightBand[] = ['level', 'low', 'mid', 'high']
export const SAMPLES: readonly LightSample[] = ['average', 'vivid', 'bright']
export const OUTPUT_KINDS: readonly LightOutputKind[] = ['enttec', 'artnet', 'sacn', 'wled']

export function sanitizeTune(raw: unknown): LightTune {
  const r = obj(raw), d = TUNE_DEFAULT
  return {
    brightness: num(r.brightness, d.brightness, 0, 2),
    contrast: num(r.contrast, d.contrast, 0, 2),
    gamma: num(r.gamma, d.gamma, 0.5, 3),
    saturation: num(r.saturation, d.saturation, 0, 2),
    hue: num(r.hue, d.hue, -180, 180),
    warmth: num(r.warmth, d.warmth, -1, 1),
    black: num(r.black, d.black, 0, 0.3),
    smooth: num(r.smooth, d.smooth, 0, 2)
  }
}

/** A layout's tokens : a letter (R G B W A U, C M Y, L the luminance, D a dimmer,
 *  S strobe, X unused), the same followed by 16 for two channels (coarse and fine :
 *  D16 is a dimmer and its fine channel), or a number for a channel held at that
 *  value. Empty or unreadable : RGB. */
export const MAX_TOKENS = 128
const rawTokens = (layout: string): string[] => (layout || '').toUpperCase().match(/[RGBWAUDSXCMYL](?:16)?|\d{1,3}/g) ?? []
export function layoutTokens(layout: string, fallback = true): string[] {
  const t = rawTokens(layout)
  return t.length ? t.slice(0, MAX_TOKENS) : fallback ? ['R', 'G', 'B'] : []
}
/** A layout as kept : as written ("RGB" stays "RGB"); one too long is cut after a
 *  whole token, never in the middle of one ("128" never becomes "12"). */
const tokenText = (v: unknown, fallback: string): string => {
  const text = typeof v === 'string' ? v.trim() : ''
  const t = rawTokens(text)
  if (!t.length) return fallback
  return t.length > MAX_TOKENS || text.length > 1024 ? t.slice(0, MAX_TOKENS).join(' ') : text
}
/** The channels a token takes (a 16-bit one : two). */
export const tokenWidth = (t: string): number => (t.length === 3 && t.endsWith('16') && t[0] >= 'A' && t[0] <= 'Z' ? 2 : 1)
export const layoutChannels = (tokens: string[]): number => tokens.reduce((n, t) => n + tokenWidth(t), 0)

export function sanitizeFixture(raw: unknown, i = 0): LightFixture {
  const r = obj(raw)
  const kind = oneOf(r.kind, KINDS, 'strip')
  return {
    id: str(r.id, `fx${Date.now().toString(36)}${i}`, 40) || `fx${i}`,
    name: str(r.name, kind === 'spot' ? 'Spot' : kind === 'matrix' ? 'Matrix' : kind === 'ring' ? 'Ring' : 'LED bar', 40),
    kind,
    x0: num(r.x0, 0.2, -0.5, 1.5),
    y0: num(r.y0, 0.5, -0.5, 1.5),
    x1: num(r.x1, 0.8, -0.5, 1.5),
    y1: num(r.y1, 0.5, -0.5, 1.5),
    size: num(r.size, 0.03, 0, 0.3),
    // (a spot keeps the count it had as a bar : fixturePixels says 1 for it)
    pixels: Math.round(num(r.pixels, kind === 'spot' ? 1 : 30, 1, 2048)),
    cols: Math.round(num(r.cols, 8, 1, 128)),
    // (4096 cells at most : a 128 × 128 matrix would take the render thread)
    rows: Math.min(Math.round(num(r.rows, 4, 1, 128)), Math.max(1, Math.floor(4096 / Math.round(num(r.cols, 8, 1, 128))))),
    serpentine: bool(r.serpentine, false),
    reverse: bool(r.reverse, false),
    bends: (Array.isArray(r.bends) ? r.bends : []).slice(0, 64).map((v) => num(v, 0.5, -0.5, 1.5)).slice(0, Math.floor(Math.min(64, Array.isArray(r.bends) ? r.bends.length : 0) / 2) * 2),
    start: oneOf(r.start, CORNERS, 'tl'),
    byCols: bool(r.byCols, false),
    layout: tokenText(r.layout, 'RGB'),
    head: tokenText(r.head, ''),
    tail: tokenText(r.tail, ''),
    profile: str(r.profile, '', 80),
    out: str(r.out, '', 40),
    universe: Math.round(num(r.universe, 0, 0, 32767)),
    address: Math.round(num(r.address, 1, 1, 512)),
    tune: sanitizeTune(r.tune)
  }
}

export function sanitizeOutput(raw: unknown, i = 0): LightOutput {
  const r = obj(raw)
  const kind = oneOf(r.kind, OUTPUT_KINDS, 'enttec')
  return {
    id: str(r.id, `out${i}`, 40) || `out${i}`,
    name: str(r.name, kind === 'enttec' ? 'Enttec USB Pro' : kind === 'artnet' ? 'Art-Net' : kind === 'sacn' ? 'sACN' : 'WLED', 40),
    kind,
    enabled: bool(r.enabled, true),
    host: str(r.host, '', 64).trim(),
    index: Math.round(num(r.index, 0, 0, 7)),
    delay: Math.round(num(r.delay, 0, 0, 1000)),
    sync: bool(r.sync, false)
  }
}

export function sanitizeProfile(raw: unknown, i = 0): LightProfile {
  const r = obj(raw)
  const kind = oneOf(r.kind, KINDS, 'spot')
  return {
    id: str(r.id, `pr${i}`, 80) || `pr${i}`,
    name: str(r.name, 'Fixture', 80) || 'Fixture',
    kind,
    head: tokenText(r.head, ''),
    layout: tokenText(r.layout, 'RGB'),
    tail: tokenText(r.tail, ''),
    ...(typeof r.pixels === 'number' ? { pixels: Math.round(num(r.pixels, 1, 1, 2048)) } : {}),
    ...(typeof r.cols === 'number' ? { cols: Math.round(num(r.cols, 1, 1, 128)) } : {}),
    ...(typeof r.rows === 'number' ? { rows: Math.round(num(r.rows, 1, 1, 128)) } : {}),
    ...(Array.isArray(r.labels) ? { labels: r.labels.slice(0, 256).map((x) => str(x, '', 40)) } : {})
  }
}

export function sanitizeRig(raw: unknown): LightRig {
  const r = obj(raw)
  const fixtures = (Array.isArray(r.fixtures) ? r.fixtures : []).slice(0, 256).map(sanitizeFixture)
  const outputs = (Array.isArray(r.outputs) ? r.outputs : []).slice(0, 32).map(sanitizeOutput)
  // (ids unique : a hand-edited file with two of one would patch both as one)
  const seen = new Set<string>()
  for (const f of fixtures) { while (seen.has(f.id)) f.id += 'x'; seen.add(f.id) }
  const ids = new Set(fixtures.map((f) => f.id))
  const groups = (Array.isArray(r.groups) ? r.groups : []).slice(0, 64).map((g, i) => {
    const o = obj(g)
    return {
      id: str(o.id, `g${i}`, 40) || `g${i}`,
      name: str(o.name, `Group ${i + 1}`, 40) || `Group ${i + 1}`,
      members: (Array.isArray(o.members) ? o.members : []).filter((m): m is string => typeof m === 'string' && ids.has(m)).slice(0, 256)
    }
  })
  const profiles = (Array.isArray(r.profiles) ? r.profiles : []).slice(0, 128).map(sanitizeProfile)
  return {
    fixtures,
    outputs,
    groups,
    profiles,
    tuneScope: oneOf(r.tuneScope, ['rig', 'look'] as const, 'rig'),
    fps: Math.round(num(r.fps, 40, 10, 44)),
    on: bool(r.on, true)
  }
}

export function sanitizeGradient(raw: unknown): LightGradient {
  const r = obj(raw), d = GRADIENT_DEFAULT
  const stops = (Array.isArray(r.stops) ? r.stops : d.stops).slice(0, 5).map((s, i) => rgb(s, d.stops[Math.min(i, d.stops.length - 1)]))
  while (stops.length < 2) stops.push(d.stops[stops.length].slice())
  return {
    stops,
    angle: num(r.angle, d.angle, -180, 180),
    scale: num(r.scale, d.scale, 0.1, 4),
    offset: num(r.offset, d.offset, 0, 1),
    speed: num(r.speed, d.speed, -2, 2),
    along: bool(r.along, d.along)
  }
}

export function sanitizeLook(raw: unknown): LightLook {
  const r = obj(raw), d = LOOK_DEFAULT
  return {
    source: oneOf(r.source, SOURCES, d.source),
    layer: Math.round(num(r.layer, 0, 0, 3)),
    sample: oneOf(r.sample, SAMPLES, d.sample),
    hue: num(r.hue, d.hue, 0, 360),
    sat: num(r.sat, d.sat, 0, 1),
    val: num(r.val, d.val, 0, 1),
    gradient: sanitizeGradient(r.gradient),
    effect: oneOf(r.effect, EFFECTS, d.effect),
    rate: num(r.rate, d.rate, 0, 4),
    depth: num(r.depth, d.depth, 0, 1),
    width: num(r.width, d.width, 0.02, 1),
    angle: num(r.angle, d.angle, -180, 180),
    level: num(r.level, d.level, 0, 1),
    order: oneOf(r.order, ORDERS, d.order),
    wings: Math.round(num(r.wings, d.wings, 1, 4)),
    fan: num(r.fan, d.fan, -180, 180),
    band: oneOf(r.band, BANDS, d.band),
    rule: Math.round(num(r.rule, d.rule, 0, 255))
  }
}

export function sanitizeMaster(raw: unknown): LightsMaster {
  const r = obj(raw), d = MASTER_DEFAULT
  return {
    brightness: num(r.brightness, d.brightness, 0, 1),
    speed: num(r.speed, d.speed, 0, 4),
    blackSec: num(r.blackSec, d.blackSec, 0, 20),
    fadeSec: num(r.fadeSec, d.fadeSec, 0, 20)
  }
}

const mapOf = <T,>(raw: unknown, f: (v: unknown) => T, max = 256): Record<string, T> => {
  const out: Record<string, T> = {}
  let n = 0
  for (const [k, v] of Object.entries(obj(raw))) {
    if (n++ >= max) break
    out[k.slice(0, 40)] = f(v)
  }
  return out
}

export function sanitizeLightsSession(raw: unknown): LightsSession {
  const r = obj(raw)
  const scenes = (Array.isArray(r.scenes) ? r.scenes : []).slice(0, 128).map((s, i) => {
    const o = obj(s)
    const m = obj(o.master)
    return {
      id: str(o.id, `ls${i}`, 40) || `ls${i}`,
      name: str(o.name, `Light ${i + 1}`, 40),
      looks: mapOf(o.looks, sanitizeLook),
      ...(o.master ? { master: { brightness: num(m.brightness, 1, 0, 1), speed: num(m.speed, 1, 0, 4) } } : {}),
      ...(o.groups ? { groups: mapOf(o.groups, (v) => num(v, 1, 0, 1), 64) } : {}),
      ...(typeof o.fade === 'number' ? { fade: num(o.fade, 1.5, 0, 60) } : {}),
      ...(typeof o.follow === 'number' ? { follow: num(o.follow, 0, 0, 3600) } : {}),
      ...(typeof o.link === 'string' && o.link ? { link: str(o.link, '', 80) } : {}),
      ...(o.tunes ? { tunes: mapOf(o.tunes, sanitizeTune) } : {})
    }
  })
  // (ids unique : two cues with one id could never be told apart)
  const seenIds = new Set<string>()
  for (const sc of scenes) { while (seenIds.has(sc.id)) sc.id += 'x'; seenIds.add(sc.id) }
  return {
    looks: mapOf(r.looks, sanitizeLook),
    scenes,
    master: sanitizeMaster(r.master),
    ...(r.groups ? { groups: mapOf(r.groups, (v) => num(v, 1, 0, 1), 64) } : {}),
    ...(r.tunes ? { tunes: mapOf(r.tunes, sanitizeTune) } : {})
  }
}

/** The DMX channels a fixture takes (its pixels times its layout). */
export function fixtureChannels(f: LightFixture): number {
  const n = fixturePixels(f)
  return layoutChannels(layoutTokens(f.head, false)) + n * layoutChannels(layoutTokens(f.layout)) + layoutChannels(layoutTokens(f.tail, false))
}

/** What each token does, for the patch readout. */
export function tokenLabel(t: string): string {
  const fine = tokenWidth(t) === 2
  const base: Record<string, string> = {
    R: 'red', G: 'green', B: 'blue', W: 'white', A: 'amber', U: 'UV (off)', C: 'cyan', M: 'magenta', Y: 'yellow',
    L: 'intensity', D: 'dimmer', S: 'strobe (off)', X: 'unused'
  }
  if (/^\d/.test(t)) return `held at ${Number(t)}`
  const b = base[t[0]] ?? t
  return fine ? `${b} (16-bit)` : b
}

/** A profile applied to a fixture : its channels, and its kind and size when it has them. */
export function profilePatch(p: LightProfile): Partial<LightFixture> {
  return {
    profile: p.id,
    head: p.head,
    layout: p.layout,
    tail: p.tail,
    kind: p.kind,
    ...(p.pixels ? { pixels: p.pixels } : {}),
    ...(p.cols ? { cols: p.cols } : {}),
    ...(p.rows ? { rows: p.rows } : {})
  }
}

/** The LEDs (pixels) a fixture drives. */
export function fixturePixels(f: LightFixture): number {
  return f.kind === 'spot' ? 1 : f.kind === 'matrix' ? f.cols * f.rows : f.pixels
}

/** The universe a fixture's first channel goes out on : an Enttec has one, sACN
 *  counts from 1 (universe 0 does not exist there : it is sent as 1). */
export const firstUniverse = (kind: LightOutputKind, universe: number): number => (kind === 'enttec' ? 0 : kind === 'sacn' ? Math.max(1, universe) : universe)

/** Where a fixture's channels land : its blocks (the head, each pixel, the tail)
 *  laid from its address, a block that would straddle a universe moved to the
 *  next one (an Enttec has one : what goes past 512 is cut). The same placement
 *  the engine's patch makes. */
export function fixtureSpans(f: LightFixture, enttec: boolean, sacn = false): Array<{ universe: number; from: number; to: number }> {
  const head = layoutChannels(layoutTokens(f.head, false))
  const pix = layoutChannels(layoutTokens(f.layout))
  const tail = layoutChannels(layoutTokens(f.tail, false))
  const blocks: number[] = []
  if (head) blocks.push(head)
  for (let i = fixturePixels(f); i > 0; i--) blocks.push(pix)
  if (tail) blocks.push(tail)
  const out: Array<{ universe: number; from: number; to: number }> = []
  let uni = firstUniverse(enttec ? 'enttec' : sacn ? 'sacn' : 'artnet', f.universe)
  let ch = f.address - 1
  let cur: { universe: number; from: number; to: number } | null = null
  for (const w of blocks) {
    if (ch + w > 512) {
      if (enttec) break
      uni++; ch = 0; cur = null
    }
    if (!cur) { cur = { universe: uni, from: ch + 1, to: ch }; out.push(cur) }
    ch += w
    cur.to = ch
  }
  return out
}

/** The DIP switches that set an address (switches 1 to 9 : 1, 2, 4... 256). */
export const dipOf = (address: number): boolean[] => Array.from({ length: 9 }, (_, i) => ((address >> i) & 1) === 1)
