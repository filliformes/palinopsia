// USB input (macOS : an iPhone or iPad by USB, any camera Chromium cannot list),
// page side : the latest frame of each device a layer shows. The captures run in
// the preload (src/preload/avcapture.ts, over native/avcapture); frames arrive
// here over a private MessageChannel as transferred buffers, RGBA, top row
// first. We keep the newest per device and hand the one it replaces straight
// back to the preload's pool (transfer : no copy, no garbage). The same shape as
// the NDI input (ndiIn.ts).

export interface AvfFrame {
  w: number
  h: number
  stride: number
  buf: ArrayBuffer
  seq: number
}

/** The `device:` id prefix of a USB-input device (`device:avf:<id>`). */
export const AVF_PREFIX = 'avf:'

const latest = new Map<string, AvfFrame>()
const users = new Map<string, number>()
let port: MessagePort | null = null
let seq = 0

// Asked once : a session opening two of these layers in the same tick used to
// ask twice, the preload answered twice (closing its first channel), both
// listeners took the FIRST (dead) channel and nobody took the second : every
// such layer stayed black for the whole run.
let requested = false

function ensurePort(): void {
  if (port || requested) return
  requested = true
  const onMsg = (ev: MessageEvent): void => {
    if (ev.data !== 'opsia:avfinport' || !ev.ports?.[0]) return
    window.removeEventListener('message', onMsg)
    port = ev.ports[0]
    port.onmessage = (e): void => {
      const d = e.data as { t: string; name: string; w: number; h: number; stride: number; buf: ArrayBuffer }
      if (!d || d.t !== 'in') return
      if (!users.has(d.name)) {
        giveBack(d.name, d.buf)
        return
      }
      const prev = latest.get(d.name)
      latest.set(d.name, { w: d.w, h: d.h, stride: d.stride, buf: d.buf, seq: ++seq })
      if (prev) giveBack(d.name, prev.buf)
    }
  }
  window.addEventListener('message', onMsg)
  window.postMessage('opsia:want-avfinport', '*')
}

function giveBack(name: string, buf: ArrayBuffer): void {
  try {
    port?.postMessage({ t: 'in-return', name, buf }, [buf])
  } catch {
    /* already gone */
  }
}

/** A layer starts showing a device. False : not possible on this computer. */
export function avfInAcquire(id: string): boolean {
  ensurePort()
  users.set(id, (users.get(id) ?? 0) + 1)
  try {
    return window.api.avfOpen(id)
  } catch {
    return false
  }
}

/** A layer lets go of a device. */
export function avfInRelease(id: string): void {
  const n = (users.get(id) ?? 0) - 1
  if (n > 0) {
    users.set(id, n)
  } else {
    users.delete(id)
    const f = latest.get(id)
    latest.delete(id)
    if (f) giveBack(id, f.buf)
  }
  try {
    window.api.avfClose(id)
  } catch {
    /* ignore */
  }
}

export function avfInLatest(id: string): AvfFrame | null {
  return latest.get(id) ?? null
}
