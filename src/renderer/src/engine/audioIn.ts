// Audio ingest bus (Slab 1) — the first "voice" of the audiovisual-reactivity
// chapter. Two sources feed one merged AudioFeatures frame:
//
//   • Pandore over OSC  — /opsia/audio/* messages land here (setOscFeature),
//     the primary path (Pandore is the audio brain).
//   • Local Web Audio   — a mic / line / loopback input analysed in-renderer,
//     the standalone fallback.
//
// The modulation engine reads a single feature per `audio` modulator each frame
// (via `feature()`), so nothing here touches the React store — same discipline
// as the mod meters. Merge policy: OSC primary, local fills in when OSC is stale
// (mode 'both'); or force one source.
//
// Design rule for the chapter: prefer DISCONTINUITY (transient/flux) over gain —
// the salient signal dominates cross-modal perception (Basanta / Shimojo-Shams).

const BANDS = 6
export const AUDIO_BANDS = BANDS

export type AudioFeatureName = 'level' | 'flux' | 'transient' | 'centroid' | 'band' | 'pitch'
export const AUDIO_FEATURES: AudioFeatureName[] = [
  'level',
  'flux',
  'transient',
  'centroid',
  'band',
  'pitch'
]

export type AudioMode = 'off' | 'osc' | 'local' | 'both'

interface Features {
  level: number // RMS loudness 0..1
  flux: number // spectral flux 0..1 (onset energy)
  transient: number // gated onset impulse, decays 0..1
  centroid: number // spectral brightness 0..1
  bands: number[] // BANDS log-spaced band energies 0..1
  pitch: number // 0..1 (OSC-supplied; local leaves 0 for now)
}

function zero(): Features {
  return { level: 0, flux: 0, transient: 0, centroid: 0, bands: new Array(BANDS).fill(0), pitch: 0 }
}

const OSC_STALE_MS = 500 // in 'both', OSC older than this yields to local

// Pitch mapping span — A1 (55 Hz) to A6 (1760 Hz), log-scaled to 0..1.
const LOG_FMIN = Math.log2(55)
const LOG_FMAX = Math.log2(1760)

// Autocorrelation pitch detection (ACF + RMS gate + parabolic interpolation),
// after Chris Wilson's PitchDetect. Returns the fundamental in Hz, or -1 when
// the frame is too quiet / unvoiced to trust. Lag search is bounded to the
// musical range so the cost stays contained.
function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length
  let rms = 0
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / SIZE)
  if (rms < 0.01) return -1 // too quiet — unreliable

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
  const c = new Float32Array(maxLag + 1)
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
  const x1 = c[T0 - 1] ?? 0
  const x2 = c[T0]
  const x3 = c[T0 + 1] ?? 0
  const a = (x1 + x3 - 2 * x2) / 2
  const bb = (x3 - x1) / 2
  if (a) T0 = T0 - bb / (2 * a)
  return T0 > 0 ? sampleRate / T0 : -1
}

class AudioBus {
  /** Ingest mode — set by the App effect from the store. */
  mode: AudioMode = 'off'
  /** The merged, current frame — read by the mod engine + panel meters. */
  readonly current: Features = zero()

  private osc: Features = zero()
  private oscAt = -1e9
  private local: Features = zero()
  private localOn = false

  // Web Audio graph (local source)
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private stream: MediaStream | null = null
  // Explicit ArrayBuffer backing so the AnalyserNode byte-data calls typecheck
  // (TS 5.7 typed-array generics reject the ArrayBufferLike default).
  private freq: Uint8Array<ArrayBuffer> | null = null
  private time: Uint8Array<ArrayBuffer> | null = null
  private timeF: Float32Array<ArrayBuffer> | null = null // float waveform (pitch)
  private prevMag: Float32Array<ArrayBuffer> | null = null
  private sampleRate = 44100
  private pitchCounter = 0
  private lastTick = 0 // wall-clock of the previous tick(), for dt-aware decays

  get localActive(): boolean {
    return this.localOn
  }

