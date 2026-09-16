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

const BANDS = 6
export const AUDIO_BANDS = BANDS

// One denoiser notch : centre frequency (Hz) + Q (higher = narrower). Learned by
// analysing the input's noise (mains-hum combs, digital-clock combs, HF whine).
export interface NoiseNotch { f: number; q: number }

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

// Pitch mapping span : A1 (55 Hz) to A6 (1760 Hz), log-scaled to 0..1.
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
  // Explicit ArrayBuffer backing so the AnalyserNode byte-data calls typecheck
  // (TS 5.7 typed-array generics reject the ArrayBufferLike default).
  private freq: Uint8Array<ArrayBuffer> | null = null
  private time: Uint8Array<ArrayBuffer> | null = null
  private timeF: Float32Array<ArrayBuffer> | null = null // float waveform (pitch)
  private prevMag: Float32Array<ArrayBuffer> | null = null
  private sampleRate = 44100
  private pitchCounter = 0
  private lastTick = 0 // wall-clock of the previous tick(), for dt-aware decays

  // Monitoring / passthrough : route the local input straight to the output so
  // you can HEAR it (e.g. a Move on the interface's inputs) while it also drives
  // reactivity. Off by default (opt-in : no surprise audio). The gain + sink are
  // remembered here so a fresh startLocal rebuilds the same monitoring.
  private monitorGain: GainNode | null = null
  private monitorOn = false
  private monitorLevel = 0.8
  private monitorSink = '' // output device id ('' = system default)

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
  private srcNode: MediaStreamAudioSourceNode | null = null
  private srcOut: AudioNode | null = null // what src currently feeds (for disconnect)
  private learnAnalyser: AnalyserNode | null = null // taps RAW src (for learning)
  private learnBuf: Float32Array<ArrayBuffer> | null = null

  get localActive(): boolean {
    return this.localOn
  }

  // ── Local Web Audio ────────────────────────────────────────────────
  async startLocal(deviceId?: string | null): Promise<boolean> {
    this.stopLocal()
    try {
      // Disable the browser's voice processing : an interface / line input (a
      // Move on inputs 1&2) wants the RAW signal, and AGC would flatten the very
      // dynamics reactivity + monitoring live on.
      const audioC: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
      if (deviceId) audioC.deviceId = { exact: deviceId }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioC, video: false })
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
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
      monitorGain.connect(ctx.destination)
      this.monitorGain = monitorGain
      if (this.monitorSink) this.applySink(ctx, this.monitorSink)
      this.stream = stream
      this.ctx = ctx
      this.srcNode = src
      this.preSplit = preSplit
      this.learnAnalyser = learnAnalyser
      this.learnBuf = new Float32Array(learnAnalyser.frequencyBinCount)
      this.analyser = analyser
      this.rebuildFilter() // wire src → [denoise?] → preSplit
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
    this.monitorGain = null
    this.preSplit = null
    this.srcNode = null
    this.srcOut = null
    this.learnAnalyser = null
    this.learnBuf = null
    this.filterNodes = []
    this.freq = this.time = null
    this.timeF = null
    this.prevMag = null
    this.pitchCounter = 0
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

  // AudioContext.setSinkId (Chromium 110+) isn't in the TS DOM lib yet.
  private applySink(ctx: AudioContext, id: string): void {
    const set = (ctx as unknown as { setSinkId?: (id: string) => Promise<void> }).setSinkId
    if (set) set.call(ctx, id).catch(() => { /* device gone / not permitted */ })
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
              : this.local // 'both' : OSC primary, local fallback
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

  /** Read one feature (0..1) : the mod engine calls this per audio modulator. */
  feature(name: AudioFeatureName, band = 0): number {
    const c = this.current
    if (name === 'band') return c.bands[Math.max(0, Math.min(BANDS - 1, band))] ?? 0
    return c[name] as number
  }

  /** Live spectrum magnitudes (0..255) : null unless LOCAL audio is running
   *  (OSC mode carries only reduced features, not the buffer). For the
   *  Parametric generator's audio-buffer→texture read. */
  spectrumBytes(): Uint8Array | null {
    return this.localOn ? this.freq : null
  }
  /** Live time-domain waveform (0..255, centred at 128) : local only. */
  waveformBytes(): Uint8Array | null {
    return this.localOn ? this.time : null
  }
}

// One bus per renderer. The App loop ticks it; audio modulators + the Audio
// panel read it.
export const audioBus = new AudioBus()
