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
//            brightness the mood (bright lydian … dark diminished), read
//            against the piece's own palette and light (RANGE), on the clock
//            or at each scene cut; from the pool, or from keys written for it
// The change is applied like any key change (setSonify, never in undo), with a
// glide : the engine slides its pitches to the new key (sonifyEngine.glideNext).
// A key changed by hand (or OSC, or a preset) while it runs becomes its new
// home and the walk carries on from there. In free time, EVERY can be swung by
// a modulator (the keyEvery target) and VARY draws each wait around it.

import { useStore } from '../store'
import { runSilently } from '../undo'
import { visionBus } from '../engine/visionIn'
import { registerKeyEveryBase, sonifyModValues } from '../engine/modulation'
import { sameNotes, sonifyEngine, type SoniConfig } from './sonify'
import { rateBeats, soniBar, soniClockEpoch, soniClockStart } from './soniClock'
import { advanceDrift } from './soniSeq'
import {
  BRIGHT, DIATONIC, affinity, diatonicRing, fifthsPos, isScale, keyId, mod12, rootAtFifths, sameKey, euclidHit,
  everyToPos, posToEvery, varyFactor, type Key
} from './soniKeyModel'
import type { SoniKeySeq, SoniKeyStep } from '@shared/types'
import type { SoniScale } from './sonify'

