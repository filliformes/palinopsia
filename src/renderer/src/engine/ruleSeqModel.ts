// The Body rule timeline's model (the Seq page's rules lane) : what it holds,
// how a stored or loaded one is checked, and the block geometry the lane and
// its clock share. No store import, so the store can use it. Runtime (the
// clock, the hand that wins) : ./ruleSeq.ts. UI : components/RuleLane.tsx.
//
// The timeline lives on this machine beside the rules it plays (the rules are
// the machine's, like the camera that fires them : store.bodyControl), each
// block naming its rule by id : renaming a rule keeps its blocks, deleting it
// takes them along.
//
// It counts on one of two clocks (`unit`) : BARS of the shared beat clock (the
// tempo, or Ableton Link's bar), or TIME, real seconds the tempo never moves.
// The length and every block are in the timeline's own unit; switching the
// clock converts them at the tempo, so they keep their place in time.

import type { RuleBlock, RuleTimeline, RuleUnit, SeqLaneId, SeqLanes } from '@shared/types'

/** The loop's quick picks in bars (any whole number of bars can be typed). */
export const RULE_LENGTHS = [4, 8, 16, 32, 64] as const
export const RULE_MAX_BARS = 256
/** The shortest block in bars : a sixteenth of a bar. */
export const RULE_MIN_LEN = 1 / 16
/** The loop's quick picks in seconds : 30 s, 1, 2, 5, 10 and 30 minutes. */
export const RULE_TIME_LENGTHS = [30, 60, 120, 300, 600, 1800] as const
/** In time, the loop runs from 5 seconds to two hours : long enough for an
 *  installation's whole evening, short enough for a gesture study. */
export const RULE_MIN_SEC = 5
export const RULE_MAX_SEC = 7200
/** The shortest block in time : a tenth of a second (the finest snap). */
export const RULE_MIN_LEN_SEC = 0.1
const MAX_BLOCKS = 512
const KEY = 'opsia.ruleSeq'

export const makeDefaultRuleTimeline = (): RuleTimeline => ({ length: 16, loop: true, blocks: [] })

export const SEQ_LANE_IDS: SeqLaneId[] = ['scenes', 'keys', 'rules', 'lights']
export const makeDefaultSeqLanes = (): SeqLanes => ({ arm: { scenes: true, keys: true, rules: true, lights: true } })

export function sanitizeSeqLanes(raw: unknown): SeqLanes {
  const d = makeDefaultSeqLanes()
  const arm = (raw as Partial<SeqLanes> | null)?.arm
  if (!arm || typeof arm !== 'object') return d
  for (const id of SEQ_LANE_IDS) if (typeof arm[id] === 'boolean') d.arm[id] = arm[id]
  return d
}

/** The clock a timeline counts on (no unit : bars, as every timeline was). */
export const ruleUnit = (t: { unit?: unknown } | null | undefined): RuleUnit => (t?.unit === 'time' ? 'time' : 'bars')

/** A bar position as kept : on a 1/48 bar grid (beats of 3, 4, 6 and 8 land
 *  exactly), so a block dragged a hundred times never drifts off its bar. */
export const q48 = (x: number): number => Math.round(x * 48) / 48
/** A time position as kept : on a grid of hundredths of a second (a timeline
 *  converted from bars keeps its place to 5 ms; typed and snapped ones land on
 *  tenths). */
export const q100 = (x: number): number => Math.round(x * 100) / 100

/** A unit's grid and bounds : how a position is kept, the shortest block, the
 *  last place a block may reach. */
export function unitGrid(unit: RuleUnit): { q: (x: number) => number; min: number; max: number } {
  return unit === 'time' ? { q: q100, min: RULE_MIN_LEN_SEC, max: RULE_MAX_SEC } : { q: q48, min: RULE_MIN_LEN, max: RULE_MAX_BARS }
}

/** A loop length as kept : whole bars from 1 to 256, or seconds (to the
 *  hundredth) from 5 s to 120 min. */
export function clampRuleLength(unit: RuleUnit, n: number): number {
  if (unit === 'time') return Math.max(RULE_MIN_SEC, Math.min(RULE_MAX_SEC, q100(n)))
  return Math.max(1, Math.min(RULE_MAX_BARS, Math.round(n)))
}

