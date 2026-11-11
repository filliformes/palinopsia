// The Lights engine : one DMX frame from the rig (the room), the looks (the piece)
// and the picture. Pure CPU, run at the rig's fps (10..44 Hz) : for each fixture
// its pixels' places on the picture, their colors (the picture sampled there, a
// color, a gradient across the room), an effect over them, the fixture's level,
// its tuning (a grade for that physical light), a smoothing, then the masters and
// Black; the colors then land in their universes, in the fixture's channel layout.
//
// Sampled pictures come from the Compositor's light readback (Compositor.kickLights) :
// RGBA8 grids, BOTTOM-UP rows, one per source in use (the master, the layers).

import {
  GROUP_PREFIX,
  layoutChannels,
  layoutTokens,
  tokenWidth,
  LOOK_DEFAULT,
  type LightSample,
  type LightFixture,
  type LightLook,
  type LightModField,
  type LightOutput,
  type LightRig,
  type LightsMaster,
  type LightTune
} from '@shared/lights'
import { lightModKey, lightMods } from './lightMods'

export interface LightGrid {
  w: number
  h: number
  px: Uint8Array // RGBA8, bottom-up
}

export interface LightInputs {
  rig: LightRig
  looks: Record<string, LightLook>
  tunes: Record<string, LightTune> // the tuning in force for each fixture
  master: LightsMaster
  black: boolean // Black is on (the light fades out over master.blackSec)
  grids: { master: LightGrid | null; layers: Array<LightGrid | null> }
  nowMs: number
  beats: number // a running beat count (the shared clock)
  bpm: number
  audio: number // 0..1 : the sound's level
  aspect: number // the picture's width / height
  identify: string | null // a fixture flashed to find it in the room
  groupLevels?: Record<string, number> // each group's fader (absent : 1)
  /** The test pattern : seconds since it started (null : off). A line sweeps the
   *  room, red, then green, blue, white : every light shows where it is and
   *  whether its colors are in the right order. */
  test?: number | null
}

/** A frame's DMX : Enttec buffers by device index, network universes by output. */
export interface LightFrame {
  enttec: Map<number, Uint8Array>
  net: Array<{ kind: 'artnet' | 'sacn' | 'wled'; host: string; universe: number; data: Uint8Array; out: string }>
  /** Per fixture, its pixels' final colors (0..1 RGB, interleaved) : the page draws them. */
  colors: Map<string, Float32Array>
  /** Channels past an Enttec's 512 (unpatched), by fixture : the page warns. */
  overflow: Set<string>
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const fract = (v: number): number => v - Math.floor(v)

function hsv(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360 / 60
  const c = v * s
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const m = v - c
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x]
  return [r + m, g + m, b + m]
}

/** A matrix's cell (column, row from its top left) for each pixel, in channel
 *  order : from its start corner, row by row or column by column, zigzag or not. */
export function matrixCells(f: LightFixture): Int32Array {
  const n = f.cols * f.rows
  const out = new Int32Array(n * 2)
  const right = f.start === 'tr' || f.start === 'br', bottom = f.start === 'bl' || f.start === 'br'
  for (let k = 0; k < n; k++) {
    let c: number, r: number
    if (f.byCols) {
      c = Math.floor(k / f.rows); r = k % f.rows
      if (f.serpentine && c % 2 === 1) r = f.rows - 1 - r
    } else {
      r = Math.floor(k / f.cols); c = k % f.cols
      if (f.serpentine && r % 2 === 1) c = f.cols - 1 - c
    }
    if (right) c = f.cols - 1 - c
    if (bottom) r = f.rows - 1 - r
    out[k * 2] = c; out[k * 2 + 1] = r
  }
  if (f.reverse) {
    for (let i = 0, j = n - 1; i < j; i++, j--) {
      const c = out[i * 2], r = out[i * 2 + 1]
      out[i * 2] = out[j * 2]; out[i * 2 + 1] = out[j * 2 + 1]
      out[j * 2] = c; out[j * 2 + 1] = r
    }
  }
  return out
}

/** A strip's path : its ends and its bends, in order. */
export function stripPath(f: LightFixture): number[] {
  return [f.x0, f.y0, ...f.bends, f.x1, f.y1]
}

