// The dataflou bridge, renderer side. The node lives in main; here :
//   · values arriving on our destinations play exactly like OSC (each maps to a
//     /opsia address, routed through oscInput), once per change;
//   · our sources (audio / picture / body / modulators / Meta knobs) are read
//     like the Resolume mapper's rows and sent to main 30 times a second, but
//     only the ones some node listens to;
//   · the node's status (the monitor) is kept here, outside the store;
//   · the Body rule picker's actions, when they are on : listed for main (which
//     declares one trigger each, act/...), fired here when one goes on.

import { useSyncExternalStore } from 'react'
import { useStore } from './store'
import { routeOsc } from './oscInput'
import { readSource } from './resolume'
import { fireTrigger } from './midi'
import { triggerOptions } from './triggerCatalog'
import { DF_DESTS, DF_SOURCES, dfActionPath, type DfAction, type DfStatus, type DfValue, type DfWireOpt } from '@shared/dataflou'
import type { ModTarget } from '@shared/types'
import { oscLeafValues } from './oscInput'
import { controlBus } from './engine/controlBus'
import { isPinnedTarget } from './persist'
import { showToast } from './components/Toast'

const DEST_BY_PATH = new Map(DF_DESTS.map((d) => [d.path, d]))
const SIGNAL_BY_PATH = new Map<string, string>([
  ...DF_SOURCES.map((s) => [s.path, s.signal] as [string, string]),
  ...DF_DESTS.filter((d) => d.bidir).map((d) => [d.path, d.bidir!] as [string, string])
])

const EMPTY: DfStatus = {
  running: false, error: null, sku: '', label: '', universe: '', address: '', tcpPort: 0, udpPort: 0,
  nodes: [], listeners: {}, rxPerSec: 0, txPerSec: 0, declareBytes: 0, actions: 0, actionsDropped: 0, companion: null,
  visualizer: 0, visualizerAvailable: false
}

// ── the actions : every entry of the Body rule picker, a trigger each ──
let actionByPath = new Map<string, string>()
let actionsSent = ''

/** The picker's list as mesh paths (the rule builder's own "this rule : off"
 *  aside : it means nothing outside a rule). Two ids landing on one path keep
 *  the first. */
export function dataflouActions(): DfAction[] {
  const out: DfAction[] = []
  const seen = new Set<string>()
  for (const o of triggerOptions()) {
    const group = o.group || 'Other'
    const path = dfActionPath(o.value, group, seen)
    if (seen.has(path)) continue
    seen.add(path)
    out.push({ id: o.value, path, label: o.label.slice(0, 64), group })
  }
  return out
}

/** Hand main the list when it changed (and only while the actions are on). */
function sendActions(force = false): void {
  const cfg = useStore.getState().dataflou
  if (!cfg.enabled || !cfg.actions) {
    actionsSent = ''
    actionByPath = new Map()
    return
  }
  const list = dataflouActions()
  const sig = JSON.stringify(list)
  if (!force && sig === actionsSent) return
  actionsSent = sig
  actionByPath = new Map(list.map((a) => [a.path, a.id]))
  window.api.dataflouActions(list)
}

let status: DfStatus = EMPTY
const listeners = new Set<() => void>()
const setStatus = (s: DfStatus): void => {
  status = s
  for (const l of listeners) l()
}

/** The node's status, for the dataflou section (re-renders on each push). */
export function useDataflouStatus(): DfStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => status
  )
}

/** What last arrived on each destination (the section's activity dots read it). */
export const dfLastIn = new Map<string, { value: DfValue; at: number }>()
const lastPlayed = new Map<string, number>()

