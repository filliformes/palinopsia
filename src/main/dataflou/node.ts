// A dataflou node in Node.js : Palinopsia's seat on the mesh. Follows dataflou's
// reference core (src/core/node.cpp) message for message :
//   · mDNS : `<label>-<sku8>._dataflou._tcp` with TXT sku / ver / core_ver / univ /
//     started; only nodes of the same universe connect.
//   · TCP topology : the LOWER SKU dials (the other waits); both send HELLO with
//     their version vector, then DECLAREs for whatever the other lacks, ourselves
//     last; DIGEST every 10 s re-syncs, 30 s of silence = offline. A node never
//     forgets another (offline, not gone) until someone FLUSHes it.
//   · UDP data plane on the TCP port + 1 : a destination asks its source with
//     STREAMREQ (re-sent every 15 s as a keepalive, 30 s without = expired),
//     values travel as stream_codec packets and are mapped from the source's
//     range onto the destination's.
// Event-driven (sockets + timers) where the C++ core is polled; same protocol.
//
// Reconnection (ours, beyond the reference) : a node lost without saying goodbye
// (a cable pulled, a computer asleep, its Wi-Fi dropped) is dialled again from the
// last place mDNS saw it, every 2 s and then less often (up to 30 s) until it
// answers. mDNS alone never brought it back : a service seen again unchanged
// raises no new event, so only a restart of the other side (a new port) used to.
// The computer waking, or its address changing, starts the announcements over
// from where it now is (wake()).

import * as net from 'net'
import * as dgram from 'dgram'
import { DataflouMdns, primaryIPv4, type FoundService } from './mdns'
import {
  decodeMessage, encodeDeclare, encodeDigest, encodeFlush, encodeHello, encodeLeave, encodeScene, encodeSetValue,
  NO_CUE, NO_SCENE_STATUS, newerStamp, type SceneCue, type SceneStamp, type SceneState, type SceneStatus,
  encodeStreamRequest, encodeStreamStop, encodeSubAnnounce, encodeSubRequest, frame, type DfIdentity, type DfMsg
} from './protocol'
import { crc32Sku, decodeStreamPacket, encodeStreamPacket, type StreamEntry } from './stream'
import { cleanWireOpt, remote01, type DfIo, type DfIoRow, type DfNodeView, type DfParam, type DfStatus, type DfSub, type DfType, type DfValue, type DfWireOpt } from '@shared/dataflou'

const DIGEST_MS = 10_000
const PEER_TIMEOUT_MS = 30_000
const KEEPALIVE_MS = 15_000
const KEEPALIVE_TIMEOUT_MS = 30_000
const MAX_FRAME = 1 << 20
const MAX_SUBS = 4
const MAX_MONITORS = 256 // the visualizer's live values : at most this many remote params
const MONITOR_RATE_HZ = 10
const WATCH_RATE_HZ = 30 // a watched value draws a line : a little finer than the page's
const MAX_WATCHES = 64
const LEARN_MS = 25_000 // a learn ends by itself this long after it was last asked about (the app gives up at 20 s)

/** The mesh as the visualizer page reads it (the reference VisServer's snapshot). */
export interface VisParam {
  kind: 'param'
  name: string
  label: string
  type: string
  value: DfValue | null
  unit: string
  mode: string
  flow: string
  access: string
  rate: number
  range: { min: number; max: number; init: number }
  subs: Array<{ sku: string; path: string }>
}
export interface VisGroup {
  kind: 'group'
  name: string
  label: string
  children: Array<VisGroup | VisParam>
}
export interface VisNode {
  sku: string
  label: string
  product: string
  version: number
  online: boolean
  is_local: boolean
  state: string
  address?: string // where this host reaches it (absent : no direct link)
  port?: number // its mesh (TCP) port
  scene: { current: number; state: SceneState; slots: number[]; skipped: number }
  params: VisGroup
}

function visTree(params: DfParam[], valueOf: (path: string) => DfValue | null, subs: Map<string, DfSub[]>): VisGroup {
  const root: VisGroup = { kind: 'group', name: 'root', label: '', children: [] }
  const groups = new Map<string, VisGroup>([['', root]])
  const groupAt = (path: string): VisGroup => {
    const had = groups.get(path)
    if (had) return had
    const cut = path.lastIndexOf('/')
    const g: VisGroup = { kind: 'group', name: path.slice(cut + 1), label: path.slice(cut + 1), children: [] }
    groupAt(cut < 0 ? '' : path.slice(0, cut)).children.push(g)
    groups.set(path, g)
    return g
  }
  for (const p of params) {
    const cut = p.path.lastIndexOf('/')
    const parent = groupAt(cut < 0 ? '' : p.path.slice(0, cut))
    const name = p.path.slice(cut + 1)
    if (p.kind === 'group') {
      const g = groupAt(p.path)
      g.label = p.label || name
      continue
    }
    if (p.kind !== 'param') continue
    parent.children.push({
      kind: 'param', name, label: p.label || name, type: p.type, value: valueOf(p.path), unit: p.unit, mode: p.mode, flow: p.flow,
      access: p.access, rate: p.rate, range: { min: p.min, max: p.max, init: p.init },
      subs: (subs.get(p.path) ?? []).map((s) => ({ sku: s.sku, path: s.path }))
    })
  }
  return root
}
const CORE_VER = '8' // the dataflou core version this node speaks (include/dataflou/version.h)

interface Peer {
  sock: net.Socket
  sku: string
  address: string
  port: number
  helloSent: boolean
  helloReceived: boolean
  lastMsg: number
  buf: Buffer
}

interface WorldNode {
  identity: DfIdentity
  declVersion: number
  local: boolean
  online: boolean
  lastSeen: number
  params: DfParam[]
  byPath: Map<string, DfParam>
  subs: Map<string, DfSub[]> // dest path → its sources
  address: string
  scene: SceneStatus // what it declares about its scenes (ours : this.sceneStatus)
}

/** Scenes (the core's docs/scenes.md) : 16 slots, each our own incoming
 *  connections (dest path, source sku, source path, and how the wire plays when
 *  it is shaped : ours, the core never reads this file); the cue state beside
 *  them. One file per universe and node. */
export const MAX_SCENES = 16
export type SceneLink = [string, string, string] | [string, string, string, DfWireOpt]
export interface SceneFile {
  v: 1
  cue: SceneCue
  applied: SceneStamp
  state: SceneState
  skipped: number
  clock: number
  slots: Record<string, SceneLink[]>
}

interface StreamTarget {
  destSku: string
  destAddress: string
  destUdpPort: number
  localPath: string
  destPath: string
  rateHz: number
  lastSent: number
  lastValue: DfValue | undefined
  lastRequest: number
  sent?: number // values sent this second (the Connect tab's data view)
  perSec?: number
}

export interface NodeHost {
  log(msg: string): void
  /** Values arriving on our destinations, already mapped into their ranges. */
  onValues(values: Array<{ path: string; value: DfValue; type: DfType }>): void
  /** The world, the bindings or who listens changed (throttle on the far side). */
  onChange(): void
  /** Persist our own bindings (local dest path → sources). */
  saveSubs(subs: Record<string, DfSub[]>): void
  /** A listened remote value (a modulator plays it), 0..1 of its range. */
  onRemote?(sku: string, path: string, v01: number): void
  /** Persist our scenes (the slots and the cue state). */
  saveScenes?(s: SceneFile): void
  /** A cue was applied (recall), our connections saved in a slot (store), or our
   *  status changed by itself (status : connections edited by hand). */
  onScene?(op: 'recall' | 'store' | 'status', slot: number, st: SceneStatus): void
}

