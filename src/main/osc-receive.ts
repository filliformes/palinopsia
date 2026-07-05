// OSC receiver — a UDP socket LISTENING on a local port; every inbound OSC
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
}

export class OscReceiver {
  private udp: osc.UDPPort | null = null
  private onMessage: ((m: OscInMessage) => void) | null = null
  private boundPort = 0

  setOnMessage(cb: (m: OscInMessage) => void): void {
    this.onMessage = cb
  }

  isListening(): boolean {
    return this.udp !== null
  }
  port(): number {
    return this.boundPort
  }

  /**
   * Start listening on `port` (bound to 0.0.0.0 so any interface reaches it).
   * Resolves once the socket is ready; rejects on a bind failure (e.g. the
   * port is already taken). Closes any existing socket first.
   */
  start(port: number): Promise<void> {
    this.stop()
    return new Promise((resolve, reject) => {
      const udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: port, metadata: true })
      let settled = false
      udp.on('ready', () => {
        this.boundPort = port
        this.udp = udp
        settled = true
        resolve()
      })
      udp.on('error', (err: Error) => {
        if (!settled) {
          settled = true
          this.udp = null
          reject(err)
        }
        // Post-ready errors are almost always a single malformed packet —
        // swallow them so one bad sender can't take the listener down.
      })
      udp.on('message', (msg) => {
        const m = msg as osc.OscMessage
        if (!this.onMessage || !m || typeof m.address !== 'string') return
        this.onMessage({
          timestamp: Date.now(),
          address: m.address,
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
    this.boundPort = 0
  }
}

/** Non-internal IPv4 addresses — shown in the UI so the user knows where to
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
