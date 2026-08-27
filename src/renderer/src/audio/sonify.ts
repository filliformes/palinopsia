// Sonify engine (the S page's sound half). Owns the AudioContext + the single
// `soni` AudioWorklet (see soniWorklet.ts), the two image taps, the note
// quantizer tables, flow analysis, output-device routing (setSinkId) and the
// recording tap (a MediaStreamDestination the recorder can mix in).
//
// Data path per frame (App loop → engine.tick):
//   Compositor.readSonifyGrid(tap) → 96×96 RGBA readback → luma Uint8Array →
//   transferred to the worklet (~9KB @ 30Hz per tap). The FLOW voice's motion
//   field is computed HERE on the luma grids (block matching cur vs prev),
//   median-thresholded, converted to grain events with per-event random onset
//   dither across the frame interval (Pelletier), pitch quantized via the
//   active scale table, then posted to the worklet.

import { registerSonifyModBase, sonifyModValues } from '../engine/modulation'
import { SONI_WORKLET_URL } from './soniWorklet'

export const GRID = 96
const FLOW_BLOCK = 8 // grid px per flow block → 12×12 blocks
const FLOW_BLOCKS = GRID / FLOW_BLOCK

export type SoniEventMode = 'spatial' | 'motion' | 'blend'
export type SoniScale = 'chromatic' | 'major' | 'minor' | 'pentatonic' | 'wholetone' | 'dorian' | 'phrygian' | 'lydian'
export const SONI_SCALES: SoniScale[] = ['chromatic', 'major', 'minor', 'pentatonic', 'wholetone', 'dorian', 'phrygian', 'lydian']
const SCALE_STEPS: Record<SoniScale, number[]> = {
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
    sweepOn: boolean; sweepHz: number; x: number; gamma: number
    path: number; pace: number // reading path + breathing pace (see spectra)
    loOct: number; hiOct: number; quantize: boolean
  }
  // Chord bank (Aural Mirror's additive layer) : a few scale-tuned oscillators,
  // each following the brightness of a horizontal band → a sustained chord that
  // swells and fades with the image (sings even on a STILL frame).
  chord: {
    on: boolean; tap: number; gain: number; pan: number
    voices: number // 3..16 notes, spread across the octave range
    loOct: number; hiOct: number
    gamma: number // brightness contrast
    spread: number // stereo fan across the bank
    attack: number; release: number // swell / fade seconds
    tone: number // 0 sine … 1 brighter (soft-clip harmonics)
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
  // Per-voice DJ filter for the mixer page (one per voice, in render order :
  // spectra·orbit·flow·events·raster·sstv·filter·chord). 0.5 = bypass, <0.5
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
    filter: { on: false, tap: 0, gain: 0.6, pan: 0, q: 0.5, noise: 0.5, lineIn: false, sweepOn: false, sweepHz: 0.25, x: 0.5, gamma: 1.6, path: 0, pace: 0, loOct: 1, hiOct: 8, quantize: false },
    chord: { on: false, tap: 0, gain: 0.6, pan: 0, voices: 7, loOct: 2, hiOct: 6, gamma: 1.6, spread: 0.6, attack: 0.4, release: 0.8, tone: 0.3 },
    fx: {
      send: 0,
      dlyMix: 0.35, dlyTime: 0.3, dlyFb: 0.35, dlyTone: 0.5, dlyMode: 1,
      rvMode: 0, rvMix: 0.6, rvSize: 0.6, rvDecay: 0.6, rvDamp: 0.3, rvPre: 20, rvMod: 6, rvModRate: 0.5,
      rvWidth: 1, rvLocut: 220, rvFreeze: false, rvDiff: 0.85, rvLowDamp: 0.5,
      rvCross: 0.3, rvLowMult: 1, rvHighMult: 1
    },
    mixFilter: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
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
  rasterSmooth: ['raster', 'smooth'], rasterTone: ['raster', 'tone'],
  sstvLine: ['sstv', 'lineHz'], sstvDev: ['sstv', 'dev'],
  filterQ: ['filter', 'q'], filterSweep: ['filter', 'sweepHz'],
  chordTone: ['chord', 'tone'], chordSpread: ['chord', 'spread'], chordAttack: ['chord', 'attack'],
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
function spectraFreqs(cfg: SoniConfig): Float32Array {
  const { loOct, hiOct, quantize } = cfg.spectra
  const out = new Float32Array(96)
  if (quantize) {
    const tab = scaleTable(effRoot(cfg), cfg.scale, loOct, hiOct)
    for (let i = 0; i < 96; i++) out[i] = tab[Math.min(tab.length - 1, Math.floor((i / 96) * tab.length))]
  } else {
    const lo = noteFreq(12 * (loOct + 1) + effRoot(cfg))
    const hi = noteFreq(12 * (hiOct + 1) + effRoot(cfg))
    for (let i = 0; i < 96; i++) out[i] = lo * Math.pow(hi / lo, i / 95)
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

interface GridReader {
  readSonifyGrid: (kind: 'master' | 'layer', layer: number, out: Uint8Array) => boolean
}

class SonifyEngine {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private recDest: MediaStreamAudioDestinationNode | null = null
  private cfg: SoniConfig = defaultSoniConfig()
  private starting = false
  private lineSrc: MediaStreamAudioSourceNode | null = null
  private lineStream: MediaStream | null = null
  private lineWanted = false
  private lastTick = 0
  private lastFrameAt = [0, 0]
  // luma grids per tap : cur + prev (for flow), plus the RGBA readback scratch
  private rgba = new Uint8Array(GRID * GRID * 4)
  private luma: Uint8Array[] = [new Uint8Array(GRID * GRID), new Uint8Array(GRID * GRID)]
  private lumaPrev: Uint8Array[] = [new Uint8Array(GRID * GRID), new Uint8Array(GRID * GRID)]
  private grainFreqs: Float32Array = new Float32Array(0)
  private eventFreqs: Float32Array = new Float32Array(0)
  private salience = new Float32Array(GRID * GRID) // Events detection scratch
  // live meter (UI reads these; written from the worklet's meter messages)
  meterPeak = 0
  meterLim = 1
  // live flow vectors for the overlay ([x01,y01,mag] × n)
  flowDots: Float32Array = new Float32Array(0)
  // live event onsets for the overlay ([x01,y01,mag] × n), fade painted by the UI
  eventDots: Float32Array = new Float32Array(0)
  // effective probe values (base + modulation), for the page overlay
  liveProbes: Record<string, number> = {}

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

  /** The recorder mixes this stream's audio track into captures (null = off). */
  recordStream(): MediaStream | null { return this.recDest?.stream ?? null }

  async start(): Promise<void> {
    if (this.ctx || this.starting) return
    this.starting = true
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      await ctx.audioWorklet.addModule(SONI_WORKLET_URL)
      const node = new AudioWorkletNode(ctx, 'soni', { numberOfInputs: 1, outputChannelCount: [2] })
      node.port.onmessage = (e): void => {
        const m = e.data
        if (m?.t === 'meter') { this.meterPeak = m.peak; this.meterLim = m.lim }
      }
      node.connect(ctx.destination)
      this.recDest = ctx.createMediaStreamDestination()
      node.connect(this.recDest)
      this.ctx = ctx
      this.node = node
      if (this.cfg.sinkId) this.applySink(this.cfg.sinkId)
      this.pushConfig(this.cfg)
      if (ctx.state !== 'running') await ctx.resume()
    } catch (e) {
      console.error('[sonify] start failed', e)
      this.stop()
    } finally {
      this.starting = false
    }
  }

  stop(): void {
    this.lineSrc?.disconnect()
    this.lineSrc = null
    this.lineStream?.getTracks().forEach((t) => t.stop())
    this.lineStream = null
    this.node?.disconnect()
    this.node = null
    this.recDest = null
    void this.ctx?.close()
    this.ctx = null
    this.meterPeak = 0
    this.flowDots = new Float32Array(0)
  }

  private applySink(sinkId: string): void {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
    if (ctx?.setSinkId) ctx.setSinkId(sinkId).catch((e) => console.warn('[sonify] setSinkId', e))
  }

  pushConfig(cfg: SoniConfig): void {
    const sinkChanged = cfg.sinkId !== this.cfg.sinkId
    this.cfg = cfg
    if (!this.node) return
    if (sinkChanged) this.applySink(cfg.sinkId)
    // grain pitch table for the flow voice
    this.grainFreqs = cfg.flow.quantize
      ? scaleTable(effRoot(cfg), cfg.scale, cfg.flow.loOct, cfg.flow.hiOct)
      : new Float32Array(0)
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
          path: cfg.filter.path ?? 0, pace: cfg.filter.pace ?? 0
        },
        chord: {
          on: cfg.chord.on, tap: cfg.chord.tap, gain: cfg.chord.gain, pan: cfg.chord.pan,
          gamma: cfg.chord.gamma, spread: cfg.chord.spread, attack: cfg.chord.attack,
          release: cfg.chord.release, tone: cfg.chord.tone
        },
        fx: { ...cfg.fx },
        mixFilter: cfg.mixFilter
      },
      spectraFreqs: spectraFreqs(cfg),
      filterFreqs: filterFreqs(cfg),
      chordFreqs: chordFreqs(cfg)
    })
    this.syncLineIn(cfg.filter.on && cfg.filter.lineIn)
  }

  /** Open/close the line-in tap for the Filter voice (mic/line via WebRTC). */
  private syncLineIn(want: boolean): void {
    if (want === this.lineWanted) return
    this.lineWanted = want
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
        if (!this.lineWanted || !this.ctx || !this.node) { stream.getTracks().forEach((t) => t.stop()); return }
        this.lineStream = stream
        this.lineSrc = this.ctx.createMediaStreamSource(stream)
        this.lineSrc.connect(this.node)
      })
      .catch((e) => console.warn('[sonify] line-in unavailable, noise only', e))
  }

  /** Snap the orbit's note number onto the active scale, return Hz. */
  private snapNote(note: number): number {
    const steps = SCALE_STEPS[this.cfg.scale]
    const rel = ((note - this.cfg.root) % 12 + 12) % 12
    let best = steps[0], bd = 99
    for (const s of steps) { const d = Math.abs(s - rel); if (d < bd) { bd = d; best = s } }
    return noteFreq(note - rel + best)
  }

  /** Per-frame pump : read the active taps from the compositor, ship grids to
   *  the worklet, run flow analysis. Call from the App loop AFTER render().
   *  Throttled to ~30Hz. */
  tick(comp: GridReader, nowMs: number, bpm: number): void {
    const node = this.node
    if (!node || !this.cfg.on) return
    if (nowMs - this.lastTick < 33) return
    const dt = Math.min(0.1, (nowMs - this.lastTick) / 1000)
    this.lastTick = nowMs

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

    // Probe modulation overlay : ship the EFFECTIVE probe values (base +
    // whatever the mod-matrix / Meta knobs wrote this frame) every tick.
    // Always sent, so releasing a modulator reverts to the base cleanly.
    {
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
        ;(mm[voice] ??= {})[field] = g(param, (c[voice] as unknown as Record<string, number>)[field])
      }
      node.port.postMessage({ t: 'mod', m })
      this.liveProbes = {
        spectraX: m.spectra.x, filterX: m.filter.x,
        orbitX: m.orbit.cx, orbitY: m.orbit.cy, orbitR: m.orbit.rx,
        rasterX: m.raster.rx, rasterY: m.raster.ry, rasterW: m.raster.rw, rasterH: m.raster.rh
      }
    }

    const need = [false, false]
    if (this.cfg.spectra.on) need[this.cfg.spectra.tap] = true
    if (this.cfg.orbit.on) need[this.cfg.orbit.tap] = true
    if (this.cfg.flow.on) need[this.cfg.flow.tap] = true
    if (this.cfg.events.on) need[this.cfg.events.tap] = true
    if (this.cfg.raster.on) need[this.cfg.raster.tap] = true
    if (this.cfg.sstv.on) need[this.cfg.sstv.tap] = true
    if (this.cfg.filter.on) need[this.cfg.filter.tap] = true
    if (this.cfg.chord.on) need[this.cfg.chord.tap] = true

    for (let t = 0; t < 2; t++) {
      if (!need[t]) continue
      const tap = this.cfg.taps[t]
      if (!comp.readSonifyGrid(tap.kind, tap.layer, this.rgba)) continue
      // RGBA → luma (Rec.601), flipped vertically (GL reads bottom-up; the
      // worklet expects row 0 = image TOP so y maps naturally).
      const prev = this.lumaPrev[t]
      const cur = this.luma[t]
      prev.set(cur)
      for (let y = 0; y < GRID; y++) {
        const src = (GRID - 1 - y) * GRID * 4
        const dst = y * GRID
        for (let x = 0; x < GRID; x++) {
          const i = src + x * 4
          cur[dst + x] = (this.rgba[i] * 77 + this.rgba[i + 1] * 150 + this.rgba[i + 2] * 29) >> 8
        }
      }
      const frameDt = this.lastFrameAt[t] > 0 ? Math.min(0.1, (nowMs - this.lastFrameAt[t]) / 1000) : 0.033
      this.lastFrameAt[t] = nowMs
      // Transfer a copy (the live buffer stays ours)
      const copy = new Uint8Array(cur)
      node.port.postMessage({ t: 'grid', tap: t, dt: frameDt, data: copy }, [copy.buffer])

      if (this.cfg.flow.on && this.cfg.flow.tap === t) this.analyzeFlow(t, dt)
      if (this.cfg.events.on && this.cfg.events.tap === t) this.analyzeEvents(t, frameDt)
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
        const f0 = noteFreq(12 * (lo + 1)), f1 = noteFreq(12 * (hi + 1))
        freq = f0 * Math.pow(f1 / f0, 1 - c.y)
      }
      out[i * 4] = Math.random() * frameDt
      out[i * 4 + 1] = freq
      out[i * 4 + 2] = 0.3 + c.mag * 0.7
      out[i * 4 + 3] = c.x
    }
    this.node.port.postMessage({ t: 'events', events: out }, [out.buffer])
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
        const f0 = noteFreq(12 * (lo + 1)), f1 = noteFreq(12 * (hi + 1))
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
