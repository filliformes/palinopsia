// The dataflou topology protocol (proto 2) : CBOR maps over TCP, each frame a
// 4-byte big-endian length then the payload. Encoded field for field as
// dataflou's own codec (src/core/protocol.cpp) writes them, since its QCBOR
// decoder is strict about types (see cbor.ts). DECLARE params use integer keys :
//   1 path · 2 kind · 3 type · 4 mode · 5 flow · 6 rate · 7 access · 8 ground ·
//   9 hardware · 10 range {min,max,init} · 11 smooth [up,down] · 12 unit ·
//   13 nature · 14 label · 15 desc · 16 subs (legacy) · 17 topology

import { decodeCbor, encodeCbor, f, type CborIn, type CborOut } from './cbor'
import type { DfAccess, DfFlow, DfMode, DfNature, DfParam, DfTopology, DfType, DfValue } from '@shared/dataflou'

export const PROTO_VERSION = 2

export interface DfIdentity {
  sku: string
  label: string
  product: string
  version: number
  state: string
}

const KINDS = ['class', 'group', 'param'] as const
export const TYPES: DfType[] = ['bool', 'number', 'string', 'v2', 'v3', 'v4', 'blob', 'colour']
const MODES: DfMode[] = ['streaming', 'discrete', 'polling']
const FLOWS: DfFlow[] = ['source', 'destination', 'bidir']
const ACCESS: DfAccess[] = ['read', 'write', 'readwrite']
const NATURES: DfNature[] = ['lin', 'log', 'exp']
const TOPOLOGIES: DfTopology[] = ['span', 'centered', 'cyclic', 'free']

const ix = <T>(list: readonly T[], v: T): number => Math.max(0, list.indexOf(v))
const at = <T>(list: readonly T[], i: unknown, d: T): T => (typeof i === 'number' && list[i] !== undefined ? list[i] : d)

export type DfMsg =
  | { msg: 'HELLO'; seq: number; from: string; proto: number; identity: DfIdentity; versions: Map<string, number>; listenPort: number }
  | { msg: 'DECLARE'; seq: number; from: string; about: string; declVersion: number; identity: DfIdentity; params: DfParam[] }
  | { msg: 'ACK'; seq: number; from: string; ackSeq: number }
  | { msg: 'LEAVE'; seq: number; from: string }
  | { msg: 'DIGEST'; seq: number; from: string; versions: Map<string, number> }
  | { msg: 'FLUSH'; seq: number; from: string; target: string }
  | { msg: 'SUBREQ'; seq: number; from: string; sub: boolean; destSku: string; destPath: string; srcSku: string; srcPath: string }
  | { msg: 'SETVAL'; seq: number; from: string; target: string; path: string; type: DfType; value: DfValue }
  | { msg: 'PADMIN'; seq: number; from: string; target: string; payload: string }
  | { msg: 'BLOB'; seq: number; from: string; target: string; key: string }
  | { msg: 'BLOBREQ'; seq: number; from: string; target: string; key: string }
  | { msg: 'STREAMREQ'; seq: number; from: string; sourcePath: string; destPath: string; destSku: string; destUdpPort: number; rateHz: number }
  | { msg: 'STREAMSTOP'; seq: number; from: string; sourcePath: string; destPath: string; destSku: string }
  | { msg: 'SUBANNOUNCE'; seq: number; from: string; sub: boolean; destSku: string; destPath: string; sourceSku: string; sourcePath: string }

// ── encode ────────────────────────────────────────────────────────────────

const header = (msg: string, seq: number, from: string): Record<string, CborIn> => ({ msg, seq, from })

const identityMap = (id: DfIdentity): Record<string, CborIn> => ({
  sku: id.sku, label: id.label, product: id.product, version: id.version, state: id.state || 'active'
})

const versionsMap = (v: Map<string, number>): Record<string, CborIn> => Object.fromEntries(v)

export function encodeHello(seq: number, from: string, identity: DfIdentity, versions: Map<string, number>, listenPort: number): Uint8Array {
  return encodeCbor({ ...header('HELLO', seq, from), proto: PROTO_VERSION, identity: identityMap(identity), versions: versionsMap(versions), listen_port: listenPort })
}