function play(path: string, value: DfValue): void {
  const n = typeof value === 'boolean' ? (value ? 1 : 0) : typeof value === 'number' ? value : Array.isArray(value) ? (value[0] ?? 0) : Number(value) || 0
  if (!Number.isFinite(n)) return
  const act = actionByPath.get(path)
  if (act) {
    // a trigger : fires once as it goes on, again only after it went off
    dfLastIn.set(path, { value: n, at: performance.now() })
    const was = lastPlayed.get(path) ?? 0
    lastPlayed.set(path, n)
    if (n >= 0.5 && was < 0.5) fireTrigger(act)
    return
  }
  const d = DEST_BY_PATH.get(path)
  if (!d) return
  const now = performance.now()
  // where the control was before a wire began to play it (a first value, or the
  // first after a quiet spell) : what a glide back on loss returns to, even when
  // that option is turned on later
  const last = dfLastIn.get(path)
  if (d.type === 'number' && (!last || now - last.at > LOSS_MS)) preOf.set(path, rawNow(d))
  dfLastIn.set(path, { value: n, at: now })
  const opt = wireOptOf(path)
  // on loss : the first value after a quiet spell remembers where the control
  // was, so the wire can give it back when its source goes quiet again
  if (opt?.onLoss === 'return' && d.type === 'number') {
    const w = wired.get(path)
    if (!w || !w.live) wired.set(path, { pre: preOf.get(path) ?? rawNow(d), live: true, at: now })
    else w.at = now
    anims.delete(path) // (a glide back stops : the source is here again)
  }
  // smoothing : the value is a target the control glides to (a slew)
  if (opt?.slewMs && d.type === 'number') {
    const a = anims.get(path)
    const from = a ? a.cur : lastPlayed.get(path) ?? rawNow(d)
    anims.set(path, { kind: 'slew', cur: from, to: n, ms: opt.slewMs, from, t0: now, osc: d.osc })
    startAnims()
    return
  }
  // Once per change : a source streams at its rate whether it moved or not, and a
  // scene or a trigger must not fire again on every packet.
  const prev = lastPlayed.get(path)
  if (prev !== undefined && Math.abs(prev - n) < 1e-6) return
  lastPlayed.set(path, n)
  routeOsc(d.osc, [{ type: 'f', value: n }])
}

// ── a wire's smoothing and its glide back (DfWireOpt, set in the connections
// list) : one animation loop, running only while something glides ──
type Anim = { kind: 'slew' | 'back'; cur: number; to: number; ms: number; from: number; t0: number; osc: string }
const anims = new Map<string, Anim>()
// destinations played by a wire whose loss glides back : where they were before
const wired = new Map<string, { pre: number; live: boolean; at: number }>()
const preOf = new Map<string, number>()
let animTimer = 0
let lastAnim = 0
const LOSS_MS = 2000 // as the data view : quiet this long, the source is gone

function wireOptOf(path: string): DfWireOpt | undefined {
  const me = status.nodes.find((x) => x.local)
  return me?.subs[path]?.find((s) => s.opt)?.opt
}

/** A destination's value now, in its own units (as the OSC tree reports it). */
function rawNow(d: (typeof DF_DESTS)[number]): number {
  const v = oscLeafValues().get(d.osc)
  const lo = d.min ?? 0, hi = d.max ?? 1
  return v === undefined ? (d.init ?? lo) : lo + v * (hi - lo)
}

function startAnims(): void {
  if (animTimer) return
  lastAnim = performance.now()
  animTimer = window.setInterval(stepAnims, 16)
}

function stepAnims(): void {
  const now = performance.now()
  const dt = now - lastAnim
  lastAnim = now
  for (const [path, a] of anims) {
    let next: number
    if (a.kind === 'slew') {
      // one pole : about there after `ms`
      const k = 1 - Math.exp(-dt / Math.max(1, a.ms / 4))
      next = a.cur + (a.to - a.cur) * k
      if (Math.abs(a.to - next) < 1e-4 * (Math.abs(a.to) + 1)) next = a.to
    } else {
      const u = Math.min(1, (now - a.t0) / Math.max(1, a.ms))
      const e = u * u * (3 - 2 * u)
      next = a.from + (a.to - a.from) * e
    }
    a.cur = next
    lastPlayed.set(path, next)
    routeOsc(a.osc, [{ type: 'f', value: next }])
    if (next === a.to) anims.delete(path)
  }
  if (!anims.size && !wired.size) {
    window.clearInterval(animTimer)
    animTimer = 0
  }
}

