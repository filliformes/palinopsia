// Electron main entry. Creates the window and wires IPC for OSC, sessions,
// and autosave. Forked from dataFLOU's main/index.ts, trimmed to Palinopsia's
// surface: the heavy engine lives in the RENDERER (WebGL2 + ISF), so main is
// pure logic + IO : OSC in/out, file I/O, and the output/OSCQuery seams that
// later phases fill in.

import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  session as electronSession,
  desktopCapturer,
  screen
} from 'electron'
import { join } from 'path'
import type { Session } from '@shared/types'
import { OscSender } from './osc'
import { OscReceiver, localIPv4s, type OscInMessage } from './osc-receive'
import * as sessionIO from './session'
import * as autosave from './autosave'
import { ModulationEngine } from './modulators'
import { OscQueryServer, type OscQueryNode } from './oscquery'
import { registerMediaScheme, handleMediaProtocol } from './media'
import { hiveConnect, hiveDisconnect, hiveDisconnectAll } from './hive'
import { hiveSendStart, hiveSendChunk, hiveSendStop } from './hiveSend'
import { OutputSender } from './output'
import { samplePerf } from './perf'
import * as recording from './recording'

// Must run before app ready : makes opsia-media:// a privileged streaming scheme.
registerMediaScheme()
// Ask Chromium to enable the platform HEVC decoder + encoder (HIVE live-in and
// HIVE output both use WebCodecs HEVC).
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,PlatformHEVCEncoderSupport')
// Keep the fullscreen output window rendering when it's on a 2nd display and
// unfocused : Windows native occlusion detection otherwise pauses it (black).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

let mainWindow: BrowserWindow | null = null

// OSC out (renderer → instrument fan-out).
const oscSender = new OscSender()
// External video output (NDI, via optional native sender).
const outputSender = new OutputSender()
// OSC in : the instrument is PLAYED through this: Pandore/TouchOSC send here
// and the renderer maps addresses onto the store (see renderer/oscInput.ts).
const oscReceiver = new OscReceiver()
// Modulation brain (Phase 5 port) : started idle so its tick seam exists.
const modulation = new ModulationEngine()
// OSCQuery publisher : serves the self-describing address tree over HTTP so
// Pandore/dataFLOU can auto-discover every control.
const oscquery = new OscQueryServer()

let appQuitting = false
let prevRunCrashed = false
let shutdownComplete = false
let closeFallback: ReturnType<typeof setTimeout> | null = null

