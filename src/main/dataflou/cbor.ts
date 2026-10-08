// A small CBOR (RFC 8949) codec : exactly the subset the dataflou topology
// protocol uses (maps with text or integer keys, arrays, text and byte strings,
// unsigned / negative integers, booleans, floats). dataflou's nodes encode with
// QCBOR, whose number getters are strict : a double field must arrive as a CBOR
// float (never an integer), an unsigned field as an integer. So a double is
// wrapped in `F` when encoded; a plain JS number is written as an integer.
// Floats use preferred serialization (the shortest exact width, as QCBOR does).

/** A value to encode as a CBOR float, never as an integer. */
export class F {
  constructor(readonly v: number) {}
}
export const f = (v: number): F => new F(v)

export type CborIn = null | undefined | boolean | number | string | F | Uint8Array | CborIn[] | Map<string | number, CborIn> | { [k: string]: CborIn }

export type CborOut = null | undefined | boolean | number | string | Uint8Array | CborOut[] | Map<string | number, CborOut>

class Writer {
  private buf = new Uint8Array(512)
  private n = 0
  private need(k: number): void {
    if (this.n + k <= this.buf.length) return
    let len = this.buf.length * 2
    while (len < this.n + k) len *= 2
    const b = new Uint8Array(len)
    b.set(this.buf.subarray(0, this.n))
    this.buf = b
  }
  byte(b: number): void {
    this.need(1)
    this.buf[this.n++] = b
  }
  bytes(b: Uint8Array): void {
    this.need(b.length)
    this.buf.set(b, this.n)
    this.n += b.length
  }
  head(major: number, len: number): void {
    const m = major << 5
    if (len < 24) this.byte(m | len)
    else if (len < 0x100) { this.byte(m | 24); this.byte(len) }
    else if (len < 0x10000) { this.byte(m | 25); this.byte(len >> 8); this.byte(len & 0xff) }
    else if (len < 0x100000000) {
      this.byte(m | 26)
      this.byte((len >>> 24) & 0xff); this.byte((len >>> 16) & 0xff); this.byte((len >>> 8) & 0xff); this.byte(len & 0xff)
    } else {
      this.byte(m | 27)
      const hi = Math.floor(len / 0x100000000)
      const lo = len >>> 0
      this.byte((hi >>> 24) & 0xff); this.byte((hi >>> 16) & 0xff); this.byte((hi >>> 8) & 0xff); this.byte(hi & 0xff)
      this.byte((lo >>> 24) & 0xff); this.byte((lo >>> 16) & 0xff); this.byte((lo >>> 8) & 0xff); this.byte(lo & 0xff)
    }
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.n)
  }
}

const enc = new TextEncoder()
const dec = new TextDecoder()

// Half precision when exact (QCBOR's preferred serialization does the same).
function toHalf(v: number): number | null {
  if (Number.isNaN(v)) return 0x7e00
  if (v === Infinity) return 0x7c00
  if (v === -Infinity) return 0xfc00
  if (v === 0) return Object.is(v, -0) ? 0x8000 : 0
  const sign = v < 0 ? 0x8000 : 0
  const a = Math.abs(v)
  const e = Math.floor(Math.log2(a))
  if (e > 15 || e < -24) return null
  if (e >= -14) {
    const m = a / 2 ** e - 1 // normal : 1.m × 2^e
    const mant = m * 1024
    if (!Number.isInteger(mant)) return null
    return sign | ((e + 15) << 10) | mant
  }
  const mant = a / 2 ** -24 // subnormal
  if (!Number.isInteger(mant)) return null
  return sign | mant
}

function writeFloat(w: Writer, v: number): void {
  const h = toHalf(v)
  if (h !== null) {
    w.byte(0xf9); w.byte(h >> 8); w.byte(h & 0xff)
    return
  }
  const f32 = Math.fround(v)
  if (f32 === v) {
    const dv = new DataView(new ArrayBuffer(4))
    dv.setFloat32(0, v)
    w.byte(0xfa)
    w.bytes(new Uint8Array(dv.buffer))
    return
  }
  const dv = new DataView(new ArrayBuffer(8))
  dv.setFloat64(0, v)
  w.byte(0xfb)
  w.bytes(new Uint8Array(dv.buffer))
}

