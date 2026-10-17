// A sound file's (or a film's soundtrack's) analysis, once, for good : what the
// audio modulators read at a clip's PLAYHEAD, and the waveform the audio player
// draws. ffmpeg decodes the sound to mono 48 kHz floats on a pipe; every 1/60 s
// the same analysis the live input runs is computed here (audioIn.ts : an
// AnalyserNode of 2048 points, smoothing 0.5, its byte dB scale -100..-30), so
// a modulator reacts to a film's sound as it would to the same sound played
// into the input. Read at the playhead, it follows the clip at any speed, in
// reverse, scratched or in grains, where the film's own sound is silent.
//
// The file : a small JSON header, then 13 bytes a frame (level, flux, centroid,
// six bands, pitch, noisiness; 0..255; then the true RMS and peak in dBFS,
// -90..0 → 0..255, for the meters) at 60 frames a second, then the waveform's
// min / max (int8) at 400 a second. About 2.8 MB an hour.
//
// One file at a time (a long film decodes in seconds, but two at once doubled
// the time of each), each run bounded.

import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { children, resolveFfmpeg, videoCacheDir } from './videoConvert'

export const AA_RATE = 60 // feature frames a second (the live input's cadence)
export const AA_PEAK_RATE = 400 // waveform buckets a second
export const AA_FEATS = 13 // level, flux, centroid, 6 bands, pitch, noisiness, rms dB, peak dB
const SR = 48000
const HOP = SR / AA_RATE // 800 samples
const PEAK_N = SR / AA_PEAK_RATE // 120 samples
const FFT = 2048
const BINS = FFT / 2
const BANDS = 6
const VERSION = 2
const IDLE_MS = 60000 // no sound out of ffmpeg for this long : killed

export interface AudioAnalysis {
  ok: boolean
  /** The file had no sound at all. */
  silent?: boolean
  error?: string
  /** Seconds of sound analysed. */
  duration?: number
  frames?: number
  rate?: number
  peakRate?: number
  /** `frames` × AA_FEATS bytes, then the peaks (2 × int8 a bucket). */
  data?: Uint8Array
  peaks?: number
}

// ── the analyser, as the live one ────────────────────────────────────────────

const blackman = new Float64Array(FFT)
for (let i = 0; i < FFT; i++) {
  const t = i / FFT
  blackman[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t)
}

/** In-place radix-2 FFT of (re, im), length a power of two. */
function makeFft(n: number): (re: Float64Array, im: Float64Array, inverse?: boolean) => void {
  const levels = Math.log2(n) | 0
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b)
    rev[i] = r
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n) }
  return (re, im, inverse = false) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
    }
    const sg = inverse ? 1 : -1
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = cos[k], wi = sg * sin[k]
          const a = i + j, b = a + half
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr; im[b] = im[a] - ti
          re[a] += tr; im[a] += ti
        }
      }
    }
  }
}

const fft2048 = makeFft(FFT)
const fft4096 = makeFft(FFT * 2)

class Analyzer {
  private ring = new Float32Array(FFT) // the last 2048 samples
  private pos = 0
  private smooth = new Float64Array(BINS) // the analyser's smoothed magnitudes
  private prev = new Float64Array(BINS) // last frame's bytes / 255 (flux)
  private bytes = new Uint8Array(BINS)
  private re = new Float64Array(FFT)
  private im = new Float64Array(FFT)
  private acRe = new Float64Array(FFT * 2)
  private acIm = new Float64Array(FFT * 2)
  private frame = 0
  private pitch = 0
  private peakMin = 1
  private peakMax = -1
  private peakCount = 0
  private hopCount = 0
  private hopPeak = 0 // the loudest sample since the last frame
  readonly feats: number[] = []
  readonly peaks: number[] = []

  push(x: Float32Array): void {
    for (let i = 0; i < x.length; i++) {
      const v = x[i]
      const av = v < 0 ? -v : v
      if (av > this.hopPeak) this.hopPeak = av
      this.ring[this.pos] = v
      this.pos = (this.pos + 1) & (FFT - 1)
      if (v < this.peakMin) this.peakMin = v
      if (v > this.peakMax) this.peakMax = v
      if (++this.peakCount === PEAK_N) {
        this.peaks.push(Math.max(-127, Math.min(127, Math.round(this.peakMin * 127))), Math.max(-127, Math.min(127, Math.round(this.peakMax * 127))))
        this.peakMin = 1; this.peakMax = -1; this.peakCount = 0
      }
      if (++this.hopCount === HOP) { this.hopCount = 0; this.analyse() }
    }
  }

