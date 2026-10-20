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
// Link's instance (and its network threads) is only made once it is enabled :
// the page asking at startup whether Link is there at all must not start it.
let started = false
let closed = false

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

// The stamp is the system's wall clock, the one clock both processes read alike
// at any moment. Each side's performance.timeOrigin is the wall clock taken when
// that process (or page) started, so a clock adjustment, or the drift between
// the wall clock and the monotonic one over the hours before a page reload, set
// the two apart by a constant and the beat landed that far off. Date.now()
// counts whole milliseconds : the highest of its recent readings against
// performance.now() is the exact offset, and a slow leak follows the drift.
// The page does the same on its side (src/renderer/src/link.ts).
let wallOff = NaN
function wallNow(): number {
  const p = performance.now()
  const s = Date.now() - p
  if (!(Math.abs(s - wallOff) < 2)) wallOff = s // the first reading, or the clock moved
  else wallOff = Math.max(s, wallOff - 0.005)
  return p + wallOff
}

function read(): LinkState {
  const m = addon()
  const off = { enabled: false, peers: 0, tempo: 120, beat: 0, phase: 0, quantum: cfg.quantum, at: wallNow() }
  if (!m) return { available: false, error: loadError, ...off }
  if (!started || closed) return { available: true, ...off }
  const s = m.state(cfg.quantum)
  // stamped right after the read
  const at = wallNow()
  return {
    available: true,
    enabled: !!s.enabled,
    peers: s.peers ?? 0,
    tempo: s.tempo ?? 120,
    beat: s.beat ?? 0,
    phase: s.phase ?? 0,
    quantum: cfg.quantum,
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
  const m = closed ? null : addon()
  if (m && (cfg.enabled || started)) {
    started = true
    m.enable(cfg.enabled)
  }
  if (cfg.enabled && m && !timer) timer = setInterval(push, 33)
  if ((!cfg.enabled || !m) && timer) {
    clearInterval(timer)
    timer = null
  }
  return read()
}

/** Leave the session cleanly : peers see Palinopsia go at once, not after a
 *  timeout. Called on quit (will-quit) and from main's shutdown(), which the
 *  installation's relaunch runs before its app.exit() (that one skips will-quit). */
export function closeLink(): void {
  if (closed) return
  closed = true
  if (timer) clearInterval(timer)
  timer = null
  try { if (started) mod?.close() } catch { /* quitting */ }
}

export function initLink(getWindow: () => BrowserWindow | null): void {
  win = getWindow
  ipcMain.handle('link:configure', (_e, c: Partial<LinkConfig>) => configure(c && typeof c === 'object' ? c : {}))
  // also asked at startup with Link off : is it in this build at all?
  ipcMain.handle('link:state', () => read())
  ipcMain.on('link:tempo', (_e, bpm: number) => {
    if (started && !closed && typeof bpm === 'number' && Number.isFinite(bpm)) mod?.setTempo(Math.max(20, Math.min(999, bpm)))
  })
  app.on('will-quit', closeLink)
}
