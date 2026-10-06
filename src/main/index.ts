// Electron main entry. Creates the window and wires IPC for OSC, sessions,
// and autosave. Forked from dataFLOU's main/index.ts, trimmed to Palinopsia's
// surface: the heavy engine lives in the RENDERER (WebGL2 + ISF), so main is
// pure logic + IO : OSC in/out, file I/O, and the output/OSCQuery seams that
// later phases fill in.

import {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  shell,
  session as electronSession,
  desktopCapturer,
  screen,
  globalShortcut,
  powerSaveBlocker
} from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { Session, LightConfig } from '@shared/types'
import { OscSender } from './osc'
import { OscReceiver, localIPv4s, type OscInMessage } from './osc-receive'
import * as sessionIO from './session'
import * as autosave from './autosave'
import { OscQueryServer, type OscQueryNode } from './oscquery'
import { registerMediaScheme, handleMediaProtocol } from './media'
import { registerAssetScheme, handleAssetProtocol } from './assets'
import { killAllConverts, registerVideoConvert, warmVideoFolder } from './videoConvert'
import { registerAssemble } from './assemble'
import { registerCollage } from './collage'
import { registerResolume } from './resolume'
import { hiveConnect, hiveDisconnect, hiveDisconnectAll } from './hive'
import { hiveSendStart, hiveSendChunk, hiveSendStop } from './hiveSend'
import { OutputSender } from './output'
import { prepareNdi } from './ndi/prepare'
import { installNdiRuntime } from './ndi/install'
import { sanitizeNdiConfig } from '@shared/ndi'
import { LightSender } from './light'
import { samplePerf } from './perf'
import * as recording from './recording'
import { installLogging, log, logFrom } from './log'
import { autostartStatus, removeAutostartNow, setAutostart, WATCHDOG_ARG } from './autostart'

// Must run before app ready : makes opsia-media:// a privileged streaming scheme.
registerMediaScheme()
// Same : opsia-asset:// serves the bundled MediaPipe wasm + models (offline).
registerAssetScheme()
// Ask Chromium to enable the platform HEVC decoder + encoder (HIVE live-in and
// HIVE output both use WebCodecs HEVC). Electron 36+ documents app.commandLine
// as lowercasing what it is given, and feature names are case-sensitive :
// measured on Electron 44.5.1, these lists still reach the GPU and renderer
// processes with their case intact (check their command lines after an upgrade).
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,PlatformHEVCEncoderSupport')
// Keep every window rendering when it is covered : the control window renders
// the picture the output shows, and on a single screen the fullscreen output
// covers it. Windows' native occlusion detection (CalculateNativeWinOcclusion)
// and macOS's (MacWebContentsOcclusion) would otherwise mark it hidden and slow
// it down. ONE switch : a second disable-features would replace the first.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,MacWebContentsOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
// And keep full CPU priority for a MINIMIZED operator window : it is the render
// source for NDI / Spout / Syphon / the projector stream, which must not slow down just
// because the operator minimized it mid-show.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
// Grow the GPU program caches (in-memory + on-disk). The renderer pre-warms the
// whole shader registry at launch so Randomize's compile bursts become cache
// hits : ~70 warmed programs need more than Chromium's small default before
// they start evicting each other.
app.commandLine.appendSwitch('gpu-program-cache-size-kb', '16384')
app.commandLine.appendSwitch('gpu-disk-cache-size-kb', '65536')
// Run on the discrete GPU. Windows picks a hybrid laptop's graphics card per
// program path and leaves an unknown program on the integrated chip unless the
// machine's graphics settings say otherwise : about 15x slower here (an RTX 4070
// laptop, measured). The WebGL contexts' powerPreference alone does not move
// Chromium's GPU process; this switch does (macOS too : the discrete GPU).
app.commandLine.appendSwitch('force_high_performance_gpu')
// A log of what goes wrong, above all in an unattended installation
// (<userData>/logs, see log.ts) : main's errors and exceptions, and the windows'.
installLogging()
// After a GPU reset Chromium may blame the page and block WebGL for it : the
// engine could then never start again without a relaunch. Never block it.
app.disableDomainBlockingFor3DAPIs()

let mainWindow: BrowserWindow | null = null