// a wire gone quiet : its destination glides back where it was before
window.setInterval(() => {
  if (!wired.size) return
  const now = performance.now()
  for (const [path, w] of wired) {
    const opt = wireOptOf(path)
    if (opt?.onLoss !== 'return') {
      wired.delete(path)
      continue
    }
    if (!w.live || now - w.at < LOSS_MS) continue
    w.live = false
    const d = DEST_BY_PATH.get(path)
    if (!d) continue
    const cur = anims.get(path)?.cur ?? lastPlayed.get(path) ?? rawNow(d)
    anims.set(path, { kind: 'back', cur, to: w.pre, ms: (opt.returnSec ?? 2) * 1000, from: cur, t0: now, osc: d.osc })
    startAnims()
  }
}, 250)

// ── a modulator played by a mesh value (its Controller input) ──
const meshKey = (sku: string, path: string): string => `${sku}\n${path}`
let meshSlots = new Map<string, number[]>()
let listensSent = ''
function syncListens(): void {
  const mods = useStore.getState().composition.modulators
  const next = new Map<string, number[]>()
  const list: Array<{ sku: string; path: string }> = []
  mods.forEach((m, i) => {
    if (m.type !== 'controller' || !m.mesh) return
    const k = meshKey(m.mesh.sku, m.mesh.path)
    if (!next.has(k)) {
      next.set(k, [])
      list.push({ sku: m.mesh.sku, path: m.mesh.path })
    }
    next.get(k)!.push(i)
  })
  meshSlots = next
  const j = JSON.stringify(list)
  if (j !== listensSent && status.running) {
    listensSent = j
    window.api.dataflouListen(list)
  }
}

/** A short name for a mesh value : its group and its own name ("glove-l pitch"). */
export function meshName(path: string, label?: string): string {
  const segs = path.split('/')
  const leaf = label || segs[segs.length - 1]
  return (segs.length > 1 ? `${segs[segs.length - 2]} ${leaf}` : leaf).slice(0, 20)
}

/** The first Macro knob nobody uses : no destination, no wire into it, no
 *  modulator on it, not persistent (-1 : all 16 are taken). */
export function freeMacroKnob(): number {
  const s = useStore.getState()
  const me = status.nodes.find((x) => x.local)
  return s.composition.metaKnobs.findIndex(
    (k, i) =>
      k.destinations.length === 0 &&
      !(me?.subs[`meta/${i + 1}`]?.length) &&
      !s.composition.modMatrix.some((a) => a.target.kind === 'meta' && a.target.knob === i) &&
      !isPinnedTarget({ kind: 'meta', knob: i }, s.pins)
  )
}

/** Wire a mesh value to a free Macro knob, named after it; `dest` : a control
 *  for the knob to drive (learn). The Macro row shows, so its capsules do. */
export async function wireToFreeMacro(src: { sku: string; path: string; label?: string }, dest?: ModTarget): Promise<number> {
  const k = freeMacroKnob()
  const name = meshName(src.path, src.label)
  if (k < 0) {
    showToast('All 16 Macro knobs are in use : free one (no destination) first', 'warn')
    return -1
  }
  const ok = await dataflouBind(status.sku, `meta/${k + 1}`, src.sku, src.path, true)
  if (!ok) {
    showToast('That node is not reachable now', 'warn')
    return -1
  }
  const st = useStore.getState()
  st.updateMetaKnob(k, { name })
  if (dest) st.toggleMetaDest(k, dest)
  st.setMacroBar(true)
  showToast(dest ? `${name} plays this control through Macro ${k + 1} (its range and curve shape it)` : `${name} is on Macro ${k + 1} : give it controls with their M (or learn from the mesh)`)
  return k
}

/** The first modulator nobody uses : no binding, not a mesh input already,
 *  not persistent; one already a Controller with nothing on its input first. */
