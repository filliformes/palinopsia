// The key sequencer : composes the root, scale and octave of the whole Sonify
// instrument over time (the Seq view, beside the effects sequencer). On each
// tick of its clock (beats / bars on the shared Sonify beat clock, or its own
// milliseconds), gated by an optional Euclidean rhythm and a chance, a mode
// picks the next key :
//   list     the written keys, forward / bounce (there and back) / drift
//   circle   a walk on the circle of fifths (toward sharps or flats, 1-3 fifths,
//            sometimes a hop to the relative major / minor)
//   affinity the next key by the notes it shares with this one (smooth ↔ jarring),
//            optionally touring the whole pool before anything comes back
//   pivot    the same notes on a new tonic (C major → D dorian), or the same
//            tonic in a new mode (brighter / darker)
//   picture  the picture's color picks the root around the circle and its
//            brightness the mood (bright lydian … dark phrygian), on the clock
//            or at each scene cut
// The change is applied like any key change (setSonify, never in undo), with a
// glide : the engine slides its pitches to the new key (sonifyEngine.glideNext).
// A key changed by hand (or OSC, or a preset) while it runs becomes its new
// home and the walk carries on from there.

import { useStore } from '../store'
import { runSilently } from '../undo'
import { visionBus } from '../engine/visionIn'
import { sonifyEngine, type SoniConfig } from './sonify'
import { RATE_BEATS, soniClockStart } from './soniClock'
import { advanceDrift } from './soniSeq'
import {
  BRIGHT, DIATONIC, affinity, fifthsPos, isScale, keyId, mod12, rootAtFifths, sameKey, euclidHit,
  type Key
} from './soniKeyModel'
import type { SoniKeySeq } from '@shared/types'

const rt = {
  started: false,
  waiting: false, // a beat start waits for the bar (the other sequencer runs)
  startBeat: 0,
  nextBeat: 0,
  nextMs: 0,
  periodBeats: 0, // the tick period last used (a rate change re-aligns)
  periodMs: 0,
  tick: 0, // ticks since start (the Euclidean rhythm counts them)
  cur: -1, // List : the step playing
  dir: 1, // List bounce : the direction
  last: null as Key | null, // the key this sequencer last set
  home: null as Key | null,
  recent: [] as string[], // Affinity : the last few keys
  visited: new Set<string>(), // Affinity tour
  lastChange: 0, // performance.now() of the last change (Picture's hold)
  motionAvg: 0, // Picture cuts : the picture's usual amount of change
  lastCut: 0
}

const keyOf = (c: SoniConfig): Key => ({ root: mod12(c.root), scale: c.scale, oct: c.rootOct ?? 3 })

/** The pool's roots (all twelve if none is ticked) and its scales. */
export function pool(ks: SoniKeySeq): { roots: number[]; scales: Key['scale'][] } {
  let roots = ks.poolRoots.map((on, i) => (on ? i : -1)).filter((i) => i >= 0)
  if (!roots.length) roots = Array.from({ length: 12 }, (_, i) => i)
  let scales = ks.poolScales.filter(isScale)
  if (!scales.length) scales = ['major', 'minor']
  return { roots, scales }
}

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]
}

/** Apply a key : one silent store change, the engine gliding to it. */
function apply(k: Key, glide: number): void {
  const st = useStore.getState()
  const cur = st.sonify
  rt.last = k
  rt.lastChange = performance.now()
  const id = keyId(k)
  rt.recent.push(id)
  if (rt.recent.length > 4) rt.recent.shift()
  rt.visited.add(id)
  runSilently(() => {
    sonifyEngine.glideNext(glide)
    useStore.getState().setSonify({ ...cur, root: k.root, scale: k.scale, rootOct: k.oct })
    sonifyEngine.glideNext(0)
  })
}

// ── The modes ─────────────────────────────────────────────────────────────

