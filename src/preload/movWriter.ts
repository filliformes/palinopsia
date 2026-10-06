// A minimal QuickTime (.mov) writer for DXV3 video, in the layout libavformat
// writes and Resolume reads (checked against a Resolume "DXV Normal Quality"
// file) : ftyp 'qt  ', wide, mdat (the frames, as they come), then moov at the
// end. One sample per chunk, every sample a sync sample, one constant duration.
// Sizes past 4 GB : the 'wide' atom becomes the mdat's 64-bit header, and chunk
// offsets switch to co64.
//
// An optional SOUND track (the Sonify sound of the take) : 16-bit little-endian
// PCM ('sowt'), its chunks interleaved with the frames as they arrive, the
// track's atoms byte for byte as libavformat writes pcm_s16le in a .mov
// (version-0 sound description, a stereo 'chan' layout, one 4-byte sample per
// stereo frame, chunks of varying length).

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

export interface MovAudio {
  rate: number // sample rate (Hz, <= 65535 for a version-0 description)
  channels: number // 2
  chunks: Array<{ offset: number; frames: number }>
}

/** The sound track's trak atom. */
function audioTrak(a: MovAudio, movieTs: number, now: number): Buffer {
  const total = a.chunks.reduce((n, c) => n + c.frames, 0)
  const movieDur = Math.round((total / a.rate) * movieTs)
  const tkhd = full('tkhd', 0, 0x03,
    u32(now), u32(now), u32(2), u32(0), u32(movieDur), Buffer.alloc(8),
    u16(0), u16(1), u16(0x0100), u16(0), MATRIX, u32(0), u32(0)) // layer, alternate group, volume 1.0
  const edts = box('edts', full('elst', 0, 0, u32(1), u32(movieDur), u32(0), u32(0x00010000)))
  const mdhd = full('mdhd', 0, 0, u32(now), u32(now), u32(a.rate), u32(total), u16(0x7fff), u16(0))
  const hdlrM = full('hdlr', 0, 0, fourcc('mhlr'), fourcc('soun'), Buffer.alloc(12), pstr('SoundHandler'))
  const smhd = full('smhd', 0, 0, u16(0), u16(0))
  const hdlrD = full('hdlr', 0, 0, fourcc('dhlr'), fourcc('url '), Buffer.alloc(12), pstr('DataHandler'))
  const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)))
  const chan = full('chan', 0, 0, u32(a.channels === 2 ? 0x00650002 : 0x00640001), u32(0), u32(0)) // stereo / mono layout tag
  const entry = box('sowt',
    Buffer.alloc(6), u16(1), // reserved, data reference index
    u16(0), u16(0), u32(0), // version 0, revision, vendor
    u16(a.channels), u16(16), // channels, bits per sample
    u16(0), u16(0), // compression id, packet size
    u32(a.rate * 65536), // sample rate, 16.16
    chan)
  const stsd = full('stsd', 0, 0, u32(1), entry)
  const stts = full('stts', 0, 0, u32(1), u32(total), u32(1))
  // samples per chunk, run-length coded
  const runs: number[][] = []
  a.chunks.forEach((c, i) => { if (!runs.length || runs[runs.length - 1][1] !== c.frames) runs.push([i + 1, c.frames]) })
  const scBuf = Buffer.alloc(runs.length * 12)
  runs.forEach(([first, n], i) => { scBuf.writeUInt32BE(first, i * 12); scBuf.writeUInt32BE(n, i * 12 + 4); scBuf.writeUInt32BE(1, i * 12 + 8) })
  const stsc = full('stsc', 0, 0, u32(runs.length), scBuf)
  const stsz = full('stsz', 0, 0, u32(a.channels * 2), u32(total))
  const big = a.chunks.some((c) => c.offset > 0xffffffff)
  const coBuf = Buffer.alloc(a.chunks.length * (big ? 8 : 4))
  a.chunks.forEach((c, i) => (big ? coBuf.writeBigUInt64BE(BigInt(c.offset), i * 8) : coBuf.writeUInt32BE(c.offset, i * 4)))
  const stco = full(big ? 'co64' : 'stco', 0, 0, u32(a.chunks.length), coBuf)
  const stbl = box('stbl', stsd, stts, stsc, stsz, stco)
  const minf = box('minf', smhd, hdlrD, dinf, stbl)
  const mdia = box('mdia', mdhd, hdlrM, minf)
  return box('trak', tkhd, edts, mdia)
}

