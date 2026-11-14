// Picking a device's channels : a stereo pair or one channel (mono). For an
// input, the pick becomes the two sides the app works in (a mono channel on
// both). For an output, the app's stereo lands on the picked pair of a device
// with more channels (an interface's outputs 3+4), or is summed onto one.
// Written "l:r", r = -1 for mono, channels counted from 0 (shown from 1).

import { useEffect, useState } from 'react'

export interface ChPick { l: number; r: number }

export const CH_DEFAULT: ChPick = { l: 0, r: 1 }
// Web Audio stops at 32 channels
export const CH_MAX = 32

export function parsePick(v: unknown): ChPick {
  if (typeof v !== 'string') return { ...CH_DEFAULT }
  const [a, b] = v.split(':').map(Number)
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a >= CH_MAX || b < -1 || b >= CH_MAX) return { ...CH_DEFAULT }
  return { l: a, r: b }
}

export const pickKey = (p: ChPick): string => `${p.l}:${p.r}`
export const isDefaultPick = (p: ChPick): boolean => p.l === 0 && p.r === 1

export function pickLabel(p: ChPick): string {
  return p.r < 0 ? `${p.l + 1} mono` : p.r === p.l + 1 ? `${p.l + 1}+${p.r + 1} stereo` : `${p.l + 1}+${p.r + 1}`
}

/** The menu for a device of `n` channels : its pairs, then each channel alone.
 *  The current pick stays listed when the device has fewer channels. */
export function pickOptions(n: number, cur: ChPick): Array<{ v: string; label: string; off?: boolean }> {
  const m = Math.max(1, Math.min(CH_MAX, n))
  const opts: Array<{ v: string; label: string; off?: boolean }> = []
  for (let i = 0; i + 1 < m; i += 2) opts.push({ v: `${i}:${i + 1}`, label: `${i + 1}+${i + 2} stereo` })
  for (let i = 0; i < m; i++) opts.push({ v: `${i}:-1`, label: `${i + 1} mono` })
  const k = pickKey(cur)
  if (!opts.some((o) => o.v === k)) opts.unshift({ v: k, label: `${pickLabel(cur)} (not on this device)`, off: true })
  return opts
}

/** The pick on a device of `n` channels : [left, right], each kept on the
 *  device (a mono pick : the same channel on both sides). */
export function clampPick(p: ChPick, n: number): [number, number] {
  const top = Math.max(0, Math.min(CH_MAX, n) - 1)
  const l = Math.min(top, Math.max(0, p.l))
  return [l, p.r < 0 ? l : Math.min(top, Math.max(0, p.r))]
}

/** An input of `n` channels down to the picked two : src → splitter → merger.
 *  `out` is the stereo result; set() rewires on a new pick. */
export class InputPick {
  readonly out: ChannelMergerNode
  private readonly split: ChannelSplitterNode
  private key = ''

  constructor(ctx: BaseAudioContext, src: AudioNode, readonly n: number, pick: ChPick) {
    this.split = ctx.createChannelSplitter(Math.max(1, Math.min(CH_MAX, n)))
    this.out = ctx.createChannelMerger(2)
    src.connect(this.split)
    this.set(pick)
  }

  set(pick: ChPick): void {
    const [l, r] = clampPick(pick, this.n)
    const key = `${l}:${r}`
    if (key === this.key) return
    try { this.split.disconnect() } catch { /* not wired yet */ }
    this.split.connect(this.out, l, 0)
    this.split.connect(this.out, r, 1)
    this.key = key
  }

  dispose(): void {
    try { this.split.disconnect(); this.out.disconnect() } catch { /* gone */ }
  }
}

/** The app's stereo onto picked channels of the device behind `dst` (it is set
 *  to all its channels, discrete). Returns the node to feed, and the nodes made
 *  (to disconnect on the next route). The default pick on any device is left
 *  to the caller : a plain stereo connection, as before. */
