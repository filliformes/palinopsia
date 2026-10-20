// A clip's sound, read at its PLAYHEAD : what an audio modulator follows when it
// listens to a layer's film or audio file instead of the audio input. The sound
// is analysed once in main (audioAnalysis.ts : the live input's own analysis,
// 60 frames a second) and read here wherever the clip's playhead is, so it
// follows the clip at any speed, in reverse, scratched or in grains, where the
// film itself plays muted. A playhead that stops is silence; a jump (a loop, a
// seek) reads the new place, never a sweep across the gap.

import type { AudioFeature, ClipAudioSrc } from '@shared/types'

export const CLIP_FEATS = 13 // level, flux, centroid, 6 bands, pitch, noisiness, rms dB, peak dB
const F_LEVEL = 0, F_FLUX = 1, F_CENT = 2, F_BAND = 3, F_PITCH = 9, F_NOISE = 10, F_RMS = 11, F_PEAK = 12
const STILL_MS = 150 // a playhead unmoved this long : the clip is silent
// this much farther (or nearer) than its speed takes it between two reads : a
// jump, not a sweep (a fixed distance read every read of a fast clip as a jump)
const JUMP_S = 0.5
const WRAP_S = 0.03 // a step back against the way it plays, longer than this : a wrap
const RETRY_MS = 10000 // a failed analysis is asked for again after this (then twice as long, to 5 min)
const RETRY_MAX_MS = 300000

export interface ClipAnalysis {
  duration: number
  frames: number
  rate: number
  peakRate: number
  /** frames × CLIP_FEATS bytes (0..255) */
  feat: Uint8Array
  /** the waveform : min, max (int8) per bucket */
  peaks: Int8Array
  peakCount: number
}

export type ClipAudioState = 'pending' | 'ready' | 'silent' | 'failed'

/** Where a slot's clip is now : its file and its playhead in seconds. */
export type PlayheadReader = (layer: number, slot: 'A' | 'B') => { path: string; time: number } | null
/** The Audio Layer's whole sound, live (a modulator FROM "AU all"). */
export type MixReader = (name: AudioFeature, band: number) => number

/** One reader's memory (a modulator's) : the last playhead, the transient. */
export interface ClipReadState {
  path: string
  t: number
  movedAt: number
  transient: number
  at: number
  // the speed of its last three steps (clip seconds a second) : the one it plays
  // at is their median (a seek or a wrap among them does not count)
  r0: number
  r1: number
  r2: number
}

const median3 = (a: number, b: number, c: number): number =>
  Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))

class ClipAudio {
  private store = new Map<string, ClipAnalysis | ClipAudioState>()
  private playheads: PlayheadReader = () => null
  private listeners = new Set<() => void>()
  /** Bumped when an analysis lands (the UI re-reads its state). */
  version = 0

  private mix: MixReader | null = null
  setMixReader(fn: MixReader): void {
    this.mix = fn
  }

  setPlayheads(fn: PlayheadReader): void {
    this.playheads = fn
  }

  // A failed analysis (ffmpeg busy or missing, the file on a drive not mounted
  // yet) : when it may be asked for again, and how long the next wait is.
  private failedAt = new Map<string, { at: number; wait: number }>()

  /** The analysis of `path`, asked for the first time it is wanted (one that
   *  failed : again, once its wait is over). */
  get(path: string): ClipAnalysis | null {
    const v = this.store.get(path)
    if (v === undefined) {
      this.request(path)
      return null
    }
    if (v === 'failed') {
      const f = this.failedAt.get(path)
      if (!f || performance.now() - f.at >= f.wait) this.request(path)
      return null
    }
    return typeof v === 'string' ? null : v
  }

  private failed(path: string): void {
    this.store.set(path, 'failed')
    const f = this.failedAt.get(path)
    this.failedAt.set(path, { at: performance.now(), wait: f ? Math.min(RETRY_MAX_MS, f.wait * 2) : RETRY_MS })
  }

  state(path: string): ClipAudioState | undefined {
    const v = this.store.get(path)
    return v === undefined ? undefined : typeof v === 'string' ? v : 'ready'
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Where a slot's clip is now (null : no clip there). */
  playhead(src: ClipAudioSrc): { path: string; time: number } | null {
    return src.slot === 'all' ? null : this.playheads(src.layer, src.slot)
  }

  private request(path: string): void {
    this.store.set(path, 'pending')
    const api = (window as unknown as { api?: { audioAnalysis?: (p: string) => Promise<{ ok: boolean; silent?: boolean; duration?: number; frames?: number; rate?: number; peakRate?: number; data?: Uint8Array; peaks?: number }> } }).api
    if (!api?.audioAnalysis) { this.failed(path); return }
    void api.audioAnalysis(path).then(
      (r) => {
        if (r?.ok && r.data && r.frames) {
          this.failedAt.delete(path)
          const data = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data as ArrayBufferLike)
          const n = r.frames * CLIP_FEATS
          const peaks = r.peaks ?? 0
          this.store.set(path, {
            duration: r.duration ?? r.frames / (r.rate ?? 60),
            frames: r.frames,
            rate: r.rate ?? 60,
            peakRate: r.peakRate ?? 400,
            feat: data.subarray(0, n),
            peaks: new Int8Array(data.buffer, data.byteOffset + n, peaks * 2),
            peakCount: peaks
          })
        } else if (r?.ok && r.silent) this.store.set(path, 'silent')
        else this.failed(path)
        this.version++
        for (const l of this.listeners) l()
      },
      () => {
        this.failed(path)
        this.version++
        for (const l of this.listeners) l()
      }
    )
  }

