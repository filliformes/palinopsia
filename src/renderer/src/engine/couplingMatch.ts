// Coupling level-matching : each coupled layer's feature, mapped from its own
// recent working range onto 0..1 before the mode, amount and tightness apply.
// Raw features sit where the analysis puts them : flux on ordinary music reads
// a few hundredths, so a lean on flux moved the mix by a percent or two, and a
// loud master parked a level gate on B. Matched, a quiet track moves the mix
// as far as a loud one, and the loud one swings instead of sitting at the top.
//
//   peak   quick rise, slow fall (a few seconds) : the top of the range (a
//          lone spike does not set it, the hits that keep coming do)
//   floor  quick fall, slow rise : the bottom (the valleys between the hits)
//   map    (v - floor) / max(peak - floor, minSpan); a feature whose range is
//          under its minimum span (a held drone, a band pinned at the top, a
//          steady pitch) leans back to its raw value : only movement is spread
//   gate   an absolute silence gate on the input's level : silence and room
//          noise never get blown up to a full swing, and the range learned on
//          the music holds through a pause (nothing adapts while it is shut)
//
// The applied mapping eases : a reset (another feature, band or input) starts
// from the raw mapping and glides to the matched one, its gain rising slowly
// (falling at once, so a sudden loud passage never slams). The transient is
// matched through the flux it comes from : its onset line is set against the
// recent flux instead of a fixed one that quiet material never crosses.
//
// Pure maths, no audio bus : the coupling engine feeds it per layer.

import type { AudioFeature } from '@shared/types'

const clamp01 = (x: number): number => (x > 0 ? (x > 1 ? 1 : x) : 0)

// The followers' time constants (seconds).
const PEAK_ATTACK = 0.3 // the top rises
const PEAK_RELEASE = 3 // and falls back toward the current value
const FLOOR_RISE = 4 // the bottom climbs toward it
const FLOOR_FALL = 0.15 // and follows the valleys down quickly
const MAP_EASE = 0.6 // the applied gain rising (log domain); it falls at once
const AUTO_EASE = 0.25 // the auto toggle's crossfade raw ↔ matched

// The smallest range a feature is spread over (in its own 0..1 units) : below
// it, a feature's wobble stays a wobble. Pitch : about five semitones. The
// level is a linear amplitude : its minimum also grows with its top (a third of
// it, about 3 dB), so a loud master's wobble stays one too. (The bands, the
// flux and the rest come off the analyser's dB scale already.)
const MIN_SPAN: Record<AudioFeature, number> = {
  level: 0.01,
  flux: 0.02,
  transient: 0.02, // (matched through the flux : the flux's span)
  centroid: 0.05,
  band: 0.06,
  pitch: 0.08,
  noisiness: 0.08
}
const LEVEL_REL_SPAN = 0.3

// The silence gate, on the input's level (an instant-attack envelope, released
// over GATE_RELEASE so a gap between two notes does not shut it) : shut under
// GATE_LO, open above GATE_HI, a soft knee between. It opens at once for what
// is shown (the first hit after a pause is not lost) but the followers start
// learning over GATE_LEARN : sound coming out of silence lights the whole
// spectrum in one frame, and that one flux would set the range for seconds.
const GATE_LO = 0.01
const GATE_HI = 0.03
const GATE_RELEASE = 0.3
const GATE_LEARN = 0.25
// The matched transient : it fires as the flux rises past the top of its recent
// range (the mapped flux before its clip, over this line : the hits, not every
// ripple), once (again only after it fell back under TRANSIENT_REARM), then
// decays as the raw transient does (0.82 per 60 fps frame).
const TRANSIENT_ON = 1.3
const TRANSIENT_REARM = 0.5

/** One layer's matcher. */
export interface CouplingMatch {
  key: string // the feature (and band) it learned : another one starts over
  peak: number
  floor: number
  lo: number // the applied mapping : its zero
  ls: number // and the log of its span (0 : a span of 1, the raw mapping)
  over: number // this frame's mapped value before the clip (the transient reads it)
  pulse: number // the matched transient
  armed: boolean // and whether it may fire again
  auto: number // 0 raw … 1 matched, eased
  fresh: boolean // nothing seen since the reset : the first value seeds the followers
}

/** A layer's matcher, its crossfade already where the layer's auto is. */
export function newMatch(key = '', auto = true): CouplingMatch {
  return { key, peak: 0, floor: 0, lo: 0, ls: 0, over: 0, pulse: 0, armed: true, auto: auto ? 1 : 0, fresh: true }
}