const rt = {
  started: false,
  waiting: false, // a beat start waits for the bar (the other sequencer runs)
  startBeat: 0,
  nextBeat: 0,
  nextMs: 0,
  periodBeats: 0, // the tick period last used (a rate change re-aligns)
  epoch: -1, // the beat clock's count it is aligned on (soniClockEpoch)
  periodMs: 0,
  jit: 1, // VARY : this wait's factor on EVERY
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

// A modulator on EVERY swings it around the slider's place (the mod matrix reads
// that place here), along the slider's log map.
registerKeyEveryBase(() => everyToPos(useStore.getState().soniKeySeq.freeMs))
/** EVERY now (ms) : the slider's, or where a modulator has swung it. */
function everyMs(ks: SoniKeySeq): number {
  const m = sonifyModValues.get('keyEvery')
  return m !== undefined && Number.isFinite(m) ? posToEvery(m) : ks.freeMs
}

/** The first `len` written keys (List's, or Picture's own). */
export function listKeys(steps: SoniKeyStep[], len: number): Key[] {
  return steps.slice(0, Math.max(1, Math.min(8, len))).map((s) => ({ root: mod12(s.root), scale: isScale(s.scale) ? s.scale : 'minor', oct: s.oct }))
}

/** The pool's roots (all twelve if none is ticked) and its scales. */
export function pool(ks: SoniKeySeq): { roots: number[]; scales: Key['scale'][] } {
  let roots = ks.poolRoots.map((on, i) => (on ? i : -1)).filter((i) => i >= 0)
  if (!roots.length) roots = Array.from({ length: 12 }, (_, i) => i)
  let scales = ks.poolScales.filter(isScale)
  if (!scales.length) scales = ['major', 'minor']
  // one name per set of notes (major and ionian, minor and aeolian) : a change
  // to the same notes under another name is no change
  scales = scales.filter((s, i) => scales.findIndex((t) => sameNotes(s, t)) === i)
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
  const scale = scales.includes(cur.scale) ? cur.scale : scales.find((t) => sameNotes(t, cur.scale)) ?? scales[0]
  // The relative major / minor : the same notes, the other tonic (ionian and
  // aeolian too, by their notes).
  const isMaj = sameNotes(scale, 'major'), isMin = sameNotes(scale, 'minor')
  if ((isMaj || isMin) && Math.random() < ks.circRel) {
    const other = scales.find((t) => sameNotes(t, isMaj ? 'minor' : 'major'))
    const r = mod12(cur.root + (isMaj ? 9 : 3))
    if (other && roots.includes(r)) return { root: r, scale: other, oct: cur.oct }
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
        if (sameKey(k, cur) || (root === cur.root && sameNotes(scale, cur.scale))) continue
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
  const dia = DIATONIC.find(([s]) => sameNotes(s, cur.scale))
  if (ks.pivKind === 'modes' && dia) {
    // The same seven notes from another of their degrees : C major → D dorian →
    // E phrygian → F lydian → G mixolydian → A minor → B locrian.
    const parent = mod12(cur.root - dia[1])
    const ring = diatonicRing(cur.scale, scales).filter(([s, off]) => s === cur.scale || roots.includes(mod12(parent + off)))
    if (ring.length < 2) return null
    const i = ring.findIndex(([s]) => s === cur.scale)
    const [s, off] = ring[step(ring.length, i)]
    return { root: mod12(parent + off), scale: s, oct: cur.oct }
  }
  // The same tonic in the next mode by brightness (up = brighter).
  const order = BRIGHT.filter((s) => s === cur.scale || (scales.includes(s) && !sameNotes(s, cur.scale)))
  if (order.length < 2) return null
  const i = order.indexOf(cur.scale)
  const j = ks.pivDir === 'up' ? (i - 1 + order.length) % order.length : ks.pivDir === 'down' ? (i + 1) % order.length : step(order.length, i)
  return { root: cur.root, scale: order[j], oct: cur.oct }
}

// ── Picture : the piece's own range ───────────────────────────────────────
// A frame's overall color hardly moves : it is the footage's cast, not what
// happens in it (measured : 2 to 30° of drift over 12 s on every look tried,
// and a Collage of one clip 2° in 20 s, whether the color is read as the
// mean, the most present hue, the hue that stands out or the hue of what
// moves). Read on the plain wheel, a piece sat on one or two roots (a warm one
// on C, G and D) and flickered between neighbours. So the picture is read
// against its own palette : a slow memory (PIC_SLOW) of its color (where it
// sits on the wheel and how far it spreads) and of its light, and where the
// picture is within them is spread over every root and every mood (RANGE 1;
// 0 = the wheel and the light as they are). A still picture stays put, a
// shift of color walks the circle, a new palette makes a big move and then
// settles as the memory catches up.
const TAU = Math.PI * 2
const PIC_FAST = 0.6 // s : the reading's own smoothing
const PIC_SLOW = 40 // s : the palette's memory
const PIC_MIN_SPREAD = 12 / 360 // turns : a still picture's jitter is never stretched past this
const pic = { at: 0, hx: 1, hy: 0, b: 0, px: 0, py: 0, pw: 0, pb: 0, pb2: 0, sat: 0, init: false, seen: -1 }

function updatePicture(now: number): void {
  // only a frame really read : when nobody samples the picture (the sequencer
  // off, the page closed) the last one stays put, and was learned over and over
  if (!visionBus.hasData()) return
  const seen = visionBus.ingests()
  if (seen === pic.seen) return
  pic.seen = seen
  const dt = pic.at ? Math.min(0.5, Math.max(0, (now - pic.at) / 1000)) : 0
  pic.at = now
  const sat = visionBus.feature('saturation'), h = visionBus.feature('hue') * TAU, bri = visionBus.feature('brightness')
  const cx = Math.cos(h), cy = Math.sin(h)
  // a grey picture carries no color : it moves neither the hue nor the palette
  const w = Math.min(1, sat / 0.25)
  if (!pic.init) {
    Object.assign(pic, { hx: cx, hy: cy, b: bri, px: cx * w, py: cy * w, pw: w, pb: bri, pb2: bri * bri, sat, init: true })
    return
  }
  const kf = 1 - Math.exp(-dt / PIC_FAST), kl = 1 - Math.exp(-dt / PIC_SLOW)
  pic.hx += (cx - pic.hx) * kf * w; pic.hy += (cy - pic.hy) * kf * w
  pic.b += (bri - pic.b) * kf
  pic.sat += (sat - pic.sat) * kf
  pic.px += (cx * w - pic.px) * kl; pic.py += (cy * w - pic.py) * kl; pic.pw += (w - pic.pw) * kl
  pic.pb += (bri - pic.pb) * kl; pic.pb2 += (bri * bri - pic.pb2) * kl
}

export interface PictureView {
  hue: number // 0..1 : the picture's color (smoothed)
  bri: number // 0..1 : its light (smoothed)
  sat: number
  mu: number // 0..1 : the palette's centre on the wheel
  spread: number // turns : the palette's reach either side (two deviations)
  effHue: number // where the key reads the color (RANGE applied)
  effBri: number // where the mood reads the light
}

/** The picture as Picture reads it, at a RANGE (0..1). */
export function pictureView(range: number): PictureView {
  const r = Math.max(0, Math.min(1, range))
  const hue = ((Math.atan2(pic.hy, pic.hx) / TAU) + 1) % 1
  const R = pic.pw > 1e-6 ? Math.min(1, Math.hypot(pic.px, pic.py) / pic.pw) : 1
  const mu = pic.pw > 1e-6 && R > 1e-6 ? ((Math.atan2(pic.py, pic.px) / TAU) + 1) % 1 : hue
  const sd = Math.max(PIC_MIN_SPREAD, Math.sqrt(-2 * Math.log(Math.max(1e-6, R))) / TAU)
  // the color : its distance from the palette's centre, stretched so the
  // palette's reach (two deviations) fills the half circle (never squeezed)
  let d = hue - mu
  d -= Math.round(d)
  const g = Math.max(1, 0.5 / (2 * sd))
  const ds = Math.max(-0.5, Math.min(0.5, d * g))
  const effHue = (((mu + d + r * (ds - d)) % 1) + 1) % 1
  // the light : its distance from the piece's usual light, in its own deviations
  const bsd = Math.max(0.04, Math.sqrt(Math.max(0, pic.pb2 - pic.pb * pic.pb)))
  const zb = Math.max(-1, Math.min(1, (pic.b - pic.pb) / (2 * bsd)))
  const effBri = pic.b + r * (0.5 + 0.5 * zb - pic.b)
  return { hue, bri: pic.b, sat: pic.sat, mu, spread: Math.min(0.5, 2 * sd), effHue, effBri }
}

/** The key the picture asks for : its color around the circle of fifths (a
 *  grey picture keeps the root), its light for the mood, both read against the
 *  piece's own (pictureView). A key only changes once the reading is clearly
 *  past the middle between two (no flicker on a border). */
export function pictureKey(ks: SoniKeySeq, cur: Key): Key | null {
  if (!visionBus.hasData() || !pic.init) return null
  const v = pictureView(ks.picRange ?? 1)
  if (ks.picKeys === 'list') return pictureListKey(ks, cur, v)
  const { roots, scales } = pool(ks)
  let root = cur.root
  if (v.sat > 0.08) {
    const pos = v.effHue * 12
    const dist = (r: number): number => { const d0 = Math.abs(fifthsPos(r) - pos) % 12; return Math.min(d0, 12 - d0) }
    let best = roots[0], bestD = 99
    for (const r of roots) { const d = dist(r); if (d < bestD) { bestD = d; best = r } }
    root = roots.includes(cur.root) && dist(cur.root) < bestD + 0.4 ? cur.root : best
  }
  const moods = BRIGHT.filter((s) => s !== 'chromatic' && scales.includes(s))
  let scale = cur.scale
  if (moods.length) {
    const x = (1 - v.effBri) * moods.length
    const ic = moods.indexOf(cur.scale)
    scale = ic >= 0 && x > ic - 0.3 && x < ic + 1.3 ? cur.scale : moods[Math.max(0, Math.min(moods.length - 1, Math.floor(x)))]
  }
  return { root, scale, oct: cur.oct }
}

/** Picture's own keys, the moods among them from bright to dark (chromatic has
 *  none), and where each mood sits on the light : spread evenly over it, like
 *  the pool's moods. */
export function pictureList(ks: SoniKeySeq): { keys: Key[]; moods: SoniScale[]; light: (s: SoniScale) => number } {
  const keys = listKeys(ks.picSteps, ks.picLen)
  const moods = BRIGHT.filter((s) => s !== 'chromatic' && keys.some((k) => k.scale === s))
  const light = (s: SoniScale): number => {
    const i = moods.indexOf(s)
    return i < 0 ? 0.5 : 1 - (i + 0.5) / moods.length
  }
  return { keys, moods, light }
}

/** Picture from written keys (KEYS list) : only the keys written, each one where
 *  its root sits on the circle of fifths (the color) and where its scale sits
 *  among the list's moods (the light); the reading picks the nearest. A grey
 *  picture keeps the root where the list allows, and the key it is on stays
 *  until another is clearly nearer (no flicker between two). */
function pictureListKey(ks: SoniKeySeq, cur: Key, v: PictureView): Key | null {
  const { keys, light } = pictureList(ks)
  if (!keys.length) return null
  const colored = v.sat > 0.08
  const dist = (k: Key): number => {
    let dh: number
    if (colored) {
      let x = fifthsPos(k.root) / 12 - v.effHue
      x -= Math.round(x)
      dh = Math.abs(x) * 2 // 0 (its color) .. 1 (the far side of the wheel)
    } else dh = k.root === cur.root ? 0 : 0.5
    return Math.hypot(dh, light(k.scale) - v.effBri)
  }
  let best = keys[0], bestD = Infinity
  for (const k of keys) {
    const d = dist(k)
    if (d < bestD) { bestD = d; best = k }
  }
  const here = keys.find((k) => k.root === cur.root && k.scale === cur.scale)
  return here && dist(here) < bestD + 0.08 ? here : best
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
  rt.epoch = soniClockEpoch()
  rt.waiting = ks.rate !== 'free'
  if (rt.waiting) {
    const sq = useStore.getState().soniSeq
    rt.startBeat = soniClockStart(sq.on && (sq.rate ?? 'free') !== 'free')
  } else {
    rt.jit = varyFactor(ks.freeVary)
    rt.periodMs = everyMs(ks) * rt.jit
    rt.nextMs = now + rt.periodMs
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
    const want = everyMs(ks) * rt.jit
    if (rt.periodMs !== want) {
      // a new period (the slider, a modulator) stretches the wait running, from
      // the last change; from a beat rate, it starts now
      rt.nextMs = rt.periodMs ? rt.nextMs - rt.periodMs + want : now + want
      rt.periodMs = want
    }
    if (now < rt.nextMs) return false
    // the next wait draws its own length (VARY)
    rt.jit = varyFactor(ks.freeVary)
    const next = everyMs(ks) * rt.jit
    rt.nextMs = now - rt.nextMs > next * 2 ? now + next : rt.nextMs + next
    rt.periodMs = next
    return true
  }
  rt.periodMs = 0
  const rb = rateBeats(ks.rate)
  if (rt.epoch !== soniClockEpoch()) {
    // The beat clock was counted afresh (Ableton Link came on or off, its bar
    // changed size) : a start still waiting waits for the next of its bars, a
    // running clock re-aligns on them (as for a new rate, just below).
    rt.epoch = soniClockEpoch()
    if (rt.waiting) rt.startBeat = Math.ceil(beats / soniBar() - 1e-6) * soniBar()
    else rt.periodBeats = 0
  }
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
  // Picture's memory of the piece keeps learning while it is read (the
  // sequencer playing, or its visual on screen)
  if (ks.mode === 'picture') updatePicture(now)
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
    if (ks.mode === 'picture' && ks.picKeys === 'list') {
      // Picture on its own keys : any other one of them
      const others = pictureList(ks).keys.filter((k) => !sameKey(k, cur))
      next = others.length ? pick(others) : null
    } else {
      const { roots, scales } = pool(ks)
      next = { root: pick(roots), scale: pick(scales), oct: cur.oct }
      if (sameKey(next, cur)) next = nextAffinity({ ...ks, affSmooth: 0 }, cur)
    }
  } else next = choose(ks, cur)
  if (next && !sameKey(next, cur)) apply(next, ks.glide)
}

/** What the walk remembers (the visual's trail and the keys it rules out). */
export function keySeqMemory(): { recent: string[]; visited: ReadonlySet<string>; started: boolean } {
  return { recent: rt.recent, visited: rt.visited, started: rt.started }
}

/** The wait running now in free time (ms : EVERY as modulated, times VARY's
 *  draw), or 0 when the clock is not on free time. */
export function keySeqWaitMs(): number {
  const ks = useStore.getState().soniKeySeq
  return ks.on && rt.started && ks.rate === 'free' ? rt.periodMs : 0
}

/** The page's readout : where the clock stands toward the next change (0..1),
 *  or −1 when it doesn't run on a clock (stopped, or Picture on cuts). */
export function keySeqPhase(now: number, beats: number): number {
  const ks = useStore.getState().soniKeySeq
  if (!ks.on || !rt.started || (ks.mode === 'picture' && ks.picSource === 'cuts')) return -1
  if (ks.rate === 'free') return Math.max(0, Math.min(1, 1 - (rt.nextMs - now) / Math.max(1, rt.periodMs || ks.freeMs)))
  if (rt.waiting) return 0
  const rb = rateBeats(ks.rate)
  return Math.max(0, Math.min(1, 1 - (rt.nextBeat - beats) / rb))
}