/** Each pixel's place on the picture (0..1, y down), in channel order. `aspect`
 *  (the picture's width / height) keeps a bent strip's LEDs evenly spaced and a
 *  ring round. */
export function fixturePoints(f: LightFixture, aspect = 16 / 9): Float32Array {
  if (f.kind === 'spot') return new Float32Array([f.x0, f.y0])
  const asp = Math.max(0.1, aspect)
  if (f.kind === 'matrix') {
    const n = f.cols * f.rows
    const cells = matrixCells(f)
    const out = new Float32Array(n * 2)
    for (let k = 0; k < n; k++) {
      out[k * 2] = f.x0 + ((cells[k * 2] + 0.5) / f.cols) * (f.x1 - f.x0)
      out[k * 2 + 1] = f.y0 + ((cells[k * 2 + 1] + 0.5) / f.rows) * (f.y1 - f.y0)
    }
    return out
  }
  const n = Math.max(1, f.pixels)
  const out = new Float32Array(n * 2)
  if (f.kind === 'ring') {
    // a circle in the room's own proportions : its radius and its first LED's angle
    const dx = (f.x1 - f.x0) * asp, dy = f.y1 - f.y0
    const r = Math.hypot(dx, dy)
    const a0 = Math.atan2(dy, dx)
    const dir = f.reverse ? -1 : 1
    for (let i = 0; i < n; i++) {
      const a = a0 + dir * (2 * Math.PI * i) / n
      out[i * 2] = f.x0 + (r * Math.cos(a)) / asp
      out[i * 2 + 1] = f.y0 + r * Math.sin(a)
    }
    return out
  }
  // a strip : evenly along its path (through its bends), by length in the room
  const p = stripPath(f)
  const segs = p.length / 2 - 1
  const len: number[] = []
  let total = 0
  for (let s = 0; s < segs; s++) {
    const l = Math.hypot((p[s * 2 + 2] - p[s * 2]) * asp, p[s * 2 + 3] - p[s * 2 + 1])
    len.push(l)
    total += l
  }
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1)
    let d = (f.reverse ? 1 - t : t) * total
    let s = 0
    while (s < segs - 1 && d > len[s]) { d -= len[s]; s++ }
    const u = len[s] > 1e-9 ? Math.min(1, d / len[s]) : 0
    out[i * 2] = p[s * 2] + u * (p[s * 2 + 2] - p[s * 2])
    out[i * 2 + 1] = p[s * 2 + 1] + u * (p[s * 2 + 3] - p[s * 2 + 1])
  }
  return out
}

/** Bilinear read of a bottom-up RGBA8 grid at (x, y) (y down), 0..1 RGB. */
function sampleAt(g: LightGrid, x: number, y: number, out: number[]): void {
  const fx = clamp01(x) * g.w - 0.5
  const fy = (1 - clamp01(y)) * g.h - 0.5
  const x0 = Math.max(0, Math.min(g.w - 1, Math.floor(fx)))
  const y0 = Math.max(0, Math.min(g.h - 1, Math.floor(fy)))
  const x1 = Math.min(g.w - 1, x0 + 1)
  const y1 = Math.min(g.h - 1, y0 + 1)
  const tx = clamp01(fx - x0), ty = clamp01(fy - y0)
  const p = g.px
  for (let c = 0; c < 3; c++) {
    const a = p[(y0 * g.w + x0) * 4 + c] * (1 - tx) + p[(y0 * g.w + x1) * 4 + c] * tx
    const b = p[(y1 * g.w + x0) * 4 + c] * (1 - tx) + p[(y1 * g.w + x1) * 4 + c] * tx
    out[c] = (a * (1 - ty) + b * ty) / 255
  }
}

/** The picture around a point (`size` : its footprint, in frame heights). The
 *  average : nine taps. Vivid and bright weigh 25 taps by how colorful (or how
 *  bright) each is, so a few strong colors are not drowned in their neighbors. */
