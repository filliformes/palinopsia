// The Enttec DMX USB Pro, through Web Serial (no native module to build on three
// platforms). The Pro is an FTDI chip (0403:6001) with its own processor : it
// takes whole universes as framed messages and makes the DMX signal itself, so the
// serial port's speed hardly matters and no break timing is ours to make.
//
// Message : 0x7E, label 6 (Output Only Send DMX), the data's length (LSB, MSB),
// the data (the DMX start code 0, then up to 512 channels), 0xE7.
//
// RDM (the lights answering back, lights/rdm.ts) goes through the Pro's own
// messages : label 7 sends an RDM request and listens, label 11 a discovery
// branch; what came back arrives as label 5 (a status byte, then the bytes), or
// label 12 when nothing answered in time. Label 10 asks the Pro's serial number
// (our RDM id is the Pro maker's code and that number).
//
// Ports : the main process answers Chromium's port chooser (select-serial-port)
// and grants serial devices (setDevicePermissionHandler), so navigator.serial
// .getPorts() lists every Pro plugged in without a prompt. Several Pros : `index`
// picks among them in the order the system lists them. A Pro unplugged or the
// computer asleep : the port errors or disconnects, and the link tries again
// every two seconds until it is back.

import type { RdmTransport, Uid } from './rdm'

const FTDI_VID = 0x0403
const PRO_PID = 0x6001

/** One DMX universe as an Enttec Pro message. */
export function enttecPacket(dmx: Uint8Array): Uint8Array {
  const n = Math.min(512, dmx.length)
  const len = n + 1
  const pkt = new Uint8Array(len + 5)
  pkt[0] = 0x7e
  pkt[1] = 6
  pkt[2] = len & 0xff
  pkt[3] = (len >> 8) & 0xff
  pkt[4] = 0 // DMX start code
  pkt.set(dmx.subarray(0, n), 5)
  pkt[len + 4] = 0xe7
  return pkt
}

// Web Serial, the little of it used here (not in TypeScript's DOM library).
interface SerialPortInfoLike {
  usbVendorId?: number
  usbProductId?: number
}
interface SerialPortLike {
  getInfo(): SerialPortInfoLike
  open(o: { baudRate: number }): Promise<void>
  close(): Promise<void>
  writable: WritableStream<Uint8Array> | null
  readable: ReadableStream<Uint8Array> | null
}

/** One Pro message (any label). */
export function enttecMessage(label: number, data: Uint8Array): Uint8Array {
  const m = new Uint8Array(data.length + 5)
  m[0] = 0x7e; m[1] = label; m[2] = data.length & 0xff; m[3] = (data.length >> 8) & 0xff
  m.set(data, 4)
  m[data.length + 4] = 0xe7
  return m
}

/** The Pro's messages in a stream of bytes, as they come (some may be cut in two). */
export class EnttecReader {
  private buf = new Uint8Array(0)
  push(chunk: Uint8Array): Array<{ label: number; data: Uint8Array }> {
    const b = new Uint8Array(this.buf.length + chunk.length)
    b.set(this.buf); b.set(chunk, this.buf.length)
    const out: Array<{ label: number; data: Uint8Array }> = []
    let i = 0
    while (i < b.length) {
      if (b[i] !== 0x7e) { i++; continue }
      if (b.length - i < 5) break
      const len = b[i + 2] | (b[i + 3] << 8)
      if (len > 600) { i++; continue }
      if (b.length - i < len + 5) break
      if (b[i + 4 + len] !== 0xe7) { i++; continue }
      out.push({ label: b[i + 1], data: b.slice(i + 4, i + 4 + len) })
      i += len + 5
    }
    this.buf = b.slice(i)
    if (this.buf.length > 4096) this.buf = new Uint8Array(0)
    return out
  }
}
interface SerialLike extends EventTarget {
  getPorts(): Promise<SerialPortLike[]>
  requestPort(o?: { filters?: Array<{ usbVendorId?: number; usbProductId?: number }> }): Promise<SerialPortLike>
}
const serial = (): SerialLike | null => ((navigator as unknown as { serial?: SerialLike }).serial ?? null)

export type EnttecStatus = 'off' | 'searching' | 'open' | 'error' | 'unsupported'

class EnttecLink {
  status: EnttecStatus = 'off'
  error = ''
  frames = 0 // sent since it opened (the page shows it moving)
  private port: SerialPortLike | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private busy = false
  private opening = false
  private retryAt = 0
  private closed = false
  private queued: Uint8Array | null = null // a frame that must go out after the one being written
  private tail: Promise<void> = Promise.resolve()
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  // an RDM request waiting for its answer (one at a time), and the line to it
  private waiting: { label: number; done: (m: { label: number; data: Uint8Array } | null) => void } | null = null
  private rdmLine: Promise<unknown> = Promise.resolve()
  serial: number | null = null

