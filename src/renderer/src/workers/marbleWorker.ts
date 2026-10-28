// The Marbling water, off the main thread (engine/MarbleSource.ts draws it).
// At 90K points the currents, the spreading and the resample cost ~5 ms a frame
// (measured in node : currents 4.1 ms, step and resample 1.8 ms) : here they
// leave the compositor's own frame alone. Each tick the main thread sends the
// clock and the settings, the worker steps the water and sends back what to
// draw, already laid out for the GPU :
// - pos : every visible drop's outline (x, y), drop after drop;
// - idx : each outline's fan (0, j, j + 1), grouped so the drops in one group
//   never overlap on screen (their boxes are apart) : one stencil pass and one
//   cover per GROUP instead of per drop;
// - cov : each drop's box as two triangles (x, y, depth, palette slot, fade),
//   younger drops nearer, so the depth test paints them on top;
// - grp : per group [idx start, idx count, cover start, cover count].
// The buffers are transferred, and come back with the next tick to be reused.
//
// It also keeps the slot's hand-made log in step (MarbleSource posts the
// store's log when it changes) : appended gestures replay, an undone one rolls
// the water back to its snapshot from before it, anything else rebuilds the
// water from the log, a long replay spread over frames.

import {
  MarbleModel, HandGestures, replay, sanitizeLog, spreadSteps, rng, STEP,
  type Currents, type HandSettings, type MarbleGesture, type ModelSnapshot
} from '../engine/marbleModel'

export interface MarbleSettings {
  hw: number
  size: number
  vary: number
  crowding: number
  spreadSec: number
  count: number
  order: number
  tool: number
  combSpacing: number
  budget: number // points
  auto: number // drops a second
  sync: number // 0 free, else 1/4, 1/2, 1, 2, 4 beats
  bpm: number
  sprinkleN: number
}

export type ToWorker =
  | { t: 'tick'; dt: number; cur: Currents; s: MarbleSettings; audio: number; ret: ArrayBuffer[] }
  | { t: 'ptr'; phase: 'down' | 'move' | 'up' | 'cancel'; pid: number; x: number; y: number; shift: boolean; log: boolean; s: MarbleSettings }
  | { t: 'ev'; name: 'drop' | 'sprinkle' | 'clear'; x?: number; y?: number; size?: number; n?: number }
  | { t: 'log'; log: unknown }
  | { t: 'seed'; seed: number }

export type FromWorker =
  | {
      t: 'frame'
      pos: Float32Array
      idx: Uint32Array
      cov: Float32Array
      grp: Int32Array
      groups: number
      drops: number
      points: number
      spreading: boolean
      replaying: boolean
      changed: boolean
    }
  | { t: 'gesture'; pid: number; entry: MarbleGesture }

const BEATS = [0, 0.25, 0.5, 1, 2, 4]
const GW = 48
const GH = 27

let model = new MarbleModel(1)
let hands = new HandGestures(model)
let rand = rng(1)
let S: MarbleSettings | null = null
let colorSeq = 0
let lastCol = -1
let acc = 0
let autoAcc = 0
let beatAcc = 0
let applied: MarbleGesture[] = []
const snaps = new Map<number, ModelSnapshot>()
let replayIt: Generator<void, void, void> | null = null
let clearedAt = -1e9
// A new water with drops landing by themselves starts with a sprinkle already
// floating (a blank page read as a dead layer); with auto at 0 it stays empty,
// so a hand-made picture reopens exactly as it was.
let started = false
let changed = true
// buffers back from the main thread (all three arrays hold 4-byte numbers)
const pool: ArrayBuffer[] = []

const post = (m: FromWorker, tr?: Transferable[]): void => (self as unknown as Worker).postMessage(m, tr ?? [])

function nextColor(): number {
  const n = Math.max(1, Math.min(6, Math.round(S?.count ?? 6)))
  let c: number
  if ((S?.order ?? 0) >= 1) {
    c = Math.floor(rand() * n)
    if (c === lastCol && n > 1) c = (c + 1 + Math.floor(rand() * (n - 1))) % n
  } else c = colorSeq++ % n
  lastCol = c
  return c
}