const TMP = [0, 0, 0]
function sampleArea(g: LightGrid, x: number, y: number, size: number, aspect: number, out: number[], mode: LightSample = 'average'): void {
  if (size < 0.004) { sampleAt(g, x, y, out); return }
  let r = 0, gg = 0, b = 0, wsum = 0
  const k = mode === 'average' ? 1 : 2
  const dx = size / Math.max(0.1, aspect) / k, dy = size / k
  for (let j = -k; j <= k; j++) {
    for (let i = -k; i <= k; i++) {
      sampleAt(g, x + i * dx, y + j * dy, TMP)
      let w = 1
      if (mode === 'vivid') {
        const c = Math.max(TMP[0], TMP[1], TMP[2]) - Math.min(TMP[0], TMP[1], TMP[2])
        w = c * c * c + 1e-4
      } else if (mode === 'bright') {
        const l = 0.299 * TMP[0] + 0.587 * TMP[1] + 0.114 * TMP[2]
        w = l * l * l * l + 1e-5
      }
      r += TMP[0] * w; gg += TMP[1] * w; b += TMP[2] * w; wsum += w
    }
  }
  out[0] = r / wsum; out[1] = gg / wsum; out[2] = b / wsum
}

/** The picture's main colors (2 to `n`), for a gradient : hues weighed by how much
 *  of the picture has them and how colorful they are, a grey only when the picture
 *  has little color, ordered from left to right as they sit in the picture (a
 *  gradient across the room then follows it). Null : nothing lit to read. */
export function paletteOf(g: LightGrid | null, n = 4): number[][] | null {
  if (!g) return null
  const BINS = 12
  const acc = Array.from({ length: BINS + 1 }, () => ({ w: 0, r: 0, g: 0, b: 0, x: 0 }))
  const c = [0, 0, 0]
  // every cell of the grid (a click, not a frame : the small patches of color count)
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const o = (j * g.w + i) * 4
      c[0] = g.px[o] / 255; c[1] = g.px[o + 1] / 255; c[2] = g.px[o + 2] / 255
      const x = (i + 0.5) / g.w
      const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2])
      if (mx < 0.06) continue
      const ch = mx - mn
      // (a grey counts little : a light is its color)
      let bin = BINS, w = mx * 0.02
      if (ch > 0.1) {
        let h = 0
        if (mx === c[0]) h = ((c[1] - c[2]) / ch + 6) % 6
        else if (mx === c[1]) h = (c[2] - c[0]) / ch + 2
        else h = (c[0] - c[1]) / ch + 4
        bin = Math.min(BINS - 1, Math.floor((h / 6) * BINS))
        w = ch * ch * mx
      }
      const a = acc[bin]
      a.w += w; a.r += c[0] * w; a.g += c[1] * w; a.b += c[2] * w; a.x += x * w
    }
  }
  const top = acc.filter((a) => a.w > 0).sort((p, q) => q.w - p.w)
  if (!top.length) return null
  const keep = top.filter((a, i) => i === 0 || a.w >= top[0].w * 0.04).slice(0, Math.max(2, Math.min(5, n)))
  const stops = keep
    .map((a) => ({ x: a.x / a.w, c: [a.r / a.w, a.g / a.w, a.b / a.w] }))
    .sort((p, q) => p.x - q.x)
    .map((s) => {
      // each color at its full strength : the light is the color, the fader its level
      const m = Math.max(s.c[0], s.c[1], s.c[2], 1e-6)
      return s.c.map((v) => Math.min(1, v / m))
    })
  if (stops.length === 1) stops.push(stops[0].map((v) => v * 0.35))
  return stops
}

/** A gradient's color at t (ping-pong : no seam where it wraps). */
function gradientAt(stops: number[][], t: number, out: number[]): void {
  const u = 1 - Math.abs(2 * fract(t * 0.5) - 1) // 0..1..0 as t runs 0..2
  const n = stops.length - 1
  const f = u * n
  const i = Math.min(n - 1, Math.floor(f))
  const k = f - i
  const a = stops[i], b = stops[i + 1]
  out[0] = a[0] + (b[0] - a[0]) * k
  out[1] = a[1] + (b[1] - a[1]) * k
  out[2] = a[2] + (b[2] - a[2]) * k
}

// The effects stay under three changes a second at any rate and speed : the
// common guidance for flashing light (the same as the picture's Flash safety).
const MAX_HZ = 3

interface FixtureState {
  sig: string // its geometry : the points are rebuilt when it changes
  pts: Float32Array
  cur: Float32Array // the smoothed colors (before the masters)
  spark: Float32Array // sparkle per pixel
  from: Float32Array | null // a light scene's fade : where it came from
  beatIdx: number // the beat effect : the last flash's count, and its envelope
  beatEnv: number
}

