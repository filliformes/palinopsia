// Spout / Syphon INPUT : another program's picture on this computer as a layer
// source, received in the main window's PRELOAD (the renderer's own process)
// for the NDI input's reason : no frame ever crosses a process boundary.
//
// Windows (Spout, native/spout) : each receiver runs on a thread of its own in
// the addon. GPU route first : the addon copies every new frame, on the
// graphics card, into one of four textures it shares by NT handle; they are
// imported here ONCE (Electron's sharedTexture) and each frame reaches the page
// as a VideoFrame over the shared texture (measured 2026-11-11 : 0.2 ms to
// upload a 1080p frame, 0.4 ms at 4K, 12 ms (1080p) / 19 ms (4K) from the
// sender's clock to the pixels in the layer's texture). A sender on another
// graphics card, or an import that fails, falls back to the copy route : the
// addon reads the frame back into memory and copies it, off this thread, into
// the page's own buffers (the NDI input's pooled-transfer shape).
//
// macOS (Syphon, native/syphon) : the server directory and the client live in
// the MAIN process (src/main/syphonIn.ts), which has the run loop Syphon's
// notifications need; main imports each server's IOSurface and sends it here
// (sharedTexture.sendSharedTexture) once per surface, then a small tick per
// frame. No pixel crosses either. If no surface arrives, the copy route reads
// the IOSurface by its id here. UNTESTED on a Mac (written 2026-11-11).

import { ipcRenderer, sharedTexture } from 'electron'
import { shareAddon } from './share'
import type { ShareInGpuFrame, ShareInList, ShareInStatus } from '@shared/shareIn'

// ── Windows : the Spout addon's receiver calls ──────────────────────────────

interface SpoutState {
  state: ShareInStatus['state']
  w: number
  h: number
  format: number
  fps: number
  frame: number
  seq: number
  gen: number
  stamp: number
  error: string
  gpu: boolean
}
interface SpoutAddon {
  receives?: boolean
  senders: () => Array<{ name: string; w: number; h: number; format: number }>
  recvOpen: (name: string, gpu: boolean) => number
  recvState: (id: number) => SpoutState | null
  recvRing: (id: number) => { gen: number; w: number; h: number; pixel: string; handles: Buffer[] } | null
  recvTake: (id: number) => { gen: number; slot: number; seq: number; stamp: number } | null
  recvRetire: (id: number, gen: number) => void
  recvRead: (id: number, buf: ArrayBuffer, after: number) => Promise<{ seq: number; w: number; h: number; stamp: number; short: boolean }>
  recvClose: (id: number) => void
}
// The macOS addon's part used here (the copy route).
interface SyphonAddon {
  receives?: boolean
  readSurface: (surfaceId: number, buf: ArrayBuffer) => Promise<{ ok: boolean; w: number; h: number; short: boolean }>
}

type Imported = Electron.SharedTextureImportedSubtle | Electron.SharedTextureImported

interface Rx {
  name: string
  refs: number
  route: 'gpu' | 'cpu'
  // Windows
  id: number
  gen: number
  imps: Imported[]
  w: number
  h: number
  lastState: SpoutState | null
  stateAt: number
  // the copy route (both systems)
  pool: ArrayBuffer[]
  out: number
  reading: boolean
  readSeq: number
  // macOS : what main says about the server
  mac: { seq: number; w: number; h: number; fps: number; state: ShareInStatus['state']; error: string; surfaceId: number; took: number; liveAt: number } | null
  macImp: Imported | null
  macGen: number
}

const rxs = new Map<string, Rx>()
let pagePort: MessagePort | null = null
let copyTimer: ReturnType<typeof setInterval> | null = null
let healthTimer: ReturnType<typeof setInterval> | null = null
// An import that threw once will throw again : every receiver copies from then on.
let gpuBroken = false
const MAX_OUT = 2 // copy route : frames held by the page at once

function spout(): SpoutAddon | null {
  if (process.platform !== 'win32') return null
  const a = shareAddon<SpoutAddon>().mod
  return a && a.receives ? a : null
}
function syphon(): SyphonAddon | null {
  if (process.platform !== 'darwin') return null
  const a = shareAddon<SyphonAddon>().mod
  return a && a.receives ? a : null
}
const canImport = (): boolean => !gpuBroken && !!sharedTexture?.subtle?.importSharedTexture