/** A drop's radius now : the size, its spread, and the law of the bath (the
 *  more paint on the water, the smaller each new drop spreads). */
function radius(scale = 1): number {
  const s = S
  if (!s) return 0.1
  const base = 0.02 + 0.32 * s.size
  const vary = Math.exp(s.vary * 1.1 * (rand() * 2 - 1))
  const crowd = 1 / Math.sqrt(1 + s.crowding * 3 * model.fullness())
  return Math.max(0.004, Math.min(0.6, base * vary * crowd * scale))
}

function settings(): HandSettings {
  return {
    tool: S?.tool ?? 0,
    radius: () => radius(),
    color: nextColor,
    spreadSteps: spreadSteps(S?.spreadSec ?? 0.6),
    combSpacing: S?.combSpacing ?? 0.08
  }
}

function randomDrop(scale = 1): void {
  const hw = model.hw
  model.drop((rand() * 2 - 1) * hw * 0.94, (rand() * 2 - 1) * 0.47, radius(scale), nextColor(), spreadSteps(S?.spreadSec ?? 0.6))
  changed = true
}

// ── The log ─────────────────────────────────────────────────────────────

const same = (a: readonly MarbleGesture[], b: readonly MarbleGesture[]): boolean =>
  a.length === b.length && a.every((g, i) => g.id === b[i].id)

function runReplay(log: MarbleGesture[], rebase: boolean): void {
  if (!log.length) return
  hands.cancelAll()
  const it = replay(model, log, rebase)
  // chain after a replay under way
  const prev = replayIt
  replayIt = (function* () {
    if (prev) yield* prev
    yield* it
  })()
  changed = true
}

function syncLog(raw: unknown): void {
  const L = sanitizeLog(raw)
  if (same(L, applied)) { applied = L; return }
  let k = 0
  while (k < L.length && k < applied.length && L[k].id === applied[k].id) k++
  if (k === applied.length) {
    // gestures added (a redo, a pasted log, a slot opened with its log)
    const add = L.slice(k)
    applied = L
    runReplay(add, true)
    return
  }
  // the oldest left the log (its cap) : the water keeps them until the budget
  const head = L.length ? applied.findIndex((g) => g.id === L[0].id) : -1
  if (head > 0 && L.slice(0, applied.length - head).every((g, i) => g.id === applied[head + i].id)) {
    const add = L.slice(applied.length - head)
    applied = L
    if (add.length) runReplay(add, true)
    return
  }
  // emptied by a clear : the water is already dissolving
  if (!L.length && model.step - clearedAt < 30) { applied = []; return }
  // gestures undone : back to the water from before the first one, then any after
  const snap = snaps.get(applied[k].id)
  hands.cancelAll()
  if (snap && !replayIt) {
    model.restore(snap)
    applied = L
    runReplay(L.slice(k), true)
  } else {
    // a different log (a scene, a session) : the water rebuilt from it
    replayIt = null
    model.reset()
    applied = L
    runReplay(L, false)
  }
  changed = true
}

// ── The frame ───────────────────────────────────────────────────────────

function take(len: number): ArrayBuffer {
  for (let i = 0; i < pool.length; i++) if (pool[i].byteLength >= len * 4) return pool.splice(i, 1)[0]
  return new ArrayBuffer(Math.ceil(len * 1.4 + 64) * 4)
}

const occ: Uint8Array[] = []

