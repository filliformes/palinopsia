// Sonify's COLLAGE voice : the films of a Collage source heard all at once, a
// sound collage that follows the picture.
//
// Every film (deck) gets its own hidden <audio> playing the clip's ORIGINAL
// file, held to its video : same position (resynced past 0.15 s of drift and on
// every seek, so the window loops and churn re-cues carry over), same speed,
// paused when it pauses. A separate element because the wall often plays an
// audio-less cache (the codec bridge and the optimise pass strip the sound),
// and because a <video> can feed only ONE audio graph for life while Sonify's
// context comes and goes.
//
// Every PIECE of the wall then gets its own chain, out of its film's player :
//   level (mask, layer, 1/sqrt(pieces)) → harmonic resonator → stereo pan → bus
//   · pan : the piece's horizontal place in the frame (centre = centre);
//   · resonator : three band-passes on the note and its 2nd and 3rd harmonics,
//     the note picked on the Sonify key/scale by the piece's distance from the
//     frame's centre (centre = the lowest note, the frame's edge = the highest,
//     in every direction), mixed with the dry film by RESONANCE.
// Several pieces showing one film are each their own voice (same sound, their
// own note and place). The bus feeds the Sonify worklet's second input, so the
// voice gets its mixer channel, the FX tail, the master and the limiter.

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
}

export interface CollageVoiceCfg {
  reso: number // 0 = the plain films · 1 = only the resonances
  ring: number // resonator sharpness (Q)
  bright: number // weight of the 2nd and 3rd harmonics
  width: number // stereo spread of the pan
}

interface DeckPlayer {
  audio: HTMLAudioElement
  src: MediaElementAudioSourceNode
  out: GainNode
  path: string
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
  used: boolean
}

const HARM = [1, 2, 3]
const SEEK_S = 0.25 // past this the audio jumps to the video
const LOCK_S = 0.02 // under this it simply plays along
const SMOOTH = 0.04 // param glide (s) : no zipper, no clicks

export class CollageVoice {
  private decks = new Map<string, DeckPlayer>()
  private pieces = new Map<string, PieceChain>()
  readonly bus: GainNode
  /** For the page : what the voice is playing right now. */
  status = { sets: 0, pieces: 0, films: 0 }

  constructor(private ctx: AudioContext) {
    this.bus = ctx.createGain()
  }

  private deckPlayer(key: string, path: string): DeckPlayer {
    let d = this.decks.get(key)
    if (d && d.path !== path) {
      // A new film on this deck : same element, new source (the graph stays).
      d.path = path
      d.audio.src = mediaUrlForPath(path)
    }
    if (!d) {
      const audio = document.createElement('audio')
      audio.crossOrigin = 'anonymous' // the graph only hears same-origin / CORS media
      audio.preload = 'auto'
      audio.loop = true
      audio.src = mediaUrlForPath(path)
      // Routed into the graph BEFORE it ever plays : never a blip on the speakers.
      const src = this.ctx.createMediaElementSource(audio)
      const out = this.ctx.createGain()
      src.connect(out)
      const dp: DeckPlayer = { audio, src, out, path, video: null, onSeek: () => {}, used: true }
      dp.onSeek = (): void => this.resync(dp, true)
      d = dp
      this.decks.set(key, d)
    }
    return d
  }

  /** Hold the audio to its video : rate, play/pause, position. */
  private resync(d: DeckPlayer, force = false): void {
    const v = d.video
    const a = d.audio
    if (!v) { if (!a.paused) a.pause(); return }
    const rate = v.playbackRate
    const playing = !v.paused && !v.ended && v.readyState >= 2
    if (!playing) { if (!a.paused) a.pause(); return }
    // Small drift is pulled in by nudging the speed a few percent (inaudible,
    // pitch held); a large one, a seek or a re-cue jumps.
    let nudge = 1
    if (a.readyState >= 1 && Number.isFinite(v.currentTime)) {
      const dur = a.duration
      const t = Number.isFinite(dur) && dur > 0 ? v.currentTime % dur : v.currentTime
      let d = t - a.currentTime
      if (Number.isFinite(dur) && dur > 0 && Math.abs(d) > dur / 2) d -= Math.sign(d) * dur // across the loop point
      if (force || Math.abs(d) > SEEK_S) {
        try { a.currentTime = t } catch { /* not seekable yet */ }
      } else if (Math.abs(d) > LOCK_S) nudge = 1 + Math.max(-0.06, Math.min(0.06, d * 0.6))
    }
    const want = rate * nudge
    if (want > 0.0625 && want <= 16 && Math.abs(a.playbackRate - want) > 0.002) {
      try { a.playbackRate = want } catch { /* out-of-band rate */ }
    }
    if (a.paused) void a.play().catch(() => {})
  }

