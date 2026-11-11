// The machinery of the Lights' "digital" effects : a one-dimensional cellular
// automaton and its history (a time-space diagram laid across the room), the Game
// of Life on a grid over the room, a smooth noise field, and the per-fixture
// state the color effects keep (a held sample, a trace, a delay line, bits,
// glitch events, firefly phases). Pure CPU, no store, no DOM : the engine
// (lightEngine.ts) drives them, the Node tests run them as they are.

import type { LightEffect } from '@shared/lights'

/** The effects that keep a state per fixture (the rest are stateless). */
export const STATEFUL: ReadonlySet<LightEffect> = new Set<LightEffect>(['fireflies', 'hold', 'afterimage', 'echo', 'bits', 'glitch'])

/** An echo's delay line : a row every tenth of a second, eight seconds back. */
export const ECHO_SLOTS = 81
export const ECHO_STEP = 0.1

export interface FxState {
  kind: LightEffect
  /** fireflies : each pixel's phase · hold, afterimage : a color per pixel · bits : when each channel last flipped (s). */
  a: Float32Array
  /** fireflies : each pixel's own tempo (-1..1) · bits : each channel's state (0 / 1). */
  b: Float32Array
  /** hold, afterimage : filled once. */
  ok: boolean
  /** echo : ECHO_SLOTS rows of n colors, the newest at `head`. */
  hist: Float32Array | null
  head: number
  acc: number
  filled: number
  /** glitch : the blocks broken now. */
  events: Array<{ from: number; to: number; until: number; mode: number; shift: number; color: number }>
  /** light by light : this frame's one draw for the whole light (hold). */
  draw: boolean
}

export function makeFx(kind: LightEffect, n: number, rnd: () => number = Math.random): FxState {
  const none = new Float32Array(0)
  const s: FxState = { kind, a: none, b: none, ok: false, hist: null, head: 0, acc: 0, filled: 0, events: [], draw: false }
  if (kind === 'fireflies') {
    s.a = new Float32Array(n)
    s.b = new Float32Array(n)
    for (let i = 0; i < n; i++) { s.a[i] = rnd(); s.b[i] = rnd() * 2 - 1 }
  } else if (kind === 'hold' || kind === 'afterimage') {
    s.a = new Float32Array(n * 3)
  } else if (kind === 'bits') {
    s.a = new Float32Array(n * 3)
    s.b = new Float32Array(n * 3)
  } else if (kind === 'echo') {
    s.hist = new Float32Array(ECHO_SLOTS * n * 3)
  }
  return s
}

// ── a smooth noise field ────────────────────────────────────────────────────
function h3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1)) | 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Value noise, 0..1, smooth in x, y and z. */
export function valueNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const fx = x - xi, fy = y - yi, fz = z - zi
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz)
  return lerp(
    lerp(lerp(h3(xi, yi, zi), h3(xi + 1, yi, zi), sx), lerp(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), sx), sy),
    lerp(lerp(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), sx), lerp(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), sx), sy),
    sz
  )
}

/** Clouds : two octaves, pushed toward light and dark (0..1). */
export function cloud(x: number, y: number, z: number): number {
  const v = valueNoise3(x, y, z) * 0.68 + valueNoise3(x * 2.1 + 17, y * 2.1 - 5, z * 1.7 + 3) * 0.32
  const t = Math.max(0, Math.min(1, (v - 0.3) / 0.4))
  return t * t * (3 - 2 * t)
}

// ── a one-dimensional cellular automaton, with its past ─────────────────────
/** The rules that grow their figure from one cell (the others from a scatter). */
const FROM_ONE = new Set([18, 22, 26, 30, 45, 60, 90, 102, 126, 150])
/** The rules offered : what each one does, in a word. */
export const RULES: Array<{ rule: number; name: string }> = [
  { rule: 30, name: '30 · chaos' },
  { rule: 90, name: '90 · triangles' },
  { rule: 110, name: '110 · gliders' },
  { rule: 150, name: '150 · lace' },
  { rule: 184, name: '184 · traffic' },
  { rule: 22, name: '22 · crystals' },
  { rule: 73, name: '73 · walls' },
  { rule: 45, name: '45 · static' }
]

export class Automaton {
  private rows: Uint8Array[]
  private head = 0
  private still = 0
  gen = 0

  constructor(readonly rule: number, readonly cells: number, readonly hist = 40, private rnd: () => number = Math.random) {
    this.rows = Array.from({ length: hist }, () => new Uint8Array(cells))
    this.seed(this.rows[0])
  }

  private seed(row: Uint8Array): void {
    row.fill(0)
    if (FROM_ONE.has(this.rule)) row[Math.floor(this.cells / 2)] = 1
    else for (let i = 0; i < this.cells; i++) row[i] = this.rnd() < 0.4 ? 1 : 0
    if (!row.some((v) => v)) row[0] = 1
  }

