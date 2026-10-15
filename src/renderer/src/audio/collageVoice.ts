// Sonify's COLLAGE voice : the films of a Collage source heard all at once, a
// sound collage that follows the picture.
//
// Every film (deck) gets its own hidden <audio> playing the clip's ORIGINAL
// file, held to its video : same position (resynced past 0.25 s of drift and on
// every seek, so the window loops and churn re-cues carry over), same speed,
// paused when it pauses. A separate element because the wall often plays an
// audio-less cache (the codec bridge and the optimise pass strip the sound),
// and because a <video> can feed only ONE audio graph for life while Sonify's
// context comes and goes.
//
// Every PIECE of the wall then gets its own chain, out of its film's bus :
//   level (mask, layer, 1/sqrt(pieces)) → harmonic resonator → stereo pan →
//   crossfade → bus
//   · pan : the piece's horizontal place in the frame (centre = centre);
//   · resonator : three band-passes on the note and its 2nd and 3rd harmonics,
//     the note picked on the Sonify key/scale by the piece's distance from the
//     frame's centre (centre = the lowest note, the frame's edge = the highest,
//     in every direction), mixed with the dry film by RESONANCE.
// Several pieces showing one film are each their own voice (same sound, their
// own note and place). The bus feeds the Sonify worklet's second input, so the
// voice gets its mixer channel, the FX tail, the master and the limiter.
//
// Nothing cuts. A re-deal (new cuts) crossfades every piece, old places and
// notes out while the new ones come in, over the Collage's own crossfade time
// (a short declick when it is 0). A film taking a new clip, or jumping (a window
// loop, a churn re-cue), crossfades between two players of the same deck : the
// old keeps playing until the new one actually sounds. The faded-out one is
// then kept, paused and loaded, for the deck's next jump : a jump is a seek on
// it, not a new player. (Measured on an installation's wall of 12 to 16 films :
// a new player for every window loop, each one opening, probing and decoding
// its file from the start, and as many torn down.)

const mediaUrlForPath = (path: string): string => `opsia-media://local/${encodeURIComponent(path)}`

// Each film is heard from its AUDIO-ONLY copy (main : audioForCollage), not the
// original : an <audio> element playing a video file reads the whole file to
// get at its sound, and an iPhone original runs 15 to 36 Mbit/s for 0.15 of
// audio. Original path → the copy's path; null while it is being made, or when
// there is none (no sound, a failed copy) : the original plays meanwhile. Made
// one at a time in the background, the whole pool as soon as the voice sees it.
const audioCopy = new Map<string, string | null>()
const audioQueue: string[] = []
let audioBusy = false
async function pumpAudioCopies(): Promise<void> {
  if (audioBusy) return
  audioBusy = true
  try {
    while (audioQueue.length) {
      const p = audioQueue.shift()!
      try {
        const r = await window.api.collageAudio(p)
        if (r?.ok && r.path) audioCopy.set(p, r.path)
      } catch { /* the original keeps playing */ }
    }
  } finally {
    audioBusy = false
  }
}
function wantAudioCopy(path: string): void {
  if (audioCopy.has(path)) return
  audioCopy.set(path, null)
  audioQueue.push(path)
  void pumpAudioCopies()
}
/** The file to play for a film : its audio-only copy once it exists. */
function soundFileFor(path: string): string {
  wantAudioCopy(path)
  return audioCopy.get(path) ?? path
}

export interface CollageSoundPiece {
  x: number // piece centre, 0..1 of the frame
  y: number
  deck: number // the film it plays
  keep: number // 1 = shown, 0 = masked out (a hole)
}
export interface CollageSoundDeck {
  el: HTMLVideoElement | null // the video the sound follows (null = no film)
  path: string | null // the file to hear (the original when the wall plays a cache)
}
export interface CollageSoundSet {
  id: string // which Collage (layer + slot, or the background)
  level: number // how visible it is (layer opacity, mute, A/B mix)
  aspect: number
  pieces: CollageSoundPiece[]
  decks: CollageSoundDeck[]
  deal?: number // changes on every re-cut of the wall
  xfade?: number // the wall's crossfade time between deals (s)
  files?: string[] // every film the wall may deal, as heard (one array until the pool changes)
}

export interface CollageVoiceCfg {
  reso: number // 0 = the plain films · 1 = only the resonances
  ring: number // resonator sharpness (Q)
  bright: number // weight of the 2nd and 3rd harmonics
  width: number // stereo spread of the pan
  inGain?: number // linear : the films' level into the resonators (a windy film)
  hp?: number // Hz : each film's high-pass, before the resonators
  lp?: number // Hz : each film's low-pass
  hpSlope?: 12 | 24 // dB/oct
  lpSlope?: 12 | 24
}