function paramMap(p: DfParam): Map<number, CborIn> {
  const m = new Map<number, CborIn>()
  const boolRange = p.type === 'bool'
  const rv = (v: number): CborIn => (boolRange ? v >= 0.5 : f(v))
  m.set(1, p.path)
  m.set(2, ix(KINDS, p.kind))
  m.set(3, ix(TYPES, p.type))
  m.set(4, ix(MODES, p.mode))
  m.set(5, ix(FLOWS, p.flow))
  m.set(6, f(p.rate))
  m.set(7, ix(ACCESS, p.access))
  m.set(8, p.ground)
  m.set(9, p.hardware)
  m.set(10, { min: rv(p.min), max: rv(p.max), init: rv(p.init) })
  m.set(11, [f(p.smooth[0]), f(p.smooth[1])])
  m.set(13, ix(NATURES, p.nature))
  m.set(17, ix(TOPOLOGIES, p.topology))
  m.set(12, p.unit)
  m.set(14, p.label)
  m.set(15, p.desc)
  return m
}

export function encodeDeclare(seq: number, from: string, about: string, declVersion: number, identity: DfIdentity, params: DfParam[]): Uint8Array {
  return encodeCbor({
    ...header('DECLARE', seq, from),
    about,
    decl_version: declVersion,
    identity: identityMap(identity),
    params: params.map(paramMap)
  })
}

export const encodeAck = (seq: number, from: string, ackSeq: number): Uint8Array => encodeCbor({ ...header('ACK', seq, from), ack_seq: ackSeq })
export const encodeLeave = (seq: number, from: string): Uint8Array => encodeCbor(header('LEAVE', seq, from))
export const encodeDigest = (seq: number, from: string, versions: Map<string, number>): Uint8Array =>
  encodeCbor({ ...header('DIGEST', seq, from), versions: versionsMap(versions) })
export const encodeFlush = (seq: number, from: string, target: string): Uint8Array => encodeCbor({ ...header('FLUSH', seq, from), target })

export const encodeSubRequest = (seq: number, from: string, sub: boolean, destSku: string, destPath: string, srcSku: string, srcPath: string): Uint8Array =>
  encodeCbor({ ...header('SUBREQ', seq, from), sub, dest_sku: destSku, dest_path: destPath, src_sku: srcSku, src_path: srcPath })

export function encodeSetValue(seq: number, from: string, target: string, path: string, type: DfType, value: DfValue): Uint8Array {
  let val: CborIn
  if (type === 'bool') val = !!value
  else if (type === 'number') val = f(Number(value) || 0)
  else if (type === 'string') val = String(value)
  else if (type === 'colour') val = (Array.isArray(value) ? value : [0, 0, 0, 255]).slice(0, 4).map((x) => Math.round(x) & 0xff)
  else {
    const n = type === 'v2' ? 2 : type === 'v3' ? 3 : 4
    const a = Array.isArray(value) ? value : [Number(value) || 0]
    val = Array.from({ length: n }, (_, i) => f(a[i] ?? a[0] ?? 0))
  }
  return encodeCbor({ ...header('SETVAL', seq, from), target, path, vtype: ix(TYPES, type), val })
}

export const encodeStreamRequest = (seq: number, from: string, sourcePath: string, destPath: string, destSku: string, destUdpPort: number, rateHz: number): Uint8Array =>
  encodeCbor({ ...header('STREAMREQ', seq, from), source_path: sourcePath, dest_path: destPath, dest_sku: destSku, dest_udp_port: destUdpPort, rate_hz: f(rateHz) })

export const encodeStreamStop = (seq: number, from: string, sourcePath: string, destPath: string, destSku: string): Uint8Array =>
  encodeCbor({ ...header('STREAMSTOP', seq, from), source_path: sourcePath, dest_path: destPath, dest_sku: destSku })

export const encodeSubAnnounce = (seq: number, from: string, sub: boolean, destSku: string, destPath: string, sourceSku: string, sourcePath: string): Uint8Array =>
  encodeCbor({ ...header('SUBANNOUNCE', seq, from), sub, dest_sku: destSku, dest_path: destPath, source_sku: sourceSku, source_path: sourcePath })

/** A length-prefixed frame, ready for the socket. */
export function frame(payload: Uint8Array): Buffer {
  const b = Buffer.allocUnsafe(4 + payload.length)
  b.writeUInt32BE(payload.length, 0)
  b.set(payload, 4)
  return b
}

// ── decode ────────────────────────────────────────────────────────────────

type M = Map<string | number, CborOut>
const str = (m: M, k: string | number): string => {
  const v = m.get(k)
  return typeof v === 'string' ? v : ''
}
const num = (m: M, k: string | number, d = 0): number => {
  const v = m.get(k)
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}
const bool = (m: M, k: string | number): boolean => m.get(k) === true
const sub = (m: M, k: string): M => {
  const v = m.get(k)
  return v instanceof Map ? v : new Map()
}

function identityFrom(m: M): DfIdentity {
  const id = sub(m, 'identity')
  return { sku: str(id, 'sku'), label: str(id, 'label'), product: str(id, 'product'), version: num(id, 'version'), state: str(id, 'state') || 'active' }
}