function nextList(ks: SoniKeySeq): Key {
  const len = Math.max(1, Math.min(8, ks.len))
  if (ks.order === 'drift') rt.cur = advanceDrift(Math.max(0, rt.cur), len, ks.bias, 'wrap')
  else if (ks.order === 'bounce' && len > 1) {
    let n = rt.cur + rt.dir
    if (n >= len || n < 0) { rt.dir = -rt.dir; n = rt.cur + rt.dir }
    rt.cur = Math.max(0, Math.min(len - 1, n))
  } else rt.cur = (rt.cur + 1) % len
  useStore.getState().setSoniKeyCur(rt.cur)
  const s = ks.steps[rt.cur]
  return { root: s.root, scale: isScale(s.scale) ? s.scale : 'minor', oct: s.oct }
}

function nextCircle(ks: SoniKeySeq, cur: Key): Key | null {
  const { roots, scales } = pool(ks)
  const scale = scales.includes(cur.scale) ? cur.scale : scales[0]
  // The relative major / minor : the same notes, the other tonic.
  if ((scale === 'major' || scale === 'minor') && Math.random() < ks.circRel) {
    const other = scale === 'major' ? 'minor' : 'major'
    const r = mod12(cur.root + (scale === 'major' ? 9 : 3))
    if (scales.includes(other) && roots.includes(r)) return { root: r, scale: other, oct: cur.oct }
  }
  const dir = Math.random() < (1 + ks.circBias) / 2 ? 1 : -1
  const leap = 1 + Math.floor(Math.random() * Math.max(1, Math.min(3, ks.circLeap)))
  let pos = fifthsPos(cur.root) + dir * leap
  // A root outside the pool : keep walking the same way to the next one in it.
  for (let i = 0; i < 12; i++, pos += dir) {
    const r = rootAtFifths(pos)
    if (roots.includes(r) && !(r === cur.root && scale === cur.scale)) return { root: r, scale, oct: cur.oct }
  }
  return scale !== cur.scale ? { root: cur.root, scale, oct: cur.oct } : null
}

/** How much a key sharing `a` (0..1) of its notes weighs at this smoothness :
 *  +100 the keys sharing the most notes all but always, −100 the fewest, 0 any
 *  key alike. (The visual draws the same law.) */
export function affinityWeight(smooth: number, a: number): number {
  return Math.exp(6 * (smooth / 100) * (a - 0.5) * 2)
}

function nextAffinity(ks: SoniKeySeq, cur: Key): Key | null {
  const { roots, scales } = pool(ks)
  const gather = (useTour: boolean, useRecent: boolean): Key[] => {
    const out: Key[] = []
    for (const root of roots) {
      for (const scale of scales) {
        const k = { root, scale, oct: cur.oct }
        const id = keyId(k)
        if (sameKey(k, cur)) continue
        if (useRecent && rt.recent.includes(id)) continue
        if (useTour && rt.visited.has(id)) continue
        out.push(k)
      }
    }
    return out
  }
  let cands = gather(ks.affTour, ks.affNoRepeat)
  if (!cands.length && ks.affTour) {
    // The tour is complete : a new one starts from here.
    rt.visited.clear()
    rt.visited.add(keyId(cur))
    cands = gather(true, ks.affNoRepeat)
  }
  if (!cands.length) cands = gather(false, false)
  if (!cands.length) return null
  const w = cands.map((c) => affinityWeight(ks.affSmooth, affinity(cur, c)))
  let r = Math.random() * w.reduce((a, b) => a + b, 0)
  for (let i = 0; i < cands.length; i++) {
    r -= w[i]
    if (r <= 0) return cands[i]
  }
  return cands[cands.length - 1]
}

function nextPivot(ks: SoniKeySeq, cur: Key): Key | null {
  const { roots, scales } = pool(ks)
  const step = (n: number, i: number): number => {
    if (ks.pivDir === 'up') return (i + 1) % n
    if (ks.pivDir === 'down') return (i - 1 + n) % n
    return (i + 1 + Math.floor(Math.random() * (n - 1))) % n
  }
  const dia = DIATONIC.find(([s]) => s === cur.scale)
  if (ks.pivKind === 'modes' && dia) {
    // The same seven notes from another of their degrees : C major → D dorian →
    // E phrygian → F lydian → A minor (the modes the instrument has).
    const parent = mod12(cur.root - dia[1])
    const ring = DIATONIC.filter(([s, off]) => s === cur.scale || (scales.includes(s) && roots.includes(mod12(parent + off))))
    if (ring.length < 2) return null
    const i = ring.findIndex(([s]) => s === cur.scale)
    const [s, off] = ring[step(ring.length, i)]
    return { root: mod12(parent + off), scale: s, oct: cur.oct }
  }
  // The same tonic in the next mode by brightness (up = brighter).
  const order = BRIGHT.filter((s) => s === cur.scale || scales.includes(s))
  if (order.length < 2) return null
  const i = order.indexOf(cur.scale)
  const j = ks.pivDir === 'up' ? (i - 1 + order.length) % order.length : ks.pivDir === 'down' ? (i + 1) % order.length : step(order.length, i)
  return { root: cur.root, scale: order[j], oct: cur.oct }
}