/** One <audio> playing one file into its deck's bus. */
interface Player {
  audio: HTMLAudioElement
  src: MediaElementAudioSourceNode
  g: GainNode // its crossfade gain
  started: boolean // positioned and playing at least once
  path: string
  wantIn: boolean // to fade in once it really sounds (a film starting or coming back)
  pos0: number // where it was last positioned or resumed (media s) : sounding once it has moved on
  stopAt: number // ctx time to pause it at, once faded out (0 : not stopping)
  dipAt: number // ctx time its loop-point dip ends (0 : none running)
}

interface DeckPlayer {
  bus: GainNode // the film's players sound here : stable across clip switches
  hp: BiquadFilterNode[] // the film's high-pass (two sections : 24 dB/oct) …
  lp: BiquadFilterNode[] // … and low-pass (two sections : 24 dB/oct), before every piece of it
  out: GainNode // the pieces listen here
  cur: Player
  next: Player | null // a new clip, or a jump, waiting to sound before it takes over
  nextT: number // the crossfade time it will use
  nextSince: number
  fading: Array<{ p: Player; until: number }>
  spare: Player | null // faded out, paused and loaded : the next jump's player
  path: string // the file asked for
  video: HTMLVideoElement | null
  onSeek: () => void
  used: boolean
}

interface PieceChain {
  deckKey: string
  inG: GainNode
  dry: GainNode
  bp: BiquadFilterNode[]
  bpG: GainNode[]
  pan: StereoPannerNode
  xf: GainNode // the deal crossfade (mono, before the panner : Space taps it here)
  used: boolean
  tg: Float64Array // the target each glide was last sent (see glide)
  slot: number // Space : the piece group it sounds in as a source of its own (-1 : none)
}

/** A film filter's slope : 24 dB/oct = two Butterworth sections (Q -5.33 and
 *  +2.32 dB : Web Audio reads a low- / high-pass Q in decibels); 12 dB/oct = one
 *  (Q -3.01 dB, Butterworth 0.7071) and the other an all-pass (flat : the films'
 *  audio is never rewired, so a switch never clicks off the sound). */
function setSlope(f: BiquadFilterNode[], type: 'highpass' | 'lowpass', slope: 12 | 24): void {
  if (slope === 24) {
    f[0].Q.value = -5.3329
    f[1].type = type
    f[1].Q.value = 2.3226
  } else {
    f[0].Q.value = -3.0103
    f[1].type = 'allpass'
  }
}

/** Space : the Collage pieces as sources of their own (shared/spatial.ts). The
 *  voice's output carries its stereo bus on channels 0-1 and up to this many
 *  mono piece groups on 2.. (one channel each); the worklet places each group. */
export const PIECE_GROUPS = 30

// The glide slots of a piece's targets (PieceChain.tg).
const TG_F = 0, TG_Q = 3, TG_G = 6, TG_DRY = 9, TG_PAN = 10, TG_IN = 11

/** Glide `param` to `v`, unless that is already where it is gliding. Every
 *  piece sent its twelve targets on every update (~30 a second) whether they
 *  moved or not, each a new automation event on the audio thread. A repeated
 *  glide to the same target traces the same curve (the approach is memoryless),
 *  so skipping it changes nothing but the work. */
function glide(p: PieceChain, k: number, param: AudioParam, v: number, now: number): void {
  if (p.tg[k] === v) return
  p.tg[k] = v
  param.setTargetAtTime(v, now, SMOOTH)
}

const HARM = [1, 2, 3]
const SEEK_S = 0.15 // past this the audio re-syncs to the video (a crossfaded splice)
const FADE_S = 0.03 // a film's sound starting, stopping, coming back : never a hard edge
const SMOOTH = 0.04 // param glide (s) : no zipper, no clicks
const MIN_XF = 0.03 // the shortest crossfade : a cut, without the click
const SWITCH_XF = 0.08 // a film taking a new clip outside a deal (churn)
const SPLICE_XF = 0.04 // a film jumping within its clip (window loop, re-cue)
const NEXT_WAIT_S = 1.5 // a new player that never sounds still takes over
const RETIRE_MAX = 192 // fading-out piece chains kept at most

// A fade is scheduled a little ahead (AHEAD) and approaches its target from
// whatever the gain really holds then (setTargetAtTime starts from the live
// value), never from one read back on this thread : param.value lags the audio
// thread by a block or more, so a curve started from it jumped by the
// difference. And never a linear ramp : on a gain with no automation event yet
// it ramps from time 0, so it lands almost at its target at once (measured :
// a click at every takeover). The approach reaches 98 % at T.
const AHEAD = 0.01

