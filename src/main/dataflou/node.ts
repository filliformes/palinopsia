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

import * as net from 'net'
import * as dgram from 'dgram'
import { DataflouMdns, primaryIPv4, type FoundService } from './mdns'
import {
  decodeMessage, encodeDeclare, encodeDigest, encodeFlush, encodeHello, encodeLeave, encodeSetValue,
  encodeStreamRequest, encodeStreamStop, encodeSubAnnounce, encodeSubRequest, frame, type DfIdentity, type DfMsg
} from './protocol'
import { crc32Sku, decodeStreamPacket, encodeStreamPacket, type StreamEntry } from './stream'
import type { DfNodeView, DfParam, DfStatus, DfSub, DfType, DfValue } from '@shared/dataflou'

const DIGEST_MS = 10_000
const PEER_TIMEOUT_MS = 30_000
const KEEPALIVE_MS = 15_000
const KEEPALIVE_TIMEOUT_MS = 30_000
const MAX_FRAME = 1 << 20
const MAX_SUBS = 4
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
}

export interface NodeHost {
  log(msg: string): void
  /** Values arriving on our destinations, already mapped into their ranges. */
  onValues(values: Array<{ path: string; value: DfValue; type: DfType }>): void
  /** The world, the bindings or who listens changed (throttle on the far side). */
  onChange(): void
  /** Persist our own bindings (local dest path → sources). */
  saveSubs(subs: Record<string, DfSub[]>): void
}

export interface NodeConfig {
  sku: string
  label: string
  universe: string
  product: string
  version: number
  params: DfParam[]
  subs: Record<string, DfSub[]>
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const v4addr = (a: string | undefined): string => (a ?? '').replace(/^::ffff:/, '')

export class DataflouNode {
  private identity: DfIdentity
  private readonly universe: string
  private declVersion = 1
  private params: DfParam[]
  private byPath = new Map<string, DfParam>()
  private values = new Map<string, DfValue>()
  private subs = new Map<string, DfSub[]>()
  private world = new Map<string, WorldNode>()
  private peers: Peer[] = []
  private pending = new Map<string, { address: string; port: number; since: number }>()
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