  constructor(readonly index: number) {}

  private async open(): Promise<void> {
    if (this.opening || this.port) return
    const s = serial()
    if (!s) { this.status = 'unsupported'; return }
    this.opening = true
    this.status = 'searching'
    try {
      const ports = (await s.getPorts()).filter((p) => {
        const i = p.getInfo()
        return i.usbVendorId === FTDI_VID && (i.usbProductId === undefined || i.usbProductId === PRO_PID)
      })
      const p = ports[this.index]
      if (!p) { this.status = 'searching'; this.error = ports.length ? `only ${ports.length} plugged in` : 'none plugged in'; return }
      await p.open({ baudRate: 57600 })
      // (closed while it was opening : the output was removed, the lights went off)
      if (this.closed) { try { await p.close() } catch { /* gone */ } return }
      if (!p.writable) throw new Error('the port cannot be written')
      this.port = p
      this.writer = p.writable.getWriter()
      if (p.readable) void this.readLoop(p.readable.getReader())
      this.status = 'open'
      this.error = ''
      this.frames = 0
    } catch (e) {
      this.status = 'error'
      this.error = (e as Error).message || 'it would not open'
      await this.drop()
    } finally {
      this.opening = false
      this.retryAt = performance.now() + 2000
    }
  }

  private async drop(): Promise<void> {
    const w = this.writer, p = this.port
    this.writer = null
    this.port = null
    this.busy = false
    this.queued = null
    const rd = this.reader
    this.reader = null
    if (rd) { try { await rd.cancel() } catch { /* gone */ } try { rd.releaseLock() } catch { /* gone */ } }
    if (this.waiting) { this.waiting.done(null); this.waiting = null }
    try { w?.releaseLock() } catch { /* gone */ }
    try { await p?.close() } catch { /* gone */ }
  }

  /** Send a universe; opens (and reopens) on the way. Never waits : a write still
   *  in progress skips this frame, unless it `must` go out (a last dark frame) :
   *  then it is written right after. */
  send(dmx: Uint8Array, must = false): void {
    if (this.closed) return
    if (!this.writer) {
      if (!this.opening && performance.now() >= this.retryAt) void this.open()
      return
    }
    if (this.busy) { if (must) this.queued = dmx; return }
    this.write(dmx)
  }

  /** Open it if it is not (nothing written) : the page shows whether it is
   *  plugged in, and RDM can ask the line before any light is patched. */
  poke(): void {
    if (this.closed || this.writer || this.opening || performance.now() < this.retryAt) return
    void this.open()
  }

  private write(dmx: Uint8Array): void {
    const w = this.writer
    if (!w) return
    this.busy = true
    this.tail = w.write(enttecPacket(dmx)).then(
      () => {
        this.busy = false
        this.frames++
        const q = this.queued
        this.queued = null
        if (q && this.writer === w) this.write(q)
      },
      (e: Error) => {
        // unplugged, asleep : close it and try again shortly
        this.status = 'error'
        this.error = e?.message || 'the write failed'
        this.retryAt = performance.now() + 2000
        void this.drop()
      }
    )
  }

  /** Lights off, or the output removed : what is being written (and a last frame
   *  waiting behind it) goes out, then the port is let go. */
  async close(): Promise<void> {
    this.closed = true
    for (let k = 0; k < 2; k++) { try { await this.tail } catch { /* it failed : nothing to wait for */ } }
    await this.drop()
    this.status = 'off'
  }

  /** What the Pro sends back : the answers RDM waits for. */
  private async readLoop(rd: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    this.reader = rd
    const parse = new EnttecReader()
    try {
      for (;;) {
        const { value, done } = await rd.read()
        if (done || this.reader !== rd) break
        if (!value) continue
        for (const m of parse.push(value)) {
          const w = this.waiting
          if (!w) continue
          // an RDM answer (5), nothing in time (12), the serial number (10)
          if ((w.label === 10 && m.label === 10) || (w.label !== 10 && (m.label === 5 || m.label === 12))) { this.waiting = null; w.done(m) }
        }
      }
    } catch { /* unplugged : the write side finds out and reopens */ }
  }

  /** One message out and its answer (null : none within `ms`). One at a time. */
  exchange(label: number, data: Uint8Array, ms = 1000): Promise<{ label: number; data: Uint8Array } | null> {
    const run = async (): Promise<{ label: number; data: Uint8Array } | null> => {
      const w = this.writer
      if (!w || !this.reader) return null
      return new Promise((resolve) => {
        const timer = setTimeout(() => { if (this.waiting?.done === done) this.waiting = null; resolve(null) }, ms)
        const done = (m: { label: number; data: Uint8Array } | null): void => { clearTimeout(timer); resolve(m) }
        this.waiting = { label, done }
        w.write(enttecMessage(label, data)).catch(() => { if (this.waiting?.done === done) this.waiting = null; done(null) })
      })
    }
    const p = this.rdmLine.then(run, run)
    this.rdmLine = p
    return p
  }

