// Sonify engine (the S page's sound half). Owns the AudioContext + the single
// `soni` AudioWorklet (see soniWorklet.ts), the two image taps, the note
// quantizer tables, flow analysis, output-device routing (setSinkId) and the
// recording tap (a MediaStreamDestination the recorder can mix in).
//
// Data path per frame (App loop → engine.tick):
//   Compositor.readSonifyGrid(tap) → 96×96 RGBA readback → luma Uint8Array →
//   transferred to the worklet (~9KB @ 30Hz per tap). The readback is
//   asynchronous, so a tap's grid is a frame or two behind the picture and the
//   first call after a voice switches on returns nothing (that tick is skipped,
//   same as a tap with no source yet). The FLOW voice's motion
//   field is computed HERE on the luma grids (block matching cur vs prev),
//   median-thresholded, converted to grain events with per-event random onset
//   dither across the frame interval (Pelletier), pitch quantized via the
//   active scale table, then posted to the worklet.

import { registerSonifyModBase, sonifyModValues } from '../engine/modulation'
import { soniBeats } from './soniClock'
import { SONI_WORKLET_URL } from './soniWorklet'
import { CollageVoice, type CollageSoundSet } from './collageVoice'

export const GRID = 96
// Signal's grains play this long after their step : a fixed latency, longer
// than a frame (50 ms covers a 24 Hz display), so every grain keeps the
// clock's spacing whatever the frame times did.
const SIG_AHEAD = 0.05
const FLOW_BLOCK = 8 // grid px per flow block → 12×12 blocks
const FLOW_BLOCKS = GRID / FLOW_BLOCK

export type SoniEventMode = 'spatial' | 'motion' | 'blend'
export type SoniScale = 'chromatic' | 'major' | 'minor' | 'pentatonic' | 'wholetone' | 'dorian' | 'phrygian' | 'lydian'
export const SONI_SCALES: SoniScale[] = ['chromatic', 'major', 'minor', 'pentatonic', 'wholetone', 'dorian', 'phrygian', 'lydian']
export const SCALE_STEPS: Record<SoniScale, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 3, 5, 7, 10],
  wholetone: [0, 2, 4, 6, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11]
}

export interface SoniTap {
  kind: 'master' | 'layer'
  layer: number
}
export interface SoniConfig {
  on: boolean
  master: number
  sinkId: string
  // quantizer
  root: number // 0..11 (C..B)
  rootOct: number // 1..6 : the octave the root sits in (a global transpose; 3 = no shift)
  scale: SoniScale
  spectra: {
    on: boolean; tap: number; gain: number; pan: number
    sweepOn: boolean; sweepHz: number; sync: boolean; x: number
    // reading PATH (0 horizontal · 1 vertical · 2 radial · 3 spiral) + PACE
    // (0 = even sweep … breathing rubato : slow at the edges, rushing the middle).
    path: number; pace: number
    gamma: number; breath: number; loOct: number; hiOct: number; quantize: boolean
  }
  orbit: {
    on: boolean; tap: number; gain: number; pan: number
    note: number // MIDI-ish note number when quantized
    freq: number // free Hz when not
    quantize: boolean
    ratio: number; cx: number; cy: number; rx: number; ry: number
    drive: number; smooth: number
  }
  flow: {
    on: boolean; tap: number; gain: number; pan: number
    sense: number; density: number; dur: number; noise: number
    // colour → grain timbre : saturation brightens, hue tints (warm = sub-octave
    // body, cool = octave-up shimmer). 0 = the plain sine↔noise grain.
    colour: number
    loOct: number; hiOct: number; quantize: boolean
  }
  // Events (Aural-Mirror register) : edges / motion → discrete plucked notes.
  events: {
    on: boolean; tap: number; gain: number; pan: number
    mode: SoniEventMode // what fires a note : spatial edges, motion, or both
    sense: number // detection threshold (higher = more events)
    density: number // max events per instant
    decay: number // base note decay 0..1
    highs: number // 'highs decay sooner' amount 0..1
    wave: number // 0 sine · 1 triangle · 2 saw · 3 square
    loOct: number; hiOct: number; quantize: boolean
  }
  raster: {
    on: boolean; tap: number; gain: number; pan: number
    note: number; freq: number; quantize: boolean
    rx: number; ry: number; rw: number; rh: number; smooth: number; tone: number
  }
  sstv: {
    on: boolean; tap: number; gain: number; pan: number
    lineHz: number; sync: boolean; dev: number; syncLev: number
  }
  filter: {
    on: boolean; tap: number; gain: number; pan: number
    q: number; noise: number; lineIn: boolean
    // 0 = free noise · up = a frozen stretch of noise replayed, ~400 ms (a
    // flutter) down to 5 ms (a buzz)
    loop: number
    sweepOn: boolean; sweepHz: number; x: number; gamma: number
    path: number; pace: number // reading path + breathing pace (see spectra)
    loOct: number; hiOct: number; quantize: boolean
  }
  // Chord bank (Aural Mirror's additive layer) : a few scale-tuned oscillators,
  // each following the brightness of a horizontal band → a sustained chord that
  // swells and fades with the image (sings even on a STILL frame).
  // SIGNAL : scan heads read the picture as bits on a clock, and every cell
  // they cross that is brighter than `thresh` fires one micro-grain. The
  // picture IS the pattern : nothing here is a stored rhythm.
  signal: {
    on: boolean; tap: number; gain: number; pan: number
    wave: number // 0 pip · 1 damped · 2 noise · 3 click · 4 fm · 5 square · 6 tri · 7 pink · 8 ping
    decay: number // 0..1 -> 0.2 ms .. 500 ms (the window, for pip and ping)
    tone: number // 0..1 the noise waves' lowpass
    fm: number // 0..1 FM depth (the fm wave)
    heads: number // 1..4 read heads, each on its own band of the bar
    rate: number // steps per second, or per beat when synced
    sync: boolean
    steps: number // positions in one sweep of a head (its resolution)
    spread: number // 0..1 : how far the heads' sweeps diverge (the polymeter)
    thresh: number // 0..1 : what brightness counts as a mark
    density: number // 0..1 : how many marks one head may fire per step
    path: number // 0 horizontal · 1 vertical · 2 radial · 3 spiral (as Spectra)
    loOct: number; hiOct: number
    snap: number // 0 free frequency .. 1 on the global scale
  }
  chord: {
    on: boolean; tap: number; gain: number; pan: number
    voices: number // 3..16 notes, spread across the octave range
    loOct: number; hiOct: number
    gamma: number // brightness contrast
    spread: number // stereo fan across the bank
    attack: number; release: number // swell / fade seconds
    tone: number // 0 sine … 1 brighter (soft-clip harmonics)
    // WAVES (as the Collage's Ring bank) : a travelling sine of level across the
    // notes; rate 0..1 (free Hz, or a division when synced : 0 free · 1 straight
    // · 2 triplet · 3 dotted)
    waves: number; wavesRate: number; wavesSync: number
    // NOISE : a smooth pink noise blended in (0 = the plain chord), a band on
    // each note riding its swell and its waves; AIR = the band width, from a
    // narrow pitched breath (0) to a wide pink wash (1).
    noise: number; air: number
  }
  // Collage : the films of a Collage source heard all at once (collageVoice.ts).
  // Each piece pans by its place in the frame and rings through a harmonic
  // resonator tuned to the key/scale by its distance from the centre (centre =
  // loOct's root, the frame's edge = hiOct's top). No tap : it hears the films.
  collage: {
    on: boolean; gain: number; pan: number
    reso: number // 0 = the plain films · 1 = only the resonances
    ring: number // how sharply each resonator rings (Q)
    bright: number // weight of the 2nd and 3rd harmonics
    width: number // stereo spread (0 = all centre · 1 = the frame's width)
    loOct: number; hiOct: number
    // RING BANK : a 48-band resonant filterbank on the whole voice,
    // its bands on the key / scale over loOct..hiOct. bank = wet (0 = the plain
    // voice, as before); bankSend = add it on top instead of crossfading.
    bank: number; bankSend: boolean
    decay: number // ring time 12 ms .. 10 s
    choke: boolean // false SUSTAIN (shape before the ring) · true CHOKE (after)
    cutoff: number; peak: number
    slope: number // 0 low-pass · 0.5 band-pass · 1 high-pass
    tone: number; tilt: number // −1..1
    waves: number; wavesRate: number; wavesSync: number
    noise: number; noiseRate: number; noiseSync: number
    detune: number // band wobble + random walk, the two sides opposite (stereo)
    voicing: number // 0 Clean · 1 SEM · 2 MS-20 · 3 Steiner · 4 K35
  }
  // Shared FX tail (send/return) : the whole mix feeds an analog delay → the
  // Quartz/Prism FDN reverb, ported from Essaim/Res. `send` scales the input.
  fx: {
    send: number
    // BBD delay
    dlyMix: number; dlyTime: number; dlyFb: number; dlyTone: number; dlyMode: number
    // reverb (shared)
    rvMode: number; rvMix: number; rvSize: number; rvDecay: number; rvDamp: number
    rvPre: number; rvMod: number; rvModRate: number; rvWidth: number; rvLocut: number; rvFreeze: boolean
    rvDiff: number; rvLowDamp: number // Quartz
    rvCross: number; rvLowMult: number; rvHighMult: number // Prism
  }
  // Per-voice DJ filter for the mixer page (one per voice, BY INDEX :
  // spectra·orbit·flow·events·raster·sstv·filter·chord·collage·signal). Signal is
  // appended at 9 so a saved session's channels stay on their voices; the UI
  // shows it before Chord all the same. 0.5 = bypass, <0.5
  // lowpass sweep, >0.5 highpass sweep. Volume is each voice's own `gain`.
  mixFilter: number[]
  taps: [SoniTap, SoniTap]
}