/** The moov atom : the video track, and the sound track when there is one. */
export function buildMoov(t: MovTrack, a?: MovAudio | null): Buffer {
  const n = t.sizes.length
  const mediaDur = n * t.sampleDelta
  const movieTs = 1000
  const movieDur = Math.round((mediaDur / t.timescale) * movieTs)
  const now = Math.floor(Date.now() / 1000) + 2082844800 // seconds since 1904
  const sound = a && a.chunks.length ? a : null
  const mvhd = full('mvhd', 0, 0,
    u32(now), u32(now), u32(movieTs), u32(movieDur),
    u32(0x00010000), u16(0x0100), Buffer.alloc(10), MATRIX, Buffer.alloc(24), u32(sound ? 3 : 2))
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
  return sound ? box('moov', mvhd, trak, audioTrak(sound, movieTs, now)) : box('moov', mvhd, trak)
}

/** Streams samples into a .mov file; `finish()` writes the index. Appends are
 *  asynchronous (the page's thread never waits on the disk) and strictly in order. */
export class MovWriter {
  private fd: number
  private pos: number
  private sizes: number[] = []
  private offsets: number[] = []
  private audio: MovAudio | null = null
  private chain: Promise<void> = Promise.resolve()
  /** Bytes handed over and not yet on disk. */
  queued = 0
  failed: Error | null = null

  constructor(readonly path: string, private track: Omit<MovTrack, 'sizes' | 'offsets'>, sound?: { rate: number; channels: number } | null) {
    if (sound && sound.rate > 0 && sound.rate <= 65535) this.audio = { rate: sound.rate, channels: sound.channels, chunks: [] }
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
      this.sizes.push(data.length)
      this.offsets.push(this.write(data))
    }
  }

  /** Queue one chunk of sound (interleaved 16-bit little-endian PCM). */
  appendAudio(pcm: Uint8Array): void {
    const a = this.audio
    if (!a || !pcm.length) return
    const frames = Math.floor(pcm.length / (2 * a.channels))
    if (!frames) return
    a.chunks.push({ offset: this.write(pcm), frames })
  }

  /** Bytes go to the end of the mdat, in order, without blocking. */
  private write(data: Uint8Array): number {
    const at = this.pos
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
    return at
  }

  get frames(): number {
    return this.sizes.length
  }

  /** Wait for every append, write the index, close. `withSound` false leaves
   *  the sound track out (a take during which nothing played). The sound is
   *  fitted to the picture's length : padded with silence, or its tail left out. */
  async finish(withSound = true): Promise<void> {
    const a = this.audio
    if (a && withSound && a.chunks.length) {
      const want = Math.round((this.sizes.length * this.track.sampleDelta * a.rate) / this.track.timescale)
      let have = a.chunks.reduce((n, c) => n + c.frames, 0)
      while (have > want && a.chunks.length) {
        const last = a.chunks[a.chunks.length - 1]
        const cut = Math.min(last.frames, have - want)
        last.frames -= cut
        have -= cut
        if (!last.frames) a.chunks.pop()
      }
      if (want > have) this.appendAudio(new Uint8Array((want - have) * 2 * a.channels))
    }
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
    const moov = buildMoov({ ...this.track, sizes: this.sizes, offsets: this.offsets }, withSound ? this.audio : null)
    writeSync(this.fd, moov, 0, moov.length, this.pos)
    closeSync(this.fd)
    if (this.failed) throw this.failed
  }
}
