// The dataflou bridge, renderer side. The node lives in main; here :
//   · values arriving on our destinations play exactly like OSC (each maps to a
//     /opsia address, routed through oscInput), triggers fire once each;
//   · our sources (audio / picture / body / modulators / Macro knobs) are read like
//     the Resolume mapper's rows, and our destinations where they stand, and sent to
//     main as they change, for what is published;
//   · the node's status (the monitor) is kept here, outside the store;
//   · the Body rule picker's actions : listed for main while the node runs (it
//     declares one trigger each, act/..., for the ones the section publishes),
//     fired here.

import { useSyncExternalStore } from 'react'
import { useStore } from './store'
import { routeOsc } from './oscInput'
import { readSource } from './resolume'
import { fireTrigger } from './midi'
import { triggerOptions } from './triggerCatalog'
import { DF_DESTS, DF_SOURCES, dfActionPath, dfGroupOf, dfPublished, type DfAction, type DfListen, type DfStatus, type DfValue, type DfWireOpt } from '@shared/dataflou'
import type { MappingScope, ModTarget } from '@shared/types'
import { oscLeafValues } from './oscInput'
import { controlBus } from './engine/controlBus'
import { isPinnedTarget } from './persist'
import { showToast } from './components/Toast'

const DEST_BY_PATH = new Map(DF_DESTS.map((d) => [d.path, d]))
const SIGNAL_BY_PATH = new Map<string, string>([
  ...DF_SOURCES.map((s) => [s.path, s.signal] as [string, string]),
  ...DF_DESTS.filter((d) => d.bidir).map((d) => [d.path, d.bidir!] as [string, string])
])

const ARRAY_BY_PATH = new Map<string, string[]>(DF_SOURCES.filter((s) => s.array).map((s) => [s.path, s.array!]))

