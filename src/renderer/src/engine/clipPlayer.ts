// ClipPlayer : a sound file played like a film. Its <audio>, its transport (play,
// loop, the in / out trim, speed like tape or at pitch, the playhead scrubbed or
// modulated) and its file : the original, or for a format the player can't
// decode (AIFF, WMA, CAF) its audio-only copy, made once by ffmpeg. Shared by
// the Import Audio visual source (engine/AudioSource.ts, which plays it straight
// to the device) and the Audio Layer (audio/audioLayer.ts, which routes it
// through Sonify's mix).

import { clipAudio } from './clipAudio'
import { trackMediaSink, untrackMediaSink } from './mediaSink'

export interface ClipPlayback {
  playing: boolean
  speed: number
  loop: boolean
  inN: number
  outN: number
  /** play at its own speed (× the layer's), whatever the global speed */
  ignoreGlobal?: boolean
}

const RATE_MIN = 0.0625 // the slowest an <audio> plays (and below it, silence)
const RATE_MAX = 16
const NATIVE = /\.(wav|mp3|flac|ogg|oga|opus|aac|m4a|webm)$/i

export class ClipPlayer {
  readonly audio: HTMLAudioElement
  private path = ''
  private triedCopy = false
  private disposed = false
  private pb: ClipPlayback = { playing: true, speed: 1, loop: true, inN: 0, outN: 1 }
  private posMod: number | null = null
  private speedMod: number | null = null
  private loopInMod: number | null = null
  private loopOutMod: number | null = null
  private pos = 0 // the playhead, seconds (the element's, or where a seek is going)

  /** `toDevice` : the element plays itself, on Sonify's device (the visual
   *  source); otherwise its sound is taken into a Web Audio graph. */
  constructor(private toDevice: boolean) {
    const a = document.createElement('audio')
    a.preload = 'auto'
    a.crossOrigin = 'anonymous'
    a.loop = false // the trim loops it (below)
    a.preservesPitch = false
    a.addEventListener('error', () => this.onError())
    this.audio = a
    if (toDevice) trackMediaSink(a)
  }

  /** `url` : opsia-media://…; `path` : the file on disk (its analysis, its copy). */
  load(url: string, path: string, at = 0): void {
    this.path = path
    this.triedCopy = false
    this.pos = at
    // A format the player can't decode plays from its audio-only copy, asked for
    // before playing, not after a refusal.
    if (path && !NATIVE.test(path)) this.playCopy(false, at)
    else this.setSrc(url, at)
  }

  private setSrc(url: string, at: number): void {
    const a = this.audio
    a.src = url
    a.load()
    if (at > 0) {
      const go = (): void => { try { a.currentTime = at } catch { /* gone */ } }
      a.addEventListener('loadedmetadata', go, { once: true })
    }
  }

  private playCopy(force: boolean, at: number): void {
    const api = (window as unknown as { api?: { audioPlayable?: (p: string, f?: boolean) => Promise<{ ok: boolean; path?: string; error?: string }> } }).api
    void api?.audioPlayable?.(this.path, force).then((r) => {
      if (this.disposed) return
      if (!r?.ok || !r.path) { console.warn('[audio] cannot play', this.path, r?.error); return }
      this.setSrc(`opsia-media://local/${encodeURIComponent(r.path)}`, at)
    })
  }

  /** The player refused the file (an odd codec in a common container) : its copy. */
  private onError(): void {
    if (this.disposed || this.triedCopy || !this.path) return
    this.triedCopy = true
    this.playCopy(true, this.pos)
  }

  setPlayback(p: ClipPlayback): void {
    this.pb = p
  }
  setPosMod(v: number): void {
    this.posMod = Math.max(0, Math.min(1, v))
  }
  setSpeedMod(v: number): void {
    this.speedMod = Math.max(0, v)
  }
  /** The loop's in / out under modulation (the video's names). */
  setMod(name: string, v: number): void {
    if (name === 'loopIn') this.loopInMod = Math.max(0, Math.min(1, v))
    else if (name === 'loopOut') this.loopOutMod = Math.max(0, Math.min(1, v))
  }
  setVolume(v: number, muted: boolean): void {
    const a = this.audio
    if (a.muted !== muted) a.muted = muted
    const vol = Math.max(0, Math.min(1, v))
    if (Math.abs(a.volume - vol) > 1e-3) a.volume = vol
  }
  setKeepPitch(on: boolean): void {
    if (this.audio.preservesPitch !== on) this.audio.preservesPitch = on
  }
  playback(): ClipPlayback {
    return this.pb
  }

  duration(): number {
    const d = this.audio.duration
    if (Number.isFinite(d) && d > 0) return d
    return clipAudio.get(this.path)?.duration ?? 0
  }
  time(): number {
    return this.pos
  }
  file(): string {
    return this.path
  }

  /** The transport, once a frame : `mul` the speed it plays at over real time
   *  (the layer's × the global one, or the layer's alone). */
  tick(mul: number): void {
    const a = this.audio
    const d = this.duration()
    const inN = this.loopInMod ?? this.pb.inN, outN = this.loopOutMod ?? this.pb.outN
    this.loopInMod = this.loopOutMod = null
    const posN = this.posMod
    this.posMod = null
    const spMod = this.speedMod ?? 1
    this.speedMod = null
    if (d <= 0 || a.readyState < 1) return
    const lo = Math.max(0, Math.min(1, Math.min(inN, outN))) * d
    const hi = Math.max(lo + 0.04, Math.max(0, Math.min(1, Math.max(inN, outN))) * d)
    const seek = (t: number): void => {
      this.pos = t
      try { a.currentTime = t } catch { /* a reload races it */ }
    }
    // A position given this frame (the timeline, Stop, OSC, a modulator) : the
    // playhead goes there; a modulated one that moves smoothly is followed by
    // the element's own playback, a jump seeks (a scratch, a stutter).
    if (posN !== null) {
      const t = lo + posN * Math.max(0, hi - lo - 0.02)
      if (Math.abs(a.currentTime - t) > 0.08 || !this.pb.playing) seek(t)
      else this.pos = t
    }
    const rate = Math.max(0, mul * this.pb.speed * spMod)
    if (!this.pb.playing || rate < RATE_MIN) {
      if (!a.paused) a.pause()
      if (posN === null) this.pos = a.currentTime
      return
    }
    const r = Math.min(RATE_MAX, rate)
    if (Math.abs(a.playbackRate - r) > 1e-3) a.playbackRate = r
    if (a.paused) void a.play().catch(() => { /* not ready yet */ })
    const ct = a.currentTime
    if (ct >= hi - 0.02 || a.ended) {
      if (this.pb.loop) seek(lo)
      else { a.pause(); this.pos = hi }
    } else if (ct < lo - 0.05) seek(lo)
    else if (posN === null) this.pos = ct
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.toDevice) untrackMediaSink(this.audio)
    try {
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
    } catch { /* best effort */ }
  }
}
