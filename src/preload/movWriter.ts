// A minimal QuickTime (.mov) writer for DXV3 video, in the layout libavformat
// writes and Resolume reads (checked against a Resolume "DXV Normal Quality"
// file) : ftyp 'qt  ', wide, mdat (the frames, as they come), then moov at the
// end. One sample per chunk, every sample a sync sample, one constant duration.
// Sizes past 4 GB : the 'wide' atom becomes the mdat's 64-bit header, and chunk
// offsets switch to co64.

import { openSync, writeSync, closeSync, write as writeAsync } from 'fs'

const u32 = (v: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b }
const u16 = (v: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff); return b }
const fourcc = (s: string): Buffer => Buffer.from(s, 'latin1')
const box = (type: string, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts)
  return Buffer.concat([u32(8 + body.length), fourcc(type), body])
}
const full = (type: string, version: number, flags: number, ...parts: Buffer[]): Buffer =>
  box(type, u32(((version & 255) << 24) | (flags & 0xffffff)), ...parts)
// A QuickTime "pascal" string (count byte + text), as hdlr names are written.
const pstr = (s: string): Buffer => Buffer.concat([Buffer.from([s.length]), Buffer.from(s, 'latin1')])
const MATRIX = Buffer.concat([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32))

export interface MovTrack {
  width: number
  height: number
  timescale: number // e.g. 30000
  sampleDelta: number // e.g. 1000 (30 fps) or 1001 (29.97)
  codec: string // 'DXD3'
  sizes: number[]
  offsets: number[]
}

/** The moov atom for one video track. */
export function buildMoov(t: MovTrack): Buffer {
  const n = t.sizes.length
  const mediaDur = n * t.sampleDelta
  const movieTs = 1000
  const movieDur = Math.round((mediaDur / t.timescale) * movieTs)
  const now = Math.floor(Date.now() / 1000) + 2082844800 // seconds since 1904
  const mvhd = full('mvhd', 0, 0,
    u32(now), u32(now), u32(movieTs), u32(movieDur),
    u32(0x00010000), u16(0x0100), Buffer.alloc(10), MATRIX, Buffer.alloc(24), u32(2))
  const tkhd = full('tkhd', 0, 0x0f,
    u32(now), u32(now), u32(1), u32(0), u32(movieDur), Buffer.alloc(8),
    u16(0), u16(0), u16(0), u16(0), MATRIX, u32(t.width * 65536), u32(t.height * 65536))
  const edts = box('edts', full('elst', 0, 0, u32(1), u32(movieDur), u32(0), u32(0x00010000)))
  const mdhd = full('mdhd', 0, 0, u32(now), u32(now), u32(t.timescale), u32(mediaDur), u16(0), u16(0))
  const hdlrM = full('hdlr', 0, 0, fourcc('mhlr'), fourcc('vide'), Buffer.alloc(12), pstr('VideoHandler'))
  const vmhd = full('vmhd', 0, 1, u16(0), Buffer.alloc(6))
  const hdlrD = full('hdlr', 0, 0, fourcc('dhlr'), fourcc('url '), Buffer.alloc(12), pstr('DataHandler'))
  const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)))
  // The sample entry, byte for byte as libavformat writes it for DXV.
  const entry = box(t.codec,
    Buffer.alloc(6), u16(1), // reserved, data reference index
    u16(0), u16(0), fourcc('FFMP'), u32(0x200), u32(0x200), // version, revision, vendor, qualities
    u16(t.width), u16(t.height), u32(0x00480000), u32(0x00480000), // size, 72 dpi
    u32(0), u16(1), Buffer.alloc(32), // data size, frames per sample, compressor name
    u16(24), u16(0xffff)) // depth, no colour table
  const stsd = full('stsd', 0, 0, u32(1), entry)
  const stts = full('stts', 0, 0, u32(1), u32(n), u32(t.sampleDelta))
  const stsc = full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1))
  const szBuf = Buffer.alloc(n * 4)
  t.sizes.forEach((s, i) => szBuf.writeUInt32BE(s, i * 4))
  const stsz = full('stsz', 0, 0, u32(0), u32(n), szBuf)
  const big = t.offsets.some((o) => o > 0xffffffff)
  const coBuf = Buffer.alloc(n * (big ? 8 : 4))
  t.offsets.forEach((o, i) => (big ? coBuf.writeBigUInt64BE(BigInt(o), i * 8) : coBuf.writeUInt32BE(o, i * 4)))
  const stco = full(big ? 'co64' : 'stco', 0, 0, u32(n), coBuf)
  const stbl = box('stbl', stsd, stts, stsc, stsz, stco)
  const minf = box('minf', vmhd, hdlrD, dinf, stbl)
  const mdia = box('mdia', mdhd, hdlrM, minf)
  const trak = box('trak', tkhd, edts, mdia)
  return box('moov', mvhd, trak)
}

/** Streams samples into a .mov file; `finish()` writes the index. Appends are
 *  asynchronous (the page's thread never waits on the disk) and strictly in order. */
export class MovWriter {
  private fd: number
  private pos: number
  private sizes: number[] = []
  private offsets: number[] = []
  private chain: Promise<void> = Promise.resolve()
  /** Bytes handed over and not yet on disk. */
  queued = 0
  failed: Error | null = null

  constructor(readonly path: string, private track: Omit<MovTrack, 'sizes' | 'offsets'>) {
    this.fd = openSync(path, 'w')
    const ftyp = box('ftyp', fourcc('qt  '), u32(0x200), fourcc('qt  '))
    const wide = box('wide') // room to grow the mdat header to 64 bits
    const mdatHdr = Buffer.concat([u32(0), fourcc('mdat')]) // size patched at the end
    const head = Buffer.concat([ftyp, wide, mdatHdr])
    writeSync(this.fd, head, 0, head.length, 0)
    this.pos = head.length // = 36 : where the first frame lands, as in Resolume's files
  }

  /** Queue one sample, `repeat` times (a frame that covers several ticks). */
  append(data: Uint8Array, repeat = 1): void {
    for (let r = 0; r < repeat; r++) {
      const at = this.pos
      this.sizes.push(data.length)
      this.offsets.push(at)
      this.pos += data.length
      this.queued += data.length
      this.chain = this.chain.then(
        () =>
          new Promise<void>((res) => {
            writeAsync(this.fd, data, 0, data.length, at, (err) => {
              this.queued -= data.length
              if (err && !this.failed) this.failed = err
              res()
            })
          })
      )
    }
  }

  get frames(): number {
    return this.sizes.length
  }

  /** Wait for every append, write the index, close. */
  async finish(): Promise<void> {
    await this.chain
    const mdatSize = this.pos - 28
    if (mdatSize > 0xffffffff) {
      // 64-bit mdat : its header takes over the 'wide' atom (8 + 8 bytes at 20).
      const h = Buffer.alloc(16)
      h.writeUInt32BE(1, 0)
      h.write('mdat', 4, 'latin1')
      h.writeBigUInt64BE(BigInt(this.pos - 20), 8)
      writeSync(this.fd, h, 0, 16, 20)
    } else {
      writeSync(this.fd, u32(mdatSize), 0, 4, 28)
    }
    const moov = buildMoov({ ...this.track, sizes: this.sizes, offsets: this.offsets })
    writeSync(this.fd, moov, 0, moov.length, this.pos)
    closeSync(this.fd)
    if (this.failed) throw this.failed
  }
}
