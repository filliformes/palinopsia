// Signal's PICTURE PLAY : the picture's moving things play the Signal voice's
// own grains, as they play the Synth (synthPlay.ts finds and tracks them : the
// same SynthPlayer, its own instance, through an adapter). Signal sounds as it
// always does (its nine waves, decay, tone, fm); what changes is who plays it
// and what shapes each hit : a picture patchbay of eight rows, the thing's
// features → the hit's velocity, decay, tone, fm, wave, rate, pan and chance.
// STRIKE : each moving thing ticks grains on Signal's clock while it moves.
// TIE : one grain held per thing, struck again at each new note it crosses.
// The READ HEADS (the scan of marks on a clock) stay the other way to play it.

import { defaultSynth, SYNTH_SRCS, type SynthCfg, type SynthMods, type SynthRow, type SynthSrc } from './synthPlay'

export const SIGNAL_DESTS = ['vel', 'decay', 'tone', 'fm', 'wave', 'rate', 'pan', 'chance'] as const
export type SignalDest = (typeof SIGNAL_DESTS)[number]
export const SIGNAL_DEST_LABEL: Record<SignalDest, string> = {
  vel: 'velocity', decay: 'decay', tone: 'tone', fm: 'fm', wave: 'wave', rate: 'rate', pan: 'pan', chance: 'chance'
}
export const SIGNAL_DEST_HINT: Record<SignalDest, string> = {
  vel: 'how hard each hit is (a strike reads it, the held level follows it)',
  decay: 'how long each hit rings, around the decay knob',
  tone: 'how bright the noise, click and pink hits are, around the tone knob',
  fm: 'how metallic the fm hit is, around the fm knob',
  wave: 'which wave the thing plays : steps through the nine waves from the one picked',
  rate: 'STRIKE : how often the thing ticks, from a quarter to four times the clock',
  pan: 'where the hit sits, left to right',
  chance: 'how likely a hit is to play : a low source thins the thing\'s hits (depth up : the pattern breathes)'
}

export type SignalRow = SynthRow

/** Gentle by default : Signal still sounds like Signal, the picture shapes it. */
export function defaultSignalPatch(): SignalRow[] {
  return [
    { src: 'speed', depth: 0.6 }, // faster things hit harder
    { src: 'size', depth: 0.3 }, // big things ring longer
    { src: 'brightness', depth: 0.4 }, // light things are brighter
    { src: 'texture', depth: 0.3 },
    { src: 'none', depth: 0 }, // the wave stays the one picked
    { src: 'speed', depth: 0.5 }, // faster things tick faster
    { src: 'x', depth: 0.8 }, // the hit sits where the thing is
    { src: 'none', depth: 0 } // every hit plays
  ]
}

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0)
const num = (v: unknown, d: number, lo: number, hi: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}

/** Eight valid rows from anything saved (a missing row : its default). */
export function normalizeSignalPatch(raw: unknown): SignalRow[] {
  const rows = Array.isArray(raw) ? raw : []
  return defaultSignalPatch().map((dr, i) => {
    const x = rows[i] as Partial<SignalRow> | undefined
    const src = (SYNTH_SRCS as readonly string[]).includes(x?.src as string) ? (x!.src as SynthSrc) : dr.src
    return { src, depth: num(x?.depth, dr.depth, -1, 1) }
  })
}

/** What the SynthPlayer reads, built from the Signal voice : its read of the
 *  place (height / keys / radial), its sense, PICTURE and its eight rows (in
 *  the Synth's slots 0..7 : the player computes every row the same way, its
 *  velocity row included; slots 8 and 9 rest). */