function fade(param: AudioParam, now: number, T: number, dir: 'in' | 'out'): void {
  const dur = Math.max(0.01, T), t0 = now + AHEAD
  try { param.cancelAndHoldAtTime(t0) } catch { /* nothing to hold */ }
  param.setTargetAtTime(dir === 'in' ? 1 : 0, t0, dur / 4)
}

export class CollageVoice {
  private decks = new Map<string, DeckPlayer>()
  private pieces = new Map<string, PieceChain>()
  private retiring: Array<{ p: PieceChain; until: number }> = []
  private dealOf = new Map<string, number>()
  private dealAt = new Map<string, number>()
  private filesSeen = new Map<string, string[]>()
  readonly bus: GainNode
  /** What the Sonify node hears on its input 1 : the bus on channels 0-1, the
   *  piece groups on 2.. (silent while Space keeps the voice as one pair). */
  readonly out: ChannelMergerNode
  /** For the page : what the voice is playing right now. */
  status = { sets: 0, pieces: 0, films: 0 }
  // Space's piece groups : how many, who sits in each, and where each sounds
  // from (x, y, weight per group, the pieces' own frame coordinates).
  private groups = 0
  // the films' filters (every deck follows them)
  private hpHz = 20
  private lpHz = 20000
  private hpSlope: 12 | 24 = 24
  private lpSlope: 12 | 24 = 24
  private groupCount = new Int32Array(PIECE_GROUPS)
  readonly groupPos = new Float32Array(PIECE_GROUPS * 3)

  constructor(private ctx: AudioContext) {
    this.bus = ctx.createGain()
    this.out = ctx.createChannelMerger(2 + PIECE_GROUPS)
    const split = ctx.createChannelSplitter(2)
    this.bus.connect(split)
    split.connect(this.out, 0, 0)
    split.connect(this.out, 1, 1)
  }

  /** Space : sound the pieces as up to `n` sources of their own (0 : off). */
  setGroups(n: number): void {
    n = Math.max(0, Math.min(PIECE_GROUPS, Math.round(n)))
    if (n === this.groups) return
    this.groups = n
    // every piece re-seats (the next update), from empty groups
    const all = [...this.pieces.values(), ...this.retiring.map((r) => r.p)]
    for (const p of all) this.unseat(p)
    this.groupCount.fill(0)
    this.groupPos.fill(0)
  }

  private unseat(p: PieceChain): void {
    if (p.slot < 0) return
    try { p.xf.disconnect(this.out, 0, 2 + p.slot) } catch { /* not connected */ }
    if (this.groupCount[p.slot] > 0) this.groupCount[p.slot]--
    p.slot = -1
  }

  /** A piece takes an empty group, or joins the group nearest to it (where its
   *  pieces are : this update's running sums `sx/sy/sw`, else its last place). */
  private seat(p: PieceChain, x: number, y: number, sx: Float32Array, sy: Float32Array, sw: Float32Array): void {
    if (this.groups === 0 || p.slot >= 0) return
    let slot = -1
    for (let g = 0; g < this.groups; g++) if (this.groupCount[g] === 0) { slot = g; break }
    if (slot < 0) {
      let best = Infinity
      for (let g = 0; g < this.groups; g++) {
        const o = g * 3
        const gx = sw[g] > 0 ? sx[g] / sw[g] : this.groupPos[o + 2] > 0 ? this.groupPos[o] : 0.5
        const gy = sw[g] > 0 ? sy[g] / sw[g] : this.groupPos[o + 2] > 0 ? this.groupPos[o + 1] : 0.5
        const d = (gx - x) * (gx - x) + (gy - y) * (gy - y)
        if (d < best) { best = d; slot = g }
      }
    }
    if (slot < 0) return
    try { p.xf.connect(this.out, 0, 2 + slot) } catch { return }
    p.slot = slot
    this.groupCount[slot]++
  }

  private makePlayer(path: string, out: GainNode, gain: number): Player {
    const audio = document.createElement('audio')
    audio.crossOrigin = 'anonymous' // the graph only hears same-origin / CORS media
    audio.preload = 'auto'
    audio.loop = true
    audio.src = mediaUrlForPath(soundFileFor(path))
    // Routed into the graph BEFORE it ever plays : never a blip on the speakers.
    const src = this.ctx.createMediaElementSource(audio)
    const g = this.ctx.createGain()
    g.gain.value = gain
    src.connect(g).connect(out)
    return { audio, src, g, started: false, path, wantIn: false, stopAt: 0, dipAt: 0, pos0: 0 }
  }

