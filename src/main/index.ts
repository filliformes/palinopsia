// Electron main entry. Creates the window and wires IPC for OSC, sessions,
// and autosave. Forked from dataFLOU's main/index.ts, trimmed to Palinopsia's
// surface: the heavy engine lives in the RENDERER (WebGL2 + ISF), so main is
// pure logic + IO — OSC in/out, file I/O, and the output/OSCQuery seams that
// later phases fill in.

import { app, BrowserWindow, ipcMain, shell, session as electronSession } from 'electron'
import { join } from 'path'
import type { OscEvent, OscErrorEvent, Session } from '@shared/types'
import { OscSender } from './osc'
import * as sessionIO from './session'
import * as autosave from './autosave'
import { ModulationEngine } from './modulators'
import { OscQueryServer } from './oscquery'

let mainWindow: BrowserWindow | null = null

// OSC out (renderer → instrument fan-out) + an incoming-listener seam.
const oscSender = new OscSender()
// Modulation brain (Phase 5 port) — started idle so its tick seam exists.
const modulation = new ModulationEngine()
// OSCQuery publisher (Phase 8) — instantiated so the renderer can push its
// parameter tree as soon as the auto-UI can enumerate it.
const oscquery = new OscQueryServer()

let appQuitting = false
let prevRunCrashed = false
let shutdownComplete = false

function shutdown(): void {
  if (shutdownComplete) return
  shutdownComplete = true
  modulation.stop()
  oscSender.stop()
  oscquery.stop()
  autosave.stopAutosave()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0a0a0a', // near-black — the instrument's canvas (brief §1)
    autoHideMenuBar: true,
    title: 'Palinopsia',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Close intercept — ask the renderer to run its Save-before-quit modal
  // first; it replies via `app:close-proceed` which flips appQuitting and
  // re-issues close(). The second pass falls through to the OS close.
  mainWindow.on('close', (e) => {
    if (appQuitting) return
    e.preventDefault()
    mainWindow?.webContents.send('app:before-close')
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Allow Web MIDI in the renderer (MIDI-CC learn lives there — Phase 5).
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    if (permission === 'midi' || permission === 'midiSysex') return cb(true)
    cb(false)
  })

  // Bind the OSC UDP socket on an ephemeral local port for outgoing sends.
  await oscSender.start(0)
  modulation.start()

  prevRunCrashed = autosave.startAutosave().crashed

  // OSC monitor — batch incoming/outgoing events and flush to the renderer
  // every 50ms so a control flood can't drown IPC (dataFLOU's pattern).
  let oscBuffer: OscEvent[] = []
  let oscErrBuffer: OscErrorEvent[] = []
  const OSC_BUFFER_MAX = 2000
  oscSender.setOnSent((e) => {
    if (oscBuffer.length < OSC_BUFFER_MAX) oscBuffer.push(e as OscEvent)
  })
  oscSender.setOnError((e) => {
    if (oscErrBuffer.length < 256) oscErrBuffer.push(e)
  })
  const oscFlushTimer = setInterval(() => {
    if (oscBuffer.length > 0) {
      const batch = oscBuffer
      oscBuffer = []
      mainWindow?.webContents.send('osc:in', batch)
    }
    if (oscErrBuffer.length > 0) {
      const errBatch = oscErrBuffer
      oscErrBuffer = []
      mainWindow?.webContents.send('osc:errors', errBatch)
    }
  }, 50)
  app.on('before-quit', () => clearInterval(oscFlushTimer))

  function safeHandle(
    channel: string,
    handler: (...args: unknown[]) => unknown
  ): void {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...args)
      } catch (e) {
        console.error(`[ipc] ${channel} threw:`, (e as Error).message)
        return undefined
      }
    })
  }

  // ---------- IPC: OSC ----------
  safeHandle('osc:send', (_e, ip, port, address, args) =>
    oscSender.sendMany(
      ip as string,
      port as number,
      address as string,
      args as Array<{ type: 'i' | 'f' | 's' | 'T' | 'F'; value: number | string | boolean }>
    )
  )

  // ---------- IPC: Session I/O ----------
  ipcMain.handle('session:saveAs', (_e, s: Session) => sessionIO.saveAs(mainWindow, s))
  ipcMain.handle('session:saveTo', (_e, s: Session, path: string) =>
    sessionIO.saveTo(path, s)
  )
  ipcMain.handle('session:saveToDefault', (_e, s: Session) =>
    sessionIO.saveToDefault(s as Session)
  )
  ipcMain.handle('session:open', () => sessionIO.open(mainWindow))
  safeHandle('session:setCurrent', (_e, s) => autosave.setCurrentSession(s as Session))

  // ---------- IPC: Autosave / crash recovery ----------
  safeHandle('autosave:crashCheck', async () => {
    const entries = await autosave.listAutosaves()
    return { crashed: prevRunCrashed, entries }
  })
  safeHandle('autosave:list', () => autosave.listAutosaves())
  ipcMain.handle('autosave:load', (_e, path: string) => autosave.loadAutosave(path))

  // ---------- IPC: App lifecycle ----------
  safeHandle('app:close-proceed', () => {
    appQuitting = true
    mainWindow?.close()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  shutdown()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', shutdown)
