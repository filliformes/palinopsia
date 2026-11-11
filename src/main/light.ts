// Lights over the network : DMX universes the renderer's Lights engine assembled
// (src/renderer/src/lights/lightEngine.ts), sent as Art-Net, sACN (E1.31) or
// WLED's realtime DNRGB. The Enttec USB Pro is driven from the renderer itself
// (Web Serial), so only the network outputs pass through here. Best-effort
// throughout : a bad host or a closed socket must never take down the main process.

import { createSocket, type Socket } from 'dgram'
import { randomBytes } from 'crypto'
import { networkInterfaces } from 'os'
import { isIP } from 'net'
import { lookup } from 'dns'
import makeMdns from 'multicast-dns'

const ARTNET_PORT = 6454
const SACN_PORT = 5568
const WLED_PORT = 21324

export interface DmxPacket {
  kind: 'artnet' | 'sacn' | 'wled' | 'artsync'
  host: string
  universe: number
  data?: Uint8Array // 512 channels (none for an ArtSync)
}

export class DmxSender {
  private sock: Socket | null = null
  private artSeq = 0
  private sacnSeq = new Map<number, number>()
  private readonly cid = randomBytes(16) // this sender's sACN identity, for this run
  // A host written as a name (wled-bar.local) : looked up once, kept ten seconds.
  // Never per packet : forty lookups a second and a universe would fill the
  // thread pool main's own file work waits on.
  private names = new Map<string, { ip: string; at: number; busy: boolean }>()

  /** The address to send to : an IP as it is, a name through its last lookup
   *  ('' : not known yet, this packet is skipped). */
  private addr(host: string): string {
    if (!host || isIP(host)) return host
    const now = Date.now()
    let e = this.names.get(host)
    if (!e) { e = { ip: '', at: 0, busy: false }; this.names.set(host, e) }
    if (!e.busy && now - e.at > 10_000) {
      e.busy = true
      const ent = e
      try {
        lookup(host, 4, (err, ip) => { ent.busy = false; ent.at = Date.now(); ent.ip = err ? '' : ip })
      } catch { ent.busy = false; ent.at = now }
    }
    if (this.names.size > 64) this.names.clear()
    return e.ip
  }

  private socket(): Socket | null {
    if (this.sock) return this.sock
    try {
      const s = createSocket('udp4')
      s.on('error', () => {}) // swallow : a bad host must not crash main
      s.bind(() => {
        try { s.setBroadcast(true) } catch { /* not allowed : unicast still works */ }
        try { s.setMulticastTTL(4) } catch { /* ignore */ }
      })
      this.sock = s
    } catch {
      this.sock = null
    }
    return this.sock
  }

  dispose(): void {
    if (this.sock) { try { this.sock.close() } catch { /* ignore */ } this.sock = null }
  }

  send(packets: DmxPacket[]): void {
    if (!Array.isArray(packets) || !packets.length) return
    const s = this.socket()
    if (!s) return
    for (const p0 of packets.slice(0, 257)) {
      if (!p0 || typeof p0.host !== 'string') continue
      const p = { ...p0, host: this.addr(p0.host.trim()) }
      if (p0.host && !p.host) continue // a name not resolved yet
      if (p.kind === 'artsync') {
        if (p.host) { try { this.artsync(s, p.host) } catch { /* a malformed host */ } }
        continue
      }
      if (!(p.data instanceof Uint8Array)) continue
      try {
        if (p.kind === 'artnet' && p.host) this.artnet(s, p)
        else if (p.kind === 'sacn') this.sacn(s, p)
        else if (p.kind === 'wled' && p.host) this.wled(s, p)
      } catch {
        /* a malformed host : skip it */
      }
    }
  }

  /** ArtSync (OpSync) : the nodes that know it hold the universes they got and show
   *  them all together on it (a node that stops getting it goes back to showing
   *  each universe as it lands). */
  private artsync(s: Socket, host: string): void {
    const pkt = Buffer.alloc(14)
    pkt.write('Art-Net\0', 0, 'latin1')
    pkt.writeUInt16LE(0x5200, 8) // OpSync
    pkt.writeUInt16BE(14, 10) // protocol version 14
    s.send(pkt, ARTNET_PORT, host)
  }

