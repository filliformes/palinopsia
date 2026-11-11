// Lights over the network : DMX universes the renderer's Lights engine assembled
// (src/renderer/src/lights/lightEngine.ts), sent as Art-Net, sACN (E1.31) or
// WLED's realtime DNRGB. The Enttec USB Pro is driven from the renderer itself
// (Web Serial), so only the network outputs pass through here. Best-effort
// throughout : a bad host or a closed socket must never take down the main process.

import { createSocket, type Socket } from 'dgram'
import { randomBytes } from 'crypto'

const ARTNET_PORT = 6454
const SACN_PORT = 5568
const WLED_PORT = 21324

export interface DmxPacket {
  kind: 'artnet' | 'sacn' | 'wled'
  host: string
  universe: number
  data: Uint8Array // 512 channels
}

export class DmxSender {
  private sock: Socket | null = null
  private artSeq = 0
  private sacnSeq = new Map<number, number>()
  private readonly cid = randomBytes(16) // this sender's sACN identity, for this run

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
    for (const p of packets.slice(0, 256)) {
      if (!p || !(p.data instanceof Uint8Array)) continue
      try {
        if (p.kind === 'artnet' && p.host) this.artnet(s, p)
        else if (p.kind === 'sacn') this.sacn(s, p)
        else if (p.kind === 'wled' && p.host) this.wled(s, p)
      } catch {
        /* a malformed host : skip it */
      }
    }
  }

  private artnet(s: Socket, p: DmxPacket): void {
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