// A dying GPU process is EXACTLY what a white preview with a failure glyph
// looks like from the renderer's side. Name it in the log with its exit code
// so the next occurrence is a diagnosis, not a mystery. (The renderers handle
// the recovery themselves via webglcontextlost/restored.)
let gpuCrashes: number[] = []
app.on('child-process-gone', (_e, details) => {
  if (details.type === 'GPU') {
    console.error(
      `[gpu] GPU process gone : reason=${details.reason} exitCode=${details.exitCode} : ` +
        'renderers will rebuild their GL contexts on restore'
    )
    // An installation whose GPU keeps dying relaunches whole (3 in 10 minutes) :
    // Chromium itself gives up on the GPU after a few crashes.
    if (kioskActive()) {
      const now = Date.now()
      gpuCrashes = gpuCrashes.filter((t) => now - t < 10 * 60_000)
      gpuCrashes.push(now)
      if (gpuCrashes.length >= 3) relaunchApp(`the GPU process died ${gpuCrashes.length} times in 10 minutes`)
    }
  } else if (details.reason !== 'clean-exit') {
    log('warn', `[${details.type}] process gone : ${details.reason} (exit ${details.exitCode})`)
  }
})

// OSC out (renderer → instrument fan-out).
const oscSender = new OscSender()
// Texture sharing : Spout / Syphon (NDI runs in the main window's preload, see ndi/).
const outputSender = new OutputSender()
const lightSender = new LightSender()

// Kiosk / installation mode : boot straight to a session, fullscreen the output,
// get the operator UI out of the way (renderer-driven, see the kiosk effect), and
// self-heal on a renderer crash. Two sources, merged : the `--kiosk [--session=]
// [--display=]` CLI flags (one-off), and a persisted `kiosk.json` toggled from the
// Output inspector's Installation section ("enable on next restart"). argv wins.
interface KioskLaunch {
  enabled?: boolean
  sessionPath?: string
  display?: number
  // The display's name and whether it was the main one, to find it again when its
  // id changes (Windows renumbers displays across reboots and ports).
  displayLabel?: string
  displayWasPrimary?: boolean
}
const argvKiosk = (() => {
  const argv = process.argv
  const val = (f: string): string | undefined => {
    const a = argv.find((x) => x.startsWith(f + '='))
    return a ? a.slice(f.length + 1) : undefined
  }
  const displayRaw = val('--display')
  const display = displayRaw != null ? Number(displayRaw) : undefined
  return {
    kiosk: argv.includes('--kiosk'),
    sessionPath: val('--session'),
    display: display != null && Number.isFinite(display) ? display : undefined,
    // Tests only : the installation's output opens as a window, not fullscreen.
    windowed: argv.includes('--kiosk-windowed')
  }
})()
function kioskFilePath(): string {
  return join(app.getPath('userData'), 'kiosk.json')
}
function readKioskFile(): KioskLaunch {
  try { return JSON.parse(readFileSync(kioskFilePath(), 'utf8')) as KioskLaunch } catch { return {} }
}
function getKioskConfig(): { kiosk: boolean; sessionPath?: string; display?: number; windowed?: boolean } {
  const f = readKioskFile()
  return {
    kiosk: argvKiosk.kiosk || !!f.enabled,
    sessionPath: argvKiosk.sessionPath ?? f.sessionPath,
    display: argvKiosk.display ?? (typeof f.display === 'number' ? f.display : undefined),
    windowed: argvKiosk.windowed
  }
}
/** The installation's display : its id, else the display of the same name, else
 *  (it was a projector) the first display that isn't the main one, else the main
 *  one. A projector powered on after the computer, or renumbered, is found again. */
function kioskTargetDisplay(): Electron.Display {
  const all = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const f = readKioskFile()
  const id = argvKiosk.display ?? (typeof f.display === 'number' ? f.display : undefined)
  if (id == null) return primary
  const byId = all.find((d) => d.id === id)
  if (byId) return byId
  const named = f.displayLabel ? all.filter((d) => d.label === f.displayLabel) : []
  if (named.length === 1) return named[0]
  if (f.displayWasPrimary) return primary
  return all.find((d) => d.id !== primary.id) ?? primary
}
// Live escape hatch for an installation : close the fullscreen output and bring
// the operator window back to the front. Reachable from Esc / O in the output
// window and from a Ctrl+Shift+O global shortcut, so an install that boots into
// a black or wrong-looking output is never a trap. This is a RUNTIME exit only :
// it does not touch kiosk.json, so the next launch still boots the installation
// unless the operator turns it off in Output → Installation.
function exitKiosk(): void {
  kioskExited = true // the self-healing below stands down until the next launch
  outputWindow?.setAlwaysOnTop(false)
  outputWindow?.close()
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('kiosk:exited')
  }
  updateSleepBlock()
}

// ── Installation mode at run time ───────────────────────────────────────────
// Read once : the launch decides. The operator breaking out (exitKiosk) stands
// every installation behaviour down until the next launch.
const kioskBoot = getKioskConfig().kiosk
let kioskExited = false
function kioskActive(): boolean {
  return kioskBoot && !kioskExited
}