  /** One frame : audioIn.ts computeLocal, on the last 2048 samples. */
  private analyse(): void {
    const { ring, re, im, smooth, prev, bytes } = this
    // time domain : the analyser's bytes (128 at rest), the level from them
    let sum = 0, sq = 0
    for (let i = 0; i < FFT; i++) {
      const s = ring[(this.pos + i) & (FFT - 1)]
      sq += s * s
      const b = Math.max(0, Math.min(255, Math.floor(128 * (1 + s))))
      const x = (b - 128) / 128
      sum += x * x
      re[i] = s * blackman[i]
      im[i] = 0
    }
    const level = Math.min(1, Math.sqrt(sum / FFT) * 2.5)
    // the spectrum : magnitude / size, smoothed 0.5, dB, -100..-30 → 0..255
    fft2048(re, im)
    for (let k = 0; k < BINS; k++) {
      const m = Math.hypot(re[k], im[k]) / FFT
      smooth[k] = 0.5 * smooth[k] + 0.5 * m
      const db = smooth[k] > 0 ? 20 * Math.log10(smooth[k]) : -Infinity
      bytes[k] = Math.max(0, Math.min(255, Math.floor((255 / 70) * (db + 100))))
    }
    const N = BINS
    const bands: number[] = []
    for (let b = 0; b < BANDS; b++) {
      const lo = Math.floor(Math.pow(N, b / BANDS))
      const hi = Math.max(lo + 1, Math.floor(Math.pow(N, (b + 1) / BANDS)))
      let s = 0
      for (let i = lo; i < hi && i < N; i++) s += bytes[i]
      bands.push(Math.min(1, (s / ((hi - lo) * 255)) * 1.5))
    }
    let num = 0, den = 0
    for (let i = 0; i < N; i++) { num += i * bytes[i]; den += bytes[i] }
    const centroid = den > 0 ? Math.min(1, (num / den / N) * 2) : 0
    let logSum = 0, linSum = 0
    for (let i = 1; i < N; i++) { const m = bytes[i] / 255 + 1e-6; logSum += Math.log(m); linSum += m }
    const cnt = N - 1
    const flat = linSum > 1e-6 ? Math.exp(logSum / cnt) / (linSum / cnt) : 0
    const noisiness = level > 0.02 ? Math.min(1, flat * 2) : 0
    let flux = 0
    for (let i = 0; i < N; i++) { const m = bytes[i] / 255; const d = m - prev[i]; if (d > 0) flux += d; prev[i] = m }
    flux = Math.min(1, flux / (N * 0.15))
    // pitch : every third frame, held over unvoiced ones (as live)
    if (++this.frame % 3 === 0) {
      const hz = this.autoCorrelate()
      if (hz > 0) this.pitch = Math.max(0, Math.min(1, (Math.log2(hz) - Math.log2(55)) / (Math.log2(1760) - Math.log2(55))))
    }
    const q = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)))
    // the meters' own reading : the window's true RMS and the hop's peak, dBFS
    const qdb = (lin: number): number => (lin > 0 ? Math.max(0, Math.min(255, Math.round(((20 * Math.log10(lin) + 90) / 90) * 255))) : 0)
    this.feats.push(q(level), q(flux), q(centroid), ...bands.map(q), q(this.pitch), q(noisiness), qdb(Math.sqrt(sq / FFT)), qdb(this.hopPeak))
    this.hopPeak = 0
  }

  /** audioIn.ts autoCorrelate (the same gate, trim and peak walk), its
   *  correlation done through an FFT : the direct sum, a thousand lags over 2048
   *  samples, made an hour of sound cost minutes. */
  private autoCorrelate(): number {
    const ring = this.ring
    const buf = new Float32Array(FFT)
    let rms = 0
    for (let i = 0; i < FFT; i++) { const s = ring[(this.pos + i) & (FFT - 1)]; buf[i] = s; rms += s * s }
    rms = Math.sqrt(rms / FFT)
    if (rms < 0.01) return -1
    let r1 = 0, r2 = FFT - 1
    for (let i = 0; i < FFT / 2; i++) if (Math.abs(buf[i]) < 0.2) { r1 = i; break }
    for (let i = 1; i < FFT / 2; i++) if (Math.abs(buf[FFT - i]) < 0.2) { r2 = FFT - i; break }
    const n = r2 - r1
    if (n < 8) return -1
    const { acRe, acIm } = this
    acRe.fill(0); acIm.fill(0)
    for (let i = 0; i < n; i++) acRe[i] = buf[r1 + i]
    fft4096(acRe, acIm)
    for (let k = 0; k < acRe.length; k++) { acRe[k] = acRe[k] * acRe[k] + acIm[k] * acIm[k]; acIm[k] = 0 }
    fft4096(acRe, acIm, true)
    const scale = 1 / acRe.length
    const minLag = Math.max(2, Math.floor(SR / 1760))
    const maxLag = Math.min(n - 1, Math.ceil(SR / 55))
    const c = (lag: number): number => (lag >= 0 && lag <= maxLag ? acRe[lag] * scale : 0)
    let d = minLag
    while (d < maxLag && c(d) > c(d + 1)) d++
    let maxval = -1, maxpos = -1
    for (let i = d; i <= maxLag; i++) if (c(i) > maxval) { maxval = c(i); maxpos = i }
    if (maxpos <= 0) return -1
    let T0 = maxpos
    const x1 = c(T0 - 1), x2 = c(T0), x3 = c(T0 + 1)
    const a = (x1 + x3 - 2 * x2) / 2, bb = (x3 - x1) / 2
    if (a) T0 = T0 - bb / (2 * a)
    return T0 > 0 ? SR / T0 : -1
  }
}