/** Start over (another feature, band or input) : the followers seed on the next
 *  value, the mapping back to raw from where it glides. The auto crossfade
 *  stays where it is. */
export function resetMatch(m: CouplingMatch, key: string): void {
  m.key = key
  m.peak = m.floor = m.lo = m.ls = m.over = m.pulse = 0
  m.armed = m.fresh = true
}

/** The input's silence gate, shared by every layer (the level is the input's). */
export interface LevelGate {
  env: number
  seen: boolean // has this input carried a level at all ? (an OSC sender may send none)
  open: number // 0 shut … 1 open : what is shown
  learn: number // how much the followers learn : opens over GATE_LEARN, shuts at once
}
export function newGate(): LevelGate {
  return { env: 0, seen: false, open: 1, learn: 0 }
}
/** This frame's gate. Open while the input never carried a level : an OSC
 *  source sending only flux would otherwise stay shut. */
export function gateStep(g: LevelGate, level: number, dt: number): void {
  const v = Number.isFinite(level) ? Math.max(0, level) : 0
  if (v > 0.002) g.seen = true
  g.env = v >= g.env ? v : g.env + (v - g.env) * (1 - Math.exp(-dt / GATE_RELEASE))
  const t = clamp01((g.env - GATE_LO) / (GATE_HI - GATE_LO))
  g.open = g.seen ? t * t * (3 - 2 * t) : 1
  g.learn = g.open < g.learn ? g.open : g.learn + (g.open - g.learn) * (1 - Math.exp(-dt / GATE_LEARN))
}

/** One frame of a coupling's feature : its raw value in, matched out (gated).
 *  The transient is matched through this frame's raw `flux`; an input that
 *  carries no flux (an OSC sender sending only the transient) keeps it raw. */
export function matchFeature(m: CouplingMatch, feature: AudioFeature, raw: number, flux: number, g: LevelGate, dt: number): number {
  if (feature !== 'transient') return step(m, raw, g, dt, feature)
  step(m, flux, g, dt, 'flux')
  if (m.peak < 1e-4) return clamp01(raw) * g.open
  if (m.over > TRANSIENT_ON && m.armed && g.open > 0.5) {
    m.pulse = 1
    m.armed = false
  } else {
    m.pulse *= Math.pow(0.82, dt * 60)
    if (m.over < TRANSIENT_REARM) m.armed = true
  }
  return m.pulse * g.open
}

// One frame of the followers and the mapping (nothing learns while the gate is
// shut : the range learned on the music holds through a pause).
function step(m: CouplingMatch, raw: number, g: LevelGate, dt: number, feature: AudioFeature): number {
  const v = clamp01(raw)
  if (m.fresh && g.learn > 0.5) {
    m.peak = m.floor = v
    m.fresh = false
  }
  const w = g.learn
  // peak : up over PEAK_ATTACK, down toward the value over PEAK_RELEASE
  m.peak += (v - m.peak) * (1 - Math.exp((-dt * w) / (v > m.peak ? PEAK_ATTACK : PEAK_RELEASE)))
  // floor : down quickly, up slowly
  m.floor += (v - m.floor) * (1 - Math.exp((-dt * w) / (v < m.floor ? FLOOR_FALL : FLOOR_RISE)))
  if (m.floor > m.peak) m.floor = m.peak
  // the applied mapping : the zero eases, the gain rises slowly and falls at once
  const range = m.peak - m.floor
  const minSpan = feature === 'level' ? Math.max(MIN_SPAN.level, m.peak * LEVEL_REL_SPAN) : MIN_SPAN[feature]
  const ls = Math.log(Math.max(range, minSpan))
  const k = 1 - Math.exp(-dt / MAP_EASE)
  m.lo += (m.floor - m.lo) * k
  m.ls = ls > m.ls ? ls : m.ls + (ls - m.ls) * k
  // what holds still leans back to its raw value
  const r = clamp01(range / minSpan)
  m.over = ((v - m.lo) / Math.exp(m.ls)) * r + v * (1 - r)
  return clamp01(m.over) * g.open
}

/** The crossfade raw ↔ matched as the auto toggle moves (eased : no jump). */
export function autoMix(m: CouplingMatch, on: boolean, raw: number, matched: number, dt: number): number {
  m.auto += ((on ? 1 : 0) - m.auto) * (1 - Math.exp(-dt / AUTO_EASE))
  if (Math.abs(m.auto - (on ? 1 : 0)) < 1e-3) m.auto = on ? 1 : 0
  return clamp01(raw + (matched - raw) * m.auto)
}