export interface NodeConfig {
  sku: string
  label: string
  universe: string
  product: string
  version: number
  params: DfParam[]
  subs: Record<string, DfSub[]>
  scenes?: SceneFile | null
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const v4addr = (a: string | undefined): string => (a ?? '').replace(/^::ffff:/, '')

export class DataflouNode {
  private identity: DfIdentity
  private readonly universe: string
  // Seconds since 2024 : a restart always declares a newer version than the
  // last run did, so a node that only hears of us by gossip takes the new tree.
  private declVersion = Math.max(1, Math.floor((Date.now() - 1_704_067_200_000) / 1000))
  private params: DfParam[]
  private savedSubs: Record<string, DfSub[]>
  private declSize = 0
  // the visualizer : what arrived on our destinations, the remote values its
  // monitors stream, and those monitors (asked only while a page is open)
  private lastIn = new Map<string, DfValue>()
  private remoteVals = new Map<string, DfValue>()
  private hashes = new Map<number, string>()
  private monitorOn = false
  private monitors: DfSub[] = []
  private lastMonitorKeepalive = 0
  // outside values watched in the Connect tab's data view (◉) : streamed like the
  // page's monitors (a stream with no destination), kept whether a page is open
  private watches: DfSub[] = []
  private watchAt = new Map<string, number>()
  private watchCount = new Map<string, number>()
  private watchRate = new Map<string, number>()
  // remote values the app plays itself (a modulator's mesh input) : streamed
  // like watches, handed to the app as they arrive, not shown in the data view
  private listens: DfSub[] = []
  private listenSet = new Set<string>()
  // the page asks for every value (monitors); a learn does too, for a while
  private pageMonitor = false
  private learning: Map<string, { lo: number; hi: number }> | null = null
  visualizerClients = 0
  private byPath = new Map<string, DfParam>()
  private values = new Map<string, DfValue>()
  private subs = new Map<string, DfSub[]>()
  private world = new Map<string, WorldNode>()
  private peers: Peer[] = []
  private pending = new Map<string, { address: string; port: number; since: number }>()
  // where mDNS last saw each node of our universe, and when to dial a lost one again
  private known = new Map<string, { address: string; port: number }>()
  private retry = new Map<string, { at: number; delay: number }>()
  // what arrives on our destinations, per path : when, and how many a second
  private inAt = new Map<string, number>()
  private inCount = new Map<string, number>()
  private inRate = new Map<string, number>()
  private targets: StreamTarget[] = []
  private seq = 0
  private server: net.Server | null = null
  private udp: dgram.Socket | null = null
  private mdns: DataflouMdns | null = null
  private instances = new Map<string, string>() // mDNS instance → sku (for goodbyes)
  address = ''
  private timers: ReturnType<typeof setInterval>[] = []
  private running = false
  private skuHash: number
  tcpPort = 0
  udpPort = 0
  error: string | null = null
  private rx = 0
  private tx = 0
  private rxPerSec = 0
  private txPerSec = 0
  // scenes : the universe's cue as we know it, the last one we applied, our
  // status, the Lamport clock, the newest store per slot, the slots themselves
  private sceneCue: SceneCue = NO_CUE
  private sceneApplied: SceneStamp = { counter: 0, origin: 0 }
  private sceneStatus: SceneStatus = NO_SCENE_STATUS
  private sceneClock = 0
  private sceneStored: SceneStamp[] = Array.from({ length: MAX_SCENES }, () => ({ counter: 0, origin: 0 }))
  private sceneSlots = new Map<number, SceneLink[]>()
  private applyingScene = false
  // a learn from the mesh ends by itself (its window may be gone : a reload)
  private learnUntil = 0

  constructor(cfg: NodeConfig, private host: NodeHost) {
    this.identity = { sku: cfg.sku, label: cfg.label, product: cfg.product, version: cfg.version, state: 'active' }
    this.universe = cfg.universe
    this.params = cfg.params
    for (const p of cfg.params) this.byPath.set(p.path, p)
    this.savedSubs = cfg.subs ?? {}
    this.restoreSubs()
    this.skuHash = crc32Sku(cfg.sku)
    this.loadScenes(cfg.scenes ?? null)
    this.declSize = this.declareBytes()
  }

  /** The saved bindings that end on a destination we have now (an action comes
   *  back : so does the wire that played it). */
  private restoreSubs(): void {
    for (const [k, v] of Object.entries(this.savedSubs)) {
      if (this.subs.has(k)) continue
      const p = this.byPath.get(k)
      if (!(p && p.kind === 'param' && p.flow !== 'source' && Array.isArray(v))) continue
      const list = v.slice(0, MAX_SUBS)
      this.subs.set(k, list)
      // one of our own sources : its stream straight back into us, as subscribe() makes it
      for (const s of list) if (s.sku === this.identity.sku) this.addLocalTarget(s.path, k)
    }
  }

  /** A wire from one of our sources to one of our destinations : a target straight
   *  back into ourselves (pump() delivers it without the network). */
  private addLocalTarget(srcPath: string, destPath: string): void {
    const sp = this.byPath.get(srcPath)
    if (sp?.kind !== 'param') return
    const me = this.identity.sku
    if (this.targets.some((t) => t.destSku === me && t.localPath === srcPath && t.destPath === destPath)) return
    this.targets.push({ destSku: me, destAddress: '127.0.0.1', destUdpPort: this.udpPort, localPath: srcPath, destPath, rateHz: sp.rate, lastSent: 0, lastValue: undefined, lastRequest: Date.now() })
  }

  /** A new tree (the actions changed) : a newer declaration, sent to every peer
   *  now; gossip carries it to the rest. */
  setParams(params: DfParam[]): void {
    this.params = params
    this.byPath = new Map(params.map((p) => [p.path, p]))
    this.restoreSubs()
    this.declVersion++
    this.declSize = this.declareBytes()
    const me = this.world.get(this.identity.sku)
    if (me) {
      me.params = params
      me.byPath = this.byPath
      me.declVersion = this.declVersion
      if (this.running) for (const p of this.peers) if (p.helloReceived) this.sendDeclare(p, me)
    }
    this.host.onChange()
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return
    this.world.set(this.identity.sku, {
      identity: this.identity, declVersion: this.declVersion, local: true, online: true, lastSeen: Date.now(),
      params: this.params, byPath: this.byPath, subs: this.subs, address: '127.0.0.1', scene: this.sceneStatus
    })
    // TCP on an ephemeral port, UDP on that port + 1 (dataflou's convention) :
    // when + 1 is taken, try another TCP port.
    for (let attempt = 0; attempt < 12; attempt++) {
      const server = net.createServer((s) => this.accept(s))
      await new Promise<void>((res, rej) => {
        server.once('error', rej)
        server.listen(0, '0.0.0.0', () => res())
      })
      const port = (server.address() as net.AddressInfo).port
      const udp = dgram.createSocket({ type: 'udp4' })
      const ok = await new Promise<boolean>((res) => {
        udp.once('error', () => res(false))
        udp.bind(port + 1, '0.0.0.0', () => res(true))
      })
      if (ok && port + 1 <= 65535) {
        this.server = server
        this.udp = udp
        this.tcpPort = port
        this.udpPort = port + 1
        break
      }
      server.close()
      try { udp.close() } catch { /* never bound */ }
    }
    if (!this.server || !this.udp) throw new Error('no free TCP + UDP port pair')
    this.server.on('error', (e) => this.host.log(`tcp error : ${e.message}`))
    this.udp.on('error', (e) => this.host.log(`udp error : ${e.message}`))
    this.udp.on('message', (m, rinfo) => this.onUdp(m, rinfo.address))
    this.running = true

    this.address = await primaryIPv4()
    this.startMdns()

    let lastDigest = Date.now()
    let lastKeepalive = Date.now()
    this.timers.push(setInterval(() => {
      const now = Date.now()
      this.checkTimeouts(now)
      this.dialPending(now)
      this.reconnect(now)
      if (now - lastDigest >= DIGEST_MS) {
        lastDigest = now
        for (const p of this.peers) if (p.helloReceived) this.send(p, encodeDigest(++this.seq, this.identity.sku, this.versions(), this.sceneCue))
      }
      if (now - lastKeepalive >= KEEPALIVE_MS) {
        lastKeepalive = now
        this.sendAllStreamRequests()
      }
      // a learn nobody asks about any more (its window reloaded) : over
      if (this.learning && now > this.learnUntil) this.learnStop()
      this.pollMonitors(now)
      this.inRate = this.inCount
      this.inCount = new Map()
      this.watchRate = this.watchCount
      this.watchCount = new Map()
      for (const t of this.targets) { t.perSec = t.sent ?? 0; t.sent = 0 }
      this.rxPerSec = this.rx
      this.txPerSec = this.tx
      this.rx = 0
      this.tx = 0
    }, 1000))
    // The send pump : each target at its own rate, a value when it moved (and
    // again every half second, so a lost packet heals).
    this.timers.push(setInterval(() => this.pump(Date.now()), 8))
    this.host.log(`node ${this.identity.label} (${this.identity.sku}) on tcp ${this.tcpPort} · udp ${this.udpPort} · universe ${this.universe}`)
    this.host.onChange()
  }

