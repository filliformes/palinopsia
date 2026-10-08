// The OSC monitor's tap : what comes in and what goes out over UDP OSC.
//
// Every message the app SENDS goes through sendOsc / sendOscBatch here (the
// feedback mirror, the mark signal, body rules, the Resolume mapper); every
// batch it RECEIVES arrives on window.api.onOscReceived, which installOscMonitor
// subscribes to once. Both directions are always counted (a few increments : the
// OSC section's msg/s and activity lights read them); the messages themselves
// are only kept while a monitor is open (watchOsc), in a short ring and a
// latest-value-per-address table. The OSCQuery WebSocket value stream is
// another protocol and is not shown.

import type { OscInEvent } from '@shared/types'

export type OscArg = { type: string; value: number | string | boolean }
export interface OscLogEntry {
  t: number // performance.now()
  dir: 'in' | 'out'
  address: string
  args: OscArg[]
  peer?: string // where an outgoing message went (host:port)
}

const CAP = 500
const log: OscLogEntry[] = []
const latest = new Map<string, { e: OscLogEntry; n: number }>()
let watchers = 0
let version = 0
// lifetime counters (the activity lights compare them between two reads)
export const oscCounts = { in: 0, out: 0 }
// msg/s over the last second
const win = { in: 0, out: 0, at: 0 }
const rates = { in: 0, out: 0 }

function record(e: OscLogEntry): void {
  log.push(e)
  if (log.length > CAP) log.splice(0, log.length - CAP)
  const k = `${e.dir}|${e.address}`
  const l = latest.get(k)
  latest.set(k, { e, n: (l?.n ?? 0) + 1 })
  version++
}

function count(dir: 'in' | 'out', n: number): void {
  oscCounts[dir] += n
  win[dir] += n
}

/** Send one message (and let the monitor see it). */
export function sendOsc(host: string, port: number, address: string, args: OscArg[]): Promise<void> {
  count('out', 1)
  if (watchers) record({ t: performance.now(), dir: 'out', address, args, peer: `${host}:${port}` })
  return window.api.oscSend(host, port, address, args)
}

/** Send many messages to one destination in one hop (and let the monitor see them). */
export function sendOscBatch(host: string, port: number, msgs: Array<{ address: string; args: OscArg[] }>): void {
  count('out', msgs.length)
  if (watchers) {
    const t = performance.now(), peer = `${host}:${port}`
    for (const m of msgs) record({ t, dir: 'out', address: m.address, args: m.args, peer })
  }
  window.api.oscSendBatch(host, port, msgs)
}

/** Subscribe to the inbound stream once (App). Returns the unsubscribe. */
export function installOscMonitor(): () => void {
  return window.api.onOscReceived((batch: OscInEvent[]) => {
    count('in', batch.length)
    if (!watchers) return
    const t = performance.now()
    for (const m of batch) record({ t, dir: 'in', address: m.address, args: m.args })
  })
}

/** A monitor opens : start keeping messages. Returns the close. */
export function watchOsc(): () => void {
  watchers++
  return () => {
    watchers = Math.max(0, watchers - 1)
    if (!watchers) clearOscLog()
  }
}

export function clearOscLog(): void {
  log.length = 0
  latest.clear()
  version++
}

/** What the monitor draws (it re-reads when the version moves). */
export function oscLog(): { version: number; log: readonly OscLogEntry[]; latest: ReadonlyMap<string, { e: OscLogEntry; n: number }> } {
  return { version, log, latest }
}

/** Messages per second each way, over the last second. */
export function oscRates(): { in: number; out: number } {
  const now = performance.now()
  if (!win.at) win.at = now
  const dt = now - win.at
  if (dt >= 1000) {
    rates.in = Math.round((win.in * 1000) / dt)
    rates.out = Math.round((win.out * 1000) / dt)
    win.in = 0
    win.out = 0
    win.at = now
  }
  return rates
}

/** One argument as the monitor prints it. */
export function fmtOscArg(a: OscArg): string {
  if (a.type === 'T' || a.value === true) return 'true'
  if (a.type === 'F' || a.value === false) return 'false'
  if (typeof a.value === 'number') return a.type === 'i' ? String(a.value) : Number.isInteger(a.value) ? `${a.value}.0` : a.value.toFixed(3)
  return `"${a.value}"`
}
