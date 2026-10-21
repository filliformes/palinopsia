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
// Link's beat at the last tick : a jump in its count shows against it.
let lastLink: number | null = null
// Ableton Link's start / stop sync : the first bar of the session's play, on
// Link's count, while it plays (else null). Set by ../link.ts.
let playAt: number | null = null
// A play's bar is still the one to start on this many beats after it : the
// news of a play can reach here a few frames after the bar it starts on.
const LATE = 0.25

/** Advance the clock (once per frame). A stall (a hidden window) counts as a
 *  quarter second at most : the sequencers carry on instead of catching up.
 *  With Ableton Link on (`link` = its beat now, counted in bars of `q`), the
 *  clock IS Link's, so the bars fall where every linked app's do. */
export function soniClockTick(now: number, bpm: number, link: number | null = null, q = 4): number {
  // a beat or a tempo that is no number (a session with no BPM) : counted as
  // none, else the offset and the count latched NaN and the sequencers stalled
  // for good
  if (!Number.isFinite(link)) link = null
  if (!Number.isFinite(beats)) beats = 0
  if (!Number.isFinite(bpm)) bpm = 120
  if (link != null) {
    const nq = Math.max(1, q)
    // Link comes on, or its bar changes size (Link counts its beats afresh for
    // the new one) : the whole-bar offset is chosen again, for the new bar
    if (linkOffset == null || nq !== quantum) {
      quantum = nq
      linkOffset = Math.round((beats - link) / quantum) * quantum
      epoch++
    } else if (lastLink != null && now - last < 250) {
      // Link's count jumped : a linked app put beat 0 on the bar its play
      // starts on (whole bars : the offset takes them, the count goes on), or,
      // alone, Palinopsia's own play put it on now (a new grid : the count is
      // brought onto its bars, as for a new bar size)
      const ahead = ((now - last) * Math.max(1, bpm)) / 60000
      const jump = link - lastLink - ahead
      if (Math.abs(jump) > 0.05) {
        const bars = Math.round(jump / quantum) * quantum
        if (Math.abs(jump - bars) < 0.05) linkOffset -= bars
        else {
          linkOffset = Math.round((beats + ahead - link) / quantum) * quantum
          epoch++
        }
      }
    }
    lastLink = link
    beats = link + linkOffset
    last = now
    return beats
  }
  lastLink = null
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

/** Ableton Link's play (start / stop sync) : the first bar it starts on, on
 *  Link's count; null while it is stopped or the sync is off. */
export function soniClockPlayAt(linkBeat: number | null): void {
  playAt = linkBeat != null && Number.isFinite(linkBeat) ? linkBeat : null
}

/** The bar a start waiting for one begins on : the bar Link's play starts on
 *  while it is to come or only just gone, else the next bar. */
export function soniNextBar(): number {
  const bar = soniBar()
  if (linkOffset != null && playAt != null) {
    const at = playAt + linkOffset
    if (at >= beats - LATE && at <= beats + bar) return at
  }
  return Math.ceil(beats / bar - 1e-6) * bar
}

/** Where a sequencer starting now on the beat begins : the next bar when the
 *  other one already runs on the beat (they stay in phase), else right now,
 *  which becomes the top of a bar. */
export function soniClockStart(otherOnBeat: boolean): number {
  // Ableton Link : always the next Link bar (the count is shared, never reset),
  // or the one its play starts on
  if (linkOffset != null) return soniNextBar()
  if (otherOnBeat) return Math.ceil(beats / 4 - 1e-6) * 4
  beats = 0
  return 0
}