export function defaultSoniConfig(): SoniConfig {
  return {
    on: false,
    master: 0.8,
    sinkId: '',
    root: 0,
    rootOct: 3,
    scale: 'minor',
    spectra: { on: true, tap: 0, gain: 0.5, pan: 0, sweepOn: true, sweepHz: 0.25, sync: false, x: 0.5, path: 0, pace: 0, gamma: 1.8, breath: 0, loOct: 2, hiOct: 7, quantize: true },
    orbit: { on: false, tap: 0, gain: 0.5, pan: 0, note: 45, freq: 110, quantize: true, ratio: 1, cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, drive: 1, smooth: 0.5 },
    flow: { on: false, tap: 0, gain: 0.6, pan: 0, sense: 0.4, density: 0.5, dur: 0.09, noise: 0.15, colour: 0.6, loOct: 3, hiOct: 6, quantize: true },
    events: { on: false, tap: 0, gain: 0.6, pan: 0, mode: 'blend', sense: 0.5, density: 0.4, decay: 0.35, highs: 0.6, wave: 1, loOct: 3, hiOct: 6, quantize: true },
    raster: { on: false, tap: 0, gain: 0.4, pan: 0, note: 45, freq: 110, quantize: true, rx: 0.35, ry: 0.35, rw: 0.3, rh: 0.3, smooth: 0, tone: 0.6 },
    sstv: { on: false, tap: 0, gain: 0.4, pan: 0, lineHz: 12, sync: false, dev: 1, syncLev: 0.5 },
    filter: { on: false, tap: 0, gain: 0.6, pan: 0, q: 0.5, noise: 0.5, lineIn: false, loop: 0, sweepOn: false, sweepHz: 0.25, x: 0.5, gamma: 1.6, path: 0, pace: 0, loOct: 1, hiOct: 8, quantize: false },
    signal: { on: false, tap: 0, gain: 0.6, pan: 0, wave: 0, decay: 0.3, tone: 0.6, fm: 0.4, heads: 2, rate: 8, sync: false, steps: 16, spread: 0.5, thresh: 0.5, density: 0.35, path: 0, loOct: 4, hiOct: 8, snap: 1 },
    chord: { on: false, tap: 0, gain: 0.6, pan: 0, voices: 7, loOct: 2, hiOct: 6, gamma: 1.6, spread: 0.6, attack: 0.4, release: 0.8, tone: 0.3, waves: 0, wavesRate: 0.4, wavesSync: 0, noise: 0, air: 0.4 },
    collage: {
      on: false, gain: 0.7, pan: 0, reso: 0.5, ring: 0.5, bright: 0.5, width: 1, loOct: 2, hiOct: 6,
      bank: 0, bankSend: false, decay: 0.5, choke: false, cutoff: 1, peak: 0, slope: 0, tone: 0, tilt: 0,
      waves: 0, wavesRate: 0.5, wavesSync: 0, noise: 0, noiseRate: 0.5, noiseSync: 0, detune: 0, voicing: 0
    },
    fx: {
      send: 0,
      dlyMix: 0.35, dlyTime: 0.3, dlyFb: 0.35, dlyTone: 0.5, dlyMode: 1,
      rvMode: 0, rvMix: 0.6, rvSize: 0.6, rvDecay: 0.6, rvDamp: 0.3, rvPre: 20, rvMod: 6, rvModRate: 0.5,
      rvWidth: 1, rvLocut: 220, rvFreeze: false, rvDiff: 0.85, rvLowDamp: 0.5,
      rvCross: 0.3, rvLowMult: 1, rvHighMult: 1
    },
    mixFilter: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    taps: [{ kind: 'master', layer: 0 }, { kind: 'layer', layer: 0 }]
  }
}

const noteFreq = (n: number): number => 440 * Math.pow(2, (n - 69) / 12)
/** The quantizer root, shifted by the global root-octave (a whole-instrument
 *  transpose in octaves; rootOct 3 = no shift). Used by every scale-table build. */
const effRoot = (cfg: SoniConfig): number => cfg.root + 12 * ((cfg.rootOct ?? 3) - 3)

// Simple scalar mod targets : param → [voice sub-config, field]. These map
// directly onto a config field (unlike the probe positions / pitches, which have
// custom handling). Drives withSonifyParam, the base getter, and the tick overlay,
// so adding a modulatable param is one line here (+ a DESC + a chip in the UI).
const SONI_SIMPLE_MODS: Record<string, [keyof SoniConfig, string]> = {
  spectraGain: ['spectra', 'gain'], spectraGamma: ['spectra', 'gamma'], spectraSweep: ['spectra', 'sweepHz'], spectraBreath: ['spectra', 'breath'],
  orbitDrive: ['orbit', 'drive'], orbitSmooth: ['orbit', 'smooth'],
  flowDur: ['flow', 'dur'], flowColour: ['flow', 'colour'],
  eventsDecay: ['events', 'decay'],
  signalDecay: ['signal', 'decay'], signalTone: ['signal', 'tone'], signalFm: ['signal', 'fm'],
  signalRate: ['signal', 'rate'], signalSpread: ['signal', 'spread'], signalThresh: ['signal', 'thresh'],
  signalDensity: ['signal', 'density'], signalSnap: ['signal', 'snap'],
  rasterSmooth: ['raster', 'smooth'], rasterTone: ['raster', 'tone'],
  sstvLine: ['sstv', 'lineHz'], sstvDev: ['sstv', 'dev'],
  filterQ: ['filter', 'q'], filterSweep: ['filter', 'sweepHz'],
  chordTone: ['chord', 'tone'], chordSpread: ['chord', 'spread'], chordAttack: ['chord', 'attack'],
  collageReso: ['collage', 'reso'], collageRing: ['collage', 'ring'], collageWidth: ['collage', 'width'],
  collageBank: ['collage', 'bank'], collageDecay: ['collage', 'decay'], collageCutoff: ['collage', 'cutoff'],
  collageWaves: ['collage', 'waves'], collageDetune: ['collage', 'detune'], chordWaves: ['chord', 'waves'],
  chordNoise: ['chord', 'noise'], chordAir: ['chord', 'air'],
  fxSend: ['fx', 'send'], fxReverb: ['fx', 'rvMix'], fxDelay: ['fx', 'dlyMix']
}
const freqNote = (f: number): number => 69 + 12 * Math.log2(Math.max(1, f) / 440)

/** All scale frequencies from octave lo..hi (root-relative), ascending. */
function scaleTable(root: number, scale: SoniScale, loOct: number, hiOct: number): Float32Array {
  const steps = SCALE_STEPS[scale]
  const out: number[] = []
  for (let oct = loOct; oct <= hiOct; oct++) {
    for (const s of steps) out.push(noteFreq(12 * (oct + 1) + root + s))
  }
  return new Float32Array(out)
}

/** The Spectra bank's 96 partial frequencies : quantized (rows land on scale
 *  notes, repeated as needed) or a free log spread across the same span. */
function spectraFreqs(cfg: SoniConfig, sr: number): Float32Array {
  const { loOct, hiOct, quantize } = cfg.spectra
  const out = new Float32Array(96)
  if (quantize) {
    const tab = scaleTable(effRoot(cfg), cfg.scale, loOct, hiOct)
    for (let i = 0; i < 96; i++) out[i] = tab[Math.min(tab.length - 1, Math.floor((i / 96) * tab.length))]
  } else {
    const lo = noteFreq(12 * (loOct + 1) + effRoot(cfg))
    const hi = noteFreq(12 * (hiOct + 1) + effRoot(cfg))
    // Cap the top partials just below Nyquist : a raised root octave + a high
    // hiOct can push the free spread past sr/2, where it folds back as inharmonic
    // aliasing. Only the high end is clamped; in-range partials are untouched.
    const nyq = sr * 0.49
    for (let i = 0; i < 96; i++) out[i] = Math.min(lo * Math.pow(hi / lo, i / 95), nyq)
  }
  return out
}

/** The Chord bank's note frequencies : `voices` scale notes spread evenly from
 *  the lowest to the highest of the octave range (always scale-tuned). */
function chordFreqs(cfg: SoniConfig): Float32Array {
  const tab = scaleTable(effRoot(cfg), cfg.scale, cfg.chord.loOct, cfg.chord.hiOct)
  const N = Math.max(1, Math.min(16, cfg.chord.voices | 0))
  const out = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    out[i] = tab[Math.min(tab.length - 1, Math.round((i * (tab.length - 1)) / Math.max(1, N - 1)))]
  }
  return out
}

/** The Filter voice's 48 band-centre frequencies : quantized to the scale
 *  (a resonant harmonic wash) or a plain log spread 80Hz..8kHz. */
function filterFreqs(cfg: SoniConfig): Float32Array {
  const out = new Float32Array(48)
  if (cfg.filter.quantize) {
    const tab = scaleTable(effRoot(cfg), cfg.scale, cfg.filter.loOct, cfg.filter.hiOct)
    for (let i = 0; i < 48; i++) out[i] = tab[Math.min(tab.length - 1, Math.floor((i / 48) * tab.length))]
  } else {
    for (let i = 0; i < 48; i++) out[i] = 80 * Math.pow(100, i / 47)
  }
  return out
}

/** The Collage Ring bank's 48 band centres : evenly spread in pitch from the
 *  bottom of loOct to the top of hiOct (one per semitone over the default four
 *  octaves), each snapped to the nearest note of the scale. Notes
 *  shared by several bands are kept : they ring louder, which is the scale. */
