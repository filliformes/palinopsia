// Audio ingest bus (Slab 1) : the first "voice" of the audiovisual-reactivity
// chapter. Two sources feed one merged AudioFeatures frame:
//
//   • Pandore over OSC  : /opsia/audio/* messages land here (setOscFeature),
//     the primary path (Pandore is the audio brain).
//   • Local Web Audio   : a mic / line / loopback input analysed in-renderer,
//     the standalone fallback.
//
// The modulation engine reads a single feature per `audio` modulator each frame
// (via `feature()`), so nothing here touches the React store : same discipline
// as the mod meters. Merge policy: OSC primary, local fills in when OSC is stale
// (mode 'both'); or force one source.
//
// Design rule for the chapter: prefer DISCONTINUITY (transient/flux) over gain —
// the salient signal dominates cross-modal perception.

import { CH_DEFAULT, clampPick, InputPick, isDefaultPick, outputRoute, pickFits, stereoDestination, type ChPick } from '../audio/channelPick'
import { AUDIO_FORMAT_DEFAULT, contextOptions, formatKey, latencyOf, type AudioFormat, type LatencyInfo } from '../audio/audioFormat'
const BANDS = 6
export const AUDIO_BANDS = BANDS

// One denoiser notch : centre frequency (Hz) + Q (higher = narrower). Learned by
// analysing the input's noise (mains-hum combs, digital-clock combs, HF whine).
export interface NoiseNotch { f: number; q: number }

export type AudioFeatureName = 'level' | 'flux' | 'transient' | 'centroid' | 'band' | 'pitch' | 'noisiness'
export const AUDIO_FEATURES: AudioFeatureName[] = [
  'level',
  'flux',
  'transient',
  'centroid',
  'band',
  'pitch',
  'noisiness'
]

export type AudioMode = 'off' | 'osc' | 'local' | 'both'

/** The input menu's Audio Layer entry : the local input is then the layer's own
 *  sound (its analyser, after its volume), no microphone opened. */
export const LAYER_INPUT = 'opsia:audio-layer'
/** The Audio Layer's sound this frame, analysed once (`dt` : seconds since the
 *  last frame) : its features and its analyser's buffers (null : the layer is
 *  empty). */
export type LayerAnalyser = (dt: number) => { an: AnalyserNode; sampleRate: number; feats: AudioFeatures; bufs: FrameBufs } | null

export interface AudioFeatures {
  level: number // RMS loudness 0..1
  flux: number // spectral flux 0..1 (onset energy)
  transient: number // gated onset impulse, decays 0..1
  centroid: number // spectral brightness 0..1
  bands: number[] // BANDS log-spaced band energies 0..1
  pitch: number // 0..1 (OSC-supplied; local leaves 0 for now)
  noisiness: number // spectral flatness 0..1 : 0 tonal / pitched, 1 noise-like (hiss, breath)
}

type Features = AudioFeatures
/** One feature (0..1) off a frame. */
export function readFeature(c: AudioFeatures, name: AudioFeatureName, band = 0): number {
  if (name === 'band') return c.bands[Math.max(0, Math.min(BANDS - 1, band))] ?? 0
  return c[name] as number
}

export function zero(): Features {
  return { level: 0, flux: 0, transient: 0, centroid: 0, bands: new Array(BANDS).fill(0), pitch: 0, noisiness: 0 }
}

const OSC_STALE_MS = 500 // in 'both', OSC older than this yields to local
// The meters' analysers : 2048 samples (43 ms at 48 kHz) cover the interval between
// two reads of the audio tab's meters (30 a second), so no peak falls between them.
const METER_FFT = 2048

/** RMS and peak (linear, 0..1 = full scale) of an analyser's last samples. */
export function levelOf(an: AnalyserNode, buf: Float32Array<ArrayBuffer>): { rms: number; peak: number } {
  const b = buf.length > an.fftSize ? buf.subarray(0, an.fftSize) : buf
  an.getFloatTimeDomainData(b)
  let sum = 0, pk = 0
  for (let i = 0; i < b.length; i++) { const x = b[i]; sum += x * x; const a = x < 0 ? -x : x; if (a > pk) pk = a }
  return { rms: Math.sqrt(sum / b.length), peak: pk }
}

// Pitch mapping span : A1 (55 Hz) to A6 (1760 Hz), log-scaled to 0..1.
const LOG_FMIN = Math.log2(55)
const LOG_FMAX = Math.log2(1760)

// third-party: Chris Wilson PitchDetect
// Autocorrelation pitch detection (ACF + RMS gate + parabolic interpolation),
// after Chris Wilson's PitchDetect. Returns the fundamental in Hz, or -1 when
// the frame is too quiet / unvoiced to trust. Lag search is bounded to the
// musical range so the cost stays contained.
function autoCorrelate(buf: Float32Array, sampleRate: number, corr: Float32Array): number {
  const SIZE = buf.length
  let rms = 0
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / SIZE)
  if (rms < 0.01) return -1 // too quiet : unreliable

  // Trim leading/trailing near-silence so the correlation locks on the tone.
  let r1 = 0
  let r2 = SIZE - 1
  const thres = 0.2
  for (let i = 0; i < SIZE / 2; i++)
    if (Math.abs(buf[i]) < thres) {
      r1 = i
      break
    }
  for (let i = 1; i < SIZE / 2; i++)
    if (Math.abs(buf[SIZE - i]) < thres) {
      r2 = SIZE - i
      break
    }
  const b = buf.subarray(r1, r2)
  const n = b.length
  if (n < 8) return -1

  // Bound the lag to the musical range (min period at FMAX, max at FMIN).
  const minLag = Math.max(2, Math.floor(sampleRate / 1760))
  const maxLag = Math.min(n - 1, Math.ceil(sampleRate / 55))
  // (one buffer per analyser, kept : lags outside minLag..maxLag read as 0)
  const c = corr
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0
    for (let i = 0; i < n - lag; i++) s += b[i] * b[i + lag]
    c[lag] = s
  }
  // Walk past the initial descent, then take the highest correlation peak.
  let d = minLag
  while (d < maxLag && c[d] > c[d + 1]) d++
  let maxval = -1
  let maxpos = -1
  for (let i = d; i <= maxLag; i++)
    if (c[i] > maxval) {
      maxval = c[i]
      maxpos = i
    }
  if (maxpos <= 0) return -1
  let T0 = maxpos
  // Parabolic interpolation around the peak for sub-sample accuracy.
  const x1 = T0 - 1 >= minLag ? c[T0 - 1] : 0
  const x2 = c[T0]
  const x3 = T0 + 1 <= maxLag ? c[T0 + 1] : 0
  const a = (x1 + x3 - 2 * x2) / 2
  const bb = (x3 - x1) / 2
  if (a) T0 = T0 - bb / (2 * a)
  return T0 > 0 ? sampleRate / T0 : -1
}