export function signalPlayerCfg(sg: { pmode?: string; loOct: number; hiOct: number; sens?: number; picture?: number; patch?: unknown }): SynthCfg {
  const rows = normalizeSignalPatch(sg.patch)
  const mode = sg.pmode === 'keyboard' || sg.pmode === 'radial' ? sg.pmode : 'height'
  return {
    ...defaultSynth(),
    on: true,
    mode,
    loOct: sg.loOct,
    hiOct: Math.max(sg.loOct + 1, sg.hiOct),
    sens: clamp01(sg.sens ?? 0.5),
    grid: 'free',
    slide: false,
    voices: 'poly',
    picture: clamp01(sg.picture ?? 0.8),
    patch: [...rows, { src: 'none', depth: 0 }, { src: 'none', depth: 0 }]
  }
}

/** A hit's sound from the voice's knobs and the thing's patchbay mods (the
 *  player's SynthMods, read by slot : timbre = decay, harmonics = tone, morph =
 *  fm, cutoff = wave, reso = rate, drive = pan, env = chance). */
export interface SignalHit { decay: number; tone: number; fm: number; wave: number; pan: number; rate: number; chance: number; level: number }
export function signalHit(
  sg: { decay: number; tone: number; fm: number; wave: number },
  m: SynthMods | undefined,
  place: { x: number },
  panRow: boolean
): SignalHit {
  const c = (v: number | undefined): number => (Number.isFinite(v) ? (v as number) : 0)
  const wave = Math.max(0, Math.min(8, Math.round((sg.wave | 0) + c(m?.cutoff) * 4)))
  // rate : a power of two, so a synced clock stays on its grid
  const rate = Math.pow(2, Math.round(c(m?.reso) * 2))
  // chance : a source low on a positive depth thins the hits (none : always)
  const chance = clamp01(1 + Math.min(0, c(m?.env)))
  return {
    decay: clamp01(sg.decay + 0.5 * c(m?.timbre)),
    tone: clamp01(sg.tone + 0.5 * c(m?.harmonics)),
    fm: clamp01(sg.fm + 0.5 * c(m?.morph)),
    wave,
    // no pan row : the hit sits where the thing is, as a read head's mark does
    pan: panRow ? clamp01(0.5 + 0.5 * c(m?.drive)) : clamp01(place.x),
    rate,
    chance,
    // the held velocity around the strike (0.5 : as struck)
    level: clamp01(2 * c(m?.vel ?? 0.5))
  }
}

// ── the Picture section's dice : a new source and depth on each row ─────────
const rnd = (): number => Math.random()
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
const LIKES: Record<SignalDest, SynthSrc[]> = {
  vel: ['speed', 'speed', 'size', 'brightness', 'motion'],
  decay: ['size', 'size', 'age', 'brightness', 'saturation'],
  tone: ['brightness', 'brightness', 'y', 'hue', 'light'],
  fm: ['texture', 'texture', 'saturation', 'speed', 'busyness'],
  wave: ['hue', 'hue', 'y', 'texture'],
  rate: ['speed', 'speed', 'size', 'motion', 'busyness'],
  pan: ['x', 'x', 'x', 'hue'],
  chance: ['texture', 'busyness', 'brightness', 'saturation']
}
/** Every row a source and a depth, gently : velocity always plays (mostly the
 *  harder the faster), wave and chance rest often (each changes the pattern's
 *  character most), pan mostly follows x. */
export function randomSignalPatchbay(): SignalRow[] {
  return SIGNAL_DESTS.map((d): SignalRow => {
    if (d !== 'vel' && rnd() < (d === 'wave' || d === 'chance' ? 0.6 : 0.15)) return { src: 'none', depth: 0 }
    const src = pick(LIKES[d])
    const sign = d === 'vel' || d === 'pan' ? (rnd() < 0.85 ? 1 : -1) : rnd() < 0.65 ? 1 : -1
    const a = d === 'vel' || d === 'pan' ? 0.5 + rnd() * 0.4 : d === 'wave' ? 0.2 + rnd() * 0.3 : 0.25 + rnd() * 0.45
    return { src, depth: Math.round(sign * a * 100) / 100 }
  })
}
