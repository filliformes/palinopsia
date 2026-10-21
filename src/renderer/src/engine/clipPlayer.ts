// ClipPlayer : a sound file played like a film. Its <audio>, its transport (play,
// loop, the in / out trim, speed like tape or at pitch, the playhead scrubbed or
// modulated) and its file : the original, or for a format the player can't
// decode (AIFF, WMA, CAF) and a film (its soundtrack) its audio-only copy, made
// once by ffmpeg. Shared by the Import Audio visual source (engine/AudioSource.ts,
// which plays it straight to the device) and the Audio Layer
// (audio/audioLayer.ts, which routes it through Sonify's mix).

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
// A scrubbed playhead (setScrubMod) : it jumps once the modulator has moved it
// this far (seconds) from where it last went, and at most this often (ms).
const SCRUB_STEP = 0.05
const SCRUB_MS = 60

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
  private scrubMod: number | null = null
  private scrubLast = -1 // where the scrub last sent it (seconds; -1 : not scrubbing)
  private scrubAt = 0 // when it last jumped (ms)
  private pos = 0 // the playhead, seconds (the element's, or where a seek is going)
  private held = false // cued for a synced start : kept paused until released
  // Loop off, at its out point : it stays there (an ended element told to play
  // goes back to 0, a loop) until a seek, the loop turned on or play pressed again.
  private atEnd = false
  /** It cannot play (no copy could be made, the copy refused too) : why. */
  onFail: ((why: string) => void) | null = null

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
    this.atEnd = false
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
      if (!r?.ok || !r.path) {
        console.warn('[audio] cannot play', this.path, r?.error)
        this.onFail?.(r?.error || 'no playable copy')
        return
      }
      this.setSrc(`opsia-media://local/${encodeURIComponent(r.path)}`, at)
    }, (e: unknown) => {
      if (!this.disposed) this.onFail?.(e instanceof Error ? e.message : String(e))
    })
  }

  /** The player refused the file (an odd codec in a common container) : its copy;
   *  the copy refused too : it cannot play. */
  private onError(): void {
    if (this.disposed || !this.path) return
    if (this.triedCopy) {
      this.onFail?.('the player cannot decode it')
      return
    }
    this.triedCopy = true
    this.playCopy(true, this.pos)
  }

  setPlayback(p: ClipPlayback): void {
    const o = this.pb
    if (this.atEnd) {
      // the loop on : the next tick wraps to the in point; play pressed again
      // (after a pause) : from the in point
      if (p.loop !== o.loop) this.atEnd = false
      else if (p.playing && !o.playing) {
        this.atEnd = false
        if (this.posMod === null) this.posMod = 0
      }
    }
    this.pb = p
  }
  setPosMod(v: number): void {
    this.posMod = Math.max(0, Math.min(1, v))
  }
  setSpeedMod(v: number): void {
    this.speedMod = Math.max(0, v)
  }
  /** The Audio Layer's modulated playhead (0..1 within the trim), given each
   *  frame it is modulated. It follows the modulator's MOVES, not its value : a
   *  jump once the modulator has moved on from where it last sent it (a cut, a
   *  scratch), at most every SCRUB_MS and never over a seek still under way;
   *  between two jumps the sound plays on from where it landed. So a held
   *  modulator lets it play (never a stutter frozen on one spot), a sweep at
   *  its own pace plays straight through, a slower or a backward one grains,
   *  a fast one scratches. */
  setScrubMod(v: number): void {
    this.scrubMod = Math.max(0, Math.min(1, v))
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
    const spMod = this.speedMod ?? 1
    this.speedMod = null
    const scN = this.scrubMod
    this.scrubMod = null
    if (scN === null) this.scrubLast = -1
    // (a seek asked for while the file loads waits for it)
    if (d <= 0 || a.readyState < 1) return
    const posN = this.posMod
    this.posMod = null
    if (this.held) {
      if (!a.paused) a.pause()
      return
    }
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
      this.atEnd = false
      const t = lo + posN * Math.max(0, hi - lo - 0.02)
      if (Math.abs(a.currentTime - t) > 0.08 || !this.pb.playing) seek(t)
      else this.pos = t
    } else if (scN !== null) this.scrub(lo + scN * Math.max(0, hi - lo - 0.02), seek)
    const rate = Math.max(0, mul * this.pb.speed * spMod)
    if (!this.pb.playing || rate < RATE_MIN) {
      if (!a.paused) a.pause()
      if (posN === null) this.pos = a.currentTime
      return
    }
    // held at the out point (loop off), unless the out point moved on past it
    if (this.atEnd) {
      if (!a.ended && a.currentTime < hi - 0.05) this.atEnd = false
      else {
        if (!a.paused) a.pause()
        this.pos = hi
        return
      }
    }
    const r = Math.min(RATE_MAX, rate)
    if (Math.abs(a.playbackRate - r) > 1e-3) a.playbackRate = r
    if (a.paused) void a.play().catch(() => { /* not ready yet */ })
    const ct = a.currentTime
    if (ct >= hi - 0.02 || a.ended) {
      if (this.pb.loop) seek(lo)
      else { a.pause(); this.pos = hi; this.atEnd = true }
    } else if (ct < lo - 0.05) seek(lo)
    else if (posN === null) this.pos = ct
  }

  /** A scrubbed playhead's frame (setScrubMod) : `t` where the modulator puts
   *  it now, in seconds. */
  private scrub(t: number, seek: (t: number) => void): void {
    const a = this.audio
    // not moved on since its last jump : it plays on from there
    if (this.scrubLast >= 0 && Math.abs(t - this.scrubLast) <= SCRUB_STEP) return
    const now = performance.now()
    if (now - this.scrubAt < SCRUB_MS || a.seeking) return // (it goes there on a later frame)
    this.scrubLast = t
    // playing there already (a sweep at its own pace) : no jump
    if (this.pb.playing && Math.abs(a.currentTime - t) <= SCRUB_STEP) return
    this.scrubAt = now
    this.atEnd = false
    seek(t)
  }

  /** Cued for a synced start : paused at its in point until `start()`. */
  hold(on: boolean): void {
    this.held = on
  }

  /** Go to the in point, paused; resolves once it can play from there (or
   *  after 2 s, whatever it has). */
  cue(): Promise<void> {
    const a = this.audio
    return new Promise<void>((done) => {
      let over = false
      const finish = (): void => { if (!over) { over = true; window.clearTimeout(t); done() } }
      const t = window.setTimeout(finish, 2000)
      const go = (): void => {
        const d = this.duration()
        const inN = Math.max(0, Math.min(1, Math.min(this.pb.inN, this.pb.outN)))
        const at = d > 0 ? inN * d : 0
        a.pause()
        this.atEnd = false
        this.pos = at
        const ready = (): void => {
          if (a.readyState >= 3) finish()
          else a.addEventListener('canplay', finish, { once: true })
        }
        if (Math.abs(a.currentTime - at) < 1e-3) { ready(); return }
        a.addEventListener('seeked', ready, { once: true })
        try { a.currentTime = at } catch { finish() }
      }
      if (a.readyState >= 1) go()
      else a.addEventListener('loadedmetadata', go, { once: true })
    })
  }

  /** Start now (a synced start calls each player's in the same moment). */
  start(): void {
    this.held = false
    this.atEnd = false
    const a = this.audio
    // (a pause meanwhile : the next tick pauses it again)
    void a.play().catch(() => { /* the next tick tries again */ })
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
