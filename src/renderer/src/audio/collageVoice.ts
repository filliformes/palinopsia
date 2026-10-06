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
// old keeps playing until the new one actually sounds.

const mediaUrlForPath = (path: string): string => `opsia-media://local/${encodeURIComponent(path)}`

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
}

export interface CollageVoiceCfg {
  reso: number // 0 = the plain films · 1 = only the resonances
  ring: number // resonator sharpness (Q)
  bright: number // weight of the 2nd and 3rd harmonics
  width: number // stereo spread of the pan
}

/** One <audio> playing one file into its deck's bus. */
interface Player {
  audio: HTMLAudioElement
  src: MediaElementAudioSourceNode
  g: GainNode // its crossfade gain
  started: boolean // positioned and playing at least once
}

interface DeckPlayer {
  bus: GainNode // the pieces listen here : stable across clip switches
  cur: Player
  next: Player | null // a new clip, or a jump, waiting to sound before it takes over
  nextT: number // the crossfade time it will use
  nextSince: number
  fading: Array<{ p: Player; until: number }>
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
  xf: GainNode // the deal crossfade
  used: boolean
}

const HARM = [1, 2, 3]
const SEEK_S = 0.25 // past this the audio jumps to the video
const LOCK_S = 0.02 // under this it simply plays along
const SMOOTH = 0.04 // param glide (s) : no zipper, no clicks
const MIN_XF = 0.03 // the shortest crossfade : a cut, without the click
const SWITCH_XF = 0.08 // a film taking a new clip outside a deal (churn)
const SPLICE_XF = 0.04 // a film jumping within its clip (window loop, re-cue)
const NEXT_WAIT_S = 1.5 // a new player that never sounds still takes over
const RETIRE_MAX = 192 // fading-out piece chains kept at most

// Equal-power fade curve (sin of a quarter turn) : two uncorrelated films
// crossfaded with it keep their summed loudness all the way through.
const CURVE_N = 33
const QUARTER = Float32Array.from({ length: CURVE_N }, (_, i) => Math.sin(((i / (CURVE_N - 1)) * Math.PI) / 2))

function fade(param: AudioParam, now: number, T: number, dir: 'in' | 'out'): void {
  const dur = Math.max(0.01, T)
  try {
    param.cancelAndHoldAtTime(now)
    const v0 = param.value
    const c = new Float32Array(CURVE_N)
    for (let i = 0; i < CURVE_N; i++) c[i] = dir === 'in' ? v0 + (1 - v0) * QUARTER[i] : v0 * QUARTER[CURVE_N - 1 - i]
    param.setValueCurveAtTime(c, now, dur)
  } catch {
    param.setTargetAtTime(dir === 'in' ? 1 : 0, now, dur / 3)
  }
}

export class CollageVoice {
  private decks = new Map<string, DeckPlayer>()
  private pieces = new Map<string, PieceChain>()
  private retiring: Array<{ p: PieceChain; until: number }> = []
  private dealOf = new Map<string, number>()
  private dealAt = new Map<string, number>()
  readonly bus: GainNode
  /** For the page : what the voice is playing right now. */
  status = { sets: 0, pieces: 0, films: 0 }

  constructor(private ctx: AudioContext) {
    this.bus = ctx.createGain()
  }

  private makePlayer(path: string, out: GainNode, gain: number): Player {
    const audio = document.createElement('audio')
    audio.crossOrigin = 'anonymous' // the graph only hears same-origin / CORS media
    audio.preload = 'auto'
    audio.loop = true
    audio.src = mediaUrlForPath(path)
    // Routed into the graph BEFORE it ever plays : never a blip on the speakers.
    const src = this.ctx.createMediaElementSource(audio)
    const g = this.ctx.createGain()
    g.gain.value = gain
    src.connect(g).connect(out)
    return { audio, src, g, started: false }
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
      if (d.next) this.killPlayer(d.next)
      d.next = this.makePlayer(path, d.bus, 0)
      d.nextT = T
      d.nextSince = this.ctx.currentTime
    }
    if (!d) {
      const bus = this.ctx.createGain()
      const dp: DeckPlayer = {
        bus, cur: this.makePlayer(path, bus, 1), next: null, nextT: 0, nextSince: 0, fading: [],
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
    let nudge = 1
    if (!p.started) {
      try { a.currentTime = t } catch { /* not seekable yet */ }
    } else {
      let d = t - a.currentTime
      if (Number.isFinite(dur) && dur > 0 && Math.abs(d) > dur / 2) d -= Math.sign(d) * dur // across the loop point
      if (force || Math.abs(d) > SEEK_S) {
        if (audible) return false
        try { a.currentTime = t } catch { /* not seekable yet */ }
      } else if (Math.abs(d) > LOCK_S) nudge = 1 + Math.max(-0.06, Math.min(0.06, d * 0.6))
    }
    // Small drift is pulled in by nudging the speed a few percent (inaudible,
    // pitch held); a large one, a seek or a re-cue jumps.
    const want = v.playbackRate * nudge
    if (want > 0.0625 && want <= 16 && Math.abs(a.playbackRate - want) > 0.002) {
      try { a.playbackRate = want } catch { /* out-of-band rate */ }
    }
    if (a.paused) void a.play().catch(() => {})
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
    if (!v || v.paused || v.ended) {
      if (!d.cur.audio.paused) d.cur.audio.pause()
      return
    }
    // The video is seeking (a re-cue, a window loop) : the sound plays on as it
    // is until the picture runs again.
    if (v.readyState < 2) return
    if (!this.resyncPlayer(d.cur.audio, d.cur, v, force, d.cur.started)) {
      // An audible jump : splice a fresh player of the same file in instead.
      d.next = this.makePlayer(d.path, d.bus, 0)
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
        this.killPlayer(f.p)
        return false
      })
    }
    const nx = d.next
    if (!nx) return
    const sounding = nx.started && !nx.audio.paused && nx.audio.readyState >= 3
    if (sounding || now - d.nextSince > NEXT_WAIT_S || !d.video) {
      fade(d.cur.g.gain, now, d.nextT, 'out')
      d.fading.push({ p: d.cur, until: now + d.nextT + 0.1 })
      fade(nx.g.gain, now, d.nextT, 'in')
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
    inG.connect(dry).connect(pan)
    for (let h = 0; h < HARM.length; h++) {
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      const g = ctx.createGain()
      inG.connect(f).connect(g).connect(pan)
      bp.push(f)
      bpG.push(g)
    }
    pan.connect(xf).connect(this.bus)
    inG.gain.value = 0
    if (fadeIn > 0) {
      // Born in a deal : it comes in over the crossfade as the old piece goes.
      xf.gain.value = 0
      fade(xf.gain, ctx.currentTime, fadeIn, 'in')
    }
    p = { deckKey: '', inG, dry, bp, bpG, pan, xf, used: true }
    this.pieces.set(key, p)
    return p
  }

