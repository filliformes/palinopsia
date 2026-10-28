// The `steps` modulator's vocabulary : its conditions, its defaults, the check a
// session goes through, the musical patterns the dice draw, and the words the
// card and its menu use. Pure : the clock itself lives in modulation.ts.
//
// The conditions are the step sequencer's own SLIP, one step at a time : a
// probability drops some of a step's plays and keeps it on the grid; an A:B
// plays it on some passes only, so a short pattern turns into a longer phrase;
// fill / not fill swap steps while FILL is held; first / not first make the
// first time through differ from the rest.

import type { StepCond, StepsConfig } from '@shared/types'

export const STEP_MAX = 16
export const SWING_MIN = 50
export const SWING_MAX = 75
/** The fixed chances the menu offers : quick to pick live, and each one reads as
 *  a different feel (rare, sometimes, half, mostly, nearly always). A session
 *  may carry any whole percent 1..99. */
export const STEP_PROBS = [10, 25, 50, 75, 90]

export type ParsedCond =
  | { kind: 'always' }
  | { kind: 'prob'; p: number }
  | { kind: 'ab'; a: number; b: number }
  | { kind: 'fill' }
  | { kind: 'notFill' }
  | { kind: 'first' }
  | { kind: 'notFirst' }

const ALWAYS: ParsedCond = { kind: 'always' }

/** A condition as written in a session, read (anything unknown : always). */
export function parseStepCond(c: unknown): ParsedCond {
  if (typeof c !== 'string') return ALWAYS
  switch (c) {
    case 'fill':
      return { kind: 'fill' }
    case '!fill':
      return { kind: 'notFill' }
    case 'first':
      return { kind: 'first' }
    case '!first':
      return { kind: 'notFirst' }
  }
  const p = /^p(\d{1,2})$/.exec(c)
  if (p) {
    const n = Number(p[1])
    return n >= 1 && n <= 99 ? { kind: 'prob', p: n } : ALWAYS
  }
  const ab = /^(\d):(\d)$/.exec(c)
  if (ab) {
    const a = Number(ab[1])
    const b = Number(ab[2])
    return b >= 2 && b <= 8 && a >= 1 && a <= b ? { kind: 'ab', a, b } : ALWAYS
  }
  return ALWAYS
}

/** A condition written back (the canonical spelling). */
export function stepCondOf(c: ParsedCond): StepCond {
  switch (c.kind) {
    case 'prob':
      return `p${c.p}` as StepCond
    case 'ab':
      return `${c.a}:${c.b}` as StepCond
    case 'fill':
      return 'fill'
    case 'notFill':
      return '!fill'
    case 'first':
      return 'first'
    case 'notFirst':
      return '!first'
    default:
      return 'always'
  }
}

/** Does a step with this condition play on this pass (1 = the first of the
 *  run), FILL being on or off? A probability draws anew each time round. */
export function condPlays(c: ParsedCond, pass: number, fill: boolean, rnd: () => number = Math.random): boolean {
  switch (c.kind) {
    case 'always':
      return true
    case 'prob':
      return rnd() * 100 < c.p
    case 'ab':
      return ((((pass - 1) % c.b) + c.b) % c.b) + 1 === c.a
    case 'fill':
      return fill
    case 'notFill':
      return !fill
    case 'first':
      return pass === 1
    case 'notFirst':
      return pass > 1
  }
}

/** How late an even step (2, 4, 6...) lands, as a share of a step : 0 at 50 %
 *  swing, half a step at 75 %, so it never reaches the step after it. */
export function swingLate(swing: number): number {
  const s = Math.max(SWING_MIN, Math.min(SWING_MAX, Number.isFinite(swing) ? swing : SWING_MIN))
  return ((s - 50) / 100) * 2
}

// The default pattern : a staircase up over the first eight steps (what plays),
// back down over the other eight, so a length of 16 is an up and a down.
const DEFAULT_VALUES = Array.from({ length: STEP_MAX }, (_, i) => (i < 8 ? (i + 1) / 8 : (16 - i) / 8))