/** The buffers one analyser's frames need (and its pitch throttle). */
export interface FrameBufs {
  freq: Uint8Array<ArrayBuffer>
  db: Float32Array<ArrayBuffer> // the same frame's spectrum in dB (the audio tab's display)
  time: Uint8Array<ArrayBuffer>
  timeF: Float32Array<ArrayBuffer> // float waveform (pitch)
  corr: Float32Array<ArrayBuffer> // the pitch's correlation by lag (one per analyser, not one per frame)
  prev: Float32Array<ArrayBuffer>
  n: number
}
export function frameBufs(an: AnalyserNode): FrameBufs {
  return {
    freq: new Uint8Array(an.frequencyBinCount),
    db: new Float32Array(an.frequencyBinCount),
    time: new Uint8Array(an.fftSize),
    timeF: new Float32Array(an.fftSize),
    corr: new Float32Array(an.fftSize),
    prev: new Float32Array(an.frequencyBinCount),
    n: 0
  }
}

/** One frame of features off an AnalyserNode (2048 points, smoothing 0.5) into
 *  `L` : the live input's maths, shared by the Audio Layer's mix so a modulator
 *  reacts to it exactly as to the same sound coming in. */
export function analyseFrame(an: AnalyserNode, fb: FrameBufs, L: AudioFeatures, dt: number, sampleRate: number): void {
  const freq = fb.freq
  const time = fb.time
  const prev = fb.prev
  an.getByteTimeDomainData(time)
  // ONE spectrum read a frame : each read at a later time runs a new FFT and
  // smooths again, so a second reader (the audio tab's spectrum) would change what
  // the modulators hear. The floats are kept for that display; the bytes are
  // derived from them as the analyser itself scales them.
  const db = fb.db
  an.getFloatFrequencyData(db)
  const lo = an.minDecibels, k = 255 / (an.maxDecibels - an.minDecibels)
  for (let i = 0; i < freq.length; i++) {
    const v = (db[i] - lo) * k
    freq[i] = v > 0 ? (v < 255 ? v : 255) : 0
  }

  // level : RMS of the centred time-domain waveform, lightly gained.
  let sum = 0
  for (let i = 0; i < time.length; i++) {
    const x = (time[i] - 128) / 128
    sum += x * x
  }
  L.level = Math.min(1, Math.sqrt(sum / time.length) * 2.5)

  const N = freq.length
  // bands : log-spaced groups across the spectrum.
  for (let b = 0; b < BANDS; b++) {
    const lo = Math.floor(Math.pow(N, b / BANDS))
    const hi = Math.max(lo + 1, Math.floor(Math.pow(N, (b + 1) / BANDS)))
    let s = 0
    for (let i = lo; i < hi && i < N; i++) s += freq[i]
    L.bands[b] = Math.min(1, (s / ((hi - lo) * 255)) * 1.5)
  }
  // centroid : energy-weighted mean bin, normalized.
  let num = 0
  let den = 0
  for (let i = 0; i < N; i++) {
    const m = freq[i]
    num += i * m
    den += m
  }
  L.centroid = den > 0 ? Math.min(1, (num / den / N) * 2) : 0
  // noisiness : spectral flatness (geometric mean / arithmetic mean of the
  // magnitude spectrum). ~0 for a pitched tone, ~1 for broadband hiss. Gated by
  // level so silence reads 0 (empty bins would otherwise flatten to ~1).
  let logSum = 0, linSum = 0
  for (let i = 1; i < N; i++) {
    const m = freq[i] / 255 + 1e-6
    logSum += Math.log(m)
    linSum += m
  }
  const cnt = N - 1
  const flat = linSum > 1e-6 ? Math.exp(logSum / cnt) / (linSum / cnt) : 0
  L.noisiness = L.level > 0.02 ? Math.min(1, flat * 2) : 0
  // flux : sum of positive magnitude increases vs the previous frame.
  let flux = 0
  for (let i = 0; i < N; i++) {
    const m = freq[i] / 255
    const d = m - prev[i]
    if (d > 0) flux += d
    prev[i] = m
  }
  L.flux = Math.min(1, flux / (N * 0.15))
  // transient : pulse on an onset (flux over threshold), else decay. The
  // decay is normalized to 60fps (^(dt·60)) so it falls at the same wall-clock
  // rate regardless of the actual frame rate.
  L.transient = L.flux > 0.32 ? 1 : L.transient * Math.pow(0.82, dt * 60)
  // pitch : autocorrelation on the float waveform, throttled (pitch moves
  // slowly, and the ACF is the heaviest step). Held across unvoiced frames.
  if (++fb.n % 3 === 0) {
    an.getFloatTimeDomainData(fb.timeF)
    const hz = autoCorrelate(fb.timeF, sampleRate, fb.corr)
    if (hz > 0) {
      // Log-map the fundamental over a musical span (A1 55 Hz → A6 1760 Hz).
      const t = (Math.log2(hz) - LOG_FMIN) / (LOG_FMAX - LOG_FMIN)
      L.pitch = Math.max(0, Math.min(1, t))
    }
    // Unvoiced (hz <= 0): hold the last pitch rather than flicker to 0.
  }
}

/** The six bands' edges in Hz, as analyseFrame groups the bins (bin i sits at
 *  i · rate / 2048; bin 0, the DC, is in no band) : [lo, hi] per band, the top
 *  band running to half the sample rate. `bins` : the analyser's bin count. */