function shutdown(): void {
  if (shutdownComplete) return
  shutdownComplete = true
  modulation.stop()
  oscSender.stop()
  oscReceiver.stop()
  oscquery.stop()
  autosave.stopAutosave()
  hiveDisconnectAll()
  hiveSendStop()
  outputSender.dispose()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0a0a0a', // near-black : the instrument's canvas (brief §1)
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

  // Close intercept : ask the renderer to run its Save-before-quit modal
  // first; it replies via `app:close-proceed` which flips appQuitting and
  // re-issues close(). The second pass falls through to the OS close.
  mainWindow.on('close', (e) => {
    if (appQuitting) return
    e.preventDefault()
    mainWindow?.webContents.send('app:before-close')
    // Fallback : if the renderer is hung/crashed and never replies with
    // `app:close-proceed`, force the close after a grace period so the window
    // can't get stuck open (only arm once).
    if (!closeFallback) {
      closeFallback = setTimeout(() => {
        appQuitting = true
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
      }, 4000)
    }
  })

  // Closing the control window closes the projector output with it.
  mainWindow.on('closed', () => {
    outputWindow?.close()
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Only hand http(s) URLs to the OS shell; never file:/other schemes.
    if (/^https?:\/\//i.test(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Never let the renderer navigate the main window away from the app itself
  // (dev server URL or the packaged file://). A first-party bug can't turn into
  // a full-page redirect to a remote origin.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith('file://')
    if (!allowed) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── Output window (2nd display / projector, or a plain window) ──────────
// Runs the same renderer with a #output hash → a bare <video> that mirrors the
// control canvas over a WebRTC loopback (hardware-encoded, no second render
// pipeline, no double camera access). Main just relays signals. Two modes:
//   fullscreen → borderless, fills the chosen display (projector)
//   windowed   → a normal 16:9 window (easy to Window-Capture in OBS)
let outputWindow: BrowserWindow | null = null

function openOutputWindow(displayId: number, windowed = false): void {
  const displays = screen.getAllDisplays()
  const d = displays.find((x) => x.id === displayId) ?? screen.getPrimaryDisplay()
  if (outputWindow) {
    if (!windowed) outputWindow.setBounds(d.bounds)
    outputWindow.focus()
    return
  }
  outputWindow = new BrowserWindow(
    windowed
      ? {
          // Centred 1280×720 window on the chosen display.
          x: d.bounds.x + Math.round((d.bounds.width - 1280) / 2),
          y: d.bounds.y + Math.round((d.bounds.height - 720) / 2),
          width: 1280,
          height: 720,
          frame: true,
          resizable: true,
          backgroundColor: '#000000',
          title: 'Palinopsia : Output',
          webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            // Never throttle : it's a background window (control has focus).
            backgroundThrottling: false
          }
        }
      : {
          x: d.bounds.x,
          y: d.bounds.y,
          width: d.bounds.width,
          height: d.bounds.height,
          frame: false,
          fullscreen: true,
          backgroundColor: '#000000',
          title: 'Palinopsia : Output',
          webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false
          }
        }
  )
  outputWindow.on('closed', () => {
    outputWindow = null
    mainWindow?.webContents.send('output:closed')
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    outputWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#output`)
  } else {
    outputWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'output' })
  }
}

app.whenReady().then(async () => {
  // Serve local video clips over opsia-media:// (range-capable, persistent).
  handleMediaProtocol()

  // Allow Web MIDI + camera/mic/screen capture in the renderer (all local,
  // user-initiated: MIDI-CC learn and video-capture sources).
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    if (permission === 'midi' || permission === 'midiSysex' || permission === 'media') return cb(true)
    cb(false)
  })

  // Screen capture: getDisplayMedia needs a source. Grant the primary display
  // (a source picker can come later). Webcam getUserMedia needs no handler.
  electronSession.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        .catch(() => callback({}))
    },
    { useSystemPicker: true }
  )

  // Bind the OSC UDP socket on an ephemeral local port for outgoing sends.
  await oscSender.start(0)
  modulation.start()

  prevRunCrashed = autosave.startAutosave().crashed

  // Inbound OSC : buffer messages and flush to the renderer once per frame
  // (~16ms) so a control flood can't drown IPC, but latency stays playable.
  const OSC_BUFFER_MAX = 2000
  let oscInBuffer: OscInMessage[] = []
  oscReceiver.setOnMessage((m) => {
    if (oscInBuffer.length < OSC_BUFFER_MAX) oscInBuffer.push(m)
  })
  const oscInFlush = setInterval(() => {
    if (oscInBuffer.length > 0) {
      const batch = oscInBuffer
      oscInBuffer = []
      mainWindow?.webContents.send('osc:received', batch)
    }
  }, 16)
  app.on('before-quit', () => clearInterval(oscInFlush))

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

  // Start/stop the inbound OSC listener (and, alongside it, the OSCQuery HTTP
  // server). Returns the bound port + this machine's addresses so the UI can
  // tell the user where to point Pandore.
  safeHandle('osc:listen', async (_e, port, enabled) => {
    const addresses = localIPv4s()
    if (!enabled) {
      oscReceiver.stop()
      oscquery.stop()
      return { ok: true, listening: false, port: 0, addresses }
    }
    try {
      const p = port as number
      // OSCQuery's HTTP server sits on port+1; if the OSC port is the last valid
      // one, host it on port-1 instead so it can't overflow to an invalid 65536.
      const httpPort = p >= 65535 ? p - 1 : p + 1
      await oscReceiver.start(p)
      await oscquery.start(httpPort, p)
      return { ok: true, listening: true, port: p, addresses }
    } catch (e) {
      oscReceiver.stop()
      oscquery.stop()
      return { ok: false, listening: false, port: 0, addresses, error: (e as Error).message }
    }
  })

  // Renderer pushes the self-describing parameter tree; OSCQuery serves it.
  safeHandle('oscquery:publish', (_e, nodes) => {
    oscquery.publishTree(nodes as OscQueryNode[])
  })

  // Renderer streams live value diffs (only while a WS client is attached);
  // OSCQuery broadcasts them to subscribers. Fire-and-forget (ipcRenderer.send).
  ipcMain.on('oscquery:values', (_e, updates) => {
    oscquery.pushValues(updates as Array<{ path: string; value: number | number[] }>)
  })
  // Tell the renderer to start/stop its value-push loop as clients come and go.
  oscquery.setOnActive((active) => {
    mainWindow?.webContents.send('oscquery:ws-active', active)
  })

  // ---------- IPC: Capture ----------
  // Enumerate screens + windows (with thumbnails) so the renderer can offer a
  // source picker for screen capture.
  safeHandle('capture:listSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 }
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      isScreen: s.id.startsWith('screen'),
      thumbnail: s.thumbnail.toDataURL()
    }))
  })

  // ---------- IPC: Output window (2nd display) ----------
  safeHandle('output:displays', () => {
    const primary = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: d.label || `Display ${i + 1}`,
      // Report NATIVE pixels (bounds are DIP : a 4K panel at 250% is 1536-wide DIP).
      width: Math.round(d.bounds.width * d.scaleFactor),
      height: Math.round(d.bounds.height * d.scaleFactor),
      isPrimary: d.id === primary
    }))
  })
  safeHandle('output:open', (_e, displayId, windowed) => {
    openOutputWindow(displayId as number, windowed as boolean)
    return true
  })
  safeHandle('output:close', () => {
    outputWindow?.close()
    return true
  })
  // Per-frame render state: control window → output window.
  ipcMain.on('output:frame', (_e, frame) => outputWindow?.webContents.send('output:frame', frame))

  // ---------- IPC: Resource HUD ----------
  safeHandle('perf:stats', () => samplePerf())

  // ---------- IPC: Recording + screenshots ----------
  safeHandle('recording:formats', () => recording.recordingFormats())
  safeHandle('recording:start', (_e, ext, codec) =>
    recording.recordingStart(ext as string, codec as string)
  )
  ipcMain.on('recording:chunk', (_e, data) => recording.recordingChunk(data as Uint8Array))
  safeHandle('recording:stop', (_e, formatId) => recording.recordingStop(formatId as string))
  safeHandle('screenshot:save', (_e, data) => recording.saveScreenshot(data as Uint8Array))

  // ---------- IPC: HIVE live-in ----------
  ipcMain.on('hive:connect', (e, id, host, port) =>
    hiveConnect(e.sender, id as string, host as string, port as number)
  )
  ipcMain.on('hive:disconnect', (_e, id) => hiveDisconnect(id as string))

  // ---------- IPC: HIVE output (sender) ----------
  safeHandle('hiveout:start', (e, port) =>
    hiveSendStart((e as Electron.IpcMainInvokeEvent).sender, port as number)
  )
  safeHandle('hiveout:stop', () => {
    hiveSendStop()
    return true
  })
  ipcMain.on('hiveout:chunk', (_e, key, data) => hiveSendChunk(key as boolean, data as Uint8Array))

  // ---------- IPC: External output (NDI / Spout) ----------
  safeHandle('ndi:set', (_e, on) => outputSender.setNdi(on as boolean))
  safeHandle('spout:set', (_e, on) => outputSender.setSpout(on as boolean))
  ipcMain.on('ndi:frame', (_e, w, h, pixels) =>
    outputSender.send(w as number, h as number, pixels as Uint8Array)
  )

  // ---------- IPC: Session I/O ----------
  // All wrapped in safeHandle so a filesystem throw (path vanished, read-only
  // dir) is logged and returns undefined rather than an uncaught rejection.
  safeHandle('session:saveAs', (_e, s) => sessionIO.saveAs(mainWindow, s as Session))
  safeHandle('session:saveTo', (_e, s, path) => sessionIO.saveTo(path as string, s as Session))
  safeHandle('session:saveToDefault', (_e, s) => sessionIO.saveToDefault(s as Session))
  safeHandle('session:open', () => sessionIO.open(mainWindow))
  safeHandle('session:setCurrent', (_e, s) => autosave.setCurrentSession(s as Session))

  // ---------- IPC: Autosave / crash recovery ----------
  safeHandle('autosave:crashCheck', async () => {
    const entries = await autosave.listAutosaves()
    return { crashed: prevRunCrashed, entries }
  })
  safeHandle('autosave:list', () => autosave.listAutosaves())
  safeHandle('autosave:load', (_e, path) => autosave.loadAutosave(path as string))

  // ---------- IPC: App lifecycle ----------
  safeHandle('app:close-proceed', () => {
    if (closeFallback) {
      clearTimeout(closeFallback)
      closeFallback = null
    }
    appQuitting = true
    mainWindow?.close()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Only tear the subsystems down when we're actually quitting. On macOS the app
  // stays alive in the dock and can be re-activated : shutting down here would
  // stop OSC/modulation with no restart path AND latch `shutdownComplete`, so a
  // reopened window would be dead and the real before-quit shutdown a no-op.
  if (process.platform !== 'darwin') {
    shutdown()
    app.quit()
  }
})

app.on('before-quit', shutdown)