// An installation runs ONE copy : a login item or a watchdog launching it again
// while it runs must not start a second one fighting over the OSC port and the
// projector. (Normal use still allows two, e.g. a dev build beside an installed one.)
if (kioskBoot && !app.requestSingleInstanceLock()) {
  log('info', '[kiosk] already running : this second launch quits')
  app.exit(0)
}
// A launch by the installation watchdog (autostart.ts) while Installation mode is
// off : the entry outlived it. Quit at once and remove it, never open a window.
if (process.argv.includes(WATCHDOG_ARG) && !kioskBoot) {
  log('info', '[autostart] a watchdog launch with Installation mode off : quitting, the entry is removed')
  removeAutostartNow()
  app.exit(0)
}

let crashTimes: number[] = []
let hangTimer: ReturnType<typeof setTimeout> | null = null
/** Bring an installation's dead, hung or frozen control window back : reload it
 *  after 1, 2, 4… s (a session that crashes as it loads must not reload in a
 *  tight loop), and relaunch the whole app after 5 failures in 10 minutes. */
function recoverMainWindow(why: string): void {
  const now = Date.now()
  crashTimes = crashTimes.filter((t) => now - t < 10 * 60_000)
  crashTimes.push(now)
  if (crashTimes.length >= 5) {
    relaunchApp(`${crashTimes.length} failures in 10 minutes (last : ${why})`)
    return
  }
  const delay = Math.min(30_000, 1000 * 2 ** (crashTimes.length - 1))
  log('warn', `[kiosk] reloading the control window in ${delay / 1000} s (${why})`)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !appQuitting) mainWindow.reload()
  }, delay)
}

/** Start the whole app again, same arguments, after a clean shutdown. At most 6
 *  times in 30 minutes (counted on disk, across the relaunches) : a machine whose
 *  GPU is gone for good must not relaunch forever. */
function relaunchApp(why: string): void {
  const file = join(app.getPath('userData'), 'logs', 'relaunches.json')
  const now = Date.now()
  let times: number[] = []
  try { times = (JSON.parse(readFileSync(file, 'utf8')) as number[]).filter((t) => now - t < 30 * 60_000) } catch { /* none yet */ }
  if (times.length >= 6) {
    log('error', `[kiosk] would relaunch (${why}) but it already did ${times.length} times in 30 minutes : giving up`)
    return
  }
  try { writeFileSync(file, JSON.stringify([...times, now])) } catch { /* best effort */ }
  log('error', `[kiosk] relaunching : ${why}`)
  shutdown()
  app.relaunch()
  app.exit(0)
}

// The control window reports its frame count every few seconds (app:alive). An
// installation whose picture stops advancing for 45 s (a renderer stuck in a loop,
// or alive but no longer drawing) has its renderer restarted : crashed on purpose,
// it comes back through render-process-gone (recoverMainWindow). A plain reload
// could wait forever on a page that no longer answers. Armed by the first report.
let alive = { frames: -1, at: 0 }
function checkAlive(): void {
  if (!kioskActive() || !alive.at || appQuitting) return
  if (Date.now() - alive.at > 45_000 && mainWindow && !mainWindow.isDestroyed()) {
    alive = { frames: -1, at: 0 }
    log('error', '[kiosk] the picture stopped advancing for 45 s : restarting the control renderer')
    mainWindow.webContents.forcefullyCrashRenderer()
  }
}

// The display never sleeps while an installation runs or an output window is up
// (a projector going dark mid-show). This also keeps the computer awake and macOS
// from napping the app.
let sleepBlock: number | null = null
function updateSleepBlock(): void {
  const want = kioskActive() || (!!outputWindow && !outputWindow.isDestroyed())
  if (want && sleepBlock === null) {
    sleepBlock = powerSaveBlocker.start('prevent-display-sleep')
    log('info', '[power] the display stays awake')
  } else if (!want && sleepBlock !== null) {
    powerSaveBlocker.stop(sleepBlock)
    sleepBlock = null
    log('info', '[power] the display may sleep again')
  }
}

// The default menu's shortcuts are swallowed in an installation : reload (which
// used to cut the projector), close, quit, hide, minimize, full screen, dev tools.
// Esc / O and Ctrl+Shift+O, the exit hatch, are left alone.
function guardKioskKeys(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (e, input) => {
    if (!kioskActive() || input.type !== 'keyDown') return
    const k = input.key.toLowerCase()
    const mod = input.control || input.meta
    const blocked =
      k === 'f5' || k === 'f11' || k === 'f12' ||
      (mod && (k === 'r' || k === 'w' || k === 'q' || k === 'm' || k === 'h')) ||
      (mod && input.shift && (k === 'i' || k === 'j' || k === 'c'))
    if (blocked) e.preventDefault()
  })
}

