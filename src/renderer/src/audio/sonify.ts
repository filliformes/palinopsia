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

import { SONI_WORKLET_URL } from './soniWorklet'

export const GRID = 96
const FLOW_BLOCK = 8 // grid px per flow block → 12×12 blocks
const FLOW_BLOCKS = GRID / FLOW_BLOCK

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
  scale: SoniScale
  spectra: {
    on: boolean; tap: number; gain: number; pan: number
    sweepOn: boolean; sweepHz: number; sync: boolean; x: number
    gamma: number; loOct: number; hiOct: number; quantize: boolean
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
    loOct: number; hiOct: number; quantize: boolean
  }
  raster: {
    on: boolean; tap: number; gain: number; pan: number
    note: number; freq: number; quantize: boolean
    rx: number; ry: number; rw: number; rh: number; smooth: number
  }
  sstv: {
    on: boolean; tap: number; gain: number; pan: number
    lineHz: number; sync: boolean; dev: number; syncLev: number
  }
  filter: {
    on: boolean; tap: number; gain: number; pan: number
    q: number; noise: number; lineIn: boolean
    sweepOn: boolean; sweepHz: number; x: number; gamma: number
    loOct: number; hiOct: number; quantize: boolean
  }
  taps: [SoniTap, SoniTap]
}

export function defaultSoniConfig(): SoniConfig {
  return {
    on: false,
    master: 0.8,
    sinkId: '',
    root: 0,
    scale: 'minor',
    spectra: { on: true, tap: 0, gain: 0.5, pan: 0, sweepOn: true, sweepHz: 0.25, sync: false, x: 0.5, gamma: 1.8, loOct: 2, hiOct: 7, quantize: true },
    orbit: { on: false, tap: 0, gain: 0.5, pan: 0, note: 45, freq: 110, quantize: true, ratio: 1, cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, drive: 1, smooth: 0.5 },
    flow: { on: false, tap: 0, gain: 0.6, pan: 0, sense: 0.4, density: 0.5, dur: 0.09, noise: 0.15, loOct: 3, hiOct: 6, quantize: true },
    raster: { on: false, tap: 0, gain: 0.4, pan: 0, note: 45, freq: 110, quantize: true, rx: 0.35, ry: 0.35, rw: 0.3, rh: 0.3, smooth: 0 },
    sstv: { on: false, tap: 0, gain: 0.4, pan: 0, lineHz: 12, sync: false, dev: 1, syncLev: 0.5 },
    filter: { on: false, tap: 0, gain: 0.6, pan: 0, q: 0.5, noise: 0.5, lineIn: false, sweepOn: false, sweepHz: 0.25, x: 0.5, gamma: 1.6, loOct: 1, hiOct: 8, quantize: false },
    taps: [{ kind: 'master', layer: 0 }, { kind: 'layer', layer: 0 }]
  }
}

const noteFreq = (n: number): number => 440 * Math.pow(2, (n - 69) / 12)

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
    const tab = scaleTable(cfg.root, cfg.scale, loOct, hiOct)
    for (let i = 0; i < 96; i++) out[i] = tab[Math.min(tab.length - 1, Math.floor((i / 96) * tab.length))]
  } else {
    const lo = noteFreq(12 * (loOct + 1) + cfg.root)
    const hi = noteFreq(12 * (hiOct + 1) + cfg.root)
    for (let i = 0; i < 96; i++) out[i] = lo * Math.pow(hi / lo, i / 95)
  }
  return out
}

/** The Filter voice's 48 band-centre frequencies : quantized to the scale
 *  (a resonant harmonic wash) or a plain log spread 80Hz..8kHz. */
