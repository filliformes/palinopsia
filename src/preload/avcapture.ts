// macOS cameras Chromium cannot see, through native/avcapture (AVFoundation) :
// an iPhone or iPad plugged in by USB first of all (its screen, as QuickTime's
// New Movie Recording shows it), and any other "muxed" device (sound and picture
// in one). The Live Input picker lists them beside the ordinary cameras, as
// `device:avf:<id>`.
//
// The captures run in a process of their own (src/main/avcaptureWorker.ts) :
// macOS never shows an iPhone's screen to a window's renderer, which is where
// they first ran, and where the picker then listed nothing with the phone
// plugged in. This side talks to that process over a MessagePort the main
// process hands out, and passes each frame on to the page over a private
// MessageChannel (a transfer : no copy within the window). The page's API is
// unchanged : avfList / avfOpen / avfClose / avfStatus, and frames on the
// `opsia:avfinport` channel (src/renderer/src/engine/avfIn.ts).

import { ipcRenderer } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AvfDevice, AvfStatus } from '@shared/avf'

// out/preload → the project (dev) or app.asar (packaged, unpacked beside it).
const ADDON = join(__dirname, '..', '..', 'native', 'avcapture', 'build', 'Release', 'avcapture.node').replace(
  /app\.asar(?=$|[\\/])/,
  'app.asar.unpacked'
)
const MISSING = 'the USB input module is missing from this build (sh native/avcapture/build.sh)'

/** Whether this computer can capture at all : a Mac, with the module built. */
function available(): boolean {
  return process.platform === 'darwin' && existsSync(ADDON)
}

let ctrl: MessagePort | null = null
let connecting: Promise<MessagePort | null> | null = null

/** The port to the capture process, asked of the main process once (and again
 *  if that process is ever lost). */
function connect(): Promise<MessagePort | null> {
  if (ctrl) return Promise.resolve(ctrl)
  if (connecting) return connecting
  connecting = new Promise((resolve) => {
    const done = (p: MessagePort | null): void => {
      clearTimeout(t)
      ipcRenderer.off('avf:port', onPort)
      connecting = null
      resolve(p)
    }
    const onPort = (e: Electron.IpcRendererEvent): void => {
      const p = e.ports[0]
      if (!p) return done(null)
      ctrl = p
      p.onmessage = onWorker
      p.start()
      // Whatever this window was showing before a lost process : open it again.
      for (const id of wanted.keys()) if (granted.has(id)) p.postMessage({ t: 'open', id })
      done(p)
    }
    const t = setTimeout(() => done(null), 5000)
    ipcRenderer.on('avf:port', onPort)
    ipcRenderer.send('avf:connect')
  })
  return connecting
}

// The capture process stopped : statuses say so, and the next look connects again.
ipcRenderer.on('avf:lost', () => {
  ctrl = null
  for (const id of wanted.keys()) {
    statuses.set(id, { ...(statuses.get(id) ?? blank()), state: 'failed', error: 'the USB input stopped : starting it again', fps: 0 })
  }
  setTimeout(() => {
    if (wanted.size > 0) void connect()
  }, 2000)
})

const blank = (): AvfStatus => ({ state: 'starting', w: 0, h: 0, srcW: 0, srcH: 0, fps: 0, error: '' })

const statuses = new Map<string, AvfStatus>()
const wanted = new Map<string, number>() // device → how many layers of this window show it
const granted = new Set<string>() // devices sent to the capture process (camera access given)
const lists = new Map<number, (r: { ok: boolean; devices: AvfDevice[]; message: string }) => void>()
let nextRid = 1
let pagePort: MessagePort | null = null