  private dropPiece(p: PieceChain): void {
    try {
      // off its film's bus too : the bus outlives the piece, and an input left
      // hanging there piled up with every mask peel-and-return
      if (p.deckKey) this.decks.get(p.deckKey)?.bus.disconnect(p.inG)
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
    for (const f of d.fading) this.killPlayer(f.p)
    try { d.bus.disconnect() } catch { /* already gone */ }
    this.decks.delete(key)
  }

  /** ~30 Hz : follow the walls, retune and re-place every piece. `notes` is the
   *  scale table (ascending Hz) the distance from the centre picks from. */
  update(sets: CollageSoundSet[], cfg: CollageVoiceCfg, notes: Float32Array): void {
    const now = this.ctx.currentTime
    for (const d of this.decks.values()) d.used = false
    for (const p of this.pieces.values()) p.used = false
    let nPieces = 0
    let nFilms = 0
    for (const set of sets) {
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
          this.retiring.push({ p, until: now + T + 0.05 })
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
        const fresh = !this.pieces.has(key)
        const p = this.pieceChain(key, dealt ? T : 0)
        p.used = true
        if (p.deckKey !== dkey) {
          if (p.deckKey) { const old = this.decks.get(p.deckKey); try { old?.bus.disconnect(p.inG) } catch { /* not connected */ } }
          this.decks.get(dkey)!.bus.connect(p.inG)
          p.deckKey = dkey
        }
        // Note : distance from the frame centre (aspect-true) → scale step.
        const dx = (pc.x - 0.5) * set.aspect
        const dy = pc.y - 0.5
        const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) / rMax)
        const n = notes.length
        const f0 = n ? notes[Math.min(n - 1, Math.round(r * (n - 1)))] : 220
        const panV = Math.max(-1, Math.min(1, (pc.x - 0.5) * 2 * cfg.width))
        if (fresh && dealt) {
          // A deal's new piece starts AT its note and place (the crossfade is
          // the transition, not a glide from wherever the chain began).
          for (let h = 0; h < HARM.length; h++) p.bp[h].frequency.value = Math.min(nyq, f0 * HARM[h])
          p.pan.pan.value = panV
          p.inG.gain.value = norm * pc.keep
        }
        for (let h = 0; h < HARM.length; h++) {
          const f = Math.min(nyq, f0 * HARM[h])
          p.bp[h].frequency.setTargetAtTime(f, now, SMOOTH)
          p.bp[h].Q.setTargetAtTime(Q, now, SMOOTH)
          p.bpG[h].gain.setTargetAtTime(wet * hw[h], now, SMOOTH)
        }
        p.dry.gain.setTargetAtTime(1 - cfg.reso, now, SMOOTH)
        p.pan.pan.setTargetAtTime(panV, now, SMOOTH)
        p.inG.gain.setTargetAtTime(norm * pc.keep, now, SMOOTH)
        nPieces++
      })
    }
    // Whatever is no longer shown fades out, then goes.
    for (const [k, p] of this.pieces) {
      if (p.used) continue
      if (p.inG.gain.value > 0.001) p.inG.gain.setTargetAtTime(0, now, SMOOTH)
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
  }

  /** The voice switched off, or Sonify stopped : silence and release everything. */
  dispose(): void {
    for (const p of this.pieces.values()) this.dropPiece(p)
    this.pieces.clear()
    for (const r of this.retiring) this.dropPiece(r.p)
    this.retiring = []
    for (const [k, d] of this.decks) this.dropDeck(k, d)
    try { this.bus.disconnect() } catch { /* already gone */ }
    this.status = { sets: 0, pieces: 0, films: 0 }
  }
}
