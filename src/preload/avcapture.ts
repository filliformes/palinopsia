// macOS cameras Chromium cannot see, through native/avcapture (AVFoundation) :
// an iPhone or iPad plugged in by USB first of all (its screen, as QuickTime's
// New Movie Recording shows it), and any other "muxed" device (sound and picture
// in one). The Live Input picker lists them beside the ordinary cameras, as
// `device:avf:<id>`.
//
// Lives in the window's own process like the NDI receiver (see ndi.ts) : frames
// are copied once out of the addon into pooled buffers and TRANSFERRED to the
// page over a private MessageChannel (no copy); the page sends each buffer back
// when a newer frame replaces it.
//
// Built for installations : a device that is not there yet (an iPhone still
// charging after the power came back) or that goes away (unplugged, rebooted) is
// looked for again every two seconds, for as long as a layer shows it, with no
// one at the computer.

import { ipcRenderer } from 'electron'
import { join } from 'path'
import type { AvfDevice, AvfStatus } from '@shared/avf'

interface Addon {
  enable: () => void
  list: () => Array<{ id: string; name: string; model: string; muxed: boolean }>
  open: (id: string, maxSide: number) => number | null
  frame: (h: number) => {
    state: string
    w: number
    h: number
    srcW: number
    srcH: number
    seq: number
    idle: number
    error: string
  } | null
  copy: (h: number, buf: ArrayBuffer, w: number, hh: number) => number
  setMaxSide: (h: number, px: number) => void
  close: (h: number) => void
}

// The long side of a frame at most this : an iPhone X screen (1125×2436) comes
// in at 887×1920, a 1080p capture card untouched, a 4K one at 1080p. Smaller
// frames cost less to copy and upload, and latency comes first here.
const MAX_SIDE = 1920
// An iPhone appears about a second after the opt-in : the DAL publishes it
// asynchronously, so the first look waits for it.
const APPEAR_MS = 1500

let mod: Addon | null = null
let loadError = ''
let enabledAt = 0

function addon(): Addon | null {
  if (mod) return mod
  if (process.platform !== 'darwin') {
    loadError = 'macOS only'
    return null
  }
  if (loadError) return null
  try {
    // out/preload → the project (dev) or app.asar (packaged, unpacked beside it).
    const root = join(__dirname, '..', '..').replace(/app\.asar(?=$|[\\/])/, 'app.asar.unpacked')
    const m = { exports: {} as Addon }
    process.dlopen(m as unknown as NodeModule, join(root, 'native', 'avcapture', 'build', 'Release', 'avcapture.node'))
    mod = m.exports
    return mod
  } catch (e) {
    loadError = `the USB input module did not load (${(e as Error).message})`
    return null
  }
}

