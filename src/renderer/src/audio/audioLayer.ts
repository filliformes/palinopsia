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
import { videoKey, videoPlayheads } from '../engine/videoState'
import { sonifyEngine } from './sonify'

/** The Audio Layer's index where the video seams key by layer (playheads,
 *  seeks, a modulator listening to a slot's sound). */
export const AUDIO_LAYER = -1

export type AudioSlotName = 'A' | 'B'
const SLOTS: AudioSlotName[] = ['A', 'B']

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

export interface LiveInfo {
  /** the channels the device delivered (0 : not open yet) */
  channels: number
  label: string
  /** why it could not open ('' : fine) */
  error: string
}

interface Chain {
  key: string
  vol: GainNode // the slot's volume (and its mute)
  pan: StereoPannerNode
  an: AnalyserNode // the slot's meter, after its volume and pan
  mixG: GainNode // its side of the A/B mix
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

class AudioLayerEngine {
  private st: AudioLayerState = defaultAudioLayer()
  private ctx: AudioContext | null = null
  private opening = false
  private out: GainNode | null = null // the layer's volume, into Sonify
  private outAn: AnalyserNode | null = null
  private chains: Record<AudioSlotName, Chain | null> = { A: null, B: null }
  private seeks: Record<AudioSlotName, number | null> = { A: null, B: null }
  private resumeAt: Record<AudioSlotName, number> = { A: 0, B: 0 } // a rebuilt file starts here
  private live: Record<AudioSlotName, LiveInfo> = { A: { channels: 0, label: '', error: '' }, B: { channels: 0, label: '', error: '' } }
  private listeners = new Set<() => void>()
  private buf = new Float32Array(1024)
  private offCtx: (() => void) | null = null

  constructor() {
    // A new audio context (Sonify healed a dead device) : everything starts over
    // on it, the files at the time they had reached.
    this.offCtx = sonifyEngine.onContext((ctx) => {
      if (this.ctx && this.ctx !== ctx) this.rebuildOn(ctx)
    })
  }

  /** The layer's state, from the store (App calls it on every change). */
  sync(st: AudioLayerState): void {
    this.st = st
    const active = !!(st.A || st.B)
    sonifyEngine.setLayerWanted(active)
    if (!active) {
      this.teardown()
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
    const an = ctx.createAnalyser()
    an.fftSize = 1024
    out.connect(an)
    this.out = out
    this.outAn = an
    sonifyEngine.setExternalInput(out)
    this.apply()
  }

  /** Onto a new context : the old graph goes, the files resume where they were. */
  private rebuildOn(ctx: AudioContext): void {
    for (const s of SLOTS) this.resumeAt[s] = this.chains[s]?.player?.time() ?? 0
    this.teardown()
    this.buildOn(ctx)
  }

  private teardown(): void {
    for (const s of SLOTS) this.dropChain(s)
    if (this.out) {
      sonifyEngine.setExternalInput(null)
      try { this.out.disconnect(); this.outAn?.disconnect() } catch { /* gone */ }
    }
    this.out = null
    this.outAn = null
    this.ctx = null
  }

  private dropChain(s: AudioSlotName): void {
    const c = this.chains[s]
    if (!c) return
    this.chains[s] = null
    this.dropSource(c)
    try { c.vol.disconnect(); c.pan.disconnect(); c.an.disconnect(); c.mixG.disconnect() } catch { /* gone */ }
    videoPlayheads.delete(videoKey(AUDIO_LAYER, s))
    this.setLive(s, { channels: 0, label: '', error: '' })
  }

  private dropSource(c: Chain): void {
    c.req++
    c.player?.dispose()
    try { c.elSrc?.disconnect(); c.streamSrc?.disconnect(); c.split?.disconnect(); c.merge?.disconnect() } catch { /* gone */ }
    c.stream?.getTracks().forEach((t) => t.stop())
    c.player = null
    c.elSrc = null
    c.stream = null
    c.streamSrc = null
    c.split = null
    c.merge = null
  }

  /** The state onto the graph : sources (only when what a slot plays changed),
   *  then the gains and pans, gliding. */
  private apply(): void {
    const ctx = this.ctx, out = this.out
    if (!ctx || !out) return
    const t = ctx.currentTime
    for (const s of SLOTS) {
      const cfg = this.st[s]
      if (!cfg) {
        this.dropChain(s)
        this.setLive(s, { channels: 0, label: '', error: '' })
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
        vol.connect(pan).connect(mixG).connect(out)
        pan.connect(an)
        c = { key: '', vol, pan, an, mixG, player: null, elSrc: null, stream: null, streamSrc: null, split: null, merge: null, req: 0 }
        this.chains[s] = c
      }
      const key = sourceKey(cfg)
      if (key !== c.key) {
        this.dropSource(c)
        c.key = key
        if (cfg.kind === 'file') this.openFile(s, c, cfg)
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
    const p = new ClipPlayer(false)
    p.load(cfg.mediaId, cfg.mediaPath ?? '', this.resumeAt[s])
    this.resumeAt[s] = 0
    try {
      c.elSrc = ctx.createMediaElementSource(p.audio)
      c.elSrc.connect(c.vol)
    } catch (e) {
      console.warn('[audio layer] the file cannot join the mix', e)
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
    this.setLive(s, { channels: 0, label: cfg.deviceLabel ?? '', error: '' })
    // The device by its id, or (another computer, the interface plugged into
    // another port : a new id) by its name.
    const open = async (): Promise<MediaStream> => {
      const md = navigator.mediaDevices
      if (!cfg.deviceId) return md.getUserMedia({ audio, video: false })
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
      merge.connect(c.vol)
      c.stream = stream
      c.streamSrc = src
      c.split = split
      c.merge = merge
      this.setLive(s, { channels: n, label: tr?.label ?? cfg.deviceLabel ?? '', error: '' })
    }).catch((e: unknown) => {
      if (req !== c.req) return
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[audio layer] live input unavailable', e)
      this.setLive(s, { channels: 0, label: cfg.deviceLabel ?? '', error: msg || 'unavailable' })
    })
  }

  private setLive(s: AudioSlotName, info: LiveInfo): void {
    const o = this.live[s]
    if (o.channels === info.channels && o.label === info.label && o.error === info.error) return
    this.live[s] = info
    for (const fn of this.listeners) fn()
  }

  /** A live slot's device as it opened (its channels, or why it could not). */
  liveInfo(s: AudioSlotName): LiveInfo {
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
    const b = this.buf
    an.getFloatTimeDomainData(b)
    let sum = 0, pk = 0
    for (let i = 0; i < b.length; i++) { const x = b[i]; sum += x * x; const a = x < 0 ? -x : x; if (a > pk) pk = a }
    return { rms: Math.sqrt(sum / b.length), peak: pk }
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
    this.teardown()
    this.offCtx?.()
    this.offCtx = null
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