export function outputRoute(ctx: BaseAudioContext, dst: AudioNode & { maxChannelCount: number }, pick: ChPick): { input: AudioNode; nodes: AudioNode[] } {
  const n = Math.max(1, Math.min(CH_MAX, dst.maxChannelCount))
  dst.channelCount = n
  dst.channelCountMode = 'explicit'
  dst.channelInterpretation = 'discrete'
  const merge = ctx.createChannelMerger(n)
  merge.connect(dst)
  const [l, r] = clampPick(pick, n)
  if (pick.r < 0) {
    // one channel : the merger's input takes one channel, so the stereo is
    // summed into it ((L + R) / 2, Web Audio's own down-mix)
    const g = ctx.createGain()
    g.connect(merge, 0, l)
    return { input: g, nodes: [g, merge] }
  }
  const split = ctx.createChannelSplitter(2)
  split.connect(merge, 0, l)
  split.connect(merge, 1, r)
  return { input: split, nodes: [split, merge] }
}

/** Put `dst` back to the plain stereo it starts as. */
export function stereoDestination(dst: AudioNode & { maxChannelCount: number }): void {
  dst.channelCount = Math.max(1, Math.min(2, dst.maxChannelCount))
  dst.channelCountMode = 'explicit'
  dst.channelInterpretation = 'speakers'
}

// How many channels an output device takes, read off a silent context opened
// on it for a moment (Sonify off, or the monitor's device : no other context
// says). Cached per device; read again when devices come and go.
const outCount = new Map<string, number>()
const outPending = new Map<string, Promise<number>>()
type SinkCtx = new (o: AudioContextOptions & { sinkId?: string }) => AudioContext

export function probeOutputChannels(sinkId: string): Promise<number> {
  const id = sinkId === 'default' ? '' : sinkId
  const known = outCount.get(id)
  if (known !== undefined) return Promise.resolve(known)
  const pending = outPending.get(id)
  if (pending) return pending
  const p = (async (): Promise<number> => {
    let ctx: AudioContext | null = null
    try {
      ctx = new (AudioContext as unknown as SinkCtx)(id ? { sinkId: id, latencyHint: 'playback' } : { latencyHint: 'playback' })
      const n = Math.max(1, Math.min(CH_MAX, ctx.destination.maxChannelCount || 2))
      outCount.set(id, n)
      return n
    } catch {
      return 2
    } finally {
      outPending.delete(id)
      ctx?.close().catch(() => {})
    }
  })()
  outPending.set(id, p)
  return p
}

let watching = false
function watchDevices(): void {
  if (watching) return
  watching = true
  navigator.mediaDevices?.addEventListener?.('devicechange', () => outCount.clear())
}

/** The channel count of an output device, for a menu (2 until known). */
export function useOutputChannels(sinkId: string): number {
  const [n, setN] = useState(() => outCount.get(sinkId === 'default' ? '' : sinkId) ?? 2)
  useEffect(() => {
    watchDevices()
    let alive = true
    const read = (): void => { void probeOutputChannels(sinkId).then((c) => { if (alive) setN(c) }) }
    read()
    // after a change of devices the cache is cleared first (registered above)
    const md = navigator.mediaDevices
    const again = (): void => { setTimeout(read, 300) }
    md?.addEventListener?.('devicechange', again)
    return () => { alive = false; md?.removeEventListener?.('devicechange', again) }
  }, [sinkId])
  return n
}

/** A picker : the device's pairs and channels. */
export function ChannelSelect({ n, value, onChange, title, disabled, className }: {
  n: number
  value: ChPick
  onChange: (p: ChPick) => void
  title: string
  disabled?: boolean
  className?: string
}): JSX.Element {
  return (
    <select
      className={className ?? 'input select-compact w-[6.5rem] shrink-0 text-[10px]'}
      value={pickKey(value)}
      disabled={disabled}
      onChange={(e) => onChange(parsePick(e.target.value))}
      title={title}
    >
      {pickOptions(n, value).map((o) => (
        <option key={o.v} value={o.v}>{o.label}</option>
      ))}
    </select>
  )
}