function releaseAll(list: Imported[], done?: () => void): void {
  let left = list.length
  if (!left) return done?.()
  let called = false
  const one = (): void => {
    if (--left <= 0 && !called) {
      called = true
      done?.()
    }
  }
  // A release callback that never comes must not keep old textures for good.
  setTimeout(() => {
    if (!called) {
      called = true
      done?.()
    }
  }, 1500)
  for (const i of list) {
    try {
      ;(i as Electron.SharedTextureImportedSubtle).release(one)
    } catch {
      one()
    }
  }
}

// ── Windows routes ──────────────────────────────────────────────────────────

/** The current shared textures imported, once per sender size. False : the
 *  import failed (the copy route takes over). */
function syncRing(r: Rx, a: SpoutAddon, gen: number): boolean {
  if (gen === r.gen) return true
  const ring = a.recvRing(r.id)
  if (!ring || ring.gen !== gen) return false
  const old = r.imps
  const oldGen = r.gen
  r.imps = []
  try {
    for (const h of ring.handles) {
      r.imps.push(
        sharedTexture.subtle.importSharedTexture({
          handle: { ntHandle: h },
          codedSize: { width: ring.w, height: ring.h },
          pixelFormat: ring.pixel as 'bgra' | 'rgba' | 'rgbaf16'
        })
      )
    }
  } catch (e) {
    console.warn('[spout in] the shared texture would not import : copying instead.', (e as Error).message)
    releaseAll(r.imps)
    r.imps = []
    gpuBroken = true
    toCopy(r, a)
    return false
  }
  r.gen = ring.gen
  r.w = ring.w
  r.h = ring.h
  // The page may still draw a frame of the old size : the textures go once
  // every import of them is released.
  releaseAll(old, () => {
    if (rxs.get(r.name) === r && r.route === 'gpu' && oldGen > 0) {
      try { a.recvRetire(r.id, r.gen) } catch { /* closed meanwhile */ }
    }
  })
  return true
}

function toCopy(r: Rx, a: SpoutAddon): void {
  if (r.route === 'cpu') return
  try { a.recvClose(r.id) } catch { /* ignore */ }
  releaseAll(r.imps)
  r.imps = []
  r.gen = 0
  r.route = 'cpu'
  r.readSeq = 0
  r.id = a.recvOpen(r.name, false)
  ensureCopyTimer()
}

/** The page's pull, once per drawn frame : the newest frame as a VideoFrame,
 *  or null when nothing is new (or this receiver copies). */
export function shareInFrame(name: string): ShareInGpuFrame | null {
  const r = rxs.get(name)
  if (!r || r.route !== 'gpu') return null
  if (process.platform === 'darwin') return macFrame(r)
  const a = spout()
  if (!a) return null
  const t = a.recvTake(r.id)
  if (!t) return null
  if (t.gen !== r.gen && !syncRing(r, a, t.gen)) return null
  const imp = r.imps[t.slot]
  if (!imp) return null
  try {
    return { vf: imp.getVideoFrame(), seq: t.seq, w: r.w, h: r.h, stamp: t.stamp }
  } catch (e) {
    console.warn('[spout in] no frame from the shared texture : copying instead.', (e as Error).message)
    gpuBroken = true
    toCopy(r, a)
    return null
  }
}

function ensureCopyTimer(): void {
  if (copyTimer) return
  copyTimer = setInterval(copyTick, 4)
}

/** The copy route : a newer frame and a free buffer → read it off this thread,
 *  then hand it to the page (a transfer : no copy within the window). */
function copyTick(): void {
  let any = false
  for (const r of rxs.values()) {
    if (r.route !== 'cpu') continue
    any = true
    if (r.reading || r.out >= MAX_OUT || !pagePort) continue
    if (process.platform === 'darwin') { macCopy(r); continue }
    const a = spout()
    if (!a) continue
    const st = a.recvState(r.id)
    if (!st || st.state !== 'live' || st.seq <= r.readSeq || !st.w || !st.h) continue
    const need = st.w * st.h * 4
    let buf = r.pool.pop()
    if (!buf || buf.byteLength < need) buf = new ArrayBuffer(need)
    r.reading = true
    const b = buf
    a.recvRead(r.id, b, r.readSeq)
      .then((res) => {
        r.reading = false
        if (!rxs.has(r.name) || r.route !== 'cpu') return
        if (res.short || !res.seq) {
          if (!res.short) r.pool.push(b)
          return
        }
        r.readSeq = res.seq
        ship(r, b, res.w, res.h, res.stamp)
      })
      .catch(() => {
        r.reading = false
      })
  }
  if (!any && copyTimer) {
    clearInterval(copyTimer)
    copyTimer = null
  }
}

