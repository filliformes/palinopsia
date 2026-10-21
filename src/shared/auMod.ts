// The Audio Layer's controls a modulator or a Meta knob can move (ModTarget kind
// 'au') : the layer's volume and A/B mix, each slot's volume and pan (a file or
// a live input), and a sound file's transport : its playhead, speed and trim.
// What each one spans, where it sits now and its word, shared by the modulation
// pass, the Meta knobs, the store and the panels. The stored state stays the
// base : a modulated value is a per-frame override on the audio engine.

import type { AudioLayerSlot, AudioLayerState, ModTarget } from './types'

export type AuLayerModField = 'volume' | 'mix'
export type AuSlotModField = 'volume' | 'pan' | 'playhead' | 'speed' | 'trimIn' | 'trimOut'
export type AuModField = AuLayerModField | AuSlotModField
export type AuModTarget = Extract<ModTarget, { kind: 'au' }>

/** A sound file's own (a live input has volume and pan only). */
export const AU_FILE_FIELDS: readonly AuSlotModField[] = ['playhead', 'speed', 'trimIn', 'trimOut']
export const auFileField = (f: AuModField): boolean => (AU_FILE_FIELDS as readonly string[]).includes(f)

// A sound's speed, like its slider says : 1/16 to 16x (slower is silent, faster
// the player can't). Modulated over its octaves, so a swing moves it by ratios
// (as the ear hears pitch and tempo), 1x in the middle.
export const AU_SPEED_MIN = 1 / 16
export const AU_SPEED_MAX = 16
export function auSpeedToT(s: number): number {
  const x = Math.log(Math.max(1e-6, s) / AU_SPEED_MIN) / Math.log(AU_SPEED_MAX / AU_SPEED_MIN)
  return Math.max(0, Math.min(1, x))
}
export function auSpeedFromT(t: number): number {
  return AU_SPEED_MIN * Math.pow(AU_SPEED_MAX / AU_SPEED_MIN, Math.max(0, Math.min(1, t)))
}

/** The span a modulation moves a control over, in its own units : volumes are
 *  gains (1 = as it comes), the pan left to right, the playhead a place in the
 *  trim, the trim a place in the file; a speed : its octaves (0..1, see above). */
export function auSpan(f: AuModField): { min: number; max: number } {
  if (f === 'volume') return { min: 0, max: 2 }
  if (f === 'pan') return { min: -1, max: 1 }
  return { min: 0, max: 1 }
}

/** A position in a control's span to its value (a speed's octaves to a speed). */
export function auValueOf(f: AuModField, x: number): number {
  return f === 'speed' ? auSpeedFromT(x) : x
}

const slotOf = (st: AudioLayerState, t: AuModTarget): AudioLayerSlot | null =>
  t.slot ? (st[t.slot] ?? null) : null

/** Anything there to move : the layer always; a slot when it holds something; a
 *  transport's control only on a sound file. A binding on nothing is a dead row. */
export function auTargetAlive(st: AudioLayerState, t: AuModTarget): boolean {
  if (!t.slot) return true
  const s = slotOf(st, t)
  return !!s && (!auFileField(t.field) || s.kind === 'file')
}

/** Where a control sits now, in its span's units : the base a modulation swings
 *  around or scales. The playhead : the middle of the trim (as every playhead :
 *  it plays on by itself, so it has no stored place). null : nothing there. */
export function auBaseOf(st: AudioLayerState, t: AuModTarget): number | null {
  if (!t.slot) return t.field === 'mix' ? st.mix : st.volume
  if (!auTargetAlive(st, t)) return null
  const s = slotOf(st, t)!
  switch (t.field) {
    case 'volume': return s.volume
    case 'pan': return s.pan || 0
    case 'playhead': return 0.5
    case 'speed': return auSpeedToT(s.videoSpeed ?? 1)
    case 'trimIn': return s.videoIn ?? 0
    case 'trimOut': return s.videoOut ?? 1
  }
}

/** A trim under modulation (`inM` / `outM` : the modulated ends, undefined : the
 *  stored one plays) : the in kept before the out, by at least 1 % of the file.
 *  The modulated end gives way; both modulated, they meet in the middle. */
export function auTrim(inM: number | undefined, outM: number | undefined, inN: number, outN: number): [number, number] {
  const GAP = 0.01
  const c = (x: number): number => Math.max(0, Math.min(1, x))
  let i = c(inM ?? inN)
  let o = c(outM ?? outN)
  if (o - i >= GAP) return [i, o]
  if (outM === undefined) i = Math.max(0, o - GAP)
  else if (inM === undefined) o = Math.min(1, i + GAP)
  else {
    const mid = Math.max(GAP / 2, Math.min(1 - GAP / 2, (i + o) / 2))
    i = mid - GAP / 2
    o = mid + GAP / 2
  }
  return [i, o]
}

const WORD: Record<AuModField, string> = {
  volume: 'volume', mix: 'mix', pan: 'pan', playhead: 'playhead', speed: 'speed', trimIn: 'in', trimOut: 'out'
}
/** Its name in the modulation panel : "AU volume", "AU A pan", "AU B in". */
export function auLabel(t: AuModTarget): string {
  return `AU ${t.slot ? `${t.slot} ` : ''}${WORD[t.field]}`
}