  private artnet(s: Socket, p: DmxPacket): void {
    if (!p.data) return
    const uni = Math.max(0, Math.min(32767, p.universe | 0))
    const pkt = Buffer.alloc(18 + 512)
    pkt.write('Art-Net\0', 0, 'latin1')
    pkt.writeUInt16LE(0x5000, 8) // OpOutput / ArtDmx
    pkt.writeUInt16BE(14, 10) // protocol version 14
    pkt[12] = this.artSeq = (this.artSeq % 255) + 1 // 1..255 (0 = no sequencing)
    pkt[13] = 0 // physical
    pkt[14] = uni & 0xff // SubUni
    pkt[15] = (uni >> 8) & 0x7f // Net
    pkt.writeUInt16BE(512, 16)
    pkt.set(p.data.subarray(0, 512), 18)
    s.send(pkt, ARTNET_PORT, p.host)
  }

  /** E1.31 data packet : root, framing and DMP layers, 512 channels. Unicast to
   *  the host, or multicast to the universe's group when no host is set. */
  private sacn(s: Socket, p: DmxPacket): void {
    if (!p.data) return
    const uni = Math.max(1, Math.min(63999, p.universe | 0 || 1))
    const pkt = Buffer.alloc(638)
    pkt.writeUInt16BE(0x0010, 0) // preamble size
    pkt.writeUInt16BE(0x0000, 2) // post-amble size
    pkt.write('ASC-E1.17\0\0\0', 4, 'latin1')
    pkt.writeUInt16BE(0x7000 | (638 - 16), 16)
    pkt.writeUInt32BE(0x00000004, 18) // VECTOR_ROOT_E131_DATA
    this.cid.copy(pkt, 22)
    pkt.writeUInt16BE(0x7000 | (638 - 38), 38)
    pkt.writeUInt32BE(0x00000002, 40) // VECTOR_E131_DATA_PACKET
    pkt.write('Palinopsia', 44, 'utf8') // source name (64 bytes, null padded)
    pkt[108] = 100 // priority
    pkt.writeUInt16BE(0, 109) // sync address
    const seq = ((this.sacnSeq.get(uni) ?? 0) + 1) & 0xff
    this.sacnSeq.set(uni, seq)
    pkt[111] = seq
    pkt[112] = 0 // options
    pkt.writeUInt16BE(uni, 113)
    pkt.writeUInt16BE(0x7000 | (638 - 115), 115)
    pkt[117] = 0x02 // VECTOR_DMP_SET_PROPERTY
    pkt[118] = 0xa1 // address type & data type
    pkt.writeUInt16BE(0x0000, 119) // first property address
    pkt.writeUInt16BE(0x0001, 121) // address increment
    pkt.writeUInt16BE(513, 123) // property value count
    pkt[125] = 0 // DMX start code
    pkt.set(p.data.subarray(0, 512), 126)
    const host = p.host || `239.255.${(uni >> 8) & 0xff}.${uni & 0xff}`
    s.send(pkt, SACN_PORT, host)
  }

  /** WLED's DNRGB : a universe is 170 RGB LEDs (no LED straddles two), so
   *  universe u starts at LED u × 170. */
  private wled(s: Socket, p: DmxPacket): void {
    if (!p.data) return
    const start = Math.max(0, p.universe | 0) * 170
    const pkt = Buffer.alloc(4 + 510)
    pkt[0] = 4 // DNRGB
    pkt[1] = 2 // timeout (s) : the LEDs go back to WLED's own if the stream stops
    pkt[2] = (start >> 8) & 0xff
    pkt[3] = start & 0xff
    pkt.set(p.data.subarray(0, 510), 4)
    s.send(pkt, WLED_PORT, p.host)
  }
}

// ── finding the lights on the network ───────────────────────────────────────

export interface ArtNode {
  ip: string
  name: string // its short name
  long: string // its long name
  universes: number[] // its output ports' universes (15-bit, as the patch counts them)
}
export interface WledNode {
  ip: string
  name: string
}

/** Every IPv4 broadcast this computer can reach : the limited one and each network's own. */
function broadcasts(): string[] {
  const out = new Set<string>(['255.255.255.255'])
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue
      const ip = a.address.split('.').map(Number), m = a.netmask.split('.').map(Number)
      if (ip.length !== 4 || m.length !== 4) continue
      out.add(ip.map((v, i) => (v | (~m[i] & 255)) & 255).join('.'))
    }
  }
  return [...out]
}

