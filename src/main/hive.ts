// HIVE receiver (main process) : HIVE streams raw HEVC (H.265) Annex-B over a
// plain TCP socket (mDNS-discovered; we take host:port directly, which HIVE's
// `hive-recv listen --host --port` also supports). We connect, split the byte
// stream into HEVC access units, tag each key/delta, and forward them to the
// renderer, which decodes via WebCodecs and uploads to a GL texture.
//
// EXPERIMENTAL: hinges on Chromium's platform HEVC decoder being available
// (we request the feature flag in index.ts). If HEVC WebCodecs isn't supported
// on the host, the source stays black and logs : capture / Live Input remain
// the reliable live-in paths.

import net from 'net'
import type { WebContents } from 'electron'
import { Bonjour, type Service } from 'bonjour-service'

/** Streaming HEVC Annex-B → access-unit splitter. */
class AnnexBParser {
  private buf: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private au: Buffer[] = []
  private auHasVCL = false
  private auHasKey = false
  constructor(private onAU: (data: Buffer, key: boolean) => void) {}

  push(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    const starts: number[] = []
    for (let i = 0; i + 3 <= this.buf.length; ) {
      if (this.buf[i] === 0 && this.buf[i + 1] === 0 && this.buf[i + 2] === 1) {
        starts.push(i)
        i += 3
      } else i++
    }
    if (starts.length < 2) {
      // Guard against a malformed / handshake-less peer that never emits a second
      // start code : without this, `buf` concatenates every received byte for the
      // life of the connection and slowly leaks the main process. Drop all but a
      // trailing few bytes (a start code could straddle the cap boundary).
      const MAX_BUF = 8 * 1024 * 1024
      if (this.buf.length > MAX_BUF) this.buf = Buffer.from(this.buf.subarray(this.buf.length - 3))
      return // need the next start code to close a NAL
    }
    for (let s = 0; s < starts.length - 1; s++) {
      const nalStart = starts[s] + 3
      let end = starts[s + 1]
      while (end > nalStart && this.buf[end - 1] === 0) end-- // trim 4-byte-start padding
      if (end > nalStart) this.handleNal(this.buf.subarray(nalStart, end))
    }
    this.buf = Buffer.from(this.buf.subarray(starts[starts.length - 1])) // keep the trailing partial NAL
  }

  private handleNal(nal: Buffer): void {
    if (nal.length < 3) return
    const type = (nal[0] >> 1) & 0x3f
    const isVCL = type <= 31
    // first_slice_segment_in_pic_flag → a new picture begins.
    if (isVCL && (nal[2] & 0x80) !== 0 && this.auHasVCL) this.flush()
    this.au.push(Buffer.from([0, 0, 0, 1]), Buffer.from(nal))
    if (isVCL) this.auHasVCL = true
    if (type >= 16 && type <= 21) this.auHasKey = true // IRAP / IDR / CRA → keyframe
  }

  private flush(): void {
    if (!this.au.length) return
    this.onAU(Buffer.concat(this.au), this.auHasKey)
    this.au = []
    this.auHasVCL = false
    this.auHasKey = false
  }
}

// ── The connection, after HIVE's receiver contract (docs/RFC-sender-client-lifecycle.md,
// 2026-10-05; the rules only, written here) ──
// · the receiver reconnects by itself when the stream drops, with an exponential
//   backoff and FULL jitter (a random wait up to the current ceiling), capped, and
//   reset only once a connection has proven stable (a keyframe arrived and it held
//   STABLE_MS), never merely on connect : a sender that accepts then closes cannot
//   be stormed;
// · a link that goes silent (a half-open peer) is dropped after SILENT_MS and retried;
// · a stream picked by NAME is looked up again over mDNS before every attempt, so it
//   follows its sender to a new address or port.
const BACKOFF_MIN = 250
const BACKOFF_MAX = 5000
const STABLE_MS = 3000
const SILENT_MS = 5000

interface Link {
  id: string
  wc: WebContents
  host: string
  port: number
  name: string | null
  sock: net.Socket | null
  attempt: number
  retry: ReturnType<typeof setTimeout> | null
  silent: ReturnType<typeof setTimeout> | null
  stable: ReturnType<typeof setTimeout> | null
  closed: boolean // disconnected on purpose : never retried
}
const links = new Map<string, Link>()

// ── mDNS : the HIVE senders on the network (_hive._udp, HIVE's historical type) ──
let browser: { stop(): void } | null = null
let browserBonjour: Bonjour | null = null
const seen = new Map<string, { name: string; host: string; port: number; at: number }>()