  private bindVideo(d: DeckPlayer, v: HTMLVideoElement | null): void {
    if (d.video === v) return
    d.video?.removeEventListener('seeked', d.onSeek)
    d.video = v
    v?.addEventListener('seeked', d.onSeek)
  }

  private pieceChain(key: string): PieceChain {
    let p = this.pieces.get(key)
    if (p) return p
    const ctx = this.ctx
    const inG = ctx.createGain()
    const dry = ctx.createGain()
    const pan = ctx.createStereoPanner()
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
    pan.connect(this.bus)
    inG.gain.value = 0
    p = { deckKey: '', inG, dry, bp, bpG, pan, used: true }
    this.pieces.set(key, p)
    return p
  }

  private dropPiece(key: string, p: PieceChain): void {
    try {
      p.inG.disconnect(); p.dry.disconnect(); p.pan.disconnect()
      p.bp.forEach((f) => f.disconnect()); p.bpG.forEach((g) => g.disconnect())
    } catch { /* already gone */ }
    this.pieces.delete(key)
  }

  private dropDeck(key: string, d: DeckPlayer): void {
    this.bindVideo(d, null)
    d.audio.pause()
    d.audio.removeAttribute('src')
    d.audio.load()
    try { d.src.disconnect(); d.out.disconnect() } catch { /* already gone */ }
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
      const shown = set.pieces.filter((pc) => pc.keep > 0.001 && set.decks[pc.deck]?.path && set.decks[pc.deck]?.el)
      if (!shown.length) continue
      // Films : one player per deck that a shown piece plays.
      const deckKeys = new Map<number, string>()
      for (const pc of shown) {
        if (deckKeys.has(pc.deck)) continue
        const dk = set.decks[pc.deck]
        const key = `${set.id}:${pc.deck}`
        const d = this.deckPlayer(key, dk.path!)
        this.bindVideo(d, dk.el)
        this.resync(d)
        d.used = true
        deckKeys.set(pc.deck, key)
        nFilms++
      }
      // Pieces.
      const norm = set.level / Math.sqrt(shown.length)
      const halfX = set.aspect / 2
      const rMax = Math.sqrt(halfX * halfX + 0.25)
      const Q = 2 + 58 * cfg.ring * cfg.ring
      // A narrow band passes a sliver of the film's energy : lift it back, so
      // full resonance is as loud as the dry films at any ring (calibrated on
      // pink and brown noise : 3x at Q 2.6 up to 16x at Q 44).
      const wet = cfg.reso * Math.max(1, 2.63 * Math.sqrt(Q) - 1.1)
      const hw = [1, 0.25 + 0.6 * cfg.bright, 0.1 + 0.5 * cfg.bright]
      set.pieces.forEach((pc, i) => {
        const dkey = deckKeys.get(pc.deck)
        if (!dkey || pc.keep <= 0.001) return
        const key = `${set.id}:p${i}`
        const p = this.pieceChain(key)
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
        const nyq = this.ctx.sampleRate * 0.45
        for (let h = 0; h < HARM.length; h++) {
          const f = Math.min(nyq, f0 * HARM[h])
          p.bp[h].frequency.setTargetAtTime(f, now, SMOOTH)
          p.bp[h].Q.setTargetAtTime(Q, now, SMOOTH)
          p.bpG[h].gain.setTargetAtTime(wet * hw[h], now, SMOOTH)
        }
        p.dry.gain.setTargetAtTime(1 - cfg.reso, now, SMOOTH)
        p.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (pc.x - 0.5) * 2 * cfg.width)), now, SMOOTH)
        p.inG.gain.setTargetAtTime(norm * pc.keep, now, SMOOTH)
        nPieces++
      })
    }
    // Whatever is no longer shown fades out, then goes.
    for (const [k, p] of this.pieces) {
      if (p.used) continue
      if (p.inG.gain.value > 0.001) p.inG.gain.setTargetAtTime(0, now, SMOOTH)
      else this.dropPiece(k, p)
    }
    for (const [k, d] of this.decks) if (!d.used && ![...this.pieces.values()].some((p) => p.deckKey === k)) this.dropDeck(k, d)
    this.status = { sets: sets.filter((s) => s.level > 0.001).length, pieces: nPieces, films: nFilms }
  }

  /** The voice switched off, or Sonify stopped : silence and release everything. */
  dispose(): void {
    for (const [k, p] of this.pieces) this.dropPiece(k, p)
    for (const [k, d] of this.decks) this.dropDeck(k, d)
    try { this.bus.disconnect() } catch { /* already gone */ }
    this.status = { sets: 0, pieces: 0, films: 0 }
  }
}