/** An ArtPollReply read (null : not one). */
export function parseArtPollReply(m: Buffer): ArtNode | null {
  if (m.length < 207 || m.toString('latin1', 0, 8) !== 'Art-Net\0' || m.readUInt16LE(8) !== 0x2100) return null
  const ip = `${m[10]}.${m[11]}.${m[12]}.${m[13]}`
  const str = (a: number, b: number): string => m.toString('latin1', a, b).replace(/\0[\s\S]*$/, '').trim()
  const net = m[18] & 0x7f, sub = m[19] & 0x0f
  const ports = Math.min(4, m[173])
  const universes: number[] = []
  for (let i = 0; i < ports; i++) {
    // (a port that can output DMX : bit 7 of its type)
    if (m[174 + i] & 0x80) universes.push((net << 8) | (sub << 4) | (m[190 + i] & 0x0f))
  }
  return { ip, name: str(26, 44), long: str(44, 108), universes }
}

type MdnsRec = { name: string; type: string; data: unknown }

/** WLED controllers in an mDNS response (their _wled._tcp services). */
export function wledFromResponse(p: { answers?: MdnsRec[]; additionals?: MdnsRec[] }, into: Map<string, { host?: string }>, hosts: Map<string, string>): void {
  const all = [...(p.answers ?? []), ...(p.additionals ?? [])]
  for (const r of all) {
    const name = String(r.name ?? '')
    if (r.type === 'PTR' && name.toLowerCase() === '_wled._tcp.local' && typeof r.data === 'string') {
      if (!into.has(r.data)) into.set(r.data, {})
    } else if (r.type === 'SRV' && /\._wled\._tcp\.local$/i.test(name)) {
      const e = into.get(name) ?? {}
      e.host = String((r.data as { target?: string } | null)?.target ?? '')
      into.set(name, e)
    } else if (r.type === 'A' && typeof r.data === 'string') {
      hosts.set(name.toLowerCase(), r.data)
    }
  }
}

/** Ask the network who is there, for `ms` : Art-Net nodes (ArtPoll, to every
 *  broadcast, or to `targets`) and WLED controllers (mDNS). Read only : the
 *  poll and the query ask, they set nothing. */
export async function discoverLights(opts: { targets?: string[]; ms?: number; wled?: boolean } = {}): Promise<{ artnet: ArtNode[]; wled: WledNode[] }> {
  const ms = Math.max(300, Math.min(5000, opts.ms ?? 1500))
  const nodes = new Map<string, ArtNode>()
  const sock = createSocket({ type: 'udp4', reuseAddr: true })
  sock.on('message', (m) => {
    const n = parseArtPollReply(m)
    if (!n) return
    const had = nodes.get(n.ip)
    if (had) { for (const u of n.universes) if (!had.universes.includes(u)) had.universes.push(u) }
    else nodes.set(n.ip, n)
  })
  // replies come to port 6454 (the standard), or straight back to where the poll came from
  await new Promise<void>((resolve) => {
    let done = false
    const ok = (): void => { if (!done) { done = true; resolve() } }
    sock.once('error', () => {
      sock.on('error', () => {})
      try { sock.bind(0, ok) } catch { ok() }
    })
    try { sock.bind(6454, ok) } catch { ok() }
  })
  sock.on('error', () => {})
  try { sock.setBroadcast(true) } catch { /* unicast still works */ }
  const poll = Buffer.alloc(14)
  poll.write('Art-Net\0', 0, 'latin1')
  poll.writeUInt16LE(0x2000, 8) // OpPoll
  poll.writeUInt16BE(14, 10)
  poll[12] = 0 // flags : reply to this poll only
  poll[13] = 0
  for (const t of opts.targets ?? broadcasts()) { try { sock.send(poll, 6454, t) } catch { /* unreachable */ } }
  // WLED : mDNS
  const wl = new Map<string, { host?: string }>()
  const hosts = new Map<string, string>()
  let md: ReturnType<typeof makeMdns> | null = null
  if (opts.wled !== false) {
    try {
      md = makeMdns({ reuseAddr: true })
      md.on('error', () => {})
      md.on('warning', () => {})
      md.on('response', (p: never) => wledFromResponse(p, wl, hosts))
      const ask = (): void => { try { md?.query({ questions: [{ name: '_wled._tcp.local', type: 'PTR' }] } as never) } catch { /* closed */ } }
      ask()
      setTimeout(ask, ms / 2)
    } catch { md = null }
  }
  await new Promise((r) => setTimeout(r, ms))
  try { sock.close() } catch { /* closed */ }
  try { md?.destroy() } catch { /* closed */ }
  const wled: WledNode[] = []
  for (const [inst, e] of wl) {
    const ip = e.host ? hosts.get(e.host.toLowerCase()) : undefined
    if (ip) wled.push({ ip, name: inst.replace(/\._wled\._tcp\.local$/i, '') })
  }
  return { artnet: [...nodes.values()].sort((a, b) => a.ip.localeCompare(b.ip)), wled }
}
