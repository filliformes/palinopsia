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
import { DF_DESTS, DF_SOURCES, dfActionPath, type DfAction, type DfStatus, type DfValue } from '@shared/dataflou'

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
  dfLastIn.set(path, { value: n, at: performance.now() })
  // Once per change : a source streams at its rate whether it moved or not, and a
  // scene or a trigger must not fire again on every packet.
  const prev = lastPlayed.get(path)
  if (prev !== undefined && Math.abs(prev - n) < 1e-6) return
  lastPlayed.set(path, n)
  routeOsc(d.osc, [{ type: 'f', value: n }])
}

/** Turn the node on or off (or rename it, or move it to another universe). */
export async function applyDataflou(): Promise<void> {
  const cfg = useStore.getState().dataflou
  // the actions first, so a node that starts with them declares them at once
  sendActions(true)
  try {
    setStatus(await window.api.dataflouConfigure(cfg))
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