  /** Really sounding : positioned, playing, not seeking, with data, AND its
   *  position has moved on (60 ms of the film played). The ready state alone
   *  said so ~30 ms after play(), before its sound reached the graph : the
   *  film then started abruptly halfway into its fade-in (measured : a click at
   *  every takeover, 26 in 10 s on one churning deck). */
  private sounding(p: Player): boolean {
    const a = p.audio
    return p.started && !a.paused && !a.seeking && a.readyState >= 3 && Math.abs(a.currentTime - p.pos0) > 0.06
  }

  /** Its picture paused or hidden : fade the sound out, pause it after
   *  (pausing cut it mid-wave : a click every time a Collage went off). */
  private stopPlayer(p: Player, now: number): void {
    if (p.audio.paused || p.stopAt) return
    fade(p.g.gain, now, FADE_S, 'out')
    p.stopAt = now + AHEAD + 2 * FADE_S + 0.02 // eight time constants : silent when it pauses
  }

  /** The player for a jump within the deck's clip : its spare, silent and
   *  ready to be positioned, or a new one. */
  private jumpPlayer(d: DeckPlayer): Player {
    const p = d.spare
    if (!p || p.path !== d.path) return this.makePlayer(d.path, d.bus, 0)
    d.spare = null
    p.g.gain.cancelScheduledValues(0)
    p.g.gain.value = 0
    p.started = false
    p.wantIn = false; p.stopAt = 0; p.dipAt = 0
    return p
  }

  /** A player done fading out : kept as the deck's spare when it plays the
   *  deck's file and there is none yet, released otherwise. */
  private parkPlayer(d: DeckPlayer, p: Player): void {
    if (d.spare || p.path !== d.path) { this.killPlayer(p); return }
    p.audio.pause()
    d.spare = p
  }

  private killPlayer(p: Player): void {
    p.audio.pause()
    p.audio.removeAttribute('src')
    p.audio.load()
    try { p.src.disconnect(); p.g.disconnect() } catch { /* already gone */ }
  }

  /** The deck's player for `path`. A new path is a new player that crossfades
   *  in (over `T`) once it actually sounds; the old one plays on until then. */
  private deckPlayer(key: string, path: string, T: number): DeckPlayer {
    let d = this.decks.get(key)
    if (d && d.path !== path) {
      d.path = path
      if (d.spare) { this.killPlayer(d.spare); d.spare = null }
      if (d.next) this.killPlayer(d.next)
      d.next = this.makePlayer(path, d.bus, 0)
      d.nextT = T
      d.nextSince = this.ctx.currentTime
    }
    if (!d) {
      const ctx = this.ctx
      const bus = ctx.createGain()
      // bus → high-pass ×2 → low-pass ×2 (Butterworth 4th order each : 24 dB/oct,
      // flat to the corner, -3 dB at it) → the pieces. Web Audio reads a low- or
      // high-pass Q in DECIBELS : the Butterworth Qs 0.5412 and 1.3066 are -5.33
      // and +2.32 dB (given as plain numbers they rang, +3.8 dB below the corner).
      const bw = (type: BiquadFilterType, hz: number): BiquadFilterNode[] =>
        [-5.3329, 2.3226].map((q) => { const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.value = hz; return f })
      const hp = bw('highpass', this.hpHz)
      const lp = bw('lowpass', Math.min(this.lpHz, ctx.sampleRate * 0.45))
      setSlope(hp, 'highpass', this.hpSlope)
      setSlope(lp, 'lowpass', this.lpSlope)
      const out = ctx.createGain()
      bus.connect(hp[0]).connect(hp[1]).connect(lp[0]).connect(lp[1]).connect(out)
      // The first player starts silent and fades in once it sounds : at gain 1
      // it started at full level whenever its file had loaded, long after its
      // pieces had faded in (a click each time a Collage came on).
      const first = this.makePlayer(path, bus, 0)
      first.wantIn = true
      const dp: DeckPlayer = {
        bus, hp, lp, out, cur: first, next: null, nextT: 0, nextSince: 0, fading: [], spare: null,
        path, video: null, onSeek: () => {}, used: true
      }
      dp.onSeek = (): void => this.resyncDeck(dp, true)
      d = dp
      this.decks.set(key, d)
    }
    return d
  }

