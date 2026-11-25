// Complex Output, main's side : the screens' windows and the displays.
//
// Each screen is a blank window the control window's page opens (window.open, the
// frame name 'opsia-cx:<screen id>') and draws into from its own process : no pixel
// crosses a process. The page says first where it wants it (complex:prepare), main
// gives the window its place and keeps it there : borderless over a display, or a
// plain window. It never takes the keyboard from the controls.

import { BrowserWindow, dialog, screen, type BrowserWindowConstructorOptions, type Display, type Rectangle } from 'electron'
import { readFile, stat, writeFile } from 'fs/promises'
import { lastDir, rememberDir } from './lastDir'
import { CX_FRAME } from '../shared/types'

interface Prepared {
  kind: 'display' | 'window'
  displayId: number
  bounds: Rectangle
  title: string
}

const prepared = new Map<string, Prepared>()
const windows = new Map<string, BrowserWindow>()
let onChange: () => void = () => {}

/** Told when a screen's window opens or closes (the sleep blocker). */
export function onComplexWindows(fn: () => void): void {
  onChange = fn
}
export const complexWindowsOpen = (): boolean => [...windows.values()].some((w) => !w.isDestroyed())
export function closeComplexWindows(): void {
  for (const w of windows.values()) if (!w.isDestroyed()) w.destroy()
  windows.clear()
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d)
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,40}$/.test(v)

/** Somewhere a window can be seen and taken hold of. */
function onSomeDisplay(b: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y > a.y - 20 && b.y < a.y + a.height - 60)
}

/** Where a screen's window goes, before the page opens it. False : that display is gone. */
export function prepareComplexWindow(id: unknown, cfg: unknown, main: BrowserWindow | null): boolean {
  if (!isId(id) || !cfg || typeof cfg !== 'object') return false
  const c = cfg as Record<string, unknown>
  const title = typeof c.title === 'string' ? c.title.slice(0, 80) : 'Palinopsia'
  if (c.kind === 'display') {
    const d = screen.getAllDisplays().find((x) => x.id === c.displayId)
    if (!d) return false
    prepared.set(id, { kind: 'display', displayId: d.id, bounds: d.bounds, title })
    return true
  }
  const home = main && !main.isDestroyed() ? screen.getDisplayMatching(main.getBounds()).workArea : screen.getPrimaryDisplay().workArea
  const width = Math.max(160, Math.min(16384, num(c.w, 640))), height = Math.max(90, Math.min(16384, num(c.h, 360)))
  let b: Rectangle = { x: num(c.x, NaN), y: num(c.y, NaN), width, height }
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !onSomeDisplay(b)) {
    const k = windows.size % 6
    b = { x: home.x + 60 + k * 36, y: home.y + 60 + k * 36, width: Math.min(width, home.width), height: Math.min(height, home.height) }
  }
  prepared.set(id, { kind: 'window', displayId: 0, bounds: b, title })
  return true
}

/** The options of a screen's window the page opens now (null : not one of ours). */
export function complexWindowOptions(frame: string): BrowserWindowConstructorOptions | null {
  if (!frame.startsWith(CX_FRAME)) return null
  const p = prepared.get(frame.slice(CX_FRAME.length))
  if (!p) return null
  const base: BrowserWindowConstructorOptions = {
    ...p.bounds,
    title: p.title,
    backgroundColor: '#000000',
    show: false,
    webPreferences: { backgroundThrottling: false, sandbox: false, contextIsolation: true, nodeIntegration: false }
  }
  return p.kind === 'display'
    ? { ...base, frame: false, resizable: false, movable: false, skipTaskbar: true, enableLargerThanScreen: true, fullscreen: process.platform === 'darwin', hasShadow: false, roundedCorners: false }
    : { ...base, useContentSize: true, autoHideMenuBar: true, minWidth: 160, minHeight: 90 }
}

/** A screen's window was made : put on its display, shown without the keyboard,
 *  guarded like the projector's. */
export function adoptComplexWindow(child: BrowserWindow, frame: string, kiosk: boolean, main: BrowserWindow | null): boolean {
  if (!frame.startsWith(CX_FRAME)) return false
  const id = frame.slice(CX_FRAME.length)
  const p = prepared.get(id)
  if (!p) return false
  const old = windows.get(id)
  if (old && old !== child && !old.isDestroyed()) old.destroy()
  windows.set(id, child)
  child.setMenuBarVisibility(false)
  child.on('page-title-updated', (e) => e.preventDefault())
  child.webContents.on('will-navigate', (e) => e.preventDefault())
  child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (p.kind === 'display') {
    // Over the controls (you allowed it) : it takes the keyboard, for its Esc, and
    // never stays on top. On a projector : above the taskbar, the controls keep the keys.
    const own = !kiosk && !!main && !main.isDestroyed() && screen.getDisplayMatching(main.getBounds()).id === p.displayId
    if (process.platform !== 'darwin') {
      child.setBounds(p.bounds) // (some platforms nudge a borderless window)
      if (!own) child.setAlwaysOnTop(true, kiosk ? 'screen-saver' : 'normal')
    }
    if (own) child.show()
    else child.showInactive()
    if (process.platform !== 'darwin') child.setBounds(p.bounds)
  } else child.showInactive()
  child.on('closed', () => {
    if (windows.get(id) === child) windows.delete(id)
    onChange()
  })
  onChange()
  return true
}

