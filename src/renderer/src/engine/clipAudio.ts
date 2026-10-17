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
const JUMP_S = 0.5 // farther than this between two reads : a jump, not a sweep

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

/** One reader's memory (a modulator's) : the last playhead, the transient. */
export interface ClipReadState {
  path: string
  t: number
  movedAt: number
  transient: number
  at: number
}

class ClipAudio {
  private store = new Map<string, ClipAnalysis | ClipAudioState>()
  private playheads: PlayheadReader = () => null
  private listeners = new Set<() => void>()
  /** Bumped when an analysis lands (the UI re-reads its state). */
  version = 0

  setPlayheads(fn: PlayheadReader): void {
    this.playheads = fn
  }

  /** The analysis of `path`, asked for the first time it is wanted. */
  get(path: string): ClipAnalysis | null {
    const v = this.store.get(path)
    if (v === undefined) {
      this.request(path)
      return null
    }
    return typeof v === 'string' ? null : v
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
    return this.playheads(src.layer, src.slot)
  }

  private request(path: string): void {
    this.store.set(path, 'pending')
    const api = (window as unknown as { api?: { audioAnalysis?: (p: string) => Promise<{ ok: boolean; silent?: boolean; duration?: number; frames?: number; rate?: number; peakRate?: number; data?: Uint8Array; peaks?: number }> } }).api
    if (!api?.audioAnalysis) { this.store.set(path, 'failed'); return }
    void api.audioAnalysis(path).then(
      (r) => {
        if (r?.ok && r.data && r.frames) {
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
        } else this.store.set(path, r?.ok && r.silent ? 'silent' : 'failed')
        this.version++
        for (const l of this.listeners) l()
      },
      () => {
        this.store.set(path, 'failed')
        this.version++
        for (const l of this.listeners) l()
      }
    )
  }

  /** One feature of a slot's clip at its playhead, 0..1. `st` is the reader's
   *  own memory (flux is the most the playhead crossed since its last read : a
   *  fast clip skips no onset; the transient decays in real time, as live). */
  feature(src: ClipAudioSrc, name: AudioFeature, band: number, st: ClipReadState, nowMs: number): number {
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
      const jump = fresh || Math.abs(t - st.t) > JUMP_S
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
  return { path: '', t: 0, movedAt: 0, transient: 0, at: 0 }
}