function versionsFrom(m: M): Map<string, number> {
  const out = new Map<string, number>()
  for (const [k, v] of sub(m, 'versions')) if (typeof k === 'string' && typeof v === 'number') out.set(k, v)
  return out
}

function paramFrom(m: M): DfParam | null {
  const path = str(m, 1)
  if (!path) return null
  const type = at(TYPES, m.get(3), 'number')
  const r = m.get(10) instanceof Map ? (m.get(10) as M) : new Map()
  const rv = (k: string): number => {
    const v = r.get(k)
    return typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? v : 0
  }
  const s = Array.isArray(m.get(11)) ? (m.get(11) as CborOut[]) : []
  return {
    path,
    kind: at(KINDS, m.get(2), 'param') === 'group' ? 'group' : 'param',
    type,
    mode: at(MODES, m.get(4), 'discrete'),
    flow: at(FLOWS, m.get(5), 'source'),
    access: at(ACCESS, m.get(7), 'read'),
    rate: num(m, 6),
    ground: bool(m, 8),
    hardware: bool(m, 9),
    min: rv('min'),
    max: rv('max'),
    init: rv('init'),
    smooth: [typeof s[0] === 'number' ? s[0] : 0, typeof s[1] === 'number' ? s[1] : 0],
    unit: str(m, 12),
    label: str(m, 14),
    desc: str(m, 15),
    nature: at(NATURES, m.get(13), 'lin'),
    topology: at(TOPOLOGIES, m.get(17), 'span')
  }
}

function valueFrom(type: DfType, v: CborOut): DfValue {
  if (type === 'bool') return v === true || (typeof v === 'number' && v !== 0)
  if (type === 'number') return typeof v === 'number' ? v : 0
  if (type === 'string') return typeof v === 'string' ? v : ''
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'number' ? x : 0))
  return []
}

export function decodeMessage(payload: Uint8Array): DfMsg | null {
  let root: CborOut
  try {
    root = decodeCbor(payload)
  } catch {
    return null
  }
  if (!(root instanceof Map)) return null
  const m = root as M
  const msg = str(m, 'msg')
  const seq = num(m, 'seq')
  const from = str(m, 'from')
  switch (msg) {
    case 'HELLO':
      return { msg, seq, from, proto: num(m, 'proto', 1), identity: identityFrom(m), versions: versionsFrom(m), listenPort: num(m, 'listen_port') }
    case 'DECLARE': {
      const list = m.get('params')
      const params: DfParam[] = []
      if (Array.isArray(list)) for (const p of list) if (p instanceof Map) { const d = paramFrom(p as M); if (d) params.push(d) }
      return { msg, seq, from, about: str(m, 'about'), declVersion: num(m, 'decl_version'), identity: identityFrom(m), params }
    }
    case 'ACK':
      return { msg, seq, from, ackSeq: num(m, 'ack_seq') }
    case 'LEAVE':
      return { msg, seq, from }
    case 'DIGEST':
      return { msg, seq, from, versions: versionsFrom(m) }
    case 'FLUSH':
      return { msg, seq, from, target: str(m, 'target') }
    case 'SUBREQ':
      return { msg, seq, from, sub: bool(m, 'sub'), destSku: str(m, 'dest_sku'), destPath: str(m, 'dest_path'), srcSku: str(m, 'src_sku'), srcPath: str(m, 'src_path') }
    case 'SETVAL': {
      const type = at(TYPES, m.get('vtype'), 'number')
      return { msg, seq, from, target: str(m, 'target'), path: str(m, 'path'), type, value: valueFrom(type, m.get('val')) }
    }
    case 'PADMIN':
      return { msg, seq, from, target: str(m, 'target'), payload: str(m, 'payload') }
    case 'BLOB':
    case 'BLOBREQ':
      return { msg, seq, from, target: str(m, 'target'), key: str(m, 'key') }
    case 'STREAMREQ':
      return { msg, seq, from, sourcePath: str(m, 'source_path'), destPath: str(m, 'dest_path'), destSku: str(m, 'dest_sku'), destUdpPort: num(m, 'dest_udp_port'), rateHz: num(m, 'rate_hz') }
    case 'STREAMSTOP':
      return { msg, seq, from, sourcePath: str(m, 'source_path'), destPath: str(m, 'dest_path'), destSku: str(m, 'dest_sku') }
    case 'SUBANNOUNCE':
      return { msg, seq, from, sub: bool(m, 'sub'), destSku: str(m, 'dest_sku'), destPath: str(m, 'dest_path'), sourceSku: str(m, 'source_sku'), sourcePath: str(m, 'source_path') }
  }
  return null
}
