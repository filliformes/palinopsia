import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ExposedApi, OscEvent, OscErrorEvent, OscInEvent, Session } from '@shared/types'

const api: ExposedApi = {
  // ── Session I/O ──────────────────────────────────────────────────
  sessionSaveAs: (s: Session) => ipcRenderer.invoke('session:saveAs', s),
  sessionSave: (s: Session, path: string) => ipcRenderer.invoke('session:saveTo', s, path),
  sessionSaveToDefault: (s) => ipcRenderer.invoke('session:saveToDefault', s),
  sessionOpen: () => ipcRenderer.invoke('session:open'),

  // ── Autosave / crash recovery ────────────────────────────────────
  autosaveCrashCheck: () => ipcRenderer.invoke('autosave:crashCheck'),
  autosaveList: () => ipcRenderer.invoke('autosave:list'),
  autosaveLoad: (path: string) => ipcRenderer.invoke('autosave:load', path),
  setCurrentSession: (s) => ipcRenderer.invoke('session:setCurrent', s),

  // ── OSC control plane ────────────────────────────────────────────
  oscSend: (ip, port, address, args) =>
    ipcRenderer.invoke('osc:send', ip, port, address, args),
  onOscIn: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, batch: OscEvent[]): void => cb(batch)
    ipcRenderer.on('osc:in', h)
    return () => ipcRenderer.off('osc:in', h)
  },
  onOscErrors: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, batch: OscErrorEvent[]): void => cb(batch)
    ipcRenderer.on('osc:errors', h)
    return () => ipcRenderer.off('osc:errors', h)
  },

  // ── OSC input (Pandore → instrument) ─────────────────────────────
  oscListen: (port, enabled) => ipcRenderer.invoke('osc:listen', port, enabled),
  onOscReceived: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, batch: OscInEvent[]): void => cb(batch)
    ipcRenderer.on('osc:received', h)
    return () => ipcRenderer.off('osc:received', h)
  },
  oscQueryPublish: (nodes) => ipcRenderer.invoke('oscquery:publish', nodes),

  // ── Media ────────────────────────────────────────────────────────
  // Resolve a picked <input type=file> File to its absolute path (Electron 33
  // removed File.path). The renderer turns this into an opsia-media:// URL.
  getMediaPath: (file: File) => webUtils.getPathForFile(file),

  // ── App lifecycle ────────────────────────────────────────────────
  appCloseProceed: () => ipcRenderer.invoke('app:close-proceed'),
  onAppBeforeClose: (cb) => {
    const h = (): void => cb()
    ipcRenderer.on('app:before-close', h)
    return () => ipcRenderer.off('app:before-close', h)
  }
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window {
    api: ExposedApi
  }
}