  private startMdns(): void {
    this.mdns = new DataflouMdns(
      (s) => this.onService(s),
      (inst) => this.onServiceDown(inst),
      (e) => {
        this.error = `mDNS : ${e.message}`
        this.host.log(this.error)
        this.host.onChange()
      }
    )
    this.mdns.start(
      `${this.identity.label}-${this.identity.sku.slice(0, 8)}`,
      this.tcpPort,
      { sku: this.identity.sku, ver: String(this.identity.version), core_ver: CORE_VER, univ: this.universe, started: String(Math.floor(Date.now() / 1000)) },
      this.address
    )
  }

  /** The computer woke up, or its address changed : the connections that went
   *  quiet meanwhile are dead (the digests come every 10 s), the announcements
   *  start over from the address we have now, every node we lost is dialled at
   *  once and our sources are asked for again. */
  async wake(why: string): Promise<void> {
    if (!this.running) return
    const now = Date.now()
    for (const p of [...this.peers]) if (now - p.lastMsg > 15_000) this.dropPeer(p, true)
    const addr = await primaryIPv4()
    if (!this.running) return
    if (addr !== this.address) this.host.log(`address ${this.address} -> ${addr}`)
    this.address = addr
    // (no goodbye : we never left, and a node that hears one lets us go)
    this.mdns?.stop(false)
    this.startMdns()
    for (const r of this.retry.values()) { r.at = 0; r.delay = 1000 }
    this.sendAllStreamRequests()
    this.host.log(`${why} : looking for the mesh again`)
    this.host.onChange()
  }

  /** Our address now (the network watch compares it with this one). */
  get announcedAddress(): string {
    return this.address
  }

  /** Every node we know of and are not connected to, dialled again from where
   *  mDNS last saw it : soon (the lower SKU first, as the protocol has it), then
   *  less and less often (up to every 30 s) until it answers. */
  private reconnect(now: number): void {
    for (const [sku, k] of this.known) {
      if (this.peers.some((p) => p.sku === sku) || this.pending.has(sku)) { this.retry.delete(sku); continue }
      let r = this.retry.get(sku)
      if (!r) {
        r = { at: now + (this.identity.sku < sku ? 2000 : 6000), delay: 2000 }
        this.retry.set(sku, r)
        continue
      }
      if (now < r.at) continue
      r.delay = Math.min(30_000, r.delay * 2)
      r.at = now + r.delay
      this.dial(sku, k.address, k.port)
    }
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    const leave = encodeLeave(++this.seq, this.identity.sku)
    for (const p of this.peers) {
      try {
        p.sock.end(frame(leave))
        p.sock.destroy()
      } catch { /* closing anyway */ }
    }
    this.peers = []
    this.mdns?.stop()
    this.mdns = null
    try { this.server?.close() } catch { /* ignore */ }
    try { this.udp?.close() } catch { /* ignore */ }
    this.server = null
    this.udp = null
    this.targets = []
  }

  // ── local values (our sources, sampled in the renderer) ─────────────────

  setValues(values: Record<string, DfValue>): void {
    for (const [k, v] of Object.entries(values)) if (this.byPath.has(k)) this.values.set(k, v)
  }

  /** Our source paths someone streams from right now (the renderer samples only these). */
  listenedPaths(): string[] {
    return [...new Set(this.targets.map((t) => t.localPath))]
  }

  // ── discovery ───────────────────────────────────────────────────────────

  private onService(s: FoundService): void {
    const sku = s.txt.sku ?? ''
    const univ = s.txt.univ ?? ''
    const address = v4addr(s.address)
    const port = s.port
    if (sku) this.instances.set(s.instance, sku)
    if (!sku || !port || !address || sku === this.identity.sku) return
    if (univ !== this.universe) return
    this.known.set(sku, { address, port })
    this.retry.delete(sku)
    const existing = this.peers.find((p) => p.sku === sku)
    if (existing) {
      if (existing.port === port && existing.address === address) return
      // it came back on another port (a restart) : reconnect, take its fresh DECLARE
      this.host.log(`${sku} moved to ${address}:${port}, reconnecting`)
      const w = this.world.get(sku)
      if (w && !w.local) w.declVersion = 0
      this.dropPeer(existing, false)
    }
    if (this.identity.sku > sku) {
      // the lower SKU dials : wait for it (and dial ourselves if it never does)
      if (!this.pending.has(sku)) this.pending.set(sku, { address, port, since: Date.now() })
      else Object.assign(this.pending.get(sku)!, { address, port })
      return
    }
    this.dial(sku, address, port)
  }

  private onServiceDown(instance: string): void {
    const sku = this.instances.get(instance) ?? ''
    // it said goodbye (it closed, it left the mesh) : not one to call back
    if (sku) { this.known.delete(sku); this.retry.delete(sku) }
    const w = sku ? this.world.get(sku) : undefined
    if (w && !w.local && w.online) {
      w.online = false
      this.host.log(`${w.identity.label} offline (mDNS)`)
      this.host.onChange()
    }
  }

  private dialPending(now: number): void {
    for (const [sku, p] of this.pending) {
      if (this.peers.some((x) => x.sku === sku)) { this.pending.delete(sku); continue }
      if (now - p.since < 5000) continue
      // It never dialled us (it may not see our announcement) : dial it ourselves.
      this.pending.delete(sku)
      this.dial(sku, p.address, p.port)
    }
  }

  private dial(sku: string, address: string, port: number): void {
    this.host.log(`connecting to ${sku} at ${address}:${port}`)
    const sock = net.connect({ host: address, port })
    const peer = this.addPeer(sock)
    peer.sku = sku
    peer.address = address
    peer.port = port
    sock.once('connect', () => this.sendHello(peer))
  }

  private accept(sock: net.Socket): void {
    const peer = this.addPeer(sock)
    peer.address = v4addr(sock.remoteAddress)
    this.sendHello(peer)
  }

  private addPeer(sock: net.Socket): Peer {
    const peer: Peer = { sock, sku: '', address: '', port: 0, helloSent: false, helloReceived: false, lastMsg: Date.now(), buf: Buffer.alloc(0) }
    this.peers.push(peer)
    sock.setNoDelay(true)
    sock.on('data', (d: Buffer) => this.onData(peer, d))
    sock.on('error', () => { /* 'close' follows */ })
    sock.on('close', () => this.dropPeer(peer, true))
    return peer
  }

  private dropPeer(peer: Peer, lost: boolean): void {
    const i = this.peers.indexOf(peer)
    if (i < 0) return
    this.peers.splice(i, 1)
    try { peer.sock.destroy() } catch { /* gone */ }
    if (peer.sku) {
      this.targets = this.targets.filter((t) => t.destSku !== peer.sku)
      if (!this.peers.some((p) => p.sku === peer.sku)) this.forgetMonitors(peer.sku)
      const w = this.world.get(peer.sku)
      if (lost && w && !w.local && !this.peers.some((p) => p.sku === peer.sku)) {
        w.online = false
        this.host.log(`${w.identity.label} disconnected`)
      }
    }
    this.host.onChange()
  }

  private checkTimeouts(now: number): void {
    for (const p of [...this.peers]) {
      if (p.helloReceived && now - p.lastMsg > PEER_TIMEOUT_MS) {
        this.host.log(`${p.sku} timed out`)
        this.dropPeer(p, true)
      }
    }
    const before = this.targets.length
    this.targets = this.targets.filter((t) => t.destSku === this.identity.sku || now - t.lastRequest <= KEEPALIVE_TIMEOUT_MS)
    if (this.targets.length !== before) this.host.onChange()
  }