/** The key the picture asks for : its hue around the circle of fifths (a grey
 *  picture keeps the root), its brightness for the mood. */
export function pictureKey(ks: SoniKeySeq, cur: Key): Key | null {
  if (!visionBus.hasData()) return null
  const { roots, scales } = pool(ks)
  let root = cur.root
  if (visionBus.feature('saturation') > 0.08) {
    const pos = Math.round(visionBus.feature('hue') * 12)
    let best = roots[0], bestD = 99
    for (const r of roots) {
      const d0 = Math.abs(mod12(fifthsPos(r) - pos))
      const d = Math.min(d0, 12 - d0)
      if (d < bestD) { bestD = d; best = r }
    }
    root = best
  }
  const moods = BRIGHT.filter((s) => s !== 'chromatic' && scales.includes(s))
  const bri = visionBus.feature('brightness')
  const scale = moods.length ? moods[Math.min(moods.length - 1, Math.floor((1 - bri) * moods.length))] : cur.scale
  return { root, scale, oct: cur.oct }
}

function choose(ks: SoniKeySeq, cur: Key): Key | null {
  switch (ks.mode) {
    case 'list': return nextList(ks)
    case 'circle': return nextCircle(ks, cur)
    case 'affinity': return nextAffinity(ks, cur)
    case 'pivot': return nextPivot(ks, cur)
    case 'picture': return pictureKey(ks, cur)
  }
}

// ── The clock ─────────────────────────────────────────────────────────────

function start(ks: SoniKeySeq, cur: Key, now: number): void {
  rt.started = true
  rt.home = cur
  rt.last = cur
  rt.tick = 0
  rt.cur = -1
  rt.dir = 1
  rt.recent = [keyId(cur)]
  rt.visited = new Set([keyId(cur)])
  rt.lastChange = now
  rt.motionAvg = 0
  rt.lastCut = 0
  rt.periodBeats = 0
  rt.periodMs = 0
  rt.waiting = ks.rate !== 'free'
  if (rt.waiting) {
    const sq = useStore.getState().soniSeq
    rt.startBeat = soniClockStart(sq.on && (sq.rate ?? 'free') !== 'free')
  } else {
    rt.nextMs = now + ks.freeMs
    rt.periodMs = ks.freeMs
    if (ks.mode === 'list') apply(nextList(ks), ks.glide)
  }
}

function stop(cur: Key): void {
  rt.started = false
  useStore.getState().setSoniKeyCur(-1)
  // Back home, unless the key just changed under it (a session loaded, a key
  // set by hand) : that one stays.
  const ks = useStore.getState().soniKeySeq
  if (ks.returnHome && rt.home && sameKey(cur, rt.last) && !sameKey(cur, rt.home)) apply(rt.home, ks.glide)
}