export function bandEdgesHz(sampleRate: number, bins = 1024): Array<[number, number]> {
  const binHz = sampleRate / (2 * bins)
  const out: Array<[number, number]> = []
  for (let b = 0; b < BANDS; b++) {
    const lo = Math.floor(Math.pow(bins, b / BANDS))
    const hi = Math.max(lo + 1, Math.floor(Math.pow(bins, (b + 1) / BANDS)))
    out.push([lo * binHz, Math.min(bins, hi) * binHz])
  }
  return out
}

// ── A frequency band (Hz) : an audio modulator that listens to one part of the
// spectrum only. Each feature is the same maths as the whole sound's (analyseFrame),
// read on the bins between lo and hi of the live spectrum; flux, its transient and
// the held pitch keep their own memory per modulator (HzRangeState).
export const AUDIO_HZ_MAX = 20000
/** Is a band set (narrower than 0 to 20000 Hz) ? */
export function hzFiltered(lo?: number, hi?: number): boolean {
  return (lo ?? 0) > 0 || (hi ?? AUDIO_HZ_MAX) < AUDIO_HZ_MAX
}
export interface HzRangeState { prev: Float32Array | null; transient: number; pitch: number; at: number }
export const hzRangeState = (): HzRangeState => ({ prev: null, transient: 0, pitch: 0, at: 0 })

class AudioBus {
  /** Ingest mode : set by the App effect from the store. */
  mode: AudioMode = 'off'
  /** The merged, current frame : read by the mod engine + panel meters. */
  readonly current: Features = zero()

  private osc: Features = zero()
  private oscAt = -1e9
  private local: Features = zero()
  private localOn = false

  // Web Audio graph (local source)
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private stream: MediaStream | null = null
  private bufs: FrameBufs | null = null
  private sampleRate = 44100
  private lastTick = 0 // wall-clock of the previous tick(), for dt-aware decays

  // Monitoring / passthrough : route the local input straight to the output so
  // you can HEAR it (e.g. a Move on the interface's inputs) while it also drives
  // reactivity. Off by default (opt-in : no surprise audio). The gain + sink are
  // remembered here so a fresh startLocal rebuilds the same monitoring.
  private monitorGain: GainNode | null = null
  private monitorOn = false
  private monitorLevel = 0.8
  private monitorSink = '' // output device id ('' = system default)
  // The channels : the input's picked pair (or one, on both sides) and where the
  // monitor lands on its output device. Remembered for the next open.
  private inPick: ChPick = { ...CH_DEFAULT }
  private inRoute: InputPick | null = null
  private monitorPick: ChPick = { ...CH_DEFAULT }
  private monitorNodes: AudioNode[] = []
  /** How many channels the open input delivers (0 : none open). */
  inChannels = 0
  // STEMS : the device's other channels, each pair (or one channel) analysed apart
  // for the modulators that ask for it (each layer hears its own stem : a DAW's
  // tracks, Pure Data's voices on separate outputs). Made on the first ask, let go
  // with the input.
  private rawSrc: MediaStreamAudioSourceNode | null = null
  private stems = new Map<number, { an: AnalyserNode; fb: FrameBufs; feats: AudioFeatures; at: number }>()
  // The sample rate and buffer asked of the device; the one the input was
  // opened with (another reopens it : App compares them).
  private fmt: AudioFormat = { ...AUDIO_FORMAT_DEFAULT }
  openedFormat = ''

  // USB-noise denoiser : an adaptive multi-notch filter. `learnNoise` measures
  // the input's average spectrum, finds the narrowband peaks (mains hum + its
  // harmonics + the digital whine), and this filters them out in real time
  // (BiquadFilter notches : no added latency, unlike an STFT denoiser). Placed
  // BEFORE the analyser + monitor split, so the noise leaves both the sound you
  // hear AND the reactivity. Off + no notches = the raw signal, unchanged.
  private denoiseOn = false
  private notches: NoiseNotch[] = [] // learned notch targets (freq + Q)
  private preSplit: GainNode | null = null // feeds analyser + monitor
  private filterNodes: AudioNode[] = [] // hp + notches (rebuilt on change)
  private srcNode: AudioNode | null = null // the picked channels (two)
  private srcOut: AudioNode | null = null // what src currently feeds (for disconnect)
  private learnAnalyser: AnalyserNode | null = null // taps RAW src (for learning)
  private learnBuf: Float32Array<ArrayBuffer> | null = null
  // The audio tab's meters : one small analyser per picked channel (after the pick,
  // before the denoiser : what the device gives), one after the monitor's gain
  // (what the monitor plays). Time-domain reads only (RMS and peak), on demand.
  private chAn: AnalyserNode[] = []
  private monSplit: ChannelSplitterNode | null = null // the monitor's two sides, each its analyser
  private monAn: AnalyserNode[] = []
  private meterBuf = new Float32Array(METER_FFT)

  get localActive(): boolean {
    return this.localOn
  }

  /** What the last startLocal opened : 'chosen' (the device asked for, by its
   *  id or found again by its name), 'default' (the chosen one is not here : the
   *  default input instead), or 'none'. */
  opened: 'chosen' | 'default' | 'none' = 'none'
  // The input set to the Audio Layer : its analyser read in place of a device's.
  private layerSrc: LayerAnalyser | null = null
  private layerIn = false
  private layerAn: AnalyserNode | null = null
  /** Where the Audio Layer's analyser is found (App registers it). */
  setLayerSource(fn: LayerAnalyser): void {
    this.layerSrc = fn
  }
  /** Is the local input the Audio Layer (no device, nothing to monitor)? */
  get fromLayer(): boolean {
    return this.layerIn
  }
  /** The device id the last startLocal was for ('' : the default input); the id
   *  it was found again under when its name matched. A different id asked for
   *  reopens the input. */
  requested = ''
  // Each open's token : a newer one (another device, the input turned off) makes
  // an open still waiting on the system stale, and what it got is let go (it left
  // the microphone open, or a second stream and context running unheard).
  private req = 0
  // The input unplugged while open : it opens again when a device comes back.
  private lost: { id: string; label: string } | null = null
  private offDevices: (() => void) | null = null