export function freeModSlot(): number {
  const s = useStore.getState()
  const used = new Set(s.composition.modMatrix.map((a) => a.mod))
  const free = s.composition.modulators
    .map((m, i) => ({ m, i }))
    .filter(({ m, i }) => !used.has(i) && !m.mesh && !s.pins.includes(`mod:${i}`))
  const ctl = free.find(({ m }) => m.type === 'controller')
  return (ctl ?? free[0])?.i ?? -1
}

/** A mesh value as a modulator : a free slot becomes a Controller played by it. */
export function meshToModulator(src: { sku: string; path: string; label?: string }, slot = freeModSlot()): number {
  const name = meshName(src.path, src.label)
  if (slot < 0) {
    showToast('All 8 modulators are in use : free one (no binding) first', 'warn')
    return -1
  }
  useStore.getState().updateModulator(slot, { type: 'controller', enabled: true, mesh: { sku: src.sku, path: src.path, label: name } })
  showToast(`${name} plays modulator ${slot + 1} : bind it to any control with its M`)
  return slot
}

// ── learn from the mesh : every remote value streams for a moment; the one that
// moves the most (a quarter of its range at least) is the answer ──
let learnOn: (() => void) | null = null
const learnListeners = new Set<() => void>()
let learnWhat = '' // which control is learning (its key), '' : none
export function meshLearning(): string {
  return learnWhat
}
export function useMeshLearning(): string {
  return useSyncExternalStore(
    (cb) => {
      learnListeners.add(cb)
      return () => learnListeners.delete(cb)
    },
    () => learnWhat
  )
}
const setLearn = (w: string): void => {
  learnWhat = w
  learnListeners.forEach((l) => l())
}

/** Listen for the mesh value that moves (`who` : the control asking, for its
 *  button's state). Again on the same control, or another learn : stops. */
export async function learnFromMesh(who: string): Promise<{ sku: string; path: string; label: string; node: string } | null> {
  if (learnOn) {
    const same = learnWhat === who
    learnOn()
    if (same) return null
  }
  if (!status.running) {
    showToast('Join the dataflou mesh first (Connect tab)', 'warn')
    return null
  }
  setLearn(who)
  await window.api.dataflouLearn('start')
  return new Promise((resolve) => {
    let done = false
    const t0 = performance.now()
    const finish = (r: { sku: string; path: string; label: string; node: string } | null): void => {
      if (done) return
      done = true
      window.clearInterval(iv)
      learnOn = null
      setLearn('')
      void window.api.dataflouLearn('stop')
      resolve(r)
    }
    learnOn = () => finish(null)
    const iv = window.setInterval(() => {
      if (performance.now() - t0 > 20_000) {
        showToast('Nothing moved on the mesh : learn stopped', 'warn')
        finish(null)
        return
      }
      void window.api.dataflouLearn('peek').then((r) => {
        if (r) finish(r)
      })
    }, 150)
  })
}

// ── watched outside values (◉ in the node list) : kept on this computer, per
// universe, sent to main whenever they change and when the node starts ──
type Watch = { sku: string; path: string }
const WATCH_KEY = 'opsia.dfWatch'
let watchAll: Record<string, Watch[]> = (() => {
  try {
    const j = JSON.parse(localStorage.getItem(WATCH_KEY) ?? '{}') as Record<string, Watch[]>
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
})()
const watchListeners = new Set<() => void>()
let watchVersion = 0
const universeNow = (): string => useStore.getState().dataflou.universe || 'default'
export function dfWatches(): Watch[] {
  return watchAll[universeNow()] ?? []
}
function sendWatches(): void {
  window.api.dataflouWatch(dfWatches())
}
/** Watch (or stop watching) another node's value in the data view. */
export function toggleDfWatch(sku: string, path: string): void {
  const u = universeNow()
  const list = watchAll[u] ?? []
  const i = list.findIndex((w) => w.sku === sku && w.path === path)
  watchAll = { ...watchAll, [u]: i >= 0 ? list.filter((_, j) => j !== i) : [...list, { sku, path }].slice(-64) }
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify(watchAll))
  } catch {
    /* storage blocked : this session only */
  }
  watchVersion++
  watchListeners.forEach((l) => l())
  sendWatches()
}
export function useDfWatches(): Watch[] {
  useSyncExternalStore(
    (cb) => {
      watchListeners.add(cb)
      return () => watchListeners.delete(cb)
    },
    () => watchVersion
  )
  return dfWatches()
}

