// The key sequencer's model : its defaults, the validation every load goes
// through (localStorage, sessions), and the music it reasons with (pitch-class
// sets, the circle of fifths, shared notes, the brightness of a mode). Pure : the
// store and the sequencer (soniKeySeq.ts) both import it.

import type { SoniKeySeq, SoniKeyStep, SoniKeyMode } from '@shared/types'
import { SONI_SCALES, SCALE_STEPS, type SoniScale } from './sonify'
import { isSoniRate } from './soniClock'

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const KEY_MODES: SoniKeyMode[] = ['list', 'circle', 'affinity', 'pivot', 'picture']
// The modes from brightest to darkest (Pivot's "tonic" walk, Picture's mood).
// Pentatonic is the minor pentatonic here ([0 3 5 7 10]); chromatic has no mood.
export const BRIGHT: SoniScale[] = ['lydian', 'major', 'wholetone', 'dorian', 'pentatonic', 'minor', 'phrygian', 'chromatic']
// The diatonic modes we have, by their tonic's distance above the parent major :
// I major (ionian), II dorian, III phrygian, IV lydian, VI minor (aeolian).
export const DIATONIC: Array<[SoniScale, number]> = [['major', 0], ['dorian', 2], ['phrygian', 4], ['lydian', 5], ['minor', 9]]

export interface Key {
  root: number
  scale: SoniScale
  oct: number
}

export const mod12 = (n: number): number => ((n % 12) + 12) % 12
export const keyId = (k: Key): string => `${k.root}:${k.scale}:${k.oct}`
export const sameKey = (a: Key | null, b: Key | null): boolean =>
  !!a && !!b && a.root === b.root && a.scale === b.scale && a.oct === b.oct
export const keyName = (k: Key): string => `${NOTE_NAMES[mod12(k.root)]} ${k.scale}`
export const isScale = (s: unknown): s is SoniScale => typeof s === 'string' && (SONI_SCALES as string[]).includes(s)

/** The key's pitch classes as a 12-bit mask. */
export function pitchSet(k: { root: number; scale: SoniScale }): number {
  let m = 0
  for (const s of SCALE_STEPS[k.scale]) m |= 1 << mod12(k.root + s)
  return m
}
const bits = (m: number): number => {
  let c = 0
  for (; m; m &= m - 1) c++
  return c
}
/** Shared notes, 0 (none) … 1 (the same notes) : |A ∩ B| / |A ∪ B|. */
export function affinity(a: Key, b: Key): number {
  const A = pitchSet(a), B = pitchSet(b)
  return bits(A & B) / Math.max(1, bits(A | B))
}

// The circle of fifths : C 0, G 1, D 2 … F 11. Multiplying by 7 maps a root to
// its place and back (7 is its own inverse mod 12).
export const fifthsPos = (root: number): number => mod12(root * 7)
export const rootAtFifths = (pos: number): number => mod12(pos * 7)

export function makeDefaultKeySeq(): SoniKeySeq {
  const step = (root: number, scale: SoniScale): SoniKeyStep => ({ root, scale, oct: 3 })
  return {
    on: false,
    mode: 'circle',
    rate: 'free',
    freeMs: 5000,
    chance: 1,
    glide: 1,
    returnHome: false,
    poolRoots: Array.from({ length: 12 }, () => true),
    poolScales: ['major', 'minor', 'dorian', 'phrygian', 'lydian'],
    euclid: false,
    ePulses: 3,
    eSteps: 8,
    eRot: 0,
    // i - iv - VI - v in A minor, then the same in C : a list that already plays.
    steps: [step(9, 'minor'), step(2, 'minor'), step(5, 'major'), step(4, 'minor'), step(0, 'major'), step(5, 'lydian'), step(7, 'major'), step(9, 'dorian')],
    len: 4,
    order: 'forward',
    bias: 0,
    circBias: 0,
    circLeap: 1,
    circRel: 0.25,
    affSmooth: 50,
    affNoRepeat: true,
    affTour: false,
    pivKind: 'modes',
    pivDir: 'random',
    picSource: 'color',
    picHold: 8
  }
}

const num = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d
const int = (v: unknown, lo: number, hi: number, d: number): number => Math.round(num(v, lo, hi, d))

/** Any saved key sequence (localStorage, a session, an older or hand-edited
 *  file) made whole and in range. Always comes back stopped. */
export function sanitizeKeySeq(raw: unknown, fallback: SoniKeySeq): SoniKeySeq {
  if (!raw || typeof raw !== 'object') return { ...fallback, on: false }
  const d = makeDefaultKeySeq()
  const s = raw as Partial<SoniKeySeq>
  const steps = d.steps.map((ds, i) => {
    const st = Array.isArray(s.steps) ? (s.steps[i] as Partial<SoniKeyStep> | undefined) : undefined
    return {
      root: int(st?.root, 0, 11, ds.root),
      scale: isScale(st?.scale) ? st!.scale! : ds.scale,
      oct: int(st?.oct, 1, 6, ds.oct)
    }
  })
  const poolScales = Array.isArray(s.poolScales) ? s.poolScales.filter(isScale) : d.poolScales
  const poolRoots = Array.isArray(s.poolRoots) && s.poolRoots.length === 12 ? s.poolRoots.map(Boolean) : d.poolRoots
  return {
    on: false,
    mode: (KEY_MODES as string[]).includes(s.mode as string) ? (s.mode as SoniKeyMode) : d.mode,
    rate: isSoniRate(s.rate) ? s.rate : d.rate,
    freeMs: num(s.freeMs, 250, 300000, d.freeMs),
    chance: num(s.chance, 0, 1, d.chance),
    glide: num(s.glide, 0, 4, d.glide),
    returnHome: typeof s.returnHome === 'boolean' ? s.returnHome : d.returnHome,
    poolRoots: poolRoots.some(Boolean) ? poolRoots : d.poolRoots,
    poolScales: poolScales.length ? [...new Set(poolScales)] : d.poolScales,
    euclid: !!s.euclid,
    ePulses: int(s.ePulses, 1, 16, d.ePulses),
    eSteps: int(s.eSteps, 2, 16, d.eSteps),
    eRot: int(s.eRot, 0, 15, d.eRot),
    steps,
    len: int(s.len, 1, 8, d.len),
    order: s.order === 'bounce' || s.order === 'drift' ? s.order : 'forward',
    bias: num(s.bias, -100, 100, d.bias),
    circBias: num(s.circBias, -1, 1, d.circBias),
    circLeap: int(s.circLeap, 1, 3, d.circLeap),
    circRel: num(s.circRel, 0, 1, d.circRel),
    affSmooth: num(s.affSmooth, -100, 100, d.affSmooth),
    affNoRepeat: typeof s.affNoRepeat === 'boolean' ? s.affNoRepeat : d.affNoRepeat,
    affTour: !!s.affTour,
    pivKind: s.pivKind === 'tonic' ? 'tonic' : 'modes',
    pivDir: s.pivDir === 'up' || s.pivDir === 'down' ? s.pivDir : 'random',
    picSource: s.picSource === 'cuts' ? 'cuts' : 'color',
    picHold: num(s.picHold, 0, 120, d.picHold)
  }
}

/** Does the Euclidean rhythm (pulses spread over steps, rotated) fall on tick k?
 *  3 over 8 : x..x..x. (the tresillo). */
export function euclidHit(k: number, pulses: number, steps: number, rot: number): boolean {
  const n = Math.max(1, steps | 0)
  const p = Math.max(0, Math.min(n, pulses | 0))
  const i = (((k + rot) % n) + n) % n
  return (i * p) % n < p
}