function filterFreqs(cfg: SoniConfig): Float32Array {
  const out = new Float32Array(48)
  if (cfg.filter.quantize) {
    const tab = scaleTable(cfg.root, cfg.scale, cfg.filter.loOct, cfg.filter.hiOct)
    for (let i = 0; i < 48; i++) out[i] = tab[Math.min(tab.length - 1, Math.floor((i / 48) * tab.length))]
  } else {
    for (let i = 0; i < 48; i++) out[i] = 80 * Math.pow(100, i / 47)
  }
  return out
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
  // live meter (UI reads these; written from the worklet's meter messages)
  meterPeak = 0
  meterLim = 1
  // live flow vectors for the overlay ([x01,y01,mag] × n)
  flowDots: Float32Array = new Float32Array(0)

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
      ? scaleTable(cfg.root, cfg.scale, cfg.flow.loOct, cfg.flow.hiOct)
      : new Float32Array(0)
    this.node.port.postMessage({
      t: 'cfg',
      cfg: {
        master: cfg.master,
        spectra: {
          on: cfg.spectra.on, tap: cfg.spectra.tap, gain: cfg.spectra.gain, pan: cfg.spectra.pan,
          sweepOn: cfg.spectra.sweepOn, sweepHz: cfg.spectra.sweepHz, x: cfg.spectra.x, gamma: cfg.spectra.gamma
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
          dur: cfg.flow.dur, noise: cfg.flow.noise
        },
        raster: {
          on: cfg.raster.on, tap: cfg.raster.tap, gain: cfg.raster.gain, pan: cfg.raster.pan,
          freq: cfg.raster.quantize ? this.snapNote(cfg.raster.note) : cfg.raster.freq,
          rx: cfg.raster.rx, ry: cfg.raster.ry, rw: cfg.raster.rw, rh: cfg.raster.rh,
          smooth: cfg.raster.smooth
        },
        sstv: {
          on: cfg.sstv.on, tap: cfg.sstv.tap, gain: cfg.sstv.gain, pan: cfg.sstv.pan,
          lineHz: cfg.sstv.lineHz, dev: cfg.sstv.dev, syncLev: cfg.sstv.syncLev
        },
        filter: {
          on: cfg.filter.on, tap: cfg.filter.tap, gain: cfg.filter.gain, pan: cfg.filter.pan,
          q: cfg.filter.q, noise: cfg.filter.lineIn ? cfg.filter.noise * 0.25 : cfg.filter.noise,
          sweepOn: cfg.filter.sweepOn, sweepHz: cfg.filter.sweepHz, x: cfg.filter.x, gamma: cfg.filter.gamma
        }
      },
      spectraFreqs: spectraFreqs(cfg),
      filterFreqs: filterFreqs(cfg)
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

    const need = [false, false]
    if (this.cfg.spectra.on) need[this.cfg.spectra.tap] = true
    if (this.cfg.orbit.on) need[this.cfg.orbit.tap] = true
    if (this.cfg.flow.on) need[this.cfg.flow.tap] = true
    if (this.cfg.raster.on) need[this.cfg.raster.tap] = true
    if (this.cfg.sstv.on) need[this.cfg.sstv.tap] = true
    if (this.cfg.filter.on) need[this.cfg.filter.tap] = true

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
    }
  }

  /** Block-matching motion field on the 96×96 luma grids → grain events. */
  private analyzeFlow(t: number, frameDt: number): void {
    const cur = this.luma[t], prev = this.lumaPrev[t]
    const fl = this.cfg.flow
    const thresh = 6 + (1 - fl.sense) * 30 // mean |diff| per block, 0..255
    const maxEv = Math.max(2, Math.round(4 + fl.density * 20))
    type V = { x: number; y: number; mag: number }
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
          vecs.push({ x: (bx + 0.5) / FLOW_BLOCKS, y: (by + 0.5) / FLOW_BLOCKS, mag: Math.min(1, diff / 80) })
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
    // events : [tOffset, freq, amp, pan] — onset dithered across the frame gap
    const ev = new Float32Array(chosen.length * 4)
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
      ev[i * 4] = Math.random() * frameDt // Pelletier's onset dither
      ev[i * 4 + 1] = freq
      ev[i * 4 + 2] = 0.25 + v.mag * 0.75
      ev[i * 4 + 3] = v.x // 0 = left … 1 = right
    }
    this.node.port.postMessage({ t: 'flow', events: ev }, [ev.buffer])
  }
}

export const sonifyEngine = new SonifyEngine()
