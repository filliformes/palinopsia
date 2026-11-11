// The Body rule timeline, running (the Seq page's rules lane), and the Seq
// page's one transport over its lanes.
//
// The timeline counts in BARS of the shared beat clock (audio/soniClock.ts :
// the composition's BPM, or Ableton Link's beats and bar while Link is on), so
// it keeps the tempo and stays in phase with the Sonify sequencers; or, its
// clock switched to TIME, in real seconds from the moment it starts (at once,
// never waiting for a bar; the tempo and Link never move it). While it runs, a
// rule with a row is ON inside its blocks and OFF outside them; a rule without
// blocks is left alone. Stopped, it drives nothing (the rules keep the state
// they are in).
//
// Your hand wins : a rule switched by anything else while the timeline runs (a
// MIDI note or CC, OSC, an action, its box on the Body page, its dot here)
// keeps what you set until the next block edge on its row, then the timeline
// takes it back. Every switch goes through the store's setBodyRuleActive, the
// timeline's own tagged 'seq'; a hand is a change since the last frame from
// any other source (bodyRuleLastChange), or a rule found in another state than
// the timeline last set it to (a write that took another road). A switch that
// changes nothing needs no hold (until the next edge, the timeline wants the
// same).
//
// Ticked once a frame from App's loop, after the Sonify sequencers. Model and
// storage : ./ruleSeqModel.ts.

import { useSyncExternalStore } from 'react'
import { bodyRuleLastChange, useStore } from '../store'
import { runSilently } from '../undo'
import type { RuleUnit } from '@shared/types'
import { soniBar, soniBeats, soniClockAlsoOnBeat, soniClockEpoch, soniClockStart } from '../audio/soniClock'
import { blockEdges, edgeCrossed, insideBlocks, playedBlocks, ruleUnit, saveRuleTimeline } from './ruleSeqModel'

/** The one door the timeline drives a rule through : the rule on / off action,
 *  tagged as the timeline's own. */
function setRuleActive(id: string, on: boolean): void {
  useStore.getState().setBodyRuleActive(id, on, 'seq')
}

/** A rule switched by hand from the Seq page (its row's dot) : like its box on
 *  the Body page, a hand that wins until the next edge on its row. */
export function setRuleByHand(id: string, on: boolean): void {
  useStore.getState().setBodyRuleActive(id, on, 'ui')
}

const rt = {
  started: false,
  /** the clock the run counts on (the timeline's unit) : every position below
   *  is in it, bars or seconds */
  unit: 'bars' as RuleUnit,
  /** bars : the clock's beat the run's bar 1 starts on */
  startBeat: 0,
  /** time : when the run's 0:00 was (performance.now()) */
  startAt: 0,
  epoch: 0,
  /** since bar 1 / 0:00 at the last frame (unwrapped; -1 before the first) */
  last: -1,
  /** where this pass through the loop began (since bar 1 / 0:00) : with the
   *  loop off, the run ends at the end of the pass it is in */
  passStart: 0,
  /** where the playhead is, in the loop's bars or seconds */
  pos: 0,
  waiting: false,
  /** what the timeline last set each rule with a row to */
  applied: new Map<string, boolean>(),
  /** when the last frame looked (performance.now()) : a hand's switch after it is new */
  lookedAt: 0,
  /** the rules your hand holds until their next edge */
  held: new Set<string>()
}

// While it plays in bars, a sequencer starting on the beat keeps to its bars
// (in time it has no bars : the beat clock is free to start a new count).
soniClockAlsoOnBeat(() => rt.started && rt.unit === 'bars')

// ── the held mark (rare changes : the rows re-render on them, never per frame)
let heldSnap: ReadonlySet<string> = new Set()
const heldListeners = new Set<() => void>()
function emitHeld(): void {
  heldSnap = new Set(rt.held)
  for (const fn of heldListeners) fn()
}
export function useRuleSeqHeld(): ReadonlySet<string> {
  return useSyncExternalStore(
    (fn) => {
      heldListeners.add(fn)
      return () => { heldListeners.delete(fn) }
    },
    () => heldSnap
  )
}

/** The playhead as the lane draws it (read from its own frames), in `unit`. */
export function ruleSeqPlayhead(): { pos: number; started: boolean; waiting: boolean; unit: RuleUnit } {
  return { pos: rt.pos, started: rt.started, waiting: rt.waiting, unit: rt.unit }
}

/** The sequencers on the beat besides this one (they keep a start in phase). */
function othersOnBeat(): boolean {
  const st = useStore.getState()
  const ks = st.soniKeySeq, sq = st.soniSeq
  return (ks.on && ks.rate !== 'free') || (sq.on && (sq.rate ?? 'free') !== 'free')
}

