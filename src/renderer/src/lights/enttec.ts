// The Enttec DMX USB Pro, through Web Serial (no native module to build on three
// platforms). The Pro is an FTDI chip (0403:6001) with its own processor : it
// takes whole universes as framed messages and makes the DMX signal itself, so the
// serial port's speed hardly matters and no break timing is ours to make.
//
// Message : 0x7E, label 6 (Output Only Send DMX), the data's length (LSB, MSB),
// the data (the DMX start code 0, then up to 512 channels), 0xE7.
//
// Ports : the main process answers Chromium's port chooser (select-serial-port)
// and grants serial devices (setDevicePermissionHandler), so navigator.serial
// .getPorts() lists every Pro plugged in without a prompt. Several Pros : `index`
// picks among them in the order the system lists them. A Pro unplugged or the
// computer asleep : the port errors or disconnects, and the link tries again
// every two seconds until it is back.

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
      if (!p.writable) throw new Error('the port cannot be written')
      this.port = p
      this.writer = p.writable.getWriter()
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
    try { w?.releaseLock() } catch { /* gone */ }
    try { await p?.close() } catch { /* gone */ }
  }

  /** Send a universe; opens (and reopens) on the way. Never waits : a write still
   *  in progress skips this frame. */
  send(dmx: Uint8Array): void {
    if (!this.writer) {
      if (!this.opening && performance.now() >= this.retryAt) void this.open()
      return
    }
    if (this.busy) return
    this.busy = true
    const w = this.writer
    w.write(enttecPacket(dmx)).then(
      () => { this.busy = false; this.frames++ },
      (e: Error) => {
        // unplugged, asleep : close it and try again shortly
        this.status = 'error'
        this.error = e?.message || 'the write failed'
        this.retryAt = performance.now() + 2000
        void this.drop()
      }
    )
  }

  /** Lights off, or the output removed : the port is let go. */
  async close(): Promise<void> {
    await this.drop()
    this.status = 'off'
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
  s.addEventListener('disconnect', () => { for (const l of links.values()) l.lost() })
}

export const enttec = {
  supported: (): boolean => !!serial(),
  /** Send `dmx` to the Pro at `index` (opened on demand). */
  send(index: number, dmx: Uint8Array): void {
    watch()
    let l = links.get(index)
    if (!l) { l = new EnttecLink(index); links.set(index, l) }
    l.send(dmx)
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