  /** Hold one player to the video : rate, play/pause, position. Returns false
   *  when it should jump but is audible (the deck splices a fresh player in). */
  private resyncPlayer(a: HTMLAudioElement, p: Player, v: HTMLVideoElement, force: boolean, audible: boolean): boolean {
    // Not loaded yet : wait (playing it now would sound the file's opening
    // before the position lands).
    if (a.readyState < 1) return true
    const dur = a.duration
    const t = Number.isFinite(dur) && dur > 0 ? v.currentTime % dur : v.currentTime
    if (!Number.isFinite(t)) return true
    if (!p.started) {
      try { a.currentTime = t; p.pos0 = t } catch { /* not seekable yet */ }
    } else {
      let d = t - a.currentTime
      if (Number.isFinite(dur) && dur > 0 && Math.abs(d) > dur / 2) d -= Math.sign(d) * dur // across the loop point
      if (force || Math.abs(d) > SEEK_S) {
        if (audible) return false
        try { a.currentTime = t; p.pos0 = t } catch { /* not seekable yet */ }
      }
    }
    // The speed follows the picture's, but never in small nudges : every change
    // of an element's playbackRate restarts its pitch-keeping time-stretch, and
    // that clicks (measured : a click at each nudge, ~14 a second on a still
    // Collage). Drift is pulled in by a crossfaded re-sync past SEEK_S instead.
    const want = v.playbackRate
    if (want > 0.0625 && want <= 16 && Math.abs(a.playbackRate - want) > 0.01 * want) {
      try { a.playbackRate = want } catch { /* out-of-band rate */ }
    }
    if (a.paused) { if (p.started) p.pos0 = a.currentTime; void a.play().catch(() => {}) }
    p.started = true
    return true
  }

  /** Hold the deck's players to its video, and hand over to a waiting player
   *  once it sounds. */
  private resyncDeck(d: DeckPlayer, force = false): void {
    const v = d.video
    if (d.next) {
      // A clip switch : the video reloads (and reads as PAUSED while it does),
      // so the old clip plays on untouched until the new one sounds; the new
      // player is positioned once the picture runs. (Pausing here was the
      // silence at every deal.)
      if (v && !v.paused && !v.ended && v.readyState >= 2) this.resyncPlayer(d.next.audio, d.next, v, force, false)
      return
    }
    const now = this.ctx.currentTime
    if (!v || v.paused || v.ended) {
      this.stopPlayer(d.cur, now)
      return
    }
    // back before it had stopped : fade in again from where the fade-out is
    if (d.cur.stopAt) { d.cur.stopAt = 0; d.cur.wantIn = true }
    // The video is seeking (a re-cue, a window loop) : the sound plays on as it
    // is until the picture runs again.
    if (v.readyState < 2) return
    if (!this.resyncPlayer(d.cur.audio, d.cur, v, force, d.cur.started)) {
      // An audible jump : splice another player of the same file in instead.
      d.next = this.jumpPlayer(d)
      d.nextT = SPLICE_XF
      d.nextSince = this.ctx.currentTime
      this.resyncPlayer(d.next.audio, d.next, v, false, false)
    }
  }

  /** Crossfade a waiting player in once it sounds; release faded-out ones. */
  private stepDeck(d: DeckPlayer, now: number): void {
    if (d.fading.length) {
      d.fading = d.fading.filter((f) => {
        if (now < f.until) return true
        this.parkPlayer(d, f.p)
        return false
      })
    }
    const c = d.cur
    // stopping : paused once faded out (and faded in when it plays again)
    if (c.stopAt && now >= c.stopAt) { c.audio.pause(); c.stopAt = 0; c.wantIn = true }
    // starting or back : faded in once it really sounds
    if (c.wantIn && !c.stopAt && this.sounding(c)) { fade(c.g.gain, now, FADE_S, 'in'); c.wantIn = false }
    // The file's own loop point is a hard seam (its last sample against its
    // first) : the sound ducks across it, out 30 ms before, back 60 ms after.
    const a = c.audio
    if (!d.next && !c.wantIn && !c.stopAt && c.started && !a.paused && a.loop && !(c.dipAt > now)) {
      const dur = a.duration
      if (Number.isFinite(dur) && dur > 1) {
        const left = (dur - a.currentTime) / Math.max(0.0625, a.playbackRate)
        if (left > 0 && left < 0.15) {
          const g = c.g.gain
          const t0 = now + AHEAD, t1 = Math.max(t0 + 0.01, now + left - 0.01), t2 = now + left + 0.04
          try {
            try { g.cancelAndHoldAtTime(t0) } catch { /* nothing to hold */ }
            g.setTargetAtTime(0, t0, Math.max(0.003, (t1 - t0) / 4))
            g.setTargetAtTime(1, t2, 0.008)
          } catch { /* the duck is a nicety */ }
          c.dipAt = t2 + 0.05
        }
      }
    }
    const nx = d.next
    if (!nx) return
    // (not while it seeks : a reused player still holds its old position)
    const sounding = this.sounding(nx)
    if (sounding || now - d.nextSince > NEXT_WAIT_S || !d.video) {
      fade(d.cur.g.gain, now, d.nextT, 'out')
      d.cur.stopAt = 0
      d.fading.push({ p: d.cur, until: now + AHEAD + 2 * d.nextT + 0.1 })
      // one that has not sounded yet fades in when it does (faded in while
      // silent, it started at full level whenever its file loaded : a click)
      if (sounding) fade(nx.g.gain, now, d.nextT, 'in')
      else nx.wantIn = true
      d.cur = nx
      d.next = null
    }
  }