  get isOpen(): boolean {
    return !!this.writer && !!this.reader
  }

  /** Its port is this one (a device that left). */
  holds(p: unknown): boolean {
    return !!p && this.port === p
  }

  /** A port that went away (unplugged, asleep). */
  lost(): void {
    void this.drop().then(() => { this.status = 'searching'; this.retryAt = performance.now() + 500 })
  }
}

const links = new Map<number, EnttecLink>()
let watching = false

function watch(): void {
  const s = serial()
  if (watching || !s) return
  watching = true
  // a Pro plugged back in : the links waiting for one look again soon
  s.addEventListener('connect', () => { for (const l of links.values()) if (l.status !== 'open') l.lost() })
  // (only the link whose port left : another serial device unplugged is nobody's)
  s.addEventListener('disconnect', (ev) => { for (const l of links.values()) if (l.holds(ev.target)) l.lost() })
}

export const enttec = {
  supported: (): boolean => !!serial(),
  /** Send `dmx` to the Pro at `index` (opened on demand). `must` : a frame that
   *  has to go out even behind one being written (the last, dark one). */
  send(index: number, dmx: Uint8Array, must = false): void {
    watch()
    let l = links.get(index)
    if (!l) { l = new EnttecLink(index); links.set(index, l) }
    l.send(dmx, must)
  },
  /** Keep a link to the Pro at `index` and open it, without sending a frame. */
  ensure(index: number): void {
    watch()
    let l = links.get(index)
    if (!l) { l = new EnttecLink(index); links.set(index, l) }
    l.poke()
  },
  /** The way to RDM through the Pro at `index` (null : not open, or it reads nothing). */
  rdm(index: number): EnttecRdm | null {
    const l = links.get(index)
    return l && l.isOpen ? new EnttecRdm(l) : null
  },
  /** A dark frame to the Pro at `index`, if it is open (never opens it for that). */
  dark(index: number): void {
    links.get(index)?.send(new Uint8Array(512), true)
  },
  /** Close the links no longer in use (an output removed, the lights off). */
  keepOnly(indices: Set<number>): void {
    for (const [i, l] of links) if (!indices.has(i)) { void l.close(); links.delete(i) }
  },
  status(index: number): { status: EnttecStatus; error: string; frames: number } {
    const l = links.get(index)
    if (!serial()) return { status: 'unsupported', error: 'this build has no serial ports', frames: 0 }
    return l ? { status: l.status, error: l.error, frames: l.frames } : { status: 'off', error: '', frames: 0 }
  },
  /** The ports seen now (Pros, and any other FTDI port). */
  async list(): Promise<Array<{ vid: number; pid: number }>> {
    const s = serial()
    if (!s) return []
    try {
      return (await s.getPorts()).map((p) => { const i = p.getInfo(); return { vid: i.usbVendorId ?? 0, pid: i.usbProductId ?? 0 } })
    } catch { return [] }
  },
  /** Look again now (a click on Scan) : every link not open retries at once. */
  rescan(): void {
    for (const l of links.values()) if (l.status !== 'open') l.lost()
  }
}

/** RDM through a Pro : its requests as label 7 (and label 11 for a discovery
 *  branch), the answer's bytes after the Pro's status byte. */
export class EnttecRdm implements RdmTransport {
  constructor(private l: { exchange: (label: number, data: Uint8Array, ms?: number) => Promise<{ label: number; data: Uint8Array } | null>; serial: number | null }) {}

  /** The link it talks through : a controller made on another one (closed since,
   *  the lights off and on) must be made again. */
  get link(): unknown {
    return this.l
  }

  async request(packet: Uint8Array, discovery: boolean): Promise<Uint8Array | null> {
    const m = await this.l.exchange(discovery ? 11 : 7, packet)
    if (!m || m.label !== 5 || m.data.length < 2) return null
    return m.data.subarray(1) // (the receive status byte)
  }

  async send(packet: Uint8Array): Promise<void> {
    await this.l.exchange(7, packet, 300)
  }

  /** Our RDM id : the Pro maker's code (0x454E) and its serial number. */
  async self(): Promise<Uid> {
    if (this.l.serial === null) {
      const m = await this.l.exchange(10, new Uint8Array(0), 500)
      // (four bytes, the number in BCD, low byte first)
      let n = 0
      if (m && m.data.length >= 4) for (let i = 3; i >= 0; i--) n = n * 100 + ((m.data[i] >> 4) * 10 + (m.data[i] & 15))
      this.l.serial = n || Math.floor(Math.random() * 0xffffff)
    }
    return 0x454e * 2 ** 32 + (this.l.serial >>> 0)
  }
}
