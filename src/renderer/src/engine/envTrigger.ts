// Envelopes fired by the sound or by another modulator (ramp, adsr).
//
// An envelope always fired from its card's ⟳, a MIDI pad or note, or an action
// (`act:mod:<n>:trig`). Its trigger (ModulatorConfig.trigger) adds a signal that
// fires it on its own : a feature of the sound (in a frequency band : a kick in
// 40 to 120 Hz, the hats left out), or another slot's output. Both go through
// the same edge detector :
//   - it fires when the signal RISES past `at` (a rising edge, never a level :
//     a held loud sound fires once);
//   - it arms again only once the signal has fallen under `rearm` (the
//     hysteresis : a level wobbling round the line never chatters);
//   - and never within `holdMs` of the last fire (a stuttering onset, a kick's
//     two bumps, fire once; an edge inside the hold is dropped, not delayed).
// The fire itself is the card's own retrigger (ModEngine.retrigger), so a fired
// envelope behaves exactly as one fired by hand.
//
// Pure : no store, no engine; the reading of the signal is the ModEngine's.

import type { AudioFeature, ClipAudioSrc, EnvTrigger, ModulatorType } from '@shared/types'

export const ENV_TRIGGER_FEATURES: AudioFeature[] = ['level', 'transient', 'flux', 'band', 'centroid', 'pitch', 'noisiness']

/** A new trigger's settings : a kick (a hit in the lows, 40 to 120 Hz). The
 *  transient, not the level : the level is read in decibels like the meters, so
 *  a kick's tail stays high for most of a beat (a 60 Hz kick every half second :
 *  1 at the hit, still 0.35 to 0.5 just before the next) and its line has to be
 *  set by its live bar; the transient is 1 at each onset and falls by about a
 *  fifth a frame. The re-arm at 0.4 comes back ~80 ms after a hit : with 0.2 it
 *  took ~130 ms and 16th hats at 120 BPM (125 ms apart) never re-armed (0 of 64
 *  fired; at 0.4 : 64 of 64). The 80 ms hold keeps a kick's own bumps to one. */
export const ENV_TRIGGER_DEFAULT: EnvTrigger = {
  from: 'card',
  feature: 'transient',
  band: 0,
  lo: 40,
  hi: 120,
  slot: 0,
  at: 0.6,
  rearm: 0.4,
  holdMs: 80
}
export const TRIG_HOLD_MIN = 10
export const TRIG_HOLD_MAX = 4000

/** The types a trigger fires (the envelopes). */
export const takesTrigger = (t: ModulatorType): boolean => t === 'ramp' || t === 'adsr'

/** Is this trigger on (sound or slot), for a modulator of this type? */
export function triggerActive(t: EnvTrigger | undefined, type: ModulatorType): t is EnvTrigger {
  return !!t && t.from !== 'card' && takesTrigger(type)
}

const num = (v: unknown, d: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d

/** A trigger read from a session (a hand-edited file, an older or newer one) :
 *  every field checked, or none (undefined : the card only). `self` : the
 *  modulator's own slot (a trigger on itself falls back to the next one). */
export function sanitizeEnvTrigger(x: unknown, self: number): EnvTrigger | undefined {
  if (!x || typeof x !== 'object') return undefined
  const o = x as Partial<EnvTrigger>
  const from = o.from === 'sound' || o.from === 'slot' || o.from === 'card' ? o.from : undefined
  if (!from) return undefined
  const d = ENV_TRIGGER_DEFAULT
  const feature = ENV_TRIGGER_FEATURES.includes(o.feature as AudioFeature) ? (o.feature as AudioFeature) : d.feature
  let lo = num(o.lo, d.lo, 0, 20000)
  let hi = num(o.hi, d.hi, 0, 20000)
  if (lo > hi) [lo, hi] = [hi, lo]
  const at = num(o.at, d.at, 0.01, 1) // (0 would fire over and over on silence)
  const rearm = Math.min(at, num(o.rearm, Math.max(0, at - 0.2), 0, 1))
  let slot = Math.round(num(o.slot, 0, 0, 7))
  if (slot === self) slot = (self + 1) % 8
  const s = o.src as ClipAudioSrc | undefined
  const src: ClipAudioSrc | undefined =
    s && typeof s === 'object' && Number.isFinite(s.layer) && (s.slot === 'A' || s.slot === 'B' || s.slot === 'all')
      ? { layer: Math.round(s.layer), slot: s.slot }
      : undefined
  return {
    from, feature, band: Math.round(num(o.band, 0, 0, 5)), lo, hi,
    ...(src ? { src } : {}),
    slot, at, rearm, holdMs: Math.round(num(o.holdMs, d.holdMs, 0, TRIG_HOLD_MAX))
  }
}

/** The detector's memory, one per slot. */
export interface TrigState {
  key: string // what it listens to : another key re-seeds it (no fire on a switch)
  high: boolean // the signal is past the line (until it falls under rearm)
  firedAt: number // the last fire (ms; -Infinity : never)
  value: number // the signal as last read (the card's meter)
}
export const trigState = (): TrigState => ({ key: '', high: false, firedAt: -Infinity, value: 0 })

/** What a trigger listens to : a change re-seeds the detector. The line, the
 *  re-arm and the hold are not part of it (moving them never fires). */
export function trigKey(t: EnvTrigger): string {
  return t.from === 'slot'
    ? `slot:${t.slot}`
    : `sound:${t.feature}:${t.band}:${t.lo}:${t.hi}:${t.src ? `${t.src.layer}${t.src.slot}` : ''}`
}

/** One reading of the signal at `now` (ms) : true when the envelope fires. The
 *  first reading after a change of what it listens to only seeds the state (a
 *  session opening on a loud sound does not fire). */
export function trigStep(st: TrigState, t: EnvTrigger, key: string, raw: number, now: number): boolean {
  const v = Number.isFinite(raw) ? raw : 0
  st.value = v
  if (st.key !== key) {
    st.key = key
    st.high = v >= t.at
    return false
  }
  if (st.high) {
    if (v <= Math.min(t.rearm, t.at)) st.high = false
    return false
  }
  if (v < t.at) return false
  st.high = true
  if (now - st.firedAt < t.holdMs) return false // (inside the hold : dropped, not delayed)
  st.firedAt = now
  return true
}
