// Sonify's output EQ : twelve bands after everything in Sonify, to tune the
// room it plays in (a parametric EQ in the manner of the studio ones : low cut,
// low shelf, eight bells, high shelf, high cut). This file is its maths, shared
// by the page (the curve it draws) and, copied line for line, by the worklet
// that runs it (soni.worklet.js, `eqSections`) : change one, change the other.
//
// Every band has a frequency, a Q and a slope (6, 12, 24 or 36 dB per octave);
// the bells and shelves a gain too. A slope is a number of second-order sections
// in series : 12 is one, 24 two, 36 three, and 6 a first-order section (a cut or
// a shelf) or, for a bell, one section at half the Q (gentler). A steeper shelf
// or bell splits its gain between its sections, so the gain is the gain and only
// the skirt steepens. Coefficients are the RBJ cookbook's, normalized to a0 = 1.

export type EqKind = 'lowcut' | 'lowshelf' | 'bell' | 'highshelf' | 'highcut'
export type EqSlope = 6 | 12 | 24 | 36

export interface SoniEqBand {
  on: boolean
  freq: number // Hz
  gain: number // dB (bells and shelves)
  q: number
  slope: EqSlope
}

export interface SoniEq {
  on: boolean
  inGain: number // dB, into the bands
  outGain: number // dB, after them (before the safety ceiling)
  bands: SoniEqBand[] // 12, in the order of EQ_KINDS
  glue: SoniGlue // after the bands, before the output gain and the ceiling
}

/** The glue : one compressor on the whole Sonify mix (soni.worklet.js, the
 *  port of Loopex's master glue). Its own on / off : it runs with the EQ
 *  bypassed too. A voicing sets attack, release, knee, drive and thrust. */
export type GlueVoice = 'clean' | 'warm' | 'punch' | 'bite' | 'slow'
export const GLUE_VOICES: GlueVoice[] = ['clean', 'warm', 'punch', 'bite', 'slow']
export interface SoniGlue {
  on: boolean
  amount: number // 0..1 : threshold 0 to -12 dB, ratio 1.5:1 to 4:1, makeup automatic
  voice: GlueVoice
}

export const EQ_KINDS: EqKind[] = ['lowcut', 'lowshelf', 'bell', 'bell', 'bell', 'bell', 'bell', 'bell', 'bell', 'bell', 'highshelf', 'highcut']
export const EQ_SLOPES: EqSlope[] = [6, 12, 24, 36]
export const EQ_FREQ_MIN = 20
export const EQ_FREQ_MAX = 20000
export const EQ_GAIN_MAX = 24 // dB either way
export const EQ_Q_MIN = 0.1
export const EQ_Q_MAX = 18
export const EQ_IO_MAX = 24 // dB either way, input and output gain

// The bells start spread an octave apart over the room's useful range.
const BELL_FREQS = [60, 120, 250, 500, 1000, 2000, 4000, 8000]