let blockSeq = 0
export const newBlockId = (): string => `b${Date.now().toString(36)}${(blockSeq++).toString(36)}`

export function sanitizeRuleTimeline(raw: unknown): RuleTimeline {
  const d = makeDefaultRuleTimeline()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<RuleTimeline>
  const unit = ruleUnit(r)
  const { q, min, max } = unitGrid(unit)
  const n = Number(r.length)
  const length = Number.isFinite(n) && n > 0 ? clampRuleLength(unit, n) : unit === 'time' ? 60 : d.length
  const seen = new Set<string>()
  const blocks: RuleBlock[] = []
  for (const b of Array.isArray(r.blocks) ? r.blocks : []) {
    if (blocks.length >= MAX_BLOCKS) break
    if (!b || typeof b !== 'object' || typeof b.rule !== 'string' || !b.rule) continue
    const start = Number(b.start), len = Number(b.len)
    if (!Number.isFinite(start) || !Number.isFinite(len)) continue
    const s = Math.max(0, Math.min(max - min, q(start)))
    const l = Math.max(min, Math.min(max - s, q(len)))
    let id = typeof b.id === 'string' && b.id ? b.id : newBlockId()
    if (seen.has(id)) id = newBlockId()
    seen.add(id)
    blocks.push({ id, rule: b.rule, start: s, len: l })
  }
  // (bars : no unit key, so a timeline in bars is stored exactly as before)
  return unit === 'time' ? { unit, length, loop: r.loop !== false, blocks } : { length, loop: r.loop !== false, blocks }
}

export function loadRuleTimeline(): RuleTimeline {
  try {
    return sanitizeRuleTimeline(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return makeDefaultRuleTimeline()
  }
}

export function saveRuleTimeline(t: RuleTimeline): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(t))
  } catch {
    console.warn('[ruleSeq] could not persist (quota)')
  }
}

/** A timeline counted on the other clock, at the tempo now (`bpm`, `bpb` beats
 *  a bar) : every block keeps its place in time. Bars to time : seconds = bars
 *  x beats a bar x 60 / BPM. Time to bars : each start and end to the nearest
 *  beat (blocks that touched still touch; one shorter than half a beat keeps a
 *  beat), the loop to whole bars. `dropped` : the blocks that start past the
 *  new clock's reach (time to bars at a fast tempo : past bar 256). */
export function convertRuleTimeline(t: RuleTimeline, to: RuleUnit, bpm: number, bpb: number): { timeline: RuleTimeline; dropped: number } {
  const from = ruleUnit(t)
  if (from === to) return { timeline: t, dropped: 0 }
  const tempo = Number.isFinite(bpm) && bpm > 0 ? bpm : 120
  const perBar = Math.max(1, bpb)
  const secPerBar = (perBar * 60) / tempo
  const { max } = unitGrid(to)
  let dropped = 0
  let blocks: RuleBlock[] = []
  let length: number
  if (to === 'time') {
    length = clampRuleLength('time', t.length * secPerBar)
    for (const b of t.blocks) {
      const s = q100(b.start * secPerBar)
      if (s >= max) { dropped++; continue }
      blocks.push({ ...b, start: s, len: q100(b.len * secPerBar) })
    }
  } else {
    const beatsPerSec = tempo / 60
    length = clampRuleLength('bars', (t.length * beatsPerSec) / perBar)
    for (const b of t.blocks) {
      const s = Math.round(b.start * beatsPerSec)
      const e = Math.max(s + 1, Math.round((b.start + b.len) * beatsPerSec))
      if (s / perBar >= max) { dropped++; continue }
      blocks.push({ ...b, start: q48(s / perBar), len: q48((e - s) / perBar) })
    }
  }
  // (rounding to beats can make two blocks of a row overlap : one, as a drag would)
  const q = unitGrid(to).q
  for (const rule of new Set(blocks.map((b) => b.rule))) blocks = meltRow(blocks, rule, undefined, q)
  return { timeline: sanitizeRuleTimeline({ unit: to, length, loop: t.loop, blocks }), dropped }
}

/** A row's blocks as they play : inside the loop (a block past its end waits
 *  there for a longer loop), cut at its end, sorted. */
