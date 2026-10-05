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

/** What a source is delivering : for the Inspector's readout. */
export interface NdiInStats {
  w: number
  h: number
  fps: number
  latencyMs: number | null // sender timestamp to arrival here (same clock domain only)
}

const latest = new Map<string, InFrame>()
const meter = new Map<string, { n: number; t0: number; fps: number; lat: number | null; w: number; h: number }>()
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
      const d = e.data as { t: string; name: string; w: number; h: number; stride: number; buf: ArrayBuffer; sent: number }
      if (!d || d.t !== 'in') return
      const prev = latest.get(d.name)
      if (!users.has(d.name)) {
        // Nobody shows this source any more : give the buffer straight back.
        giveBack(d.name, d.buf)
        return
      }
      latest.set(d.name, { w: d.w, h: d.h, stride: d.stride, buf: d.buf, seq: ++seq })
      if (prev) giveBack(d.name, prev.buf)
      const now = performance.now()
      const m = meter.get(d.name) ?? { n: 0, t0: now, fps: 0, lat: null, w: 0, h: 0 }
      m.n++
      m.w = d.w
      m.h = d.h
      // A sender clock far from ours (another machine, unsynced) gives nonsense : drop it.
      const lat = d.sent > 0 ? Date.now() - d.sent : -1
      m.lat = lat >= 0 && lat < 10000 ? lat : null
      if (now - m.t0 >= 1000) {
        m.fps = (m.n * 1000) / (now - m.t0)
        m.n = 0
        m.t0 = now
      }
      meter.set(d.name, m)
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
    meter.delete(name)
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

export function ndiInStats(name: string): NdiInStats | null {
  const m = meter.get(name)
  if (!m) return null
  // Nothing for 1.5 s : the source stopped.
  const stale = performance.now() - m.t0 > 1500 && m.n === 0
  return { w: m.w, h: m.h, fps: stale ? 0 : Math.round(m.fps), latencyMs: m.lat === null ? null : Math.round(m.lat) }
}
