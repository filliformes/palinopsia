import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ExposedApi,
  HiveAU,
  HiveStatus,
  OutputFrame,
  OscEvent,
  OscErrorEvent,
  OscInEvent,
  Session
} from '@shared/types'

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
  oscQueryValues: (updates) => ipcRenderer.send('oscquery:values', updates),
  onOscQueryWsActive: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, active: boolean): void => cb(active)
    ipcRenderer.on('oscquery:ws-active', h)
    return () => ipcRenderer.off('oscquery:ws-active', h)
  },

  // ── Media ────────────────────────────────────────────────────────
  // Resolve a picked <input type=file> File to its absolute path (Electron 33
  // removed File.path). The renderer turns this into an opsia-media:// URL.
  getMediaPath: (file: File) => webUtils.getPathForFile(file),
  captureListSources: () => ipcRenderer.invoke('capture:listSources'),

  // ── Output window (2nd display) ──────────────────────────────────
  outputDisplays: () => ipcRenderer.invoke('output:displays'),
  outputOpen: (displayId: number, windowed = false) =>
    ipcRenderer.invoke('output:open', displayId, windowed),
  outputClose: () => ipcRenderer.invoke('output:close'),
  onOutputClosed: (cb: () => void) => {
    const h = (): void => cb()
    ipcRenderer.on('output:closed', h)
    return () => ipcRenderer.off('output:closed', h)
  },
  // Control → output window: push the per-frame render state (composition +
  // modulation + warp + clock) so the output renders it natively (pixel-perfect).
  outputFrame: (frame: OutputFrame) => ipcRenderer.send('output:frame', frame),
  onOutputFrame: (cb: (frame: OutputFrame) => void) => {
    const h = (_e: Electron.IpcRendererEvent, frame: OutputFrame): void => cb(frame)
    ipcRenderer.on('output:frame', h)
    return () => ipcRenderer.off('output:frame', h)
  },

  // ── HIVE live-in ─────────────────────────────────────────────────
  hiveConnect: (id: string, host: string, port: number) =>
    ipcRenderer.send('hive:connect', id, host, port),
  hiveDisconnect: (id: string) => ipcRenderer.send('hive:disconnect', id),
  onHiveAU: (cb: (au: HiveAU) => void) => {
    const h = (_e: Electron.IpcRendererEvent, au: HiveAU): void => cb(au)
    ipcRenderer.on('hive:au', h)
    return () => ipcRenderer.off('hive:au', h)
  },
  onHiveStatus: (cb: (s: HiveStatus) => void) => {
    const h = (_e: Electron.IpcRendererEvent, s: HiveStatus): void => cb(s)
    ipcRenderer.on('hive:status', h)
    return () => ipcRenderer.off('hive:status', h)
  },
  // HIVE output (sender).
  hiveOutStart: (port: number) => ipcRenderer.invoke('hiveout:start', port),
  hiveOutStop: () => ipcRenderer.invoke('hiveout:stop'),
  hiveSendChunk: (key: boolean, data: Uint8Array) => ipcRenderer.send('hiveout:chunk', key, data),
  onHiveForceKey: (cb: () => void) => {
    const h = (): void => cb()
    ipcRenderer.on('hive:forceKey', h)
    return () => ipcRenderer.off('hive:forceKey', h)
  },

  // ── External output (NDI / Spout) ────────────────────────────────
  ndiSet: (on: boolean) => ipcRenderer.invoke('ndi:set', on),
  spoutSet: (on: boolean) => ipcRenderer.invoke('spout:set', on),
  ndiFrame: (w: number, h: number, pixels: Uint8Array) => ipcRenderer.send('ndi:frame', w, h, pixels),

  // ── Resource HUD + recording ─────────────────────────────────────
  perfStats: () => ipcRenderer.invoke('perf:stats'),
  recordingFormats: () => ipcRenderer.invoke('recording:formats'),
  recordingStart: (ext: string, codec: string) => ipcRenderer.invoke('recording:start', ext, codec),
  recordingChunk: (data: Uint8Array) => ipcRenderer.send('recording:chunk', data),
  recordingStop: (formatId: string) => ipcRenderer.invoke('recording:stop', formatId),
  saveScreenshot: (data: Uint8Array) => ipcRenderer.invoke('screenshot:save', data),

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