/** Is it time for a change? Advances the clock's next tick. */
function due(ks: SoniKeySeq, now: number, beats: number): boolean {
  if (ks.rate === 'free') {
    rt.periodBeats = 0
    rt.waiting = false
    if (rt.periodMs !== ks.freeMs) {
      // a new period stretches the one running; from a beat rate, it starts now
      rt.nextMs = rt.periodMs ? rt.nextMs - rt.periodMs + ks.freeMs : now + ks.freeMs
      rt.periodMs = ks.freeMs
    }
    if (now < rt.nextMs) return false
    rt.nextMs = now - rt.nextMs > ks.freeMs * 2 ? now + ks.freeMs : rt.nextMs + ks.freeMs
    return true
  }
  rt.periodMs = 0
  const rb = RATE_BEATS[ks.rate]
  if (rt.waiting) {
    if (beats < rt.startBeat) return false
    rt.waiting = false
    rt.periodBeats = rb
    rt.nextBeat = rt.startBeat + rb
    // List plays its first step on the downbeat it starts on.
    if (ks.mode === 'list') apply(nextList(ks), ks.glide)
    return false
  }
  if (rt.periodBeats !== rb) {
    // A new rate : the next change falls on its own grid.
    rt.periodBeats = rb
    rt.nextBeat = (Math.floor(beats / rb) + 1) * rb
    return false
  }
  if (beats < rt.nextBeat) return false
  rt.nextBeat += rb
  if (rt.nextBeat <= beats) rt.nextBeat = (Math.floor(beats / rb) + 1) * rb
  return true
}

/** Picture, at each scene cut : the change of the whole picture jumps far over
 *  its usual amount. */
function cutNow(now: number): boolean {
  const m = visionBus.feature('motion')
  const cut = m > 0.12 && m > rt.motionAvg * 3 + 0.02 && now - rt.lastCut > 400
  rt.motionAvg = rt.motionAvg ? rt.motionAvg * 0.95 + m * 0.05 : m
  if (cut) rt.lastCut = now
  return cut
}

/** Once per frame from App's loop (beside the effects sequencer). */
export function tickKeySeq(now: number, beats: number): void {
  const st = useStore.getState()
  const ks = st.soniKeySeq
  const cur = keyOf(st.sonify)
  if (!ks.on) {
    if (rt.started) stop(cur)
    return
  }
  if (!rt.started) { start(ks, cur, now); return }
  // The key changed under it (by hand, OSC, a preset) : that is home now, and
  // the walk goes on from there.
  if (rt.last && !sameKey(cur, rt.last)) { rt.home = cur; rt.last = cur }
  const held = now - rt.lastChange < ks.picHold * 1000
  if (ks.mode === 'picture' && ks.picSource === 'cuts') {
    if (!cutNow(now) || held) return
  } else {
    if (!due(ks, now, beats)) return
    const k = rt.tick++
    if (ks.euclid && !euclidHit(k, ks.ePulses, ks.eSteps, ks.eRot)) return
    if (Math.random() >= ks.chance) return
    if (ks.mode === 'picture' && held) return
  }
  const next = choose(ks, cur)
  if (next && !sameKey(next, cur)) apply(next, ks.glide)
}

/** A change now, whatever the clock says (the dice, OSC /keyseq/next). With
 *  `fresh`, any key of the pool and the walk's memory cleared. */
export function keySeqNext(fresh = false): void {
  const st = useStore.getState()
  const ks = st.soniKeySeq
  const cur = keyOf(st.sonify)
  let next: Key | null
  if (fresh) {
    rt.recent = [keyId(cur)]
    rt.visited = new Set([keyId(cur)])
    const { roots, scales } = pool(ks)
    next = { root: pick(roots), scale: pick(scales), oct: cur.oct }
    if (sameKey(next, cur)) next = nextAffinity({ ...ks, affSmooth: 0 }, cur)
  } else next = choose(ks, cur)
  if (next && !sameKey(next, cur)) apply(next, ks.glide)
}

/** What the walk remembers (the visual's trail and the keys it rules out). */
export function keySeqMemory(): { recent: string[]; visited: ReadonlySet<string>; started: boolean } {
  return { recent: rt.recent, visited: rt.visited, started: rt.started }
}

/** The page's readout : where the clock stands toward the next change (0..1),
 *  or −1 when it doesn't run on a clock (stopped, or Picture on cuts). */
export function keySeqPhase(now: number, beats: number): number {
  const ks = useStore.getState().soniKeySeq
  if (!ks.on || !rt.started || (ks.mode === 'picture' && ks.picSource === 'cuts')) return -1
  if (ks.rate === 'free') return Math.max(0, Math.min(1, 1 - (rt.nextMs - now) / Math.max(1, rt.periodMs || ks.freeMs)))
  if (rt.waiting) return 0
  const rb = RATE_BEATS[ks.rate]
  return Math.max(0, Math.min(1, 1 - (rt.nextBeat - beats) / rb))
}