export function ringFreqs(cfg: SoniConfig): Float32Array {
  const lo = cfg.collage.loOct, hi = Math.max(cfg.collage.loOct + 1, cfg.collage.hiOct)
  const tab = scaleTable(effRoot(cfg), cfg.scale, lo, hi)
  const out = new Float32Array(48)
  if (!tab.length) return out.fill(220)
  const m0 = freqNote(tab[0]), m1 = freqNote(tab[tab.length - 1])
  for (let b = 0; b < 48; b++) {
    const f = noteFreq(m0 + ((m1 - m0) * b) / 47)
    let best = tab[0]
    for (const t of tab) if (Math.abs(Math.log(t / f)) < Math.abs(Math.log(best / f))) best = t
    out[b] = best
  }
  return out
}

/** Apply one sonify mod-param (REAL units, see SONIFY_MOD_DESCS) onto a config
 *  immutably — shared by the Meta-knob settle path and the OSC endpoints. */
export function withSonifyParam(c: SoniConfig, param: string, v: number): SoniConfig {
  const simple = SONI_SIMPLE_MODS[param]
  if (simple) {
    const [voice, field] = simple
    return { ...c, [voice]: { ...(c[voice] as Record<string, unknown>), [field]: v } } as SoniConfig
  }
  switch (param) {
    case 'spectraX': return { ...c, spectra: { ...c.spectra, x: v } }
    case 'filterX': return { ...c, filter: { ...c.filter, x: v } }
    case 'orbitX': return { ...c, orbit: { ...c.orbit, cx: v } }
    case 'orbitY': return { ...c, orbit: { ...c.orbit, cy: v } }
    case 'orbitR': return { ...c, orbit: { ...c.orbit, rx: v, ry: v } }
    case 'orbitPitch':
      return c.orbit.quantize
        ? { ...c, orbit: { ...c.orbit, note: Math.round(v) } }
        : { ...c, orbit: { ...c.orbit, freq: noteFreq(v) } }
    case 'rasterX': return { ...c, raster: { ...c.raster, rx: v } }
    case 'rasterY': return { ...c, raster: { ...c.raster, ry: v } }
    case 'rasterW': return { ...c, raster: { ...c.raster, rw: v } }
    case 'rasterH': return { ...c, raster: { ...c.raster, rh: v } }
    case 'rasterPitch':
      return c.raster.quantize
        ? { ...c, raster: { ...c.raster, note: Math.round(v) } }
        : { ...c, raster: { ...c.raster, freq: noteFreq(v) } }
    default: return c
  }
}

/** Where the scanning voices really are, from the worklet (~10 Hz) : positions
 *  0..1 and their effective rates (cycles/s, sync and modulation included), so
 *  the page's overlay draws what you hear. */
export interface SoniScan {
  recv: number // performance.now() when it arrived
  sp: number; spHz: number // Spectra sweep
  fi: number; fiHz: number // Filter sweep
  tv: number; tvHz: number // Transmission row
}

interface GridReader {
  readSonifyGrid: (kind: 'master' | 'layer', layer: number, out: Uint8Array) => boolean
  collageSounds?: () => CollageSoundSet[]
}

class SonifyEngine {
  private ctx: AudioContext | null = null
  private ctxReady: Promise<AudioContext> | null = null
  private node: AudioWorkletNode | null = null
  private recDest: MediaStreamAudioDestinationNode | null = null
  // THE SOUND BUS for recordings : a take holds Sonify's audio context open
  // (bus > 0) so its sound track lives for the whole take, Sonify on or off,
  // and a DXV3 take reads the sound as PCM through the tap.
  private bus = 0
  private warm = false // keepWarm : the context stays open between takes and plays
  // Self-healing (heal()) : a device error or a stalled clock rebuilds the context.
  private healing = false
  private healAfterTake = false // a rebuild waits for the take holding the bus
  private watchTimer = 0
  private lastClock = -1
  private tap: AudioWorkletNode | null = null
  private tapSink: GainNode | null = null
  private tapFlush: (() => void) | null = null
  private cfg: SoniConfig = defaultSoniConfig()
  private starting = false
  private lineSrc: MediaStreamAudioSourceNode | null = null
  private lineStream: MediaStream | null = null
  private lineWanted = false
  private lineReq = 0 // the latest line-in request (an older one resolving late is dropped)
  private lastTick = 0
  private bpm = 120 // the tempo, for the synced modulation rates (sent with the mod overlay)
  private lastFrameAt = [0, 0]
  private tapKey = ['', ''] // what each tap read last (a new source = no motion against the old)
  // The Collage voice : a native graph (players + per-piece resonators) into the
  // worklet's second input, alive while the voice is on.
  private collage: CollageVoice | null = null
  private collageNotes: Float32Array = new Float32Array(0)
  // Key glide (the key sequencer) : the next config's pitches slide over this
  // many seconds instead of jumping (one shot, see glideNext). The worklet glides
  // its own tables; the Collage resonators' notes glide here.
  private glideOnce = 0
  private colFrom: Float32Array | null = null
  private colT0 = 0
  private colDur = 0
  private colNow = new Float32Array(0)
  // luma grids per tap : cur + prev (for flow), plus the RGBA readback scratch
  private rgba = new Uint8Array(GRID * GRID * 4)
  private luma: Uint8Array[] = [new Uint8Array(GRID * GRID), new Uint8Array(GRID * GRID)]
  private lumaPrev: Uint8Array[] = [new Uint8Array(GRID * GRID), new Uint8Array(GRID * GRID)]
  private grainFreqs: Float32Array = new Float32Array(0)
  private eventFreqs: Float32Array = new Float32Array(0)
  private signalFreqs: Float32Array = new Float32Array(0)
  // Signal's step clock, in steps. A double, so it stays exact for weeks of
  // show time at any rate : no wrap to beat against the heads' sweep lengths.
  private sigClock = 0
  // Synced : the shared beat clock at the last scan (-1 : free, or just
  // switched on, so the next synced scan re-anchors on the bar).
  private sigBeats = -1
  // Each head's place on its own sweep. Kept per head rather than derived
  // from the clock, so a sweep length that changes (SPREAD under a modulator)
  // moves a head on from where it is instead of throwing it across the frame.
  private sigIdx = [0, 0, 0, 0]
  private sigRead = { x: 0, y: 0 } // scratch for the path geometry
  private salience = new Float32Array(GRID * GRID) // Events detection scratch
  // live meter (UI reads these; written from the worklet's meter messages)
  meterPeak = 0
  meterLim = 1
  /** Per channel, after the limiter, over the last ~100 ms : peak and RMS (linear). */
  meterL = { peak: 0, rms: 0 }
  meterR = { peak: 0, rms: 0 }
  // live flow vectors for the overlay ([x01,y01,mag] × n)
  flowDots: Float32Array = new Float32Array(0)
  // live event onsets for the overlay ([x01,y01,mag] × n), fade painted by the UI
  eventDots: Float32Array = new Float32Array(0)
  // Signal, for the overlay : the marks fired this frame ([x01,y01,mag] × n) and
  // each head's read bar as it stands ([x0,y0,x1,y1] × heads).
  signalDots: Float32Array = new Float32Array(0)
  signalBars: Float32Array = new Float32Array(0)
  // effective probe values (base + modulation), for the page overlay
  liveProbes: Record<string, number> = {}
  scan: SoniScan | null = null

  constructor() {
    // The mod-matrix swings around each param's BASE : the current config.
    registerSonifyModBase((param) => {
      const c = this.cfg
      const simple = SONI_SIMPLE_MODS[param]
      if (simple) { const [voice, field] = simple; return (c[voice] as unknown as Record<string, number>)[field] }
      switch (param) {
        case 'spectraX': return c.spectra.x
        case 'filterX': return c.filter.x
        case 'orbitX': return c.orbit.cx
        case 'orbitY': return c.orbit.cy
        case 'orbitR': return c.orbit.rx
        case 'orbitPitch': return c.orbit.quantize ? c.orbit.note : freqNote(c.orbit.freq)
        case 'rasterX': return c.raster.rx
        case 'rasterY': return c.raster.ry
        case 'rasterW': return c.raster.rw
        case 'rasterH': return c.raster.rh
        case 'rasterPitch': return c.raster.quantize ? c.raster.note : freqNote(c.raster.freq)
        default: return undefined
      }
    })
  }

  isRunning(): boolean { return !!this.node }

  /** The Collage voice's live state for the page (walls heard, pieces, films). */
  collageStatus(): { sets: number; pieces: number; films: number } | null {
    return this.collage ? { ...this.collage.status } : null
  }

  /** The recorder mixes this stream's audio track into captures (null = off). */
  recordStream(): MediaStream | null { return this.recDest?.stream ?? null }

  /** The audio context, its worklet module and the recording destination,
   *  created once and shared by the sound and by a recording's sound bus. */
  private ensureCtx(): Promise<AudioContext> {
    if (this.ctxReady) return this.ctxReady
    this.ctxReady = (async (): Promise<AudioContext> => {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      try {
        await ctx.audioWorklet.addModule(SONI_WORKLET_URL)
      } catch (e) {
        void ctx.close().catch(() => {}) // never leak a context (one per retry)
        this.ctxReady = null
        throw e
      }
      this.recDest = ctx.createMediaStreamDestination()
      // A constant silent source keeps the recording track delivering samples
      // while nothing plays : with no input it delivered NONE, and the video
      // recorder then waited for sound (a take with Sonify off saved nothing) or
      // closed the gaps up (the sound slid out of sync with the picture).
      const hush = ctx.createConstantSource()
      hush.offset.value = 0
      hush.connect(this.recDest)
      hush.start()
      this.ctx = ctx
      if (this.cfg.sinkId) this.applySink(this.cfg.sinkId)
      // An audio device error (an interface unplugged, the default output
      // switched, a driver hiccup) can leave the context closed, suspended or
      // silently stalled. Kept open for days now, it must heal by itself.
      ctx.addEventListener('error', () => void this.heal('the audio device reported an error'))
      ctx.addEventListener('statechange', () => {
        if (this.ctx !== ctx) return
        if (ctx.state === 'closed') void this.heal('the audio context closed')
        else if (ctx.state === 'suspended' && this.wanted()) window.setTimeout(() => {
          if (this.ctx === ctx && ctx.state === 'suspended') void this.heal('the audio context was suspended')
        }, 1500)
      })
      this.lastClock = -1
      window.clearInterval(this.watchTimer)
      this.watchTimer = window.setInterval(() => this.watch(), 5000)
      return ctx
    })()
    return this.ctxReady
  }