function onWorker(e: MessageEvent): void {
  const d = e.data as
    | { t: 'list'; rid: number; ok: boolean; devices: AvfDevice[]; message: string }
    | { t: 'status'; id: string; status: AvfStatus }
    | { t: 'in'; name: string; w: number; h: number; stride: number; buf: ArrayBuffer }
    | null
  if (!d) return
  if (d.t === 'list') {
    lists.get(d.rid)?.({ ok: d.ok, devices: d.devices, message: d.message })
    lists.delete(d.rid)
  } else if (d.t === 'status') {
    if (wanted.has(d.id)) statuses.set(d.id, d.status)
  } else if (d.t === 'in') {
    // On to the page, moved rather than copied. No page listening : taken at once.
    if (pagePort && wanted.has(d.name)) pagePort.postMessage({ ...d, sent: 0 }, [d.buf])
    else ctrl?.postMessage({ t: 'ack', id: d.name })
  }
}

/** The devices AVFoundation sees, iPhones included. The first look opts in to
 *  screen-capture devices and waits a moment for them to appear. */
export async function avfList(): Promise<{ ok: boolean; devices: AvfDevice[]; message: string }> {
  if (process.platform !== 'darwin') return { ok: false, devices: [], message: 'macOS only' }
  if (!available()) return { ok: false, devices: [], message: MISSING }
  const p = await connect()
  if (!p) return { ok: false, devices: [], message: 'the USB input process did not start' }
  const rid = nextRid++
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      lists.delete(rid)
      resolve({ ok: false, devices: [], message: 'the USB input process did not answer' })
    }, 10000)
    lists.set(rid, (r) => {
      clearTimeout(t)
      resolve(r)
    })
    p.postMessage({ t: 'list', rid })
  })
}

// ── Camera permission ───────────────────────────────────────────────────────

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

/** Ask, then hand the device to the capture process. Refused : said in the
 *  status, and asked again every 5 s for as long as a layer shows it. */
async function start(id: string): Promise<void> {
  const s = await cameraAccess()
  if (!wanted.has(id) || granted.has(id)) return
  if (s !== 'granted') {
    statuses.set(id, { ...(statuses.get(id) ?? blank()), state: 'denied', error: 'camera access denied : allow Palinopsia under Privacy & Security, Camera', fps: 0 })
    setTimeout(() => { if (wanted.has(id)) void start(id) }, 5000)
    return
  }
  granted.add(id)
  const p = await connect()
  if (!p) {
    granted.delete(id)
    statuses.set(id, { ...(statuses.get(id) ?? blank()), state: 'failed', error: 'the USB input process did not start', fps: 0 })
    setTimeout(() => { if (wanted.has(id)) void start(id) }, 2000)
    return
  }
  if (wanted.has(id)) p.postMessage({ t: 'open', id })
}

// ── The page's port (frames) ────────────────────────────────────────────────

function openPort(): void {
  try { pagePort?.close() } catch { /* ignore */ }
  const mc = new MessageChannel()
  pagePort = mc.port1
  pagePort.onmessage = (ev): void => {
    const d = ev.data as { t: string; name: string } | null
    // The page is done with a frame : the capture process may send another.
    if (d?.t === 'in-return') ctrl?.postMessage({ t: 'ack', id: d.name })
  }
  window.postMessage('opsia:avfinport', '*', [mc.port2])
}
window.addEventListener('message', (ev) => {
  if (ev.data === 'opsia:want-avfinport') openPort()
})

/** A layer starts showing a device. False : this computer cannot (not a Mac, or
 *  the module is missing); the request is kept either way. */
export function avfOpen(id: string): boolean {
  const n = (wanted.get(id) ?? 0) + 1
  wanted.set(id, n)
  if (n > 1) return available()
  if (!available()) {
    statuses.set(id, { ...blank(), state: 'unavailable', error: process.platform === 'darwin' ? MISSING : 'macOS only' })
    return false
  }
  statuses.set(id, blank())
  void start(id)
  return true
}

/** A layer let go of a device : the capture stops when nobody shows it. */
export function avfClose(id: string): void {
  const n = (wanted.get(id) ?? 0) - 1
  if (n > 0) {
    wanted.set(id, n)
    return
  }
  wanted.delete(id)
  statuses.delete(id)
  if (granted.delete(id)) ctrl?.postMessage({ t: 'close', id })
}

export function avfStatus(id: string): AvfStatus | null {
  return wanted.has(id) ? statuses.get(id) ?? null : null
}
