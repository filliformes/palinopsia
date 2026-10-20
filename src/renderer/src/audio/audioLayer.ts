// The Audio Layer : the layers tab's sound, under L4. Two slots, A and B, each a
// sound file (played like an Import Audio slot, through engine/clipPlayer.ts) or
// a live audio input (a device, one of its channels or a pair), each at its own
// volume and pan; the mix between them, then the layer's volume, into Sonify's
// mix (the worklet's third input, after its master) : the output EQ, the limiter,
// the recordings and Space all have it. Sonify off, the engine still runs for it,
// its voices silent.
//
// No React and no store here (the store imports Sonify's engine) : App feeds the
// state in (sync) and ticks the transport once a frame.

import type { AudioLayerSlot, AudioLayerState } from '@shared/types'
import { ClipPlayer } from '../engine/clipPlayer'
import { analyseFrame, frameBufs, readFeature, zero, type AudioFeatureName, type AudioFeatures, type FrameBufs } from '../engine/audioIn'
import { videoKey, videoPlayheads } from '../engine/videoState'
import { sonifyEngine } from './sonify'

/** The Audio Layer's index where the video seams key by layer (playheads,
 *  seeks, a modulator listening to a slot's sound). */
export const AUDIO_LAYER = -1

export type AudioSlotName = 'A' | 'B'
const SLOTS: AudioSlotName[] = ['A', 'B']

/** Which live slots may open their input (the store's runtime-only state, never
 *  saved : a session, an undo or New never opens a microphone by itself). */
export type AudioLayerArmed = Record<AudioSlotName, boolean>
export const NOT_ARMED: AudioLayerArmed = { A: false, B: false }

export function defaultAudioLayer(): AudioLayerState {
  return { A: null, B: null, mix: 0.5, volume: 1, mute: false }
}