  /** Is the context supposed to be running (the sound, a take, or kept warm)? */
  private wanted(): boolean {
    return !!this.node || this.bus > 0 || this.warm
  }

  /** Every 5 s : a running context whose clock no longer moves is stalled (a
   *  device can die without any event). */
  private watch(): void {
    const ctx = this.ctx
    if (!ctx || !this.wanted() || this.healing) return
    const t = ctx.currentTime
    if (ctx.state === 'running' && this.lastClock >= 0 && t <= this.lastClock) void this.heal('the audio clock stopped')
    this.lastClock = t
  }

  /** Bring the sound back after a device problem : resume first, and if the
   *  clock still does not run, rebuild the context and restart the sound on it.
   *  Never during a take (its sound track belongs to this context) : then once
   *  the take ends. */
  private async heal(why: string): Promise<void> {
    const ctx = this.ctx
    if (!ctx || this.healing || !this.wanted()) return
    this.healing = true
    try {
      console.warn('[sonify] audio trouble :', why)
      if (ctx.state !== 'closed') {
        await ctx.resume().catch(() => {})
        const t0 = ctx.currentTime
        await new Promise((r) => window.setTimeout(r, 400))
        if (this.ctx === ctx && ctx.state === 'running' && ctx.currentTime > t0) {
          console.warn('[sonify] the audio is back (resumed)')
          return
        }
      }
      if (this.bus > 0) {
        this.healAfterTake = true
        return
      }
      await this.rebuild()
    } finally {
      this.healing = false
    }
  }

  /** A fresh context, and the sound restarted on it if it was playing. */
  private async rebuild(): Promise<void> {
    const wasOn = !!this.node
    this.collage?.dispose()
    this.collage = null
    try { this.node?.disconnect() } catch { /* gone */ }
    this.node = null
    window.clearInterval(this.watchTimer)
    this.closeCtx()
    try {
      if (wasOn) await this.start()
      else await this.ensureCtx()
      if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume().catch(() => {})
      console.warn('[sonify] the audio is back (a new context)')
    } catch (e) {
      console.warn('[sonify] the audio could not come back yet', e)
    }
  }

  async start(): Promise<void> {
    if (this.node || this.starting) return
    this.starting = true
    try {
      const ctx = await this.ensureCtx()
      // Input 0 : the Filter voice's line-in. Input 1 : the Collage voice's films.
      const node = new AudioWorkletNode(ctx, 'soni', { numberOfInputs: 2, outputChannelCount: [2] })
      node.port.onmessage = (e): void => {
        const m = e.data
        if (m?.t === 'meter') {
          this.meterPeak = m.peak
          this.meterLim = m.lim
          if (typeof m.rmsL === 'number') {
            this.meterL = { peak: m.pkL, rms: m.rmsL }
            this.meterR = { peak: m.pkR, rms: m.rmsR }
          }
          if (m.scan) this.scan = { ...m.scan, recv: performance.now() }
        }
      }
      node.connect(ctx.destination)
      if (this.recDest) node.connect(this.recDest)
      if (this.tap) node.connect(this.tap)
      this.node = node
      this.pushConfig(this.cfg)
      if (ctx.state !== 'running') await ctx.resume()
    } catch (e) {
      console.error('[sonify] start failed', e)
      this.stop()
    } finally {
      this.starting = false
    }
  }

  /** A recording holds the sound bus for its take : the context (and its sound
   *  track) stays alive while Sonify comes and goes. Returns the track's stream. */
  async holdRecordBus(): Promise<MediaStream | null> {
    this.bus++
    try {
      const ctx = await this.ensureCtx()
      if (ctx.state !== 'running') await ctx.resume().catch(() => {})
      // Wait (up to a second) for the audio clock to actually run : a recorder
      // started on a context that hasn't produced samples yet waits for them,
      // and a short first take after launch came out empty.
      const t0 = ctx.currentTime
      const until = performance.now() + 1000
      while (ctx.currentTime <= t0 + 0.05 && performance.now() < until) await new Promise((r) => window.setTimeout(r, 20))
      return this.recDest?.stream ?? null
    } catch (e) {
      console.warn('[sonify] no sound bus for the recording', e)
      this.bus = Math.max(0, this.bus - 1)
      return null
    }
  }

  /** The take ended : let the context go if the sound is off too (unless it is
   *  kept warm). */
  releaseRecordBus(): void {
    this.bus = Math.max(0, this.bus - 1)
    if (this.bus === 0 && this.healAfterTake) {
      this.healAfterTake = false
      void this.rebuild()
      return
    }
    if (this.bus === 0 && !this.node && !this.starting && !this.warm) this.closeCtx()
  }

  /** Open the audio context now and keep it running for the rest of the session,
   *  silent while nothing plays, instead of closing it whenever the sound and the
   *  recordings stop. A sound card left idle for a few seconds goes to sleep, and
   *  waking it held the audio clock still for up to 3 s (measured, Electron 44) :
   *  every take after a pause started a second late, and Sonify was slow to
   *  sound. Opened with no output device the clock starts in 0.26 s, but routing
   *  it to the speakers mid-take stalls it for that long instead, and the take's
   *  sound would slide out of sync : so the card is simply kept awake. */
  async keepWarm(): Promise<void> {
    this.warm = true
    try {
      const ctx = await this.ensureCtx()
      if (ctx.state !== 'running') await ctx.resume().catch(() => {})
    } catch (e) {
      this.warm = false
      console.warn('[sonify] could not open the audio context', e)
    }
  }

  /** The bus's sample rate (0 = no bus). */
  get busRate(): number {
    return this.ctx?.sampleRate ?? 0
  }

