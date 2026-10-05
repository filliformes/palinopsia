// NDI input, page side : the latest frame of each NDI source a layer shows.
// The receivers run in the preload (src/preload/ndi.ts, the same NDI runtime as
// the sender); their frames arrive here over a private MessageChannel as
// transferred buffers. We keep the newest frame per source and hand the one it
// replaces straight back to the preload's pool (transfer : no copy, no garbage).

interface InFrame {
  w: number
  h: number
  stride: number
  buf: ArrayBuffer
  seq: number
}

const latest = new Map<string, InFrame>()
const users = new Map<string, number>()
let port: MessagePort | null = null
let seq = 0

function ensurePort(): void {
  if (port) return
  const onMsg = (ev: MessageEvent): void => {
    if (ev.data !== 'opsia:ndiinport' || !ev.ports?.[0]) return
    window.removeEventListener('message', onMsg)
    port = ev.ports[0]
    port.onmessage = (e): void => {
      const d = e.data as { t: string; name: string; w: number; h: number; stride: number; buf: ArrayBuffer }
      if (!d || d.t !== 'in') return
      const prev = latest.get(d.name)
      if (!users.has(d.name)) {
        // Nobody shows this source any more : give the buffer straight back.
        giveBack(d.name, d.buf)
        return
      }
      latest.set(d.name, { w: d.w, h: d.h, stride: d.stride, buf: d.buf, seq: ++seq })
      if (prev) giveBack(d.name, prev.buf)
    }
  }
  window.addEventListener('message', onMsg)
  window.postMessage('opsia:want-ndiinport', '*')
}

function giveBack(name: string, buf: ArrayBuffer): void {
  try {
    port?.postMessage({ t: 'in-return', name, buf }, [buf])
  } catch {
    /* already gone */
  }
}

/** A layer starts showing an NDI source. */
export async function ndiInAcquire(name: string): Promise<boolean> {
  ensurePort()
  users.set(name, (users.get(name) ?? 0) + 1)
  try {
    return await window.api.ndiInOpen(name)
  } catch {
    return false
  }
}

/** A layer lets go of an NDI source. */
export function ndiInRelease(name: string): void {
  const n = (users.get(name) ?? 0) - 1
  if (n > 0) {
    users.set(name, n)
  } else {
    users.delete(name)
    const f = latest.get(name)
    latest.delete(name)
    if (f) giveBack(name, f.buf)
  }
  try {
    window.api.ndiInClose(name)
  } catch {
    /* ignore */
  }
}

export function ndiInLatest(name: string): InFrame | null {
  return latest.get(name) ?? null
}