  // ── Local Web Audio ────────────────────────────────────────────────
  async startLocal(deviceId?: string | null, label?: string | null): Promise<boolean> {
    this.stopLocal()
    const req = ++this.req
    this.opened = 'none'
    this.requested = deviceId ?? ''
    // The Audio Layer : no microphone, its analyser is read each frame (the
    // layer empty, the input is silence until something plays there).
    if (deviceId === LAYER_INPUT) {
      this.layerIn = true
      this.localOn = true
      this.opened = 'chosen'
      return true
    }
    let stream: MediaStream | null = null
    try {
      // Disable the browser's voice processing : an interface / line input (a
      // Move on inputs 1&2) wants the RAW signal, and AGC would flatten the very
      // dynamics reactivity + monitoring live on.
      const audioC: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // every channel the device gives, so one of them can be picked
        channelCount: { ideal: 32 },
        // the buffer asked for, as a latency (the capture is told too)
        ...(this.fmt.frames ? { latency: { ideal: this.fmt.frames / (this.fmt.rate || 48000) } } : {})
      }
      // The chosen device by its id; else found again by its name (an id is
      // not stable : another build of the app, another USB port); else the
      // default input, said so (a remembered device that was gone left the
      // input silent, the menu reading "Default input", no word of it).
      const md = navigator.mediaDevices
      let opened: 'chosen' | 'default' = 'chosen'
      // a newer open (or Audio off) came while this one waited : let it go
      const stale = (): boolean => {
        if (req === this.req) return false
        stream?.getTracks().forEach((t) => t.stop())
        stream = null
        return true
      }
      let foundAs = ''
      if (deviceId) {
        try {
          stream = await md.getUserMedia({ audio: { ...audioC, deviceId: { exact: deviceId } }, video: false })
        } catch {
          const same = label ? (await md.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label === label) : undefined
          if (stale()) return false
          if (same) {
            try {
              stream = await md.getUserMedia({ audio: { ...audioC, deviceId: { exact: same.deviceId } }, video: false })
              foundAs = same.deviceId
            } catch { /* below */ }
          }
          if (!stream) opened = 'default'
        }
        if (stale()) return false
      }
      if (!stream) stream = await md.getUserMedia({ audio: audioC, video: false })
      if (stale()) return false
      if (foundAs) this.requested = foundAs
      // Unplugged while open : it opens again once a device comes back.
      const tr = stream.getAudioTracks()[0]
      tr?.addEventListener('ended', () => {
        if (req !== this.req) return
        console.warn('[audio] the input was disconnected', tr.label)
        this.lost = { id: this.requested, label: tr.label || (label ?? '') }
        this.watchDevices()
      })
      const ctx = new AudioContext(contextOptions(this.fmt))
      this.openedFormat = formatKey(this.fmt)
      const raw = ctx.createMediaStreamSource(stream)
      this.rawSrc = raw
      // the picked channels : a pair, or one on both sides
      const nIn = Math.max(1, Math.min(32, tr?.getSettings().channelCount ?? 2))
      const route = new InputPick(ctx, raw, nIn, this.inPick)
      const src = route.out
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048 // 2048 samples ≈ 46ms : enough window for pitch
      analyser.smoothingTimeConstant = 0.5
      // preSplit gathers the (optionally denoised) signal and feeds both the
      // analyser (reactivity) and the monitor. The denoise chain sits src→preSplit.
      const preSplit = ctx.createGain()
      preSplit.connect(analyser)
      // A separate analyser tapped off the RAW src : learnNoise reads this so the
      // noise profile is measured pre-filter regardless of the denoise state.
      const learnAnalyser = ctx.createAnalyser()
      learnAnalyser.fftSize = 32768 // ~1.46Hz bins @48k : resolve 60Hz harmonic combs
      learnAnalyser.smoothingTimeConstant = 0
      src.connect(learnAnalyser)
      // Monitor path : preSplit → gain → output. Gain 0 while monitoring is off,
      // so the graph is always wired and toggling is a param change (no re-plumb).
      const monitorGain = ctx.createGain()
      monitorGain.gain.value = this.monitorOn ? this.monitorLevel : 0
      preSplit.connect(monitorGain)
      this.monitorGain = monitorGain
      // the meters : each picked channel (a mono pick : the same one twice), and
      // the monitor after its gain
      const chSplit = ctx.createChannelSplitter(2)
      src.connect(chSplit)
      this.chAn = [0, 1].map((i) => {
        const a = ctx.createAnalyser()
        a.fftSize = METER_FFT
        chSplit.connect(a, i)
        return a
      })
      // (an analyser mixes its channels down : one side alone would read 6 dB low)
      const monSplit = ctx.createChannelSplitter(2)
      this.monAn = [0, 1].map((i) => {
        const a = ctx.createAnalyser()
        a.fftSize = METER_FFT
        monSplit.connect(a, i)
        return a
      })
      this.monSplit = monSplit // (routeMonitor wires it, below)
      this.stream = stream
      this.ctx = ctx
      this.inRoute = route
      this.inChannels = nIn
      this.routeMonitor()
      if (this.monitorSink) this.applySink(ctx, this.monitorSink)
      this.srcNode = src
      this.preSplit = preSplit
      this.learnAnalyser = learnAnalyser
      this.learnBuf = new Float32Array(learnAnalyser.frequencyBinCount)
      this.analyser = analyser
      this.rebuildFilter() // wire src → [denoise?] → preSplit
      this.sampleRate = ctx.sampleRate
      this.bufs = frameBufs(analyser)
      this.localOn = true
      this.opened = opened
      return true
    } catch (e) {
      // a stream got before the failure (the context would not start) is let go
      if (stream && stream !== this.stream) (stream as MediaStream).getTracks().forEach((t) => t.stop())
      // (a stale open's failure is not this input's)
      if (req !== this.req) return false
      console.error('[audio] local input failed:', (e as Error).name, (e as Error).message)
      this.localOn = false
      return false
    }
  }

  /** While the input is lost : a device plugged in opens it again (the same
   *  one, by its id or its name; never another that became the default). */
  private watchDevices(): void {
    const md = navigator.mediaDevices
    if (this.offDevices || !md?.addEventListener) return
    const fn = (): void => {
      const l = this.lost
      if (!l) return
      void md.enumerateDevices().then((ds) => {
        if (this.lost !== l) return
        const back = ds.find((d) => d.kind === 'audioinput' && ((l.id && d.deviceId === l.id) || (!!l.label && d.label === l.label)))
        if (!back) return
        const opening = this.startLocal(back.deviceId, l.label)
        const mine = this.req // (startLocal took its token before its first wait)
        // not ready yet (an interface still waking) : the next device change
        // tries again, unless something else opened or closed the input since
        void opening.then((ok) => {
          if (!ok && this.req === mine) { this.lost = l; this.watchDevices() }
        })
      }).catch(() => {})
    }
    md.addEventListener('devicechange', fn)
    this.offDevices = () => md.removeEventListener('devicechange', fn)
  }

  stopLocal(): void {
    this.req++
    this.lost = null
    this.offDevices?.()
    this.offDevices = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.ctx?.close().catch(() => {})
    this.stream = null
    this.ctx = null
    this.rawSrc = null
    this.stems.clear()
    this.analyser = null
    this.monitorGain = null
    this.monitorNodes = []
    this.inRoute = null
    this.inChannels = 0
    this.openedFormat = ''
    this.preSplit = null
    this.srcNode = null
    this.srcOut = null
    this.learnAnalyser = null
    this.learnBuf = null
    this.chAn = []
    this.monAn = []
    this.monSplit = null
    this.filterNodes = []
    this.bufs = null
    this.layerIn = false
    this.layerAn = null
    this.localOn = false
    this.local = zero()
  }

  // ── USB-noise denoiser ────────────────────────────────────────────────
  /** Wire src → [denoise chain] → preSplit, matching the current denoise state
   *  and notch list. Called on start, toggle, and after learning. */
  private rebuildFilter(): void {
    const ctx = this.ctx, src = this.srcNode, preSplit = this.preSplit
    if (!ctx || !src || !preSplit) return
    // Tear down the previous src→… link + any old filter nodes.
    if (this.srcOut) { try { src.disconnect(this.srcOut) } catch { /* already gone */ } }
    for (const n of this.filterNodes) { try { n.disconnect() } catch { /* gone */ } }
    this.filterNodes = []

    if (!this.denoiseOn || this.notches.length === 0) {
      src.connect(preSplit) // bypass : raw signal, untouched
      this.srcOut = preSplit
      return
    }
    // High-pass to kill sub-rumble / DC offset, then a notch per learned target.
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 24
    hp.Q.value = 0.707
    let node: AudioNode = hp
    this.filterNodes.push(hp)
    const nyq = ctx.sampleRate / 2
    for (const nch of this.notches) {
      if (!(nch.f > 20 && nch.f < nyq * 0.98)) continue
      const nf = ctx.createBiquadFilter()
      nf.type = 'notch'
      nf.frequency.value = nch.f
      nf.Q.value = nch.q
      node.connect(nf)
      node = nf
      this.filterNodes.push(nf)
    }
    src.connect(hp)
    node.connect(preSplit)
    this.srcOut = hp
  }

  setDenoise(on: boolean): void {
    this.denoiseOn = on
    this.rebuildFilter()
  }
  /** Set the notches directly (e.g. restored from a saved profile). */
  setNotches(notches: NoiseNotch[]): void {
    this.notches = Array.isArray(notches) ? notches.filter((n) => n && Number.isFinite(n.f)).slice(0, 48) : []
    this.rebuildFilter()
  }
  denoiseNotches(): NoiseNotch[] {
    return this.notches.slice()
  }

  /** Measure the input's noise spectrum for `ms` (Move connected but SILENT),
   *  then MODEL a notch set : detect harmonic COMBS (mains hum, digital-clock
   *  series) and notch the whole series from the fundamental, plus individual
   *  notches for non-harmonic tones (the HF whine). Returns the notches. */
  async learnNoise(ms = 2500): Promise<NoiseNotch[]> {
    const an = this.learnAnalyser, buf = this.learnBuf
    if (!an || !buf) return this.notches
    const n = buf.length
    const acc = new Float64Array(n) // accumulate LINEAR magnitude
    let frames = 0
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
      const step = (): void => {
        an.getFloatFrequencyData(buf)
        for (let i = 0; i < n; i++) acc[i] += Math.pow(10, buf[i] / 20)
        frames++
        if (performance.now() - t0 < ms) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
    if (frames === 0) return this.notches
    const mag = new Float64Array(n)
    for (let i = 0; i < n; i++) mag[i] = acc[i] / frames
    const binHz = this.sampleRate / an.fftSize
    const kOf = (f: number): number => Math.round(f / binHz)

    // Local broadband floor : mean over a wide window excluding the ±3-bin peak.
    const W = Math.max(20, Math.round(120 / binHz)) // ~120Hz window
    const floor = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let sum = 0, cnt = 0
      for (let k = i - W; k <= i + W; k++) {
        if (k < 2 || k >= n || Math.abs(k - i) <= 3) continue
        sum += mag[k]; cnt++
      }
      floor[i] = cnt ? sum / cnt : mag[i]
    }
    // Prominence in dB above the local floor. `mag` is linear amplitude, so the
    // dB ratio is 20·log10 (not 10 — that earlier under-read every peak by half).
    const promDb = (k: number): number => 20 * Math.log10((mag[k] + 1e-20) / (floor[k] + 1e-20))
    // Bin of the strongest prominence within ±tolHz of f (-1 = none).
    const findNear = (f: number, tolHz: number): number => {
      const k0 = kOf(f), d = Math.max(1, Math.round(tolHz / binHz))
      let bestK = -1, best = -1e9
      for (let k = k0 - d; k <= k0 + d; k++) {
        if (k < 2 || k >= n - 1) continue
        const p = promDb(k)
        if (p > best) { best = p; bestK = k }
      }
      return bestK
    }
    const promAt = (f: number, tol: number): number => { const k = findNear(f, tol); return k < 0 ? -99 : promDb(k) }

    // Peaks : local maxima poking > 6dB above the floor.
    const rawPeaks: Array<{ f: number; prom: number }> = []
    for (let k = 3; k < n - 3; k++) {
      const f = k * binHz
      if (f < 40 || f > this.sampleRate * 0.47) continue
      const p = promDb(k)
      if (p > 6 && mag[k] >= mag[k - 1] && mag[k] >= mag[k + 1] && mag[k] >= mag[k - 2] && mag[k] >= mag[k + 2]) {
        rawPeaks.push({ f, prom: p })
      }
    }

    const MAX = 28
    const notches: NoiseNotch[] = []
    const near = (f: number): boolean => notches.some((nch) => Math.abs(nch.f - f) < Math.max(2.5, f * 0.008))

    // 1) Mains hum : pick 50 or 60 Hz by the stronger fundamental + 2nd harmonic,
    //    then seed the whole low series (hum is annoying even where a harmonic is
    //    weak). Snap each to the measured peak when there is one. Narrow notches.
    const mains = promAt(60, 3) + promAt(120, 4) >= promAt(50, 3) + promAt(100, 4) ? 60 : 50
    for (let h = 1; h <= 8; h++) {
      const f = mains * h
      const k = findNear(f, Math.max(2.5, f * 0.004))
      const ff = k >= 0 && promDb(k) > 3 ? k * binHz : f
      if (!near(ff)) notches.push({ f: ff, q: Math.min(45, Math.max(20, ff / 8)) })
    }
    // 2) The strongest individual tones. This captures the digital-clock series
    //    (its members are strong peaks) AND the HF whine, one notch each — no
    //    whole-comb over-notching that would dull the music. Narrower down low,
    //    a touch wider up top where the whine can drift.
    const strong = rawPeaks.filter((p) => p.prom > 8).sort((a, b) => b.prom - a.prom)
    for (const p of strong) {
      if (notches.length >= MAX) break
      if (near(p.f)) continue
      notches.push({ f: p.f, q: p.f < 500 ? 30 : p.f < 3000 ? 24 : 16 })
    }
    notches.sort((a, b) => a.f - b.f)
    this.notches = notches.slice(0, MAX)
    this.rebuildFilter()
    return this.notches
  }

  /** Monitoring / passthrough : hear the local input through the output. `on`
   *  gates it, `level` is the monitor gain (0..1). Applies live if input is up. */
  setMonitor(on: boolean, level: number): void {
    this.monitorOn = on
    this.monitorLevel = Math.max(0, Math.min(1, level))
    if (this.monitorGain) this.monitorGain.gain.value = on ? this.monitorLevel : 0
  }

  /** Choose the OUTPUT device the monitor plays to ('' = system default). */
  setMonitorSink(deviceId: string): void {
    this.monitorSink = deviceId || ''
    if (this.ctx) this.applySink(this.ctx, this.monitorSink)
  }

  /** The sample rate and buffer for the next open (App reopens the input when
   *  it differs from the one it was opened with). */
  setFormat(f: AudioFormat): void {
    this.fmt = { ...f }
  }

  get formatWanted(): string {
    return formatKey(this.fmt)
  }

  /** What the device really gives (null : no input open). */
  latencyInfo(): LatencyInfo | null {
    return latencyOf(this.ctx)
  }

  /** Which channels of the input it listens to (a pair, or one on both sides). */
  setInChannels(p: ChPick): void {
    this.inPick = { ...p }
    this.inRoute?.set(p)
  }

  /** The device channels the input really listens to, counted from 0 : the
   *  pair, or one channel for a mono pick (empty : no device open). A pick the
   *  device does not have plays 1+2 (clampPick), so this says which. */
  heardChannels(): number[] {
    if (!this.inRoute || this.layerIn) return []
    const p = pickFits(this.inPick, this.inChannels) ? this.inPick : CH_DEFAULT
    const [l, r] = clampPick(p, this.inChannels)
    return p.r < 0 || l === r ? [l] : [l, r]
  }

  /** One picked channel's level now (0 : the left of the pair, 1 : the right),
   *  RMS and peak, linear. Null : no device open. */
  channelLevel(i: number): { rms: number; peak: number } | null {
    const an = this.chAn[i]
    return an ? levelOf(an, this.meterBuf) : null
  }

  /** What the monitor plays now (after its level; silence while it is off). */
  monitorLevelNow(): { rms: number; peak: number } {
    if (this.monAn.length < 2) return { rms: 0, peak: 0 }
    const a = levelOf(this.monAn[0], this.meterBuf), b = levelOf(this.monAn[1], this.meterBuf)
    return { rms: Math.max(a.rms, b.rms), peak: Math.max(a.peak, b.peak) }
  }

  /** The input was unplugged while open (it opens again when it comes back). */
  get inputLost(): boolean {
    return !!this.lost
  }

  /** OSC features arrived in the last half second. */
  get oscFresh(): boolean {
    return performance.now() - this.oscAt < OSC_STALE_MS
  }

  /** Is the Audio Layer, as the input, playing something now? */
  get layerFed(): boolean {
    return this.layerIn && !!this.layerAn
  }

  /** Where the monitor lands on its output device (a pair, or summed onto one). */
  setMonitorChannels(p: ChPick): void {
    if (p.l === this.monitorPick.l && p.r === this.monitorPick.r) return
    this.monitorPick = { ...p }
    this.routeMonitor()
  }

  // The monitor to its channels : plain stereo for 1+2, else onto the picked
  // channels of the device (read again after the device changed).
  private routeMonitor(): void {
    const ctx = this.ctx, g = this.monitorGain
    if (!ctx || !g) return
    try { g.disconnect() } catch { /* not wired yet */ }
    // (that took the monitor's meter off too)
    if (this.monSplit) g.connect(this.monSplit)
    for (const n of this.monitorNodes) { try { n.disconnect() } catch { /* gone */ } }
    this.monitorNodes = []
    const dst = ctx.destination
    try {
      // (a pick this device does not have : plain stereo too)
      if (isDefaultPick(this.monitorPick) || !pickFits(this.monitorPick, dst.maxChannelCount)) {
        stereoDestination(dst)
        g.connect(dst)
        return
      }
      const r = outputRoute(ctx, dst, this.monitorPick)
      g.connect(r.input)
      this.monitorNodes = r.nodes
    } catch (e) {
      console.warn('[audio] monitor channels', e)
      stereoDestination(dst)
      g.connect(dst)
    }
  }

  // AudioContext.setSinkId (Chromium 110+) isn't in the TS DOM lib yet.
  // Another device can have another channel count : the monitor routes again.
  private applySink(ctx: AudioContext, id: string): void {
    const set = (ctx as unknown as { setSinkId?: (id: string) => Promise<void> }).setSinkId
    if (set) set.call(ctx, id).then(() => { if (this.ctx === ctx) this.routeMonitor() }).catch(() => { /* device gone / not permitted */ })
  }

  private computeLocal(dt: number): void {
    if (this.layerIn) {
      const L = this.layerSrc?.(dt) ?? null
      if (!L) {
        if (this.layerAn) { this.layerAn = null; this.bufs = null; this.local = zero() }
        return
      }
      // The layer's own analysis, run once this frame (a modulator FROM "AU all"
      // reads the same : the same analyser was analysed twice a frame), its
      // buffers for the spectrum and waveform readers.
      this.layerAn = L.an
      this.bufs = L.bufs
      this.local = L.feats
      this.sampleRate = L.sampleRate
      return
    }
    if (this.analyser && this.bufs) analyseFrame(this.analyser, this.bufs, this.local, dt, this.sampleRate)
  }

  // ── OSC source ─────────────────────────────────────────────────────
  /** Write one feature from an inbound /opsia/audio/* message. */
  setOscFeature(name: AudioFeatureName, value: number, band = 0): void {
    const v = Math.max(0, Math.min(1, value))
    const o = this.osc
    if (name === 'band') o.bands[Math.max(0, Math.min(BANDS - 1, band))] = v
    else o[name] = v
    this.oscAt = performance.now()
  }

  // ── Per-frame merge (App loop calls this before modEngine.tick) ─────
  tick(now: number): void {
    const dt = this.lastTick ? Math.min(0.1, (now - this.lastTick) / 1000) : 1 / 60
    this.lastTick = now
    if (this.localOn) this.computeLocal(dt)
    const c = this.current
    const oscFresh = now - this.oscAt < OSC_STALE_MS
    const src =
      this.mode === 'off'
        ? null
        : this.mode === 'osc'
          ? this.osc
          : this.mode === 'local'
            ? this.local
            : oscFresh
              ? this.osc
              : this.local // 'both' : OSC primary, local fallback
    if (!src) {
      c.level = c.flux = c.transient = c.centroid = c.pitch = c.noisiness = 0
      c.bands.fill(0)
      return
    }
    c.level = src.level
    c.flux = src.flux
    c.transient = src.transient
    c.centroid = src.centroid
    c.pitch = src.pitch
    c.noisiness = src.noisiness
    for (let i = 0; i < BANDS; i++) c.bands[i] = src.bands[i]
  }

  /** Read one feature (0..1) : the mod engine calls this per audio modulator. */
  feature(name: AudioFeatureName, band = 0): number {
    return readFeature(this.current, name, band)
  }

  /** A stem's analysis this frame (null : no local device input open, the Audio
   *  Layer as the input, or the device has no such channel). `code` : see stemOf. */
  private stem(code: number, now: number): { an: AnalyserNode; fb: FrameBufs; feats: AudioFeatures; at: number } | null {
    const ch = stemChannels(code)
    if (!ch || !this.ctx || !this.rawSrc || this.layerIn || !this.localOn) return null
    if (ch[0] >= this.inChannels || ch[1] >= this.inChannels) return null
    let st = this.stems.get(code)
    if (!st) {
      const ctx = this.ctx
      const split = ctx.createChannelSplitter(this.inChannels)
      const merge = ctx.createChannelMerger(2)
      this.rawSrc.connect(split)
      split.connect(merge, ch[0], 0)
      split.connect(merge, ch[1], 1)
      const an = ctx.createAnalyser()
      an.fftSize = 2048
      an.smoothingTimeConstant = 0.5
      merge.connect(an)
      st = { an, fb: frameBufs(an), feats: zero(), at: 0 }
      this.stems.set(code, st)
    }
    // analysed once a frame, whoever asks first
    if (now - st.at > 4) {
      const dt = st.at ? Math.min(0.1, (now - st.at) / 1000) : 1 / 60
      analyseFrame(st.an, st.fb, st.feats, dt, this.sampleRate)
      st.at = now
    }
    return st
  }

  /** One feature (0..1) of a stem (its channels apart from the input's pick); the
   *  whole input's when the stem cannot be heard (no such channel, OSC, the layer). */
  stemFeature(code: number, name: AudioFeatureName, band: number, now: number): number {
    const st = this.stem(code, now)
    return st ? readFeature(st.feats, name, band) : this.feature(name, band)
  }

  /** A stem's feature read only between lo and hi Hz of its own spectrum. */
  stemFeatureInRange(code: number, name: AudioFeatureName, band: number, lo: number, hi: number, hs: HzRangeState, now: number): number {
    const st = this.stem(code, now)
    if (!st) return this.featureInRange(name, band, lo, hi, hs, now)
    return rangeFeature(st.fb.freq, this.sampleRate, st.feats.pitch, name, band, lo, hi, hs, now)
  }

  /** The stems the open input offers : its pairs, then each channel alone. */
  stemChoices(): Array<{ code: number; label: string }> {
    const n = this.localOn && !this.layerIn ? this.inChannels : 0
    const out: Array<{ code: number; label: string }> = []
    for (let k = 1; 2 * k <= n; k++) out.push({ code: k, label: `IN ${2 * k - 1}+${2 * k}` })
    for (let c = 1; c <= n && n > 1; c++) out.push({ code: 100 + c, label: `IN ${c}` })
    return out
  }

  /** One feature (0..1) read only between lo and hi Hz of the live spectrum.
   *  Without a spectrum (OSC features only, no local input) : the whole sound's. */
  featureInRange(name: AudioFeatureName, band: number, lo: number, hi: number, st: HzRangeState, now: number): number {
    const freq = this.mode === 'off' || this.mode === 'osc' ? null : this.spectrumBytes()
    if (!freq || !this.sampleRate) return this.feature(name, band)
    return rangeFeature(freq, this.sampleRate, this.current.pitch, name, band, lo, hi, st, now)
  }

  /** Live spectrum magnitudes (0..255) : null unless LOCAL audio is running
   *  (OSC mode carries only reduced features, not the buffer). For the
   *  Parametric generator's audio-buffer→texture read. */
  spectrumBytes(): Uint8Array | null {
    return this.localOn && (!this.layerIn || this.layerAn) ? this.bufs?.freq ?? null : null
  }
  /** The live spectrum in dB, off the same analyser (and the same FFT : read
   *  in the frame the features read it) as floats, for the audio tab's display :
   *  the bytes stop at the analyser's -30 dB top, where a -12 dBFS tone already
   *  sits. Null : no local spectrum (OSC only, nothing open, an empty layer). */
  spectrumDb(): Float32Array<ArrayBuffer> | null {
    return this.localOn && (!this.layerIn || this.layerAn) ? this.bufs?.db ?? null : null
  }
  /** The live input's sample rate (Hz) : what the spectrum bins are in. */
  sampleRateHz(): number {
    return this.sampleRate
  }
  /** Live time-domain waveform (0..255, centred at 128) : local only. */
  waveformBytes(): Uint8Array | null {
    return this.localOn && (!this.layerIn || this.layerAn) ? this.bufs?.time ?? null : null
  }
}

