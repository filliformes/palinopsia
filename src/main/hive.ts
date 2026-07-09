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
    if (starts.length < 2) return // need the next start code to close a NAL
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

const sockets = new Map<string, net.Socket>()

/** Connect to a HIVE sender and stream access units to `wc` as `hive:au`. */
export function hiveConnect(wc: WebContents, id: string, host: string, port: number): void {
  hiveDisconnect(id)
  let ts = 0
  const parser = new AnnexBParser((data, key) => {
    if (wc.isDestroyed()) return
    wc.send('hive:au', { id, key, timestamp: ts, data: new Uint8Array(data) })
    ts += 33333 // ~30fps µs step; decode order only, presentation is live
  })
  const sock = net.connect(port, host)
  sock.on('data', (d: Buffer) => parser.push(d))
  sock.on('error', (e) => {
    console.error('[hive]', id, (e as Error).message)
    if (!wc.isDestroyed()) wc.send('hive:status', { id, ok: false, error: (e as Error).message })
  })
  sock.on('close', () => sockets.delete(id))
  sock.on('connect', () => {
    if (!wc.isDestroyed()) wc.send('hive:status', { id, ok: true })
  })
  sockets.set(id, sock)
}

export function hiveDisconnect(id: string): void {
  const s = sockets.get(id)
  if (s) {
    s.destroy()
    sockets.delete(id)
  }
}

export function hiveDisconnectAll(): void {
  for (const s of sockets.values()) s.destroy()
  sockets.clear()
}
