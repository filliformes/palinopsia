// The Sonify beat clock : one beat counter, from the composition's tempo, that
// both Sonify sequencers (the effects sequencer and the key sequencer) read when
// they run on beats or bars. Sharing it keeps them phase-locked : a sequencer
// started while the other runs on the beat waits for the next bar; alone, it
// starts the bar where it starts. Ticked once per frame from App's loop.

import type { SoniSeqRate } from '@shared/types'

export const SONI_RATES: SoniSeqRate[] = ['b1', 'b2', 'bar1', 'bar2', 'bar4', 'bar8', 'bar16', 'free']
export const RATE_BEATS: Record<Exclude<SoniSeqRate, 'free'>, number> = {
  b1: 1, b2: 2, bar1: 4, bar2: 8, bar4: 16, bar8: 32, bar16: 64
}
export const RATE_LABEL: Record<SoniSeqRate, string> = {
  b1: '1 beat', b2: '2 beats', bar1: '1 bar', bar2: '2 bars', bar4: '4 bars', bar8: '8 bars', bar16: '16 bars', free: 'free'
}
export const isSoniRate = (r: unknown): r is SoniSeqRate => typeof r === 'string' && (SONI_RATES as string[]).includes(r)

let beats = 0
let last = 0

/** Advance the clock (once per frame). A stall (a hidden window) counts as a
 *  quarter second at most : the sequencers carry on instead of catching up. */
export function soniClockTick(now: number, bpm: number): number {
  if (last) beats += (Math.min(250, Math.max(0, now - last)) * Math.max(1, bpm)) / 60000
  last = now
  return beats
}

export const soniBeats = (): number => beats

/** Where a sequencer starting now on the beat begins : the next bar when the
 *  other one already runs on the beat (they stay in phase), else right now,
 *  which becomes the top of a bar. */
export function soniClockStart(otherOnBeat: boolean): number {
  if (otherOnBeat) return Math.ceil(beats / 4 - 1e-6) * 4
  beats = 0
  return 0
}