export function playedBlocks(blocks: RuleBlock[], rule: string, length: number): RuleBlock[] {
  const out: RuleBlock[] = []
  for (const b of blocks) {
    if (b.rule !== rule || b.start >= length) continue
    out.push(b.start + b.len > length ? { ...b, len: length - b.start } : b)
  }
  return out.sort((a, b) => a.start - b.start)
}

/** On inside one of these blocks at `x` (in the loop's own bars or seconds). */
export const insideBlocks = (bs: RuleBlock[], x: number): boolean => bs.some((b) => x >= b.start - 1e-9 && x < b.start + b.len - 1e-9)

/** A row's edges : every block's start and end, in the loop's own unit. */
export function blockEdges(bs: RuleBlock[]): number[] {
  const e: number[] = []
  for (const b of bs) e.push(b.start, b.start + b.len)
  return e
}

/** An edge in the unwrapped stretch (a, b] (since the start; looping every
 *  `length` when `loop`). */
export function edgeCrossed(edges: number[], a: number, b: number, length: number, loop: boolean): boolean {
  if (b <= a) return false
  if (!loop) return edges.some((e) => e > a + 1e-9 && e <= b + 1e-9)
  const k0 = Math.floor(a / length)
  const k1 = Math.floor(b / length)
  for (let k = k0; k <= k1 + 1; k++) {
    for (const e of edges) {
      const x = e + k * length
      if (x > a + 1e-9 && x <= b + 1e-9) return true
    }
  }
  return false
}

/** One row with the overlapping blocks melted into one (blocks that only touch
 *  stay two : each edge is a moment the hand gives way). `keep` keeps that
 *  block's id for the melted one; `q` : the unit's grid (bars by default). */
export function meltRow(blocks: RuleBlock[], rule: string, keep?: string, q: (x: number) => number = q48): RuleBlock[] {
  const row = blocks.filter((b) => b.rule === rule).sort((a, b) => a.start - b.start || a.len - b.len)
  const rest = blocks.filter((b) => b.rule !== rule)
  const out: RuleBlock[] = []
  for (const b of row) {
    const last = out[out.length - 1]
    if (last && b.start < last.start + last.len - 1e-9) {
      const end = Math.max(last.start + last.len, b.start + b.len)
      out[out.length - 1] = { ...last, id: b.id === keep ? b.id : last.id, len: q(end - last.start) }
    } else out.push(b)
  }
  return [...rest, ...out]
}

// ── how the lane writes and reads its positions ─────────────────────────────

/** Seconds as m:ss, with the tenths or hundredths they need, `dec` at most
 *  (minutes run past 59 : two hours is 120:00). */
