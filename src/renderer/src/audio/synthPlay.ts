// The Sonify Synth's PLAY side : the moving things in the picture are the
// players, the synth (synth.engine.js, in the worklet) is their instrument.
// Each moving thing takes a voice, its place picks the note (on Sonify's key
// and scale), and how it looks shapes that voice's sound through the picture
// patchbay (ten rows, a source and a depth each).
//
// Runs on the main thread beside Sonify's other analyses, on the same 96×96
// grids (sonify.ts tick, ~30 Hz) : the luma of this frame and the last one
// (what Flow and Events read) and the RGBA readback (Flow's colour read).
//
//   1. blocks : the grid in 24×24 blocks of 4 px : motion (the frame
//      difference, Flow's measure, held ~80 ms so a hand pausing for a frame
//      stays a thing), light, edges (the Sobel of Events), color.
//   2. things : blocks that move enough (hysteresis : a seed above `hi`, grown
//      through blocks above `lo` and blocks off the background, one-block gaps
//      bridged so a dancer's arm and body stay one thing) joined into connected
//      regions; a big region (a moving camera, a screen of footage) split into
//      its strongest cores (three at most), the two edges of a flat shape (its
//      inside never changes) joined back into one.
//   3. tracking : greedy nearest centroid against where each thing was going,
//      stable integer ids, a note only after two sightings in a row, and a
//      grace of 0.25 s before a thing that stopped (or left) ends its note.
//   4. notes : poly, the 8 strongest things play (a newcomer takes a voice
//      only when one is free, or when it is twice the weakest one that has
//      played 0.6 s : no constant stealing); mono and unison, the strongest
//      (another takes over after being 1.6 times stronger for 0.2 s).
//   5. pitch : height (low at the bottom), keyboard (low at the left), radial
//      (low at the centre; on the dome the zenith) or score (a playhead on the
//      beat clock reads the shapes it crosses, a piano roll). Steps re-strike
//      the same id at each new scale note (with 0.4 of a step of hysteresis and
//      60 ms at least between strikes : a thing on a boundary never trills);
//      Slide glides between the notes.
//   6. timing : free (a note when the movement is seen) or a grid on the beat
//      clock (1/8, 1/16, 1/8T) : onsets go to the worklet with their delay to
//      the next grid point, and it strikes them on the audio block.
//   7. the patchbay : each tick, each playing thing's mods (setMods).

import { SYNTH_PATCHES, type SynthEngineId, type SynthFilterId, type SynthPatch, type SynthSound } from './synthPatches'

export type SynthMode = 'height' | 'keyboard' | 'radial' | 'score'
export type SynthGrid = 'free' | '8' | '16' | '8t'
export const SYNTH_MODES: SynthMode[] = ['height', 'keyboard', 'radial', 'score']
export const SYNTH_GRIDS: SynthGrid[] = ['free', '8', '16', '8t']
export const SYNTH_ENGINES: SynthEngineId[] = ['dco', 'ms', 'swarm', 'fm', 'modal', 'voice', 'fold', 'pluck']
export const SYNTH_FILTERS: SynthFilterId[] = ['ladder', 'ms', 'morph']
/** What each engine's three macros do (TIMBRE · HARMONICS · MORPH). */
export const SYNTH_MACROS: Record<SynthEngineId, [string, string, string]> = {
  dco: ['wave', 'density→interval', 'sync→metal'],
  ms: ['wave', 'interval→ring', 'dirt'],
  swarm: ['shape', 'spread', 'pulse'],
  fm: ['bright', 'ratio', 'bite'],
  modal: ['strike', 'material', 'damping'],
  voice: ['vowel', 'throat', 'breath'],
  fold: ['fold', 'symmetry', 'gate'],
  pluck: ['bright', 'stiffness', 'damping']
}

// The patchbay's sources : ten per thing, then five of the whole picture.
export const SYNTH_SRCS = [
  'none', 'speed', 'size', 'brightness', 'hue', 'saturation', 'texture', 'x', 'y', 'direction', 'age',
  'motion', 'light', 'warmth', 'busyness', 'cut'
] as const
export type SynthSrc = (typeof SYNTH_SRCS)[number]
/** The per-thing sources, in the order of a track's feature array. */
const THING_SRCS: SynthSrc[] = ['speed', 'size', 'brightness', 'hue', 'saturation', 'texture', 'x', 'y', 'direction', 'age']
export const SYNTH_SRC_HINT: Record<SynthSrc, string> = {
  none: 'nothing : this row sends its middle (no change)',
  speed: 'how fast the thing moves (its motion and its travel)',
  size: 'how much of the picture it covers',
  brightness: 'how light it is',
  hue: 'its color : red and orange low, cyan high (a grey thing sits in the middle)',
  saturation: 'how vivid its color is',
  texture: 'smooth (low) or detailed (high) : the edges under it',
  x: 'where it is across : left low, right high',
  y: 'where it is in height : top low, bottom high',
  direction: 'falling (low), still (middle) or rising (high)',
  age: 'how long it has been playing : grows over 4 seconds',
  motion: 'the whole picture : how much of it moves',
  light: 'the whole picture : how light it is',
  warmth: 'the whole picture : cool (low) or warm (high) colors',
  busyness: 'the whole picture : how many edges it holds',
  cut: 'the whole picture : a scene change, fading over a second'
}
// The patchbay's fixed destinations (setMods' fields; vel = the strike's
// velocity AND the held expression).
export const SYNTH_DESTS = ['vel', 'timbre', 'harmonics', 'morph', 'cutoff', 'reso', 'drive', 'env', 'pan', 'bend'] as const
export type SynthDest = (typeof SYNTH_DESTS)[number]
export const SYNTH_DEST_LABEL: Record<SynthDest, string> = {
  vel: 'velocity', timbre: 'timbre', harmonics: 'harmonics', morph: 'morph', cutoff: 'cutoff',
  reso: 'resonance', drive: 'drive', env: 'envelope', pan: 'pan', bend: 'bend'
}
/** Each row's depth as a modulation target (sonify param), in row order. */
export const SYNTH_DEPTH_PARAMS = [
  'synthDVel', 'synthDTimbre', 'synthDHarm', 'synthDMorph', 'synthDCutoff',
  'synthDReso', 'synthDDrive', 'synthDEnv', 'synthDPan', 'synthDBend'
] as const

/** The Synth's modulatable params by name (the M chips, MIDI learn). */
export const SYNTH_PARAM_LABEL: Record<string, string> = {
  synthTimbre: 'Synth timbre', synthHarmonics: 'Synth harmonics', synthMorph: 'Synth morph',
  synthCutoff: 'Synth cutoff', synthReso: 'Synth resonance', synthDrive: 'Synth drive',
  synthEnvAmt: 'Synth envelope amount', synthGlide: 'Synth glide', synthDrift: 'Synth drift',
  synthLevel: 'Synth level', synthGain: 'Synth gain', synthPicture: 'Synth picture amount', synthSens: 'Synth sense'
}
SYNTH_DESTS.forEach((d, i) => { SYNTH_PARAM_LABEL[SYNTH_DEPTH_PARAMS[i]] = `Synth picture → ${SYNTH_DEST_LABEL[d]} depth` })