function buildFrame(): void {
  const hw = model.hw, hh = model.hh
  const drops = model.drops
  const N = drops.length
  // visible drops, their exact boxes (the model's are kept for its own tests)
  let pts = 0, tri = 0
  const vis: number[] = []
  const box = new Float64Array(N * 4)
  for (let i = 0; i < N; i++) {
    const d = drops[i]
    const xy = d.xy
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let k = 0; k < d.n * 2; k += 2) {
      const x = xy[k], y = xy[k + 1]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    box[i * 4] = x0; box[i * 4 + 1] = y0; box[i * 4 + 2] = x1; box[i * 4 + 3] = y1
    if (x1 < -hw || x0 > hw || y1 < -hh || y0 > hh || d.n < 3) continue
    vis.push(i)
    pts += d.n
    tri += d.n - 2
  }
  // groups : drops whose boxes are apart on a coarse grid share a group
  const gOf = new Int32Array(vis.length)
  let groups = 0
  const cx = (x: number): number => Math.max(0, Math.min(GW - 1, Math.floor(((x + hw) / (2 * hw)) * GW)))
  const cy = (y: number): number => Math.max(0, Math.min(GH - 1, Math.floor(((y + hh) / (2 * hh)) * GH)))
  for (const o of occ) o.fill(0)
  vis.forEach((i, v) => {
    const a = cx(box[i * 4]), b = cy(box[i * 4 + 1]), c = cx(box[i * 4 + 2]), e = cy(box[i * 4 + 3])
    let g = 0
    for (;; g++) {
      if (g === occ.length) occ.push(new Uint8Array(GW * GH))
      const o = occ[g]
      let free = true
      for (let y = b; y <= e && free; y++) for (let x = a; x <= c; x++) if (o[y * GW + x]) { free = false; break }
      if (free) {
        for (let y = b; y <= e; y++) for (let x = a; x <= c; x++) o[y * GW + x] = 1
        break
      }
    }
    gOf[v] = g
    if (g + 1 > groups) groups = g + 1
  })
  const pos = new Float32Array(take(pts * 2), 0, pts * 2)
  const idx = new Uint32Array(take(tri * 3), 0, tri * 3)
  const cov = new Float32Array(take(vis.length * 30), 0, vis.length * 30)
  const grp = new Int32Array(take(groups * 4), 0, groups * 4)
  // outlines, in the drops' order
  const base = new Int32Array(vis.length)
  let p = 0
  vis.forEach((i, v) => {
    const d = drops[i]
    base[v] = p >> 1
    for (let k = 0; k < d.n * 2; k++) pos[p++] = d.xy[k]
  })
  // fans and covers, group by group
  const order = vis.map((_, v) => v).sort((a, b) => gOf[a] - gOf[b] || a - b)
  let ii = 0, ci = 0, gi = -1
  for (const v of order) {
    const g = gOf[v]
    if (g !== gi) {
      if (gi >= 0) { grp[gi * 4 + 1] = ii - grp[gi * 4]; grp[gi * 4 + 3] = ci / 5 - grp[gi * 4 + 2] }
      gi = g
      grp[g * 4] = ii
      grp[g * 4 + 2] = ci / 5
    }
    const i = vis[v]
    const d = drops[i]
    const o = base[v]
    for (let j = 1; j < d.n - 1; j++) { idx[ii++] = o; idx[ii++] = o + j; idx[ii++] = o + j + 1 }
    // a hair past the outline, so the cover always reaches its last sample
    const m = 1e-3
    const x0 = box[i * 4] - m, y0 = box[i * 4 + 1] - m, x1 = box[i * 4 + 2] + m, y1 = box[i * 4 + 3] + m
    const depth = 1 - (i + 1) / (N + 2)
    const slot = d.col
    const fade = Math.max(0, Math.min(1, d.fade))
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) {
      cov[ci++] = x; cov[ci++] = y; cov[ci++] = depth; cov[ci++] = slot; cov[ci++] = fade
    }
  }
  if (gi >= 0) { grp[gi * 4 + 1] = ii - grp[gi * 4]; grp[gi * 4 + 3] = ci / 5 - grp[gi * 4 + 2] }
  post(
    {
      t: 'frame', pos, idx, cov, grp, groups, drops: N, points: model.points, spreading: model.spreading(),
      replaying: !!replayIt, changed: true
    },
    [pos.buffer, idx.buffer, cov.buffer, grp.buffer]
  )
}

function idleFrame(): void {
  post({
    t: 'frame', pos: new Float32Array(0), idx: new Uint32Array(0), cov: new Float32Array(0), grp: new Int32Array(0), groups: 0,
    drops: model.drops.length, points: model.points, spreading: model.spreading(), replaying: !!replayIt, changed: false
  })
}