  /** One feature of a slot's clip at its playhead, 0..1. `st` is the reader's
   *  own memory (flux is the most the playhead crossed since its last read : a
   *  fast clip skips no onset; the transient decays in real time, as live). */
  feature(src: ClipAudioSrc, name: AudioFeature, band: number, st: ClipReadState, nowMs: number): number {
    if (src.slot === 'all') return this.mix ? this.mix(name, band) : 0
    const ph = this.playheads(src.layer, src.slot)
    const dt = st.at ? Math.min(0.1, (nowMs - st.at) / 1000) : 1 / 60
    st.at = nowMs
    const decay = (): number => (st.transient *= Math.pow(0.82, dt * 60))
    if (!ph) { st.path = ''; decay(); return name === 'transient' ? st.transient : 0 }
    const an = this.get(ph.path)
    if (!an || an.frames < 1) { decay(); return name === 'transient' ? st.transient : 0 }
    const t = ph.time
    const fresh = st.path !== ph.path
    const moved = fresh || Math.abs(t - st.t) > 1e-4
    if (moved) st.movedAt = nowMs
    const still = !moved && nowMs - st.movedAt > STILL_MS
    // flux : the most of it between the last read and now (a jump : here only)
    let flux = 0
    if (moved) {
      if (fresh) st.r0 = st.r1 = st.r2 = 0
      const d = t - st.t
      // where its speed takes it since the last read (a clip at 64x moves a second
      // a frame : a sweep, not a jump); a step back against the way it plays is
      // a loop's wrap (however short the loop) : the new place, not a sweep
      // across the whole loop
      const rate = median3(st.r0, st.r1, st.r2), expect = rate * dt
      const wrap = !fresh && Math.abs(rate) > 0.05 && d * rate < 0 && Math.abs(d) > Math.max(WRAP_S, 2 * Math.abs(expect))
      const jump = fresh || wrap || Math.abs(d - expect) > JUMP_S + Math.abs(expect)
      if (!fresh && dt > 0) { st.r2 = st.r1; st.r1 = st.r0; st.r0 = d / dt }
      const a = jump ? t : Math.min(st.t, t), b = jump ? t : Math.max(st.t, t)
      const f0 = Math.max(0, Math.min(an.frames - 1, Math.floor(a * an.rate) + (jump ? 0 : 1)))
      const f1 = Math.max(0, Math.min(an.frames - 1, Math.floor(b * an.rate)))
      for (let f = Math.min(f0, f1); f <= f1; f++) flux = Math.max(flux, an.feat[f * CLIP_FEATS + F_FLUX])
      flux /= 255
    }
    st.path = ph.path
    st.t = t
    if (flux > 0.32) st.transient = 1
    else decay()
    if (still) return name === 'transient' ? st.transient : name === 'pitch' ? this.at(an, t, F_PITCH) : 0
    switch (name) {
      case 'level': return this.at(an, t, F_LEVEL)
      case 'flux': return flux
      case 'transient': return st.transient
      case 'centroid': return this.at(an, t, F_CENT)
      case 'band': return this.at(an, t, F_BAND + Math.max(0, Math.min(5, band)))
      case 'pitch': return this.at(an, t, F_PITCH)
      case 'noisiness': return this.at(an, t, F_NOISE)
    }
    return 0
  }

  /** The meters' reading at time t : the true RMS and peak, linear (0..1). */
  meterAt(an: ClipAnalysis, t: number): { rms: number; peak: number } {
    const f = Math.max(0, Math.min(an.frames - 1, Math.round(t * an.rate)))
    const lin = (b: number): number => (b === 0 ? 0 : Math.pow(10, ((b / 255) * 90 - 90) / 20))
    return { rms: lin(an.feat[f * CLIP_FEATS + F_RMS]), peak: lin(an.feat[f * CLIP_FEATS + F_PEAK]) }
  }

  /** A feature at time t, between its two frames. */
  private at(an: ClipAnalysis, t: number, k: number): number {
    const x = Math.max(0, Math.min(an.frames - 1, t * an.rate))
    const i = Math.floor(x), j = Math.min(an.frames - 1, i + 1), u = x - i
    return (an.feat[i * CLIP_FEATS + k] * (1 - u) + an.feat[j * CLIP_FEATS + k] * u) / 255
  }
}

export const clipAudio = new ClipAudio()

export function newClipReadState(): ClipReadState {
  return { path: '', t: 0, movedAt: 0, transient: 0, at: 0, r0: 0, r1: 0, r2: 0 }
}