  // ── TCP framing + messages ──────────────────────────────────────────────

  private send(peer: Peer, payload: Uint8Array): void {
    if (peer.sock.destroyed) return
    try {
      peer.sock.write(frame(payload))
    } catch { /* the close handler cleans up */ }
  }

  private onData(peer: Peer, d: Buffer): void {
    peer.lastMsg = Date.now()
    const seen = peer.sku ? this.world.get(peer.sku) : undefined
    if (seen && !seen.local) seen.lastSeen = peer.lastMsg
    peer.buf = peer.buf.length ? Buffer.concat([peer.buf, d]) : d
    while (peer.buf.length >= 4) {
      const len = peer.buf.readUInt32BE(0)
      if (len > MAX_FRAME) {
        this.host.log(`corrupt frame from ${peer.sku || peer.address} (${len} bytes)`)
        this.dropPeer(peer, true)
        return
      }
      if (peer.buf.length < 4 + len) break
      const payload = peer.buf.subarray(4, 4 + len)
      peer.buf = peer.buf.subarray(4 + len)
      const msg = decodeMessage(payload)
      if (msg) {
        try {
          this.onMessage(peer, msg)
        } catch (e) {
          this.host.log(`${msg.msg} from ${msg.from} failed : ${(e as Error).message}`)
        }
      }
    }
  }

  private versions(): Map<string, number> {
    const v = new Map<string, number>()
    for (const [sku, w] of this.world) v.set(sku, w.declVersion)
    return v
  }

  private sendHello(peer: Peer): void {
    if (peer.helloSent) return
    peer.helloSent = true
    this.send(peer, encodeHello(++this.seq, this.identity.sku, this.identity, this.versions(), this.tcpPort, this.sceneCue))
  }

  private sendDeclare(peer: Peer, w: WorldNode): void {
    this.send(peer, encodeDeclare(++this.seq, this.identity.sku, w.identity.sku, w.declVersion, w.identity, w.params, w.local ? this.sceneStatus : w.scene))
    if (w.local) this.sendSubAnnouncesTo(peer)
  }

  /** As the core (8.3) follows its own DECLARE : a clear (no source), then every
   *  connection into us, so a node that joined later, or was away, knows them
   *  (an older core ignores the clear : no connection has an empty source). */
  private sendSubAnnouncesTo(peer: Peer): void {
    const me = this.identity.sku
    this.send(peer, encodeSubAnnounce(++this.seq, me, false, me, '', '', ''))
    for (const [dest, list] of this.subs) for (const s of list) this.send(peer, encodeSubAnnounce(++this.seq, me, true, me, dest, s.sku, s.path))
  }

  /** Our own DECLARE size (the tree must stay small for microcontroller nodes). */
  declareBytes(params: DfParam[] = this.params): number {
    return encodeDeclare(0, this.identity.sku, this.identity.sku, this.declVersion, this.identity, params, this.sceneStatus).length
  }

  private syncMissing(peer: Peer, theirs: Map<string, number>): void {
    for (const [sku, w] of this.world) {
      if (w.local) continue
      const v = theirs.get(sku)
      if (v === undefined || v < w.declVersion) this.sendDeclare(peer, w)
    }
  }

  private onMessage(peer: Peer, m: DfMsg): void {
    const now = Date.now()
    switch (m.msg) {
      case 'HELLO': {
        peer.sku = m.from
        peer.helloReceived = true
        if (m.listenPort) peer.port = m.listenPort
        if (!peer.address) peer.address = v4addr(peer.sock.remoteAddress)
        this.pending.delete(m.from)
        let w = this.world.get(m.from)
        if (!w) {
          w = { identity: m.identity, declVersion: 0, local: false, online: true, lastSeen: now, params: [], byPath: new Map(), subs: new Map(), address: peer.address, scene: NO_SCENE_STATUS }
          this.world.set(m.from, w)
        }
        if (!w.local) {
          w.declVersion = 0 // always take its fresh DECLARE after a (re)connection
          w.identity = m.identity
          w.online = true
          w.lastSeen = now
          w.address = peer.address
        }
        this.sendHello(peer)
        this.syncMissing(peer, m.versions)
        this.sendDeclare(peer, this.world.get(this.identity.sku)!)
        // our bindings sourced from it : ask it to stream again
        for (const [dest, list] of this.subs) for (const s of list) if (s.sku === m.from) this.sendStreamRequest(s, dest)
        // and the values we watch, play or monitor from it (it dropped those
        // streams with the old connection) : asked again now, not at the next keepalive
        this.forgetMonitors(m.from)
        this.pollMonitors(now, true)
        this.host.log(`hello from ${m.identity.label} (${m.from})`)
        this.host.onChange()
        // a recall made while we were away : apply it now
        this.mergeCue(m.scene)
        break
      }
      case 'DECLARE': {
        if (m.about === this.identity.sku) break // our own tree, relayed back
        let w = this.world.get(m.about)
        if (!w) {
          w = { identity: m.identity, declVersion: 0, local: false, online: false, lastSeen: now, params: [], byPath: new Map(), subs: new Map(), address: '', scene: NO_SCENE_STATUS }
          this.world.set(m.about, w)
        }
        if (m.declVersion > w.declVersion) {
          w.identity = m.identity
          w.declVersion = m.declVersion
          w.params = m.params
          w.byPath = new Map(m.params.map((p) => [p.path, p]))
          w.scene = m.sceneStatus
          if (m.about === m.from) {
            w.online = true
            w.address = peer.address
          }
          w.lastSeen = now
          this.host.onChange()
        }
        break
      }
      case 'LEAVE': {
        const w = this.world.get(m.from)
        if (w && !w.local) w.online = false
        this.host.onChange()
        break
      }
      case 'DIGEST':
        this.syncMissing(peer, m.versions)
        this.mergeCue(m.scene) // anti-entropy : a missed cue arrives within a digest
        break
      case 'SCENE':
        this.handleScene(m.op, m.slot, { counter: m.counter, origin: m.origin }, peer)
        break
      case 'FLUSH':
        if (m.target !== this.identity.sku && this.world.delete(m.target)) this.host.onChange()
        break
      case 'SUBREQ':
        if (m.destSku !== this.identity.sku) break
        if (m.sub) this.subscribe(m.destPath, m.srcSku, m.srcPath)
        else this.unsubscribe(m.destPath, m.srcSku, m.srcPath)
        break
      case 'SETVAL': {
        if (m.target !== this.identity.sku) break
        const p = this.byPath.get(m.path)
        if (!p || p.kind !== 'param' || p.flow === 'source') break
        const value = m.type === 'bool' && p.type === 'number' ? (m.value ? p.max : p.min) : p.type === 'bool' ? !!(typeof m.value === 'number' ? m.value >= 0.5 : m.value) : m.value
        this.deliver([{ path: m.path, value, type: p.type }])
        break
      }
      case 'STREAMREQ': {
        const p = this.byPath.get(m.sourcePath)
        if (!p || p.kind !== 'param') break
        const rate = m.rateHz > 0 && p.rate > 0 ? Math.min(m.rateHz, p.rate) : Math.max(m.rateHz, p.rate)
        let t = this.targets.find((x) => x.destSku === m.destSku && x.localPath === m.sourcePath && x.destPath === m.destPath)
        if (!t) {
          t = { destSku: m.destSku, destAddress: peer.address, destUdpPort: m.destUdpPort, localPath: m.sourcePath, destPath: m.destPath, rateHz: rate, lastSent: 0, lastValue: undefined, lastRequest: now }
          this.targets.push(t)
          this.host.log(`streaming ${m.sourcePath} to ${this.world.get(m.destSku)?.identity.label ?? m.destSku}/${m.destPath}`)
          this.host.onChange()
        } else Object.assign(t, { destAddress: peer.address, destUdpPort: m.destUdpPort, rateHz: rate, lastRequest: now })
        break
      }
      case 'STREAMSTOP': {
        const before = this.targets.length
        this.targets = this.targets.filter((t) => !(t.destSku === m.destSku && t.localPath === m.sourcePath && t.destPath === m.destPath))
        if (this.targets.length !== before) this.host.onChange()
        break
      }
      case 'SUBANNOUNCE': {
        const w = this.world.get(m.destSku)
        if (!w || w.local) break
        if (!m.sub && !m.sourceSku) {
          // a clear (core 8.3) : that node's own list of its connections follows
          w.subs.clear()
          this.host.onChange()
          break
        }
        const list = w.subs.get(m.destPath) ?? []
        const i = list.findIndex((s) => s.sku === m.sourceSku && s.path === m.sourcePath)
        if (m.sub && i < 0) list.push({ sku: m.sourceSku, path: m.sourcePath })
        if (!m.sub && i >= 0) list.splice(i, 1)
        if (list.length) w.subs.set(m.destPath, list)
        else w.subs.delete(m.destPath)
        this.host.onChange()
        break
      }
      default:
        break // ACK, PADMIN, BLOB, BLOBREQ : nothing for a visual instrument to do
    }
  }

