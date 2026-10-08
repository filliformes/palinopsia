// The dataflou bridge, renderer side. The node lives in main; here :
//   · values arriving on our destinations play exactly like OSC (each maps to a
//     /opsia address, routed through oscInput), once per change;
//   · our sources (audio / picture / body / modulators / Meta knobs) are read
//     like the Resolume mapper's rows and sent to main 30 times a second, but
//     only the ones some node listens to;
//   · the node's status (the monitor) is kept here, outside the store.

import { useSyncExternalStore } from 'react'
import { useStore } from './store'
import { routeOsc } from './oscInput'
import { readSource } from './resolume'
import { DF_DESTS, DF_SOURCES, type DfStatus, type DfValue } from '@shared/dataflou'

const DEST_BY_PATH = new Map(DF_DESTS.map((d) => [d.path, d]))
const SIGNAL_BY_PATH = new Map<string, string>([
  ...DF_SOURCES.map((s) => [s.path, s.signal] as [string, string]),
  ...DF_DESTS.filter((d) => d.bidir).map((d) => [d.path, d.bidir!] as [string, string])
])

const EMPTY: DfStatus = {
  running: false, error: null, sku: '', label: '', universe: '', address: '', tcpPort: 0, udpPort: 0,
  nodes: [], listeners: {}, rxPerSec: 0, txPerSec: 0
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
  const d = DEST_BY_PATH.get(path)
  if (!d) return
  const n = typeof value === 'boolean' ? (value ? 1 : 0) : typeof value === 'number' ? value : Array.isArray(value) ? (value[0] ?? 0) : Number(value) || 0
  if (!Number.isFinite(n)) return
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
  const t = window.setInterval(() => {
    if (!status.running) return
    const paths = Object.keys(status.listeners)
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
    window.clearInterval(t)
  }
}

/** Bind a destination (any node's) to a source (any node's). */
export function dataflouBind(destSku: string, destPath: string, srcSku: string, srcPath: string, on: boolean): Promise<boolean> {
  return window.api.dataflouBind({ destSku, destPath, srcSku, srcPath, on })
}
