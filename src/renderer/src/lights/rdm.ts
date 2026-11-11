// RDM (ANSI E1.20, Remote Device Management) : the lights on a DMX line answer
// back over the same cable. The controller finds every light on the line (a
// binary search over their 48-bit unique ids), asks each what it is (its model,
// its mode and how many channels that mode takes, its address) and can set its
// address and its mode, or make it blink to be found in the room.
//
// Pure protocol here : packets built and read, the discovery, the questions. The
// way out (the Enttec DMX USB Pro's RDM messages) is a `RdmTransport`, so the
// whole of it runs in Node against simulated lights (the tests).

/** A light's unique id : manufacturer (16 bits) and device (32 bits), as one number. */
export type Uid = number
export const BROADCAST: Uid = 0xffff_ffff_ffff
const MAX_UID = 0xffff_ffff_fffe

export const CC = { DISC: 0x10, DISC_R: 0x11, GET: 0x20, GET_R: 0x21, SET: 0x30, SET_R: 0x31 } as const
export const PID = {
  DISC_UNIQUE_BRANCH: 0x0001, DISC_MUTE: 0x0002, DISC_UN_MUTE: 0x0003,
  DEVICE_INFO: 0x0060, DEVICE_MODEL_DESCRIPTION: 0x0080, MANUFACTURER_LABEL: 0x0081, DEVICE_LABEL: 0x0082,
  DMX_PERSONALITY: 0x00e0, DMX_PERSONALITY_DESCRIPTION: 0x00e1, DMX_START_ADDRESS: 0x00f0, IDENTIFY_DEVICE: 0x1000
} as const
const ACK = 0, ACK_TIMER = 1, NACK = 2

export const uidText = (u: Uid): string => {
  const h = u.toString(16).padStart(12, '0').toUpperCase()
  return `${h.slice(0, 4)}:${h.slice(4)}`
}
const putUid = (b: Uint8Array, at: number, u: Uid): void => {
  for (let i = 0; i < 6; i++) b[at + i] = Math.floor(u / 2 ** (8 * (5 - i))) & 0xff
}
const getUid = (b: Uint8Array, at: number): Uid => {
  let u = 0
  for (let i = 0; i < 6; i++) u = u * 256 + b[at + i]
  return u
}

/** An RDM request, from its start code to its checksum. */
export function rdmPacket(dest: Uid, src: Uid, tn: number, cc: number, pid: number, pd: Uint8Array = new Uint8Array(0), subDevice = 0): Uint8Array {
  const len = 24 + pd.length
  const p = new Uint8Array(len + 2)
  p[0] = 0xcc; p[1] = 0x01; p[2] = len
  putUid(p, 3, dest); putUid(p, 9, src)
  p[15] = tn & 0xff
  p[16] = 1 // port 1
  p[17] = 0 // message count
  p[18] = (subDevice >> 8) & 0xff; p[19] = subDevice & 0xff
  p[20] = cc
  p[21] = (pid >> 8) & 0xff; p[22] = pid & 0xff
  p[23] = pd.length
  p.set(pd, 24)
  let sum = 0
  for (let i = 0; i < len; i++) sum += p[i]
  p[len] = (sum >> 8) & 0xff; p[len + 1] = sum & 0xff
  return p
}

export interface RdmReply {
  src: Uid
  dest: Uid
  tn: number
  type: number // ACK, ACK_TIMER, NACK_REASON, ACK_OVERFLOW
  cc: number
  pid: number
  pd: Uint8Array
}

/** A response read (null : not one, or its checksum is wrong). It may sit after
 *  other bytes (an interface's status byte) : it is found by its start codes. */
export function readReply(raw: Uint8Array): RdmReply | null {
  for (let s = 0; s + 26 <= raw.length; s++) {
    if (raw[s] !== 0xcc || raw[s + 1] !== 0x01) continue
    const len = raw[s + 2]
    if (len < 24 || s + len + 2 > raw.length) continue
    let sum = 0
    for (let i = 0; i < len; i++) sum += raw[s + i]
    if (((sum >> 8) & 0xff) !== raw[s + len] || (sum & 0xff) !== raw[s + len + 1]) continue
    const pdl = raw[s + 23]
    if (24 + pdl !== len) continue
    return {
      dest: getUid(raw, s + 3), src: getUid(raw, s + 9), tn: raw[s + 15], type: raw[s + 16],
      cc: raw[s + 20], pid: (raw[s + 21] << 8) | raw[s + 22], pd: raw.slice(s + 24, s + 24 + pdl)
    }
  }
  return null
}

/** A light's answer to a discovery branch (what a responder sends : a preamble,
 *  0xAA, its id and a checksum, every byte sent twice, ORed with 0xAA and 0x55). */