  // ── bindings ────────────────────────────────────────────────────────────

  private peerOf(sku: string): Peer | undefined {
    return this.peers.find((p) => p.sku === sku && p.helloReceived)
  }

  private sendStreamRequest(src: DfSub, localPath: string): void {
    if (src.sku === this.identity.sku) return
    const peer = this.peerOf(src.sku)
    if (!peer) return
    const rate = this.byPath.get(localPath)?.rate ?? 0
    this.send(peer, encodeStreamRequest(++this.seq, this.identity.sku, src.path, localPath, this.identity.sku, this.udpPort, rate))
  }

  private sendAllStreamRequests(): void {
    for (const [dest, list] of this.subs) for (const s of list) this.sendStreamRequest(s, dest)
  }

  private announce(sub: boolean, destPath: string, src: DfSub): void {
    const payload = encodeSubAnnounce(++this.seq, this.identity.sku, sub, this.identity.sku, destPath, src.sku, src.path)
    for (const p of this.peers) if (p.helloReceived) this.send(p, payload)
  }

  private persist(): void {
    this.host.saveSubs(Object.fromEntries(this.subs))
  }

  /** Bind one of OUR destinations to a source (any node, ourselves included).
   *  `opt` : how the wire plays (a scene giving back a shaped wire). */
  subscribe(localPath: string, srcSku: string, srcPath: string, opt?: unknown): boolean {
    const p = this.byPath.get(localPath)
    if (!p || p.kind !== 'param' || p.flow === 'source') return false
    const list = this.subs.get(localPath) ?? []
    if (list.some((s) => s.sku === srcSku && s.path === srcPath)) return true
    if (list.length >= MAX_SUBS) return false
    const src: DfSub = { sku: srcSku, path: srcPath }
    const o = opt === undefined ? null : cleanWireOpt(opt)
    if (o) src.opt = o
    list.push(src)
    this.subs.set(localPath, list)
    // local to local : a target straight back into ourselves
    if (srcSku === this.identity.sku) this.addLocalTarget(srcPath, localPath)
    else this.sendStreamRequest(src, localPath)
    this.announce(true, localPath, src)
    this.persist()
    this.host.onChange()
    this.sceneTouched()
    return true
  }

  unsubscribe(localPath: string, srcSku: string, srcPath: string): boolean {
    const list = this.subs.get(localPath)
    const i = list ? list.findIndex((s) => s.sku === srcSku && s.path === srcPath) : -1
    if (!list || i < 0) return false
    list.splice(i, 1)
    if (!list.length) this.subs.delete(localPath)
    if (srcSku === this.identity.sku) {
      this.targets = this.targets.filter((t) => !(t.destSku === srcSku && t.localPath === srcPath && t.destPath === localPath))
    } else {
      const peer = this.peerOf(srcSku)
      if (peer) this.send(peer, encodeStreamStop(++this.seq, this.identity.sku, srcPath, localPath, this.identity.sku))
    }
    this.announce(false, localPath, { sku: srcSku, path: srcPath })
    this.persist()
    this.host.onChange()
    this.sceneTouched()
    return true
  }

  /** Bind on ANOTHER node : its destination ← some source (often one of ours). */
  subscribeRemote(destSku: string, destPath: string, srcSku: string, srcPath: string, sub: boolean): boolean {
    if (destSku === this.identity.sku) return sub ? this.subscribe(destPath, srcSku, srcPath) : this.unsubscribe(destPath, srcSku, srcPath)
    const peer = this.peerOf(destSku)
    if (!peer) return false
    this.send(peer, encodeSubRequest(++this.seq, this.identity.sku, sub, destSku, destPath, srcSku, srcPath))
    return true
  }

  /** Write a value on another node's parameter. */
  setRemote(sku: string, path: string, value: DfValue): boolean {
    const peer = this.peerOf(sku)
    const p = this.world.get(sku)?.byPath.get(path)
    if (!peer || !p) return false
    this.send(peer, encodeSetValue(++this.seq, this.identity.sku, sku, path, p.type, value))
    return true
  }

  /** Forget an offline node, on every node of the mesh. */
  flush(sku: string): void {
    if (sku === this.identity.sku) return
    this.world.delete(sku)
    const payload = encodeFlush(++this.seq, this.identity.sku, sku)
    for (const p of this.peers) if (p.helloReceived) this.send(p, payload)
    this.host.onChange()
  }

  // ── scenes ──────────────────────────────────────────────────────────────
  // A scene is a state of the mesh's connections, recalled by a number. Each node
  // keeps its own part (its incoming connections) in slot n and applies it when
  // the universe cues n; the universe shares only the cue (MIDI program change :
  // each synth recalls its own patch). See the dataflou core's docs/scenes.md.

  private loadScenes(f: SceneFile | null): void {
    this.sceneSlots.clear()
    if (f && f.v === 1) {
      const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x >>> 0 : 0)
      this.sceneCue = { slot: n(f.cue?.slot) & 0xff, counter: n(f.cue?.counter), origin: n(f.cue?.origin) }
      this.sceneApplied = { counter: n(f.applied?.counter), origin: n(f.applied?.origin) }
      this.sceneClock = n(f.clock)
      for (const [k, list] of Object.entries(f.slots ?? {})) {
        const slot = Number(k)
        if (!(slot >= 1 && slot <= MAX_SCENES) || !Array.isArray(list)) continue
        const links: SceneLink[] = []
        for (const l of list as unknown[]) {
          if (!Array.isArray(l) || (l.length !== 3 && l.length !== 4) || !l.slice(0, 3).every((x) => typeof x === 'string')) continue
          const o = l.length === 4 ? cleanWireOpt(l[3]) : null
          links.push(o ? [l[0], l[1], l[2], o] : [l[0], l[1], l[2]])
        }
        this.sceneSlots.set(slot, links)
      }
      const state: SceneState = (['none', 'applied', 'modified', 'missing'] as const).includes(f.state) ? f.state : 'none'
      this.sceneStatus = { current: this.sceneCue.slot, state, slots: this.slotMask(), skipped: Math.min(255, n(f.skipped)) }
    } else {
      this.sceneCue = NO_CUE
      this.sceneApplied = { counter: 0, origin: 0 }
      this.sceneClock = 0
      this.sceneStatus = NO_SCENE_STATUS
    }
  }

  private slotMask(): number {
    let m = 0
    for (const n of this.sceneSlots.keys()) m |= 1 << (n - 1)
    return m >>> 0
  }

  private persistScenes(): void {
    this.host.saveScenes?.({
      v: 1, cue: this.sceneCue, applied: this.sceneApplied, state: this.sceneStatus.state, skipped: this.sceneStatus.skipped,
      clock: this.sceneClock, slots: Object.fromEntries([...this.sceneSlots].map(([k, v]) => [String(k), v]))
    })
  }

  /** Our incoming connections now, as a slot holds them (a shaped wire with its
   *  shape, so a recall that makes it again makes it as it was). */
  private currentLinks(): SceneLink[] {
    const out: SceneLink[] = []
    for (const [dest, list] of this.subs) for (const s of list) out.push(s.opt ? [dest, s.sku, s.path, { ...s.opt }] : [dest, s.sku, s.path])
    return out
  }

