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
// become 32-bit floats (survey coordinates run to millions of meters, where a float would
// lose the centimeters). LAS is Z up : the Model turns it to Y up. A cloud with more points
// than the Model draws is thinned evenly while it is read (every k-th point), so a scan of
// tens of millions never holds them all. Nothing is allocated from a number the file
// gives before that number is checked against the file's own size.
//
// third-party: laz-perf

import createLazPerf from 'laz-perf/lib/worker/laz-perf.js'
import LAZ_WASM from 'laz-perf/lib/worker/laz-perf.wasm?base64'
import { MAX_POINTS, type RawMesh } from './modelMesh'

// where each point format keeps its RGB (bytes from the record's start); -1 : none
const RGB_AT: Record<number, number> = { 0: -1, 1: -1, 2: 20, 3: 28, 4: -1, 5: 28, 6: -1, 7: 30, 8: 30, 9: -1, 10: 30 }

/** The bytes a record of each format takes at least (its fields, without extra bytes). */
const LENGTH_OF: Record<number, number> = { 0: 20, 1: 28, 2: 26, 3: 34, 4: 57, 5: 63, 6: 30, 7: 36, 8: 38, 9: 59, 10: 67 }
/** The most points a byte of a LAZ file is believed to hold (a scan compresses to 2 to 8
 *  bytes a point; a flat made-up plane to far less) : past this its count is a lie. */
const LAZ_POINTS_PER_BYTE = 64

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
  for (let i = 0; i < 6; i++) {
    const v = dv.getFloat64(131 + i * 8, true)
    if (!Number.isFinite(v) || (i < 3 && v === 0)) throw new Error('the file is damaged : its scale or offset is not a number')
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
    this.inten[i] = dv.getUint16(o + 12, true)
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
    } else {
      // the intensity, from the 1st to the 99th hundredth of its values : one mirror or
      // road sign returns ten times the rest, and a plain min..max turned a scan black
      const hist = new Uint32Array(65536)
      for (let i = 0; i < n; i++) hist[this.inten[i]]++
      let lo = 0, hi = 65535
      for (let acc = 0; lo < 65535; lo++) { acc += hist[lo]; if (acc > n * 0.01) break }
      for (let acc = 0; hi > 0; hi--) { acc += hist[hi]; if (acc > n * 0.01) break }
      if (hi > lo) {
        col = new Uint8Array(n * 4)
        const span = hi - lo
        for (let i = 0; i < n; i++) {
          const g = Math.round(Math.max(0, Math.min(1, (this.inten[i] - lo) / span)) * 255)
          col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = g
          col[i * 4 + 3] = 255
        }
        notes.push('no colors : its intensity as grays')
      }
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
  if (h.recordLength < LENGTH_OF[h.format]) throw new Error('the file is damaged : its point records are too short')
  const avail = Math.floor((buf.byteLength - h.offset) / h.recordLength)
  if (!(avail > 0)) throw new Error('the file is damaged : its points lie past its end')
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
let lazBin: Uint8Array | null = null
/** A decompressor of its own for each file : a WebAssembly heap never shrinks, so one
 *  kept would hold the largest scan read for the rest of the show, and one that aborted
 *  on a damaged file answers nothing after it. (Made in a few ms.) */
function laz(): Promise<LazModule> {
  // the WebAssembly travels inside the bundle (base64 : electron.vite.config.ts) : no
  // file to serve or fetch
  lazBin ??= Uint8Array.from(atob(LAZ_WASM), (c) => c.charCodeAt(0))
  const quiet = (): void => {}
  return (createLazPerf as unknown as (o: object) => Promise<LazModule>)({ wasmBinary: lazBin, print: quiet, printErr: quiet })
}

async function readLaz(buf: ArrayBuffer, h: LasHeader, alive?: () => void): Promise<RawMesh> {
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
    if (len < LENGTH_OF[format]) throw new Error('the file is damaged : its point records are too short')
    if (!(count > 0)) throw new Error('the file holds no point')
    if (count > bytes.byteLength * LAZ_POINTS_PER_BYTE) throw new Error('the file is damaged : it says it holds more points than it can')
    pointPtr = M._malloc(len)
    if (!pointPtr) throw new Error('too large to decompress here')
    const k = thinning(count)
    const G = new Gather(Math.ceil(count / k), { ...h, format, recordLength: len }, rgbAt)
    for (let i = 0; i < count; i++) {
      if ((i & 0x7ffff) === 0x7ffff) alive?.()
      zip.getPoint(pointPtr)
      // (the heap can grow while decoding : a fresh view each time it is read)
      if (i % k === 0) G.add(new DataView(M.HEAPU8.buffer, pointPtr, len), 0)
    }
    return G.done(`LAZ ${h.version}`, thinNote(count, k))
  } catch (e) {
    // (the decompressor throws a number, a pointer to its own exception, or aborts)
    if (e instanceof Error && !(e instanceof WebAssembly.RuntimeError)) throw e
    throw new Error('the file is damaged : it could not be decompressed')
  } finally {
    // (an aborted module refuses every call : the whole of it goes anyway)
    try {
      zip?.delete()
      if (pointPtr) M._free(pointPtr)
      if (filePtr) M._free(filePtr)
    } catch { /* gone with the module */ }
  }
}

/** A LAS or LAZ file's points (the header says which, whatever the extension). */
export async function parseLAS(buf: ArrayBuffer, alive?: () => void): Promise<RawMesh> {
  const h = readHeader(buf)
  return h.compressed ? readLaz(buf, h, alive) : readLas(buf, h)
}
