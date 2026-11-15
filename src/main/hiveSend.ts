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
  since: number // when it attached (Date.now)
  pendingTimer: ReturnType<typeof setTimeout> | null
}

// The connection contract, after HIVE's own (docs/RFC-sender-client-lifecycle.md,
// 2026-10-05; the rules only, written here) :
// · a dead client is seen in bounded time in ANY state : the socket is read (we
//   discard what comes in), so a peer that closes is seen even while it waits for
//   its first keyframe; TCP keepalive catches a half-open one;
// · a client still waiting for a keyframe after PENDING_MS is dropped : the gate is
//   never a slot sink;
// · the cap is a safety valve : the dead are reaped before admitting, and at the cap
//   the oldest waiting client makes room, a streaming one is never refused for it;
// · a join asks the encoder for a keyframe, at most once per KEY_REQ_MS, so a
//   receiver retrying in a loop cannot make the encoder spit keyframes.
const MAX_CLIENTS = Math.max(1, Math.min(64, Number(process.env.OPSIA_HIVE_MAX_CLIENTS) || 16))
const PENDING_MS = 5000
const KEY_REQ_MS = 500
let lastKeyReq = 0
const stats = { attached: 0, refused: 0, reaped: 0 }
let lastStatsLog = 0

function dropClient(c: Client, why: 'reaped' | 'closed'): void {
  if (c.pendingTimer) { clearTimeout(c.pendingTimer); c.pendingTimer = null }
  const had = clients.includes(c)
  clients = clients.filter((x) => x !== c)
  if (had && why === 'reaped') stats.reaped++
  if (!c.sock.destroyed) c.sock.destroy()
}

/** Counters, logged at most once a minute when a client was refused or reaped. */
function logStats(): void {
  const now = Date.now()
  if (now - lastStatsLog < 60_000 || (!stats.refused && !stats.reaped)) return
  lastStatsLog = now
  const pending = clients.filter((c) => !c.live).length
  console.info(`[hive-send] clients ${clients.length} (${pending} waiting for a keyframe) · attached ${stats.attached} · refused ${stats.refused} · reaped ${stats.reaped}`)
}

/** The sender's counters (the Output page can show them). */
export function hiveSendStats(): { clients: number; pending: number; attached: number; refused: number; reaped: number } {
  return { clients: clients.length, pending: clients.filter((c) => !c.live).length, ...stats }
}

let server: net.Server | null = null
let clients: Client[] = []
let bonjour: Bonjour | null = null
let service: Service | null = null
let wc: WebContents | null = null

export function hiveSendStart(
  webContents: WebContents,
  port: number
): Promise<{ ok: boolean; port: number; error?: string }> {
  hiveSendStop()
  wc = webContents
  server = net.createServer((sock) => {
    sock.setNoDelay(true)
    // reap before admitting : any client whose socket is already gone
    for (const c of [...clients]) if (c.sock.destroyed) dropClient(c, 'reaped')
    if (clients.length >= MAX_CLIENTS) {
      // the oldest one still waiting for a keyframe makes room; never a streaming one
      const oldestPending = clients.filter((c) => !c.live).sort((a, b) => a.since - b.since)[0]
      if (oldestPending) dropClient(oldestPending, 'reaped')
      else {
        stats.refused++
        logStats()
        sock.destroy()
        return
      }
    }
    const c: Client = { sock, live: false, since: Date.now(), pendingTimer: null }
    clients.push(c)
    stats.attached++
    // liveness independent of the data path : read (and discard) whatever comes in,
    // so a FIN is seen at once even before the first write; keepalive for half-open peers
    sock.setKeepAlive(true, 2000)
    sock.on('data', () => { /* receivers send nothing : ignored */ })
    sock.on('end', () => dropClient(c, 'closed'))
    sock.on('close', () => dropClient(c, 'closed'))
    sock.on('error', () => dropClient(c, 'closed'))
    // a client that never gets a keyframe does not keep its slot
    c.pendingTimer = setTimeout(() => {
      c.pendingTimer = null
      if (!c.live) { dropClient(c, 'reaped'); logStats() }
    }, PENDING_MS)
    // Ask the encoder for a keyframe so this client can start streaming soon (at most
    // once per KEY_REQ_MS : one keyframe serves every client that joined meanwhile).
    const now = Date.now()
    if (now - lastKeyReq >= KEY_REQ_MS && wc && !wc.isDestroyed()) {
      lastKeyReq = now
      wc.send('hive:forceKey')
    }
  })
  // The bind result drives the return : a failed listen (EADDRINUSE …) must
  // report ok:false, never a phantom success (the UI would show output live
  // while nothing is bound). Resolve once, on 'listening' or the first 'error'.
  return new Promise((resolve) => {
    let settled = false
    server!.on('error', (e) => {
      console.error('[hive-send]', (e as Error).message)
      if (settled) return
      settled = true
      hiveSendStop()
      resolve({ ok: false, port, error: (e as Error).message })
    })
    server!.once('listening', () => {
      settled = true
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
      resolve({ ok: true, port })
    })
    server!.listen(port, '0.0.0.0')
  })
}

const HIVE_MAX_BACKLOG = 8 * 1024 * 1024

/** A HEVC Annex-B chunk from the encoder → fan out to live clients. */
export function hiveSendChunk(key: boolean, data: Uint8Array): void {
  if (clients.length === 0) return
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  for (const c of clients) {
    if (!c.live) {
      if (!key) continue // pending clients wait for the first keyframe
      c.live = true
      if (c.pendingTimer) { clearTimeout(c.pendingTimer); c.pendingTimer = null }
    }
    // A client that stops reading would make Node buffer every frame for it
    // (about 10 MB a second at 80 Mbit/s) until the app runs out of memory :
    // past 8 MB unread, it is dropped (it can connect again, from a keyframe).
    if (c.sock.writableLength > HIVE_MAX_BACKLOG) { c.sock.destroy(); continue }
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
  for (const c of [...clients]) dropClient(c, 'closed')
  clients = []
  server?.close()
  server = null
  wc = null
}