export interface SynthRow { src: SynthSrc; depth: number }

export interface SynthCfg extends SynthSound {
  on: boolean
  tap: number
  gain: number // into its mixer channel (as every voice)
  pan: number // the voice's balance, -1..1 (each thing pans itself through the patchbay)
  mode: SynthMode
  loOct: number
  hiOct: number
  sens: number // how much movement counts as a thing (0..1)
  grid: SynthGrid
  slide: boolean // false : Steps (re-strike at each scale note) · true : Slide
  bars: 1 | 2 | 4 // the score playhead's length
  picture: number // scales every patchbay depth (0 = the picture only picks the notes)
  patch: SynthRow[] // 10 rows, in SYNTH_DESTS order
  // The factory sound last picked (its name), so the Sound menu can show it :
  // ABSENT until one is picked (a session that never picked one saves the same
  // bytes as before the field existed). Edits after the pick leave it : the
  // menu then reads "<name> · edited" (synthPatchState).
  preset?: string
}

export function defaultSynthPatch(): SynthRow[] {
  return [
    { src: 'speed', depth: 0.8 },
    { src: 'hue', depth: 0.5 },
    { src: 'size', depth: 0.5 },
    { src: 'texture', depth: 0.4 },
    { src: 'brightness', depth: 0.6 },
    { src: 'saturation', depth: 0.3 },
    { src: 'motion', depth: 0.3 },
    // quick flicks pluck, slow drifts swell into pads
    { src: 'speed', depth: -0.7 },
    { src: 'x', depth: 0.8 },
    // no bend : a bend holds the note off its scale note for as long as the
    // thing moves (direction at 0.2 played a rising thing up to 31 cents sharp,
    // a falling one as flat, each voice its own way : heard as out of tune)
    { src: 'none', depth: 0 }
  ]
}

export function defaultSynth(): SynthCfg {
  return {
    on: false, tap: 0, gain: 0.7, pan: 0,
    engine: 'dco', timbre: 0.5, harmonics: 0.3, morph: 0, voices: 'poly',
    filter: 'ladder', cutoff: 0.6, reso: 0.25, drive: 0.15, hpf: 0, fmode: 0, envAmt: 0.3,
    attack: 0.05, decay: 0.35, sustain: 0.6, release: 0.35,
    glide: 0.1, drift: 0.2, chorus: 1, level: 0.7,
    mode: 'height', loOct: 3, hiOct: 5, sens: 0.5, grid: 'free', slide: false, bars: 2,
    picture: 0.8,
    patch: defaultSynthPatch()
  }
}

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0)
const clampN = (v: number, lo: number, hi: number): number => (v >= lo ? (v <= hi ? v : hi) : lo)
const num = (v: unknown, d: number, lo: number, hi: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? clampN(n, lo, hi) : d
}
const oneOf = <T,>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)

/** A whole, valid Synth config from anything saved (a session, a scene, a
 *  preset, OSC) : every field there, in range, the patchbay ten rows. */
// the patchbay's bend row (SYNTH_DESTS order : vel timbre harmonics morph cutoff reso drive env pan bend)
const BEND_ROW = 9

export function normalizeSynth(raw: unknown): SynthCfg {
  const d = defaultSynth()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SynthCfg>
  const rows = Array.isArray(r.patch) ? r.patch : []
  const lo = Math.round(num(r.loOct, d.loOct, 0, 7))
  return {
    on: typeof r.on === 'boolean' ? r.on : d.on,
    tap: r.tap === 1 ? 1 : 0,
    gain: num(r.gain, d.gain, 0, 1),
    pan: num(r.pan, d.pan, -1, 1),
    engine: oneOf(r.engine, SYNTH_ENGINES, d.engine),
    timbre: num(r.timbre, d.timbre, 0, 1),
    harmonics: num(r.harmonics, d.harmonics, 0, 1),
    morph: num(r.morph, d.morph, 0, 1),
    voices: oneOf(r.voices, ['poly', 'unison', 'mono'] as const, d.voices),
    filter: oneOf(r.filter, SYNTH_FILTERS, d.filter),
    cutoff: num(r.cutoff, d.cutoff, 0, 1),
    reso: num(r.reso, d.reso, 0, 1),
    drive: num(r.drive, d.drive, 0, 1),
    hpf: num(r.hpf, d.hpf, 0, 1),
    fmode: num(r.fmode, d.fmode, 0, 1),
    envAmt: num(r.envAmt, d.envAmt, -1, 1),
    attack: num(r.attack, d.attack, 0, 1),
    decay: num(r.decay, d.decay, 0, 1),
    sustain: num(r.sustain, d.sustain, 0, 1),
    release: num(r.release, d.release, 0, 1),
    glide: num(r.glide, d.glide, 0, 1),
    drift: num(r.drift, d.drift, 0, 1),
    chorus: r.chorus === 0 || r.chorus === 2 ? r.chorus : r.chorus === 1 ? 1 : d.chorus,
    level: num(r.level, d.level, 0, 1),
    mode: oneOf(r.mode, SYNTH_MODES, d.mode),
    loOct: lo,
    hiOct: Math.max(lo + 1, Math.round(num(r.hiOct, d.hiOct, 1, 8))),
    sens: num(r.sens, d.sens, 0, 1),
    grid: oneOf(r.grid, SYNTH_GRIDS, d.grid),
    slide: typeof r.slide === 'boolean' ? r.slide : d.slide,
    bars: r.bars === 1 || r.bars === 4 ? r.bars : 2,
    picture: num(r.picture, d.picture, 0, 1),
    patch: d.patch.map((dr, i) => {
      const x = rows[i] as Partial<SynthRow> | undefined
      // the bend row at the old default (direction, 0.2 : out of tune whenever a
      // thing moved) is the new one, none; any other bend stays as it was chosen
      if (i === BEND_ROW && x?.src === 'direction' && x?.depth === 0.2) return { src: 'none', depth: 0 }
      return { src: oneOf(x?.src, SYNTH_SRCS, dr.src), depth: num(x?.depth, dr.depth, -1, 1) }
    }),
    // (only a factory sound that exists : a renamed one reads as none)
    ...(typeof r.preset === 'string' && SYNTH_PATCHES.some((p) => p.name === r.preset) ? { preset: r.preset } : {})
  }
}

/** A factory sound as a Synth patch : its whole sound and its name (the menu
 *  shows it). The read, the patchbay and the voice's gain / pan stay. */
export function synthFromPatch(p: SynthPatch): Partial<SynthCfg> {
  return { ...p.sound, preset: p.name }
}

/** The factory sound the Sound menu shows : the one last picked, its place in
 *  SYNTH_PATCHES, and whether any of its sound fields changed since (a slider,
 *  the engine, a dice, OSC, MIDI : picking it again brings it back). */
