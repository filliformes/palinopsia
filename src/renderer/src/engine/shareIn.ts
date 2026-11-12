// Spout / Syphon input, page side : the newest frame of each local sender a
// layer shows. The receivers run in the preload (src/preload/shareIn.ts).
//
// GPU route : a VideoFrame over a texture shared with the sender's graphics
// card, pulled once per drawn frame (shared by every layer showing the sender)
// and uploaded GPU to GPU. Copy route : RGBA buffers over a private
// MessageChannel, kept newest-first and handed back to the preload's pool
// (the NDI input's shape, ndiIn.ts). Both arrive top row first.

import type { ShareInStatus } from '@shared/shareIn'

export type ShareFrame =
  | { kind: 'vf'; vf: VideoFrame; w: number; h: number; seq: number }
  | { kind: 'buf'; w: number; h: number; stride: number; buf: ArrayBuffer; seq: number }

const latest = new Map<string, ShareFrame>()
const users = new Map<string, number>()
const pulledAt = new Map<string, number>()
const meter = new Map<string, { n: number; t0: number; fps: number }>()
let port: MessagePort | null = null
let requested = false
let seq = 0

// Asked once (the NDI input's lesson : two layers asking in the same tick each
// got a channel, and both listened on the dead one).
function ensurePort(): void {
  if (port || requested) return
  requested = true
  const onMsg = (ev: MessageEvent): void => {
    if (ev.data !== 'opsia:shareinport' || !ev.ports?.[0]) return
    window.removeEventListener('message', onMsg)
    port = ev.ports[0]
    port.onmessage = (e): void => {
      const d = e.data as { t: string; name: string; w: number; h: number; stride: number; buf: ArrayBuffer } | null
      if (!d || d.t !== 'in') return
      if (!users.has(d.name)) {
        giveBack(d.name, d.buf)
        return
      }
      put(d.name, { kind: 'buf', w: d.w, h: d.h, stride: d.stride, buf: d.buf, seq: ++seq })
    }
  }
  window.addEventListener('message', onMsg)
  window.postMessage('opsia:want-shareinport', '*')
}

function giveBack(name: string, buf: ArrayBuffer): void {
  try {
    port?.postMessage({ t: 'in-return', name, buf }, [buf])
  } catch {
    /* already gone */
  }
}

function drop(name: string, f: ShareFrame | undefined): void {
  if (!f) return
  if (f.kind === 'vf') {
    try { f.vf.close() } catch { /* closed */ }
  } else {
    giveBack(name, f.buf)
  }
}

function put(name: string, f: ShareFrame): void {
  const prev = latest.get(name)
  latest.set(name, f)
  drop(name, prev)
  const now = performance.now()
  const m = meter.get(name) ?? { n: 0, t0: now, fps: 0 }
  m.n++
  if (now - m.t0 >= 1000) {
    m.fps = (m.n * 1000) / (now - m.t0)
    m.n = 0
    m.t0 = now
  }
  meter.set(name, m)
}

/** A layer starts showing a sender. False : this computer cannot receive. */
export function shareInAcquire(name: string): boolean {
  ensurePort()
  users.set(name, (users.get(name) ?? 0) + 1)
  try {
    return window.api.shareInOpen(name)
  } catch {
    return false
  }
}

/** A layer lets go of a sender. */
export function shareInRelease(name: string): void {
  const n = (users.get(name) ?? 0) - 1
  if (n > 0) {
    users.set(name, n)
  } else {
    users.delete(name)
    meter.delete(name)
    pulledAt.delete(name)
    drop(name, latest.get(name))
    latest.delete(name)
  }
  try {
    window.api.shareInClose(name)
  } catch {
    /* ignore */
  }
}

/** The newest frame. Pulls the GPU route at most once every 3 ms, so the layers
 *  showing the same sender in one drawn frame all get the same picture. */
export function shareInLatest(name: string): ShareFrame | null {
  const now = performance.now()
  if (now - (pulledAt.get(name) ?? -1e9) >= 3) {
    pulledAt.set(name, now)
    let f = null
    try {
      f = window.api.shareInFrame(name)
    } catch {
      f = null
    }
    if (f && f.vf) put(name, { kind: 'vf', vf: f.vf, w: f.w || f.vf.displayWidth, h: f.h || f.vf.displayHeight, seq: ++seq })
  }
  return latest.get(name) ?? null
}

/** What the receiver says, plus how often frames really reach this page. */
export function shareInStats(name: string): (ShareInStatus & { arriving: number }) | null {
  let st: ShareInStatus | null = null
  try {
    st = window.api.shareInStatus(name)
  } catch {
    st = null
  }
  if (!st) return null
  const m = meter.get(name)
  const stale = !m || (performance.now() - m.t0 > 1500 && m.n === 0)
  return { ...st, arriving: stale ? 0 : Math.round(m.fps) }
}