function begin(unit: RuleUnit, now: number): void {
  rt.unit = unit
  if (unit === 'time') {
    // real seconds : from now, whatever the beat clock does
    rt.startAt = now
  } else {
    // (asked before it counts itself as playing : else it waited a bar for itself)
    rt.startBeat = soniClockStart(othersOnBeat())
    rt.epoch = soniClockEpoch()
  }
  rt.started = true
  rt.last = -1
  rt.passStart = 0
  rt.pos = 0
  rt.applied.clear()
  const hadHeld = rt.held.size > 0
  rt.held.clear()
  if (hadHeld) emitHeld()
}

/** The clock switched while it runs (the lane converts the blocks at the
 *  tempo, bars x beats a bar x 60 / BPM seconds) : the run keeps its place in
 *  time, counted on the new clock from here. */
function recount(unit: RuleUnit, now: number, bpm: number): void {
  const secPerBar = (soniBar() * 60) / (Number.isFinite(bpm) && bpm > 0 ? bpm : 120)
  const f = unit === 'time' ? secPerBar : 1 / secPerBar
  const at = Math.max(0, rt.last) * f
  rt.unit = unit
  rt.passStart *= f
  if (rt.last >= 0) rt.last = at
  if (unit === 'time') rt.startAt = now - at * 1000
  else {
    rt.startBeat = soniBeats() - at * soniBar()
    rt.epoch = soniClockEpoch()
  }
}

function halt(): void {
  rt.started = false
  rt.waiting = false
  rt.applied.clear()
  if (rt.held.size) {
    rt.held.clear()
    emitHeld()
  }
}

/** Once a frame from App's loop (after soniClockTick). */
export function tickRuleSeq(now = performance.now()): void {
  const st = useStore.getState()
  if (!st.ruleSeqOn) {
    if (rt.started) halt()
    return
  }
  const t = st.ruleSeq
  const unit = ruleUnit(t)
  if (!rt.started) begin(unit, now)
  else if (rt.unit !== unit) recount(unit, now, st.composition.bpm)
  const L = Math.max(1, t.length)
  let p0: number
  if (unit === 'time') {
    // the wall clock : a stalled window catches up (an installation's timeline
    // keeps to the minute)
    p0 = Math.max(0, (now - rt.startAt) / 1000)
    rt.waiting = false
  } else {
    const bar = soniBar()
    const beats = soniBeats()
    // re-counted onto new bars (Link on or off, its bar resized) : the run keeps
    // its place, on the new bars
    if (rt.epoch !== soniClockEpoch()) {
      rt.epoch = soniClockEpoch()
      rt.startBeat = Math.round((beats - Math.max(0, rt.last) * bar) / bar) * bar
    }
    p0 = (beats - rt.startBeat) / bar
    rt.waiting = p0 < 0
    if (rt.waiting) return // waiting for its bar (the next one, or Link's)
  }
  if (t.loop) rt.passStart = Math.floor(p0 / L) * L
  const rel = p0 - rt.passStart
  const end = !t.loop && rel >= L
  const p = end ? rt.passStart + L : p0
  const prev = rt.last < 0 ? p : rt.last
  const w = t.loop ? ((p0 % L) + L) % L : p - rt.passStart
  // an edge between the last frame and this one (on the loop's own bars)
  const crossed = (edges: number[]): boolean =>
    t.loop ? edgeCrossed(edges, prev, p, L, true) : edgeCrossed(edges, prev - rt.passStart, p - rt.passStart, L, false)
  let heldChanged = false
  const rows = new Set<string>()
  const writes: Array<[string, boolean]> = []
  for (const r of st.bodyControl.rules) {
    const bs = playedBlocks(t.blocks, r.id, L)
    if (!bs.length) continue
    rows.add(r.id)
    const want = insideBlocks(bs, w)
    const was = rt.applied.get(r.id)
    // set by another hand since the last frame : it holds
    const lc = bodyRuleLastChange(r.id)
    const fresh = was !== undefined && (r.enabled !== was || (!!lc && lc.source !== 'seq' && lc.at > rt.lookedAt))
    if (fresh && !rt.held.has(r.id)) {
      rt.held.add(r.id)
      heldChanged = true
    }
    if (rt.held.has(r.id)) {
      // until the next edge on its row (not one passed in the same frame)
      if (fresh || !crossed(blockEdges(bs))) {
        rt.applied.set(r.id, r.enabled)
        continue
      }
      rt.held.delete(r.id)
      heldChanged = true
    }
    if (r.enabled !== want) writes.push([r.id, want])
    rt.applied.set(r.id, want)
  }
  // a row gone (its blocks deleted, its rule deleted) : left alone from here on
  for (const id of [...rt.applied.keys()]) {
    if (rows.has(id)) continue
    rt.applied.delete(id)
    if (rt.held.delete(id)) heldChanged = true
  }
  rt.last = p
  rt.pos = w
  for (const [id, on] of writes) setRuleActive(id, on)
  rt.lookedAt = performance.now()
  if (heldChanged) emitHeld()
  // played once through (loop off) : it stops by itself, the rules as the end
  // left them (not a stop by hand : a linked app's play goes on)
  if (end) {
    useStore.setState({ ruleSeqOn: false })
    halt()
    rt.pos = L
  }
}