const EMPTY: DfStatus = {
  available: true, running: false, error: null, core: '', sku: '', label: '', universe: '', address: '', tcpPort: 0,
  nodes: [], dests: {}, listeners: {}, refused: [], universes: [], discovery: 'ok', halted: false, presentation: false,
  rxPerSec: 0, txPerSec: 0, published: 0, actions: 0, parked: [], visualizer: 0, visualizerAvailable: false
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

/** Hand main the list when it changed (while the node is on : main declares the
 *  published ones). */
function sendActions(force = false): void {
  const cfg = useStore.getState().dataflou
  if (!cfg.enabled) {
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

/** A trigger of ours fired (once each) : an action, or a destination that fires. */
function fire(path: string, times: number): void {
  dfLastIn.set(path, { value: true, at: performance.now() })
  const act = actionByPath.get(path)
  const osc = DEST_BY_PATH.get(path)?.osc
  for (let i = 0; i < times; i++) {
    if (act) fireTrigger(act)
    else if (osc) {
      // (an address that fires on its rising edge : up, then armed again)
      routeOsc(osc, [{ type: 'f', value: 1 }])
      routeOsc(osc, [{ type: 'f', value: 0 }])
    }
  }
}

function play(path: string, value: DfValue): void {
  let n = typeof value === 'boolean' ? (value ? 1 : 0) : typeof value === 'number' ? value : Array.isArray(value) ? (value[0] ?? 0) : Number(value) || 0
  if (!Number.isFinite(n)) return
  const d = DEST_BY_PATH.get(path)
  if (!d || d.type === 'trigger') return
  // a number that picks one thing (a scene) : played once per whole step, and
  // never smoothed nor glided back (the steps on the way would each be recalled)
  if (d.discrete) n = Math.round(n)
  const glides = d.type === 'number' && !d.discrete
  // (set by hand on the mesh, with no wire : where it was before is not kept)
  dfLastIn.set(path, { value: n, at: performance.now() })
  const opt = glides ? wireOptOf(path) : undefined
  if (anims.get(path)?.kind === 'back') anims.delete(path) // (the source is here again)
  // smoothing : the value is a target the control glides to (a slew)
  if (opt?.slewMs) {
    const a = anims.get(path)
    // a value sent again (a source repeats itself) : the control is there already
    if (!a && lastPlayed.get(path) === n) return
    const from = a ? a.cur : lastPlayed.get(path) ?? rawNow(d)
    anims.set(path, { kind: 'slew', cur: from, to: n, ms: opt.slewMs, from, t0: performance.now(), osc: d.osc })
    startAnims()
    return
  }
  // Once per change : a scene must not be recalled again by a value sent again.
  const prev = lastPlayed.get(path)
  if (prev !== undefined && Math.abs(prev - n) < 1e-6) return
  lastPlayed.set(path, n)
  routeOsc(d.osc, [{ type: 'f', value: n }])
}

// ── a wire begins and ends : the mesh says so (bound, waiting, free), a quiet source
// is not a lost one (a fader sends only when it moves) ──
const standing = new Map<string, string>()
// where a control was before its wire began to play it
const preOf = new Map<string, { v: number; at: number }>()
function stands(path: string, state: string): void {
  const was = standing.get(path) ?? 'free'
  standing.set(path, state)
  const d = DEST_BY_PATH.get(path)
  if (!d || d.type !== 'number' || d.discrete) return
  if (state === 'bound' && was !== 'bound' && was !== 'waiting') {
    // (a glide back cut short by the source coming back is not a new start : the
    // place it was going back to stays)
    if (anims.get(path)?.kind !== 'back' || !preOf.has(path)) preOf.set(path, { v: rawNow(d), at: performance.now() })
    return
  }
  if (state !== 'free' || was === 'free') return
  const pre = preOf.get(path)
  const opt = wireOptOf(path)
  // (nothing came in since : there is nothing to give back)
  if (opt?.onLoss !== 'return' || !pre || (dfLastIn.get(path)?.at ?? 0) < pre.at) return
  const cur = anims.get(path)?.cur ?? lastPlayed.get(path) ?? rawNow(d)
  anims.set(path, { kind: 'back', cur, to: pre.v, ms: (opt.returnSec ?? 2) * 1000, from: cur, t0: performance.now(), osc: d.osc })
  startAnims()
}

// ── a wire's smoothing and its glide back (DfWireOpt, set in the connections
// list) : one animation loop, running only while something glides ──
type Anim = { kind: 'slew' | 'back'; cur: number; to: number; ms: number; from: number; t0: number; osc: string }
const anims = new Map<string, Anim>()
let animTimer = 0
let lastAnim = 0

/** How the wires into a destination glide here. The values reach the renderer
 *  by destination, not by wire, so smoothing and on loss belong to the control :
 *  the longest smoothing of its wires, and a glide back when any of them asks for
 *  one (over the longest time). Range and invert stay each wire's (main). */
function wireOptOf(path: string): DfWireOpt | undefined {
  const me = status.nodes.find((x) => x.local)
  let slewMs = 0, returnSec = 0, back = false
  for (const s of me?.subs[path] ?? []) {
    const o = s.opt
    if (!o) continue
    if (o.slewMs && o.slewMs > slewMs) slewMs = o.slewMs
    if (o.onLoss === 'return') {
      back = true
      returnSec = Math.max(returnSec, o.returnSec ?? 2)
    }
  }
  if (!slewMs && !back) return undefined
  return { ...(slewMs ? { slewMs } : {}), ...(back ? { onLoss: 'return' as const, returnSec } : {}) }
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
      // (exactly there at the end : from + (to - from) can miss `to` by a hair,
      // and the glide would then never end, the same value sent every frame)
      next = u >= 1 ? a.to : a.from + (a.to - a.from) * e
    }
    a.cur = next
    lastPlayed.set(path, next)
    routeOsc(a.osc, [{ type: 'f', value: next }])
    if (next === a.to) anims.delete(path)
  }
  if (!anims.size) {
    window.clearInterval(animTimer)
    animTimer = 0
  }
}

// ── a modulator played by a mesh value (its Controller input) ──
const meshKey = (sku: string, path: string): string => `${sku}\n${path}`
let meshSlots = new Map<string, number[]>()
let listensSent = ''
function syncListens(): void {
  const mods = useStore.getState().composition.modulators
  const next = new Map<string, number[]>()
  const list: DfListen[] = []
  mods.forEach((m, i) => {
    if (m.type !== 'controller' || !m.mesh) return
    const k = meshKey(m.mesh.sku, m.mesh.path)
    if (!next.has(k)) {
      next.set(k, [])
      list.push({ sku: m.mesh.sku, path: m.mesh.path, slot: i })
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
    // the first run after the update from v1.3.3 : what the saved wires play is
    // published too (its new tree follows through the publish list's effect)
    if (cfg.migrate && status.running) {
      const paths = publishableParked()
      const now = useStore.getState().dataflou
      useStore.getState().setDataflou({ migrate: false, publish: [...now.publish, ...paths.map((p) => `p:${p}`)] })
    }
  } catch (e) {
    setStatus({ ...EMPTY, error: (e as Error).message })
  }
  lastPlayed.clear()
  standing.clear()
  sent.clear()
}

// ── what our parameters stand at, for the mesh ──
// What was last said of each published one; only changes go out.
const sent = new Map<string, string>()
const ECHO_MS = 300
/** The published paths of ours, as the node has them. */
let ours: string[] = []
let oursOf: DfStatus | null = null
function ourPaths(): string[] {
  if (oursOf !== status) {
    oursOf = status
    ours = status.nodes.find((x) => x.local)?.params.filter((p) => p.kind === 'param' && p.type !== 'trigger').map((p) => p.path) ?? []
  }
  return ours
}
function say(out: Record<string, DfValue>, path: string, v: DfValue): void {
  // the mesh is playing this one now : it says it itself (no echo of it, a rounding off)
  const last = dfLastIn.get(path)
  if (last && performance.now() - last.at < ECHO_MS) return
  const k = Array.isArray(v) ? v.join() : String(v)
  if (sent.get(path) === k) return
  sent.set(path, k)
  out[path] = v
}
const round4 = (v: number): number => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : 0)
let leavesAt = 0
function sampleOurs(): void {
  if (!status.running) return
  const out: Record<string, DfValue> = {}
  const paths = ourPaths()
  const now = performance.now()
  let leaves: Map<string, number> | null = null
  for (const p of paths) {
    const list = ARRAY_BY_PATH.get(p)
    if (list) {
      say(out, p, list.map((s) => round4(readSource(s, null))))
      continue
    }
    const sig = SIGNAL_BY_PATH.get(p)
    if (sig) {
      say(out, p, round4(readSource(sig, null)))
      continue
    }
    // a destination : where its control stands, a few times a second
    const d = DEST_BY_PATH.get(p)
    if (!d) continue
    if (!leaves) {
      if (now - leavesAt < 250) continue
      leaves = oscLeafValues()
    }
    const v = leaves.get(d.osc)
    if (v === undefined) continue
    const lo = d.min ?? 0, hi = d.max ?? 1
    say(out, p, d.type === 'bool' ? v >= 0.5 : round4(lo + v * (hi - lo)))
  }
  if (leaves) leavesAt = now
  if (Object.keys(out).length) window.api.dataflouValues(out)
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
    for (const v of batch) {
      if ('fire' in v) fire(v.path, v.fire)
      else if ('dest' in v) stands(v.path, v.dest)
      else play(v.path, v.value)
    }
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
  const t = window.setInterval(sampleOurs, 33)
  // one of ours is being located : say where it is
  const offLocate = window.api.onDataflouLocate?.((l) => {
    if (!l.on) return
    const d = DEST_BY_PATH.get(l.path)
    const label = d?.label ?? DF_SOURCES.find((s) => s.path === l.path)?.label ?? dataflouActions().find((a) => a.path === l.path)?.label ?? l.path
    showToast(`Located from the dataflou mesh : ${label} (${l.path})`)
  })
  // a scene of the mesh recalled, and Palinopsia's scene of that number with it
  const offScene = window.api.onDataflouScene?.((slot) => routeOsc('/opsia/scene', [{ type: 'f', value: slot }]))
  void window.api.dataflouStatus().then(setStatus).catch(() => {})
  // the session's wires : to main as they change (a load, New, a wire made or
  // moved), back from main when one is unwired or reshaped on the mesh
  wiresSent = ''
  sendSessionWires()
  let wiresWas = useStore.getState().sessionDfWires
  const offWires = useStore.subscribe((s) => {
    if (s.sessionDfWires === wiresWas) return
    wiresWas = s.sessionDfWires
    sendSessionWires()
  })
  // (`?.` : a renderer hot-updated over an older main and preload has none)
  const offWiresIn = window.api.onDataflouSessionWires?.((list) => {
    wiresSent = JSON.stringify(list)
    useStore.getState().setSessionDfWires(list)
  })
  return () => {
    offWires()
    offWiresIn?.()
    offStatus()
    offIn()
    offRemote()
    offMods()
    offUni()
    offLocate?.()
    offScene?.()
    window.clearInterval(t)
    window.clearInterval(ta)
  }
}

/** Open the mesh visualizer in the browser. */
export async function openDataflouVisualizer(): Promise<{ ok: boolean; error?: string }> {
  return window.api.dataflouVisualizer()
}

/** Bind a destination (any node's) to a source (any node's). A new wire into
 *  Palinopsia goes where Learn into says (this computer, or saved with the
 *  session), unless `scope` says. */
export async function dataflouBind(destSku: string, destPath: string, srcSku: string, srcPath: string, on: boolean, scope?: MappingScope): Promise<boolean> {
  // Wiring one of ours publishes it : the node only takes wires to what it declares.
  // A wire saved with the session publishes for that session only (main adds
  // what the session's wires need while it is open, never to this list).
  const toSession = (scope ?? useStore.getState().learnScope) === 'session' && destSku === status.sku
  if (on && !toSession) {
    const mine = [destSku === status.sku ? destPath : null, srcSku === status.sku ? srcPath : null].filter((x): x is string => !!x)
    await ensurePublished(mine)
  }
  return window.api.dataflouBind({ destSku, destPath, srcSku, srcPath, on, scope: scope ?? useStore.getState().learnScope })
}

/** Move a wire into Palinopsia to this computer or to the session (null : a
 *  computer wire the session silences, removed). */
export async function dataflouWireScope(dest: string, sku: string, path: string, to: MappingScope | null): Promise<boolean> {
  // kept on this computer : what it plays joins this computer's publish list (it
  // was published for the session only)
  if (to === 'computer') {
    const acts = new Set(dataflouActions().map((a) => a.path))
    const ours = [dest, ...(sku === status.sku ? [path] : [])].filter((p) => DEST_BY_PATH.has(p) || SIGNAL_BY_PATH.has(p) || acts.has(p))
    await ensurePublished(ours)
  }
  return (await window.api.dataflouWireScope?.({ dest, sku, path, to })) ?? false
}

// ── the session's wires : the store keeps them (the session file's
// mappings.dataflou), main plays them ──
let wiresSent = ''
function sendSessionWires(): void {
  const list = useStore.getState().sessionDfWires
  const j = JSON.stringify(list)
  if (j === wiresSent) return
  wiresSent = j
  window.api.dataflouSession?.(list)
}
// The session's wires need their paths published : main adds them to the tree
// while the session is open (status.sessionPublished), never to the publish list
// below, which is this computer's alone.

/** Is one of our paths in this computer's publish list ? */
export function isDfPublished(path: string): boolean {
  const pub = new Set(useStore.getState().dataflou.publish)
  const action = path.startsWith('act/') ? dataflouActions().find((a) => a.path === path) : undefined
  return dfPublished(pub, dfGroupOf(path, action?.group), path)
}

/** The destinations whose saved wires wait (not published now) that can be
 *  published : a fixed one, or an action the session has. */
export function publishableParked(): string[] {
  const acts = new Set(dataflouActions().map((a) => a.path))
  return status.parked.filter((p) => !isDfPublished(p) && (DEST_BY_PATH.has(p) || acts.has(p)))
}

/** Publish the destinations whose wires wait, so they play again. */
export async function publishParked(): Promise<void> {
  await ensurePublished(publishableParked())
}

/** Publish these paths (one by one) if they are not yet, and wait for the node's
 *  new tree. */
async function ensurePublished(paths: string[]): Promise<void> {
  const missing = paths.filter((p) => !isDfPublished(p))
  if (!missing.length) return
  const cfg = useStore.getState().dataflou
  useStore.getState().setDataflou({ publish: [...cfg.publish, ...missing.map((p) => `p:${p}`)] })
  await applyDataflou()
}
