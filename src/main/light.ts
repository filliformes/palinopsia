// Light output : turn the composite's zone grid into room light. The renderer
// mip-averages the frame into a small cols×rows grid (Compositor.captureZones)
// and ships it here; we map the zones to RGB and push over UDP as either
// ArtNet/DMX (universal : most consoles, LED controllers, dimmers) or WLED's
// realtime DNRGB (cheap addressable strips/matrices). Best-effort throughout :
// a bad host or a closed socket must never take down the main process.
//
// Zone buffer contract : RGBA8, cols*rows, BOTTOM-UP (row 0 = bottom of frame),
// matching Compositor.captureZones' GL readback orientation.

import { createSocket, type Socket } from 'dgram'
import type { LightConfig } from '@shared/types'

const ARTNET_PORT = 6454
const WLED_PORT = 21324
const DMX_UNIVERSE = 512

function corr(c: number, gamma: number, bright: number): number {
  const v = Math.pow((c < 0 ? 0 : c > 255 ? 255 : c) / 255, gamma) * bright
  return v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)
}

export class LightSender {
  private sock: Socket | null = null
  private cfg: LightConfig | null = null
  private artSeq = 0
  private wledSeq = 0
  private lastSend = 0

  setConfig(cfg: LightConfig | null): void {
    this.cfg = cfg
    const want = !!cfg?.enabled
    if (want && !this.sock) {
      try {
        this.sock = createSocket('udp4')
        this.sock.on('error', () => {}) // swallow : a bad host must not crash main
        this.sock.bind()
      } catch {
        this.sock = null
      }
    } else if (!want && this.sock) {
      try { this.sock.close() } catch { /* ignore */ }
      this.sock = null
    }
  }

  dispose(): void {
    if (this.sock) { try { this.sock.close() } catch { /* ignore */ } this.sock = null }
    this.cfg = null
  }

  /** zones : RGBA8, cols*rows, bottom-up (see file header). */
  send(cols: number, rows: number, zones: Uint8Array): void {
    const cfg = this.cfg
    if (!cfg || !cfg.enabled || !this.sock || !cfg.host) return
    const now = Date.now()
    if (now - this.lastSend < 1000 / Math.max(1, Math.min(60, cfg.fps || 40))) return
    this.lastSend = now
    const g = Math.max(0.1, Math.min(3, cfg.gamma || 1))
    const b = Math.max(0, Math.min(1, cfg.brightness))
    const n = cols * rows
    // Flatten to per-LED RGB, top-to-bottom (flip the bottom-up zones), applying
    // serpentine so a matrix wired boustrophedon lights up in the right order.
    const rgb = new Uint8Array(n * 3)
    let o = 0
    for (let ry = 0; ry < rows; ry++) {
      const srcRow = rows - 1 - ry
      for (let cx = 0; cx < cols; cx++) {
        const col = cfg.serpentine && ry % 2 === 1 ? cols - 1 - cx : cx
        const si = (srcRow * cols + col) * 4
        rgb[o++] = corr(zones[si], g, b)
        rgb[o++] = corr(zones[si + 1], g, b)
        rgb[o++] = corr(zones[si + 2], g, b)
      }
    }
    if (cfg.protocol === 'wled') this.sendWled(cfg, rgb, n)
    else this.sendArtnet(cfg, rgb, n)
  }

  private sendWled(cfg: LightConfig, rgb: Uint8Array, n: number): void {
    // WLED DNRGB (protocol 4) : [4, timeout, startHi, startLo, R,G,B ...].
    // Chunk to <=489 LEDs/packet to stay inside a safe UDP payload.
    const CHUNK = 489
    for (let start = 0; start < n; start += CHUNK) {
      const count = Math.min(CHUNK, n - start)
      const pkt = Buffer.alloc(4 + count * 3)
      pkt[0] = 4 // DNRGB
      pkt[1] = 2 // timeout (s) : LEDs revert to normal if the stream stops
      pkt[2] = (start >> 8) & 0xff
      pkt[3] = start & 0xff
      for (let i = 0; i < count * 3; i++) pkt[4 + i] = rgb[start * 3 + i]
      this.sock?.send(pkt, WLED_PORT, cfg.host)
    }
  }

  private sendArtnet(cfg: LightConfig, rgb: Uint8Array, n: number): void {
    // Build a flat DMX channel stream (order-swapped RGB per LED), then chop it
    // into 512-channel universes starting at `universe` / `startChannel`.
    const start = Math.max(1, Math.min(512, cfg.startChannel || 1)) - 1
    const dmx = new Uint8Array(start + n * 3)
    for (let i = 0; i < n; i++) {
      const r = rgb[i * 3], gg = rgb[i * 3 + 1], bb = rgb[i * 3 + 2]
      let a = r, c2 = gg, c3 = bb
      if (cfg.order === 'grb') { a = gg; c2 = r; c3 = bb }
      else if (cfg.order === 'brg') { a = bb; c2 = r; c3 = gg }
      else if (cfg.order === 'bgr') { a = bb; c2 = gg; c3 = r }
      const d = start + i * 3
      dmx[d] = a; dmx[d + 1] = c2; dmx[d + 2] = c3
    }
    let uni = Math.max(0, Math.min(32767, cfg.universe || 0))
    for (let off = 0; off < dmx.length; off += DMX_UNIVERSE, uni++) {
      const len = Math.min(DMX_UNIVERSE, dmx.length - off)
      const evenLen = len + (len & 1) // ArtDmx length must be even
      const pkt = Buffer.alloc(18 + evenLen)
      pkt.write('Art-Net\0', 0, 'latin1')
      pkt.writeUInt16LE(0x5000, 8) // OpOutput / ArtDmx
      pkt.writeUInt16BE(14, 10) // protocol version 14
      pkt[12] = this.artSeq = (this.artSeq + 1) & 0xff
      pkt[13] = 0 // physical
      pkt[14] = uni & 0xff // SubUni
      pkt[15] = (uni >> 8) & 0xff // Net
      pkt.writeUInt16BE(evenLen, 16) // data length
      for (let i = 0; i < len; i++) pkt[18 + i] = dmx[off + i]
      this.sock?.send(pkt, ARTNET_PORT, cfg.host)
    }
    void this.wledSeq
  }
}
