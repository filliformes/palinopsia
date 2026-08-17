import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ExposedApi,
  HiveAU,
  HiveStatus,
  OutputFrame,
  OscInEvent,
  Session
} from '@shared/types'
import type { CollageScanResult } from '@shared/collage'

const api: ExposedApi = {
  // ── Session I/O ──────────────────────────────────────────────────
  sessionSaveAs: (s: Session) => ipcRenderer.invoke('session:saveAs', s),
  sessionSave: (s: Session, path: string) => ipcRenderer.invoke('session:saveTo', s, path),
  sessionSaveToDefault: (s) => ipcRenderer.invoke('session:saveToDefault', s),
  sessionOpen: () => ipcRenderer.invoke('session:open'),
  sessionList: () => ipcRenderer.invoke('session:list'),
  sessionLoad: (path: string) => ipcRenderer.invoke('session:load', path),

  // ── Autosave / crash recovery ────────────────────────────────────
  autosaveCrashCheck: () => ipcRenderer.invoke('autosave:crashCheck'),
  autosaveList: () => ipcRenderer.invoke('autosave:list'),
  autosaveLoad: (path: string) => ipcRenderer.invoke('autosave:load', path),
  setCurrentSession: (s) => ipcRenderer.invoke('session:setCurrent', s),

  // ── OSC control plane ────────────────────────────────────────────
  oscSend: (ip, port, address, args) =>
    ipcRenderer.invoke('osc:send', ip, port, address, args),

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
  // Codec probe + ffmpeg conversion (DXV3 / HAP / ProRes… → all-intra H.264 cache).
  videoProbe: (path: string) => ipcRenderer.invoke('video:probe', path),
  videoConvert: (path: string) => ipcRenderer.invoke('video:convert', path),
  onVideoConvertProgress: (cb: (p: { path: string; pct: number }) => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: { path: string; pct: number }): void => cb(p)
    ipcRenderer.on('video:convertProgress', h)
    return () => ipcRenderer.off('video:convertProgress', h)
  },

  // ── Assemble (corpus analysis + edit export) ─────────────────────
  assemblePickFolder: () => ipcRenderer.invoke('assemble:pickFolder'),
  assembleAnalyze: (folder: string, opts?: { minUnit?: number; maxUnit?: number; sensitivity?: number }) =>
    ipcRenderer.invoke('assemble:analyze', folder, opts),
  onAssembleProgress: (cb: (p: import('@shared/assemble').AnalyzeProgress) => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: import('@shared/assemble').AnalyzeProgress): void => cb(p)
    ipcRenderer.on('assemble:progress', h)
    return () => ipcRenderer.off('assemble:progress', h)
  },
  assembleExport: (clips: import('@shared/assemble').AssembleClip[], name: string) =>
    ipcRenderer.invoke('assemble:export', clips, name),
  onAssembleExportProgress: (cb: (p: { pct: number }) => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: { pct: number }): void => cb(p)
    ipcRenderer.on('assemble:exportProgress', h)
    return () => ipcRenderer.off('assemble:exportProgress', h)
  },

  // ── Collage (folder → playable clip pool) ────────────────────────
  collagePickFolder: () => ipcRenderer.invoke('collage:pickFolder'),
  collageScan: (folder: string) => ipcRenderer.invoke('collage:scan', folder),
  collageOptimise: (folder: string) => ipcRenderer.invoke('collage:optimise', folder),
  onCollageProgress: (cb: (p: { done: number; total: number; file: string }) => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: { done: number; total: number; file: string }): void => cb(p)
    ipcRenderer.on('collage:progress', h)
    return () => ipcRenderer.off('collage:progress', h)
  },

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