/** One feature (0..1) read only between lo and hi Hz of a spectrum (freq : the
 *  analyser's bytes; pitch : the source's pitch, 0..1, kept while inside the band). */
function rangeFeature(freq: Uint8Array, sampleRate: number, pitchNow: number, name: AudioFeatureName, band: number, lo: number, hi: number, st: HzRangeState, now: number): number {
    if (lo > hi) { const t = lo; lo = hi; hi = t }
    const N = freq.length
    const binHz = sampleRate / (2 * N)
    const i0 = Math.max(0, Math.min(N - 1, Math.floor(lo / binHz)))
    const i1 = Math.min(N, Math.max(i0 + 1, Math.floor(hi / binHz) + 1)) // exclusive
    const n = i1 - i0
    const dt = st.at ? Math.min(0.1, (now - st.at) / 1000) : 1 / 60
    st.at = now
    // the band's level : the RMS of its magnitudes, gained like the six bands (a
    // mean let one loud tone in a wide band read almost nothing)
    let sum = 0
    for (let i = i0; i < i1; i++) { const m = freq[i] / 255; sum += m * m }
    const level = Math.min(1, Math.sqrt(sum / n) * 1.5)
    // flux (and its transient) on the band's own bins, every call, so the memory
    // stays one frame behind whatever feature is read
    if (!st.prev || st.prev.length !== N) st.prev = new Float32Array(N)
    let flux = 0
    for (let i = i0; i < i1; i++) {
      const m = freq[i] / 255
      const d = m - st.prev[i]
      if (d > 0) flux += d
      st.prev[i] = m
    }
    flux = Math.min(1, flux / (n * 0.15))
    st.transient = flux > 0.32 ? 1 : st.transient * Math.pow(0.82, dt * 60)
    // the pitch : the input's, kept only while it falls inside the band (held else)
    const p = pitchNow
    if (p > 0) {
      const hz = Math.pow(2, LOG_FMIN + p * (LOG_FMAX - LOG_FMIN))
      if (hz >= lo && hz <= hi) st.pitch = p
    }
    switch (name) {
      case 'level': return level
      case 'flux': return flux
      case 'transient': return st.transient
      case 'pitch': return st.pitch
      case 'band': {
        // one of the six log bands, cut to the band (empty : 0)
        const b = Math.max(0, Math.min(BANDS - 1, band))
        const blo = Math.max(i0, Math.floor(Math.pow(N, b / BANDS)))
        const bhi = Math.min(i1, Math.max(Math.floor(Math.pow(N, b / BANDS)) + 1, Math.floor(Math.pow(N, (b + 1) / BANDS))))
        if (bhi <= blo) return 0
        let s = 0
        for (let i = blo; i < bhi; i++) s += freq[i]
        return Math.min(1, (s / ((bhi - blo) * 255)) * 1.5)
      }
      case 'centroid': {
        // where the energy sits inside the band : 0 at lo, 1 at hi
        let num = 0, den = 0
        for (let i = i0; i < i1; i++) { num += (i - i0) * freq[i]; den += freq[i] }
        return den > 0 && n > 1 ? Math.min(1, num / den / (n - 1)) : 0
      }
      case 'noisiness': {
        if (level <= 0.02 || n < 2) return 0
        let logSum = 0, linSum = 0
        for (let i = i0; i < i1; i++) { const m = freq[i] / 255 + 1e-6; logSum += Math.log(m); linSum += m }
        const flat = linSum > 1e-6 ? Math.exp(logSum / n) / (linSum / n) : 0
        return Math.min(1, flat * 2)
      }
      default: return 0
    }
  }

/** A stem's code to its two channels (0-based) : 1..16 the pair 2k-1 + 2k; 101..132 one
 *  channel on both sides. 0 (or anything else) : none, the input as picked. */
export function stemChannels(code: number | undefined): [number, number] | null {
  if (!code) return null
  if (code >= 1 && code <= 16) return [2 * code - 2, 2 * code - 1]
  if (code >= 101 && code <= 132) return [code - 101, code - 101]
  return null
}

// One bus per renderer. The App loop ticks it; audio modulators + the Audio
// panel read it.
export const audioBus = new AudioBus()

// Dev only : a hot update re-runs this module and makes a new bus ; the previous
// one would keep its input (and its monitor, on the speakers) open with nothing
// left to close it. The new bus closes the old one. Compiled out of a real build.
if (import.meta.hot) {
  const g = globalThis as { __opsiaAudioBus?: AudioBus }
  g.__opsiaAudioBus?.stopLocal()
  g.__opsiaAudioBus = audioBus
}