function startBrowsing(): void {
  if (browser) return
  try {
    browserBonjour = new Bonjour()
    const b = browserBonjour.find({ type: 'hive', protocol: 'udp' })
    const add = (svc: Service): void => {
      const host = (svc.addresses ?? []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? svc.host
      const port = Number((svc.txt as Record<string, unknown> | undefined)?.port ?? svc.port)
      if (!svc.name || !host || !Number.isInteger(port) || port < 1 || port > 65535) return
      seen.set(svc.name, { name: svc.name, host, port, at: Date.now() })
    }
    // up, a sender's address or TXT changing (srv-update, txt-update), down
    const ev = b as unknown as { on(ev: string, cb: (svc: Service) => void): void }
    ev.on('up', add)
    ev.on('srv-update', add)
    ev.on('txt-update', add)
    ev.on('down', (svc) => seen.delete(svc.name))
    browser = b
  } catch (e) {
    console.warn('[hive] mDNS browse failed:', (e as Error).message)
  }
}

/** The HIVE senders seen on the network (the picker lists them). */
export function hiveBrowse(): Array<{ name: string; host: string; port: number }> {
  startBrowsing()
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, host, port }) => ({ name, host, port }))
}

function status(l: Link, ok: boolean, error?: string, retryInMs?: number): void {
  if (!l.wc.isDestroyed()) l.wc.send('hive:status', { id: l.id, ok, ...(error ? { error } : {}), ...(retryInMs !== undefined ? { retryInMs } : {}) })
}

function clearTimers(l: Link): void {
  for (const k of ['retry', 'silent', 'stable'] as const) {
    if (l[k]) { clearTimeout(l[k]!); l[k] = null }
  }
}

function scheduleRetry(l: Link, why: string): void {
  if (l.closed || l.retry) return
  const ceiling = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** l.attempt)
  const wait = Math.round(BACKOFF_MIN / 2 + Math.random() * ceiling) // full jitter over the ceiling
  l.attempt = Math.min(l.attempt + 1, 10)
  status(l, false, why, wait)
  l.retry = setTimeout(() => { l.retry = null; open(l) }, wait)
}

function open(l: Link): void {
  if (l.closed) return
  // a named stream : where its sender is now
  if (l.name) {
    const found = seen.get(l.name)
    if (found) { l.host = found.host; l.port = found.port }
  }
  let ts = 0
  let gotKey = false
  const parser = new AnnexBParser((data, key) => {
    if (l.wc.isDestroyed()) return
    if (key && !gotKey) {
      gotKey = true
      // stable once it has streamed for a while after its first keyframe : only
      // then does the backoff start again from the bottom
      l.stable = setTimeout(() => { l.stable = null; l.attempt = 0 }, STABLE_MS)
    }
    l.wc.send('hive:au', { id: l.id, key, timestamp: ts, data: new Uint8Array(data) })
    ts += 33333 // ~30fps µs step; decode order only, presentation is live
  })
  const sock = net.connect(l.port, l.host)
  l.sock = sock
  sock.setKeepAlive(true, 2000)
  const armSilent = (): void => {
    if (l.silent) clearTimeout(l.silent)
    l.silent = setTimeout(() => { l.silent = null; sock.destroy(new Error('no data for 5 s')) }, SILENT_MS)
  }
  sock.on('connect', () => { status(l, true); armSilent() })
  sock.on('data', (d: Buffer) => { armSilent(); parser.push(d) })
  let reason = 'the stream closed'
  sock.on('error', (e) => {
    reason = (e as Error).message
    console.error('[hive]', l.id, reason)
  })
  sock.on('close', () => {
    if (l.sock === sock) l.sock = null
    if (l.silent) { clearTimeout(l.silent); l.silent = null }
    if (l.stable) { clearTimeout(l.stable); l.stable = null }
    scheduleRetry(l, reason)
  })
}

/** Connect to a HIVE sender and stream access units to `wc` as `hive:au`; reconnects
 *  by itself until hiveDisconnect. `name` : the sender's mDNS name, looked up again
 *  before every attempt. */
export function hiveConnect(wc: WebContents, id: string, host: string, port: number, name?: string | null): void {
  hiveDisconnect(id)
  // Validate before net.connect : an out-of-range / non-integer port throws
  // synchronously (ERR_SOCKET_BAD_PORT), which would otherwise crash the main
  // process from the fire-and-forget IPC handler.
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    if (!wc.isDestroyed()) wc.send('hive:status', { id, ok: false, error: `Invalid port: ${port}` })
    return
  }
  const l: Link = { id, wc, host, port, name: name && name.length < 200 ? name : null, sock: null, attempt: 0, retry: null, silent: null, stable: null, closed: false }
  if (l.name) startBrowsing()
  links.set(id, l)
  open(l)
}

export function hiveDisconnect(id: string): void {
  const l = links.get(id)
  if (!l) return
  l.closed = true
  clearTimers(l)
  l.sock?.destroy()
  links.delete(id)
}

export function hiveDisconnectAll(): void {
  for (const id of [...links.keys()]) hiveDisconnect(id)
  try { browser?.stop(); browserBonjour?.destroy() } catch { /* already gone */ }
  browser = null
  browserBonjour = null
}
