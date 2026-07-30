// Assemble playback : an edit decision list rendered as a live layer source.
//
// The assemblage is never rendered to a file to be played — it IS the playlist,
// walked in real time. That keeps generation instant, keeps every clip boundary
// modulatable, and means a saved assemblage is a few hundred bytes.
//
// Cutting between clips that live in DIFFERENT files is the whole problem : a
// single <video> would have to load + seek at every cut, which stalls for
// hundreds of milliseconds. So this runs a PING-PONG PAIR — while clip N plays
// on one element, clip N+1 is loaded and seeked on the other, paused on its
// first frame. The cut is then just a swap of which element we upload from.

import type { AssembleClip } from '@shared/assemble'
import { uploadVideoFrame } from './VideoSource'

/** Chromium refuses rates outside roughly this band. */
const RATE_MIN = 0.0625
const RATE_MAX = 16

interface Deck {
  el: HTMLVideoElement
  src: string // the file currently loaded ('' = nothing)
  pending: boolean // a fresh decoded frame is waiting to be uploaded
  rvfc: number
  ready: boolean // seeked and holding the right frame
}

export class AssembleSource {
  private decks: [Deck, Deck]
  private live = 0 // which deck is on screen
  private tex: WebGLTexture | null = null
  private clips: AssembleClip[] = []
  private idx = 0
  private elapsed = 0 // screen seconds into the current clip
  private loop = true
  private playing = true
  private primedFor = -1 // clip index the off-screen deck is prepared for
  private speedMod: number | null = null
  private posMod: number | null = null
  private finished = false
  // Live (target-driven) mode : instead of walking a fixed list, ask for the
  // next clip one clip ahead of the cut. The lag is deliberate — the match then
  // reflects the image as it looked DURING the previous shot, which is exactly
  // the frame of reference a human editor would use.
  private liveNext: ((prevUnitId: string | null) => AssembleClip | null) | null = null

  constructor(private gl: WebGL2RenderingContext) {
    this.decks = [this.makeDeck(), this.makeDeck()]
  }

  private makeDeck(): Deck {
    const el = document.createElement('video')
    el.muted = true
    el.loop = false
    el.playsInline = true
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    const deck: Deck = { el, src: '', pending: false, rvfc: 0, ready: false }
    el.addEventListener('seeked', () => {
      deck.ready = true
      deck.pending = true
    })
    el.addEventListener('error', () => {
      // A bad file must not wedge the edit — mark it ready so the scheduler
      // advances past it on the next cut instead of waiting forever.
      deck.ready = true
    })
    const step = (): void => {
      deck.pending = true
      if (typeof el.requestVideoFrameCallback === 'function') {
        deck.rvfc = el.requestVideoFrameCallback(step)
      }
    }
    if (typeof el.requestVideoFrameCallback === 'function') {
      deck.rvfc = el.requestVideoFrameCallback(step)
    }
    return deck
  }

  // ── Playlist ───────────────────────────────────────────────────────────

  /** Install a new edit. Restarts from the top; a null/empty list goes black. */
  setPlaylist(clips: AssembleClip[], loop: boolean): void {
    this.clips = clips ?? []
    this.loop = loop
    this.idx = 0
    this.elapsed = 0
    this.primedFor = -1
    this.finished = false
    if (this.clips.length) this.cue(this.decks[this.live], this.clips[0], true)
  }

  /** Same edit, keep playing — used when only `loop` changes. */
  setLoop(loop: boolean): void {
    this.loop = loop
  }

  /**
   * Turn on target-driven mode. `fn` is asked for the clip to play NEXT and may
   * return null to fall back to the pre-generated list. Pass null to go back to
   * playing the fixed edit.
   */
  setLiveMatcher(fn: ((prevUnitId: string | null) => AssembleClip | null) | null): void {
    this.liveNext = fn
  }

  /** In live mode the list grows as clips are chosen; keep it bounded so a
   *  performance running for hours doesn't accumulate forever. */
  private trimHistory(): void {
    const KEEP = 64
    if (this.clips.length > KEEP * 2 && this.idx > KEEP) {
      const drop = this.idx - KEEP
      this.clips.splice(0, drop)
      this.idx -= drop
    }
  }

  setPlaying(p: boolean): void {
    this.playing = p
    if (!p) {
      try {
        this.decks[this.live].el.pause()
      } catch {
        /* ignore */
      }
    }
  }

  setSpeedMod(v: number): void {
    this.speedMod = v
  }

  /** Absolute scrub over the whole assemblage, 0..1 (the `position` mod). */
  setPosMod(v: number): void {
    this.posMod = v
  }

  /** Point a deck at a clip and hold its first frame. */
  private cue(deck: Deck, clip: AssembleClip, playNow: boolean): void {
    const url = `opsia-media://local/${encodeURIComponent(clip.file)}`
    deck.ready = false
    if (deck.src !== url) {
      deck.src = url
      deck.el.src = url
      try {
        deck.el.load()
      } catch {
        /* ignore */
      }
    }
    const seek = (): void => {
      try {
        deck.el.currentTime = clip.inSec
      } catch {
        /* not seekable yet : the loadeddata handler below retries */
      }
    }
    if (deck.el.readyState >= 1) seek()
    else deck.el.addEventListener('loadedmetadata', seek, { once: true })
    if (playNow) {
      deck.el.playbackRate = clampRate(clip.speed)
      void deck.el.play().catch(() => {
        /* autoplay is fine here : muted + user-gestured app */
      })
    } else {
      try {
        deck.el.pause()
      } catch {
        /* ignore */
      }
    }
  }