export function synthPatchState(c: SynthCfg): { patch: SynthPatch; index: number; edited: boolean } | null {
  if (!c.preset) return null
  const index = SYNTH_PATCHES.findIndex((p) => p.name === c.preset)
  if (index < 0) return null
  const patch = SYNTH_PATCHES[index]
  const now = synthSound(c) as unknown as Record<string, unknown>
  const want = patch.sound as unknown as Record<string, unknown>
  const edited = Object.keys(want).some((k) => {
    const a = now[k], b = want[k]
    return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 1e-6 : a !== b
  })
  return { patch, index, edited }
}

/** The engine's static sound (setConfig), from a Synth config. */
export function synthSound(c: SynthCfg): SynthSound {
  return {
    engine: c.engine, timbre: c.timbre, harmonics: c.harmonics, morph: c.morph, voices: c.voices,
    filter: c.filter, cutoff: c.cutoff, reso: c.reso, drive: c.drive, hpf: c.hpf, fmode: c.fmode,
    envAmt: c.envAmt, attack: c.attack, decay: c.decay, sustain: c.sustain, release: c.release,
    glide: c.glide, drift: c.drift, chorus: c.chorus, level: c.level
  }
}

/** One playing thing's patchbay result (the contract's setMods). */
export interface SynthMods {
  vel: number; timbre: number; harmonics: number; morph: number; cutoff: number
  reso: number; drive: number; env: number; pan: number; bend: number
}
/** A note event for the worklet : k 0 noteOn · 1 noteOff · 2 setPitch; `at`
 *  the delay in seconds (a grid onset; `when` its audio time, set by sonify.ts),
 *  `m` the mods to set around a strike. */
export interface SynthEv { k: 0 | 1 | 2; id: number; hz: number; vel: number; at: number; m?: SynthMods; when?: number }

export interface SynthIn {
  cur: Uint8Array
  prev: Uint8Array
  rgba: Uint8Array // the readback, bottom-up
  fresh: boolean // no real previous frame (a tap that just started)
  dt: number // s since the last tick
  nowMs: number
  cfg: SynthCfg
  table: Float32Array // the scale's notes over loOct..hiOct, Hz, rising
  aspect: number // the composition's width / height
  radial: (x: number, y: number) => number // 0 centre .. 1 edge (the dome's : zenith .. rim)
  beats: number // the Sonify beat clock now
  bpm: number
  bar: number // beats in a bar
  mod: (param: string) => number | undefined // a modulated value, if any
}

const GRID = 96
const B = 4 // block size, grid px
const NB = GRID / B // 24
const NBB = NB * NB // 576
const MAX_BLOBS = 48
const BIG = 40 // blocks : a region this big is looked into for its cores (7 % of the frame)
/** The motion a block must reach to seed a thing (mean |difference| a pixel,
 *  0..255) : sense 0 = 28, 0.5 = 16, 1 = 4. */
const synthHi = (sens: number): number => 4 + (1 - clamp01(sens)) * 24
const MAX_TRACKS = 24
const MIN_HITS = 2 // sightings in a row before a thing plays
const GRACE = 0.25 // s a thing may vanish before its note ends (a jittery hand)
const GRACE_SCORE = 0.07 // score : a shape the playhead has left ends at once (two ticks)
const POLY = 8
const STEP_HYST = 0.4 // Steps : past the half step by this much of a step before a new note
const STEP_GAP = 60 // ms : a thing strikes again at most this often (a centroid's jitter is no run)
export const SYNTH_SLOT_COLORS = [
  'rgb(255,120,90)', 'rgb(255,200,80)', 'rgb(150,230,90)', 'rgb(70,220,200)',
  'rgb(90,170,255)', 'rgb(170,130,255)', 'rgb(255,110,200)', 'rgb(235,235,235)'
]

interface Track {
  id: number
  x: number; y: number // the centroid, smoothed (0..1, y down)
  rx: number; ry: number // the last raw centroid
  vx: number; vy: number // velocity, frame heights a second (x in heights too)
  area: number // blocks
  str: number // strength (motion × area), smoothed : the poly cap's order
  hits: number
  miss: number // s since last seen
  seen: boolean // seen this tick
  playing: boolean
  playT: number
  slot: number
  k: number // the scale note playing (index), -1 none
  hz: number
  strikeF: number // the velocity row's source at the strike
  pendUntil: number // ms : a grid onset sent but not struck yet
  lead: number // mono / unison : how long it has led the one playing
  startTick: number // the tick its note was struck (that tick it has its pitch already)
  struckAt: number // ms : its last strike
  f: Float32Array // the ten features, smoothed (THING_SRCS order)
  raw: Float32Array
  fresh: boolean // features not smoothed yet
}

export class SynthPlayer {
  // per block
  private eng = new Float32Array(NBB) // motion, held
  // the background (each block's light over ~1.5 s) and how far a block is from
  // it now : a moving thing's flat inside (no frame difference there) still
  // joins its moving edges, so a uniform square rising is one thing, not its
  // top and bottom edges as two
  private bg = new Float32Array(NBB)
  private fg = new Float32Array(NBB)
  private bgSet = false
  private lum = new Float32Array(NBB)
  private grad = new Float32Array(NBB)
  private bR = new Float32Array(NBB)
  private bG = new Float32Array(NBB)
  private bB = new Float32Array(NBB)
  private bSat = new Float32Array(NBB)
  private bHc = new Float32Array(NBB) // hue as a vector × saturation
  private bHs = new Float32Array(NBB)
  private mask = new Uint8Array(NBB)
  private dil = new Uint8Array(NBB)
  private lab = new Int16Array(NBB)
  private queue = new Int16Array(NBB)
  private sub = new Uint8Array(NBB) // a big region's cores : their seeds
  private subLow = new Uint8Array(NBB) // … and the blocks they grow through
  private lab2 = new Int16Array(NBB)
  private peak = 0 // the last grown region's strongest block
  private kept = new Float32Array(10)
  // blobs (things found this tick)
  private nBlob = 0
  private blX = new Float32Array(MAX_BLOBS)
  private blY = new Float32Array(MAX_BLOBS)
  private blA = new Float32Array(MAX_BLOBS) // area, blocks
  private blW = new Float32Array(MAX_BLOBS) // strength
  private blE = new Float32Array(MAX_BLOBS) // mean motion
  private blL = new Float32Array(MAX_BLOBS) // mean luma 0..255
  private blG = new Float32Array(MAX_BLOBS) // mean edges
  private blS = new Float32Array(MAX_BLOBS) // mean saturation
  private blHc = new Float32Array(MAX_BLOBS)
  private blHs = new Float32Array(MAX_BLOBS)
  private blSal = new Float32Array(MAX_BLOBS) // score : how much the shape stands out
  private blBox = new Int16Array(MAX_BLOBS * 4) // x0 y0 x1 y1, blocks
  private used = new Uint8Array(MAX_BLOBS)
  private tracks: Track[] = []
  private nextId = 1
  private slots = new Int32Array(POLY).fill(-1) // the id each colour slot plays
  private tableRef: Float32Array | null = null
  private diffAvg = -1 // the frame difference's slow average (the cut's reference)
  private lastX = -1 // score : the playhead's last place
  private colSal = new Float32Array(GRID)
  private tickN = 0
  /** The whole picture : motion, light, warmth, busyness, cut (0..1). */
  whole = { motion: 0, light: 0, warmth: 0.5, busy: 0, cut: 0 }
  /** For the mirror : per thing [x, y, vel, slot, midi note, playing] (stride 6). */
  dots = new Float32Array(MAX_TRACKS * 6)
  nDots = 0
  /** The score playhead's place (0..1), -1 when not in score mode. */
  scoreX = -1
  /** Something sounds or is tracked (an all-off is due when it stops). */
  active = false
  /** The last tick's cost (ms) and counts, for probes. */
  stats = { ms: 0, blobs: 0, tracks: 0, playing: 0 }

