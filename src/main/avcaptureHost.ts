// USB input (macOS) : starts the capture process (avcaptureWorker.ts) the first
// time a window asks for it, and hands each window a MessagePort to it. The
// captures cannot run in the window itself : macOS never shows an iPhone's
// screen to a renderer (see the worker's header).
//
// One process for the whole app, shared by every window; if it dies, each
// window is told, and connects again (the next connect starts a new one).

import { app, ipcMain, MessageChannelMain, utilityProcess, webContents, type UtilityProcess } from 'electron'
import { join } from 'path'
import { log } from './log'

let child: UtilityProcess | null = null

/** native/avcapture's addon : beside the app in development, unpacked from the
 *  asar archive in a packaged app (electron-builder's asarUnpack). */
function addonPath(): string {
  return join(app.getAppPath(), 'native', 'avcapture', 'build', 'Release', 'avcapture.node').replace(
    /app\.asar(?=$|[\\/])/,
    'app.asar.unpacked'
  )
}

function worker(): UtilityProcess {
  if (child) return child
  const c = utilityProcess.fork(join(__dirname, 'avcaptureWorker.js'), [addonPath()], {
    serviceName: 'Palinopsia USB input'
  })
  child = c
  c.on('message', (m: { t?: string; msg?: string } | null) => {
    if (m?.t === 'log') log('warn', `[usb input] ${m.msg}`)
  })
  c.on('exit', (code) => {
    if (child === c) child = null
    if (app.isReady() && !appQuitting) {
      log('warn', `[usb input] the capture process stopped (exit ${code}) : the windows connect again`)
      for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed()) wc.send('avf:lost')
    }
  })
  return c
}

let appQuitting = false

export function installAvcaptureHost(): void {
  if (process.platform !== 'darwin') return
  ipcMain.on('avf:connect', (e) => {
    const { port1, port2 } = new MessageChannelMain()
    worker().postMessage({ t: 'client' }, [port1])
    e.sender.postMessage('avf:port', null, [port2])
  })
  app.on('before-quit', () => {
    appQuitting = true
    child?.kill()
  })
}
