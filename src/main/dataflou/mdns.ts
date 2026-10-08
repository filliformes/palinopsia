// mDNS for the dataflou node : announce `<name>._dataflou._tcp.local` and browse
// for the others, on multicast-dns directly. bonjour-service was not usable here :
// its announcements put the service-type PTR between our SRV and our A record,
// and dataflou's reference parser (mdns_mjansson.cpp) gives each PTR its own
// entry, so our address landed on the wrong one and we fell back to the packet's
// sender (127.0.0.1 on one machine) on every announcement, then back to the LAN
// address on every query reply : the peer reconnected each time (measured : 5
// reconnects in 45 s). So every packet here is shaped the way that parser reads
// it : the PTR first, then SRV, TXT and ONE A record.

import makeMdns from 'multicast-dns'
import * as dgram from 'dgram'
import { networkInterfaces } from 'os'

const TYPE = '_dataflou._tcp.local'

export interface FoundService {
  instance: string
  address: string
  port: number
  txt: Record<string, string>
}

interface Partial {
  port?: number
  target?: string
  txt?: Record<string, string>
  from: string
  lastUp?: string
}

/** The IPv4 address the others reach us on : the one the OS routes from (asked
 *  of the default route, then of the mDNS group; connecting a UDP socket sends
 *  nothing), else the first ordinary interface. Never loopback : on Windows the
 *  multicast route answers 127.0.0.1, and a node elsewhere would dial itself. */
export async function primaryIPv4(): Promise<string> {
  const via = (host: string, port: number): Promise<string | null> =>
    new Promise((res) => {
      const s = dgram.createSocket('udp4')
      const done = (v: string | null): void => {
        try { s.close() } catch { /* closed */ }
        res(v)
      }
      s.once('error', () => done(null))
      try {
        s.connect(port, host, () => {
          try {
            const a = s.address().address
            done(a && a !== '0.0.0.0' && !a.startsWith('127.') ? a : null)
          } catch {
            done(null)
          }
        })
      } catch {
        done(null)
      }
    })
  const routed = (await via('8.8.8.8', 53)) ?? (await via('224.0.0.251', 5353))
  if (routed) return routed
  const virt = /vethernet|virtualbox|vmware|hyper-v|wsl|loopback|bluetooth|tailscale|zerotier|docker/i
  let fallback = '127.0.0.1'
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal || ni.address.startsWith('169.254.')) continue
      if (!virt.test(name)) return ni.address
      fallback = ni.address
    }
  }
  return fallback
}

export class DataflouMdns {
  private mdns: ReturnType<typeof makeMdns> | null = null
  private timers: ReturnType<typeof setTimeout>[] = []
  private found = new Map<string, Partial>()
  private hosts = new Map<string, string>() // host name → IPv4
  private instance = ''
  private host = ''

  constructor(
    private onUp: (s: FoundService) => void,
    private onDown: (instance: string) => void,
    private onError: (e: Error) => void
  ) {}

  start(name: string, port: number, txt: Record<string, string>, address: string): void {
    this.instance = `${name}.${TYPE}`
    this.host = `${name}.local`
    const mdns = makeMdns({ reuseAddr: true })
    this.mdns = mdns
    mdns.on('error', (e: Error) => this.onError(e))
    mdns.on('warning', () => { /* a bad packet from someone : ignore */ })
    const records = (ttl: number) => ({
      ptr: { name: TYPE, type: 'PTR', ttl, data: this.instance },
      srv: { name: this.instance, type: 'SRV', ttl, data: { port, target: this.host, priority: 0, weight: 0 } },
      txt: { name: this.instance, type: 'TXT', ttl: ttl ? 4500 : 0, data: Object.entries(txt).map(([k, v]) => `${k}=${v}`) },
      a: { name: this.host, type: 'A', ttl, data: address }
    })
    const full = (ttl: number) => {
      const r = records(ttl)
      return { answers: [r.ptr], additionals: [r.srv, r.txt, r.a] }
    }
    this.goodbye = () => {
      try { mdns.respond(full(0)) } catch { /* closing */ }
    }
    mdns.on('query', (q: MdnsPacket, rinfo: dgram.RemoteInfo) => {
      const r = records(120)
      let packet: { answers: MdnsRecord[]; additionals: MdnsRecord[] } | null = null
      for (const qq of q.questions ?? []) {
        const n = qq.name.toLowerCase()
        if (n === TYPE.toLowerCase() && (qq.type === 'PTR' || qq.type === 'ANY')) packet = full(120)
        else if (n === this.instance.toLowerCase()) packet ??= { answers: [r.srv, r.txt], additionals: [r.a] }
        else if (n === this.host.toLowerCase() && (qq.type === 'A' || qq.type === 'ANY')) packet ??= { answers: [r.a], additionals: [] }
      }
      if (!packet) return
      // A query from a port other than 5353 is a one-shot (legacy) query : answer
      // it straight back, as dataflou's own browse expects.
      if (rinfo.port !== 5353) mdns.respond({ ...packet, id: q.id } as never, { port: rinfo.port, address: rinfo.address })
      else mdns.respond(packet as never)
    })
    mdns.on('response', (p: MdnsPacket, rinfo: dgram.RemoteInfo) => this.onResponse(p, rinfo))
    // Announce (at once, then 1 s and 3 s later, then every 30 s) and browse.
    const announce = (): void => {
      try { mdns.respond(full(120) as never) } catch { /* closing */ }
    }
    const browse = (): void => {
      try { mdns.query({ questions: [{ name: TYPE, type: 'PTR' }] } as never) } catch { /* closing */ }
    }
    announce()
    browse()
    this.timers.push(setTimeout(announce, 1000), setTimeout(browse, 1200), setTimeout(announce, 3000))
    this.timers.push(setInterval(announce, 30_000), setInterval(browse, 15_000))
  }