  constructor(cfg: NodeConfig, private host: NodeHost) {
    this.identity = { sku: cfg.sku, label: cfg.label, product: cfg.product, version: cfg.version, state: 'active' }
    this.universe = cfg.universe
    this.params = cfg.params
    for (const p of cfg.params) this.byPath.set(p.path, p)
    for (const [k, v] of Object.entries(cfg.subs ?? {})) {
      const p = this.byPath.get(k)
      if (p && p.kind === 'param' && p.flow !== 'source' && Array.isArray(v)) this.subs.set(k, v.slice(0, MAX_SUBS))
    }
    this.skuHash = crc32Sku(cfg.sku)
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return
    this.world.set(this.identity.sku, {
      identity: this.identity, declVersion: this.declVersion, local: true, online: true, lastSeen: Date.now(),
      params: this.params, byPath: this.byPath, subs: this.subs, address: '127.0.0.1'
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

    let lastDigest = Date.now()
    let lastKeepalive = Date.now()
    this.timers.push(setInterval(() => {
      const now = Date.now()
      this.checkTimeouts(now)
      this.dialPending(now)
      if (now - lastDigest >= DIGEST_MS) {
        lastDigest = now
        for (const p of this.peers) if (p.helloReceived) this.send(p, encodeDigest(++this.seq, this.identity.sku, this.versions()))
      }
      if (now - lastKeepalive >= KEEPALIVE_MS) {
        lastKeepalive = now
        this.sendAllStreamRequests()
      }
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
    this.send(peer, encodeHello(++this.seq, this.identity.sku, this.identity, this.versions(), this.tcpPort))
  }

  private sendDeclare(peer: Peer, w: WorldNode): void {
    this.send(peer, encodeDeclare(++this.seq, this.identity.sku, w.identity.sku, w.declVersion, w.identity, w.params))
  }

  /** Our own DECLARE size (the tree must stay small for microcontroller nodes). */
  declareBytes(): number {
    return encodeDeclare(0, this.identity.sku, this.identity.sku, this.declVersion, this.identity, this.params).length
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
          w = { identity: m.identity, declVersion: 0, local: false, online: true, lastSeen: now, params: [], byPath: new Map(), subs: new Map(), address: peer.address }
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
        this.host.log(`hello from ${m.identity.label} (${m.from})`)
        this.host.onChange()
        break
      }
      case 'DECLARE': {
        if (m.about === this.identity.sku) break // our own tree, relayed back
        let w = this.world.get(m.about)
        if (!w) {
          w = { identity: m.identity, declVersion: 0, local: false, online: false, lastSeen: now, params: [], byPath: new Map(), subs: new Map(), address: '' }
          this.world.set(m.about, w)
        }
        if (m.declVersion > w.declVersion) {
          w.identity = m.identity
          w.declVersion = m.declVersion
          w.params = m.params
          w.byPath = new Map(m.params.map((p) => [p.path, p]))
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
        this.host.onValues([{ path: m.path, value, type: p.type }])
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

  /** Bind one of OUR destinations to a source (any node, ourselves included). */
  subscribe(localPath: string, srcSku: string, srcPath: string): boolean {
    const p = this.byPath.get(localPath)
    if (!p || p.kind !== 'param' || p.flow === 'source') return false
    const list = this.subs.get(localPath) ?? []
    if (list.some((s) => s.sku === srcSku && s.path === srcPath)) return true
    if (list.length >= MAX_SUBS) return false
    const src = { sku: srcSku, path: srcPath }
    list.push(src)
    this.subs.set(localPath, list)
    if (srcSku === this.identity.sku) {
      // local to local : a target straight back into ourselves
      if (this.byPath.get(srcPath)?.kind === 'param') {
        this.targets.push({ destSku: srcSku, destAddress: '127.0.0.1', destUdpPort: this.udpPort, localPath: srcPath, destPath: localPath, rateHz: this.byPath.get(srcPath)!.rate, lastSent: 0, lastValue: undefined, lastRequest: Date.now() })
      }
    } else this.sendStreamRequest(src, localPath)
    this.announce(true, localPath, src)
    this.persist()
    this.host.onChange()
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
      const p = this.byPath.get(t.localPath)!
      if (t.destSku === this.identity.sku) {
        const dest = this.byPath.get(t.destPath)
        if (dest) local.push({ path: t.destPath, type: dest.type, value: mapValue(v, p.type, p, dest) })
        continue
      }
      const pkt = encodeStreamPacket(this.skuHash, now & 0xffffffff, [{ path: t.localPath, type: p.type, value: v }])
      this.udp.send(pkt, t.destUdpPort, t.destAddress)
      this.tx++
    }
    if (local.length) this.host.onValues(local)
  }

  private onUdp(m: Buffer, from: string): void {
    const pkt = decodeStreamPacket(m)
    if (!pkt) return
    const out: Array<{ path: string; value: DfValue; type: DfType }> = []
    for (const e of pkt.entries) {
      for (const [dest, list] of this.subs) {
        for (const s of list) {
          if (s.path !== e.path || crc32Sku(s.sku) !== pkt.skuHash) continue
          const dp = this.byPath.get(dest)
          if (!dp) continue
          const sp = this.world.get(s.sku)?.byPath.get(s.path) ?? null
          out.push({ path: dest, type: dp.type, value: mapValue(e.value, e.type, sp, dp) })
          this.rx++
        }
      }
    }
    void from
    if (out.length) this.host.onValues(out)
  }

  // ── the monitor ─────────────────────────────────────────────────────────

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
      txPerSec: this.txPerSec
    }
  }
}

/** A value from a source param onto a destination param, as dataflou maps it :
 *  through the source's range to 0..1, then onto the destination's range (a
 *  number onto a bool : on at half way). No source description yet : as is. */
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