// Projectors come and go (unplugged, powered after the computer, another
// resolution) : an installation puts its output back on its display.
let placeTimer: ReturnType<typeof setTimeout> | null = null
function scheduleKioskPlacement(): void {
  if (!kioskActive()) return
  if (placeTimer) clearTimeout(placeTimer)
  placeTimer = setTimeout(() => {
    placeTimer = null
    if (!kioskActive() || !outputWindow || outputWindow.isDestroyed() || getKioskConfig().windowed) return
    const d = kioskTargetDisplay()
    const b = outputWindow.getBounds()
    const t = d.bounds
    if (b.x === t.x && b.y === t.y && b.width === t.width && b.height === t.height) return
    log('info', `[kiosk] the displays changed : the output moves to ${d.label || d.id} (${t.width}x${t.height})`)
    const old = outputWindow
    outputWindow = null
    old.removeAllListeners('closed')
    old.destroy()
    openOutputWindow(d.id, false)
  }, 1500)
}
// OSC in : the instrument is PLAYED through this: Pandore/TouchOSC send here
// and the renderer maps addresses onto the store (see renderer/oscInput.ts).
const oscReceiver = new OscReceiver()
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
  oscSender.stop()
  oscReceiver.stop()
  oscquery.stop()
  autosave.stopAutosave()
  hiveDisconnectAll()
  hiveSendStop()
  outputSender.dispose()
  lightSender.dispose()
  globalShortcut.unregisterAll()
}

// Window-chrome title with the release, like dataFLOU_compositor : "Palinopsia
// v1.1.0". app.getVersion() reads package.json, so every tagged build titles itself.
function appTitle(suffix = ''): string {
  return `Palinopsia v${app.getVersion()}${suffix}`
}

/** Pin a window's title. Every window loads the same index.html, and Electron
 *  syncs its <title> onto the window chrome on each load, which would wipe the
 *  version (and the output windows' ": Output" suffix) back to "Palinopsia". */
function lockTitle(win: BrowserWindow, title: string): void {
  win.setTitle(title)
  win.on('page-title-updated', (e) => e.preventDefault())
}

// Window/taskbar icon. electron-builder stamps the exe icon (which covers the
// shortcut), but a RUNNING window's taskbar button uses the WINDOW icon, so it
// must be set here too. Packaged: bundled via extraResources into resources/;
// dev: from build/ at the repo root. Undefined if missing (Electron ignores it).
function windowIcon(): string | undefined {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'build')
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const p = join(base, file)
  return existsSync(p) ? p : undefined
}

