// USB input (macOS), in its own process : an iPhone or iPad plugged in by USB
// (its screen, as QuickTime's New Movie Recording shows it), and any other
// "muxed" camera Chromium cannot list, captured through native/avcapture.
//
// Why a process of its own : macOS shows an iPhone's screen to the app's main
// process and to its helper processes, but NEVER to a window's renderer. The
// captures first ran in the preload (the renderer), and there the device list
// came back empty, measured 2026-10-13 on a Mac mini M2 with the same phone at
// the same moment : the renderer listed nothing, while this utility process,
// the main process and a plain command-line tool all listed it. Camera
// permission, the launching terminal and the app's Info.plist made no
// difference.
//
// Started by the main process (avcaptureHost.ts), which hands each window a
// MessagePort to it. Per window : `list`, `open` / `close` a device, `ack` a
// frame the page has taken. Back : the list, each device's status, and its
// frames (RGBA, top row first). A frame crosses the process boundary as one
// copy; a window holds at most two in flight, so a slow page drops frames
// instead of queuing them.
//
// Built for installations : a device that is not there yet (an iPhone still
// charging after the power came back) or that goes away (unplugged, rebooted)
// is looked for again every two seconds, for as long as a layer shows it, with
// no one at the computer.

import type { MessagePortMain } from 'electron'
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
  pump: (seconds: number) => void
}

// The long side of a frame at most this : an iPhone X screen (1125×2436) comes
// in at 887×1920, a 1080p capture card untouched, a 4K one at 1080p. Smaller
// frames cost less to copy and upload, and latency comes first here.
const MAX_SIDE = 1920
// An iPhone appears about a second after the opt-in : the DAL publishes it
// asynchronously, so the first look waits for it.
const APPEAR_MS = 1500
// A capture that has not delivered a single frame this long is opened again
// (a session that stopped before its first frame, a start that never returned).
const START_TIMEOUT_MS = 15000

const ADDON_PATH = process.argv[2] ?? ''

let mod: Addon | null = null
let loadError = ''
let enabledAt = 0

function log(msg: string): void {
  process.parentPort.postMessage({ t: 'log', msg })
}

function addon(): Addon | null {
  if (mod) return mod
  if (loadError) return null
  try {
    const m = { exports: {} as Addon }
    process.dlopen(m as unknown as NodeModule, ADDON_PATH)
    mod = m.exports
    return mod
  } catch (e) {
    loadError = `the USB input module did not load (${(e as Error).message})`
    log(loadError)
    return null
  }
}

function enable(a: Addon): void {
  if (enabledAt) return
  a.enable()
  enabledAt = performance.now()
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Wait `ms`, running the main thread's run loop meanwhile : CoreMediaIO
 *  announces a phone that appears through it, and nothing else runs it in this
 *  process (see pump() in the addon). */
async function settle(a: Addon, ms: number): Promise<void> {
  const end = performance.now() + ms
  while (performance.now() < end) {
    a.pump(0.05)
    await sleep(10)
  }
}

// And a little all the time, so a phone plugged in, woken or unplugged later is
// heard too, by the list and by a capture waiting for its device.
setInterval(() => mod?.pump(0.002), 100)

// ── Windows (clients) and devices (receivers) ───────────────────────────────

interface Client {
  port: MessagePortMain
  held: Map<string, number> // device → how many of this window's layers show it
  out: Map<string, number> // device → frames sent and not yet acknowledged
}

interface Recv {
  id: string
  handle: number | null
  openAt: number // when to try again (performance.now())
  failures: number
  lastSeq: number
  status: AvfStatus
  sentStatus: string // the status as last posted, to post only changes
  frames: number
  fpsT0: number
  openedAt: number // when the current capture was opened
  buf: ArrayBuffer | null // reused : a posted frame is copied, not moved
}

const clients = new Set<Client>()
const recvs = new Map<string, Recv>()
let timer: ReturnType<typeof setInterval> | null = null

function holders(id: string): Client[] {
  return [...clients].filter((c) => (c.held.get(id) ?? 0) > 0)
}

function postStatus(r: Recv, force = false): void {
  const s = JSON.stringify(r.status)
  if (!force && s === r.sentStatus) return
  r.sentStatus = s
  for (const c of holders(r.id)) c.port.postMessage({ t: 'status', id: r.id, status: r.status })
}

function closeHandle(r: Recv): void {
  if (r.handle !== null) {
    try { mod?.close(r.handle) } catch { /* ignore */ }
  }
  r.handle = null
  // A new capture counts its frames from 1 again.
  r.lastSeq = 0
}

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
  postStatus(r)
}

let opening = false
async function openRecv(r: Recv, a: Addon): Promise<void> {
  if (opening) return
  opening = true
  try {
    enable(a)
    // Freshly opted in : give an iPhone its second to appear.
    const wait = APPEAR_MS - (performance.now() - enabledAt)
    if (wait > 0) await settle(a, wait)
    // Still wanted, and still not open? (It may have been let go meanwhile : a
    // capture opened for it would never be closed.)
    if (recvs.get(r.id) !== r || r.handle !== null) return
    r.handle = a.open(r.id, MAX_SIDE)
    r.openedAt = performance.now()
    r.status = { ...r.status, state: 'starting', error: '' }
    if (r.handle === null) retryLater(r, 'failed', 'the device would not open')
    else postStatus(r)
  } catch (e) {
    retryLater(r, 'failed', (e as Error).message)
  } finally {
    opening = false
  }
}