export class LightEngine {
  private st = new Map<string, FixtureState>()
  private lastMs = 0
  private clock = 0 // seconds, times the master speed (a speed change never jumps)
  private blackLevel = 1 // 1 = lit, 0 = black
  private fadeT = 1 // a light scene's fade : 0..1
  private fadeSec = 0
  private audioSm = 0

  /** A light scene is coming in : fade from what shows now over `sec`. */
  beginFade(sec: number): void {
    this.fadeSec = Math.max(0, sec)
    this.fadeT = this.fadeSec > 0 ? 0 : 1
    for (const s of this.st.values()) s.from = s.cur.slice()
  }

  /** Back to lit at once (a panic, a new session). */
  resetBlack(lit: boolean): void {
    this.blackLevel = lit ? 1 : 0
  }

  get black01(): number {
    return this.blackLevel
  }

  private stateOf(f: LightFixture, aspect: number): FixtureState {
    const sig = `${f.kind}|${f.x0}|${f.y0}|${f.x1}|${f.y1}|${f.pixels}|${f.cols}|${f.rows}|${f.serpentine}|${f.reverse}|${f.bends.join(',')}|${f.start}|${f.byCols}|${aspect.toFixed(3)}`
    let s = this.st.get(f.id)
    if (!s || s.sig !== sig) {
      const pts = fixturePoints(f, aspect)
      const n = pts.length / 2
      s = { sig, pts, cur: new Float32Array(n * 3), spark: new Float32Array(n), from: null, beatIdx: -1, beatEnv: 0 }
      this.st.set(f.id, s)
    }
    return s
  }