  private nextStamp(): SceneStamp {
    this.sceneClock = (this.sceneClock + 1) >>> 0
    return { counter: this.sceneClock, origin: this.skuHash }
  }

  /** Cue the universe : every node applies its own slot `slot`. */
  sceneRecall(slot: number): boolean {
    if (!(slot >= 1 && slot <= 255)) return false
    this.handleScene('recall', slot, this.nextStamp(), null)
    return true
  }

  /** Cue the universe : every node online saves its own connections in `slot`. */
  sceneStore(slot: number): boolean {
    if (!(slot >= 1 && slot <= MAX_SCENES)) return false
    this.handleScene('store', slot, this.nextStamp(), null)
    return true
  }

  sceneInfo(): { cue: SceneCue; status: SceneStatus } {
    return { cue: this.sceneCue, status: this.sceneStatus }
  }

  /** A cue from us (from null) or a peer. Each node forwards a cue the first time
   *  it sees it, so it reaches the whole universe even when the mesh is not fully
   *  connected; a node that misses it gets it from a digest. */
  private handleScene(op: 'recall' | 'store', slot: number, stamp: SceneStamp, from: Peer | null): void {
    if (stamp.counter > this.sceneClock) this.sceneClock = stamp.counter
    if (op === 'recall') {
      if (!newerStamp(stamp, this.sceneCue)) return
      this.host.log(`scene : recall ${slot}`)
      this.sceneCue = { slot, counter: stamp.counter, origin: stamp.origin }
      this.sendScene(op, slot, stamp, from)
      this.applyScene()
    } else {
      // slots we cannot hold are neither stored nor forwarded
      if (!(slot >= 1 && slot <= MAX_SCENES)) return
      if (!newerStamp(stamp, this.sceneStored[slot - 1])) return
      this.host.log(`scene : store ${slot}`)
      this.sceneStored[slot - 1] = stamp
      this.persistScenes() // (the clock)
      this.sendScene(op, slot, stamp, from)
      this.storeScene(slot)
    }
  }

  private sendScene(op: 'recall' | 'store', slot: number, stamp: SceneStamp, except: Peer | null): void {
    const payload = encodeScene(++this.seq, this.identity.sku, op, slot, stamp)
    for (const p of this.peers) if (p !== except && p.helloReceived) this.send(p, payload)
  }

  /** The cue a HELLO or a DIGEST carries : a newer one is applied. */
  private mergeCue(cue: SceneCue): void {
    if (!cue.counter || !cue.slot) return
    if (cue.counter > this.sceneClock) this.sceneClock = cue.counter
    if (!newerStamp(cue, this.sceneCue)) return
    this.host.log(`scene : catching up with recall ${cue.slot}`)
    this.sceneCue = cue
    this.applyScene()
  }

  /** Make our connections those of our slot of the current cue : remove the ones
   *  it lacks, then make the ones it has (removing first frees room on a param
   *  that changes source). One whose param of ours is gone is skipped; one whose
   *  source is gone is made anyway, and resumes if it comes back. */
  private applyScene(): void {
    const slot = this.sceneCue.slot
    this.sceneApplied = { counter: this.sceneCue.counter, origin: this.sceneCue.origin }
    const st: SceneStatus = { ...this.sceneStatus, current: slot, skipped: 0 }
    const want = this.sceneSlots.get(slot)
    if (!want) {
      this.host.log(`scene ${slot} : no slot here, connections kept`)
      st.state = 'missing'
      this.persistScenes()
      this.setSceneStatus(st, 'recall', slot)
      return
    }
    const key = (l: SceneLink): string => `${l[0]}\n${l[1]}\n${l[2]}`
    const have = this.currentLinks()
    const wantKeys = new Set(want.map(key))
    const haveKeys = new Set(have.map(key))
    let removed = 0, added = 0, skipped = 0
    this.applyingScene = true
    try {
      for (const l of have) if (!wantKeys.has(key(l)) && this.unsubscribe(l[0], l[1], l[2])) removed++
      for (const l of want) {
        if (haveKeys.has(key(l))) continue
        if (this.subscribe(l[0], l[1], l[2], l[3])) added++
        else skipped++
      }
    } finally {
      this.applyingScene = false
    }
    this.host.log(`scene ${slot} applied : -${removed} +${added}, ${skipped} skipped`)
    st.state = 'applied'
    st.skipped = Math.min(255, skipped)
    this.setSceneStatus(st, 'recall', slot)
    this.persistScenes()
  }

  private storeScene(slot: number): void {
    const links = this.currentLinks()
    this.sceneSlots.set(slot, links)
    this.host.log(`scene ${slot} stored : ${links.length} connections`)
    const st: SceneStatus = { ...this.sceneStatus, slots: this.slotMask() }
    // our connections are now our slot of the current scene
    if (slot === this.sceneCue.slot) {
      st.state = 'applied'
      st.skipped = 0
    }
    this.setSceneStatus(st, 'store', slot)
    this.persistScenes()
  }

  /** A connection made or removed by hand after a recall : modified. */
  private sceneTouched(): void {
    if (this.applyingScene || this.sceneStatus.state !== 'applied') return
    this.setSceneStatus({ ...this.sceneStatus, state: 'modified' }, 'status', this.sceneStatus.current)
    this.persistScenes()
  }

  private setSceneStatus(st: SceneStatus, op: 'recall' | 'store' | 'status', slot: number): void {
    const s = this.sceneStatus
    const changed = st.current !== s.current || st.state !== s.state || st.slots !== s.slots || st.skipped !== s.skipped
    this.sceneStatus = st
    const me = this.world.get(this.identity.sku)
    if (me) me.scene = st
    if (changed) this.redeclare() // the status travels in our declaration
    if (changed || op !== 'status') this.host.onScene?.(op, slot, st)
    this.host.onChange()
  }

  /** A newer declaration of the same tree (our scene status changed). */
  private redeclare(): void {
    this.declVersion++
    this.declSize = this.declareBytes()
    const me = this.world.get(this.identity.sku)
    if (!me) return
    me.declVersion = this.declVersion
    if (this.running) for (const p of this.peers) if (p.helloReceived) this.sendDeclare(p, me)
  }

  // ── data plane ──────────────────────────────────────────────────────────

  private pump(now: number): void {
    if (!this.udp) return
    const local: Array<{ path: string; value: DfValue; type: DfType }> = []
    for (const t of this.targets) {
      const v = this.values.get(t.localPath)
      if (v === undefined) continue
      const interval = t.rateHz > 0 ? 1000 / t.rateHz : 0
      if (now - t.lastSent < interval) continue
      if (t.lastValue === v && now - t.lastSent < 500) continue
      t.lastSent = now
      t.lastValue = v
      t.sent = (t.sent ?? 0) + 1
      const p = this.byPath.get(t.localPath)!
      if (t.destSku === this.identity.sku) {
        const dest = this.byPath.get(t.destPath)
        // shaped like a wire from another node (its range, invert)
        const opt = this.subs.get(t.destPath)?.find((s) => s.sku === this.identity.sku && s.path === t.localPath)?.opt
        if (dest) local.push({ path: t.destPath, type: dest.type, value: shapeWire(mapValue(v, p.type, p, dest), dest, opt) })
        continue
      }
      const pkt = encodeStreamPacket(this.skuHash, now & 0xffffffff, [{ path: t.localPath, type: p.type, value: v }])
      this.udp.send(pkt, t.destUdpPort, t.destAddress)
      this.tx++
    }
    if (local.length) this.deliver(local)
  }