export function dubEncode(u: Uid): Uint8Array {
  const out = new Uint8Array(7 + 1 + 16)
  out.fill(0xfe, 0, 7)
  out[7] = 0xaa
  let sum = 0
  for (let i = 0; i < 6; i++) {
    const b = Math.floor(u / 2 ** (8 * (5 - i))) & 0xff
    out[8 + i * 2] = b | 0xaa; out[9 + i * 2] = b | 0x55
    sum += out[8 + i * 2] + out[9 + i * 2]
  }
  const hi = (sum >> 8) & 0xff, lo = sum & 0xff
  out[20] = hi | 0xaa; out[21] = hi | 0x55; out[22] = lo | 0xaa; out[23] = lo | 0x55
  return out
}

/** One id read from a discovery answer, or 'collision' (several answered : the
 *  bytes clash and the checksum fails), or null (nothing). */
export function dubDecode(raw: Uint8Array | null): Uid | 'collision' | null {
  if (!raw || raw.length === 0) return null
  // after up to seven 0xFE (some may be lost), the separator
  let i = 0
  while (i < raw.length && raw[i] !== 0xaa) i++
  if (i >= raw.length || raw.length - (i + 1) < 16) return 'collision'
  const e = raw.subarray(i + 1, i + 17)
  let sum = 0
  for (let k = 0; k < 12; k++) sum += e[k]
  const hi = e[12] & e[13], lo = e[14] & e[15]
  if (((sum >> 8) & 0xff) !== hi || (sum & 0xff) !== lo) return 'collision'
  let u = 0
  for (let k = 0; k < 6; k++) u = u * 256 + (e[k * 2] & e[k * 2 + 1])
  return u
}

/** The way to the line : one request out, what came back (null : nothing in
 *  time). A discovery branch's answer is raw (no start code); everything else is
 *  an RDM response. */
export interface RdmTransport {
  request(packet: Uint8Array, discovery: boolean): Promise<Uint8Array | null>
  /** A request no light answers (a broadcast) : sent, not waited for. */
  send(packet: Uint8Array): Promise<void>
}

export interface RdmPersonality {
  n: number // 1-based, as the light counts them
  footprint: number // channels
  name: string
}
export interface RdmDevice {
  uid: Uid
  model: number
  footprint: number // channels of its mode now
  personality: number // its mode now (1-based)
  personalities: RdmPersonality[]
  address: number // its DMX start address (1..512; 0xFFFF : it takes none)
  manufacturer: string
  modelName: string
  label: string
}

