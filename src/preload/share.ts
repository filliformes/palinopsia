// Spout (Windows) / Syphon (macOS) sender, living in the main window's PRELOAD
// (the renderer's own process), for the same reason as NDI (see ndi.ts) : moving
// a 4K frame to another process costs 30–90 ms in Electron and blocked the page
// while it copied, where a transfer to the preload is ~0.3 ms. Measured : a 4K
// Spout frame went from ~190 ms through IPC to ~5 ms here.
//
// The page reads the clean picture back from the GPU (engine/frameCapture), top-
// down when the addon says it takes that (topDown : no CPU flip, ~2 ms saved at
// 4K), and transfers it over a private MessageChannel; the buffer comes back to be
// refilled. If the addon won't run in this process, shareLocal() says so and the
// page falls back to the main-process sender (src/main/output.ts).

import { existsSync } from 'fs'
import { join } from 'path'

type ShareAddon = {
  open: (name: string) => boolean
  send: (pixels: Buffer, width: number, height: number, topDown?: boolean) => void
  close: () => void
  topDown?: boolean
}

let mod: ShareAddon | null = null
let loadError = ''
let open = false
let port: MessagePort | null = null

function addonPath(kind: string): string {
  // out/preload → the project (dev) or app.asar (packaged, unpacked beside it);
  // a copy built elsewhere (tools/test-build.sh : <out>/preload) keeps the
  // addons one folder up, beside main/.
  const at = (root: string): string =>
    join(root.replace(/app\.asar(?=$|[\\/])/, 'app.asar.unpacked'), 'native', kind, 'build', 'Release', `${kind}.node`)
  const first = at(join(__dirname, '..', '..'))
  if (existsSync(first)) return first
  const near = at(join(__dirname, '..'))
  return existsSync(near) ? near : first
}

/** The platform's addon (Spout on Windows, Syphon on macOS), loaded once in
 *  this process : the sender here and the Spout input (shareIn.ts) share it.
 *  Null when it is missing from this build or will not load. */
export function shareAddon<T = ShareAddon>(): { mod: T | null; error: string } {
  if (mod) return { mod: mod as unknown as T, error: '' }
  if (loadError) return { mod: null, error: loadError }
  const kind = process.platform === 'win32' ? 'spout' : process.platform === 'darwin' ? 'syphon' : null
  if (!kind) {
    loadError = 'not available on this platform'
    return { mod: null, error: loadError }
  }
  try {
    const m = { exports: {} as ShareAddon }
    process.dlopen(m as unknown as NodeModule, addonPath(kind))
    mod = m.exports
    return { mod: mod as unknown as T, error: '' }
  } catch (e) {
    loadError = (e as Error).message
    return { mod: null, error: loadError }
  }
}

/** Start / stop the sender here. `topDown` : frames may come top-down. */
export function shareLocal(on: boolean): { ok: boolean; topDown: boolean; error?: string } {
  if (!on) {
    if (open) { try { mod?.close() } catch { /* ignore */ } }
    open = false
    return { ok: true, topDown: false }
  }
  if (open) return { ok: true, topDown: !!mod?.topDown }
  if (process.platform !== 'win32' && process.platform !== 'darwin') return { ok: false, topDown: false, error: 'not available on this platform' }
  try {
    const a = shareAddon()
    if (!a.mod) return { ok: false, topDown: false, error: a.error }
    open = a.mod.open('Palinopsia')
    return open ? { ok: true, topDown: !!a.mod.topDown } : { ok: false, topDown: false, error: 'the sender did not open' }
  } catch (e) {
    return { ok: false, topDown: false, error: (e as Error).message }
  }
}

function openPort(): void {
  try { port?.close() } catch { /* ignore */ }
  const mc = new MessageChannel()
  port = mc.port1
  port.onmessage = (ev): void => {
    const d = ev.data as { t: string; w: number; h: number; topDown: boolean; buf: ArrayBuffer }
    if (d.t !== 'frame') return
    if (open && mod) {
      try { mod.send(Buffer.from(d.buf), d.w, d.h, d.topDown) } catch { /* a bad frame : skip it */ }
    }
    try { port?.postMessage({ t: 'return', buf: d.buf }, [d.buf]) } catch { /* page gone */ }
  }
  window.postMessage('opsia:shareport', '*', [mc.port2])
}
window.addEventListener('message', (ev) => {
  if (ev.data === 'opsia:want-shareport') openPort()
})
window.addEventListener('beforeunload', () => {
  if (open) { try { mod?.close() } catch { /* ignore */ } }
  open = false
})