  private onUdp(m: Buffer, from: string): void {
    const pkt = decodeStreamPacket(m)
    if (!pkt) return
    const out: Array<{ path: string; value: DfValue; type: DfType }> = []
    const srcSku = this.skuOfHash(pkt.skuHash)
    const now = Date.now()
    for (const e of pkt.entries) {
      if (srcSku) {
        const k = `${srcSku}\n${e.path}`
        this.remoteVals.set(k, e.value)
        if (this.watchAt.has(k)) {
          this.watchAt.set(k, now)
          this.watchCount.set(k, (this.watchCount.get(k) ?? 0) + 1)
        }
        if (this.listenSet.has(k) || this.learning) {
          const v01 = remote01(e.value, this.world.get(srcSku)?.byPath.get(e.path))
          if (v01 !== null) {
            if (this.listenSet.has(k)) this.host.onRemote?.(srcSku, e.path, v01)
            if (this.learning) {
              const r = this.learning.get(k)
              if (!r) this.learning.set(k, { lo: v01, hi: v01 })
              else {
                if (v01 < r.lo) r.lo = v01
                if (v01 > r.hi) r.hi = v01
              }
            }
          }
        }
      }
      for (const [dest, list] of this.subs) {
        for (const s of list) {
          if (s.path !== e.path || crc32Sku(s.sku) !== pkt.skuHash) continue
          const dp = this.byPath.get(dest)
          if (!dp) continue
          const sp = this.world.get(s.sku)?.byPath.get(s.path) ?? null
          out.push({ path: dest, type: dp.type, value: shapeWire(mapValue(e.value, e.type, sp, dp), dp, s.opt) })
          this.rx++
        }
      }
    }
    void from
    if (out.length) this.deliver(out)
  }

  /** Values for our destinations, to the app (and kept for the visualizer). */
  private deliver(list: Array<{ path: string; value: DfValue; type: DfType }>): void {
    const now = Date.now()
    for (const v of list) {
      this.lastIn.set(v.path, v.value)
      this.inAt.set(v.path, now)
      this.inCount.set(v.path, (this.inCount.get(v.path) ?? 0) + 1)
    }
    this.host.onValues(list)
  }

  private skuOfHash(h: number): string | null {
    const had = this.hashes.get(h)
    if (had) return had
    for (const sku of this.world.keys()) {
      const x = crc32Sku(sku)
      this.hashes.set(x, sku)
      if (x === h) return sku
    }
    return null
  }

  // ── the visualizer ────────────────────────────────────────────────

  universeName(): string {
    return this.universe
  }

  sku(): string {
    return this.identity.sku
  }

  /** The page sets a value : ours plays like any value arriving; another
   *  node's goes to it. */
  setFromVisualizer(sku: string, path: string, value: DfValue): boolean {
    if (sku !== this.identity.sku) return this.setRemote(sku, path, value)
    const p = this.byPath.get(path)
    if (!p || p.kind !== 'param' || p.flow === 'source') return false
    this.deliver([{ path, value, type: p.type }])
    return true
  }

  /** While a visualizer page is open, every remote param streams to us (the
   *  reference node's monitors : a STREAMREQ with no destination path). */
  setMonitoring(on: boolean): void {
    this.pageMonitor = on
    const want = on || !!this.learning
    if (want === this.monitorOn) return
    this.monitorOn = want
    this.pollMonitors(Date.now(), true) // (off : the watched ones stay)
  }

  /** Remote values the app plays itself (a modulator's mesh input). */
  setListens(list: DfSub[]): void {
    this.listens = list.filter((m) => m && typeof m.sku === 'string' && typeof m.path === 'string' && m.sku !== this.identity.sku).slice(0, MAX_WATCHES)
    this.listenSet = new Set(this.listens.map((m) => `${m.sku}\n${m.path}`))
    this.pollMonitors(Date.now(), true)
  }

  /** Learn from the mesh : every remote value streams for a while (as for the
   *  page), and the one that moves the most is the answer (learnPeek). */
  learnStart(): void {
    this.learning = new Map()
    this.learnUntil = Date.now() + LEARN_MS
    if (!this.monitorOn) {
      this.monitorOn = true
      this.pollMonitors(Date.now(), true)
    }
  }

  learnStop(): void {
    this.learning = null
    this.learnUntil = 0
    if (this.monitorOn && !this.pageMonitor) {
      this.monitorOn = false
      this.pollMonitors(Date.now(), true)
    }
  }

  /** The remote value that moved the most since learnStart, once it swept at
   *  least `min` of its range (null : nothing yet). */
  learnPeek(min = 0.25): { sku: string; path: string; label: string; node: string; span: number } | null {
    if (!this.learning) return null
    this.learnUntil = Date.now() + LEARN_MS // (someone is still asking)
    let best: { k: string; span: number } | null = null
    for (const [k, r] of this.learning) {
      const span = r.hi - r.lo
      if (span >= min && (!best || span > best.span)) best = { k, span }
    }
    if (!best) return null
    const [sku, path] = best.k.split('\n')
    const w = this.world.get(sku)
    const p = w?.byPath.get(path)
    return { sku, path, label: p?.label || path, node: w?.identity.label ?? sku.slice(0, 8), span: best.span }
  }

  /** How a wire into us plays (range, invert, smoothing, on loss). */
  setWireOpt(dest: string, srcSku: string, srcPath: string, opt: unknown): boolean {
    const s = this.subs.get(dest)?.find((x) => x.sku === srcSku && x.path === srcPath)
    if (!s) return false
    const o = cleanWireOpt(opt)
    if (o) s.opt = o
    else delete s.opt
    this.persist()
    this.host.onChange()
    return true
  }

  /** The outside values to watch (sku + path), from the Connect tab. */
  setWatches(list: DfSub[]): void {
    const key = (m: DfSub): string => `${m.sku}\n${m.path}`
    this.watches = list.filter((m) => m && typeof m.sku === 'string' && typeof m.path === 'string' && m.sku !== this.identity.sku).slice(0, MAX_WATCHES)
    const keep = new Set(this.watches.map(key))
    for (const k of [...this.watchAt.keys()]) if (!keep.has(k)) this.watchAt.delete(k)
    for (const k of keep) if (!this.watchAt.has(k)) this.watchAt.set(k, 0)
    this.pollMonitors(Date.now(), true)
    this.host.onChange()
  }

  /** A node's streams to us are gone with its connection : the next poll asks
   *  them as new ones. */
  private forgetMonitors(sku: string): void {
    this.monitors = this.monitors.filter((m) => m.sku !== sku)
  }

  private stopMonitor(m: DfSub): void {
    const peer = this.peerOf(m.sku)
    if (peer) this.send(peer, encodeStreamStop(++this.seq, this.identity.sku, m.path, '', this.identity.sku))
  }

  /** The streams with no destination this node keeps open : every remote value
   *  while a page is open (monitors), and the watched ones always. `fresh` : the
   *  set changed (a watch toggled) : new ones are asked at once. */
  private pollMonitors(now: number, fresh = false): void {
    if (!this.running) return
    const keepalive = now - this.lastMonitorKeepalive >= KEEPALIVE_MS
    const key = (m: DfSub): string => `${m.sku}\n${m.path}`
    const wanted: DfSub[] = []
    const seen = new Set<string>()
    const add = (m: DfSub): void => {
      const k = key(m)
      if (seen.has(k)) return
      seen.add(k)
      wanted.push(m)
    }
    for (const m of [...this.watches, ...this.listens]) {
      const w = this.world.get(m.sku)
      if (w && !w.local && w.online && this.peerOf(m.sku)) add(m)
    }
    if (this.monitorOn) {
      for (const [sku, w] of this.world) {
        if (w.local || !w.online || !this.peerOf(sku)) continue
        for (const p of w.params) {
          if (p.kind !== 'param' || wanted.length >= MAX_MONITORS + this.watches.length + this.listens.length) continue
          add({ sku, path: p.path })
        }
      }
    }
    const had = new Set(this.monitors.map(key))
    for (const m of this.monitors) if (!seen.has(key(m))) this.stopMonitor(m)
    const watched = new Set([...this.watches, ...this.listens].map(key))
    for (const m of wanted) {
      if (!keepalive && had.has(key(m)) && !fresh) continue
      if (!keepalive && had.has(key(m)) && fresh && !watched.has(key(m))) continue
      const peer = this.peerOf(m.sku)
      const rate = watched.has(key(m)) ? WATCH_RATE_HZ : MONITOR_RATE_HZ
      if (peer) this.send(peer, encodeStreamRequest(++this.seq, this.identity.sku, m.path, '', this.identity.sku, this.udpPort, rate))
    }
    this.monitors = wanted
    if (keepalive) this.lastMonitorKeepalive = now
  }