// ── the cache ────────────────────────────────────────────────────────────────

function pathsFor(src: string): { out: string; none: string } {
  const st = statSync(src)
  const key = createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}|aa${VERSION}`).digest('hex').slice(0, 20)
  const dir = videoCacheDir()
  mkdirSync(dir, { recursive: true })
  return { out: join(dir, `${key}.aa`), none: join(dir, `${key}.aa.none`) }
}

function readCache(file: string): AudioAnalysis | null {
  try {
    const buf = readFileSync(file)
    const hl = buf.readUInt32LE(0)
    const head = JSON.parse(buf.subarray(4, 4 + hl).toString('utf8')) as { v: number; frames: number; peaks: number; duration: number }
    if (head.v !== VERSION) return null
    const data = new Uint8Array(buf.buffer.slice(buf.byteOffset + 4 + hl, buf.byteOffset + buf.length))
    if (data.length !== head.frames * AA_FEATS + head.peaks * 2) return null
    return { ok: true, duration: head.duration, frames: head.frames, rate: AA_RATE, peakRate: AA_PEAK_RATE, data, peaks: head.peaks }
  } catch {
    return null
  }
}

const inflight = new Map<string, Promise<AudioAnalysis>>()
let queue: Promise<unknown> = Promise.resolve()

/** The analysis of `src`'s sound : from the cache, or made now (queued). */
export function analyseAudio(src: string): Promise<AudioAnalysis> {
  let paths: { out: string; none: string }
  try {
    paths = pathsFor(src)
  } catch (e) {
    return Promise.resolve({ ok: false, error: (e as Error).message })
  }
  const { out, none } = paths
  if (existsSync(none)) return Promise.resolve({ ok: true, silent: true })
  if (existsSync(out)) {
    const hit = readCache(out)
    if (hit) return Promise.resolve(hit)
  }
  const running = inflight.get(out)
  if (running) return running
  const job = queue.then(() => run(src, out, none)).finally(() => inflight.delete(out))
  queue = job.catch(() => {})
  inflight.set(out, job)
  return job
}

function run(src: string, out: string, none: string): Promise<AudioAnalysis> {
  return new Promise((resolve) => {
    const bin = resolveFfmpeg()
    if (!bin) return resolve({ ok: false, error: 'ffmpeg not found' })
    const child = spawn(bin, ['-hide_banner', '-nostats', '-i', src, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { windowsHide: true })
    children.add(child)
    const an = new Analyzer()
    let err = ''
    let carry: Buffer | null = null
    let idle = setTimeout(() => { try { child.kill() } catch { /* gone */ } }, IDLE_MS)
    child.stdout.on('error', () => {})
    child.stderr.on('error', () => {})
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); if (err.length > 65536) err = err.slice(-32768) })
    child.stdout.on('data', (d: Buffer) => {
      clearTimeout(idle)
      idle = setTimeout(() => { try { child.kill() } catch { /* gone */ } }, IDLE_MS)
      const b = carry ? Buffer.concat([carry, d]) : d
      const whole = b.length - (b.length % 4)
      carry = whole < b.length ? Buffer.from(b.subarray(whole)) : null
      // a copy aligned for the float view (a pipe chunk may start anywhere)
      const f = new Float32Array(whole / 4)
      Buffer.from(f.buffer).set(b.subarray(0, whole))
      an.push(f)
    })
    child.on('error', (e) => { clearTimeout(idle); children.delete(child); resolve({ ok: false, error: e.message }) })
    child.on('close', (code) => {
      clearTimeout(idle)
      children.delete(child)
      const frames = an.feats.length / AA_FEATS
      if (frames === 0) {
        // no sound stream : silent for good, but only when ffmpeg did read the file
        if (/Input #0/.test(err) && !/Stream #\d+:\d+[^\n]*: Audio:/.test(err)) {
          try { writeFileSync(none, '') } catch { /* best effort */ }
          return resolve({ ok: true, silent: true })
        }
        return resolve({ ok: false, error: code === 0 ? 'no sound' : `ffmpeg exited ${code}` })
      }
      const peaks = an.peaks.length / 2
      const data = new Uint8Array(frames * AA_FEATS + peaks * 2)
      data.set(an.feats)
      const pk = new Int8Array(data.buffer, frames * AA_FEATS, peaks * 2)
      pk.set(an.peaks)
      const duration = frames / AA_RATE
      const head = Buffer.from(JSON.stringify({ v: VERSION, frames, peaks, duration }), 'utf8')
      const len = Buffer.alloc(4)
      len.writeUInt32LE(head.length, 0)
      const tmp = `${out}.tmp`
      try {
        writeFileSync(tmp, Buffer.concat([len, head, Buffer.from(data.buffer)]))
        renameSync(tmp, out)
      } catch {
        try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* best effort */ }
      }
      resolve({ ok: true, duration, frames, rate: AA_RATE, peakRate: AA_PEAK_RATE, data, peaks })
    })
  })
}