  private goodbye: () => void = () => {}

  stop(): void {
    for (const t of this.timers) clearTimeout(t as ReturnType<typeof setTimeout>)
    for (const t of this.timers) clearInterval(t as ReturnType<typeof setInterval>)
    this.timers = []
    if (!this.mdns) return
    this.goodbye()
    const m = this.mdns
    this.mdns = null
    setTimeout(() => {
      try { m.destroy() } catch { /* gone */ }
    }, 50)
  }

  private onResponse(p: MdnsPacket, rinfo: dgram.RemoteInfo): void {
    const all = [...(p.answers ?? []), ...(p.additionals ?? [])]
    if (!all.some((r) => r.name.toLowerCase().endsWith(TYPE.toLowerCase()))) return
    const touched = new Set<string>()
    for (const r of all) if (r.type === 'A' && typeof r.data === 'string') this.hosts.set(r.name.toLowerCase(), r.data)
    for (const r of all) {
      if (r.type === 'PTR' && r.name.toLowerCase() === TYPE.toLowerCase() && typeof r.data === 'string') {
        const inst = r.data
        if (inst === this.instance) continue
        if (r.ttl === 0) {
          this.found.delete(inst)
          this.onDown(inst)
          continue
        }
        if (!this.found.has(inst)) this.found.set(inst, { from: rinfo.address })
        this.found.get(inst)!.from = rinfo.address
        touched.add(inst)
      } else if (r.type === 'SRV' && r.name.toLowerCase().endsWith(TYPE.toLowerCase()) && r.name !== this.instance) {
        const f = this.found.get(r.name) ?? { from: rinfo.address }
        const d = r.data as { port: number; target: string }
        f.port = d.port
        f.target = d.target
        this.found.set(r.name, f)
        touched.add(r.name)
      } else if (r.type === 'TXT' && r.name.toLowerCase().endsWith(TYPE.toLowerCase()) && r.name !== this.instance) {
        const f = this.found.get(r.name) ?? { from: rinfo.address }
        const kv: Record<string, string> = {}
        for (const b of (Array.isArray(r.data) ? r.data : [r.data]) as Array<Buffer | string>) {
          const s = typeof b === 'string' ? b : Buffer.from(b).toString('utf8')
          const i = s.indexOf('=')
          if (i > 0) kv[s.slice(0, i)] = s.slice(i + 1)
        }
        f.txt = kv
        this.found.set(r.name, f)
        touched.add(r.name)
      }
    }
    for (const inst of touched) {
      const f = this.found.get(inst)
      if (!f || !f.port || !f.txt) {
        // the rest of it (SRV / TXT) : ask for the instance itself
        if (f && this.mdns) try { this.mdns.query({ questions: [{ name: inst, type: 'ANY' }] } as never) } catch { /* closing */ }
        continue
      }
      const address = (f.target && this.hosts.get(f.target.toLowerCase())) || f.from
      const key = `${address}:${f.port}:${f.txt.sku ?? ''}:${f.txt.univ ?? ''}`
      if (f.lastUp === key) continue
      f.lastUp = key
      this.onUp({ instance: inst, address, port: f.port, txt: f.txt })
    }
  }
}

interface MdnsRecord {
  name: string
  type: string
  ttl?: number
  data?: unknown
}
interface MdnsPacket {
  id?: number
  questions?: Array<{ name: string; type: string }>
  answers?: MdnsRecord[]
  additionals?: MdnsRecord[]
}