  /** Every node of the mesh, its tree, its values and its wires, for the page. */
  visNodes(): VisNode[] {
    const out: VisNode[] = []
    for (const [sku, w] of this.world) {
      const valueOf = (path: string): DfValue | null =>
        w.local ? this.values.get(path) ?? this.lastIn.get(path) ?? null : this.remoteVals.get(`${sku}\n${path}`) ?? null
      const st = w.local ? this.sceneStatus : w.scene
      const slots: number[] = []
      for (let n = 1; n <= 32; n++) if (st.slots & (1 << (n - 1))) slots.push(n)
      // where we reach it : ourselves at our LAN address, a peer at its link (one
      // on this machine reaches us over loopback : show the LAN address)
      const peer = w.local ? null : this.peerOf(sku)
      let address = w.local ? this.address : peer ? peer.address : ''
      if (/^127\.|^::1$/.test(address) && this.address) address = this.address
      const port = w.local ? this.tcpPort : peer ? peer.port : 0
      out.push({
        sku, label: w.identity.label, product: w.identity.product, version: w.identity.version,
        online: w.local || w.online, is_local: w.local, state: w.identity.state,
        ...(address ? { address } : {}), ...(port ? { port } : {}),
        scene: { current: st.current, state: st.state, slots, skipped: st.skipped },
        params: visTree(w.params, valueOf, w.subs)
      })
    }
    return out
  }

  // ── the monitor ─────────────────────────────────────────────────────────

  /** What flows now (the Connect tab's data view) : each of our destinations with
   *  its sources and the last value that arrived, each stream we send with its
   *  value; how many a second, and how long since the last. */
  io(): DfIo {
    const now = Date.now()
    const me = this.identity.sku
    const name = (sku: string): string => (sku === me ? this.identity.label : this.world.get(sku)?.identity.label ?? sku.slice(0, 8))
    const live = (sku: string): boolean => sku === me || !!this.peerOf(sku)
    const inRows: DfIoRow[] = []
    const seen = new Set<string>()
    for (const [dest, list] of this.subs) {
      seen.add(dest)
      const at = this.inAt.get(dest)
      inRows.push({
        path: dest,
        label: this.byPath.get(dest)?.label || dest,
        value: this.lastIn.get(dest) ?? null,
        peers: list.map((s) => `${name(s.sku)}/${s.path}`),
        ageMs: at ? now - at : null,
        perSec: this.inRate.get(dest) ?? 0,
        live: list.some((s) => live(s.sku))
      })
    }
    // values set from elsewhere (a SETVAL, the visualizer) on a path nothing is wired to
    for (const [path, at] of this.inAt) {
      if (seen.has(path) || now - at > 10_000) continue
      inRows.push({ path, label: this.byPath.get(path)?.label || path, value: this.lastIn.get(path) ?? null, peers: ['set'], ageMs: now - at, perSec: this.inRate.get(path) ?? 0, live: true })
    }
    // wires only : a stream with no destination is a node monitoring us (its
    // visualizer page asks for every value), counted on one line instead
    const outRows: DfIoRow[] = this.targets.filter((t) => t.destPath !== '').map((t) => ({
      path: t.localPath,
      label: this.byPath.get(t.localPath)?.label || t.localPath,
      value: this.values.get(t.localPath) ?? null,
      peers: [`${name(t.destSku)}/${t.destPath}`],
      ageMs: t.lastSent ? now - t.lastSent : null,
      perSec: t.perSec ?? 0,
      live: live(t.destSku)
    }))
    const by = new Map<string, number>()
    for (const t of this.targets) if (t.destPath === '' && live(t.destSku)) by.set(t.destSku, (by.get(t.destSku) ?? 0) + 1)
    const watchedBy = [...by].map(([sku, count]) => ({ label: name(sku), count }))
    const watched: DfIoRow[] = this.watches.map((m) => {
      const k = `${m.sku}\n${m.path}`
      const w = this.world.get(m.sku)
      const p = w?.byPath.get(m.path)
      const at = this.watchAt.get(k) || 0
      // its group with it : two gloves both have a 'pitch'
      const segs = m.path.split('/')
      const leaf = p?.label || segs[segs.length - 1]
      return {
        sku: m.sku,
        path: m.path,
        label: segs.length > 1 ? `${segs[segs.length - 2]} · ${leaf}` : leaf,
        value: this.remoteVals.get(k) ?? null,
        peers: [`${name(m.sku)}/${m.path}`],
        ageMs: at ? now - at : null,
        perSec: this.watchRate.get(k) ?? 0,
        live: !!w && w.online && live(m.sku)
      }
    })
    return { sku: me, label: this.identity.label, in: inRows, out: outRows, watched, watchedBy, rxPerSec: this.rxPerSec, txPerSec: this.txPerSec }
  }

  status(): DfStatus {
    const nodes: DfNodeView[] = []
    for (const [sku, w] of this.world) {
      nodes.push({
        sku,
        label: w.identity.label,
        product: w.identity.product,
        version: w.identity.version,
        state: w.identity.state,
        online: w.local || w.online,
        local: w.local,
        connected: w.local || !!this.peerOf(sku),
        address: w.local ? '' : w.address,
        lastSeenMs: w.lastSeen,
        params: w.params,
        subs: Object.fromEntries(w.subs)
      })
    }
    nodes.sort((a, b) => (a.local ? -1 : b.local ? 1 : Number(b.online) - Number(a.online) || a.label.localeCompare(b.label)))
    const listeners: Record<string, string[]> = {}
    for (const t of this.targets) {
      const who = `${this.world.get(t.destSku)?.identity.label ?? t.destSku.slice(0, 8)}/${t.destPath}`
      ;(listeners[t.localPath] ??= []).push(who)
    }
    return {
      running: this.running,
      error: this.error,
      sku: this.identity.sku,
      label: this.identity.label,
      universe: this.universe,
      address: this.address,
      tcpPort: this.tcpPort,
      udpPort: this.udpPort,
      nodes,
      listeners,
      rxPerSec: this.rxPerSec,
      txPerSec: this.txPerSec,
      declareBytes: this.declSize,
      published: 0,
      actions: 0,
      actionsDropped: 0,
      visualizer: this.visualizerClients,
      visualizerAvailable: false
    }
  }
}

/** A value from a source param onto a destination param, as dataflou maps it :
 *  through the source's range to 0..1, then onto the destination's range (a
 *  number onto a bool : on at half way). No source description yet : as is. */
/** A wire's shape on its way in (DfWireOpt) : the part of the destination's range
 *  it covers, and turned the other way. (Smoothing and on-loss are the app's.) */
export function shapeWire(v: DfValue, dp: DfParam, opt: DfWireOpt | undefined): DfValue {
  if (!opt) return v
  if (dp.type === 'bool') return opt.invert ? !v : v
  if (dp.type !== 'number' || typeof v !== 'number') return v
  const span = dp.max - dp.min
  if (!(span !== 0)) return v
  let t = Math.max(0, Math.min(1, (v - dp.min) / span))
  if (opt.invert) t = 1 - t
  const lo = opt.lo ?? 0, hi = opt.hi ?? 1
  return dp.min + (lo + (hi - lo) * t) * span
}

export function mapValue(v: DfValue, type: DfType, src: DfParam | null, dst: DfParam): DfValue {
  let t: number
  if (type === 'bool') t = v ? 1 : 0
  else if (type === 'colour') t = Array.isArray(v) ? (v[0] ?? 0) / 255 : 0
  else {
    const n = Array.isArray(v) ? (v[0] ?? 0) : typeof v === 'number' ? v : Number(v) || 0
    if (!src) {
      if (dst.type === 'bool') return n >= 0.5
      return Math.min(Math.max(n, Math.min(dst.min, dst.max)), Math.max(dst.min, dst.max))
    }
    const span = src.max - src.min
    t = span === 0 ? clamp01(n) : clamp01((n - src.min) / span)
  }
  if (dst.type === 'bool') return t >= 0.5
  if (dst.type === 'number') return dst.min + t * (dst.max - dst.min)
  return v
}