// ── Messages ───────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<ToWorker>): void => {
  const m = e.data
  if (m.t === 'seed') {
    model = new MarbleModel(m.seed)
    hands = new HandGestures(model)
    rand = rng(m.seed * 31 + 7)
    return
  }
  if (m.t === 'log') { syncLog(m.log); return }
  if (m.t === 'ptr') {
    // the settings ride with every pointer event : a click before the first tick still lands
    S = m.s
    model.hw = m.s.hw
    if (replayIt && m.phase === 'down') return
    const s = settings()
    if (m.phase === 'down') {
      const id = Math.floor(rand() * 2147483646) + 1
      if (m.log) {
        snaps.set(id, model.snapshot())
        // the last ten gestures can be undone back to their water
        while (snaps.size > 10) snaps.delete(snaps.keys().next().value as number)
      }
      hands.down(m.pid, m.x, m.y, s, { shift: m.shift, log: m.log, id })
    } else if (m.phase === 'move') hands.move(m.pid, m.x, m.y, s)
    else {
      const entry = hands.up(m.pid)
      if (entry) {
        applied = [...applied, entry]
        post({ t: 'gesture', pid: m.pid, entry })
      }
    }
    changed = true
    return
  }
  if (m.t === 'ev') {
    if (replayIt) return
    if (m.name === 'clear') { model.clear(); clearedAt = model.step }
    else if (m.name === 'sprinkle') { const n = Math.max(1, Math.min(200, Math.round(m.n ?? S?.sprinkleN ?? 24))); for (let i = 0; i < n; i++) randomDrop(0.6) }
    else if (m.name === 'drop') {
      if (m.x !== undefined && m.y !== undefined) {
        model.drop(m.x, m.y, radius(m.size ?? 1), nextColor(), spreadSteps(S?.spreadSec ?? 0.6))
        changed = true
      } else randomDrop(m.size ?? 1)
    }
    changed = true
    return
  }
  if (m.t === 'tick') {
    for (const b of m.ret ?? []) if (pool.length < 12 && b.byteLength) pool.push(b)
    S = m.s
    model.hw = m.s.hw
    model.budget = Math.max(5000, m.s.budget)
    const dt = Math.max(0, Math.min(0.25, m.dt))
    if (replayIt) {
      const until = performance.now() + 9
      let done = false
      while (performance.now() < until) {
        if (replayIt.next().done) { done = true; break }
      }
      if (done) replayIt = null
      buildFrame()
      return
    }
    if (!started) {
      started = true
      if (m.s.auto > 0 && !model.drops.length && !applied.length) {
        const n = Math.max(1, Math.min(64, Math.round(m.s.sprinkleN)))
        for (let i = 0; i < n; i++) randomDrop(0.7)
      }
    }
    if (m.cur.evolve > 0 && dt > 0 && model.drops.length) { model.currents(dt, m.cur); changed = true }
    // automatic drops : a rate, or the beat
    if (m.s.auto > 0 && dt > 0) {
      const beat = BEATS[Math.max(0, Math.min(5, Math.round(m.s.sync)))]
      if (beat > 0) {
        beatAcc += (dt * m.s.bpm) / 60
        let k = 0
        while (beatAcc >= beat && k++ < 4) { randomDrop(); beatAcc -= beat }
        if (beatAcc >= beat) beatAcc %= beat
      } else {
        autoAcc += dt * m.s.auto
        let k = 0
        while (autoAcc >= 1 && k++ < 4) { randomDrop(); autoAcc -= 1 }
        if (autoAcc >= 1) autoAcc %= 1
      }
    }
    // the sound : a drop on an onset (its size from the level)
    if (m.audio > 0) randomDrop(0.5 + m.audio * 1.2)
    // the fixed clock
    acc += dt
    let k = 0
    while (acc >= STEP && k++ < 8) {
      if (model.active() || hands.active()) changed = true
      model.stepOnce()
      acc -= STEP
    }
    if (acc >= STEP) acc %= STEP
    if (changed) { changed = false; buildFrame() } else idleFrame()
  }
}
