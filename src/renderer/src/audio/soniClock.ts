// The Sonify beat clock : one beat counter, from the composition's tempo, that
// both Sonify sequencers (the effects sequencer and the key sequencer) read when
// they run on beats or bars. Sharing it keeps them phase-locked : a sequencer
// started while the other runs on the beat waits for the next bar; alone, it
// starts the bar where it starts. Ticked once per frame from App's loop.

import type { SoniSeqRate } from '@shared/types'

export const SONI_RATES: SoniSeqRate[] = ['b1', 'b2', 'bar1', 'bar2', 'bar4', 'bar8', 'bar16', 'free']
/** In beats, for a bar of 4 (see rateBeats for the bar actually in force). */
export const RATE_BEATS: Record<Exclude<SoniSeqRate, 'free'>, number> = {
  b1: 1, b2: 2, bar1: 4, bar2: 8, bar4: 16, bar8: 32, bar16: 64
}
export const RATE_LABEL: Record<SoniSeqRate, string> = {
  b1: '1 beat', b2: '2 beats', bar1: '1 bar', bar2: '2 bars', bar4: '4 bars', bar8: '8 bars', bar16: '16 bars', free: 'free'
}
export const isSoniRate = (r: unknown): r is SoniSeqRate => typeof r === 'string' && (SONI_RATES as string[]).includes(r)

let beats = 0
let last = 0
// Ableton Link : beats = Link's + this offset (whole bars, chosen when Link
// comes on so the count barely moves); null while Link is off.
let linkOffset: number | null = null
let quantum = 4
// Counts the times the clock was re-counted onto new bars (Link on or off, its
// bar resized) : a running sequencer seeing it change re-aligns on them.
let epoch = 0

/** Advance the clock (once per frame). A stall (a hidden window) counts as a
 *  quarter second at most : the sequencers carry on instead of catching up.
 *  With Ableton Link on (`link` = its beat now, counted in bars of `q`), the
 *  clock IS Link's, so the bars fall where every linked app's do. */
export function soniClockTick(now: number, bpm: number, link: number | null = null, q = 4): number {
  if (link != null) {
    const nq = Math.max(1, q)
    // Link comes on, or its bar changes size (Link counts its beats afresh for
    // the new one) : the whole-bar offset is chosen again, for the new bar
    if (linkOffset == null || nq !== quantum) {
      quantum = nq
      linkOffset = Math.round((beats - link) / quantum) * quantum
      epoch++
    }
    beats = link + linkOffset
    last = now
    return beats
  }
  if (linkOffset != null) {
    linkOffset = null
    epoch++ // back to bars of 4, on this clock's own count
  }
  if (last) beats += (Math.min(250, Math.max(0, now - last)) * Math.max(1, bpm)) / 60000
  last = now
  return beats
}

export const soniBeats = (): number => beats

/** Beats in a bar : Ableton Link's bar (its quantum) while it is on, else 4. */
export const soniBar = (): number => (linkOffset != null ? quantum : 4)

/** Changes whenever the clock is re-counted onto new bars (see `epoch`). */
export const soniClockEpoch = (): number => epoch

/** A rate in beats. The bar rates follow the bar in force : with Link on and a
 *  bar of 3, "1 bar" is 3 beats and "4 bars" 12, so a sequence keeps landing on
 *  the bars every linked app plays; beat rates stay beats. */
export function rateBeats(rate: Exclude<SoniSeqRate, 'free'>): number {
  const b = RATE_BEATS[rate]
  return rate === 'b1' || rate === 'b2' ? b : (b / 4) * soniBar()
}

/** Where a sequencer starting now on the beat begins : the next bar when the
 *  other one already runs on the beat (they stay in phase), else right now,
 *  which becomes the top of a bar. */
export function soniClockStart(otherOnBeat: boolean): number {
  // Ableton Link : always the next Link bar (the count is shared, never reset)
  if (linkOffset != null) return Math.ceil(beats / quantum - 1e-6) * quantum
  if (otherOnBeat) return Math.ceil(beats / 4 - 1e-6) * 4
  beats = 0
  return 0
}
