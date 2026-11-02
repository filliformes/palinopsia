// The Body rule timeline's model (the Seq page's rules lane) : what it holds,
// how a stored or loaded one is checked, and the block geometry the lane and
// its clock share. No store import, so the store can use it. Runtime (the
// clock, the hand that wins) : ./ruleSeq.ts. UI : components/RuleLane.tsx.
//
// The timeline lives on this machine beside the rules it plays (the rules are
// the machine's, like the camera that fires them : store.bodyControl), each
// block naming its rule by id : renaming a rule keeps its blocks, deleting it
// takes them along.

import type { RuleBlock, RuleTimeline, SeqLaneId, SeqLanes } from '@shared/types'

export const RULE_LENGTHS = [4, 8, 16, 32, 64] as const
export const RULE_MAX_BARS = 64
/** The shortest block : a quarter of a bar (a beat in 4/4). */
export const RULE_MIN_LEN = 1 / 16
const MAX_BLOCKS = 512
const KEY = 'opsia.ruleSeq'

export const makeDefaultRuleTimeline = (): RuleTimeline => ({ length: 16, loop: true, blocks: [] })

export const SEQ_LANE_IDS: SeqLaneId[] = ['scenes', 'keys', 'rules']
export const makeDefaultSeqLanes = (): SeqLanes => ({ arm: { scenes: true, keys: true, rules: true } })

export function sanitizeSeqLanes(raw: unknown): SeqLanes {
  const d = makeDefaultSeqLanes()
  const arm = (raw as Partial<SeqLanes> | null)?.arm
  if (!arm || typeof arm !== 'object') return d
  for (const id of SEQ_LANE_IDS) if (typeof arm[id] === 'boolean') d.arm[id] = arm[id]
  return d
}

/** A bar position as kept : on a 1/48 bar grid (beats of 3, 4, 6 and 8 land
 *  exactly), so a block dragged a hundred times never drifts off its bar. */
export const q48 = (x: number): number => Math.round(x * 48) / 48

let blockSeq = 0
export const newBlockId = (): string => `b${Date.now().toString(36)}${(blockSeq++).toString(36)}`

export function sanitizeRuleTimeline(raw: unknown): RuleTimeline {
  const d = makeDefaultRuleTimeline()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<RuleTimeline>
  const length = (RULE_LENGTHS as readonly number[]).includes(Number(r.length)) ? Number(r.length) : d.length
  const seen = new Set<string>()
  const blocks: RuleBlock[] = []
  for (const b of Array.isArray(r.blocks) ? r.blocks : []) {
    if (blocks.length >= MAX_BLOCKS) break
    if (!b || typeof b !== 'object' || typeof b.rule !== 'string' || !b.rule) continue
    const start = Number(b.start), len = Number(b.len)
    if (!Number.isFinite(start) || !Number.isFinite(len)) continue
    const s = Math.max(0, Math.min(RULE_MAX_BARS - RULE_MIN_LEN, q48(start)))
    const l = Math.max(RULE_MIN_LEN, Math.min(RULE_MAX_BARS - s, q48(len)))
    let id = typeof b.id === 'string' && b.id ? b.id : newBlockId()
    if (seen.has(id)) id = newBlockId()
    seen.add(id)
    blocks.push({ id, rule: b.rule, start: s, len: l })
  }
  return { length, loop: r.loop !== false, blocks }
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

/** On inside one of these blocks at bar `x` (in the loop's own bars). */
export const insideBlocks = (bs: RuleBlock[], x: number): boolean => bs.some((b) => x >= b.start - 1e-9 && x < b.start + b.len - 1e-9)

/** A row's edges : every block's start and end, in the loop's bars. */
export function blockEdges(bs: RuleBlock[]): number[] {
  const e: number[] = []
  for (const b of bs) e.push(b.start, b.start + b.len)
  return e
}

/** An edge in the unwrapped stretch (a, b] (bars since the start; looping
 *  every `length` when `loop`). */
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
 *  block's id for the melted one. */
export function meltRow(blocks: RuleBlock[], rule: string, keep?: string): RuleBlock[] {
  const row = blocks.filter((b) => b.rule === rule).sort((a, b) => a.start - b.start || a.len - b.len)
  const rest = blocks.filter((b) => b.rule !== rule)
  const out: RuleBlock[] = []
  for (const b of row) {
    const last = out[out.length - 1]
    if (last && b.start < last.start + last.len - 1e-9) {
      const end = Math.max(last.start + last.len, b.start + b.len)
      out[out.length - 1] = { ...last, id: b.id === keep ? b.id : last.id, len: q48(end - last.start) }
    } else out.push(b)
  }
  return [...rest, ...out]
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