function enable(a: Addon): void {
  if (enabledAt) return
  a.enable()
  enabledAt = performance.now()
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The devices AVFoundation sees, iPhones included. The first call opts in to
 *  screen-capture devices and waits for them to appear. */
export async function avfList(): Promise<{ ok: boolean; devices: AvfDevice[]; message: string }> {
  const a = addon()
  if (!a) return { ok: false, devices: [], message: loadError }
  try {
    enable(a)
    const wait = APPEAR_MS - (performance.now() - enabledAt)
    if (wait > 0) await sleep(wait)
    return { ok: true, devices: a.list(), message: '' }
  } catch (e) {
    return { ok: false, devices: [], message: (e as Error).message }
  }
}

// ── Receivers : one per device, shared by every layer that shows it ─────────

interface Recv {
  id: string
  refs: number
  handle: number | null
  openAt: number // when to try again (performance.now())
  failures: number
  pool: ArrayBuffer[]
  out: number // buffers the page holds
  lastSeq: number
  status: AvfStatus
  frames: number
  fpsT0: number
  openedAt: number // when the current capture was opened (a start that never delivers is retried)
}
const recvs = new Map<string, Recv>()
let port: MessagePort | null = null
let timer: ReturnType<typeof setInterval> | null = null
let access: Promise<string> | null = null

/** Camera permission, asked by the main process (the prompt then names the app;
 *  a Mac mini with no camera of its own may never have been asked). */
function cameraAccess(): Promise<string> {
  if (!access) {
    // With the microphone too : an iPhone's screen is a sound-and-picture device,
    // which macOS may refuse to open without both.
    access = (ipcRenderer.invoke('camera:access', true) as Promise<string>).catch(() => 'granted')
    // Asked once per launch; a refusal is looked at again on the next try.
    void access.then((s) => { if (s !== 'granted') access = null })
  }
  return access
}

function closeHandle(r: Recv): void {
  if (r.handle !== null) {
    try { mod?.close(r.handle) } catch { /* ignore */ }
  }
  r.handle = null
  // A new capture counts its frames from 1 again.
  r.lastSeq = 0
}

// A capture that has not delivered a single frame this long is opened again
// (a session that stopped before its first frame, a start that never returned).
const START_TIMEOUT_MS = 15000

/** Try again later : at once-ish while a device is missing or just went away
 *  (it comes back on its own), more slowly when it refuses to open. */
function retryLater(r: Recv, state: AvfStatus['state'], error: string): void {
  closeHandle(r)
  r.status = { ...r.status, state, error, fps: 0 }
  const now = performance.now()
  if (state === 'failed') {
    r.failures++
    r.openAt = now + Math.min(30_000, 2000 * 2 ** Math.min(r.failures - 1, 4))
  } else {
    r.openAt = now + (state === 'denied' ? 5000 : 2000)
  }
}

let opening = false
async function openRecv(r: Recv, a: Addon): Promise<void> {
  if (opening) return
  opening = true
  try {
    const s = await cameraAccess()
    // Still the receiver for this device? (It may have been let go and asked
    // for again meanwhile : a capture opened for this one would never be closed.)
    if (recvs.get(r.id) !== r || r.handle !== null) return
    if (s !== 'granted') {
      retryLater(r, 'denied', 'camera access denied : allow Palinopsia under Privacy & Security, Camera')
      return
    }
    enable(a)
    // Freshly opted in : give an iPhone its second to appear.
    const wait = APPEAR_MS - (performance.now() - enabledAt)
    if (wait > 0) await sleep(wait)
    if (recvs.get(r.id) !== r || r.handle !== null) return
    r.handle = a.open(r.id, MAX_SIDE)
    r.openedAt = performance.now()
    r.status = { ...r.status, state: 'starting', error: '' }
    if (r.handle === null) retryLater(r, 'failed', 'the device would not open')
  } catch (e) {
    retryLater(r, 'failed', (e as Error).message)
  } finally {
    opening = false
  }
}

/** Every few ms : each device's newest frame, if it is new and the page has room. */
function pull(): void {
  const a = mod
  if (!a || recvs.size === 0) {
    if (timer) { clearInterval(timer); timer = null }
    return
  }
  const now = performance.now()
  for (const r of recvs.values()) {
    if (r.handle === null) {
      if (now >= r.openAt) void openRecv(r, a)
      continue
    }
    let f: ReturnType<Addon['frame']>
    try {
      f = a.frame(r.handle)
    } catch {
      f = null
    }
    if (!f) {
      retryLater(r, 'failed', 'lost the capture')
      continue
    }
    if (f.state === 'missing' || f.state === 'gone' || f.state === 'failed' || f.state === 'denied') {
      if (f.state === 'gone') console.warn(`[usb input] ${r.id} went away (${f.error}) : looking for it again`)
      retryLater(r, f.state, f.error)
      continue
    }
    if (f.state === 'starting' && f.seq === 0 && now - r.openedAt > START_TIMEOUT_MS) {
      retryLater(r, 'failed', 'no picture came : opening it again')
      continue
    }
    if (f.state === 'running' && r.status.state !== 'running') {
      console.warn(`[usb input] ${r.id} is capturing (${f.srcW}×${f.srcH})`)
      r.failures = 0
    }
    r.status = { ...r.status, state: f.state as AvfStatus['state'], w: f.w, h: f.h, srcW: f.srcW, srcH: f.srcH, error: f.error }
    if (now - r.fpsT0 >= 1000) {
      r.status.fps = Math.round((r.frames * 1000) / (now - r.fpsT0))
      r.frames = 0
      r.fpsT0 = now
    }
    if (f.seq === r.lastSeq || !port || r.out >= 2 || !(f.w > 0 && f.h > 0)) continue
    const bytes = f.w * f.h * 4
    let buf = r.pool.pop()
    if (!buf || buf.byteLength !== bytes) buf = new ArrayBuffer(bytes)
    let seq = 0
    try {
      seq = a.copy(r.handle, buf, f.w, f.h)
    } catch {
      seq = 0
    }
    if (!seq) {
      // Resized between frame() and copy() : next time.
      if (r.pool.length < 3) r.pool.push(buf)
      continue
    }
    r.lastSeq = seq
    r.frames++
    r.out++
    port.postMessage({ t: 'in', name: r.id, w: f.w, h: f.h, stride: f.w * 4, buf, sent: 0 }, [buf])
  }
}

function openPort(): void {
  try { port?.close() } catch { /* ignore */ }
  const mc = new MessageChannel()
  port = mc.port1
  port.onmessage = (ev): void => {
    const d = ev.data as { t: string; name: string; buf: ArrayBuffer } | null
    if (!d || d.t !== 'in-return') return
    const r = recvs.get(d.name)
    if (!r) return
    r.out = Math.max(0, r.out - 1)
    if (d.buf instanceof ArrayBuffer && r.pool.length < 3) r.pool.push(d.buf)
  }
  window.postMessage('opsia:avfinport', '*', [mc.port2])
}
window.addEventListener('message', (ev) => {
  if (ev.data === 'opsia:want-avfinport') openPort()
})
window.addEventListener('beforeunload', () => {
  for (const r of recvs.values()) closeHandle(r)
})

/** A layer starts showing a device. False : this computer cannot (not a Mac, or
 *  the module is missing); the receiver is kept either way. */
export function avfOpen(id: string): boolean {
  let r = recvs.get(id)
  if (r) {
    r.refs++
    return !!addon()
  }
  r = {
    id, refs: 1, handle: null, openAt: 0, failures: 0, pool: [], out: 0, lastSeq: 0,
    status: { state: 'starting', w: 0, h: 0, srcW: 0, srcH: 0, fps: 0, error: '' },
    frames: 0, fpsT0: performance.now(), openedAt: 0
  }
  recvs.set(id, r)
  if (!addon()) {
    r.status = { ...r.status, state: 'unavailable', error: loadError }
    return false
  }
  if (!timer) timer = setInterval(pull, 4)
  return true
}

/** A layer let go of a device : the capture stops when nobody shows it. */
export function avfClose(id: string): void {
  const r = recvs.get(id)
  if (!r) return
  r.refs--
  if (r.refs > 0) return
  recvs.delete(id)
  closeHandle(r)
}

export function avfStatus(id: string): AvfStatus | null {
  return recvs.get(id)?.status ?? null
}