  // ── Local Web Audio ────────────────────────────────────────────────
  async startLocal(deviceId?: string | null): Promise<boolean> {
    this.stopLocal()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false
      })
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048 // 2048 samples ≈ 46ms — enough window for pitch
      analyser.smoothingTimeConstant = 0.5
      src.connect(analyser)
      this.stream = stream
      this.ctx = ctx
      this.analyser = analyser
      this.sampleRate = ctx.sampleRate
      this.freq = new Uint8Array(analyser.frequencyBinCount)
      this.time = new Uint8Array(analyser.fftSize)
      this.timeF = new Float32Array(analyser.fftSize)
      this.prevMag = new Float32Array(analyser.frequencyBinCount)
      this.localOn = true
      return true
    } catch (e) {
      console.error('[audio] local input failed:', (e as Error).message)
      this.localOn = false
      return false
    }
  }

  stopLocal(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.ctx?.close().catch(() => {})
    this.stream = null
    this.ctx = null
    this.analyser = null
    this.freq = this.time = null
    this.timeF = null
    this.prevMag = null
    this.pitchCounter = 0
    this.localOn = false
    this.local = zero()
  }

  private computeLocal(dt: number): void {
    const an = this.analyser
    const freq = this.freq
    const time = this.time
    const prev = this.prevMag
    if (!an || !freq || !time || !prev) return
    an.getByteTimeDomainData(time)
    an.getByteFrequencyData(freq)
    const L = this.local

    // level — RMS of the centred time-domain waveform, lightly gained.
    let sum = 0
    for (let i = 0; i < time.length; i++) {
      const x = (time[i] - 128) / 128
      sum += x * x
    }
    L.level = Math.min(1, Math.sqrt(sum / time.length) * 2.5)

    const N = freq.length
    // bands — log-spaced groups across the spectrum.
    for (let b = 0; b < BANDS; b++) {
      const lo = Math.floor(Math.pow(N, b / BANDS))
      const hi = Math.max(lo + 1, Math.floor(Math.pow(N, (b + 1) / BANDS)))
      let s = 0
      for (let i = lo; i < hi && i < N; i++) s += freq[i]
      L.bands[b] = Math.min(1, (s / ((hi - lo) * 255)) * 1.5)
    }
    // centroid — energy-weighted mean bin, normalized.
    let num = 0
    let den = 0
    for (let i = 0; i < N; i++) {
      const m = freq[i]
      num += i * m
      den += m
    }
    L.centroid = den > 0 ? Math.min(1, (num / den / N) * 2) : 0
    // flux — sum of positive magnitude increases vs the previous frame.
    let flux = 0
    for (let i = 0; i < N; i++) {
      const m = freq[i] / 255
      const d = m - prev[i]
      if (d > 0) flux += d
      prev[i] = m
    }
    L.flux = Math.min(1, flux / (N * 0.15))
    // transient — pulse on an onset (flux over threshold), else decay. The
    // decay is normalized to 60fps (^(dt·60)) so it falls at the same wall-clock
    // rate regardless of the actual frame rate.
    L.transient = L.flux > 0.32 ? 1 : L.transient * Math.pow(0.82, dt * 60)
    // pitch — autocorrelation on the float waveform, throttled (pitch moves
    // slowly, and the ACF is the heaviest step). Held across unvoiced frames.
    if (this.timeF && ++this.pitchCounter % 3 === 0) {
      this.analyser!.getFloatTimeDomainData(this.timeF)
      const hz = autoCorrelate(this.timeF, this.sampleRate)
      if (hz > 0) {
        // Log-map the fundamental over a musical span (A1 55 Hz → A6 1760 Hz).
        const t = (Math.log2(hz) - LOG_FMIN) / (LOG_FMAX - LOG_FMIN)
        L.pitch = Math.max(0, Math.min(1, t))
      }
      // Unvoiced (hz <= 0): hold the last pitch rather than flicker to 0.
    }
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
              : this.local // 'both' — OSC primary, local fallback
    if (!src) {
      c.level = c.flux = c.transient = c.centroid = c.pitch = 0
      c.bands.fill(0)
      return
    }
    c.level = src.level
    c.flux = src.flux
    c.transient = src.transient
    c.centroid = src.centroid
    c.pitch = src.pitch
    for (let i = 0; i < BANDS; i++) c.bands[i] = src.bands[i]
  }

  /** Read one feature (0..1) — the mod engine calls this per audio modulator. */
  feature(name: AudioFeatureName, band = 0): number {
    const c = this.current
    if (name === 'band') return c.bands[Math.max(0, Math.min(BANDS - 1, band))] ?? 0
    return c[name] as number
  }
}

// One bus per renderer. The App loop ticks it; audio modulators + the Audio
// panel read it.
export const audioBus = new AudioBus()