  private bindVideo(d: DeckPlayer, v: HTMLVideoElement | null): void {
    if (d.video === v) return
    d.video?.removeEventListener('seeked', d.onSeek)
    d.video = v
    v?.addEventListener('seeked', d.onSeek)
  }

  private pieceChain(key: string, fadeIn: number): PieceChain {
    let p = this.pieces.get(key)
    if (p) return p
    const ctx = this.ctx
    // Each piece is a POINT SOURCE at its place in the frame : its film folds to
    // mono here, then the panner places it with equal power. (Left stereo, the
    // panner only BALANCED the film : a centred piece kept the film's whole
    // width and an edge piece folded one channel into the other, louder.)
    const inG = ctx.createGain()
    inG.channelCount = 1
    inG.channelCountMode = 'explicit'
    inG.channelInterpretation = 'speakers'
    const dry = ctx.createGain()
    const pan = ctx.createStereoPanner()
    const xf = ctx.createGain()
    const bp: BiquadFilterNode[] = []
    const bpG: GainNode[] = []
    // dry + resonators → the deal crossfade (mono) → the panner → the bus.
    // (The crossfade sits before the panner so Space can take each piece mono,
    // already fading in and out with the deals.)
    inG.connect(dry).connect(xf)
    for (let h = 0; h < HARM.length; h++) {
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      const g = ctx.createGain()
      inG.connect(f).connect(g).connect(xf)
      bp.push(f)
      bpG.push(g)
    }
    xf.connect(pan).connect(this.bus)
    inG.gain.value = 0
    if (fadeIn > 0) {
      // Born in a deal : it comes in over the crossfade as the old piece goes.
      xf.gain.value = 0
      fade(xf.gain, ctx.currentTime, fadeIn, 'in')
    }
    p = { deckKey: '', inG, dry, bp, bpG, pan, xf, used: true, tg: new Float64Array(12).fill(NaN), slot: -1 }
    this.pieces.set(key, p)
    return p
  }

  private dropPiece(p: PieceChain): void {
    this.unseat(p)
    try {
      // off its film's bus too : the bus outlives the piece, and an input left
      // hanging there piled up with every mask peel-and-return
      if (p.deckKey) this.decks.get(p.deckKey)?.out.disconnect(p.inG)
    } catch { /* not connected */ }
    try {
      p.inG.disconnect(); p.dry.disconnect(); p.pan.disconnect(); p.xf.disconnect()
      p.bp.forEach((f) => f.disconnect()); p.bpG.forEach((g) => g.disconnect())
    } catch { /* already gone */ }
  }

  private dropDeck(key: string, d: DeckPlayer): void {
    this.bindVideo(d, null)
    this.killPlayer(d.cur)
    if (d.next) this.killPlayer(d.next)
    if (d.spare) this.killPlayer(d.spare)
    for (const f of d.fading) this.killPlayer(f.p)
    try { d.bus.disconnect(); d.hp.forEach((f) => f.disconnect()); d.lp.forEach((f) => f.disconnect()); d.out.disconnect() } catch { /* already gone */ }
    this.decks.delete(key)
  }