/** Where a plain window is now (its corner, and its drawing area's size, DIP : what
 *  it is opened with), to come back there. */
export function complexWindowBounds(id: unknown): { x: number; y: number; w: number; h: number } | null {
  const w = isId(id) ? windows.get(id) : undefined
  if (!w || w.isDestroyed() || w.isMinimized()) return null
  const b = w.getBounds(), c = w.getContentBounds()
  return { x: b.x, y: b.y, w: c.width, h: c.height }
}

const native = (d: Display): { width: number; height: number } => ({ width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) })

export function complexDisplays(main: BrowserWindow | null): Array<{ id: number; label: string; width: number; height: number; isPrimary: boolean; isControl: boolean; hz: number }> {
  const primary = screen.getPrimaryDisplay().id
  const here = main && !main.isDestroyed() ? screen.getDisplayMatching(main.getBounds()).id : primary
  return screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || `Display ${i + 1}`, ...native(d), isPrimary: d.id === primary, isControl: d.id === here, hz: Math.round(d.displayFrequency || 0) }))
}

/** A big number on every display for three seconds (a panel in its middle, over
 *  everything, out of the way of the mouse and the keyboard). */
let badges: BrowserWindow[] = []
export function identifyDisplays(names: unknown): void {
  for (const b of badges) if (!b.isDestroyed()) b.destroy()
  badges = []
  const own = names && typeof names === 'object' ? (names as Record<string, unknown>) : {}
  screen.getAllDisplays().forEach((d, i) => {
    const s = Math.max(180, Math.round(Math.min(d.bounds.width, d.bounds.height) * 0.36))
    const w = new BrowserWindow({
      x: d.bounds.x + Math.round((d.bounds.width - s * 1.5) / 2), y: d.bounds.y + Math.round((d.bounds.height - s) / 2), width: Math.round(s * 1.5), height: s,
      frame: false, transparent: true, resizable: false, focusable: false, skipTaskbar: true, show: false, hasShadow: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
    })
    badges.push(w)
    w.setIgnoreMouseEvents(true)
    w.setAlwaysOnTop(true, 'screen-saver')
    const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
    const n = native(d)
    const goes = own[String(d.id)]
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(12,12,14,.88);color:#f2a33a;font:600 ${Math.round(s * 0.07)}px ui-monospace,Consolas,monospace;border-radius:${Math.round(s * 0.06)}px;overflow:hidden"><div style="font-size:${Math.round(s * 0.5)}px;line-height:1">${i + 1}</div><div style="color:#ddd;margin-top:${Math.round(s * 0.04)}px">${esc(d.label || 'Display')}</div><div style="color:#999">${n.width} × ${n.height}</div>${typeof goes === 'string' && goes ? `<div style="margin-top:4px">${esc(goes.slice(0, 40))}</div>` : ''}</body>`
    void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    w.once('ready-to-show', () => w.showInactive())
    setTimeout(() => { if (!w.isDestroyed()) w.destroy() }, 3000)
  })
}

// ── Setups as files ─────────────────────────────────────────────────────
const MAX_BYTES = 16 * 1024 * 1024
type Read = { ok: boolean; text?: string; name?: string; error?: string }

export async function saveComplexFile(parent: BrowserWindow | null, text: unknown, name: unknown): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (typeof text !== 'string' || text.length > MAX_BYTES) return { ok: false, error: 'too large' }
  const safe = String(name || 'complex output').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'complex output'
  const dir = lastDir('complexOut')
  const opts = { title: 'Export the Complex Output setup', defaultPath: dir ? `${dir}/${safe}.opsiaoutput` : `${safe}.opsiaoutput`, filters: [{ name: 'Palinopsia Complex Output', extensions: ['opsiaoutput', 'json'] }] }
  const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
  if (r.canceled || !r.filePath) return { ok: false }
  try {
    await writeFile(r.filePath, text, 'utf8')
    rememberDir('complexOut', r.filePath)
    return { ok: true, path: r.filePath }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function openComplexFile(parent: BrowserWindow | null, kind: unknown): Promise<Read> {
  const xml = kind === 'xml'
  const opts = {
    title: xml ? 'Import an AdvancedOutput.xml' : 'Import a Complex Output setup',
    defaultPath: lastDir(xml ? 'complexXml' : 'complexOut'),
    filters: [xml ? { name: 'AdvancedOutput.xml', extensions: ['xml'] } : { name: 'Palinopsia Complex Output', extensions: ['opsiaoutput', 'json'] }],
    properties: ['openFile' as const]
  }
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
  const file = r.filePaths[0]
  if (r.canceled || !file) return { ok: false }
  try {
    if ((await stat(file)).size > MAX_BYTES) return { ok: false, error: 'that file is too large to be a setup' }
    rememberDir(xml ? 'complexXml' : 'complexOut', file)
    return { ok: true, text: await readFile(file, 'utf8'), name: file.replace(/^.*[\\/]/, '').replace(/\.(opsiaoutput|json|xml)$/i, '') }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