function createWindow(): void {
  // A fresh window must re-arm the save-before-quit intercept. On macOS the app
  // survives its last window's close (which latched `appQuitting = true` via
  // close-proceed); an `activate` then re-creates a window here, so reset the
  // latch or that new window's `close` would bypass the Save modal. The real
  // quit path flips it back to true (close-proceed) before closing.
  appQuitting = false
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0a0a0a', // near-black : the instrument's canvas (brief §1)
    autoHideMenuBar: true,
    title: appTitle(),
    icon: windowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // The instrument keeps playing when its window is minimized or covered :
      // NDI, the projector stream, Sonify and OSC out all run on the render loop,
      // which falls back to timers while the window doesn't paint (App.tsx) :
      // unthrottled here so those timers keep full rate.
      backgroundThrottling: false
    }
  })
  lockTitle(mainWindow, appTitle())

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Crashes and hangs are always logged. An installation heals itself (reload
  // with a backoff, relaunch after repeated failures : recoverMainWindow); a
  // normal session leaves the dead window as it is, for debugging.
  mainWindow.webContents.on('render-process-gone', (_e, d) => {
    log('error', `[control window] renderer gone : ${d.reason} (exit ${d.exitCode})`)
    if (kioskActive()) recoverMainWindow(`renderer ${d.reason}`)
  })
  mainWindow.on('unresponsive', () => {
    log('warn', '[control window] unresponsive')
    if (!kioskActive() || hangTimer) return
    hangTimer = setTimeout(() => {
      hangTimer = null
      log('error', '[control window] still unresponsive after 20 s : restarting its renderer')
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.forcefullyCrashRenderer()
    }, 20_000)
  })
  mainWindow.on('responsive', () => {
    if (hangTimer) {
      clearTimeout(hangTimer)
      hangTimer = null
    }
  })
  mainWindow.webContents.on('console-message', (e) => logFrom('control', e.level, e.message))
  // A reloaded control window needs a fresh frame link to the projector.
  mainWindow.webContents.on('did-finish-load', () => {
    if (outputWindow && !outputWindow.isDestroyed()) wirePixelPort()
  })
  if (kioskActive()) guardKioskKeys(mainWindow)

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
    // A quit asked for while the window was open (Cmd+Q, the Dock) goes on once
    // the window has closed through its Save prompt (see before-quit).
    if (quitRequested) app.quit()
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
    // Same mode as the live window → fast path : re-home it on the requested
    // display (windowed re-centres; fullscreen fills the display) and focus.
    // Not for a fullscreen window on macOS : it lives in its own Space there and
    // ignores new bounds, so moving it to another display rebuilds it below.
    const macFullMove = process.platform === 'darwin' && !windowed &&
      screen.getDisplayMatching(outputWindow.getBounds()).id !== d.id
    if (outputWindow.isFullScreen() !== windowed && !macFullMove) {
      if (windowed) {
        outputWindow.setBounds({
          x: d.bounds.x + Math.round((d.bounds.width - 1280) / 2),
          y: d.bounds.y + Math.round((d.bounds.height - 720) / 2),
          width: 1280,
          height: 720
        })
      } else {
        outputWindow.setBounds(d.bounds)
      }
      outputWindow.focus()
      return
    }
    // Mode switch (fullscreen↔windowed; the two configs differ by `frame`, which
    // can't be toggled after creation) or a macOS fullscreen move : recreate cleanly. Drop our
    // 'closed' handler first so its teardown (null + 'output:closed' to the
    // renderer) doesn't fire for this internal swap, then build afresh below.
    const old = outputWindow
    outputWindow = null
    old.removeAllListeners('closed')
    old.destroy()
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
          title: appTitle(' : Output'),
          icon: windowIcon(),
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
          title: appTitle(' : Output'),
          icon: windowIcon(),
          webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false
          }
        }
  )
  finalizeOutputWindow(windowed ? 'windowed' : 'full')
}

// Multi-projector SPAN : one borderless window covering the union of several
// displays (each projector is a separate monitor, arranged adjacent in Windows).
// Not `fullscreen:true` — that restricts a window to one monitor; a borderless
// window positioned across the union bounds spans them. Per-projector keystone /
// edge-blend is a later phase ; this shows one wide composition across the row.
function openSpanWindow(displayIds: number[]): void {
  const all = screen.getAllDisplays()
  const chosen = all.filter((d) => displayIds.includes(d.id))
  const set = chosen.length > 0 ? chosen : all
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const d of set) {
    x0 = Math.min(x0, d.bounds.x); y0 = Math.min(y0, d.bounds.y)
    x1 = Math.max(x1, d.bounds.x + d.bounds.width); y1 = Math.max(y1, d.bounds.y + d.bounds.height)
  }
  const bounds = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  // A frame change can't be toggled after creation, so always recreate cleanly.
  if (outputWindow) {
    const old = outputWindow
    outputWindow = null
    old.removeAllListeners('closed')
    old.destroy()
  }
  outputWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    // macOS keeps a window inside one screen unless told otherwise.
    enableLargerThanScreen: true,
    backgroundColor: '#000000',
    title: appTitle(' : Output'),
    icon: windowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  // Enforce the exact union rect after creation (some platforms nudge borderless
  // bounds). NOT always-on-top : spanning the operator's own display too would
  // otherwise trap it with no way back (the Esc hatch is kiosk-only). The projector
  // displays keep showing the output while the operator stays reachable.
  outputWindow.setBounds(bounds)
  finalizeOutputWindow('span')
}

