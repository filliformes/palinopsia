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

export type LightKind = 'strip' | 'spot' | 'matrix'
export type LightSourceKind = 'master' | 'layer' | 'color' | 'gradient' | 'off'
export type LightEffect = 'none' | 'chase' | 'wave' | 'pulse' | 'sparkle' | 'audio' | 'beat'
export type LightOutputKind = 'enttec' | 'artnet' | 'sacn' | 'wled'
export type LightTuneScope = 'rig' | 'look'

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
  // On the picture (0..1, y down). strip : a line from (x0,y0) to (x1,y1), its
  // pixels spread along it; spot : a disc at (x0,y0); matrix : a rectangle.
  x0: number
  y0: number
  x1: number
  y1: number
  size: number // the sampled footprint around each pixel (0..0.3 of the frame height)
  pixels: number // strip : its LEDs (1..2048); spot : 1
  cols: number // matrix
  rows: number
  serpentine: boolean // matrix : wired back and forth
  reverse: boolean // strip / matrix : the first LED at the other end
  layout: string // channels per pixel : RGB, GRB, RGBW, DRGB... (R G B W A U D S X or a number 0..255)
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
  tunes?: Record<string, LightTune> // when the tuning travels with the look
}

export interface LightRig {
  fixtures: LightFixture[]
  outputs: LightOutput[]
  tuneScope: LightTuneScope
  fps: number // 10..44 : DMX frames a second
  on: boolean // the lights send at all
}

/** The session's part. */
export interface LightsSession {
  looks: Record<string, LightLook>
  scenes: LightScene[]
  master: LightsMaster
  tunes?: Record<string, LightTune>
}

// ── defaults ────────────────────────────────────────────────────────────────

export const TUNE_DEFAULT: LightTune = { brightness: 1, contrast: 1, gamma: 2, saturation: 1, hue: 0, warmth: 0, black: 0, smooth: 0.08 }

export const GRADIENT_DEFAULT: LightGradient = {
  stops: [[0.9, 0.25, 0.1], [1, 0.62, 0.25], [0.35, 0.2, 0.8]],
  angle: 0, scale: 1, offset: 0, speed: 0.05, along: false
}

export const LOOK_DEFAULT: LightLook = {
  source: 'master', layer: 0, hue: 30, sat: 0.6, val: 1, gradient: GRADIENT_DEFAULT,
  effect: 'none', rate: 0.5, depth: 0.6, width: 0.25, angle: 0, level: 1
}

export const MASTER_DEFAULT: LightsMaster = { brightness: 1, speed: 1, blackSec: 2, fadeSec: 1.5 }

export const RIG_DEFAULT: LightRig = { fixtures: [], outputs: [], tuneScope: 'rig', fps: 40, on: true }

export const SESSION_DEFAULT: LightsSession = { looks: {}, scenes: [], master: MASTER_DEFAULT }

/** Channel layouts offered in the menu (any other string of tokens works too). */
export const LAYOUTS = ['RGB', 'GRB', 'BRG', 'BGR', 'RGBW', 'GRBW', 'DRGB', 'RGBD', 'DRGBW', 'DRGBS', 'RGBWAU', 'W'] as const

/** The sliders a modulator or a Macro knob can move (ranges = the sliders'). A
 *  target on the masters carries fixture ''. */
export type LightModField =
  | 'level' | 'hue' | 'sat' | 'val' | 'gradOffset' | 'gradAngle' | 'gradScale'
  | 'rate' | 'depth' | 'width' | 'angle'
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

export const KINDS: readonly LightKind[] = ['strip', 'spot', 'matrix']
export const SOURCES: readonly LightSourceKind[] = ['master', 'layer', 'color', 'gradient', 'off']
export const EFFECTS: readonly LightEffect[] = ['none', 'chase', 'wave', 'pulse', 'sparkle', 'audio', 'beat']
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

/** A layout's tokens (letters, or numbers for a fixed channel value). Empty or
 *  unreadable : RGB. */
export function layoutTokens(layout: string): string[] {
  const t = (layout || '').toUpperCase().match(/[RGBWAUDSX]|\d{1,3}/g) ?? []
  return t.length ? t.slice(0, 16) : ['R', 'G', 'B']
}

export function sanitizeFixture(raw: unknown, i = 0): LightFixture {
  const r = obj(raw)
  const kind = oneOf(r.kind, KINDS, 'strip')
  return {
    id: str(r.id, `fx${Date.now().toString(36)}${i}`, 40) || `fx${i}`,
    name: str(r.name, kind === 'spot' ? 'Spot' : kind === 'matrix' ? 'Matrix' : 'LED bar', 40),
    kind,
    x0: num(r.x0, 0.2, -0.5, 1.5),
    y0: num(r.y0, 0.5, -0.5, 1.5),
    x1: num(r.x1, 0.8, -0.5, 1.5),
    y1: num(r.y1, 0.5, -0.5, 1.5),
    size: num(r.size, 0.03, 0, 0.3),
    pixels: kind === 'spot' ? 1 : Math.round(num(r.pixels, 30, 1, 2048)),
    cols: Math.round(num(r.cols, 8, 1, 128)),
    rows: Math.round(num(r.rows, 4, 1, 128)),
    serpentine: bool(r.serpentine, false),
    reverse: bool(r.reverse, false),
    layout: str(r.layout, 'RGB', 48) || 'RGB',
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
    index: Math.round(num(r.index, 0, 0, 7))
  }
}

export function sanitizeRig(raw: unknown): LightRig {
  const r = obj(raw)
  const fixtures = (Array.isArray(r.fixtures) ? r.fixtures : []).slice(0, 256).map(sanitizeFixture)
  const outputs = (Array.isArray(r.outputs) ? r.outputs : []).slice(0, 32).map(sanitizeOutput)
  // (ids unique : a hand-edited file with two of one would patch both as one)
  const seen = new Set<string>()
  for (const f of fixtures) { while (seen.has(f.id)) f.id += 'x'; seen.add(f.id) }
  return {
    fixtures,
    outputs,
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
    hue: num(r.hue, d.hue, 0, 360),
    sat: num(r.sat, d.sat, 0, 1),
    val: num(r.val, d.val, 0, 1),
    gradient: sanitizeGradient(r.gradient),
    effect: oneOf(r.effect, EFFECTS, d.effect),
    rate: num(r.rate, d.rate, 0, 4),
    depth: num(r.depth, d.depth, 0, 1),
    width: num(r.width, d.width, 0.02, 1),
    angle: num(r.angle, d.angle, -180, 180),
    level: num(r.level, d.level, 0, 1)
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
      ...(o.tunes ? { tunes: mapOf(o.tunes, sanitizeTune) } : {})
    }
  })
  return {
    looks: mapOf(r.looks, sanitizeLook),
    scenes,
    master: sanitizeMaster(r.master),
    ...(r.tunes ? { tunes: mapOf(r.tunes, sanitizeTune) } : {})
  }
}

/** The DMX channels a fixture takes (its pixels times its layout). */
export function fixtureChannels(f: LightFixture): number {
  const n = f.kind === 'spot' ? 1 : f.kind === 'matrix' ? f.cols * f.rows : f.pixels
  return n * layoutTokens(f.layout).length
}

/** The LEDs (pixels) a fixture drives. */
export function fixturePixels(f: LightFixture): number {
  return f.kind === 'spot' ? 1 : f.kind === 'matrix' ? f.cols * f.rows : f.pixels
}
