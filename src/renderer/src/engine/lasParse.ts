// LAS and LAZ point clouds : what LiDAR exports (terrestrial and airborne scans, open
// topographic data, many phone apps). Read in the Model's worker (workers/modelWorker.ts).
//
// LAS is read here from the published format (ASPRS, "LAS Specification", versions 1.0
// to 1.4) : the header's scale, offset and point count, then each point's X Y Z (32-bit
// integers, scaled), its intensity and, in the formats that carry one, its RGB. LAZ, the
// same points losslessly compressed (LASzip), is decompressed by laz-perf (Hobu, Inc.,
// Apache-2.0), shipped as WebAssembly inside this worker; its header is read here the same.
//
// The coordinates are taken relative to the first point in double precision before they
// become 32-bit floats (survey coordinates run to millions of metres, where a float would
// lose the centimetres). LAS is Z up : the Model turns it to Y up. A cloud with more points
// than the Model draws is thinned evenly while it is read (every k-th point), so a scan of
// tens of millions never holds them all.
//
// third-party: laz-perf

import createLazPerf from 'laz-perf/lib/worker/laz-perf.js'
import LAZ_WASM from 'laz-perf/lib/worker/laz-perf.wasm?base64'
import { MAX_POINTS, type RawMesh } from './modelMesh'

// where each point format keeps its RGB (bytes from the record's start); -1 : none
const RGB_AT: Record<number, number> = { 0: -1, 1: -1, 2: 20, 3: 28, 4: -1, 5: 28, 6: -1, 7: 30, 8: 30, 9: -1, 10: 30 }

interface LasHeader {
  version: string
  offset: number
  format: number
  compressed: boolean
  recordLength: number
  count: number
  scale: [number, number, number]
  shift: [number, number, number]
}

function readHeader(buf: ArrayBuffer): LasHeader {
  if (buf.byteLength < 227) throw new Error('not a LAS file (too short for its header)')
  const dv = new DataView(buf)
  const sig = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3))
  if (sig !== 'LASF') throw new Error('not a LAS file (its signature is not LASF)')
  const major = dv.getUint8(24), minor = dv.getUint8(25)
  const id = dv.getUint8(104)
  const legacy = dv.getUint32(107, true)
  // LAS 1.4 keeps a 64-bit count after the extended header fields
  let count = legacy
  if (major === 1 && minor >= 4 && buf.byteLength >= 255) {
    const big = Number(dv.getBigUint64(247, true))
    if (big > 0) count = big
  }
  return {
    version: `${major}.${minor}`,
    offset: dv.getUint32(96, true),
    format: id & 0x3f,
    // LASzip marks a compressed file by the format id's top bit (and the second, in 1.4)
    compressed: (id & 0xc0) !== 0,
    recordLength: dv.getUint16(105, true),
    count,
    scale: [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)],
    shift: [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)]
  }
}

/** The points out of their records : thinned every `k`, colors from RGB or intensity. */
class Gather {
  readonly pos: Float32Array
  private rgb: Uint16Array
  private inten: Uint16Array
  private n = 0
  private origin: [number, number, number] | null = null
  private maxC = 0
  private iMin = 65535
  private iMax = 0
  constructor(cap: number, private h: LasHeader, private rgbAt: number) {
    this.pos = new Float32Array(cap * 3)
    this.rgb = new Uint16Array(rgbAt >= 0 ? cap * 3 : 0)
    this.inten = new Uint16Array(cap)
  }
  add(dv: DataView, o: number): void {
    const h = this.h
    const x = dv.getInt32(o, true) * h.scale[0] + h.shift[0]
    const y = dv.getInt32(o + 4, true) * h.scale[1] + h.shift[1]
    const z = dv.getInt32(o + 8, true) * h.scale[2] + h.shift[2]
    if (!this.origin) this.origin = [x, y, z]
    const i = this.n++
    this.pos[i * 3] = x - this.origin[0]
    this.pos[i * 3 + 1] = y - this.origin[1]
    this.pos[i * 3 + 2] = z - this.origin[2]
    const it = dv.getUint16(o + 12, true)
    this.inten[i] = it
    if (it < this.iMin) this.iMin = it
    if (it > this.iMax) this.iMax = it
    if (this.rgbAt >= 0) {
      for (let c = 0; c < 3; c++) {
        const v = dv.getUint16(o + this.rgbAt + c * 2, true)
        this.rgb[i * 3 + c] = v
        if (v > this.maxC) this.maxC = v
      }
    }
  }
  done(format: string, notes: string[]): RawMesh {
    const n = this.n
    if (!n) throw new Error('the file holds no point')
    const pos = this.pos.slice(0, n * 3)
    let col: Uint8Array | null = null
    if (this.rgbAt >= 0 && this.maxC > 0) {
      // the specification asks for 16 bits a channel; some writers store 0..255
      const k = this.maxC > 255 ? 1 / 257 : 1
      col = new Uint8Array(n * 4)
      for (let i = 0; i < n; i++) {
        col[i * 4] = Math.min(255, Math.round(this.rgb[i * 3] * k))
        col[i * 4 + 1] = Math.min(255, Math.round(this.rgb[i * 3 + 1] * k))
        col[i * 4 + 2] = Math.min(255, Math.round(this.rgb[i * 3 + 2] * k))
        col[i * 4 + 3] = 255
      }
    } else if (this.iMax > this.iMin) {
      col = new Uint8Array(n * 4)
      const span = this.iMax - this.iMin
      for (let i = 0; i < n; i++) {
        const g = Math.round(((this.inten[i] - this.iMin) / span) * 255)
        col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = g
        col[i * 4 + 3] = 255
      }
      notes.push('no colors : its intensity as greys')
    }
    return { pos, col, format, notes, zUp: true }
  }
}