// ── The Seq transport : one play and one stop over the lanes ──────────────

/** Something the transport starts runs (the scene auto-pilot, the Sonify key
 *  sequencer, the rule timeline). */
export function seqTransportPlaying(): boolean {
  const st = useStore.getState()
  return st.ruleSeqOn || st.soniKeySeq.on || (st.sequence.enabled && st.sequence.running) || st.lightCueRun
}

/** What the transport's play would start now : the lanes it starts that have
 *  something to play. */
export function seqTransportReady(): { scenes: boolean; keys: boolean; rules: boolean; lights: boolean } {
  const st = useStore.getState()
  const a = st.seqLanes.arm
  return {
    scenes: a.scenes && st.scenes.length > 1, keys: a.keys, rules: a.rules && st.ruleSeq.blocks.length > 0,
    lights: a.lights && st.lightsSession.scenes.some((c) => (c.follow ?? 0) > 0)
  }
}

/** Play : every lane the transport starts (each on its own time : the scenes
 *  on their dwell, the keys and the rules on the beat, together on bar 1; the
 *  rules in time at once). */
export function seqTransportPlay(): void {
  const st = useStore.getState()
  const r = seqTransportReady()
  // nothing on the beat clock yet : the count starts its bar 1 now (the
  // position reads from there; with Ableton Link it is Link's count)
  if (!othersOnBeat() && !rt.started) soniClockStart(false)
  if (r.scenes && !(st.sequence.enabled && st.sequence.running)) {
    if (st.sequence.running) st.setSequence({ enabled: true })
    else st.toggleSequenceRunning()
  }
  if (r.keys && !st.soniKeySeq.on) st.setSoniKeySeqOn(true)
  if (r.rules && !st.ruleSeqOn) st.setRuleSeqOn(true)
  if (r.lights && !st.lightCueRun) st.setLightCueRun(true)
}

/** Stop : every lane, whichever started it. */
export function seqTransportStop(): void {
  const st = useStore.getState()
  if (st.sequence.running) st.toggleSequenceRunning()
  if (st.soniKeySeq.on) st.setSoniKeySeqOn(false)
  if (st.ruleSeqOn) st.setRuleSeqOn(false)
  if (st.lightCueRun) st.setLightCueRun(false)
}

export function seqTransportToggle(): void {
  if (seqTransportPlaying()) seqTransportStop()
  else seqTransportPlay()
}

/** The shared clock where it stands : bar and beat (from 1). */
export function seqClockPosition(): { bar: number; beat: number } {
  const b = Math.max(0, soniBeats())
  const q = soniBar()
  return { bar: Math.floor(b / q) + 1, beat: Math.floor(b % q) + 1 }
}

// ── kept on this machine; a rule gone takes its blocks along ───────────────
const orphans = (): boolean => {
  const st = useStore.getState()
  const ids = new Set(st.bodyControl.rules.map((r) => r.id))
  return st.ruleSeq.blocks.some((b) => !ids.has(b.rule))
}
let pruneQueued = false
function prune(): void {
  // after the change that made the orphans has finished (an undo still
  // applying its step must not have a silent change land in the middle of it)
  if (pruneQueued || !orphans()) return
  pruneQueued = true
  queueMicrotask(() => {
    pruneQueued = false
    const st = useStore.getState()
    const ids = new Set(st.bodyControl.rules.map((r) => r.id))
    const blocks = st.ruleSeq.blocks.filter((b) => ids.has(b.rule))
    if (blocks.length === st.ruleSeq.blocks.length) return
    // (nobody's edit : the rule's delete was. Never an undo step that would
    // bring back blocks of a rule that is gone)
    runSilently(() => useStore.setState({ ruleSeq: { ...st.ruleSeq, blocks } }))
  })
}

type G = { __opsiaRuleSeqOff?: () => void }
const g = globalThis as G
g.__opsiaRuleSeqOff?.()
{
  const off = useStore.subscribe((s, prev) => {
    if (s.ruleSeq !== prev.ruleSeq) saveRuleTimeline(s.ruleSeq)
    if (s.ruleSeq !== prev.ruleSeq || s.bodyControl.rules !== prev.bodyControl.rules) prune()
  })
  prune()
  g.__opsiaRuleSeqOff = off
}