  /** Start sending the sound as 16-bit stereo PCM chunks (a DXV3 take). */
  startTap(onPcm: (pcm: ArrayBuffer) => void): boolean {
    const ctx = this.ctx
    if (!ctx) return false
    try {
      if (!this.tap) {
        this.tap = new AudioWorkletNode(ctx, 'soni-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
        // Kept pulled by the graph (a node nothing listens to may not run).
        this.tapSink = ctx.createGain()
        this.tapSink.gain.value = 0
        this.tap.connect(this.tapSink).connect(ctx.destination)
        if (this.node) this.node.connect(this.tap)
      }
      this.tap.port.onmessage = (e): void => {
        const m = e.data as { t: string; buf: ArrayBuffer; last?: boolean }
        if (m?.t !== 'pcm') return
        if (m.buf.byteLength) onPcm(m.buf)
        if (m.last) { this.tapFlush?.(); this.tapFlush = null }
      }
      this.tap.port.postMessage({ t: 'tap', on: true })
      return true
    } catch (e) {
      console.warn('[sonify] recording tap', e)
      return false
    }
  }

  /** Stop the tap; resolves once its last chunk has been handed over. */
  stopTap(): Promise<void> {
    const tap = this.tap
    if (!tap) return Promise.resolve()
    return new Promise<void>((res) => {
      const t = window.setTimeout(() => { this.tapFlush = null; res() }, 500)
      this.tapFlush = (): void => { window.clearTimeout(t); res() }
      tap.port.postMessage({ t: 'tap', on: false })
    })
  }

  private closeCtx(): void {
    window.clearInterval(this.watchTimer)
    try { this.tap?.disconnect(); this.tapSink?.disconnect() } catch { /* already gone */ }
    this.tap = null
    this.tapSink = null
    this.recDest = null
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.ctxReady = null
  }

  /** Silence and release everything for good (a dev hot update replacing this
   *  engine : see the end of this file). */
  shutdown(): void {
    this.warm = false
    this.bus = 0
    this.healAfterTake = false
    this.stop()
    this.closeCtx()
  }

  stop(): void {
    this.collage?.dispose()
    this.collage = null
    this.lineSrc?.disconnect()
    this.lineSrc = null
    this.lineStream?.getTracks().forEach((t) => t.stop())
    this.lineStream = null
    // forget the line-in : the next start must open it again (it used to think
    // it was still open and the Filter voice came back nearly silent)
    this.lineWanted = false
    this.lineReq++
    this.node?.disconnect()
    this.node = null
    this.meterPeak = 0
    this.meterL = { peak: 0, rms: 0 }
    this.meterR = { peak: 0, rms: 0 }
    this.flowDots = new Float32Array(0)
    this.scan = null
    // A recording holding the sound bus keeps the context (and its sound track)
    // alive; it plays silence until the sound comes back.
    if (this.bus === 0 && !this.warm) this.closeCtx()
  }

  private applySink(sinkId: string): void {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
    if (ctx?.setSinkId) ctx.setSinkId(sinkId).catch((e) => console.warn('[sonify] setSinkId', e))
  }

  /** The next pushConfig's pitch change slides over `sec` seconds (the key
   *  sequencer sets it around its own key change, then clears it). */
  glideNext(sec: number): void {
    this.glideOnce = Math.max(0, Math.min(8, sec || 0))
  }

  /** The Collage resonators' notes now : the table, or mid-glide toward it. */
  private collageNotesNow(): Float32Array {
    const from = this.colFrom, to = this.collageNotes
    if (!from) return to
    const u = (performance.now() - this.colT0) / this.colDur
    if (u >= 1 || from.length !== to.length) { this.colFrom = null; return to }
    const e = u * u * (3 - 2 * u)
    if (this.colNow.length !== to.length) this.colNow = new Float32Array(to.length)
    for (let i = 0; i < to.length; i++) this.colNow[i] = from[i] * Math.pow(to[i] / from[i], e)
    return this.colNow
  }

  pushConfig(cfg: SoniConfig): void {
    // Deep-fill against the defaults so no voice — or voice FIELD — is ever
    // missing (old localStorage / sessions / scenes / presets saved before a
    // voice or param existed). A partial config used to silence the whole engine
    // (a missing voice threw; a missing field went NaN).
    const d = defaultSoniConfig()
    cfg = {
      ...d, ...cfg,
      spectra: { ...d.spectra, ...cfg.spectra },
      orbit: { ...d.orbit, ...cfg.orbit },
      flow: { ...d.flow, ...cfg.flow },
      events: { ...d.events, ...cfg.events },
      raster: { ...d.raster, ...cfg.raster },
      sstv: { ...d.sstv, ...cfg.sstv },
      filter: { ...d.filter, ...cfg.filter },
      signal: { ...d.signal, ...cfg.signal },
      chord: { ...d.chord, ...cfg.chord },
      collage: { ...d.collage, ...cfg.collage },
      fx: { ...d.fx, ...cfg.fx },
      // Older presets/scenes carried 7 (pre-Chord), 8 (pre-Collage) or 9
      // (pre-Signal) entries : keep their filter positions and pad the newer
      // channels to bypass (0.5) instead of discarding the whole array. Any
      // other shape → default.
      mixFilter:
        Array.isArray(cfg.mixFilter) && cfg.mixFilter.length >= 7 && cfg.mixFilter.length <= 10
          ? [...cfg.mixFilter, 0.5, 0.5, 0.5].slice(0, 10)
          : d.mixFilter
    }
    const sinkChanged = cfg.sinkId !== this.cfg.sinkId
    this.cfg = cfg
    const glide = this.glideOnce
    this.glideOnce = 0
    if (!this.node) return
    if (sinkChanged) this.applySink(cfg.sinkId)
    // grain pitch table for the flow voice
    this.grainFreqs = cfg.flow.quantize
      ? scaleTable(effRoot(cfg), cfg.scale, cfg.flow.loOct, cfg.flow.hiOct)
      : new Float32Array(0)
    // the Collage resonators' notes : centre = the lowest, the frame's edge = the
    // highest. A glide starts from where they are now; a table re-sent unchanged
    // (any slider move re-sends it) leaves a glide running.
    const notes = scaleTable(effRoot(cfg), cfg.scale, cfg.collage.loOct, Math.max(cfg.collage.loOct + 1, cfg.collage.hiOct))
    const sameNotes = notes.length === this.collageNotes.length && notes.every((f, i) => f === this.collageNotes[i])
    if (!sameNotes) {
      if (glide > 0 && notes.length === this.collageNotes.length && notes.length) {
        this.colFrom = Float32Array.from(this.collageNotesNow())
        this.colT0 = performance.now()
        this.colDur = glide * 1000
      } else this.colFrom = null
      this.collageNotes = notes
    }
    // Signal's scale table. Built whatever `snap` says : snap BLENDS the free
    // frequency with this one, so the quantized end must always exist.
    this.signalFreqs = scaleTable(effRoot(cfg), cfg.scale, cfg.signal.loOct, cfg.signal.hiOct)
    // note pitch table for the events voice
    this.eventFreqs = cfg.events.quantize
      ? scaleTable(effRoot(cfg), cfg.scale, cfg.events.loOct, cfg.events.hiOct)
      : new Float32Array(0)
    this.node.port.postMessage({
      t: 'cfg',
      cfg: {
        master: cfg.master,
        spectra: {
          on: cfg.spectra.on, tap: cfg.spectra.tap, gain: cfg.spectra.gain, pan: cfg.spectra.pan,
          sweepOn: cfg.spectra.sweepOn, sweepHz: cfg.spectra.sweepHz, x: cfg.spectra.x, gamma: cfg.spectra.gamma,
          breath: cfg.spectra.breath ?? 0, path: cfg.spectra.path ?? 0, pace: cfg.spectra.pace ?? 0
        },
        orbit: {
          on: cfg.orbit.on, tap: cfg.orbit.tap, gain: cfg.orbit.gain, pan: cfg.orbit.pan,
          freq: cfg.orbit.quantize
            ? (this.snapNote(cfg.orbit.note))
            : cfg.orbit.freq,
          ratio: cfg.orbit.ratio, cx: cfg.orbit.cx, cy: cfg.orbit.cy, rx: cfg.orbit.rx, ry: cfg.orbit.ry,
          drive: cfg.orbit.drive, smooth: cfg.orbit.smooth
        },
        flow: {
          on: cfg.flow.on, tap: cfg.flow.tap, gain: cfg.flow.gain, pan: cfg.flow.pan,
          dur: cfg.flow.dur, noise: cfg.flow.noise, colour: cfg.flow.colour ?? 0
        },
        events: {
          on: cfg.events.on, gain: cfg.events.gain, pan: cfg.events.pan,
          wave: cfg.events.wave, decay: cfg.events.decay, highs: cfg.events.highs
        },
        raster: {
          on: cfg.raster.on, tap: cfg.raster.tap, gain: cfg.raster.gain, pan: cfg.raster.pan,
          freq: cfg.raster.quantize ? this.snapNote(cfg.raster.note) : cfg.raster.freq,
          rx: cfg.raster.rx, ry: cfg.raster.ry, rw: cfg.raster.rw, rh: cfg.raster.rh,
          smooth: cfg.raster.smooth, tone: cfg.raster.tone ?? 0.6
        },
        sstv: {
          on: cfg.sstv.on, tap: cfg.sstv.tap, gain: cfg.sstv.gain, pan: cfg.sstv.pan,
          lineHz: cfg.sstv.lineHz, dev: cfg.sstv.dev, syncLev: cfg.sstv.syncLev
        },
        filter: {
          on: cfg.filter.on, tap: cfg.filter.tap, gain: cfg.filter.gain, pan: cfg.filter.pan,
          q: cfg.filter.q, noise: cfg.filter.lineIn ? cfg.filter.noise * 0.25 : cfg.filter.noise,
          sweepOn: cfg.filter.sweepOn, sweepHz: cfg.filter.sweepHz, x: cfg.filter.x, gamma: cfg.filter.gamma,
          path: cfg.filter.path ?? 0, pace: cfg.filter.pace ?? 0, loop: cfg.filter.loop ?? 0
        },
        signal: {
          on: cfg.signal.on, gain: cfg.signal.gain, pan: cfg.signal.pan,
          wave: cfg.signal.wave, decay: cfg.signal.decay, tone: cfg.signal.tone, fm: cfg.signal.fm
        },
        chord: {
          on: cfg.chord.on, tap: cfg.chord.tap, gain: cfg.chord.gain, pan: cfg.chord.pan,
          gamma: cfg.chord.gamma, spread: cfg.chord.spread, attack: cfg.chord.attack,
          release: cfg.chord.release, tone: cfg.chord.tone,
          waves: cfg.chord.waves, wavesRate: cfg.chord.wavesRate, wavesSync: cfg.chord.wavesSync,
          noise: cfg.chord.noise, air: cfg.chord.air
        },
        collage: {
          on: cfg.collage.on, gain: cfg.collage.gain, pan: cfg.collage.pan,
          bank: cfg.collage.bank, bankSend: cfg.collage.bankSend, decay: cfg.collage.decay, choke: cfg.collage.choke,
          cutoff: cfg.collage.cutoff, peak: cfg.collage.peak, slope: cfg.collage.slope, tone: cfg.collage.tone,
          tilt: cfg.collage.tilt, waves: cfg.collage.waves, wavesRate: cfg.collage.wavesRate, wavesSync: cfg.collage.wavesSync,
          noise: cfg.collage.noise, noiseRate: cfg.collage.noiseRate, noiseSync: cfg.collage.noiseSync,
          detune: cfg.collage.detune, voicing: cfg.collage.voicing
        },
        fx: { ...cfg.fx },
        mixFilter: cfg.mixFilter
      },
      spectraFreqs: spectraFreqs(cfg, this.ctx?.sampleRate ?? 48000),
      filterFreqs: filterFreqs(cfg),
      chordFreqs: chordFreqs(cfg),
      ringFreqs: ringFreqs(cfg),
      glide
    })
    // The config replaced the worklet's whole state, modulation included :
    // put the modulated values straight back (waiting for the next tick left a
    // modulated pitch or probe snapping to its base for up to 50 ms on every
    // slider move, OSC message and sequencer step).
    if (cfg.on) this.postMod()
    this.syncLineIn(cfg.filter.on && cfg.filter.lineIn)
  }

  /** Open/close the line-in tap for the Filter voice (mic/line via WebRTC). */
  private syncLineIn(want: boolean): void {
    if (want === this.lineWanted) return
    this.lineWanted = want
    const req = ++this.lineReq
    if (!want) {
      this.lineSrc?.disconnect()
      this.lineSrc = null
      this.lineStream?.getTracks().forEach((t) => t.stop())
      this.lineStream = null
      return
    }
    const ctx = this.ctx
    if (!ctx || !this.node) return
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((stream) => {
        if (req !== this.lineReq || !this.lineWanted || !this.ctx || !this.node) { stream.getTracks().forEach((t) => t.stop()); return }
        // never two mics summed into the Filter : anything still open goes first
        this.lineSrc?.disconnect()
        this.lineStream?.getTracks().forEach((t) => t.stop())
        this.lineStream = stream
        this.lineSrc = this.ctx.createMediaStreamSource(stream)
        this.lineSrc.connect(this.node)
      })
      .catch((e) => console.warn('[sonify] line-in unavailable, noise only', e))
  }

  /** Snap the orbit's note number onto the active scale, return Hz. Includes the
   *  global root-octave transpose (the octave half of effRoot) so Orbit/Raster
   *  ride the root octave with every other voice (rootOct 3 = no shift). */
  private snapNote(note: number): number {
    const steps = SCALE_STEPS[this.cfg.scale]
    const rel = ((note - this.cfg.root) % 12 + 12) % 12
    let best = steps[0], bd = 99
    for (const s of steps) { const d = Math.abs(s - rel); if (d < bd) { bd = d; best = s } }
    return noteFreq(note - rel + best + 12 * ((this.cfg.rootOct ?? 3) - 3))
  }

  /** Probe modulation overlay : ship the EFFECTIVE probe values (base +
   *  whatever the mod-matrix / Meta knobs wrote this frame), every tick and
   *  right after every config. Always sent, so releasing a modulator reverts to
   *  the base cleanly. Guarded so a modulation hiccup can NEVER stop the
   *  grid-send (which would silence every voice : they all read the same taps). */
  private postMod(): void {
    const node = this.node
    if (!node) return
    try {
      const mv = sonifyModValues
      const g = (k: string, base: number): number => mv.get(k) ?? base
      const c = this.cfg
      const oPitch = mv.get('orbitPitch')
      const rPitch = mv.get('rasterPitch')
      const m = {
        spectra: { x: g('spectraX', c.spectra.x) },
        filter: { x: g('filterX', c.filter.x) },
        orbit: {
          cx: g('orbitX', c.orbit.cx), cy: g('orbitY', c.orbit.cy),
          rx: g('orbitR', c.orbit.rx), ry: g('orbitR', c.orbit.ry),
          freq: oPitch !== undefined
            ? (c.orbit.quantize ? this.snapNote(Math.round(oPitch)) : noteFreq(oPitch))
            : (c.orbit.quantize ? this.snapNote(c.orbit.note) : c.orbit.freq)
        },
        raster: {
          rx: g('rasterX', c.raster.rx), ry: g('rasterY', c.raster.ry),
          rw: g('rasterW', c.raster.rw), rh: g('rasterH', c.raster.rh),
          freq: rPitch !== undefined
            ? (c.raster.quantize ? this.snapNote(Math.round(rPitch)) : noteFreq(rPitch))
            : (c.raster.quantize ? this.snapNote(c.raster.note) : c.raster.freq)
        }
      }
      // Simple scalar mods : always send the EFFECTIVE value (mod or base), so
      // releasing a modulator reverts cleanly. The worklet merges these onto its
      // live cfg (voice renders read them per-block; fx re-applies, see applyFx).
      const mm = m as unknown as Record<string, Record<string, number>>
      for (const param in SONI_SIMPLE_MODS) {
        const [voice, field] = SONI_SIMPLE_MODS[param]
        const vc = c[voice] as unknown as Record<string, number> | undefined
        const base = vc ? vc[field] : undefined
        if (typeof base !== 'number') continue // defensive : partial config → skip
        ;(mm[voice] ??= {})[field] = g(param, base)
      }
      node.port.postMessage({ t: 'mod', m, bpm: this.bpm })
      this.liveProbes = {
        spectraX: m.spectra.x, filterX: m.filter.x,
        orbitX: m.orbit.cx, orbitY: m.orbit.cy, orbitR: m.orbit.rx, orbitRY: m.orbit.ry,
        rasterX: m.raster.rx, rasterY: m.raster.ry, rasterW: m.raster.rw, rasterH: m.raster.rh
      }
    } catch (e) {
      console.error('[sonify] mod overlay skipped', e)
    }
  }

  /** Per-frame pump : read the active taps from the compositor, ship grids to
   *  the worklet, run flow analysis. Call from the App loop AFTER render().
   *  Throttled to ~30Hz. */
  tick(comp: GridReader, nowMs: number, bpm: number): void {
    this.bpm = bpm > 0 ? bpm : 120
    const node = this.node
    if (!node || !this.cfg.on) {
      if (this.collage) { this.collage.dispose(); this.collage = null }
      return
    }
    // ~30 Hz. (33 against a two-frame period of 33.3 ms at 60 Hz let frame
    // jitter skip to every third frame : an uneven 24..30 Hz.)
    if (nowMs - this.lastTick < 30) return
    const dt = Math.min(0.1, (nowMs - this.lastTick) / 1000)
    this.lastTick = nowMs

    // Collage voice : follow every Collage wall's films and pieces. Off = the
    // whole graph goes (its players stop decoding).
    try {
      if (this.cfg.collage.on && this.ctx) {
        if (!this.collage) {
          this.collage = new CollageVoice(this.ctx)
          this.collage.bus.connect(node, 0, 1)
        }
        const mv = sonifyModValues
        const c = this.cfg.collage
        this.collage.update(comp.collageSounds?.() ?? [], {
          reso: mv.get('collageReso') ?? c.reso,
          ring: mv.get('collageRing') ?? c.ring,
          bright: c.bright,
          width: mv.get('collageWidth') ?? c.width
        }, this.collageNotesNow())
      } else if (this.collage) {
        this.collage.dispose()
        this.collage = null
      }
    } catch (e) {
      console.warn('[sonify] collage voice', e)
    }

    // BPM-synced sweep : re-derive sweepHz continuously so tap-tempo follows.
    if (this.cfg.spectra.sync && this.cfg.spectra.on) {
      const barsPerSweep = 1 // one sweep per bar
      const hz = bpm / 60 / 4 / barsPerSweep
      if (Math.abs(hz - this.cfg.spectra.sweepHz) > 1e-4) {
        this.cfg.spectra.sweepHz = hz
        this.pushConfig(this.cfg)
      }
    }

    // SSTV sync : one scan line per 16th note, following tap-tempo live.
    if (this.cfg.sstv.sync && this.cfg.sstv.on) {
      const hz = (bpm / 60) * 4
      if (Math.abs(hz - this.cfg.sstv.lineHz) > 1e-3) {
        this.cfg.sstv.lineHz = hz
        this.pushConfig(this.cfg)
      }
    }

    this.postMod()

    const need = [false, false]
    if (this.cfg.spectra.on) need[this.cfg.spectra.tap] = true
    if (this.cfg.orbit.on) need[this.cfg.orbit.tap] = true
    if (this.cfg.flow.on) need[this.cfg.flow.tap] = true
    if (this.cfg.events.on) need[this.cfg.events.tap] = true
    if (this.cfg.raster.on) need[this.cfg.raster.tap] = true
    if (this.cfg.sstv.on) need[this.cfg.sstv.tap] = true
    if (this.cfg.filter.on) need[this.cfg.filter.tap] = true
    if (this.cfg.chord.on) need[this.cfg.chord.tap] = true
    // Signal reads the picture too. Missing here, its tap was read only when
    // ANOTHER voice happened to claim it : alone, Signal never scanned at all.
    if (this.cfg.signal.on) need[this.cfg.signal.tap] = true
    else if (this.sigBeats !== -1 || this.signalDots.length || this.signalBars.length) {
      // off : no marks left on the overlay for the next switch-on to show
      // before its first step, and a synced clock re-anchors on the bar then
      this.sigBeats = -1
      this.signalDots = new Float32Array(0)
      this.signalBars = new Float32Array(0)
    }

    for (let t = 0; t < 2; t++) {
      if (!need[t]) continue
      const tap = this.cfg.taps[t]
      if (!comp.readSonifyGrid(tap.kind, tap.layer, this.rgba)) continue
      // RGBA → luma (Rec.601), flipped vertically (GL reads bottom-up; the
      // worklet expects row 0 = image TOP so y maps naturally).
      const prev = this.lumaPrev[t]
      const cur = this.luma[t]
      // A tap that wasn't read last tick (a voice just switched on, Sonify just
      // started) or now reads another source has no real previous frame : the
      // motion against it was a one-frame splash of grains and notes.
      const key = `${tap.kind}:${tap.layer}`
      const fresh = this.lastFrameAt[t] === 0 || nowMs - this.lastFrameAt[t] > 150 || key !== this.tapKey[t]
      this.tapKey[t] = key
      prev.set(cur)
      for (let y = 0; y < GRID; y++) {
        const src = (GRID - 1 - y) * GRID * 4
        const dst = y * GRID
        for (let x = 0; x < GRID; x++) {
          const i = src + x * 4
          cur[dst + x] = (this.rgba[i] * 77 + this.rgba[i + 1] * 150 + this.rgba[i + 2] * 29) >> 8
        }
      }
      if (fresh) prev.set(cur)
      const frameDt = this.lastFrameAt[t] > 0 ? Math.min(0.1, (nowMs - this.lastFrameAt[t]) / 1000) : 0.033
      this.lastFrameAt[t] = nowMs
      // Transfer a copy (the live buffer stays ours)
      const copy = new Uint8Array(cur)
      node.port.postMessage({ t: 'grid', tap: t, dt: frameDt, data: copy }, [copy.buffer])

      if (this.cfg.flow.on && this.cfg.flow.tap === t) this.analyzeFlow(t, dt)
      if (this.cfg.events.on && this.cfg.events.tap === t) this.analyzeEvents(t, frameDt)
      if (this.cfg.signal.on && this.cfg.signal.tap === t) this.analyzeSignal(t, frameDt)
    }
  }

  /** Detect edge / motion peaks on the 96×96 luma grid → discrete note events.
   *  Mode picks the salience field: SPATIAL = a Sobel edge magnitude (strokes /
   *  contours, fires even on a still), MOTION = frame-difference (only what moves),
   *  BLEND = both summed (a MOVING edge is the strongest, so it dominates). One
   *  peak per coarse block spreads the notes; the strongest N (density) fire, pitch
   *  from height (top = high), velocity from salience, pan from x. Onset-dithered. */
  private analyzeEvents(t: number, frameDt: number): void {
    const cur = this.luma[t], prev = this.lumaPrev[t]
    const ev = this.cfg.events
    const sal = this.salience
    const spatial = ev.mode !== 'motion'
    const motion = ev.mode !== 'spatial'
    // Salience per cell. Interior only for the Sobel; borders stay 0.
    sal.fill(0)
    for (let y = 1; y < GRID - 1; y++) {
      const r0 = (y - 1) * GRID, r1 = y * GRID, r2 = (y + 1) * GRID
      for (let x = 1; x < GRID - 1; x++) {
        let s = 0
        if (spatial) {
          const gx =
            cur[r0 + x + 1] + 2 * cur[r1 + x + 1] + cur[r2 + x + 1] -
            (cur[r0 + x - 1] + 2 * cur[r1 + x - 1] + cur[r2 + x - 1])
          const gy =
            cur[r2 + x - 1] + 2 * cur[r2 + x] + cur[r2 + x + 1] -
            (cur[r0 + x - 1] + 2 * cur[r0 + x] + cur[r0 + x + 1])
          s += (Math.abs(gx) + Math.abs(gy)) * 0.25 // 0..~255
        }
        if (motion) s += Math.abs(cur[r1 + x] - prev[r1 + x])
        sal[r1 + x] = s
      }
    }
    // One peak per FLOW_BLOCK cell → spread events across the frame; threshold by
    // sense (high sense = low bar = a busier rain), keep the strongest `density`.
    const thresh = 10 + (1 - ev.sense) * 70
    const maxEv = Math.max(1, Math.round(2 + ev.density * 16))
    type C = { x: number; y: number; mag: number }
    const cands: C[] = []
    for (let by = 0; by < FLOW_BLOCKS; by++) {
      for (let bx = 0; bx < FLOW_BLOCKS; bx++) {
        let best = 0, bxi = 0, byi = 0
        const ox = bx * FLOW_BLOCK, oy = by * FLOW_BLOCK
        for (let y = 0; y < FLOW_BLOCK; y++) {
          const row = (oy + y) * GRID + ox
          for (let x = 0; x < FLOW_BLOCK; x++) {
            const v = sal[row + x]
            if (v > best) { best = v; bxi = ox + x; byi = oy + y }
          }
        }
        if (best > thresh) cands.push({ x: (bxi + 0.5) / GRID, y: (byi + 0.5) / GRID, mag: Math.min(1, best / 200) })
      }
    }
    cands.sort((a, b) => b.mag - a.mag)
    const chosen = cands.slice(0, maxEv)
    const dots = new Float32Array(chosen.length * 3)
    chosen.forEach((c, i) => { dots[i * 3] = c.x; dots[i * 3 + 1] = c.y; dots[i * 3 + 2] = c.mag })
    this.eventDots = dots
    if (!chosen.length || !this.node) return
    // events : [tOffset, freq, amp, pan] — onset dithered across the frame gap
    const out = new Float32Array(chosen.length * 4)
    const lo = ev.loOct, hi = ev.hiOct
    for (let i = 0; i < chosen.length; i++) {
      const c = chosen[i]
      let freq: number
      if (ev.quantize && this.eventFreqs.length) {
        const idx = Math.min(this.eventFreqs.length - 1, Math.floor((1 - c.y) * this.eventFreqs.length))
        freq = this.eventFreqs[idx]
      } else {
        const f0 = noteFreq(12 * (lo + 1) + effRoot(this.cfg)), f1 = noteFreq(12 * (hi + 1) + effRoot(this.cfg))
        freq = f0 * Math.pow(f1 / f0, 1 - c.y)
      }
      out[i * 4] = Math.random() * frameDt
      out[i * 4 + 1] = freq
      out[i * 4 + 2] = 0.3 + c.mag * 0.7
      out[i * 4 + 3] = c.x
    }
    this.node.port.postMessage({ t: 'events', events: out }, [out.buffer])
  }

  /** The read point of a path, the same geometry the worklet's scanXY gives
   *  Spectra and Filter, so a path means the same thing in every voice : `pos`
   *  is the place along the travel (0..1), `pp` the place across it. */
  private signalPoint(path: number, pos: number, pp: number): void {
    const o = this.sigRead
    if (path === 1) { o.x = pp; o.y = pos }
    else if (path === 2) { const a = pos * Math.PI * 2, r = pp * 0.48; o.x = 0.5 + r * Math.cos(a); o.y = 0.5 + r * Math.sin(a) }
    else if (path === 3) { const a = pos * Math.PI * 2 + pp * Math.PI * 5, r = pp * 0.48; o.x = 0.5 + r * Math.cos(a); o.y = 0.5 + r * Math.sin(a) }
    else { o.x = pos; o.y = 1 - pp }
  }

  /** SIGNAL : read heads walk the picture on a clock and every cell they cross
   *  that is bright enough fires one micro-grain. The picture is the pattern,
   *  which is the whole difference from the instrument this voice comes from :
   *  that one had to invent its rhythms (Morse, primes, Rule 30, breakbeats);
   *  here they are whatever the image holds, so a field of machine marks plays
   *  as a stream of data.
   *
   *  Heads share one step clock but not one sweep length : head h's sweep is
   *  `steps` scaled toward 12/16, 10/16 or 7/16 by SPREAD, so they drift out of
   *  phase and back. That is the polymeter, taken from the image instead of
   *  from four separate sequencers. Each head reads its own band across the
   *  bar; the place along the bar is the pitch.
   *
   *  Onsets are timed to the step, not dithered : this voice is a grid, and the
   *  spacing between two marks is the clock's. Every grain plays SIG_AHEAD
   *  after its step. Played one scan window late instead (as it first was), the
   *  latency was the window itself, and the windows follow the picture's frame
   *  times and the readback : every uneven frame moved the grains. */
  private analyzeSignal(t: number, frameDt: number): void {
    const sg = this.cfg.signal
    const lum = this.luma[t]
    // The EFFECTIVE values : a modulator on rate, threshold or density has to
    // reach the scan, and the overlay only ships values to the worklet.
    const mv = sonifyModValues
    const eff = (k: string, base: number): number => {
      const v = mv.get(k) ?? base
      return Number.isFinite(v) ? v : base
    }
    const rate = eff('signalRate', sg.rate)
    const spread = Math.max(0, Math.min(1, eff('signalSpread', sg.spread)))
    const thresh = eff('signalThresh', sg.thresh)
    const density = eff('signalDensity', sg.density)
    const r = sg.sync ? Math.max(0.25, Math.min(16, rate)) : Math.max(0.25, Math.min(64, rate))
    const bps = Math.max(1, this.bpm) / 60
    const sps = sg.sync ? bps * r : r
    const H = Math.max(1, Math.min(4, Math.round(sg.heads)))
    const steps = Math.max(2, Math.min(96, Math.round(sg.steps)))
    // The polymeter set : one sweep at `steps`, the others pulled toward 12, 10
    // and 7 sixteenths of it as SPREAD rises. At spread 0 they read in unison.
    const RATIOS = [1, 0.75, 0.625, 0.4375]
    const lens: number[] = []
    for (let h = 0; h < H; h++) lens.push(Math.max(2, Math.round(steps * (1 + (RATIOS[h] - 1) * spread))))
    const idx = this.sigIdx
    for (let h = 0; h < 4; h++) if (!(idx[h] >= 0)) idx[h] = 0

    let c0 = Number.isFinite(this.sigClock) ? this.sigClock : 0
    let c1: number
    if (sg.sync) {
      // Synced, the clock runs on the beat clock both Sonify sequencers share,
      // not on this tap's frame times, and its steps are pulled onto the beat's
      // own grid (step n at beat n / rate) : four steps a beat are sixteenths
      // in time with the sequencers instead of drifting against them. The pull
      // is gentle, so a modulated rate bends the grid rather than jumping it.
      const beats = soniBeats()
      if (this.sigBeats < 0) {
        // switched on, or just synced : anchor on the beat grid, the heads on
        // the bar, and fire nothing this frame rather than a burst of the
        // steps between the old clock and the new one
        c0 = c1 = beats * r
        for (let h = 0; h < 4; h++) { const L = lens[h] ?? lens[0]; idx[h] = ((Math.floor(c1) % L) + L) % L }
      } else {
        c1 = c0 + Math.max(0, Math.min(bps * 0.1, beats - this.sigBeats)) * r
        let e = beats * r - c1
        e -= Math.round(e)
        c1 += e * 0.25
        if (c1 < c0) c1 = c0
      }
      this.sigBeats = beats
    } else {
      this.sigBeats = -1
      c1 = c0 + sps * frameDt
    }
    this.sigClock = c1

    const reads = Math.max(4, Math.round(24 / H)) // cells sampled along one head's band
    // Each read is the brightest point of its whole cell on the 96 grid, not
    // the cell's center : a mark thinner than the gap between two steps (a bar
    // of a Lowercase barcode) fell between the read points and never fired.
    // The ring paths sweep a longer arc at the rim, so they sample more along.
    const path = sg.path | 0
    const along = Math.max(1, Math.min(12, Math.ceil((GRID * (path >= 2 ? 3 : 1)) / steps)))
    const across = Math.max(1, Math.min(6, Math.ceil(GRID / (reads * H))))
    const perStep = 1 + Math.round(Math.max(0, Math.min(1, density)) * 7)
    const thr = Math.max(1, Math.min(254, thresh * 255))
    const tbl = this.signalFreqs
    // SNAP's two ends span the same notes : the free spread runs from the
    // table's lowest note to its highest, not to the next octave's root.
    const root = effRoot(this.cfg)
    const f0 = tbl.length ? tbl[0] : noteFreq(12 * (sg.loOct + 1) + root)
    const f1 = tbl.length > 1 ? tbl[tbl.length - 1] : noteFreq(12 * (sg.hiOct + 1) + root)
    const snap = Math.max(0, Math.min(1, eff('signalSnap', sg.snap)))

    const onsets: number[] = []
    const dots: number[] = []
    type C = { pp: number; v: number; x: number; y: number }
    const cand: C[] = []
    let stepped = false
    // every step whose boundary falls inside this window (a long stall plays
    // its last steps, never a pile of them at once)
    const kLast = Math.floor(c1)
    for (let k = Math.max(Math.floor(c0) + 1, kLast - 31); k <= kLast; k++) {
      stepped = true
      const tOff = Math.max(0, SIG_AHEAD - (c1 - k) / sps)
      for (let h = 0; h < H; h++) {
        const len = lens[h]
        idx[h] = (idx[h] + 1) % len
        // a head sharing the first one's sweep length falls back in step with
        // it at the top of the sweep (after SPREAD came back to 0, say)
        if (h > 0 && len === lens[0] && idx[0] === 0) idx[h] = 0
        const i0 = idx[h]
        cand.length = 0
        for (let rr = 0; rr < reads; rr++) {
          let best = -1, bx = 0, by = 0
          for (let a = 0; a < along; a++) {
            const pos = (i0 + (a + 0.5) / along) / len
            for (let b = 0; b < across; b++) {
              const pp = (h + (rr + (b + 0.5) / across) / reads) / H
              this.signalPoint(path, pos, pp)
              const gx = Math.min(GRID - 1, Math.max(0, Math.floor(this.sigRead.x * GRID)))
              const gy = Math.min(GRID - 1, Math.max(0, Math.floor(this.sigRead.y * GRID)))
              const v = lum[gy * GRID + gx]
              if (v > best) { best = v; bx = this.sigRead.x; by = this.sigRead.y }
            }
          }
          if (best > thr) cand.push({ pp: (h + (rr + 0.5) / reads) / H, v: best, x: bx, y: by })
        }
        // the brightest marks first, as many as DENSITY allows
        cand.sort((a, b) => b.v - a.v)
        const m = Math.min(perStep, cand.length)
        for (let i = 0; i < m; i++) {
          const c = cand[i]
          const free = f0 * Math.pow(f1 / f0, c.pp)
          const q = tbl.length ? tbl[Math.min(tbl.length - 1, Math.floor(c.pp * tbl.length))] : free
          // SNAP blends the two in log frequency, so its middle is microtonal
          // rather than a crossfade between two notes
          const freq = Math.exp(Math.log(free) * (1 - snap) + Math.log(q) * snap)
          const amp = 0.35 + 0.65 * ((c.v - thr) / Math.max(1, 255 - thr))
          if (!Number.isFinite(freq) || !Number.isFinite(amp)) continue
          onsets.push(tOff, freq, amp, Math.max(0, Math.min(1, c.x)))
          dots.push(c.x, c.y, amp)
        }
      }
    }

    // the read bars where they stand now, for the overlay
    const bars = new Float32Array(H * 4)
    for (let h = 0; h < H; h++) {
      const pos = (Math.min(idx[h], lens[h] - 1) + 0.5) / lens[h]
      this.signalPoint(path, pos, h / H)
      bars[h * 4] = this.sigRead.x; bars[h * 4 + 1] = this.sigRead.y
      this.signalPoint(path, pos, (h + 1) / H)
      bars[h * 4 + 2] = this.sigRead.x; bars[h * 4 + 3] = this.sigRead.y
    }
    this.signalBars = bars
    // The marks HOLD until the next step, like a Lowercase deal : most frames
    // fall between two steps (12 a second against a 60 Hz loop), and clearing
    // them every frame left each square on screen for one frame, unseen. A
    // step that fires nothing still clears them, so a dark frame reads dark.
    if (stepped) this.signalDots = new Float32Array(dots)
    if (!onsets.length || !this.node) return
    const out = new Float32Array(onsets)
    this.node.port.postMessage({ t: 'signal', events: out }, [out.buffer])
  }

  /** Block-matching motion field on the 96×96 luma grids → grain events. */
  private analyzeFlow(t: number, frameDt: number): void {
    const cur = this.luma[t], prev = this.lumaPrev[t]
    const fl = this.cfg.flow
    const thresh = 6 + (1 - fl.sense) * 30 // mean |diff| per block, 0..255
    const maxEv = Math.max(2, Math.round(4 + fl.density * 20))
    type V = { x: number; y: number; mag: number; bx: number; by: number }
    const vecs: V[] = []
    for (let by = 0; by < FLOW_BLOCKS; by++) {
      for (let bx = 0; bx < FLOW_BLOCKS; bx++) {
        let diff = 0
        const ox = bx * FLOW_BLOCK, oy = by * FLOW_BLOCK
        for (let y = 0; y < FLOW_BLOCK; y += 2) {
          const row = (oy + y) * GRID + ox
          for (let x = 0; x < FLOW_BLOCK; x += 2) {
            diff += Math.abs(cur[row + x] - prev[row + x])
          }
        }
        diff /= (FLOW_BLOCK * FLOW_BLOCK) / 4
        if (diff > thresh) {
          vecs.push({ x: (bx + 0.5) / FLOW_BLOCKS, y: (by + 0.5) / FLOW_BLOCKS, mag: Math.min(1, diff / 80), bx, by })
        }
      }
    }
    // keep the strongest N (outlier discipline : a global cut, not per-vector
    // neighborhood — enough at this resolution)
    vecs.sort((a, b) => b.mag - a.mag)
    const chosen = vecs.slice(0, maxEv)
    // overlay dots for the UI
    const dots = new Float32Array(chosen.length * 3)
    chosen.forEach((v, i) => { dots[i * 3] = v.x; dots[i * 3 + 1] = v.y; dots[i * 3 + 2] = v.mag })
    this.flowDots = dots
    if (!chosen.length || !this.node) return
    // events : [tOffset, freq, amp, pan, bright, warm] — onset dithered across
    // the frame gap. bright/warm come from the block's average COLOUR (see below).
    const ev = new Float32Array(chosen.length * 6)
    const lo = fl.loOct, hi = fl.hiOct
    for (let i = 0; i < chosen.length; i++) {
      const v = chosen[i]
      let freq: number
      if (fl.quantize && this.grainFreqs.length) {
        const idx = Math.min(this.grainFreqs.length - 1, Math.floor((1 - v.y) * this.grainFreqs.length))
        freq = this.grainFreqs[idx]
      } else {
        const f0 = noteFreq(12 * (lo + 1) + effRoot(this.cfg)), f1 = noteFreq(12 * (hi + 1) + effRoot(this.cfg))
        freq = f0 * Math.pow(f1 / f0, 1 - v.y)
      }
      const col = this.blockColour(v.bx, v.by) // { bright, warm } from avg RGB
      ev[i * 6] = Math.random() * frameDt // Pelletier's onset dither
      ev[i * 6 + 1] = freq
      ev[i * 6 + 2] = 0.25 + v.mag * 0.75
      ev[i * 6 + 3] = v.x // 0 = left … 1 = right
      ev[i * 6 + 4] = col.bright
      ev[i * 6 + 5] = col.warm
    }
    this.node.port.postMessage({ t: 'flow', events: ev }, [ev.buffer])
  }

  /** Average colour of one flow block (from the raw RGBA readback, y-flipped to
   *  match the luma grid) → grain timbre : `bright` (saturation × value, brightens
   *  the grain) and `warm` (−1 cool … +1 warm, from hue, scaled by saturation). */
  private blockColour(bx: number, by: number): { bright: number; warm: number } {
    const ox = bx * FLOW_BLOCK, oy = by * FLOW_BLOCK
    let R = 0, G = 0, B = 0, cnt = 0
    for (let yy = 0; yy < FLOW_BLOCK; yy += 2) {
      const ry = GRID - 1 - (oy + yy) // rgba is bottom-up; luma row 0 = top
      const base = ry * GRID * 4
      for (let xx = 0; xx < FLOW_BLOCK; xx += 2) {
        const i = base + (ox + xx) * 4
        R += this.rgba[i]; G += this.rgba[i + 1]; B += this.rgba[i + 2]; cnt++
      }
    }
    if (cnt === 0) return { bright: 0, warm: 0 }
    R /= cnt; G /= cnt; B /= cnt
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn
    const sat = mx <= 0 ? 0 : d / mx
    const val = mx / 255
    let hue = 0
    if (d > 0) {
      if (mx === R) hue = ((G - B) / d) % 6
      else if (mx === G) hue = (B - R) / d + 2
      else hue = (R - G) / d + 4
      hue /= 6
      if (hue < 0) hue += 1
    }
    return { bright: sat * (0.4 + 0.6 * val), warm: Math.cos(hue * 6.283185307179586) * sat }
  }
}

export const sonifyEngine = new SonifyEngine()

// Dev only (`npm run dev`) : a hot update re-runs this module and makes a new
// engine, while the previous one, its audio context kept open (keepWarm), played
// on with nothing left to turn it off : Sonify off, the sound still going. The
// new engine shuts the old one down. Compiled out of a real build.
if (import.meta.hot) {
  const g = globalThis as { __opsiaSonify?: SonifyEngine }
  g.__opsiaSonify?.shutdown()
  g.__opsiaSonify = sonifyEngine
}