  /** Forget every thing (an all-off is sent by the caller). */
  reset(): void {
    this.tracks = []
    this.slots.fill(-1)
    this.eng.fill(0)
    this.bgSet = false
    this.nDots = 0
    this.scoreX = -1
    this.lastX = -1
    this.active = false
  }

  /** One tick : find the things, play them. Returns the events and the mods. */
  step(inp: SynthIn): { ev: SynthEv[]; mods: Array<{ id: number; m: SynthMods }> } {
    const t0 = performance.now()
    this.tickN++
    const cfg = inp.cfg
    const dt = Math.max(0.001, Math.min(0.1, inp.dt))
    this.blocks(inp, dt)
    const score = cfg.mode === 'score'
    let cutNow = false
    if (score) {
      const L = Math.max(1, cfg.bars * inp.bar)
      const x = (((inp.beats % L) + L) % L) / L
      // a new pass : every shape ends, the roll starts again
      if (this.lastX >= 0 && x < this.lastX - 0.5) for (const t of this.tracks) t.miss = GRACE + 1
      this.lastX = x
      this.scoreX = x
      this.findShapes(inp, x)
    } else {
      this.scoreX = -1
      this.lastX = -1
      cutNow = this.whole.cut >= 0.999
      if (cutNow) this.nBlob = 0 // a scene change is no movement : nothing new plays on it
      else this.findThings(cfg.sens)
    }
    this.track(inp, dt, score)
    const out = this.play(inp, dt, score)
    this.stats.ms = performance.now() - t0
    this.stats.blobs = this.nBlob
    this.stats.tracks = this.tracks.length
    this.active = this.tracks.length > 0
    return out
  }

  // ── 1. the blocks ──
  private blocks(inp: SynthIn, dt: number): void {
    const cur = inp.cur, prev = inp.prev, rgba = inp.rgba
    const rel = Math.exp(-dt / 0.08)
    const kb = 1 - Math.exp(-dt / 1.5)
    let sumD = 0, sumL = 0, sumG = 0, sR = 0, sG = 0, sB = 0
    for (let by = 0; by < NB; by++) {
      for (let bx = 0; bx < NB; bx++) {
        let d = 0, l = 0, g = 0
        for (let yy = 0; yy < B; yy++) {
          const y = by * B + yy, row = y * GRID
          const inY = y > 0 && y < GRID - 1
          const r0 = row - GRID, r2 = row + GRID
          for (let xx = 0; xx < B; xx++) {
            const x = bx * B + xx, i = row + x
            const c = cur[i]
            const df = c - prev[i]
            d += df < 0 ? -df : df
            l += c
            if (inY && x > 0 && x < GRID - 1) {
              const gx = cur[r0 + x + 1] + 2 * cur[row + x + 1] + cur[r2 + x + 1] - (cur[r0 + x - 1] + 2 * cur[row + x - 1] + cur[r2 + x - 1])
              const gy = cur[r2 + x - 1] + 2 * cur[r2 + x] + cur[r2 + x + 1] - (cur[r0 + x - 1] + 2 * cur[r0 + x] + cur[r0 + x + 1])
              g += ((gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy)) * 0.25
            }
          }
        }
        const b = by * NB + bx
        const m = inp.fresh ? 0 : d / (B * B)
        const held = this.eng[b] * rel
        this.eng[b] = m > held ? m : held
        this.lum[b] = l / (B * B)
        if (!this.bgSet || inp.fresh) this.bg[b] = this.lum[b]
        const fd = this.lum[b] - this.bg[b]
        this.fg[b] = fd < 0 ? -fd : fd
        this.bg[b] += fd * kb
        this.grad[b] = g / (B * B)
        sumD += m; sumL += l; sumG += g
        // color : four samples (the readback is bottom-up, the luma grid top-down)
        let R = 0, G = 0, Bc = 0
        for (let yy = 1; yy < B; yy += 2) {
          const ry = GRID - 1 - (by * B + yy)
          for (let xx = 1; xx < B; xx += 2) {
            const i = (ry * GRID + bx * B + xx) * 4
            R += rgba[i]; G += rgba[i + 1]; Bc += rgba[i + 2]
          }
        }
        R *= 0.25; G *= 0.25; Bc *= 0.25
        this.bR[b] = R; this.bG[b] = G; this.bB[b] = Bc
        sR += R; sG += G; sB += Bc
        const mx = R > G ? (R > Bc ? R : Bc) : G > Bc ? G : Bc
        const mn = R < G ? (R < Bc ? R : Bc) : G < Bc ? G : Bc
        const dd = mx - mn
        const sat = mx > 0 ? dd / mx : 0
        let h = 0
        if (dd > 0) {
          if (mx === R) h = ((G - Bc) / dd) % 6
          else if (mx === G) h = (Bc - R) / dd + 2
          else h = (R - G) / dd + 4
          h /= 6
        }
        this.bSat[b] = sat
        this.bHc[b] = Math.cos(h * 6.283185307179586) * sat
        this.bHs[b] = Math.sin(h * 6.283185307179586) * sat
      }
    }
    this.bgSet = true
    // the whole picture
    const w = this.whole
    const k = 1 - Math.exp(-dt / 0.2)
    const meanD = sumD / NBB
    w.motion += (clamp01(meanD / 12) - w.motion) * k
    w.light += (clamp01(sumL / (GRID * GRID * 255)) - w.light) * k
    const tot = sR + sG + sB + 1
    w.warmth += (clamp01(0.5 + ((sR - sB) / tot) * 1.5) - w.warmth) * k
    w.busy += (clamp01(sumG / (GRID * GRID) / 30) - w.busy) * k
    // A cut : the frame difference jumps far over its usual level. It fades
    // over about a second; the frame it happens on plays nothing new.
    if (this.diffAvg < 0 || inp.fresh) this.diffAvg = meanD
    if (!inp.fresh && meanD > 18 && meanD > this.diffAvg * 3.5 + 4) {
      w.cut = 1
      this.eng.fill(0)
      this.bg.set(this.lum) // a new scene : its own background
      this.fg.fill(0)
    } else {
      w.cut *= Math.exp(-dt / 0.35)
      this.diffAvg += (meanD - this.diffAvg) * (1 - Math.exp(-dt / 2))
    }
  }