  frame(inp: LightInputs): LightFrame {
    const dt = this.lastMs ? Math.max(0, Math.min(0.25, (inp.nowMs - this.lastMs) / 1000)) : 1 / 40
    this.lastMs = inp.nowMs
    const M = inp.master
    const mod = (fx: string, field: LightModField, base: number): number => {
      const v = lightMods.get(lightModKey(fx, field))
      return v === undefined ? base : v
    }
    const speed = mod('', 'masterSpeed', M.speed)
    const grand = mod('', 'masterBrightness', M.brightness)
    this.clock += dt * speed
    // Black : toward 0 over blackSec while on, back over the same time
    const bs = Math.max(0.001, M.blackSec)
    this.blackLevel = inp.black ? Math.max(0, this.blackLevel - dt / bs) : Math.min(1, this.blackLevel + dt / bs)
    if (this.fadeT < 1) this.fadeT = this.fadeSec > 0 ? Math.min(1, this.fadeT + dt / this.fadeSec) : 1
    // the sound, smoothed (a level that jumps every frame flickers the room)
    this.audioSm += (clamp01(inp.audio) - this.audioSm) * (1 - Math.exp(-dt / 0.06))
    // the beat : a flash on each, decaying
    const beatNow = inp.beats
    const out: LightFrame = { enttec: new Map(), net: [], colors: new Map(), overflow: new Set() }
    const outputs = new Map<string, LightOutput>(inp.rig.outputs.map((o) => [o.id, o]))
    const universes = new Map<string, Uint8Array>() // `${outId}|${universe}`
    const live = new Set<string>()
    const tmp = [0, 0, 0]
    const ease = (x: number): number => x * x * (3 - 2 * x)

    // the test pattern : a line sweeping the room, one color a pass
    const test = inp.test ?? null
    const TEST_SPEED = 0.35 // passes a second
    const tPass = test !== null ? Math.floor(test * TEST_SPEED) : 0
    const tHead = test !== null ? fract(test * TEST_SPEED) * 1.3 - 0.15 : 0
    const tCol = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]][tPass % 4]
    for (const f of inp.rig.fixtures) {
      live.add(f.id)
      const s = this.stateOf(f, Math.max(0.1, inp.aspect))
      const look = inp.looks[f.id] ?? LOOK_DEFAULT
      const tune = inp.tunes[f.id] ?? f.tune
      const n = s.pts.length / 2
      // its own fader, times the faders of the groups it is in
      let level = mod(f.id, 'level', look.level)
      for (const g of inp.rig.groups) if (g.members.includes(f.id)) level *= clamp01(mod(GROUP_PREFIX + g.id, 'level', inp.groupLevels?.[g.id] ?? 1))
      const hue = mod(f.id, 'hue', look.hue), sat = mod(f.id, 'sat', look.sat), val = mod(f.id, 'val', look.val)
      const g = look.gradient
      const gOff = mod(f.id, 'gradOffset', g.offset), gAng = mod(f.id, 'gradAngle', g.angle), gScale = mod(f.id, 'gradScale', g.scale)
      const rate = Math.min(MAX_HZ, mod(f.id, 'rate', look.rate) * Math.max(0, speed))
      const depth = clamp01(mod(f.id, 'depth', look.depth))
      const width = Math.max(0.02, mod(f.id, 'width', look.width))
      const eAng = (mod(f.id, 'angle', look.angle) * Math.PI) / 180
      const ca = Math.cos(eAng), sa = Math.sin(eAng)
      const gca = Math.cos((gAng * Math.PI) / 180), gsa = Math.sin((gAng * Math.PI) / 180)
      const tBright = mod(f.id, 'tuneBrightness', tune.brightness), tSat = mod(f.id, 'tuneSaturation', tune.saturation)
      const tHue = mod(f.id, 'tuneHue', tune.hue), tWarm = mod(f.id, 'tuneWarmth', tune.warmth)
      const grid = look.source === 'master' ? inp.grids.master : look.source === 'layer' ? inp.grids.layers[look.layer] ?? null : null
      const base = look.source === 'color' ? hsv(hue, sat, val) : null
      const smoothA = tune.smooth > 0.001 ? 1 - Math.exp(-dt / tune.smooth) : 1
      // hue rotation (YIQ) for the tuning
      const hr = (tHue * Math.PI) / 180, hc = Math.cos(hr), hs = Math.sin(hr)
      const asp = Math.max(0.1, inp.aspect)
      const pulse = look.effect === 'pulse' ? 1 - depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * this.clock * rate)) : 1
      // the beat : every 1/rate beats (rate 0 : every beat), the flash decaying in a quarter of it
      let beatMul = 1
      if (look.effect === 'beat') {
        // (never more than three flashes a second : at 180 BPM and over, every other beat)
        const minBeats = (MAX_HZ > 0 ? 1 / MAX_HZ : 1) * (Math.max(1, inp.bpm) / 60)
        const every = Math.max(minBeats, rate > 0 ? 1 / rate : 1) // beats between flashes
        const idx = Math.floor(beatNow / every)
        if (idx !== s.beatIdx) { s.beatIdx = idx; s.beatEnv = 1 }
        beatMul = 1 - depth + depth * s.beatEnv
        s.beatEnv *= Math.exp(-dt * 7)
      }
      const audioMul = look.effect === 'audio' ? 1 - depth + depth * this.audioSm : 1
      const colors = new Float32Array(n * 3)
      const ident = inp.identify === f.id
      for (let i = 0; i < n; i++) {
        const x = s.pts[i * 2], y = s.pts[i * 2 + 1]
        const px = x * asp // the room's own proportions for patterns across it
        let r = 0, gg = 0, b = 0
        if (ident) { r = gg = b = 1 } else if (test !== null) {
          const pos = (x * asp + y) / (asp + 1)
          const on = Math.abs(pos - tHead) < 0.045 ? 1 : 0
          r = tCol[0] * on; gg = tCol[1] * on; b = tCol[2] * on
        } else {
          if (grid) {
            sampleArea(grid, x, y, f.size, asp, tmp, look.sample)
            r = tmp[0]; gg = tmp[1]; b = tmp[2]
          } else if (base) {
            r = base[0]; gg = base[1]; b = base[2]
          } else if (look.source === 'gradient') {
            const t = g.along ? (n > 1 ? i / (n - 1) : 0.5) * gScale : (px * gca + y * gsa) * gScale
            gradientAt(g.stops, t + gOff + this.clock * g.speed, tmp)
            r = tmp[0]; gg = tmp[1]; b = tmp[2]
          }
          // the effect, a multiplier on the light
          let m = pulse * beatMul * audioMul
          if (look.effect === 'chase' || look.effect === 'wave') {
            const p = px * ca + y * sa
            if (look.effect === 'chase') {
              const d = fract(p - this.clock * rate) // 0..1 behind the head
              const band = Math.exp(-((Math.min(d, 1 - d) / width) ** 2) * 3)
              m *= 1 - depth + depth * band
            } else {
              m *= 1 - depth * (0.5 - 0.5 * Math.sin(2 * Math.PI * (p / width - this.clock * rate)))
            }
          } else if (look.effect === 'sparkle') {
            // twinkles : a pixel lights at random (rate : how often), then decays
            if (Math.random() < rate * dt * 0.5) s.spark[i] = 1
            s.spark[i] *= Math.exp(-dt * 6)
            m *= 1 - depth + depth * s.spark[i]
          }
          m *= level
          r *= m; gg *= m; b *= m
          // the tuning : saturation, hue, warmth, contrast, brightness, gamma, floor
          const l = 0.299 * r + 0.587 * gg + 0.114 * b
          r = l + (r - l) * tSat; gg = l + (gg - l) * tSat; b = l + (b - l) * tSat
          if (tHue !== 0) {
            const yy = l, ii = 0.596 * r - 0.274 * gg - 0.322 * b, qq = 0.211 * r - 0.523 * gg + 0.312 * b
            const i2 = ii * hc - qq * hs, q2 = ii * hs + qq * hc
            r = yy + 0.956 * i2 + 0.621 * q2
            gg = yy - 0.272 * i2 - 0.647 * q2
            b = yy - 1.106 * i2 + 1.703 * q2
          }
          r *= 1 + 0.3 * tWarm; b *= 1 - 0.3 * tWarm; gg *= 1 + 0.05 * tWarm
          r = (r - 0.5) * tune.contrast + 0.5; gg = (gg - 0.5) * tune.contrast + 0.5; b = (b - 0.5) * tune.contrast + 0.5
          r = clamp01(r * tBright) ** tune.gamma
          gg = clamp01(gg * tBright) ** tune.gamma
          b = clamp01(b * tBright) ** tune.gamma
          r = tune.black + (1 - tune.black) * r; gg = tune.black + (1 - tune.black) * gg; b = tune.black + (1 - tune.black) * b
        }
        // smoothing (identify and the test are never smoothed : they must answer at once)
        const k = ident || test !== null ? 1 : smoothA
        const o = i * 3
        s.cur[o] += (r - s.cur[o]) * k
        s.cur[o + 1] += (gg - s.cur[o + 1]) * k
        s.cur[o + 2] += (b - s.cur[o + 2]) * k
        let fr = s.cur[o], fg = s.cur[o + 1], fb = s.cur[o + 2]
        if (s.from && this.fadeT < 1 && s.from.length === s.cur.length) {
          const e = ease(this.fadeT)
          fr = s.from[o] + (fr - s.from[o]) * e
          fg = s.from[o + 1] + (fg - s.from[o + 1]) * e
          fb = s.from[o + 2] + (fb - s.from[o + 2]) * e
        }
        const gm = ident || test !== null ? 1 : grand * ease(this.blackLevel)
        colors[o] = fr * gm
        colors[o + 1] = fg * gm
        colors[o + 2] = fb * gm
      }
      out.colors.set(f.id, colors)
      // into its universes
      const o = outputs.get(f.out)
      if (!o || !o.enabled || !inp.rig.on) continue
      this.patch(f, o, colors, universes, out)
    }
    // fixtures gone from the rig : their state goes too
    for (const id of [...this.st.keys()]) if (!live.has(id)) this.st.delete(id)
    if (this.fadeT >= 1) for (const s of this.st.values()) s.from = null
    // collect
    for (const [key, data] of universes) {
      const sep = key.lastIndexOf('|')
      const o = outputs.get(key.slice(0, sep))
      if (!o) continue
      const uni = Number(key.slice(sep + 1))
      if (o.kind === 'enttec') out.enttec.set(o.index, data)
      else out.net.push({ kind: o.kind, host: o.host, universe: uni, data, out: o.id })
    }
    return out
  }

  /** One fixture's colors into its output's universes : its head (the channels
   *  sent once before the pixels), each pixel in its layout, its tail. A block
   *  never straddles two universes (pixel controllers expect it so) : one that
   *  would starts the next universe. An Enttec has one universe : what goes past
   *  its 512 channels is dropped (and reported).
   *  A dimmer (D) takes the level and the color goes out at full strength : the
   *  fades stay smooth down low (in 16 bits with D16) and a dim color stays its
   *  color. A dimmer in the head is the whole fixture's (its brightest pixel),
   *  and its pixels then go out relative to it. */
  private patch(f: LightFixture, o: LightOutput, colors: Float32Array, universes: Map<string, Uint8Array>, out: LightFrame): void {
    const tok = layoutTokens(f.layout)
    const head = layoutTokens(f.head, false)
    const tail = layoutTokens(f.tail, false)
    const pixD = tok.some((t) => t[0] === 'D')
    const fixD = !pixD && (head.some((t) => t[0] === 'D') || tail.some((t) => t[0] === 'D'))
    const n = colors.length / 3
    // the whole fixture : its brightest pixel (a head dimmer) and its mean color
    let fdim = 1, ar = 0, ag = 0, ab = 0
    if (head.length || tail.length) {
      let mx = 0
      for (let i = 0; i < n; i++) {
        const r = colors[i * 3], g = colors[i * 3 + 1], b = colors[i * 3 + 2]
        ar += r; ag += g; ab += b
        mx = Math.max(mx, r, g, b)
      }
      ar /= n; ag /= n; ab /= n
      if (fixD) fdim = mx
    }
    let uni = o.kind === 'enttec' ? 0 : f.universe
    let ch = f.address - 1
    const buf = (u: number): Uint8Array => {
      const key = `${o.id}|${u}`
      let b = universes.get(key)
      if (!b) { b = new Uint8Array(512); universes.set(key, b) }
      return b
    }
    let data = buf(uni)
    /** Room for `w` channels here, or the next universe (false : an Enttec full). */
    const room = (w: number): boolean => {
      if (ch + w <= 512) return true
      if (o.kind === 'enttec') { out.overflow.add(f.id); return false }
      uni++; ch = 0; data = buf(uni)
      return true
    }
    /** One block of tokens for a color (0..1, linear) : its dimmer, white,
     *  complements and luminance worked out from it. */
    const emit = (tokens: string[], r: number, g: number, b: number, normD: boolean): void => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      let dim = 1
      if (normD) {
        dim = Math.max(r, g, b)
        if (dim > 1e-6) { r /= dim; g /= dim; b /= dim } else { r = g = b = 0; dim = 0 }
      } else if (fixD) {
        dim = fdim
        if (fdim > 1e-6) { r /= fdim; g /= fdim; b /= fdim } else { r = g = b = 0 }
      }
      let w = 0
      if (tokens.some((t) => t[0] === 'W')) { w = Math.min(r, g, b); r -= w; g -= w; b -= w }
      for (const t of tokens) {
        let v: number
        switch (t[0]) {
          case 'R': v = r; break
          case 'G': v = g; break
          case 'B': v = b; break
          case 'W': v = w; break
          case 'A': v = Math.min(r, g * 2) * 0.8; break // amber : from the warm part
          case 'C': v = 1 - r; break // a subtractive mix : the color's complement
          case 'M': v = 1 - g; break
          case 'Y': v = 1 - b; break
          case 'L': v = lum; break // one channel of white : its luminance
          case 'D': v = dim; break
          case 'U': case 'S': case 'X': v = 0; break // UV, strobe, unused : off
          default: v = -1 // a fixed value
        }
        if (v < 0) {
          data[ch++] = Math.max(0, Math.min(255, Number(t) | 0))
        } else if (tokenWidth(t) === 2) {
          const q = Math.round(clamp01(v) * 65535)
          data[ch++] = q >> 8
          data[ch++] = q & 0xff
        } else {
          data[ch++] = Math.round(clamp01(v) * 255)
        }
      }
    }
    const hw = layoutChannels(head), pw = layoutChannels(tok), tw = layoutChannels(tail)
    if (hw) {
      if (!room(hw)) return
      emit(head, ar, ag, ab, false)
    }
    for (let i = 0; i < n; i++) {
      if (!room(pw)) return
      emit(tok, colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2], pixD)
    }
    if (tw) {
      if (!room(tw)) return
      emit(tail, ar, ag, ab, false)
    }
  }
}