function ship(r: Rx, buf: ArrayBuffer, w: number, h: number, stamp: number): void {
  if (!pagePort) return
  r.out++
  try {
    pagePort.postMessage({ t: 'in', name: r.name, w, h, stride: w * 4, buf, sent: stamp }, [buf])
  } catch {
    r.out--
  }
}

// ── macOS : the client is in main ───────────────────────────────────────────

function macFrame(r: Rx): ShareInGpuFrame | null {
  const m = r.mac
  if (!m || !r.macImp || m.seq === m.took) return null
  m.took = m.seq
  try {
    return { vf: r.macImp.getVideoFrame(), seq: m.seq, w: m.w, h: m.h, stamp: Date.now() }
  } catch (e) {
    console.warn('[syphon in] no frame from the shared surface : copying instead.', (e as Error).message)
    gpuBroken = true
    r.route = 'cpu'
    ensureCopyTimer()
    return null
  }
}

function macCopy(r: Rx): void {
  const a = syphon()
  const m = r.mac
  if (!a || !m || !m.surfaceId || m.seq <= r.readSeq || !m.w || !m.h) return
  const need = m.w * m.h * 4
  let buf = r.pool.pop()
  if (!buf || buf.byteLength < need) buf = new ArrayBuffer(need)
  r.reading = true
  const b = buf
  const seq = m.seq
  a.readSurface(m.surfaceId, b)
    .then((res) => {
      r.reading = false
      if (!rxs.has(r.name) || !res.ok || res.short) return
      r.readSeq = seq
      ship(r, b, res.w, res.h, Date.now())
    })
    .catch(() => {
      r.reading = false
    })
}

if (process.platform === 'darwin') {
  // Main sends each server's surface once (and again when it changes size).
  try {
    sharedTexture?.setSharedTextureReceiver?.(async (data, ...args: unknown[]) => {
      const name = String(args[0] ?? '')
      const gen = Number(args[1] ?? 0)
      const r = rxs.get(name)
      if (!r || gen <= r.macGen) {
        try { data.importedSharedTexture.release() } catch { /* ignore */ }
        return
      }
      const old = r.macImp
      r.macImp = data.importedSharedTexture
      r.macGen = gen
      if (old) releaseAll([old])
    })
  } catch (e) {
    console.warn('[syphon in] no shared-surface receiver :', (e as Error).message)
  }
  ipcRenderer.on('sharein:tick', (_e, t: { name: string; seq: number; w: number; h: number; fps: number; state: ShareInStatus['state']; error: string; surfaceId: number }) => {
    const r = rxs.get(t.name)
    if (!r) return
    const m = r.mac ?? { seq: 0, w: 0, h: 0, fps: 0, state: 'waiting' as const, error: '', surfaceId: 0, took: 0, liveAt: 0 }
    if (t.state === 'live' && m.state !== 'live') m.liveAt = Date.now()
    Object.assign(m, { seq: t.seq, w: t.w, h: t.h, fps: t.fps, state: t.state, error: t.error, surfaceId: t.surfaceId })
    r.mac = m
  })
}

// ── Health : the GPU route on Windows hands over when it cannot carry a sender ──

function health(): void {
  if (rxs.size === 0) {
    if (healthTimer) clearInterval(healthTimer)
    healthTimer = null
    return
  }
  const now = Date.now()
  for (const r of rxs.values()) {
    if (process.platform === 'darwin') {
      // Live for 3 s and still no shared surface from main : read it here instead.
      const m = r.mac
      if (r.route === 'gpu' && m && m.state === 'live' && !r.macImp && m.liveAt && now - m.liveAt > 3000) {
        r.route = 'cpu'
        ensureCopyTimer()
      }
      continue
    }
    const a = spout()
    if (!a) continue
    const st = a.recvState(r.id)
    r.lastState = st
    r.stateAt = now
    // A sender on another graphics card, or a format the shared textures cannot
    // hold (BGRX…) : the copy route can (it follows the sender's card).
    if (st && r.route === 'gpu' && (st.state === 'other-gpu' || st.state === 'unsupported')) toCopy(r, a)
  }
}

// ── The page's API ──────────────────────────────────────────────────────────