// Shared teardown + load + frame-port wiring for whichever output window we just
// built (single display or span).
function finalizeOutputWindow(kind: 'full' | 'windowed' | 'span'): void {
  if (!outputWindow) return
  const win = outputWindow
  lockTitle(win, appTitle(' : Output'))
  win.on('closed', () => {
    if (outputWindow === win) outputWindow = null
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('output:closed')
    updateSleepBlock()
    // An installation's projector never stays dark : closed by a stray key, or by
    // anything else than the exit hatch, it opens again on its display.
    if (kioskActive() && !appQuitting) {
      log('warn', '[kiosk] the output closed : it opens again in 3 s')
      setTimeout(() => {
        if (!outputWindow && kioskActive() && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('kiosk:reopenOutput')
        }
      }, 3000)
    }
  })
  // The output only presents frames : a renderer that dies there just comes back.
  win.webContents.on('render-process-gone', (_e, d) => {
    log('error', `[output] renderer gone : ${d.reason} (exit ${d.exitCode}) : reloading`)
    setTimeout(() => {
      if (!win.isDestroyed()) win.reload()
    }, 1000)
  })
  win.webContents.on('console-message', (e) => logFrom('output', e.level, e.message))
  if (kioskActive()) {
    guardKioskKeys(win)
    // Above everything (a system notice, an update toast) in an installation, on
    // Windows. Not on macOS : its fullscreen output lives in its own Space, where a
    // window level can fight the fullscreen itself.
    if (kind === 'full' && process.platform === 'win32') win.setAlwaysOnTop(true, 'screen-saver')
  }
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#output`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'output' })
  }
  // A DIRECT renderer↔renderer MessagePort for streaming the composited frame :
  // the control window transfers each finished RGBA8 frame (zero-copy) and the
  // output window blits it, so the projector shows the control's EXACT pixels
  // instead of an independent re-render that diverges on live sources. A fresh
  // pair on EVERY load of the output (and of the control window, see
  // createWindow) : wired once, a reloaded window used to leave the projector
  // frozen on its last frame.
  win.webContents.on('did-finish-load', () => wirePixelPort())
  updateSleepBlock()
}

function wirePixelPort(): void {
  if (!outputWindow || outputWindow.isDestroyed() || !mainWindow || mainWindow.isDestroyed()) return
  const { port1, port2 } = new MessageChannelMain()
  mainWindow.webContents.postMessage('output:pixelport', null, [port1])
  outputWindow.webContents.postMessage('output:pixelport', null, [port2])
}

