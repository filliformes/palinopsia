// Ableton Link : Palinopsia's tempo and beat shared with every Link app on the
// network (Live, DJ software, phones…). The SDK (native/link, GPL-2.0-or-later)
// runs here as the app's one Link instance. While it is on, the main window gets
// the session's state 30 times a second, stamped with the time it was read; the
// page carries the beat on between two reads (src/renderer/src/link.ts).

import { app, ipcMain, type BrowserWindow } from 'electron'
import { join } from 'path'
import type { LinkConfig, LinkState } from '@shared/types'

interface LinkAddon {
  enable(on: boolean): boolean
  state(quantum: number): { enabled: boolean; peers?: number; tempo?: number; beat?: number; phase?: number }
  setTempo(bpm: number): void
  close(): void
}

let mod: LinkAddon | null = null
let loadError = ''
let cfg: LinkConfig = { enabled: false, quantum: 4 }
let timer: ReturnType<typeof setInterval> | null = null
let win: () => BrowserWindow | null = () => null

/** Load the addon once (dlopen bypasses the bundler). In dev getAppPath() is
 *  the project root; packaged builds unpack it (asarUnpack). */
function addon(): LinkAddon | null {
  if (mod || loadError) return mod
  try {
    const base = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    const m = { exports: {} as LinkAddon }
    process.dlopen(m as unknown as NodeModule, join(base, 'native', 'link', 'build', 'Release', 'link.node'))
    mod = m.exports
  } catch (e) {
    loadError = (e as Error).message
    console.warn(`[link] unavailable : ${loadError}`)
  }
  return mod
}

function read(): LinkState {
  const m = addon()
  if (!m) return { available: false, error: loadError, enabled: false, peers: 0, tempo: 120, beat: 0, phase: 0, at: Date.now() }
  const s = m.state(cfg.quantum)
  // stamped right after the read : the page's clock (performance.timeOrigin +
  // performance.now()) and this one share the system's
  const at = performance.timeOrigin + performance.now()
  return {
    available: true,
    enabled: !!s.enabled,
    peers: s.peers ?? 0,
    tempo: s.tempo ?? 120,
    beat: s.beat ?? 0,
    phase: s.phase ?? 0,
    at
  }
}

function push(): void {
  const w = win()
  if (w && !w.isDestroyed()) w.webContents.send('link:state', read())
}

function configure(next: Partial<LinkConfig>): LinkState {
  cfg = {
    enabled: next.enabled ?? cfg.enabled,
    quantum: Math.max(1, Math.min(16, Math.round(next.quantum ?? cfg.quantum)))
  }
  const m = addon()
  if (m) m.enable(cfg.enabled)
  if (cfg.enabled && m && !timer) timer = setInterval(push, 33)
  if ((!cfg.enabled || !m) && timer) {
    clearInterval(timer)
    timer = null
  }
  return read()
}

export function initLink(getWindow: () => BrowserWindow | null): void {
  win = getWindow
  ipcMain.handle('link:configure', (_e, c: Partial<LinkConfig>) => configure(c && typeof c === 'object' ? c : {}))
  ipcMain.handle('link:state', () => read())
  ipcMain.on('link:tempo', (_e, bpm: number) => {
    if (typeof bpm === 'number' && Number.isFinite(bpm)) mod?.setTempo(Math.max(20, Math.min(999, bpm)))
  })
  // Leave the session cleanly : peers see Palinopsia go at once, not after a timeout.
  app.on('will-quit', () => {
    if (timer) clearInterval(timer)
    timer = null
    try { mod?.close() } catch { /* quitting */ }
  })
}