  // ── 2. the moving things ──
  private findThings(sens: number): void {
    const hi = synthHi(sens) // mean |difference| per pixel, 0..255
    const lo = hi * 0.5
    const eng = this.eng, mask = this.mask, dil = this.dil, lab = this.lab
    // a thing grows through moving blocks and through blocks off the background
    // (its inside); it is seeded only where it moves (`hi`), so a thing that
    // stops ends even while it still stands out
    const fgT = hi * 1.5
    const fg = this.fg
    for (let b = 0; b < NBB; b++) mask[b] = eng[b] >= lo || fg[b] >= fgT ? 1 : 0
    // one-block gaps bridged : the arm and the body of one dancer stay one thing
    for (let by = 0; by < NB; by++) {
      for (let bx = 0; bx < NB; bx++) {
        let on = 0
        for (let dy = -1; dy <= 1 && !on; dy++) {
          const y = by + dy
          if (y < 0 || y >= NB) continue
          for (let dx = -1; dx <= 1; dx++) {
            const x = bx + dx
            if (x >= 0 && x < NB && mask[y * NB + x]) { on = 1; break }
          }
        }
        dil[by * NB + bx] = on
      }
    }
    lab.fill(-1)
    let n = 0, label = 0
    for (let s = 0; s < NBB && n < MAX_BLOBS; s++) {
      if (lab[s] >= 0 || eng[s] < hi) continue
      const lb = label++
      if (!this.grow(s, mask, dil, lo, lb, n)) continue
      // A big region (a moving camera, a screen behind a dancer, two people
      // touching) : its strongest cores, if it has several, are the things.
      if (this.blA[n] >= BIG) {
        const peak = this.peak
        const hi2 = Math.max(hi * 1.6, peak * 0.45)
        // (seeds over hi2, grown through the region's blocks over 0.6 of it :
        // the cores' own hysteresis, so they hold from frame to frame)
        const sub = this.sub, low = this.subLow
        let m = 0
        for (let b = 0; b < NBB; b++) {
          const inR = lab[b] === lb
          sub[b] = inR && eng[b] >= hi2 ? 1 : 0
          low[b] = inR && eng[b] >= hi2 * 0.6 ? 1 : 0
          if (sub[b]) m++
        }
        if (m >= 4) {
          this.keepBlob(n)
          const lab2 = this.lab2
          lab2.fill(-1)
          let k = 0, l2 = 0
          for (let b = 0; b < NBB && n + k < MAX_BLOBS; b++) {
            if (!sub[b] || lab2[b] >= 0) continue
            if (this.grow(b, low, low, hi2 * 0.6, l2++, n + k, lab2) && this.blA[n + k] >= 3) k++
          }
          // at most the three strongest cores : a moving field (a screen of
          // footage, the whole frame when the camera moves) is a few voices,
          // never a swarm
          if (k > 3) { this.strongest(n, k, 3); k = 3 }
          if (k >= 2) { n += k; continue }
          this.keepBlob(n, true) // one core only : the region stays one thing
        }
      }
      n++
    }
    this.nBlob = this.mergeEdges(n)
  }