const num = (v: unknown, d: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** A session's Audio Layer, checked field by field (an older file : none). */
export function sanitizeAudioLayer(v: unknown): AudioLayerState {
  const d = defaultAudioLayer()
  if (!v || typeof v !== 'object') return d
  const o = v as Record<string, unknown>
  const slot = (x: unknown): AudioLayerSlot | null => {
    if (!x || typeof x !== 'object') return null
    const q = x as Record<string, unknown>
    const kind = q.kind === 'live' ? 'live' : q.kind === 'file' ? 'file' : null
    if (!kind) return null
    if (kind === 'file' && !str(q.mediaId)) return null
    const s: AudioLayerSlot = {
      kind,
      volume: num(q.volume, kind === 'file' ? 0.8 : 1, 0, 2),
      pan: num(q.pan, 0, -1, 1),
      mute: q.mute === true
    }
    if (kind === 'file') {
      s.mediaId = str(q.mediaId)
      s.mediaName = str(q.mediaName)
      s.mediaPath = str(q.mediaPath)
      s.videoPlaying = q.videoPlaying !== false
      s.videoSpeed = num(q.videoSpeed, 1, 1 / 64, 128)
      s.videoLoop = q.videoLoop !== false
      s.videoIn = num(q.videoIn, 0, 0, 1)
      s.videoOut = num(q.videoOut, 1, 0, 1)
      s.ignoreGlobalSpeed = q.ignoreGlobalSpeed === true
      s.keepPitch = q.keepPitch === true
    } else {
      s.deviceId = str(q.deviceId)
      s.deviceLabel = str(q.deviceLabel)
      s.chL = Math.round(num(q.chL, 0, 0, 31))
      s.chR = Math.round(num(q.chR, 1, -1, 31))
    }
    return s
  }
  return {
    A: slot(o.A),
    B: slot(o.B),
    mix: num(o.mix, d.mix, 0, 1),
    volume: num(o.volume, d.volume, 0, 2),
    mute: o.mute === true
  }
}

/** The mix law : the centre plays both at their own volume, either end only one
 *  (no dip in the middle : a live input and a file blended both stay whole). */
export function mixGain(slot: AudioSlotName, mix: number): number {
  const m = Math.max(0, Math.min(1, mix))
  return slot === 'A' ? Math.min(1, 2 * (1 - m)) : Math.min(1, 2 * m)
}

/** What a slot plays : a change of it rebuilds its source (anything else is a
 *  gain, a pan or the transport). */
function sourceKey(s: AudioLayerSlot | null): string {
  if (!s) return ''
  if (s.kind === 'file') return `f:${s.mediaId ?? ''}`
  return `l:${s.deviceId ?? ''}:${s.chL ?? 0}:${s.chR ?? 1}`
}

export interface SlotInfo {
  /** a live input : the channels the device delivered (0 : not open yet) */
  channels: number
  label: string
  /** why a live input could not open, or why a file cannot play ('' : fine) */
  error: string
  /** a live input that was open and went away (unplugged) : it opens again
   *  when it comes back */
  lost: boolean
}
const NO_INFO: SlotInfo = { channels: 0, label: '', error: '', lost: false }

interface Chain {
  key: string
  vol: GainNode // the slot's volume (and its mute)
  pan: StereoPannerNode
  an: AnalyserNode // the slot's meter, after its volume and pan
  mixG: GainNode // its side of the A/B mix
  srcG: GainNode | null // what it plays, into vol : fades in and out (a cut clicked)
  // a file
  player: ClipPlayer | null
  elSrc: MediaElementAudioSourceNode | null
  // a live input
  stream: MediaStream | null
  streamSrc: MediaStreamAudioSourceNode | null
  split: ChannelSplitterNode | null
  merge: ChannelMergerNode | null
  req: number
}

const RAMP = 0.015 // a gain or pan change glides (a stepped one clicked)
const FADE = 0.015 // a source coming or going fades over this
const FADE_MS = 40 // then it lets go (the fade has landed)

class AudioLayerEngine {
  private st: AudioLayerState = defaultAudioLayer()
  private ctx: AudioContext | null = null
  private opening = false
  private out: GainNode | null = null // the layer's volume, into Sonify
  private bus: GainNode | null = null // the slots mixed, before the layer's volume
  private send: GainNode | null = null // that, in mono : the Filter voice's line-in
  private outAn: AnalyserNode | null = null
  private chains: Record<AudioSlotName, Chain | null> = { A: null, B: null }
  private armed: AudioLayerArmed = NOT_ARMED
  private seeks: Record<AudioSlotName, number | null> = { A: null, B: null }
  private resumeAt: Record<AudioSlotName, number> = { A: 0, B: 0 } // a rebuilt file starts here
  private live: Record<AudioSlotName, SlotInfo> = { A: NO_INFO, B: NO_INFO }
  // the device a lost default input was : it opens again only on that one, never
  // on whatever became the default meanwhile (a laptop's microphone)
  private lostLabel: Record<AudioSlotName, string> = { A: '', B: '' }
  private listeners = new Set<() => void>()
  private buf = new Float32Array(2048)
  // The whole layer's sound as features (a modulator FROM "AU all") : the live
  // input's own maths on the layer's analyser, run only while someone reads.
  private feats: AudioFeatures = zero()
  private fbufs: FrameBufs | null = null
  private featWantedAt = 0
  private featAt = 0
  private syncReq = 0
  private offCtx: (() => void) | null = null
  private offDevices: (() => void) | null = null

  constructor() {
    // A new audio context (Sonify healed a dead device) : everything starts over
    // on it, the files at the time they had reached.
    this.offCtx = sonifyEngine.onContext((ctx) => {
      if (this.ctx && this.ctx !== ctx) this.rebuildOn(ctx)
    })
    // A device plugged in or out : a live input that was lost or would not open
    // tries again.
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (md?.addEventListener) {
      const fn = (): void => this.retryLive()
      md.addEventListener('devicechange', fn)
      this.offDevices = () => md.removeEventListener('devicechange', fn)
    }
  }

  /** The layer's state, from the store (App calls it on every change); `armed`
   *  the live slots that may open their input. */
  sync(st: AudioLayerState, armed: AudioLayerArmed = NOT_ARMED): void {
    this.st = st
    this.armed = armed
    const active = !!(st.A || st.B)
    sonifyEngine.setLayerWanted(active)
    if (!active) {
      this.teardown(true)
      return
    }
    if (!this.ctx) {
      if (this.opening) return
      this.opening = true
      void sonifyEngine.context().then((ctx) => {
        this.opening = false
        if (!(this.st.A || this.st.B)) return
        this.buildOn(ctx)
      }).catch((e) => {
        this.opening = false
        console.warn('[audio layer] no audio context', e)
      })
      return
    }
    this.apply()
  }

  private buildOn(ctx: AudioContext): void {
    this.ctx = ctx
    const out = ctx.createGain()
    // the slots meet here, then the layer's volume; a mono copy of the sum (before
    // the volume and the mute) is what Sonify's Filter voice can play through
    const bus = ctx.createGain()
    bus.connect(out)
    const send = ctx.createGain()
    send.channelCount = 1
    send.channelCountMode = 'explicit'
    send.channelInterpretation = 'speakers'
    bus.connect(send)
    this.bus = bus
    this.send = send
    // the audio input's analyser settings, so its features read alike
    const an = ctx.createAnalyser()
    an.fftSize = 2048
    an.smoothingTimeConstant = 0.5
    out.connect(an)
    this.fbufs = frameBufs(an)
    this.out = out
    this.outAn = an
    sonifyEngine.setExternalInput(out)
    sonifyEngine.setLayerSend(send)
    this.apply()
  }

  /** Onto a new context : the old graph goes, the files resume where they were. */
  private rebuildOn(ctx: AudioContext): void {
    for (const s of SLOTS) this.resumeAt[s] = this.chains[s]?.player?.time() ?? 0
    this.teardown(false)
    this.buildOn(ctx)
  }

  /** `fade` : what plays fades out first (the layer emptied); else at once (a
   *  dead context, a hot update). */
  private teardown(fade: boolean): void {
    const ctx = this.ctx
    for (const s of SLOTS) this.dropChain(s, fade)
    const out = this.out, outAn = this.outAn, bus = this.bus, send = this.send
    this.out = null
    this.bus = null
    this.send = null
    this.outAn = null
    this.fbufs = null
    this.feats = zero()
    this.ctx = null
    if (!out) return
    const end = (): void => {
      // (a graph built again meanwhile has taken Sonify's input over already)
      if (!this.out) {
        sonifyEngine.setExternalInput(null)
        sonifyEngine.setLayerSend(null)
      }
      try { out.disconnect(); outAn?.disconnect(); bus?.disconnect(); send?.disconnect() } catch { /* gone */ }
    }
    if (fade && ctx) window.setTimeout(end, FADE_MS)
    else end()
  }

  private dropChain(s: AudioSlotName, fade: boolean): void {
    const c = this.chains[s]
    if (!c) return
    this.chains[s] = null
    const sounding = !!c.srcG
    this.dropSource(c, fade)
    const end = (): void => {
      try { c.vol.disconnect(); c.pan.disconnect(); c.an.disconnect(); c.mixG.disconnect() } catch { /* gone */ }
    }
    if (fade && sounding && this.ctx) window.setTimeout(end, FADE_MS)
    else end()
    videoPlayheads.delete(videoKey(AUDIO_LAYER, s))
    this.lostLabel[s] = ''
    this.setLive(s, NO_INFO)
  }

  /** What a chain plays goes : faded out, then let go (`fade` false, or nothing
   *  sounding : at once). A live input's device closes with it. */
  private dropSource(c: Chain, fade: boolean): void {
    c.req++
    const { player, elSrc, stream, streamSrc, split, merge, srcG } = c
    c.player = null
    c.elSrc = null
    c.stream = null
    c.streamSrc = null
    c.split = null
    c.merge = null
    c.srcG = null
    const end = (): void => {
      player?.dispose()
      try { elSrc?.disconnect(); streamSrc?.disconnect(); split?.disconnect(); merge?.disconnect(); srcG?.disconnect() } catch { /* gone */ }
      stream?.getTracks().forEach((t) => t.stop())
    }
    const ctx = this.ctx
    if (fade && srcG && ctx && ctx.state === 'running') {
      const t = ctx.currentTime
      srcG.gain.cancelScheduledValues(t)
      srcG.gain.setValueAtTime(srcG.gain.value, t)
      srcG.gain.linearRampToValueAtTime(0, t + FADE)
      window.setTimeout(end, FADE_MS)
    } else end()
  }

  /** A new source's own gain into its chain, fading in from silence. */
  private fadeIn(ctx: AudioContext, c: Chain): GainNode {
    const g = ctx.createGain()
    const t = ctx.currentTime
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(1, t + FADE)
    g.connect(c.vol)
    c.srcG = g
    return g
  }

  /** The state onto the graph : sources (only when what a slot plays changed),
   *  then the gains and pans, gliding. */
  private apply(): void {
    const ctx = this.ctx, out = this.out, bus = this.bus
    if (!ctx || !out || !bus) return
    const t = ctx.currentTime
    for (const s of SLOTS) {
      const cfg = this.st[s]
      if (!cfg) {
        this.dropChain(s, true)
        continue
      }
      let c = this.chains[s]
      if (!c) {
        const vol = ctx.createGain()
        const pan = ctx.createStereoPanner()
        const an = ctx.createAnalyser()
        an.fftSize = 1024
        const mixG = ctx.createGain()
        vol.gain.value = 0 // it fades in (below)
        vol.connect(pan).connect(mixG).connect(bus)
        pan.connect(an)
        c = { key: '', vol, pan, an, mixG, srcG: null, player: null, elSrc: null, stream: null, streamSrc: null, split: null, merge: null, req: 0 }
        this.chains[s] = c
      }
      // a live input opens only once armed (picked, or its open button)
      const key = cfg.kind === 'live' && !this.armed[s] ? '' : sourceKey(cfg)
      if (key !== c.key) {
        this.dropSource(c, true)
        c.key = key
        if (!key) {
          this.lostLabel[s] = ''
          this.setLive(s, { ...NO_INFO, label: cfg.deviceLabel ?? '' })
        } else if (cfg.kind === 'file') this.openFile(s, c, cfg)
        else this.openLive(s, c, cfg)
      }
      const v = cfg.mute ? 0 : Math.max(0, Math.min(2, cfg.volume))
      c.vol.gain.setTargetAtTime(v, t, RAMP)
      c.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, cfg.pan || 0)), t, RAMP)
      c.mixG.gain.setTargetAtTime(mixGain(s, this.st.mix), t, RAMP)
    }
    out.gain.setTargetAtTime(this.st.mute ? 0 : Math.max(0, Math.min(2, this.st.volume)), t, RAMP)
  }

  private openFile(s: AudioSlotName, c: Chain, cfg: AudioLayerSlot): void {
    const ctx = this.ctx
    if (!ctx || !cfg.mediaId) return
    this.setLive(s, NO_INFO)
    const p = new ClipPlayer(false)
    // it cannot play (a film without sound, a format nothing decodes) : the slot says so
    p.onFail = (why) => {
      if (this.chains[s] === c && c.player === p) this.setLive(s, { ...NO_INFO, error: why || 'it cannot play' })
    }
    p.load(cfg.mediaId, cfg.mediaPath ?? '', this.resumeAt[s])
    this.resumeAt[s] = 0
    try {
      c.elSrc = ctx.createMediaElementSource(p.audio)
      c.elSrc.connect(this.fadeIn(ctx, c))
    } catch (e) {
      console.warn('[audio layer] the file cannot join the mix', e)
      this.setLive(s, { ...NO_INFO, error: 'it cannot join the mix' })
    }
    c.player = p
  }

  private openLive(s: AudioSlotName, c: Chain, cfg: AudioLayerSlot): void {
    const req = ++c.req
    // The raw signal : an interface's input wants no voice processing (AGC would
    // flatten the very dynamics it is played with). As many channels as the
    // device gives (one or two through most drivers).
    const audio: MediaTrackConstraints = {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: { ideal: 32 }
    }
    // (a lost input trying again stays "lost" until it is back)
    const was = this.live[s]
    const lostAs = this.lostLabel[s]
    this.setLive(s, was.lost ? was : { ...NO_INFO, label: cfg.deviceLabel ?? '' })
    // The device by its id, or (another computer, the interface plugged into
    // another port : a new id) by its name.
    const open = async (): Promise<MediaStream> => {
      const md = navigator.mediaDevices
      if (!cfg.deviceId) {
        // the default input lost : only the device it was, back
        if (lostAs) {
          const back = (await md.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label === lostAs)
          if (!back) throw new Error('the input was disconnected')
          return md.getUserMedia({ audio: { ...audio, deviceId: { exact: back.deviceId } }, video: false })
        }
        return md.getUserMedia({ audio, video: false })
      }
      try {
        return await md.getUserMedia({ audio: { ...audio, deviceId: { exact: cfg.deviceId } }, video: false })
      } catch (e) {
        const same = cfg.deviceLabel ? (await md.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label === cfg.deviceLabel) : undefined
        if (!same) throw e
        return md.getUserMedia({ audio: { ...audio, deviceId: { exact: same.deviceId } }, video: false })
      }
    }
    open().then((stream) => {
      const ctx = this.ctx
      if (req !== c.req || this.chains[s] !== c || !ctx) { stream.getTracks().forEach((tr) => tr.stop()); return }
      const tr = stream.getAudioTracks()[0]
      const n = Math.max(1, Math.min(32, tr?.getSettings().channelCount ?? 2))
      const src = ctx.createMediaStreamSource(stream)
      const split = ctx.createChannelSplitter(n)
      const merge = ctx.createChannelMerger(2)
      const l = Math.min(n - 1, Math.max(0, cfg.chL ?? 0))
      const rr = cfg.chR ?? 1
      const r = rr < 0 ? l : Math.min(n - 1, Math.max(0, rr))
      src.connect(split)
      split.connect(merge, l, 0)
      split.connect(merge, r, 1)
      merge.connect(this.fadeIn(ctx, c))
      c.stream = stream
      c.streamSrc = src
      c.split = split
      c.merge = merge
      this.lostLabel[s] = ''
      this.setLive(s, { ...NO_INFO, channels: n, label: tr?.label ?? cfg.deviceLabel ?? '' })
      // Unplugged : the slot says so and lets it go; it opens again when the
      // device comes back (a device change), or picked again.
      tr?.addEventListener('ended', () => {
        if (req !== c.req || this.chains[s] !== c) return
        console.warn('[audio layer] live input lost', tr.label)
        this.dropSource(c, false)
        this.lostLabel[s] = cfg.deviceId ? '' : tr.label
        this.setLive(s, { ...NO_INFO, label: tr.label || (cfg.deviceLabel ?? ''), error: 'the input was disconnected', lost: true })
      })
    }).catch((e: unknown) => {
      if (req !== c.req) return
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[audio layer] live input unavailable', e)
      const lost = this.live[s].lost
      this.setLive(s, { ...NO_INFO, label: cfg.deviceLabel ?? '', error: lost ? this.live[s].error : (msg || 'unavailable'), lost })
    })
  }

  /** A device came or went : each armed live slot that was lost or could not
   *  open tries again. */
  private retryLive(): void {
    let again = false
    for (const s of SLOTS) {
      const c = this.chains[s], cfg = this.st[s]
      if (c && c.key && cfg?.kind === 'live' && this.armed[s] && this.live[s].error) {
        c.key = ''
        again = true
      }
    }
    if (again) this.apply()
  }

  /** Open a slot's source anew (the same input picked again, its retry button) :
   *  the performer's own act, so a lost default input opens whatever is the
   *  default now. */
  reopen(s: AudioSlotName): void {
    const c = this.chains[s]
    if (!c || !c.key) return
    if (c.player) this.resumeAt[s] = c.player.time()
    this.lostLabel[s] = ''
    c.key = ''
    this.apply()
  }

  private setLive(s: AudioSlotName, info: SlotInfo): void {
    const o = this.live[s]
    if (o.channels === info.channels && o.label === info.label && o.error === info.error && o.lost === info.lost) return
    this.live[s] = info
    for (const fn of this.listeners) fn()
  }

  /** A slot as it is : a live input as it opened (its channels, why it could
   *  not, or that it was lost), a file why it cannot play. */
  slotInfo(s: AudioSlotName): SlotInfo {
    return this.live[s]
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** A one-shot move of a file slot's playhead (0..1 within its trim). */
  seek(s: AudioSlotName, v: number): void {
    this.seeks[s] = v
  }

  /** The transport, once a frame : `globalSpeed` the composition's speed (a slot
   *  ignoring it plays at its own). Publishes the playheads for the timeline, the
   *  level meter and the modulators listening to a slot. */
  tick(globalSpeed: number): void {
    // the whole layer's features, while a modulator reads them (half a second)
    const now = performance.now()
    if (this.outAn && this.fbufs && now - this.featWantedAt < 500) {
      const dt = this.featAt ? Math.min(0.1, (now - this.featAt) / 1000) : 1 / 60
      this.featAt = now
      analyseFrame(this.outAn, this.fbufs, this.feats, dt, this.ctx?.sampleRate ?? 48000)
    } else this.featAt = 0
    for (const s of SLOTS) {
      const c = this.chains[s], cfg = this.st[s]
      const p = c?.player
      if (!p || !cfg || cfg.kind !== 'file') continue
      p.setPlayback({
        playing: cfg.videoPlaying ?? true,
        speed: cfg.videoSpeed ?? 1,
        loop: cfg.videoLoop ?? true,
        inN: cfg.videoIn ?? 0,
        outN: cfg.videoOut ?? 1,
        ignoreGlobal: !!cfg.ignoreGlobalSpeed
      })
      p.setKeepPitch(!!cfg.keepPitch)
      const sk = this.seeks[s]
      if (sk !== null) { p.setPosMod(sk); this.seeks[s] = null }
      p.tick(cfg.ignoreGlobalSpeed ? 1 : globalSpeed)
      videoPlayheads.set(videoKey(AUDIO_LAYER, s), { time: p.time(), duration: p.duration() })
    }
  }

  /** A slot's level (or the layer's : `null`), after its volume : RMS and peak,
   *  linear, over the last ~21 ms. Zero when it plays nothing. */
  meter(s: AudioSlotName | null): { rms: number; peak: number } {
    const an = s ? this.chains[s]?.an : this.outAn
    if (!an) return { rms: 0, peak: 0 }
    const b = this.buf.subarray(0, Math.min(this.buf.length, an.fftSize))
    an.getFloatTimeDomainData(b)
    let sum = 0, pk = 0
    for (let i = 0; i < b.length; i++) { const x = b[i]; sum += x * x; const a = x < 0 ? -x : x; if (a > pk) pk = a }
    return { rms: Math.sqrt(sum / b.length), peak: pk }
  }

  /** The layer's analyser (its whole sound, after its volume), for the audio
   *  tab's input set to the Audio Layer. Null while the layer is empty. */
  analyser(): { an: AnalyserNode; sampleRate: number } | null {
    return this.outAn && this.ctx ? { an: this.outAn, sampleRate: this.ctx.sampleRate } : null
  }

  /** One feature of the whole layer's sound (the mix, live input included, after
   *  its volume), 0..1 : what a modulator FROM "AU all" reads. Silence while the
   *  layer is empty. */
  mixFeature(name: AudioFeatureName, band: number): number {
    this.featWantedAt = performance.now()
    if (!this.outAn) return 0
    return readFeature(this.feats, name, band)
  }

  /** Every file slot from its in point at the same moment : each cued (paused
   *  there, ready to play), then all started together. */
  syncStart(): void {
    const ps = SLOTS.map((s) => this.chains[s]?.player).filter((p): p is ClipPlayer => !!p)
    if (!ps.length) return
    const req = ++this.syncReq
    for (const p of ps) p.hold(true)
    void Promise.all(ps.map((p) => p.cue())).then(() => {
      if (req !== this.syncReq) return
      for (const p of ps) p.start()
    })
  }

  /** Paused while a synced start is still cueing : it never starts (not even
   *  for a frame), and the players go back to their own transport. */
  cancelSync(): void {
    this.syncReq++
    for (const s of SLOTS) this.chains[s]?.player?.hold(false)
  }

  /** The file a slot plays, and its playhead (the modulators read its sound). */
  playhead(s: AudioSlotName): { path: string; time: number } | null {
    const cfg = this.st[s], p = this.chains[s]?.player
    if (!cfg || cfg.kind !== 'file' || !p) return null
    const path = cfg.mediaPath ?? ''
    return path ? { path, time: p.time() } : null
  }

  /** The element a file slot plays (the tests read it). */
  element(s: AudioSlotName): HTMLAudioElement | null {
    return this.chains[s]?.player?.audio ?? null
  }

  /** Silence and release everything (a dev hot update replacing this engine). */
  shutdown(): void {
    this.teardown(false)
    this.offCtx?.()
    this.offCtx = null
    this.offDevices?.()
    this.offDevices = null
    sonifyEngine.setLayerWanted(false)
  }
}

export const audioLayer = new AudioLayerEngine()

// Dev only : a hot update makes a new engine; the old one, its players still
// playing into the mix, is shut down. Compiled out of a real build.
if (import.meta.hot) {
  const g = globalThis as { __opsiaAudioLayer?: AudioLayerEngine }
  g.__opsiaAudioLayer?.shutdown()
  g.__opsiaAudioLayer = audioLayer
}