  /** The next generation. A row that settles (nothing moves, all dead, all alive)
   *  starts over after three steps of rest. */
  step(): void {
    const cur = this.rows[this.head]
    const nh = (this.head + 1) % this.hist
    const next = this.rows[nh]
    const n = this.cells
    if (this.still >= 3) {
      this.still = 0
      this.seed(next)
    } else {
      let alive = 0, same = true
      for (let i = 0; i < n; i++) {
        const k = (cur[(i + n - 1) % n] << 2) | (cur[i] << 1) | cur[(i + 1) % n]
        const v = (this.rule >> k) & 1
        next[i] = v
        alive += v
        if (v !== cur[i]) same = false
      }
      this.still = same || alive === 0 || alive === n ? this.still + 1 : 0
    }
    this.head = nh
    this.gen++
  }

  /** A cell, `age` generations back (0 : now). */
  at(cell: number, age: number): number {
    const n = this.cells
    const a = Math.max(0, Math.min(this.hist - 1, age | 0))
    return this.rows[(this.head - a + this.hist) % this.hist][((cell % n) + n) % n]
  }

  /** The row now, as 0 / 1 (tests). */
  row(): number[] {
    return Array.from(this.rows[this.head])
  }
}

// ── the Game of Life, over the room ─────────────────────────────────────────
export class Life {
  cells: Uint8Array
  private next: Uint8Array
  /** Each cell's light : 1 while alive, fading once dead (a trail). */
  heat: Float32Array
  private seen: number[] = []
  gen = 0

  constructor(readonly w: number, readonly h: number, private rnd: () => number = Math.random) {
    this.cells = new Uint8Array(w * h)
    this.next = new Uint8Array(w * h)
    this.heat = new Float32Array(w * h)
    this.sprinkle(0.32)
  }

  /** New cells over a part of the room (all of it the first time). */
  sprinkle(density: number, part = 1): void {
    const w = this.w, h = this.h
    const pw = Math.max(3, Math.round(w * part)), ph = Math.max(3, Math.round(h * part))
    const x0 = Math.floor(this.rnd() * w), y0 = Math.floor(this.rnd() * h)
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      if (this.rnd() < density) this.cells[((y0 + y) % h) * w + ((x0 + x) % w)] = 1
    }
  }

  step(): void {
    const w = this.w, h = this.h, c = this.cells, nx = this.next
    let pop = 0, hash = 2166136261
    for (let y = 0; y < h; y++) {
      const ym = ((y + h - 1) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w
      for (let x = 0; x < w; x++) {
        const xm = (x + w - 1) % w, xp = (x + 1) % w
        const k = c[ym + xm] + c[ym + x] + c[ym + xp] + c[y0 + xm] + c[y0 + xp] + c[yp + xm] + c[yp + x] + c[yp + xp]
        const v = k === 3 || (k === 2 && c[y0 + x]) ? 1 : 0
        nx[y0 + x] = v
        pop += v
        hash = Math.imul(hash ^ (v + 1 + ((y0 + x) & 255)), 16777619)
      }
    }
    this.cells = nx
    this.next = c
    this.gen++
    // settled (a state seen in the last eight : still lifes and blinkers only) or
    // nearly empty : new cells land somewhere, the rest lives on
    const settled = this.seen.includes(hash)
    this.seen.push(hash)
    if (this.seen.length > 8) this.seen.shift()
    if (settled || pop < w * h * 0.04) { this.sprinkle(0.38, 0.45); this.seen.length = 0 }
  }

  /** Once a frame : the living cells lit, the dead ones fading. */
  fade(dt: number): void {
    const k = Math.exp(-dt * 3.5)
    const c = this.cells, t = this.heat
    for (let i = 0; i < c.length; i++) t[i] = c[i] ? 1 : t[i] * k
  }

  /** The light at a place in the room (0..1, 0..1). */
  at(x: number, y: number): number {
    const cx = Math.max(0, Math.min(this.w - 1, Math.floor(x * this.w)))
    const cy = Math.max(0, Math.min(this.h - 1, Math.floor(y * this.h)))
    return this.heat[cy * this.w + cx]
  }

  population(): number {
    let n = 0
    for (let i = 0; i < this.cells.length; i++) n += this.cells[i]
    return n
  }
}

/** A place folded back into 0..1 (a mirror at each edge : no seam). */
export const mirror01 = (v: number): number => {
  const t = v - Math.floor(v / 2) * 2 // 0..2
  return t > 1 ? 2 - t : t
}

/** The six colors a glitch breaks in with. */
export const GLITCH_COLORS: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]]