const thinning = (count: number): number => Math.max(1, Math.ceil(count / MAX_POINTS))
const thinNote = (count: number, k: number): string[] =>
  k > 1 ? [`${count.toLocaleString('en-US')} points : every ${k === 2 ? 'second' : k === 3 ? 'third' : k + 'th'} one read`] : []

function readLas(buf: ArrayBuffer, h: LasHeader): RawMesh {
  const rgbAt = RGB_AT[h.format] ?? -1
  if (RGB_AT[h.format] === undefined) throw new Error(`a LAS point format it does not know (${h.format})`)
  if (h.recordLength < 20) throw new Error('the file is damaged : its point records are too short')
  const avail = Math.floor((buf.byteLength - h.offset) / h.recordLength)
  const count = Math.min(h.count || avail, avail)
  const k = thinning(count)
  const G = new Gather(Math.ceil(count / k), h, rgbAt)
  const dv = new DataView(buf)
  for (let i = 0; i < count; i += k) G.add(dv, h.offset + i * h.recordLength)
  return G.done(`LAS ${h.version}`, thinNote(count, k))
}

type LazModule = {
  LASZip: new () => { open(p: number, n: number): void; getPoint(p: number): void; getCount(): number; getPointLength(): number; getPointFormat(): number; delete(): void }
  HEAPU8: Uint8Array
  _malloc(n: number): number
  _free(p: number): void
}
let lazModule: Promise<LazModule> | null = null
function laz(): Promise<LazModule> {
  if (!lazModule) {
    // the WebAssembly travels inside the bundle (base64 : electron.vite.config.ts) : no
    // file to serve or fetch
    const bin = Uint8Array.from(atob(LAZ_WASM), (c) => c.charCodeAt(0))
    lazModule = (createLazPerf as unknown as (o: object) => Promise<LazModule>)({ wasmBinary: bin })
  }
  return lazModule
}

async function readLaz(buf: ArrayBuffer, h: LasHeader): Promise<RawMesh> {
  const M = await laz()
  const bytes = new Uint8Array(buf)
  let filePtr = 0, pointPtr = 0
  let zip: InstanceType<LazModule['LASZip']> | null = null
  try {
    filePtr = M._malloc(bytes.byteLength)
    if (!filePtr) throw new Error('too large to decompress here')
    M.HEAPU8.set(bytes, filePtr)
    zip = new M.LASZip()
    zip.open(filePtr, bytes.byteLength)
    const count = zip.getCount()
    const len = zip.getPointLength()
    const format = zip.getPointFormat()
    const rgbAt = RGB_AT[format]
    if (rgbAt === undefined) throw new Error(`a LAS point format it does not know (${format})`)
    pointPtr = M._malloc(len)
    const k = thinning(count)
    const G = new Gather(Math.ceil(count / k), { ...h, format, recordLength: len }, rgbAt)
    for (let i = 0; i < count; i++) {
      zip.getPoint(pointPtr)
      // (the heap can grow while decoding : a fresh view each time it is read)
      if (i % k === 0) G.add(new DataView(M.HEAPU8.buffer, pointPtr, len), 0)
    }
    return G.done(`LAZ ${h.version}`, thinNote(count, k))
  } finally {
    zip?.delete()
    if (pointPtr) M._free(pointPtr)
    if (filePtr) M._free(filePtr)
  }
}

/** A LAS or LAZ file's points (the header says which, whatever the extension). */
export async function parseLAS(buf: ArrayBuffer): Promise<RawMesh> {
  const h = readHeader(buf)
  return h.compressed ? readLaz(buf, h) : readLas(buf, h)
}
