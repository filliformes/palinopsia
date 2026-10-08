// The dataflou data plane : compact binary UDP packets (dataflou's
// stream_codec.cpp), one or more parameter values each.
//
//   header (12 bytes) : 0xDF 0x01 · u32 LE CRC32 of the source node's SKU ·
//                       u16 LE entry count · u32 LE timestamp (ms, low 32 bits)
//   entry             : u16 LE path length · path (UTF-8) · u8 type tag · value
//                       bool 1 · number f64 LE · v2/v3/v4 f32 LE each ·
//                       colour 4 bytes · string/blob u16 LE length + bytes

import { TYPES } from './protocol'
import type { DfType, DfValue } from '@shared/dataflou'

export interface StreamEntry {
  path: string
  type: DfType
  value: DfValue
}

/** CRC32 of a SKU string : how a packet names its source node. */
export function crc32Sku(sku: string): number {
  let crc = 0xffffffff
  const b = Buffer.from(sku, 'utf8')
  for (let i = 0; i < b.length; i++) {
    crc ^= b[i]
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function encodeStreamPacket(skuHash: number, timestampMs: number, entries: StreamEntry[]): Buffer {
  const parts: Buffer[] = []
  const head = Buffer.alloc(12)
  head[0] = 0xdf
  head[1] = 0x01
  head.writeUInt32LE(skuHash >>> 0, 2)
  head.writeUInt16LE(entries.length, 6)
  head.writeUInt32LE(timestampMs >>> 0, 8)
  parts.push(head)
  for (const e of entries) {
    const path = Buffer.from(e.path, 'utf8')
    const h = Buffer.alloc(3)
    h.writeUInt16LE(path.length, 0)
    h[2] = Math.max(0, TYPES.indexOf(e.type))
    parts.push(h.subarray(0, 2), path, h.subarray(2))
    const v = e.value
    switch (e.type) {
      case 'bool':
        parts.push(Buffer.from([v ? 1 : 0]))
        break
      case 'number': {
        const b = Buffer.alloc(8)
        b.writeDoubleLE(Number(v) || 0, 0)
        parts.push(b)
        break
      }
      case 'v2':
      case 'v3':
      case 'v4': {
        const n = e.type === 'v2' ? 2 : e.type === 'v3' ? 3 : 4
        const a = Array.isArray(v) ? v : [Number(v) || 0]
        const b = Buffer.alloc(4 * n)
        for (let i = 0; i < n; i++) b.writeFloatLE(a[i] ?? a[0] ?? 0, i * 4)
        parts.push(b)
        break
      }
      case 'colour': {
        const a = Array.isArray(v) ? v : [0, 0, 0, 255]
        parts.push(Buffer.from([a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 255].map((x) => Math.round(x) & 0xff)))
        break
      }
      default: {
        const s = Buffer.from(String(v), 'utf8')
        const l = Buffer.alloc(2)
        l.writeUInt16LE(Math.min(0xffff, s.length), 0)
        parts.push(l, s.subarray(0, 0xffff))
      }
    }
  }
  return Buffer.concat(parts)
}

export function decodeStreamPacket(d: Buffer): { skuHash: number; timestampMs: number; entries: StreamEntry[] } | null {
  if (d.length < 12 || d[0] !== 0xdf || d[1] !== 0x01) return null
  const skuHash = d.readUInt32LE(2)
  const count = d.readUInt16LE(6)
  const timestampMs = d.readUInt32LE(8)
  const entries: StreamEntry[] = []
  let pos = 12
  for (let i = 0; i < count; i++) {
    if (pos + 2 > d.length) break
    const plen = d.readUInt16LE(pos)
    pos += 2
    if (pos + plen + 1 > d.length) break
    const path = d.toString('utf8', pos, pos + plen)
    pos += plen
    const type = TYPES[d[pos++]] ?? 'number'
    let value: DfValue
    if (type === 'bool') {
      if (pos + 1 > d.length) break
      value = d[pos++] !== 0
    } else if (type === 'number') {
      if (pos + 8 > d.length) break
      value = d.readDoubleLE(pos)
      pos += 8
    } else if (type === 'v2' || type === 'v3' || type === 'v4') {
      const n = type === 'v2' ? 2 : type === 'v3' ? 3 : 4
      if (pos + 4 * n > d.length) break
      value = Array.from({ length: n }, (_, k) => d.readFloatLE(pos + 4 * k))
      pos += 4 * n
    } else if (type === 'colour') {
      if (pos + 4 > d.length) break
      value = [d[pos], d[pos + 1], d[pos + 2], d[pos + 3]]
      pos += 4
    } else {
      if (pos + 2 > d.length) break
      const slen = d.readUInt16LE(pos)
      pos += 2
      if (pos + slen > d.length) break
      value = d.toString('utf8', pos, pos + slen)
      pos += slen
    }
    entries.push({ path, type, value })
  }
  return { skuHash, timestampMs, entries }
}