/** Every few ms : each device's newest frame, to every window that shows it
 *  and has room. */
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
      if (f.state === 'gone') log(`${r.id} went away (${f.error}) : looking for it again`)
      retryLater(r, f.state, f.error)
      continue
    }
    if (f.state === 'starting' && f.seq === 0 && now - r.openedAt > START_TIMEOUT_MS) {
      retryLater(r, 'failed', 'no picture came : opening it again')
      continue
    }
    if (f.state === 'running' && r.status.state !== 'running') {
      log(`${r.id} is capturing (${f.srcW}×${f.srcH})`)
      r.failures = 0
    }
    r.status = { ...r.status, state: f.state as AvfStatus['state'], w: f.w, h: f.h, srcW: f.srcW, srcH: f.srcH, error: f.error }
    let tick = false
    if (now - r.fpsT0 >= 1000) {
      r.status.fps = Math.round((r.frames * 1000) / (now - r.fpsT0))
      r.frames = 0
      r.fpsT0 = now
      tick = true
    }
    postStatus(r, tick)
    if (f.seq === r.lastSeq || !(f.w > 0 && f.h > 0)) continue
    const to = holders(r.id).filter((c) => (c.out.get(r.id) ?? 0) < 2)
    if (to.length === 0) continue
    const bytes = f.w * f.h * 4
    if (!r.buf || r.buf.byteLength !== bytes) r.buf = new ArrayBuffer(bytes)
    let seq = 0
    try {
      seq = a.copy(r.handle, r.buf, f.w, f.h)
    } catch {
      seq = 0
    }
    if (!seq) continue // resized between frame() and copy() : next time
    r.lastSeq = seq
    r.frames++
    for (const c of to) {
      c.out.set(r.id, (c.out.get(r.id) ?? 0) + 1)
      c.port.postMessage({ t: 'in', name: r.id, w: f.w, h: f.h, stride: f.w * 4, buf: r.buf })
    }
  }
}

function hold(c: Client, id: string): void {
  c.held.set(id, (c.held.get(id) ?? 0) + 1)
  let r = recvs.get(id)
  if (!r) {
    r = {
      id, handle: null, openAt: 0, failures: 0, lastSeq: 0,
      status: { state: 'starting', w: 0, h: 0, srcW: 0, srcH: 0, fps: 0, error: '' }, sentStatus: '',
      frames: 0, fpsT0: performance.now(), openedAt: 0, buf: null
    }
    recvs.set(id, r)
  }
  if (!addon()) {
    r.status = { ...r.status, state: 'unavailable', error: loadError }
    postStatus(r, true)
    return
  }
  postStatus(r, true)
  if (!timer) timer = setInterval(pull, 4)
}

function release(c: Client, id: string, all = false): void {
  const n = all ? 0 : (c.held.get(id) ?? 0) - 1
  if (n > 0) {
    c.held.set(id, n)
    return
  }
  c.held.delete(id)
  c.out.delete(id)
  // The capture stops when no window shows the device any more.
  if (holders(id).length > 0) return
  const r = recvs.get(id)
  if (!r) return
  recvs.delete(id)
  closeHandle(r)
}

async function list(): Promise<{ ok: boolean; devices: AvfDevice[]; message: string }> {
  const a = addon()
  if (!a) return { ok: false, devices: [], message: loadError }
  try {
    enable(a)
    const wait = APPEAR_MS - (performance.now() - enabledAt)
    if (wait > 0) await settle(a, wait)
    // Nothing yet : look a few more times before saying so. A phone still
    // switching its USB connection over appears a moment later.
    let devices = a.list()
    for (let i = 0; devices.length === 0 && i < 12; i++) {
      await settle(a, 250)
      devices = a.list()
    }
    return { ok: true, devices, message: '' }
  } catch (e) {
    return { ok: false, devices: [], message: (e as Error).message }
  }
}

function addClient(port: MessagePortMain): void {
  const c: Client = { port, held: new Map(), out: new Map() }
  clients.add(c)
  port.on('message', (e) => {
    const d = e.data as { t: string; id?: string; rid?: number } | null
    if (!d) return
    if (d.t === 'list') void list().then((r) => port.postMessage({ t: 'list', rid: d.rid, ...r }))
    else if (d.t === 'open' && d.id) hold(c, d.id)
    else if (d.t === 'close' && d.id) release(c, d.id)
    else if (d.t === 'ack' && d.id) c.out.set(d.id, Math.max(0, (c.out.get(d.id) ?? 0) - 1))
  })
  // The window closed or reloaded : its captures go with it.
  port.on('close', () => {
    clients.delete(c)
    for (const id of [...c.held.keys()]) release(c, id, true)
  })
  port.start()
}

process.parentPort.on('message', (e) => {
  const d = e.data as { t?: string } | null
  if (d?.t === 'client' && e.ports[0]) addClient(e.ports[0])
})