const text = (pd: Uint8Array): string => String.fromCharCode(...pd.filter((c) => c >= 32 && c < 127)).trim()
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class RdmController {
  private tn = 0
  /** Requests sent (the tests and the page's progress). */
  count = 0
  constructor(private t: RdmTransport, readonly self: Uid) {}

  private next(): number { this.tn = (this.tn + 1) & 0xff; return this.tn }

  /** A GET or a SET to one light : its answer's data (null : no answer, or a NACK).
   *  An ACK_TIMER (the light needs time) : waited, then asked again. */
  async ask(uid: Uid, cc: number, pid: number, pd?: Uint8Array): Promise<Uint8Array | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const tn = this.next()
      this.count++
      const raw = await this.t.request(rdmPacket(uid, this.self, tn, cc, pid, pd), false)
      const r = raw ? readReply(raw) : null
      if (!r || r.src !== uid || r.pid !== pid || r.tn !== tn || r.cc !== cc + 1) continue
      if (r.type === ACK) return r.pd
      if (r.type === NACK) return null
      if (r.type === ACK_TIMER) {
        const wait = r.pd.length >= 2 ? ((r.pd[0] << 8) | r.pd[1]) * 100 : 200
        await sleep(Math.min(3000, wait))
        if (cc === CC.SET) return new Uint8Array(0) // (taken : the GET that follows tells)
        continue
      }
      return r.pd
    }
    return null
  }

  private async branch(lo: Uid, hi: Uid): Promise<Uid | 'collision' | null> {
    const pd = new Uint8Array(12)
    putUid(pd, 0, lo); putUid(pd, 6, hi)
    this.count++
    return dubDecode(await this.t.request(rdmPacket(BROADCAST, this.self, this.next(), CC.DISC, PID.DISC_UNIQUE_BRANCH, pd), true))
  }

  private async mute(uid: Uid): Promise<boolean> {
    for (let k = 0; k < 3; k++) if ((await this.ask(uid, CC.DISC, PID.DISC_MUTE)) !== null) return true
    return false
  }

  /** Every light on the line (their ids), by the standard binary search :
   *  everyone unmuted, then each branch of ids asked who is in it; one answer :
   *  that light, muted, and the branch asked again; a clash : the branch split. */
  async discover(onFound?: (u: Uid) => void, budget = 4000): Promise<Uid[]> {
    const found: Uid[] = []
    const unmute = rdmPacket(BROADCAST, this.self, this.next(), CC.DISC, PID.DISC_UN_MUTE)
    await this.t.send(unmute); await this.t.send(unmute)
    const stack: Array<[Uid, Uid]> = [[0, MAX_UID]]
    while (stack.length && this.count < budget) {
      const [lo, hi] = stack.pop()!
      const r = await this.branch(lo, hi)
      if (r === null) continue
      if (r !== 'collision' && r >= lo && r <= hi && !found.includes(r)) {
        // (a clash can read as a valid id : no light answers its mute, the branch is split)
        if (await this.mute(r)) { found.push(r); onFound?.(r); stack.push([lo, hi]); continue }
      }
      if (r !== 'collision' && found.includes(r)) continue // (a light that would not stay muted)
      if (lo === hi) continue
      const mid = lo + Math.floor((hi - lo) / 2)
      stack.push([mid + 1, hi], [lo, mid])
    }
    // (they answer DMX as before : unmuted for whoever asks next)
    await this.t.send(rdmPacket(BROADCAST, this.self, this.next(), CC.DISC, PID.DISC_UN_MUTE))
    return found.sort((a, b) => a - b)
  }

  /** What a light is : its model, its modes, its address. */
  async describe(uid: Uid): Promise<RdmDevice | null> {
    const di = await this.ask(uid, CC.GET, PID.DEVICE_INFO)
    if (!di || di.length < 19) return null
    const dev: RdmDevice = {
      uid,
      model: (di[2] << 8) | di[3],
      footprint: (di[10] << 8) | di[11],
      personality: di[12],
      personalities: [],
      address: (di[14] << 8) | di[15],
      manufacturer: '', modelName: '', label: ''
    }
    const count = di[13]
    dev.manufacturer = text((await this.ask(uid, CC.GET, PID.MANUFACTURER_LABEL)) ?? new Uint8Array(0))
    dev.modelName = text((await this.ask(uid, CC.GET, PID.DEVICE_MODEL_DESCRIPTION)) ?? new Uint8Array(0))
    dev.label = text((await this.ask(uid, CC.GET, PID.DEVICE_LABEL)) ?? new Uint8Array(0))
    for (let n = 1; n <= Math.min(count, 32); n++) {
      const pd = await this.ask(uid, CC.GET, PID.DMX_PERSONALITY_DESCRIPTION, new Uint8Array([n]))
      if (pd && pd.length >= 3) dev.personalities.push({ n, footprint: (pd[1] << 8) | pd[2], name: text(pd.subarray(3)) || `mode ${n}` })
      else dev.personalities.push({ n, footprint: n === dev.personality ? dev.footprint : 0, name: `mode ${n}` })
    }
    return dev
  }

  /** Its address set (true : the light took it, as it says when asked again). */
  async setAddress(uid: Uid, address: number): Promise<boolean> {
    const a = Math.max(1, Math.min(512, Math.round(address)))
    if ((await this.ask(uid, CC.SET, PID.DMX_START_ADDRESS, new Uint8Array([a >> 8, a & 0xff]))) === null) return false
    const back = await this.ask(uid, CC.GET, PID.DMX_START_ADDRESS)
    return !!back && back.length >= 2 && ((back[0] << 8) | back[1]) === a
  }

  /** Its mode set (true : taken). */
  async setPersonality(uid: Uid, n: number): Promise<boolean> {
    if ((await this.ask(uid, CC.SET, PID.DMX_PERSONALITY, new Uint8Array([n]))) === null) return false
    const back = await this.ask(uid, CC.GET, PID.DMX_PERSONALITY)
    return !!back && back.length >= 1 && back[0] === n
  }

  /** It blinks (or stops), to be found in the room. */
  async identify(uid: Uid, on: boolean): Promise<boolean> {
    return (await this.ask(uid, CC.SET, PID.IDENTIFY_DEVICE, new Uint8Array([on ? 1 : 0]))) !== null
  }
}

/** Addresses one after the other from `start`, each light's mode taking its
 *  channels (a light that would cross channel 512 is left where it is : null). */
export function addressesInRow(devs: Array<{ footprint: number }>, start = 1): Array<number | null> {
  let at = Math.max(1, start)
  return devs.map((d) => {
    const fp = Math.max(1, d.footprint)
    if (at + fp - 1 > 512) return null
    const a = at
    at += fp
    return a
  })
}
