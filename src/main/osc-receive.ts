// OSC receiver : a UDP socket LISTENING on a local port; every inbound OSC
// message is handed to a callback. This is how the instrument is *played*:
// Pandore / TouchOSC / any OSC source sends here. Separate from OscSender
// (which owns an ephemeral outgoing socket) so send and receive can't stall
// each other.

import * as osc from 'osc'
import { networkInterfaces } from 'os'

export type OscInMessage = {
  timestamp: number
  address: string
  args: Array<{ type: string; value: number | string | boolean }>
  host?: string // the sender's IP (OSC Learn answers learned controls there)
  port?: number // the sender's UDP port (the connections view)
}

/** A multicast group address (224.0.0.0 to 239.255.255.255). */
export function isMulticastGroup(a: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a)
  return !!m && m.slice(1).every((o) => Number(o) <= 255) && Number(m[1]) >= 224 && Number(m[1]) <= 239
}

export class OscReceiver {
  private udp: osc.UDPPort | null = null
  // the multicast groups the socket joined, and the ones it could not
  joined: string[] = []
  failed: Array<{ group: string; error: string }> = []
  private onMessage: ((m: OscInMessage) => void) | null = null

  setOnMessage(cb: (m: OscInMessage) => void): void {
    this.onMessage = cb
  }

  /**
   * Start listening on `port` (bound to 0.0.0.0 so any interface reaches it).
   * Resolves once the socket is ready; rejects on a bind failure (e.g. the
   * port is already taken). Closes any existing socket first.
   */
  start(port: number, groups: string[] = []): Promise<void> {
    this.stop()
    this.joined = []
    this.failed = []
    return new Promise((resolve, reject) => {
      const udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: port, metadata: true })
      // Track the socket from the moment it's created, not only on 'ready', so a
      // stop() during an in-flight start() (before ready) can still close() it.
      // Otherwise the port stays bound and leaks until the next start()+stop().
      this.udp = udp
      let settled = false
      udp.on('ready', () => {
        // Join the multicast groups asked for (the socket listens on every interface :
        // a group's messages on the local network now reach it too). One refused
        // group never stops the others, nor the listener.
        const sock = (udp as unknown as { socket?: { addMembership(g: string): void } }).socket
        for (const g of groups.slice(0, 8)) {
          if (!isMulticastGroup(g)) { this.failed.push({ group: g, error: 'not a multicast address (224.0.0.0 to 239.255.255.255)' }); continue }
          try { sock?.addMembership(g); this.joined.push(g) } catch (e) { this.failed.push({ group: g, error: (e as Error).message }) }
        }
        settled = true
        resolve()
      })
      udp.on('error', (err: Error) => {
        if (!settled) {
          settled = true
          if (this.udp === udp) this.udp = null
          reject(err)
        }
        // Post-ready errors are almost always a single malformed packet —
        // swallow them so one bad sender can't take the listener down.
      })
      // (a bundle arrives here message by message : osc.js unpacks it)
      udp.on('message', (msg, _timeTag, info) => {
        // Ignore anything from a socket we've since stopped or replaced.
        if (this.udp !== udp) return
        const m = msg as osc.OscMessage
        if (!this.onMessage || !m || typeof m.address !== 'string') return
        const from = (info as { address?: unknown } | undefined)?.address
        const fromPort = (info as { port?: unknown } | undefined)?.port
        this.onMessage({
          timestamp: Date.now(),
          address: m.address,
          ...(typeof from === 'string' ? { host: from } : {}),
          ...(typeof fromPort === 'number' ? { port: fromPort } : {}),
          args: (m.args ?? []).map((a) => ({
            type: String(a.type),
            value: (a.value as number | string | boolean) ?? 0
          }))
        })
      })
      try {
        udp.open()
      } catch (e) {
        if (!settled) {
          settled = true
          this.udp = null
          reject(e as Error)
        }
      }
    })
  }

  stop(): void {
    if (this.udp) {
      try {
        this.udp.close()
      } catch {
        /* ignore */
      }
      this.udp = null
    }
  }
}

/** Non-internal IPv4 addresses : shown in the UI so the user knows where to
 *  point Pandore (`send to <ip>:<port>`). */
export function localIPv4s(): string[] {
  const out: string[] = []
  const ifaces = networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
    }
  }
  return out
}