function write(w: Writer, v: CborIn): void {
  if (v === null || v === undefined) { w.byte(0xf6); return }
  if (v === true) { w.byte(0xf5); return }
  if (v === false) { w.byte(0xf4); return }
  if (v instanceof F) { writeFloat(w, v.v); return }
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) { writeFloat(w, v); return }
    if (v >= 0) w.head(0, v)
    else w.head(1, -1 - v)
    return
  }
  if (typeof v === 'string') {
    const b = enc.encode(v)
    w.head(3, b.length)
    w.bytes(b)
    return
  }
  if (v instanceof Uint8Array) {
    w.head(2, v.length)
    w.bytes(v)
    return
  }
  if (Array.isArray(v)) {
    w.head(4, v.length)
    for (const x of v) write(w, x)
    return
  }
  if (v instanceof Map) {
    w.head(5, v.size)
    for (const [k, x] of v) {
      write(w, k)
      write(w, x)
    }
    return
  }
  const keys = Object.keys(v).filter((k) => (v as Record<string, CborIn>)[k] !== undefined)
  w.head(5, keys.length)
  for (const k of keys) {
    write(w, k)
    write(w, (v as Record<string, CborIn>)[k])
  }
}

export function encodeCbor(v: CborIn): Uint8Array {
  const w = new Writer()
  write(w, v)
  return w.done()
}

function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const m = h & 0x3ff
  if (e === 0) return s * m * 2 ** -24
  if (e === 31) return m ? NaN : s * Infinity
  return s * (1 + m / 1024) * 2 ** (e - 15)
}

const BREAK = Symbol('break')

class Reader {
  private dv: DataView
  pos = 0
  constructor(private b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  }
  private u8(): number {
    if (this.pos >= this.b.length) throw new Error('cbor: truncated')
    return this.b[this.pos++]
  }
  private arg(info: number): number {
    if (info < 24) return info
    if (info === 24) return this.u8()
    if (info === 25) { const v = this.dv.getUint16(this.pos); this.pos += 2; return v }
    if (info === 26) { const v = this.dv.getUint32(this.pos); this.pos += 4; return v }
    if (info === 27) {
      const hi = this.dv.getUint32(this.pos)
      const lo = this.dv.getUint32(this.pos + 4)
      this.pos += 8
      return hi * 0x100000000 + lo
    }
    throw new Error('cbor: bad length')
  }
  item(): CborOut | typeof BREAK {
    const ib = this.u8()
    const major = ib >> 5
    const info = ib & 0x1f
    if (major === 7) {
      if (info === 20) return false
      if (info === 21) return true
      if (info === 22) return null
      if (info === 23) return undefined
      if (info === 25) { const v = fromHalf(this.dv.getUint16(this.pos)); this.pos += 2; return v }
      if (info === 26) { const v = this.dv.getFloat32(this.pos); this.pos += 4; return v }
      if (info === 27) { const v = this.dv.getFloat64(this.pos); this.pos += 8; return v }
      if (info === 31) return BREAK
      if (info === 24) { this.u8(); return undefined }
      return undefined
    }
    const indefinite = info === 31
    if (major === 0) return this.arg(info)
    if (major === 1) return -1 - this.arg(info)
    if (major === 6) { this.arg(info); return this.item() } // a tag : the value it wraps
    if (major === 2 || major === 3) {
      if (indefinite) {
        const parts: Uint8Array[] = []
        for (;;) {
          const p = this.item()
          if (p === BREAK) break
          parts.push(typeof p === 'string' ? enc.encode(p) : (p as Uint8Array))
        }
        const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
        let o = 0
        for (const p of parts) { all.set(p, o); o += p.length }
        return major === 3 ? dec.decode(all) : all
      }
      const len = this.arg(info)
      if (this.pos + len > this.b.length) throw new Error('cbor: truncated string')
      const s = this.b.subarray(this.pos, this.pos + len)
      this.pos += len
      return major === 3 ? dec.decode(s) : s.slice()
    }
    if (major === 4) {
      const out: CborOut[] = []
      if (indefinite) {
        for (;;) {
          const x = this.item()
          if (x === BREAK) break
          out.push(x)
        }
      } else {
        const len = this.arg(info)
        for (let i = 0; i < len; i++) out.push(this.item() as CborOut)
      }
      return out
    }
    // major 5 : a map
    const m = new Map<string | number, CborOut>()
    const len = indefinite ? Infinity : this.arg(info)
    for (let i = 0; i < len; i++) {
      const k = this.item()
      if (k === BREAK) break
      const x = this.item() as CborOut
      if (typeof k === 'string' || typeof k === 'number') m.set(k, x)
    }
    return m
  }
}

export function decodeCbor(b: Uint8Array): CborOut {
  const r = new Reader(b)
  const v = r.item()
  return v === BREAK ? undefined : v
}