  // ── Clock ──────────────────────────────────────────────────────────────

  /**
   * Advance the edit. `mul` is the layer × global speed, so the whole
   * assemblage stretches with the transport like every other source.
   */
  tick(rawDt: number, mul: number): void {
    if (!this.clips.length) return
    const deck = this.decks[this.live]
    const clip = this.clips[this.idx]
    if (!clip) return

    // Absolute scrub wins for this frame : jump to wherever the modulator
    // points, then let normal playback resume from there.
    if (this.posMod !== null) {
      const target = Math.max(0, Math.min(1, this.posMod)) * this.totalDuration()
      this.posMod = null
      let acc = 0
      for (let i = 0; i < this.clips.length; i++) {
        const d = this.clips[i].durSec
        if (acc + d > target || i === this.clips.length - 1) {
          if (i !== this.idx) {
            this.idx = i
            this.primedFor = -1
            this.cue(deck, this.clips[i], this.playing)
          }
          this.elapsed = Math.max(0, target - acc)
          try {
            deck.el.currentTime = this.clips[i].inSec + this.elapsed * this.clips[i].speed
          } catch {
            /* ignore */
          }
          break
        }
        acc += d
      }
      return
    }

    if (!this.playing || this.finished) return

    const spd = this.speedMod ?? 1
    this.speedMod = null
    const rate = clip.speed * mul * spd
    if (Math.abs(deck.el.playbackRate - clampRate(rate)) > 0.01) {
      try {
        deck.el.playbackRate = clampRate(rate)
      } catch {
        /* ignore */
      }
    }
    if (deck.el.paused) {
      void deck.el.play().catch(() => {
        /* ignore */
      })
    }

    this.elapsed += rawDt * mul * spd

    // Prime the NEXT clip on the off-screen deck as soon as we're in this one,
    // so it has the whole clip's duration to load and seek.
    const nextIdx = this.nextIndex()
    if (nextIdx >= 0 && this.primedFor !== nextIdx) {
      this.primedFor = nextIdx
      this.cue(this.decks[1 - this.live], this.clips[nextIdx], false)
    }

    if (this.elapsed >= clip.durSec) {
      if (nextIdx < 0) {
        this.finished = true
        return
      }
      const carry = this.elapsed - clip.durSec
      // Swap decks : the primed one is already sitting on the right frame.
      try {
        deck.el.pause()
      } catch {
        /* ignore */
      }
      this.live = 1 - this.live
      this.idx = nextIdx
      this.elapsed = Math.min(carry, this.clips[nextIdx].durSec * 0.5)
      this.primedFor = -1
      const nd = this.decks[this.live]
      nd.el.playbackRate = clampRate(this.clips[nextIdx].speed * mul)
      void nd.el.play().catch(() => {
        /* ignore */
      })
      nd.pending = true
      this.trimHistory()
    }
  }

  private nextIndex(): number {
    // Live mode : extend the list on demand rather than wrapping.
    if (this.liveNext && this.idx + 1 >= this.clips.length) {
      const picked = this.liveNext(this.clips[this.idx]?.unitId ?? null)
      if (picked) {
        this.clips.push(picked)
        return this.idx + 1
      }
    }
    if (this.idx + 1 < this.clips.length) return this.idx + 1
    return this.loop && this.clips.length ? 0 : -1
  }

  // ── Readout (transport UI) ─────────────────────────────────────────────

  totalDuration(): number {
    let s = 0
    for (const c of this.clips) s += c.durSec;
    return s
  }

  /** Screen seconds from the top of the assemblage. */
  position(): number {
    let s = 0
    for (let i = 0; i < this.idx && i < this.clips.length; i++) s += this.clips[i].durSec;
    return s + this.elapsed
  }

  clipIndex(): number {
    return this.idx
  }

  isFinished(): boolean {
    return this.finished
  }

  // ── GL ─────────────────────────────────────────────────────────────────

  upload(): WebGLTexture | null {
    const deck = this.decks[this.live]
    if (!this.clips.length) return this.tex
    // Upload when a new decoded frame is waiting, or unconditionally while we
    // still have no texture at all (first frames, rVFC-less fallback).
    if (deck.pending || !this.tex) {
      const t = uploadVideoFrame(this.gl, deck.el, this.tex)
      if (t) {
        this.tex = t
        deck.pending = false
      }
    }
    return this.tex
  }

  dispose(): void {
    for (const d of this.decks) {
      try {
        if (d.rvfc && typeof d.el.cancelVideoFrameCallback === 'function') {
          d.el.cancelVideoFrameCallback(d.rvfc)
        }
        d.el.pause()
        d.el.removeAttribute('src')
        d.el.load() // releases the decoder
      } catch {
        /* ignore */
      }
    }
    if (this.tex) {
      try {
        this.gl.deleteTexture(this.tex)
      } catch {
        /* ignore */
      }
      this.tex = null
    }
    this.clips = []
  }
}

const clampRate = (r: number): number => (r < RATE_MIN ? RATE_MIN : r > RATE_MAX ? RATE_MAX : r)
