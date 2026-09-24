// Real-time DXV3 recording : the file side, in the main window's preload.
//
// Finished DXV3 frames come from the page (built by its workers,
// src/renderer/src/workers/dxvWorker.ts) over a private MessagePort (transfers,
// no copy) and go straight to disk from here : the main process only names the
// file. See movWriter.ts for the container.
//
// Protocol on the port : 'open' {w, h, fpsN, fpsD} → 'opened' {path} | 'error';
// 'frame' {buf, length, repeat}; 'end' → 'done' {path, frames, dropped}. When the disk
// can't keep up (more than MAX_QUEUED bytes waiting), frames are dropped and
// counted instead of piling up in memory.

import { ipcRenderer } from 'electron'
import { MovWriter } from './movWriter'

const MAX_QUEUED = 768 * 1024 * 1024

let port: MessagePort | null = null
let mov: MovWriter | null = null
let dropped = 0

async function onMessage(ev: MessageEvent): Promise<void> {
  const d = ev.data as { t: string; w?: number; h?: number; fpsN?: number; fpsD?: number; buf?: ArrayBuffer; length?: number; repeat?: number }
  const reply = (m: unknown): void => { try { port?.postMessage(m) } catch { /* page gone */ } }
  try {
    if (d.t === 'open') {
      const path = (await ipcRenderer.invoke('recording:takePath', 'mov')) as string | null
      if (!path) throw new Error('no folder to record into')
      dropped = 0
      mov = new MovWriter(path, { width: d.w!, height: d.h!, timescale: d.fpsN!, sampleDelta: d.fpsD!, codec: 'DXD3' })
      reply({ t: 'opened', path })
    } else if (d.t === 'frame' && d.buf) {
      if (!mov) return
      if (mov.queued > MAX_QUEUED) { dropped += d.repeat ?? 1; return }
      mov.append(new Uint8Array(d.buf, 0, d.length ?? d.buf.byteLength), d.repeat ?? 1)
    } else if (d.t === 'end') {
      const m = mov
      mov = null
      if (!m) { reply({ t: 'done', path: null, frames: 0, dropped }); return }
      await m.finish()
      reply({ t: 'done', path: m.path, frames: m.frames, dropped })
    }
  } catch (e) {
    reply({ t: 'error', message: (e as Error).message })
  }
}

/** A fresh pipe for the page (it asks when a DXV take starts). */
function openPort(): void {
  try { port?.close() } catch { /* ignore */ }
  const mc = new MessageChannel()
  port = mc.port1
  port.onmessage = (ev): void => { void onMessage(ev) }
  window.postMessage('opsia:recport', '*', [mc.port2])
}
window.addEventListener('message', (ev) => {
  if (ev.data === 'opsia:want-recport') openPort()
})