export function defaultEq(): SoniEq {
  let bell = 0
  return {
    on: true,
    inGain: 0,
    outGain: 0,
    glue: { on: false, amount: 0.4, voice: 'clean' },
    bands: EQ_KINDS.map((k) => {
      if (k === 'lowcut') return { on: false, freq: 30, gain: 0, q: 0.71, slope: 24 }
      if (k === 'highcut') return { on: false, freq: 18000, gain: 0, q: 0.71, slope: 24 }
      if (k === 'lowshelf') return { on: false, freq: 100, gain: 0, q: 0.71, slope: 12 }
      if (k === 'highshelf') return { on: false, freq: 8000, gain: 0, q: 0.71, slope: 12 }
      return { on: false, freq: BELL_FREQS[bell++], gain: 0, q: 1, slope: 12 }
    })
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** A saved EQ made whole : twelve bands, every field in range (an older or
 *  hand-edited session can carry fewer bands or none). */
export function normalizeEq(e: Partial<SoniEq> | null | undefined): SoniEq {
  const d = defaultEq()
  const src = e && typeof e === 'object' ? e : {}
  const bands = d.bands.map((db, i) => {
    const b = (Array.isArray(src.bands) ? src.bands[i] : null) as Partial<SoniEqBand> | null
    if (!b || typeof b !== 'object') return db
    const slope = (EQ_SLOPES as number[]).includes(b.slope as number) ? (b.slope as EqSlope) : db.slope
    return {
      on: !!b.on,
      freq: clamp(num(b.freq, db.freq), EQ_FREQ_MIN, EQ_FREQ_MAX),
      gain: clamp(num(b.gain, db.gain), -EQ_GAIN_MAX, EQ_GAIN_MAX),
      q: clamp(num(b.q, db.q), EQ_Q_MIN, EQ_Q_MAX),
      slope
    }
  })
  const gl = (src.glue && typeof src.glue === 'object' ? src.glue : {}) as Partial<SoniGlue>
  return {
    on: typeof src.on === 'boolean' ? src.on : d.on,
    inGain: clamp(num(src.inGain, 0), -EQ_IO_MAX, EQ_IO_MAX),
    outGain: clamp(num(src.outGain, 0), -EQ_IO_MAX, EQ_IO_MAX),
    glue: {
      on: typeof gl.on === 'boolean' ? gl.on : d.glue.on,
      amount: clamp(num(gl.amount, d.glue.amount), 0, 1),
      voice: GLUE_VOICES.includes(gl.voice as GlueVoice) ? (gl.voice as GlueVoice) : d.glue.voice
    },
    bands
  }
}

/** One biquad : [b0, b1, b2, a1, a2], a0 = 1. */
export type Biquad = [number, number, number, number, number]

// Butterworth section Qs for 4th and 6th order : the cut's slope with no bump;
// the band's own Q then scales the LAST section (a resonant cut above 0.71).
const BW4 = [0.5412, 1.3066]
const BW6 = [0.5176, 0.7071, 1.9319]

function rbj(kind: EqKind, f: number, q: number, gainDb: number, sr: number): Biquad {
  const w0 = (2 * Math.PI * Math.min(f, sr * 0.49)) / sr
  const cs = Math.cos(w0), sn = Math.sin(w0)
  const alpha = sn / (2 * q)
  const A = Math.pow(10, gainDb / 40)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  if (kind === 'lowcut') {
    b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha
  } else if (kind === 'highcut') {
    b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha
  } else if (kind === 'bell') {
    b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A
  } else {
    const sq = 2 * Math.sqrt(A) * alpha
    if (kind === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cs + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - sq)
      a0 = (A + 1) + (A - 1) * cs + sq; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - sq
    } else {
      b0 = A * ((A + 1) + (A - 1) * cs + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - sq)
      a0 = (A + 1) - (A - 1) * cs + sq; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - sq
    }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0]
}

/** First-order sections (6 dB/oct) : a cut, or a shelf of `gainDb`. Bilinear,
 *  prewarped at `f`. */
function firstOrder(kind: EqKind, f: number, gainDb: number, sr: number): Biquad {
  const k = Math.tan((Math.PI * Math.min(f, sr * 0.49)) / sr)
  if (kind === 'lowcut') { const n = 1 / (1 + k); return [n, -n, 0, (k - 1) * n, 0] }
  if (kind === 'highcut') { const n = 1 / (1 + k); return [k * n, k * n, 0, (k - 1) * n, 0] }
  const G = Math.pow(10, gainDb / 20)
  if (kind === 'lowshelf') {
    // H(s) = (s + G·w) / (s + w) : G below the corner, 1 above
    const n = 1 / (1 + k)
    return [(1 + G * k) * n, (G * k - 1) * n, 0, (k - 1) * n, 0]
  }
  // highshelf : H(s) = (G·s + w) / (s + w) : 1 below the corner, G above
  const n = 1 / (1 + k)
  return [(G + k) * n, (k - G) * n, 0, (k - 1) * n, 0]
}

/** The sections a band runs as, at sample rate `sr`. None when the band is off
 *  or does nothing (a bell or a shelf at 0 dB). */
export function eqSections(kind: EqKind, b: SoniEqBand, sr: number): Biquad[] {
  if (!b.on) return []
  const isCut = kind === 'lowcut' || kind === 'highcut'
  if (!isCut && Math.abs(b.gain) < 0.01) return []
  const q = clamp(b.q, EQ_Q_MIN, EQ_Q_MAX)
  if (isCut) {
    if (b.slope === 6) return [firstOrder(kind, b.freq, 0, sr)]
    if (b.slope === 12) return [rbj(kind, b.freq, q, 0, sr)]
    const qs = b.slope === 24 ? BW4 : BW6
    return qs.map((bq, i) => rbj(kind, b.freq, i === qs.length - 1 ? bq * (q / 0.7071) : bq, 0, sr))
  }
  if (kind === 'bell') {
    if (b.slope === 6) return [rbj('bell', b.freq, q * 0.5, b.gain, sr)]
    const n = b.slope === 12 ? 1 : b.slope === 24 ? 2 : 3
    return Array.from({ length: n }, () => rbj('bell', b.freq, q, b.gain / n, sr))
  }
  if (b.slope === 6) return [firstOrder(kind, b.freq, b.gain, sr)]
  const n = b.slope === 12 ? 1 : b.slope === 24 ? 2 : 3
  return Array.from({ length: n }, () => rbj(kind, b.freq, q, b.gain / n, sr))
}

/** The magnitude of a chain of sections at `f` Hz, in dB. */
export function sectionsDb(secs: Biquad[], f: number, sr: number): number {
  if (!secs.length) return 0
  const w = (2 * Math.PI * f) / sr
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
  let mag2 = 1
  for (const [b0, b1, b2, a1, a2] of secs) {
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2)
    const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2)
    mag2 *= (nr * nr + ni * ni) / Math.max(1e-30, dr * dr + di * di)
  }
  return 10 * Math.log10(Math.max(1e-30, mag2))
}

/** One band's response at `f`, in dB. */
export function bandDb(i: number, b: SoniEqBand, f: number, sr: number): number {
  return sectionsDb(eqSections(EQ_KINDS[i], b, sr), f, sr)
}

/** The whole EQ's response at `f` (bands only : the input and output gains are
 *  drawn as their own lines), in dB. */
export function eqDb(e: SoniEq, f: number, sr: number): number {
  let db = 0
  e.bands.forEach((b, i) => { db += bandDb(i, b, f, sr) })
  return db
}
