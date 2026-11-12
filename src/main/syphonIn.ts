// Syphon INPUT (macOS) : another program's picture on this Mac as a layer
// source. UNTESTED on a Mac (written 2026-11-11 on Windows, where its Spout
// twin was measured; see src/preload/shareIn.ts).
//
// Why here, in main : Syphon finds its servers through system-wide
// notifications that need a running run loop, which the main process has
// (a window's renderer may not see them : the USB input's lesson, avcaptureWorker.ts).
// No pixel leaves main through IPC : each server's frames live in one IOSurface
// that main imports ONCE (Electron's sharedTexture) and sends to the window,
// again only when the server changes size; then a small tick per new frame.
// The window draws the surface as a VideoFrame on the graphics card. If that
// never arrives, the window reads the surface by its id instead (the copy route).
//
// A server that stops and comes back is found again by its label ("app : name"),
// looked for twice a second for as long as a layer shows it.

import { ipcMain, sharedTexture, type WebContents } from 'electron'
import { loadShareAddon } from './output'
import { log } from './log'
import type { ShareInList, ShareInStatus } from '@shared/shareIn'

interface SyphonClientAddon {
  receives?: boolean
  servers: () => Array<{ label: string; name: string; app: string }>
  recvOpen: (label: string) => number
  recvPoll: (id: number) => {
    state: ShareInStatus['state']
    w: number
    h: number
    seq: number
    gen: number
    surfaceId: number
    fps: number
    error: string
  } | null
  recvSurface: (id: number) => Buffer | null
  recvClose: (id: number) => void
}

interface Rx {
  label: string
  id: number
  owners: Map<number, { wc: WebContents; refs: number }>
  gen: number // the surface generation sent to the windows
  seq: number
  state: string
  lastTickAt: number
}

const rxs = new Map<string, Rx>()
// The windows already watched for closing : one listener each, however often
// their layers open and close servers.
const hooked = new Set<number>()
let timer: ReturnType<typeof setInterval> | null = null
let warned = false

function addon(): SyphonClientAddon | null {
  const a = loadShareAddon<SyphonClientAddon>()
  if (a && a.receives) return a
  if (!warned) {
    warned = true
    log('warn', '[syphon in] the Syphon module is missing or cannot receive : rebuild native/syphon')
  }
  return null
}

/** One server's surface to every window showing it, imported once. */
async function sendSurface(r: Rx, a: SyphonClientAddon, gen: number, w: number, h: number): Promise<void> {
  const buf = a.recvSurface(r.id)
  if (!buf) return
  for (const { wc } of r.owners.values()) {
    if (wc.isDestroyed()) continue
    let imp: Electron.SharedTextureImported | null = null
    try {
      imp = sharedTexture.importSharedTexture({
        textureInfo: { pixelFormat: 'bgra', codedSize: { width: w, height: h }, handle: { ioSurface: buf } }
      })
      await sharedTexture.sendSharedTexture({ frame: wc.mainFrame, importedSharedTexture: imp }, r.label, gen)
    } catch (e) {
      log('warn', `[syphon in] could not share ${r.label}'s surface : ${(e as Error).message} (the window copies it instead)`)
    } finally {
      // The window holds its own reference now.
      try { imp?.release() } catch { /* ignore */ }
    }
  }
}

function poll(): void {
  const a = addon()
  if (!a || rxs.size === 0) {
    if (timer) clearInterval(timer)
    timer = null
    return
  }
  const now = Date.now()
  for (const r of rxs.values()) {
    const st = a.recvPoll(r.id)
    if (!st) continue
    if (st.state === 'live' && st.gen !== r.gen && st.w && st.h) {
      r.gen = st.gen
      void sendSurface(r, a, st.gen, st.w, st.h)
    }
    // A tick per new frame (and twice a second while nothing changes, for the readout).
    if (st.seq === r.seq && st.state === r.state && now - r.lastTickAt < 500) continue
    r.seq = st.seq
    r.state = st.state
    r.lastTickAt = now
    const tick = { name: r.label, seq: st.seq, w: st.w, h: st.h, fps: Math.round(st.fps), state: st.state, error: st.error, surfaceId: st.surfaceId }
    for (const { wc } of r.owners.values()) if (!wc.isDestroyed()) wc.send('sharein:tick', tick)
  }
}

function close(label: string, wcId: number, all = false): void {
  const r = rxs.get(label)
  if (!r) return
  const o = r.owners.get(wcId)
  if (!o) return
  if (!all && --o.refs > 0) return
  r.owners.delete(wcId)
  if (r.owners.size > 0) return
  rxs.delete(label)
  try { addon()?.recvClose(r.id) } catch { /* ignore */ }
}

export function installSyphonIn(): void {
  if (process.platform !== 'darwin') return
  // The window asks once, before its first receiver : no module, no waiting.
  ipcMain.on('sharein:can', (e) => {
    e.returnValue = !!addon()
  })
  ipcMain.handle('sharein:list', async (): Promise<ShareInList> => {
    const a = addon()
    if (!a) return { ok: false, senders: [], message: 'the Syphon module is missing from this build (sh native/syphon/build.sh)' }
    try {
      // The first look starts the directory : servers answer within a moment.
      a.servers()
      await new Promise((res) => setTimeout(res, 700))
      const list = a.servers().map((s) => ({ name: s.label, w: 0, h: 0 }))
      list.sort((x, y) => x.name.localeCompare(y.name))
      return { ok: true, senders: list, message: '' }
    } catch (e) {
      return { ok: false, senders: [], message: (e as Error).message }
    }
  })
  ipcMain.on('sharein:open', (e, label: string) => {
    const a = addon()
    if (!a || typeof label !== 'string') return
    const wc = e.sender
    let r = rxs.get(label)
    if (!r) {
      r = { label, id: a.recvOpen(label), owners: new Map(), gen: 0, seq: -1, state: '', lastTickAt: 0 }
      rxs.set(label, r)
    }
    const o = r.owners.get(wc.id)
    if (o) o.refs++
    else {
      r.owners.set(wc.id, { wc, refs: 1 })
      // A window that joins a running server gets its surface too.
      r.gen = 0
      if (!hooked.has(wc.id)) {
        hooked.add(wc.id)
        const id = wc.id
        wc.once('destroyed', () => {
          hooked.delete(id)
          for (const l of [...rxs.keys()]) close(l, id, true)
        })
      }
    }
    if (!timer) timer = setInterval(poll, 4)
  })
  ipcMain.on('sharein:close', (e, label: string) => close(label, e.sender.id))
}