  /** ~30 Hz : follow the walls, retune and re-place every piece. `notes` is the
   *  scale table (ascending Hz) the distance from the centre picks from. */
  update(sets: CollageSoundSet[], cfg: CollageVoiceCfg, notes: Float32Array): void {
    const now = this.ctx.currentTime
    // the films in : every deck's filters follow the voice's hp / lp
    const hpHz = Math.max(20, Math.min(1000, cfg.hp ?? 20)), lpHz = Math.max(1000, Math.min(20000, cfg.lp ?? 20000))
    if (hpHz !== this.hpHz || lpHz !== this.lpHz) {
      this.hpHz = hpHz; this.lpHz = lpHz
      for (const d of this.decks.values()) {
        d.hp.forEach((f) => f.frequency.setTargetAtTime(hpHz, now, 0.03))
        d.lp.forEach((f) => f.frequency.setTargetAtTime(Math.min(lpHz, this.ctx.sampleRate * 0.45), now, 0.03))
      }
    }
    const hpS = cfg.hpSlope === 12 ? 12 : 24, lpS = cfg.lpSlope === 12 ? 12 : 24
    if (hpS !== this.hpSlope || lpS !== this.lpSlope) {
      this.hpSlope = hpS; this.lpSlope = lpS
      for (const d of this.decks.values()) { setSlope(d.hp, 'highpass', hpS); setSlope(d.lp, 'lowpass', lpS) }
    }
    const inLin = Math.max(0, cfg.inGain ?? 1)
    for (const d of this.decks.values()) d.used = false
    for (const p of this.pieces.values()) p.used = false
    let nPieces = 0
    let nFilms = 0
    // Space : where each piece group sounds from, this update
    const gx = new Float32Array(PIECE_GROUPS), gy = new Float32Array(PIECE_GROUPS), gw = new Float32Array(PIECE_GROUPS)
    for (const set of sets) {
      // the whole pool's audio-only copies, made ahead of the deals that need them
      if (set.files && set.files !== this.filesSeen.get(set.id)) {
        this.filesSeen.set(set.id, set.files)
        for (const f of set.files) wantAudioCopy(f)
      }
      if (set.level <= 0.001) continue
      // A re-cut since last time : every piece of this wall hands over to the
      // new deal through a crossfade (the old places and notes fade out).
      const lastDeal = this.dealOf.get(set.id)
      const dealt = set.deal !== undefined && lastDeal !== undefined && set.deal !== lastDeal
      if (set.deal !== undefined) this.dealOf.set(set.id, set.deal)
      // Deals faster than the crossfade (a modulated cuts, a quick deal clock)
      // shorten it to the gap between them : the fades never pile up.
      const since = now - (this.dealAt.get(set.id) ?? -1e9)
      const T = dealt ? Math.max(MIN_XF, Math.min(set.xfade ?? 0, since)) : 0
      if (dealt) {
        this.dealAt.set(set.id, now)
        const pre = `${set.id}:p`
        for (const [k, p] of this.pieces) {
          if (!k.startsWith(pre)) continue
          fade(p.xf.gain, now, T, 'out')
          this.retiring.push({ p, until: now + AHEAD + 2 * T + 0.03 })
          this.pieces.delete(k)
        }
        // a hard ceiling on chains still fading (each is ~9 audio nodes)
        while (this.retiring.length > RETIRE_MAX) this.dropPiece(this.retiring.shift()!.p)
      }
      const shown = set.pieces.filter((pc) => pc.keep > 0.001 && set.decks[pc.deck]?.path && set.decks[pc.deck]?.el)
      if (!shown.length) continue
      // Films : one player per deck that a shown piece plays.
      const deckKeys = new Map<number, string>()
      for (const pc of shown) {
        if (deckKeys.has(pc.deck)) continue
        const dk = set.decks[pc.deck]
        const key = `${set.id}:${pc.deck}`
        const d = this.deckPlayer(key, dk.path!, dealt ? T : SWITCH_XF)
        this.bindVideo(d, dk.el)
        this.resyncDeck(d)
        this.stepDeck(d, now)
        d.used = true
        deckKeys.set(pc.deck, key)
        nFilms++
      }
      // Pieces.
      // sqrt(2) : a centred mono piece lands at the level the stereo film had.
      const norm = (Math.SQRT2 * set.level) / Math.sqrt(shown.length)
      const halfX = set.aspect / 2
      const rMax = Math.sqrt(halfX * halfX + 0.25)
      const Q = 2 + 58 * cfg.ring * cfg.ring
      // A narrow band passes a sliver of the film's energy : lift it back, so
      // full resonance is as loud as the dry films at any ring (calibrated on
      // pink and brown noise : 3x at Q 2.6 up to 16x at Q 44).
      const wet = cfg.reso * Math.max(1, 2.63 * Math.sqrt(Q) - 1.1)
      const hw = [1, 0.25 + 0.6 * cfg.bright, 0.1 + 0.5 * cfg.bright]
      const nyq = this.ctx.sampleRate * 0.45
      set.pieces.forEach((pc, i) => {
        const dkey = deckKeys.get(pc.deck)
        if (!dkey || pc.keep <= 0.001) return
        const key = `${set.id}:p${i}`
        // The piece shows another film now (outside a deal) : the old chain fades
        // out on its film while a new one fades in on the new film. Rewiring the
        // chain from one film to the other switched its sound mid-wave (a click
        // at every such change, the most frequent under churn).
        const was = this.pieces.get(key)
        const handover = !dealt && !!was && !!was.deckKey && was.deckKey !== dkey
        if (handover) {
          fade(was!.xf.gain, now, SWITCH_XF, 'out')
          this.retiring.push({ p: was!, until: now + AHEAD + 2 * SWITCH_XF + 0.03 })
          this.pieces.delete(key)
        }
        const fresh = !this.pieces.has(key)
        const p = this.pieceChain(key, dealt ? T : handover ? SWITCH_XF : 0)
        p.used = true
        if (p.deckKey !== dkey) {
          if (p.deckKey) { const old = this.decks.get(p.deckKey); try { old?.out.disconnect(p.inG) } catch { /* not connected */ } }
          this.decks.get(dkey)!.out.connect(p.inG)
          p.deckKey = dkey
        }
        // Note : distance from the frame centre (aspect-true) → scale step.
        const dx = (pc.x - 0.5) * set.aspect
        const dy = pc.y - 0.5
        const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) / rMax)
        const n = notes.length
        const f0 = n ? notes[Math.min(n - 1, Math.round(r * (n - 1)))] : 220
        const panV = Math.max(-1, Math.min(1, (pc.x - 0.5) * 2 * cfg.width))
        if (fresh && (dealt || handover)) {
          // A deal's new piece starts AT its note and place (the crossfade is
          // the transition, not a glide from wherever the chain began).
          for (let h = 0; h < HARM.length; h++) p.bp[h].frequency.value = Math.min(nyq, f0 * HARM[h])
          p.pan.pan.value = panV
          p.inG.gain.value = norm * pc.keep * inLin
        }
        for (let h = 0; h < HARM.length; h++) {
          glide(p, TG_F + h, p.bp[h].frequency, Math.min(nyq, f0 * HARM[h]), now)
          glide(p, TG_Q + h, p.bp[h].Q, Q, now)
          glide(p, TG_G + h, p.bpG[h].gain, wet * hw[h], now)
        }
        glide(p, TG_DRY, p.dry.gain, 1 - cfg.reso, now)
        glide(p, TG_PAN, p.pan.pan, panV, now)
        glide(p, TG_IN, p.inG.gain, norm * pc.keep * inLin, now)
        if (this.groups > 0) {
          this.seat(p, pc.x, pc.y, gx, gy, gw)
          if (p.slot >= 0) {
            const w = set.level * pc.keep
            gx[p.slot] += pc.x * w; gy[p.slot] += pc.y * w; gw[p.slot] += w
          }
        }
        nPieces++
      })
    }
    // Whatever is no longer shown fades out, then goes.
    for (const [k, p] of this.pieces) {
      if (p.used) continue
      if (p.inG.gain.value > 0.001) glide(p, TG_IN, p.inG.gain, 0, now)
      else { this.dropPiece(p); this.pieces.delete(k) }
    }
    // A deal's outgoing pieces, once faded.
    if (this.retiring.length) {
      this.retiring = this.retiring.filter((r) => {
        if (now < r.until) return true
        this.dropPiece(r.p)
        return false
      })
    }
    // A film nothing listens to any more (not even a fading piece) is released;
    // an unused one still fading pieces out keeps playing its crossfades.
    const inUse = new Set<string>()
    for (const p of this.pieces.values()) inUse.add(p.deckKey)
    for (const r of this.retiring) inUse.add(r.p.deckKey)
    for (const [k, d] of this.decks) {
      if (d.used) continue
      if (inUse.has(k)) this.stepDeck(d, now)
      else this.dropDeck(k, d)
    }
    this.status = { sets: sets.filter((s) => s.level > 0.001).length, pieces: nPieces, films: nFilms }
    for (let g = 0; g < PIECE_GROUPS; g++) {
      const o = g * 3
      if (gw[g] > 1e-6) { this.groupPos[o] = gx[g] / gw[g]; this.groupPos[o + 1] = gy[g] / gw[g]; this.groupPos[o + 2] = gw[g] }
      else this.groupPos[o + 2] = 0 // empty : it keeps its last place, silent
    }
  }

  /** The voice switching off : every piece fades out (the engine disposes it
   *  a moment later; disposing at once cut the films mid-wave). */
  silence(): void {
    const now = this.ctx.currentTime
    const quiet = (p: PieceChain): void => {
      try { p.inG.gain.cancelAndHoldAtTime(now + AHEAD); p.inG.gain.setTargetAtTime(0, now + AHEAD, 0.008) } catch { /* gone */ }
      p.tg[TG_IN] = 0 // the next glide back up is applied, not skipped as unchanged
    }
    for (const p of this.pieces.values()) quiet(p)
    for (const r of this.retiring) quiet(r.p)
  }

  /** The voice switched off, or Sonify stopped : silence and release everything. */
  dispose(): void {
    for (const p of this.pieces.values()) this.dropPiece(p)
    this.pieces.clear()
    for (const r of this.retiring) this.dropPiece(r.p)
    this.retiring = []
    for (const [k, d] of this.decks) this.dropDeck(k, d)
    try { this.bus.disconnect() } catch { /* already gone */ }
    try { this.out.disconnect() } catch { /* already gone */ }
    this.groupCount.fill(0)
    this.status = { sets: 0, pieces: 0, films: 0 }
  }
}