  /** A flat thing moving shows only its edges (its inside never changes) :
   *  two regions side by side, about as wide as each other along the gap and
   *  closer than that width, are one thing (their weights summed, the centroid
   *  between them). Two people standing apart stay two. */
  private mergeEdges(n: number): number {
    const bx = this.blBox
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const ax0 = bx[a * 4], ay0 = bx[a * 4 + 1], ax1 = bx[a * 4 + 2], ay1 = bx[a * 4 + 3]
        const bx0 = bx[b * 4], by0 = bx[b * 4 + 1], bx1 = bx[b * 4 + 2], by1 = bx[b * 4 + 3]
        const aw = ax1 - ax0 + 1, ah = ay1 - ay0 + 1, bw = bx1 - bx0 + 1, bh = by1 - by0 + 1
        const ox = Math.min(ax1, bx1) - Math.max(ax0, bx0) + 1 // overlap across
        const oy = Math.min(ay1, by1) - Math.max(ay0, by0) + 1
        const gy = Math.max(ay0, by0) - Math.min(ay1, by1) - 1 // gap between
        const gx = Math.max(ax0, bx0) - Math.min(ax1, bx1) - 1
        const wMin = Math.min(aw, bw), hMin = Math.min(ah, bh)
        // one above the other (a flat thing moving up or down : two wide, thin
        // edges), or side by side (moving across : two tall, thin ones), about
        // as long as each other, the gap no wider than they are long (and a
        // quarter of the frame at most)
        const thinY = ah <= 0.5 * aw && bh <= 0.5 * bw, thinX = aw <= 0.5 * ah && bw <= 0.5 * bh
        const vert = thinY && ox >= 0.6 * wMin && wMin >= 3 && Math.max(aw, bw) <= 1.5 * wMin && gy >= 0 && gy <= Math.min(6, 0.9 * Math.max(aw, bw))
        const horz = thinX && oy >= 0.6 * hMin && hMin >= 3 && Math.max(ah, bh) <= 1.5 * hMin && gx >= 0 && gx <= Math.min(6, 0.9 * Math.max(ah, bh))
        if (!vert && !horz) continue
        if (this.blA[a] > this.blA[b] * 3 || this.blA[b] > this.blA[a] * 3) continue
        // b into a
        const wa = this.blW[a], wb = this.blW[b], w = wa + wb
        const mix = (arr: Float32Array): void => { arr[a] = (arr[a] * wa + arr[b] * wb) / w }
        mix(this.blX); mix(this.blY); mix(this.blL); mix(this.blG); mix(this.blS); mix(this.blHc); mix(this.blHs)
        this.blE[a] = (this.blE[a] * this.blA[a] + this.blE[b] * this.blA[b]) / (this.blA[a] + this.blA[b])
        this.blA[a] += this.blA[b]
        this.blW[a] = w
        bx[a * 4] = Math.min(ax0, bx0); bx[a * 4 + 1] = Math.min(ay0, by0); bx[a * 4 + 2] = Math.max(ax1, bx1); bx[a * 4 + 3] = Math.max(ay1, by1)
        // the last blob into b's slot
        const L = n - 1
        if (b !== L) {
          for (const arr of [this.blX, this.blY, this.blA, this.blW, this.blE, this.blL, this.blG, this.blS, this.blHc, this.blHs, this.blSal]) arr[b] = arr[L]
          for (let i = 0; i < 4; i++) bx[b * 4 + i] = bx[L * 4 + i]
        }
        n--
        b = a // look at a's neighbours again, it grew
      }
    }
    return n
  }

  /** Keep the `keep` strongest of the `k` blobs from slot `n` (moved to the front). */
  private strongest(n: number, k: number, keep: number): void {
    const arrs = [this.blX, this.blY, this.blA, this.blW, this.blE, this.blL, this.blG, this.blS, this.blHc, this.blHs, this.blSal]
    for (let i = 0; i < keep; i++) {
      let best = n + i
      for (let j = n + i + 1; j < n + k; j++) if (this.blW[j] > this.blW[best]) best = j
      if (best !== n + i) for (const a of arrs) { const t = a[n + i]; a[n + i] = a[best]; a[best] = t }
    }
  }

  /** Save a blob's slot (`back` : put it back). */
  private keepBlob(slot: number, back = false): void {
    const k = this.kept
    const arrs = [this.blX, this.blY, this.blA, this.blW, this.blE, this.blL, this.blG, this.blS, this.blHc, this.blHs]
    for (let i = 0; i < arrs.length; i++) {
      if (back) arrs[i][slot] = k[i]
      else k[i] = arrs[i][slot]
    }
    if (back) this.blSal[slot] = 0
  }

  /** Grow one region from `seed` through `conn` (its stats from the blocks in
   *  `mask`), labelled `lb`, into blob slot `slot`. False : a speck (two
   *  blocks, or one moving hard) or no weight. */
  private grow(seed: number, mask: Uint8Array, conn: Uint8Array, lo: number, lb: number, slot: number, lab = this.lab): boolean {
    const eng = this.eng, q = this.queue
    let head = 0, tail = 0
    q[tail++] = seed
    lab[seed] = lb
    let area = 0, wsum = 0, wx = 0, wy = 0, l = 0, g = 0, sat = 0, hc = 0, hs = 0, peak = 0
    let x0 = NB, y0 = NB, x1 = -1, y1 = -1
    while (head < tail) {
      const b = q[head++]
      const bx = b % NB, by = (b / NB) | 0
      if (mask[b]) {
        const e = eng[b]
        const f = this.fg[b]
        const w = (e > lo * 0.5 ? e - lo * 0.5 : 0) + 0.35 * (f < 60 ? f : 60)
        area++
        if (bx < x0) x0 = bx
        if (bx > x1) x1 = bx
        if (by < y0) y0 = by
        if (by > y1) y1 = by
        wsum += w; wx += (bx + 0.5) * w; wy += (by + 0.5) * w
        l += this.lum[b] * w; g += this.grad[b] * w; sat += this.bSat[b] * w
        hc += this.bHc[b] * w; hs += this.bHs[b] * w
        if (e > peak) peak = e
      }
      for (let dy = -1; dy <= 1; dy++) {
        const y = by + dy
        if (y < 0 || y >= NB) continue
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx
          if (x < 0 || x >= NB) continue
          const nb = y * NB + x
          if (lab[nb] >= 0 || !conn[nb]) continue
          lab[nb] = lb
          q[tail++] = nb
        }
      }
    }
    this.peak = peak
    if (wsum <= 0 || (area < 2 && peak < lo * 4)) return false
    this.blX[slot] = wx / wsum / NB
    this.blY[slot] = wy / wsum / NB
    this.blA[slot] = area
    this.blW[slot] = wsum
    this.blE[slot] = wsum / area + lo * 0.5
    this.blL[slot] = l / wsum
    this.blG[slot] = g / wsum
    this.blS[slot] = sat / wsum
    this.blHc[slot] = hc / wsum
    this.blHs[slot] = hs / wsum
    this.blSal[slot] = 0
    const bo = slot * 4
    this.blBox[bo] = x0; this.blBox[bo + 1] = y0; this.blBox[bo + 2] = x1; this.blBox[bo + 3] = y1
    return true
  }

  /** Score : the shapes the playhead's column crosses (light or edges, not
   *  motion), each run of rows one shape. */
  private findShapes(inp: SynthIn, x: number): void {
    const cur = inp.cur, rgba = inp.rgba
    const c = Math.max(2, Math.min(GRID - 3, Math.round(x * (GRID - 1))))
    let mean = 0
    for (let i = 0; i < GRID * GRID; i += 7) mean += cur[i]
    mean /= Math.ceil((GRID * GRID) / 7)
    const sal = this.colSal
    for (let y = 0; y < GRID; y++) {
      const r = y * GRID
      const v = (cur[r + c - 1] + cur[r + c] + cur[r + c + 1]) / 3
      const e = Math.abs(cur[r + c + 2] - cur[r + c - 2])
      sal[y] = Math.abs(v - mean) + 0.5 * e
    }
    const T = 12 + (1 - inp.cfg.sens) * 60
    let n = 0
    let y = 0
    while (y < GRID && n < MAX_BLOBS) {
      if (sal[y] < T) { y++; continue }
      const y0 = y
      let y1 = y
      // a run, one quiet row bridged
      while (y1 + 1 < GRID && (sal[y1 + 1] >= T || (y1 + 2 < GRID && sal[y1 + 2] >= T))) y1++
      y = y1 + 1
      const h = y1 - y0 + 1
      if (h < 2) continue
      let s = 0, l = 0, g = 0, sat = 0, hc = 0, hs = 0
      for (let yy = y0; yy <= y1; yy++) {
        const r = yy * GRID
        s += sal[yy]
        l += cur[r + c]
        g += yy > 0 && yy < GRID - 1 ? Math.abs(cur[r + c + GRID] - cur[r + c - GRID]) : 0
        const i = ((GRID - 1 - yy) * GRID + c) * 4
        const R = rgba[i], G = rgba[i + 1], Bc = rgba[i + 2]
        const mx = Math.max(R, G, Bc), mn = Math.min(R, G, Bc), dd = mx - mn
        const st = mx > 0 ? dd / mx : 0
        let hu = 0
        if (dd > 0) {
          if (mx === R) hu = ((G - Bc) / dd) % 6
          else if (mx === G) hu = (Bc - R) / dd + 2
          else hu = (R - G) / dd + 4
          hu /= 6
        }
        sat += st
        hc += Math.cos(hu * 6.283185307179586) * st
        hs += Math.sin(hu * 6.283185307179586) * st
      }
      this.blX[n] = x
      this.blY[n] = (y0 + y1 + 1) / 2 / GRID
      this.blA[n] = h
      this.blW[n] = s
      this.blE[n] = 0
      this.blL[n] = l / h
      this.blG[n] = (g / h) * 2
      this.blS[n] = sat / h
      this.blHc[n] = hc / h
      this.blHs[n] = hs / h
      this.blSal[n] = s / h
      n++
    }
    this.nBlob = n
  }

  // ── 3. tracking ──
  private track(inp: SynthIn, dt: number, score: boolean): void {
    const tr = this.tracks, n = this.nBlob, asp = inp.aspect
    for (const t of tr) t.seen = false
    this.used.fill(0, 0, n)
    // every pair inside its gate, nearest first
    const pairs: Array<[number, number, number]> = []
    for (let ti = 0; ti < tr.length; ti++) {
      const t = tr[ti]
      const px = t.x + t.vx * dt / Math.max(0.2, asp), py = t.y + t.vy * dt
      const tRad = Math.sqrt(t.area / (score ? GRID : NBB)) * 0.5
      for (let b = 0; b < n; b++) {
        let d: number, gate: number
        if (score) {
          d = Math.abs(this.blY[b] - py)
          gate = 0.05 + (this.blA[b] / GRID + t.area / GRID) * 0.5
        } else {
          d = Math.hypot((this.blX[b] - px) * asp, this.blY[b] - py)
          gate = 0.1 + tRad + Math.sqrt(this.blA[b] / NBB) * 0.5
        }
        if (d < gate) pairs.push([d, ti, b])
      }
    }
    pairs.sort((a, b) => a[0] - b[0])
    for (const [, ti, b] of pairs) {
      const t = tr[ti]
      if (t.seen || this.used[b]) continue
      t.seen = true
      this.used[b] = 1
      this.update(t, b, dt, inp, score)
    }
    // the ones not seen : their grace runs; past it, gone
    for (const t of tr) if (!t.seen) { t.miss += dt; t.hits = t.playing ? t.hits : 0 }
    // new things (none on a cut, and never past the cap of tracks)
    for (let b = 0; b < n; b++) {
      if (this.used[b] || tr.length >= MAX_TRACKS) continue
      const t: Track = {
        id: this.nextId++, x: this.blX[b], y: this.blY[b], rx: this.blX[b], ry: this.blY[b], vx: 0, vy: 0,
        area: this.blA[b], str: this.blW[b], hits: 0, miss: 0, seen: true, playing: false, playT: 0, slot: -1,
        k: -1, hz: 0, strikeF: 0.5, pendUntil: 0, lead: 0, startTick: -1, struckAt: 0, f: new Float32Array(10), raw: new Float32Array(10), fresh: true
      }
      if (this.nextId > 0x3fffffff) this.nextId = 1
      tr.push(t)
      this.update(t, b, dt, inp, score)
    }
  }

  private update(t: Track, b: number, dt: number, inp: SynthIn, score: boolean): void {
    const bx = this.blX[b], by = this.blY[b]
    if (t.hits > 0) {
      // velocity from the raw centroids (frame heights a second, x in heights)
      // (the second sighting takes its velocity whole : a quick flick strikes
      // as quick, not as the slow start of a smoothing)
      const kv = t.hits === 1 ? 1 : 1 - Math.exp(-dt / 0.15)
      t.vx += (((bx - t.rx) * inp.aspect) / dt - t.vx) * kv
      t.vy += ((by - t.ry) / dt - t.vy) * kv
    }
    t.rx = bx; t.ry = by
    // (the place, smoothed ~0.1 s : a motion blob's centroid jitters by a block,
    // about a scale step over three octaves)
    // (in score the place is the playhead's, never smoothed : it would trail behind)
    const kp = t.hits > 0 && !score ? 1 - Math.exp(-dt / 0.1) : 1
    t.x += (bx - t.x) * kp
    t.y += (by - t.y) * kp
    t.area += (this.blA[b] - t.area) * 0.5
    t.str += (this.blW[b] - t.str) * (1 - Math.exp(-dt / 0.15))
    t.hits++
    t.miss = 0
    // the features, raw
    const r = t.raw
    const hiE = synthHi(inp.cfg.sens)
    if (score) {
      r[0] = clamp01(this.blSal[b] / 80) // in score : how strongly the shape stands out
      r[1] = clamp01((this.blA[b] / GRID) * 3)
    } else {
      const vel = Math.hypot(t.vx, t.vy)
      const en = clamp01((this.blE[b] - hiE * 0.5) / 40)
      r[0] = Math.pow(clamp01(0.5 * clamp01(vel / 1.0) + 0.5 * en), 0.8)
      r[1] = clamp01(Math.sqrt(this.blA[b] / NBB) * 1.8)
    }
    r[2] = clamp01(this.blL[b] / 255)
    const sat = this.blS[b]
    // hue folded so red and red meet (0 red .. 1 cyan), grey things in the middle
    const hu = Math.atan2(this.blHs[b], this.blHc[b]) / 6.283185307179586
    const fold = (1 - Math.cos(hu * 6.283185307179586)) / 2
    r[3] = 0.5 + (fold - 0.5) * clamp01(sat * 2.5)
    r[4] = clamp01(sat * 1.4)
    r[5] = clamp01(this.blG[b] / 45)
    r[6] = clamp01(t.x)
    r[7] = clamp01(t.y)
    r[8] = clamp01(0.5 - t.vy * 0.6) // rising : up the frame, y falling
    r[9] = clamp01(t.playT / 4)
    // (until it plays, the features are what it is now : its strike reads them)
    if (t.fresh || !t.playing) { t.f.set(r); t.fresh = false; return }
    const kf = 1 - Math.exp(-dt / 0.1)
    for (let i = 0; i < 10; i++) t.f[i] += (r[i] - t.f[i]) * kf
  }

  // ── 4-7. the notes ──
  private play(inp: SynthIn, dt: number, score: boolean): { ev: SynthEv[]; mods: Array<{ id: number; m: SynthMods }> } {
    const cfg = inp.cfg
    const ev: SynthEv[] = []
    const now = inp.nowMs
    const tab = inp.table
    const N = tab.length
    const keyChanged = this.tableRef !== tab
    this.tableRef = tab
    // gone : past the grace (a thing that stopped, or left the frame)
    const keep: Track[] = []
    for (const t of this.tracks) {
      if (t.miss > (score ? GRACE_SCORE : GRACE)) { if (t.playing) this.stop(t, ev); continue }
      keep.push(t)
    }
    this.tracks = keep
    const cap = cfg.voices === 'poly' ? POLY : 1
    const ready = (t: Track): boolean => !t.playing && t.seen && t.hits >= (score ? 1 : MIN_HITS)
    const playing = this.tracks.filter((t) => t.playing)
    const cand = this.tracks.filter(ready).sort((a, b) => b.str - a.str)
    if (cap > 1) {
      let free = cap - playing.length
      for (const c of cand) {
        if (free > 0) { this.start(c, inp, ev); free--; continue }
        // a newcomer twice the weakest one that has played a while takes its voice
        // (one a tick : never a flurry of steals)
        let weak: Track | null = null
        for (const p of this.tracks) if (p.playing && p.playT > 0.6 && (!weak || p.str < weak.str)) weak = p
        if (weak && c.str > weak.str * 2) { this.stop(weak, ev); this.start(c, inp, ev) }
        break
      }
    } else {
      const cur = playing[0]
      if (!cur) { if (cand[0]) this.start(cand[0], inp, ev) }
      else {
        const best = cand[0]
        if (best && best.str > cur.str * 1.6) best.lead += dt
        for (const c of cand) if (c !== best) c.lead = 0
        if (best && best.lead > 0.2) {
          // the new note first, then the old one lets go, in one message : the
          // engine reads that order (no render between) as a handover and
          // strikes the new note (a note over a held one is otherwise legato)
          best.lead = 0
          this.start(best, inp, ev)
          this.stop(cur, ev)
        }
      }
    }
    // pitch + mods of everything playing
    const mods: Array<{ id: number; m: SynthMods }> = []
    for (const t of this.tracks) {
      if (!t.playing) continue
      t.playT += dt
      if (t.k >= 0 && t.startTick !== this.tickN) {
        const fi = this.place(t, inp) * (N - 1)
        if (!cfg.slide) {
          const next = Math.max(0, Math.min(N - 1, Math.round(fi)))
          if (keyChanged) {
            // a new key (the key sequencer) : the same place on the new scale, slid there
            t.k = next
            const hz = tab[next]
            if (hz && hz !== t.hz) { t.hz = hz; ev.push({ k: 2, id: t.id, hz, vel: 0, at: 0 }) }
          } else if (Math.abs(fi - t.k) > 0.5 + STEP_HYST && next !== t.k && now >= t.pendUntil && now - t.struckAt >= STEP_GAP) {
            // Steps : a new scale note, struck again on the same voice
            t.k = next
            t.hz = tab[next]
            const vel = this.strikeVel(t, inp)
            const at = this.onsetDelay(inp)
            t.pendUntil = now + at * 1000
            t.struckAt = now
            ev.push({ k: 0, id: t.id, hz: t.hz, vel, at, m: this.mods(t, inp) })
          }
        } else if (now >= t.pendUntil) {
          const hz = slideHz(tab, fi)
          if (hz > 0 && Math.abs(Math.log2(hz / t.hz)) * 1200 > 1) {
            t.hz = hz
            t.k = Math.round(fi)
            ev.push({ k: 2, id: t.id, hz, vel: 0, at: 0 })
          }
        }
      }
      mods.push({ id: t.id, m: this.mods(t, inp) })
    }
    // the mirror's dots
    let d = 0
    for (const t of this.tracks) {
      if (!t.playing && (!t.seen || t.hits < 1)) continue
      if (d >= MAX_TRACKS) break
      const o = d * 6
      this.dots[o] = t.x
      this.dots[o + 1] = t.y
      this.dots[o + 2] = t.playing ? this.strikeVel(t, inp) : 0
      this.dots[o + 3] = t.slot
      this.dots[o + 4] = t.hz > 0 ? 69 + 12 * Math.log2(t.hz / 440) : -1
      this.dots[o + 5] = t.playing ? 1 : 0
      d++
    }
    this.nDots = d
    this.stats.playing = this.tracks.filter((t) => t.playing).length
    return { ev, mods }
  }

  private start(t: Track, inp: SynthIn, ev: SynthEv[]): void {
    const tab = inp.table
    const N = tab.length
    if (!N) return
    const fi = this.place(t, inp) * (N - 1)
    t.k = Math.max(0, Math.min(N - 1, Math.round(fi)))
    t.hz = inp.cfg.slide ? slideHz(tab, fi) : tab[t.k]
    t.playing = true
    t.playT = 0
    t.lead = 0
    t.startTick = this.tickN
    t.struckAt = inp.nowMs
    // its colour : the lowest free slot
    let s = 0
    while (s < POLY && this.slots[s] >= 0) s++
    t.slot = s < POLY ? s : 0
    this.slots[t.slot] = t.id
    const row = inp.cfg.patch[0]
    t.strikeF = this.src(row.src, t)
    const vel = this.strikeVel(t, inp)
    const at = this.onsetDelay(inp)
    t.pendUntil = inp.nowMs + at * 1000
    ev.push({ k: 0, id: t.id, hz: t.hz, vel, at, m: this.mods(t, inp) })
  }

  private stop(t: Track, ev: SynthEv[]): void {
    t.playing = false
    t.k = -1
    if (t.slot >= 0 && this.slots[t.slot] === t.id) this.slots[t.slot] = -1
    t.slot = -1
    ev.push({ k: 1, id: t.id, hz: 0, vel: 0, at: 0 })
  }

  /** Where the thing is, as the pitch reads it : 0 lowest .. 1 highest. */
  private place(t: Track, inp: SynthIn): number {
    switch (inp.cfg.mode) {
      case 'keyboard': return clamp01(t.x)
      case 'radial': return clamp01(inp.radial(t.x, t.y))
      default: return clamp01(1 - t.y) // height, and the score's rows
    }
  }

  /** The delay to the next grid point (0 : free). */
  private onsetDelay(inp: SynthIn): number {
    const g = inp.cfg.grid
    const div = g === '8' ? 0.5 : g === '16' ? 0.25 : g === '8t' ? 1 / 3 : 0
    if (!div || !(inp.bpm > 0)) return 0
    const next = Math.ceil(inp.beats / div - 1e-6) * div
    return Math.max(0, Math.min(2, ((next - inp.beats) * 60) / inp.bpm))
  }

  private src(s: SynthSrc, t: Track): number {
    const i = THING_SRCS.indexOf(s)
    if (i >= 0) return t.f[i]
    const w = this.whole
    switch (s) {
      case 'motion': return w.motion
      case 'light': return w.light
      case 'warmth': return w.warmth
      case 'busyness': return w.busy
      case 'cut': return w.cut
      default: return 0.5
    }
  }

  private depth(i: number, inp: SynthIn): number {
    const m = inp.mod(SYNTH_DEPTH_PARAMS[i])
    const d = m !== undefined && Number.isFinite(m) ? m : inp.cfg.patch[i].depth
    const pic = inp.mod('synthPicture')
    const p = pic !== undefined && Number.isFinite(pic) ? pic : inp.cfg.picture
    return clampN(d, -1, 1) * clamp01(p)
  }

  /** The strike's velocity : 0.7 at PICTURE 0; the Velocity row's source
   *  pulls it toward 0.15 .. 1 (a negative depth reads it upside down). */
  private strikeVel(t: Track, inp: SynthIn): number {
    const d = this.depth(0, inp)
    const row = inp.cfg.patch[0]
    if (row.src === 'none' || !d) return 0.7
    const f = this.src(row.src, t)
    const target = 0.15 + 0.85 * (d > 0 ? f : 1 - f)
    return clamp01(0.7 + (target - 0.7) * Math.abs(d))
  }

  /** The patchbay : depth × PICTURE × (2f − 1) on every centered row; the
   *  held velocity follows the source's change since the strike (around its
   *  middle, 0.5), pan and bend are absolute. PICTURE 0 : every row neutral. */
  private mods(t: Track, inp: SynthIn): SynthMods {
    const P = inp.cfg.patch
    const c = (i: number): number => {
      const d = this.depth(i, inp)
      return d ? clampN(d * (2 * this.src(P[i].src, t) - 1), -1, 1) : 0
    }
    const dv = this.depth(0, inp)
    return {
      vel: P[0].src === 'none' ? 0.5 : clamp01(0.5 + dv * (this.src(P[0].src, t) - t.strikeF)),
      timbre: c(1), harmonics: c(2), morph: c(3), cutoff: c(4), reso: c(5), drive: c(6),
      env: c(7), pan: c(8), bend: c(9)
    }
  }
}

/** Slide : the place between two scale notes, glided in log frequency, but
 *  lingering near each note (a smoothstep twice) so a slow drift still sings
 *  the scale and only a quick move smears between its notes. */
function slideHz(tab: Float32Array, fi: number): number {
  const N = tab.length
  if (!N) return 0
  const f = Math.max(0, Math.min(N - 1, fi))
  const k = Math.min(N - 2, Math.floor(f))
  if (k < 0) return tab[0]
  let u = f - k
  u = u * u * (3 - 2 * u)
  u = u * u * (3 - 2 * u)
  return tab[k] * Math.pow(tab[k + 1] / tab[k], u)
}
