// HIVE sender (output) : the open NDI-alternative. The renderer encodes the
// composite to HEVC (WebCodecs) and streams Annex-B chunks here; we run a plain
// TCP server that fans the raw HEVC Annex-B out to every connected HIVE receiver
// (OBS HIVE plugin, hive-recv, hive-web …), and advertise over mDNS. New clients
// are gated to the next keyframe so they can start decoding immediately.
//
// Protocol (HIVE SDD): raw HEVC Annex-B, no framing/handshake; VPS/SPS/PPS on
// every IDR; mDNS service type _hive._udp with a TXT record. EXPERIMENTAL —
// depends on the host having a WebCodecs HEVC *encoder*.

import net from 'net'
import os from 'os'
import { Bonjour, type Service } from 'bonjour-service'
import type { WebContents } from 'electron'

interface Client {
  sock: net.Socket
  live: boolean
}

let server: net.Server | null = null
let clients: Client[] = []
let bonjour: Bonjour | null = null
let service: Service | null = null
let wc: WebContents | null = null

export function hiveSendStart(webContents: WebContents, port: number): { ok: boolean; port: number } {
  hiveSendStop()
  wc = webContents
  server = net.createServer((sock) => {
    sock.setNoDelay(true)
    const c: Client = { sock, live: false }
    clients.push(c)
    sock.on('close', () => (clients = clients.filter((x) => x !== c)))
    sock.on('error', () => (clients = clients.filter((x) => x !== c)))
    // Ask the encoder for a keyframe so this client can start streaming ASAP.
    if (wc && !wc.isDestroyed()) wc.send('hive:forceKey')
  })
  server.on('error', (e) => console.error('[hive-send]', (e as Error).message))
  server.listen(port, '0.0.0.0')

  try {
    bonjour = new Bonjour()
    service = bonjour.publish({
      name: `Palinopsia-${os.hostname()}`,
      type: 'hive', // HIVE's historical service type is _hive._udp
      protocol: 'udp',
      port,
      txt: {
        name: 'Palinopsia',
        transport: 'tcp',
        codec: 'hevc',
        profile: 'main',
        bitrate: '80000000',
        port: String(port)
      }
    })
  } catch (e) {
    console.warn('[hive-send] mDNS advertise failed:', (e as Error).message)
  }
  return { ok: true, port }
}

/** A HEVC Annex-B chunk from the encoder → fan out to live clients. */
export function hiveSendChunk(key: boolean, data: Uint8Array): void {
  if (clients.length === 0) return
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  for (const c of clients) {
    if (!c.live) {
      if (!key) continue // pending clients wait for the first keyframe
      c.live = true
    }
    try {
      c.sock.write(buf)
    } catch {
      /* slow/broken client : dropped on its 'error'/'close' */
    }
  }
}

export function hiveSendStop(): void {
  try {
    service?.stop?.()
    bonjour?.destroy?.()
  } catch {
    /* ignore */
  }
  service = null
  bonjour = null
  for (const c of clients) c.sock.destroy()
  clients = []
  server?.close()
  server = null
  wc = null
}