export function fmtClock(sec: number, dec = 2): string {
  const d = Math.max(0, Math.min(2, Math.floor(dec)))
  const c = Math.round(Math.max(0, Number.isFinite(sec) ? sec : 0) * 100) // hundredths
  const need = c % 100 === 0 ? 0 : c % 10 === 0 ? 1 : 2
  const k = Math.min(d, need)
  const step = 10 ** (2 - k)
  const r = Math.round(c / step) * step
  const whole = Math.floor(r / 100)
  const frac = k ? '.' + String(r % 100).padStart(2, '0').slice(0, k) : ''
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}${frac}`
}

/** A time typed in : `90` (seconds), `1:30`, `1:30.5`, `1:02:30` (hours), a
 *  comma for the point, `90s`, `5m` or `5 min`. Null when it reads as none. */
export function parseClock(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, ' ')
  if (!s) return null
  const mins = /^(\d+(?:\.\d+)?|\.\d+) ?(?:m|mn|min|mins|minutes?)$/.exec(s)
  if (mins) return Number(mins[1]) * 60
  const parts = s.replace(/ ?(?:s|sec|secs|seconds?)$/, '').split(':')
  if (parts.length > 3) return null
  const last = parts[parts.length - 1]
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(last)) return null
  let v = Number(last)
  for (let i = parts.length - 2, mul = 60; i >= 0; i--, mul *= 60) {
    if (!/^\d+$/.test(parts[i])) return null
    v += Number(parts[i]) * mul
  }
  return Number.isFinite(v) ? v : null
}

/** Beats past a whole number, written only as far as they need (2 places). */
const beatNum = (b: number): string => String(Math.round(b * 100) / 100)

/** A bar position as bar.beat from 1 : `5.3` (bar 5, its third beat); a beat
 *  between beats keeps its fraction (`5.2.5`). */
export function fmtBarBeat(x: number, bpb: number): string {
  const n = Math.max(1, bpb)
  const beats = Math.round(Math.max(0, x) * n * 100) / 100 // (rounded first : never "2.5" in a bar of 4)
  const bar = Math.floor(beats / n + 1e-9)
  return `${bar + 1}.${beatNum(beats - bar * n + 1)}`
}

/** Where a playhead is, as bar.beat from 1 : the beat it is in (never ahead). */
export function fmtBarBeatNow(x: number, bpb: number): string {
  const n = Math.max(1, bpb)
  const bar = Math.floor(x + 1e-6)
  const beat = Math.min(n - 1, Math.floor((x - bar) * n + 1e-6))
  return `${bar + 1}.${beat + 1}`
}

/** A bar length as the lane reads it : `4 bars`, `2 beats`, `1 bar 2 beats`. */
export function fmtBarsLen(len: number, bpb: number): string {
  if (Math.abs(len - Math.round(len)) < 1e-6) {
    const n = Math.round(len)
    return `${n} bar${n === 1 ? '' : 's'}`
  }
  const bars = Math.floor(len + 1e-6)
  const beats = Math.round((len - bars) * bpb * 100) / 100
  const b = `${beats} beat${beats === 1 ? '' : 's'}`
  return bars ? `${bars} bar${bars === 1 ? '' : 's'} ${b}` : b
}

/** A bar length as typed : bars.beats (`4`, `2.1` = two bars and a beat,
 *  `0.3` = three beats). */
export function fmtBarsBeats(len: number, bpb: number): string {
  const bars = Math.floor(len + 1e-6)
  const beats = Math.round((len - bars) * bpb * 100) / 100
  return beats > 1e-6 ? `${bars}.${beatNum(beats)}` : String(bars)
}

/** A bar position typed as bar.beat from 1 (`5`, `5.3`, `5.2.5`; `5:3` too),
 *  in bars from the top; null when it reads as none. Beats past the bar carry. */
export function parseBarBeat(text: string, bpb: number): number | null {
  const m = /^(\d+)(?:[.:](\d+(?:\.\d+)?))?$/.exec(text.trim().replace(/,/g, '.'))
  if (!m) return null
  const bar = Number(m[1]), beat = m[2] != null ? Number(m[2]) : 1
  if (bar < 1 || beat < 1) return null
  return bar - 1 + (beat - 1) / Math.max(1, bpb)
}

/** A bar length typed as bars.beats (`4`, `2.1`, `0.3`), or with its word
 *  (`3 beats`, `3b`, `2 bars`, `1.5 bars`); in bars, null when it reads as none. */
export function parseBarsBeats(text: string, bpb: number): number | null {
  const s = text.trim().toLowerCase().replace(/,/g, '.')
  const n = Math.max(1, bpb)
  const beats = /^(\d+(?:\.\d+)?) ?(?:b|beat|beats)$/.exec(s)
  if (beats) return Number(beats[1]) / n
  const bars = /^(\d+(?:\.\d+)?) ?(?:bar|bars)$/.exec(s)
  if (bars) return Number(bars[1])
  const m = /^(\d+)(?:[.:](\d+(?:\.\d+)?))?$/.exec(s)
  if (!m) return null
  return Number(m[1]) + (m[2] != null ? Number(m[2]) / n : 0)
}

/** A block's length the first time a rule is dropped onto the timeline : a
 *  quarter of the loop up to 4 bars, or in time an eighth of it, rounded down
 *  to a round figure (5 minutes on an hour, 30 s on five minutes). */
export function defaultBlockLen(unit: RuleUnit, length: number): number {
  if (unit === 'bars') return Math.max(1, Math.min(4, Math.floor(length / 4)))
  const nice = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900]
  let v = 1
  for (const n of nice) if (n <= length / 8) v = n
  return v
}

/** A rule's hue from its id alone (the lane colors its rows by their place in
 *  the list, so neighbors differ; this for a rule that has no place there). */
export function ruleHue(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 360
}