/** The senders on this computer, by name. */
export async function shareInList(): Promise<ShareInList> {
  if (process.platform === 'darwin') {
    try {
      return (await ipcRenderer.invoke('sharein:list')) as ShareInList
    } catch (e) {
      return { ok: false, senders: [], message: (e as Error).message }
    }
  }
  if (process.platform !== 'win32') return { ok: false, senders: [], message: 'Spout and Syphon exist on Windows and macOS only' }
  const a = spout()
  if (!a) {
    const e = shareAddon().error
    return { ok: false, senders: [], message: e ? `the Spout module did not load (${e})` : 'this build has an older Spout module : rebuild native/spout' }
  }
  try {
    const list = a.senders().map((s) => ({ name: s.name, w: s.w, h: s.h }))
    list.sort((x, y) => x.name.localeCompare(y.name))
    return { ok: true, senders: list, message: '' }
  } catch (e) {
    return { ok: false, senders: [], message: (e as Error).message }
  }
}

/** A layer starts showing a sender (shared by every layer showing it). False :
 *  this computer cannot receive (no module). A sender that is not there yet is
 *  no error : it is looked for until it comes. */
export function shareInOpen(name: string): boolean {
  const r0 = rxs.get(name)
  if (r0) {
    r0.refs++
    return true
  }
  const r: Rx = {
    name, refs: 1, route: canImport() ? 'gpu' : 'cpu', id: 0, gen: 0, imps: [], w: 0, h: 0, lastState: null, stateAt: 0,
    pool: [], out: 0, reading: false, readSeq: 0, mac: null, macImp: null, macGen: 0
  }
  if (process.platform === 'darwin') {
    rxs.set(name, r)
    ipcRenderer.send('sharein:open', name)
  } else {
    const a = spout()
    if (!a) return false
    r.id = a.recvOpen(name, r.route === 'gpu')
    rxs.set(name, r)
  }
  if (r.route === 'cpu') ensureCopyTimer()
  if (!healthTimer) healthTimer = setInterval(health, 250)
  return true
}

/** A layer let go of a sender : the receiver stops when nobody shows it. */
export function shareInClose(name: string): void {
  const r = rxs.get(name)
  if (!r) return
  if (--r.refs > 0) return
  rxs.delete(name)
  if (process.platform === 'darwin') {
    ipcRenderer.send('sharein:close', name)
    if (r.macImp) releaseAll([r.macImp])
    r.macImp = null
    return
  }
  const a = spout()
  releaseAll(r.imps)
  r.imps = []
  try { a?.recvClose(r.id) } catch { /* ignore */ }
}

/** What a receiver is doing, for the readout. */
export function shareInStatus(name: string): ShareInStatus | null {
  const r = rxs.get(name)
  if (!r) return null
  if (process.platform === 'darwin') {
    const m = r.mac
    if (!m) return { state: 'waiting', w: 0, h: 0, fps: 0, route: r.route, error: '' }
    return { state: m.state, w: m.w, h: m.h, fps: m.fps, route: r.route, error: m.error }
  }
  const a = spout()
  if (!a) return { state: 'unavailable', w: 0, h: 0, fps: 0, route: '', error: shareAddon().error }
  const st = a.recvState(r.id)
  if (!st) return null
  return { state: st.state, w: st.w, h: st.h, fps: Math.round(st.fps), route: r.route, error: st.error }
}

// ── The page's port (copy-route frames) ─────────────────────────────────────

function openPort(): void {
  try { pagePort?.close() } catch { /* ignore */ }
  const mc = new MessageChannel()
  pagePort = mc.port1
  pagePort.onmessage = (ev): void => {
    const d = ev.data as { t: string; name: string; buf: ArrayBuffer } | null
    if (d?.t !== 'in-return') return
    const r = rxs.get(d.name)
    if (!r) return
    r.out = Math.max(0, r.out - 1)
    if (d.buf instanceof ArrayBuffer && r.pool.length < 3) r.pool.push(d.buf)
  }
  window.postMessage('opsia:shareinport', '*', [mc.port2])
}
window.addEventListener('message', (ev) => {
  if (ev.data === 'opsia:want-shareinport') openPort()
})
window.addEventListener('beforeunload', () => {
  for (const name of [...rxs.keys()]) {
    const r = rxs.get(name)
    if (r) r.refs = 1
    shareInClose(name)
  }
})