export function defaultSteps(): StepsConfig {
  return {
    length: 8,
    values: DEFAULT_VALUES.slice(),
    on: new Array<boolean>(STEP_MAX).fill(true),
    cond: new Array<StepCond>(STEP_MAX).fill('always'),
    swing: 50,
    glide: 0,
    rest: 'hold'
  }
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** A session's steps block, checked : the right lengths, numbers in range,
 *  conditions it knows. Anything missing or broken takes the default, so an
 *  older session (no block at all) or a hand-edited one loads without a fault. */
export function sanitizeSteps(raw: unknown): StepsConfig {
  const d = defaultSteps()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<Record<keyof StepsConfig, unknown>>
  const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
  const vals = arr(r.values)
  const ons = arr(r.on)
  const conds = arr(r.cond)
  const len = Number(r.length)
  const swing = Number(r.swing)
  const glide = Number(r.glide)
  return {
    length: Number.isFinite(len) ? Math.max(1, Math.min(STEP_MAX, Math.round(len))) : d.length,
    values: d.values.map((v, i) => {
      const x = Number(vals[i])
      return vals[i] != null && Number.isFinite(x) ? clamp01(x) : v
    }),
    on: d.on.map((v, i) => (typeof ons[i] === 'boolean' ? (ons[i] as boolean) : v)),
    cond: d.cond.map((_, i) => stepCondOf(parseStepCond(conds[i]))),
    swing: Number.isFinite(swing) ? Math.max(SWING_MIN, Math.min(SWING_MAX, swing)) : d.swing,
    glide: Number.isFinite(glide) ? clamp01(glide) : d.glide,
    rest: r.rest === 'zero' ? 'zero' : 'hold'
  }
}

/** The steps block the engine and the card read : the stored one when it is
 *  whole (every session goes through sanitizeSteps on load), else checked here,
 *  so a config built by hand somewhere never faults the frame loop. */
export function stepsOf(m: { steps?: StepsConfig }): StepsConfig {
  const s = m.steps
  if (
    s &&
    Array.isArray(s.values) && s.values.length >= STEP_MAX &&
    Array.isArray(s.on) && s.on.length >= STEP_MAX &&
    Array.isArray(s.cond) && s.cond.length >= STEP_MAX &&
    Number.isFinite(s.length) && Number.isFinite(s.swing) && Number.isFinite(s.glide)
  )
    return s
  return sanitizeSteps(s)
}

/** The length to play, whole and in range. */
export function stepLength(s: StepsConfig): number {
  return Math.max(1, Math.min(STEP_MAX, Math.round(s.length) || 1))
}

// ── Patterns the dice draw ─────────────────────────────────────────────────
// Musical rather than noise : a short motif on a few levels, repeated with
// small changes and an accent on the downbeats; mostly plain steps, a few
// rests, and now and then a step on some passes, on a chance, or for the fill.

const LEVELS = [0.15, 0.35, 0.55, 0.75, 1]

export function randomStepPattern(rnd: () => number = Math.random): Pick<StepsConfig, 'values' | 'on' | 'cond'> {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
  const motifLen = pick([2, 3, 4, 4, 8])
  const motif = Array.from({ length: motifLen }, () => pick(LEVELS))
  const values: number[] = []
  const on: boolean[] = []
  const cond: StepCond[] = []
  for (let i = 0; i < STEP_MAX; i++) {
    let v = motif[i % motifLen]
    if (rnd() < 0.2) v = pick(LEVELS) // a variation
    if (i % 4 === 0 && rnd() < 0.5) v = Math.max(v, 0.75) // the downbeats lean high
    values.push(v)
    on.push(i === 0 || rnd() > 0.15) // the first step always plays
    const r = rnd()
    cond.push(
      i === 0 ? 'always'
        : r < 0.05 ? '1:2'
          : r < 0.08 ? '2:4'
            : r < 0.13 ? (`p${pick([25, 50, 75])}` as StepCond)
              : r < 0.16 ? 'fill'
                : r < 0.17 ? '!first'
                  : 'always'
    )
  }
  return { values, on, cond }
}

/** A whole steps block for the dice and Generate : a pattern, a length that
 *  reads as a bar or a phrase, mostly straight, sometimes a little swing. */
export function randomSteps(rnd: () => number = Math.random): StepsConfig {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
  return {
    ...defaultSteps(),
    ...randomStepPattern(rnd),
    length: pick([8, 8, 16, 16, 16, 12, 6, 5, 7]),
    swing: rnd() < 0.7 ? 50 : Math.round(55 + rnd() * 7),
    glide: rnd() < 0.6 ? 0 : Math.round((0.15 + rnd() * 0.5) * 100) / 100,
    rest: rnd() < 0.8 ? 'hold' : 'zero'
  }
}

// ── Words (the card's marks, hover text and menu) ──────────────────────────

/** A condition in a few words ("on pass 1 of every 2", "50 % of the time",
 *  "only in a fill"), read after "plays". */
export function condLabel(c: ParsedCond): string {
  switch (c.kind) {
    case 'always':
      return 'always'
    case 'prob':
      return `${c.p} % of the time`
    case 'ab':
      return `on pass ${c.a} of every ${c.b}`
    case 'fill':
      return 'only in a fill'
    case 'notFill':
      return 'only outside a fill'
    case 'first':
      return 'only the first time through'
    case 'notFirst':
      return 'every time but the first'
  }
}