app.whenReady().then(async () => {
  // Windows taskbar identity. Without an explicit AppUserModelID the running
  // window isn't tied to the installed shortcut (whose AUMID electron-builder
  // sets to appId), so Windows shows a generic blank taskbar icon instead of
  // the app icon. Must match electron-builder.yml `appId`.
  if (process.platform === 'win32') app.setAppUserModelId('com.vincentfillion.palinopsia')
  // Serve local video clips over opsia-media:// (range-capable, persistent).
  handleMediaProtocol()
  // Serve bundled MediaPipe wasm + models over opsia-asset:// (offline/kiosk).
  handleAssetProtocol()
  registerVideoConvert()
  registerAssemble()
  registerCollage()
  registerResolume()

  // Allow Web MIDI + camera/mic/screen capture in the renderer (all local,
  // user-initiated: MIDI-CC learn and video-capture sources). Screen capture asks
  // as 'display-capture' since Electron 36 (it used to come in as 'media'), so
  // without it the screen-capture source was refused.
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    if (permission === 'midi' || permission === 'midiSysex' || permission === 'media' || permission === 'display-capture')
      return cb(true)
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
  app.on('will-quit', () => {
    clearInterval(oscInFlush)
    killAllConverts() // never orphan an in-flight ffmpeg transcode
  })

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

  // Fire-and-forget (ipcRenderer.send) counterpart of safeHandle. These channels
  // fire at frame rate or from live sockets; a throw — a destroyed output window
  // mid-close, a bad port, a dead socket — must be logged, never bubble up into
  // an uncaught main-process exception / crash dialog.
  function safeOn(
    channel: string,
    handler: (event: Electron.IpcMainEvent, ...args: unknown[]) => void
  ): void {
    ipcMain.on(channel, (event, ...args) => {
      try {
        handler(event, ...args)
      } catch (e) {
        console.error(`[ipc] ${channel} threw:`, (e as Error).message)
      }
    })
  }

  // ---------- IPC: OSC ----------
  // Fire-and-forget batch (the Resolume mapper sends dozens of addresses per
  // tick; one invoke round trip each would be wasted IPC).
  ipcMain.on('osc:sendBatch', (_e, ip: string, port: number, msgs: Array<{ address: string; args: Array<{ type: 'i' | 'f' | 's' | 'T' | 'F'; value: number | string | boolean }> }>) => {
    try {
      if (!Array.isArray(msgs)) return
      for (const m of msgs.slice(0, 2048)) oscSender.sendMany(ip, port, m.address, m.args)
    } catch (err) {
      console.error('[osc] batch send failed:', (err as Error).message)
    }
  })

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
  safeOn('oscquery:values', (_e, updates) => {
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
  safeHandle('output:openSpan', (_e, displayIds) => {
    openSpanWindow((displayIds as number[]) ?? [])
    return true
  })
  // A reloaded control window asks whether an output is still open, to stream
  // to it again (it used to forget, and the open output froze).
  safeHandle('output:isOpen', () => !!outputWindow && !outputWindow.isDestroyed())
  safeHandle('output:close', () => {
    outputWindow?.close()
    return true
  })
  // Per-frame render state: control window → output window. Guard the window +
  // its webContents : a frame in flight while the output window is closing would
  // otherwise throw "Object has been destroyed" on every close.
  safeOn('output:frame', (_e, frame) => {
    if (outputWindow && !outputWindow.isDestroyed() && !outputWindow.webContents.isDestroyed()) {
      outputWindow.webContents.send('output:frame', frame)
    }
  })

  // ---------- IPC: Resource HUD ----------
  safeHandle('perf:stats', () => samplePerf())

  // ---------- IPC: Recording + screenshots ----------
  safeHandle('recording:formats', () => recording.recordingFormats())
  safeHandle('recording:takePath', (_e, ext) => recording.takePath(ext as string))
  // Where takes, screenshots and Assemble exports go (Output → Record → location).
  safeHandle('recording:folder', () => recording.recordingFolderInfo())
  safeHandle('recording:chooseFolder', () => recording.chooseRecordingFolder(mainWindow))
  safeHandle('recording:resetFolder', () => recording.resetRecordingFolder())
  safeHandle('recording:openFolder', () => shell.openPath(recording.outputFolder()))
  safeHandle('recording:start', (_e, ext, codec) =>
    recording.recordingStart(ext as string, codec as string)
  )
  safeOn('recording:chunk', (_e, data) => recording.recordingChunk(data as Uint8Array))
  safeHandle('recording:stop', (_e, formatId, withSound) => recording.recordingStop(formatId as string, withSound !== false))
  safeHandle('screenshot:save', (_e, data) => recording.saveScreenshot(data as Uint8Array))

  // ---------- IPC: HIVE live-in ----------
  safeOn('hive:connect', (e, id, host, port) =>
    hiveConnect(e.sender, id as string, host as string, port as number)
  )
  safeOn('hive:disconnect', (_e, id) => hiveDisconnect(id as string))

  // ---------- IPC: HIVE output (sender) ----------
  safeHandle('hiveout:start', (e, port) =>
    hiveSendStart((e as Electron.IpcMainInvokeEvent).sender, port as number)
  )
  safeHandle('hiveout:stop', () => {
    hiveSendStop()
    return true
  })
  safeOn('hiveout:chunk', (_e, key, data) => hiveSendChunk(key as boolean, data as Uint8Array))

  // ---------- IPC: External output (NDI · Spout / Syphon) ----------
  // NDI : the sender lives in the main window's preload (frames never leave the
  // renderer); main only finds the runtime and writes the network config.
  safeHandle('ndi:prepare', (_e, cfg) => prepareNdi(sanitizeNdiConfig(cfg)))
  // A computer with no NDI : fetch NDI's official runtime installer and open it.
  safeHandle('ndi:installRuntime', (e) => installNdiRuntime((e as Electron.IpcMainInvokeEvent).sender))
  // Spout (Windows) / Syphon (macOS) : texture sharing with apps on this machine.
  safeHandle('share:set', (_e, on) => outputSender.setShare(on as boolean))
  safeOn('share:frame', (_e, w, h, pixels) =>
    outputSender.send(w as number, h as number, pixels as Uint8Array)
  )

  // ---------- IPC: Light output (ArtNet/DMX · WLED) ----------
  safeOn('light:config', (_e, cfg) => lightSender.setConfig(cfg as LightConfig | null))
  safeOn('light:frame', (_e, cols, rows, pixels) =>
    lightSender.send(cols as number, rows as number, pixels as Uint8Array)
  )

  // ---------- IPC: Kiosk / installation mode ----------
  safeHandle('kiosk:config', () => getKioskConfig())
  safeHandle('kiosk:getLaunch', () => readKioskFile())
  safeHandle('kiosk:setLaunch', async (_e, cfg) => {
    try {
      writeFileSync(kioskFilePath(), JSON.stringify((cfg as KioskLaunch) ?? {}))
    } catch {
      return false
    }
    // Installation mode off : it no longer starts with the computer either.
    if (!(cfg as KioskLaunch | undefined)?.enabled && (await autostartStatus()).on) await setAutostart(false)
    return true
  })
  safeHandle('kiosk:autostart', () => autostartStatus())
  safeHandle('kiosk:setAutostart', (_e, on) => setAutostart(!!on))
  safeHandle('kiosk:exit', () => { exitKiosk(); return true })
  safeHandle('kiosk:targetDisplay', () => kioskTargetDisplay().id)
  // The engine could not get WebGL at all : an installation relaunches (after 5 s).
  safeOn('kiosk:glFailed', (_e, where) => {
    log('error', `[gl] no WebGL in the ${String(where)}`)
    if (kioskActive()) setTimeout(() => relaunchApp(`no WebGL in the ${String(where)}`), 5000)
  })
  safeOn('app:alive', (_e, n) => {
    const frames = Number(n)
    if (frames !== alive.frames) alive = { frames, at: Date.now() }
  })
  if (kioskBoot) {
    setInterval(checkAlive, 10_000)
    screen.on('display-added', scheduleKioskPlacement)
    screen.on('display-removed', scheduleKioskPlacement)
    screen.on('display-metrics-changed', scheduleKioskPlacement)
  }
  updateSleepBlock()
  safeOn('app:minimizeMain', () => mainWindow?.minimize())

  // Global escape backstop : whichever window has focus (the borderless
  // fullscreen output usually does), Ctrl+Shift+O always breaks out of an
  // installation. The in-output Esc / O keys cover the common case; this covers
  // the rest. Only armed when we actually launch into kiosk.
  if (getKioskConfig().kiosk) {
    try { globalShortcut.register('CommandOrControl+Shift+O', () => exitKiosk()) } catch { /* combo taken */ }
  }

  // ---------- IPC: Session I/O ----------
  // All wrapped in safeHandle so a filesystem throw (path vanished, read-only
  // dir) is logged and returns undefined rather than an uncaught rejection.
  safeHandle('session:saveAs', (_e, s, cur) => sessionIO.saveAs(mainWindow, s as Session, (cur as string | null) ?? null))
  safeHandle('session:keepRecovery', (_e, s) => sessionIO.keepRecovery(s as Session))
  safeHandle('session:openVersion', (_e, path) => sessionIO.openVersion(mainWindow, path as string))
  safeHandle('session:versionCount', (_e, path) => sessionIO.versionCount(path as string))
  safeHandle('session:saveTo', (_e, s, path) => sessionIO.saveTo(path as string, s as Session))
  safeHandle('session:open', () => sessionIO.open(mainWindow))
  safeHandle('session:list', () => sessionIO.listSaved())
  safeHandle('session:folders', () => sessionIO.linkedFolders())
  safeHandle('session:folderAdd', () => sessionIO.addFolder(mainWindow))
  safeHandle('session:folderRemove', (_e, folder) => sessionIO.removeFolder(folder as string))
  safeHandle('session:load', (_e, path) => {
    // Warm the session folder's clips in the background (pre-convert DXV/HAP/
    // ProRes into the all-intra cache) so every clip beside the session is
    // instant to load. Fire-and-forget : never delays the session itself.
    void import('path').then(({ dirname }) => warmVideoFolder(dirname(path as string))).catch(() => {})
    return sessionIO.loadFromPath(path as string)
  })
  safeHandle('session:setCurrent', (_e, s) => autosave.setCurrentSession(s as Session))

  // ---------- IPC: Autosave / crash recovery ----------
  safeHandle('autosave:crashCheck', async () => {
    const entries = await autosave.listAutosaves()
    return { crashed: prevRunCrashed, entries }
  })
  safeHandle('autosave:list', () => autosave.listAutosaves())
  safeHandle('autosave:load', (_e, path) => autosave.loadAutosave(path as string))

  // ---------- IPC: App lifecycle ----------
  // The renderer is asking "Save changes?" : the user may take longer than the
  // hung-renderer grace period, so hold the forced close (a hung renderer never
  // sends this, so the fallback still protects that case).
  safeHandle('app:close-hold', () => {
    if (closeFallback) {
      clearTimeout(closeFallback)
      closeFallback = null
    }
  })
  safeHandle('app:close-cancel', () => {
    if (closeFallback) {
      clearTimeout(closeFallback)
      closeFallback = null
    }
  })
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
  // An installation quits on macOS too, so a watchdog can start it again.
  if (process.platform !== 'darwin' || kioskBoot) {
    shutdown()
    app.quit()
  }
})

// Quitting (Cmd+Q, the Dock, a logout) first closes the control window, so its
// Save-changes prompt runs before anything stops; the subsystems shut down only
// once the app really quits (will-quit). They used to stop on before-quit, so a
// cancelled prompt left the app running with OSC, autosave and the senders dead.
let quitRequested = false
app.on('before-quit', (e) => {
  if (mainWindow && !mainWindow.isDestroyed() && !appQuitting) {
    e.preventDefault()
    quitRequested = true
    mainWindow.close()
  }
})
app.on('will-quit', shutdown)
