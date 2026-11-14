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
  peer?: string // where it went (out) or came from (in) : host:port
}

/** One peer : a sender (in) or a destination (out), as host:port. */
export interface OscPeer {
  key: string
  n: number // messages since the app started
  lastAt: number // performance.now() of the last one
  rate: number // msg/s over the last second
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

// Per peer, always on and cheap (a map lookup per message batch, at most 32 peers
// a way : the quietest is dropped).
const PEER_CAP = 32
const peers = { in: new Map<string, OscPeer & { win: number; winAt: number }>(), out: new Map<string, OscPeer & { win: number; winAt: number }>() }
function countPeer(dir: 'in' | 'out', key: string, n: number, t: number): void {
  const m = peers[dir]
  let p = m.get(key)
  if (!p) {
    if (m.size >= PEER_CAP) {
      let old: string | null = null, oldAt = Infinity
      for (const [k, v] of m) if (v.lastAt < oldAt) { oldAt = v.lastAt; old = k }
      if (old) m.delete(old)
    }
    m.set(key, (p = { key, n: 0, lastAt: t, rate: 0, win: 0, winAt: t }))
  }
  p.n += n
  p.win += n
  p.lastAt = t
}

/** Every peer one way, with its msg/s (the rates roll once a second). */
export function oscPeers(dir: 'in' | 'out'): OscPeer[] {
  const now = performance.now()
  const out: OscPeer[] = []
  for (const p of peers[dir].values()) {
    const dt = now - p.winAt
    if (dt >= 1000) { p.rate = Math.round((p.win * 1000) / dt); p.win = 0; p.winAt = now }
    out.push({ key: p.key, n: p.n, lastAt: p.lastAt, rate: now - p.lastAt > 2000 ? 0 : p.rate })
  }
  return out.sort((a, b) => b.lastAt - a.lastAt)
}

/** msg/s by host:port one way (the destinations' rows read it). */
export function oscPeerRates(dir: 'in' | 'out'): Record<string, number> {
  const r: Record<string, number> = {}
  for (const p of oscPeers(dir)) r[p.key] = p.rate
  return r
}

// What each peer sends or receives, address by address : kept only while a
// monitor or the connections view is open (watchers), at most 256 addresses a peer.
const byPeer = { in: new Map<string, Map<string, { n: number; lastAt: number; args: OscArg[] }>>(), out: new Map<string, Map<string, { n: number; lastAt: number; args: OscArg[] }>>() }
function recordPeer(dir: 'in' | 'out', key: string, address: string, args: OscArg[], t: number): void {
  let m = byPeer[dir].get(key)
  if (!m) byPeer[dir].set(key, (m = new Map()))
  const a = m.get(address)
  if (a) { a.n++; a.lastAt = t; a.args = args }
  else if (m.size < 256) m.set(address, { n: 1, lastAt: t, args })
}

/** The addresses a peer sent (in) or was sent (out), while watched. */
export function oscPeerAddresses(dir: 'in' | 'out', key: string): ReadonlyMap<string, { n: number; lastAt: number; args: OscArg[] }> {
  return byPeer[dir].get(key) ?? new Map()
}

/** Send one message (and let the monitor see it). */
export function sendOsc(host: string, port: number, address: string, args: OscArg[]): Promise<void> {
  count('out', 1)
  const t = performance.now(), peer = `${host}:${port}`
  countPeer('out', peer, 1, t)
  if (watchers) { record({ t, dir: 'out', address, args, peer }); recordPeer('out', peer, address, args, t) }
  return window.api.oscSend(host, port, address, args)
}

/** Send many messages to one destination in one hop (and let the monitor see them). */
export function sendOscBatch(host: string, port: number, msgs: Array<{ address: string; args: OscArg[] }>): void {
  count('out', msgs.length)
  const t = performance.now(), peer = `${host}:${port}`
  countPeer('out', peer, msgs.length, t)
  if (watchers) for (const m of msgs) { record({ t, dir: 'out', address: m.address, args: m.args, peer }); recordPeer('out', peer, m.address, m.args, t) }
  window.api.oscSendBatch(host, port, msgs)
}

/** Subscribe to the inbound stream once (App). Returns the unsubscribe. */
export function installOscMonitor(): () => void {
  return window.api.onOscReceived((batch: OscInEvent[]) => {
    count('in', batch.length)
    const t = performance.now()
    // per sender : consecutive messages from one sender (a bundle) count as one lookup
    let key = '', run = 0
    for (const m of batch) {
      const k = m.port ? `${m.host ?? '?'}:${m.port}` : (m.host ?? '?')
      if (k !== key) { if (run) countPeer('in', key, run, t); key = k; run = 0 }
      run++
    }
    if (run) countPeer('in', key, run, t)
    if (!watchers) return
    for (const m of batch) {
      const peer = m.port ? `${m.host ?? '?'}:${m.port}` : (m.host ?? '?')
      record({ t, dir: 'in', address: m.address, args: m.args, peer })
      recordPeer('in', peer, m.address, m.args, t)
    }
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
  byPeer.in.clear()
  byPeer.out.clear()
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