/** Turn the node on or off (or rename it, or move it to another universe). */
export async function applyDataflou(): Promise<void> {
  const cfg = useStore.getState().dataflou
  // the actions first, so a node that starts with them declares them at once
  sendActions(true)
  try {
    setStatus(await window.api.dataflouConfigure(cfg))
    sendWatches() // (the node may be new : its universe's list)
    listensSent = ''
    syncListens()
  } catch (e) {
    setStatus({ ...EMPTY, error: (e as Error).message })
  }
  lastPlayed.clear()
}

/** Does someone listen to our picture features? (keeps the vision readback on) */
export function dataflouWantsVision(): boolean {
  if (!status.running) return false
  for (const k of Object.keys(status.listeners)) if (k.startsWith('vision/')) return true
  return false
}

/** Mount once (App) : status + values in, the source sampler out. */
export function initDataflou(): () => void {
  const offStatus = window.api.onDataflouStatus((s) => setStatus(s))
  const offIn = window.api.onDataflouIn((batch) => {
    for (const v of batch) play(v.path, v.value)
  })
  // the modulators played by a mesh value
  const offRemote = window.api.onDataflouRemote((batch) => {
    for (const b of batch) for (const slot of meshSlots.get(meshKey(b.sku, b.path)) ?? []) controlBus.set(`in:${slot}`, b.v)
  })
  syncListens()
  let modsWas = useStore.getState().composition.modulators
  const offMods = useStore.subscribe((s) => {
    if (s.composition.modulators === modsWas) return
    modsWas = s.composition.modulators
    syncListens()
  })
  // the mesh visualizer's universe selector : the setting changes here (kept on
  // this computer, shown in the Connect tab) and the node starts again there
  const offUni = window.api.onDataflouUniverse((name) => {
    if (typeof name !== 'string' || !name || name === useStore.getState().dataflou.universe) return
    useStore.getState().setDataflou({ universe: name })
    void applyDataflou()
  })
  // the picker's list follows the session (scenes, rules, effects loaded)
  const ta = window.setInterval(() => {
    if (status.running) sendActions()
  }, 1500)
  const t = window.setInterval(() => {
    if (!status.running) return
    // every source while a visualizer page is open (it shows them all live),
    // else only the ones some node listens to
    const paths = status.visualizer > 0 ? [...SIGNAL_BY_PATH.keys()] : Object.keys(status.listeners)
    if (!paths.length) return
    const out: Record<string, DfValue> = {}
    for (const p of paths) {
      const sig = SIGNAL_BY_PATH.get(p)
      if (!sig) continue
      const v = readSource(sig, null)
      out[p] = Number.isFinite(v) ? Math.round(v * 10000) / 10000 : 0
    }
    window.api.dataflouValues(out)
  }, 33)
  void window.api.dataflouStatus().then(setStatus).catch(() => {})
  return () => {
    offStatus()
    offIn()
    offRemote()
    offMods()
    offUni()
    window.clearInterval(t)
    window.clearInterval(ta)
  }
}

/** Open the mesh visualizer in the browser. */
export async function openDataflouVisualizer(): Promise<{ ok: boolean; error?: string }> {
  return window.api.dataflouVisualizer()
}

/** Bind a destination (any node's) to a source (any node's). */
export function dataflouBind(destSku: string, destPath: string, srcSku: string, srcPath: string, on: boolean): Promise<boolean> {
  return window.api.dataflouBind({ destSku, destPath, srcSku, srcPath, on })
}
