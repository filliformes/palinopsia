// Texture sharing with other apps on the SAME computer (brief §9) : Spout on
// Windows, Syphon on macOS. Both are built into Palinopsia (native/spout,
// native/syphon) : nothing to install on the machine.
//
// NDI is separate (the sender runs in the main window's preload, see
// src/preload/ndi.ts; main/ndi/ only finds the runtime). Here the renderer reads
// back the presented frame (async PBO, RGBA8 GL bottom-up) and sends it over
// IPC; the platform's N-API addon publishes it.

import { app } from 'electron'
import { join } from 'path'

// Both addons expose the same three calls (RGBA8 bottom-up in, flipped inside).
type ShareAddon = {
  open: (name: string) => boolean
  send: (pixels: Buffer, width: number, height: number) => void
  close: () => void
}

/** 'Spout' on Windows, 'Syphon' on macOS, null elsewhere. */
export function shareKind(): 'Spout' | 'Syphon' | null {
  return process.platform === 'win32' ? 'Spout' : process.platform === 'darwin' ? 'Syphon' : null
}

let mod: ShareAddon | null = null
let loadError = ''

/** Load the platform's addon once (dlopen bypasses the bundler). In dev
 *  getAppPath() is the project root; packaged builds unpack it (asarUnpack). */
function loadAddon(): ShareAddon | null {
  if (mod) return mod
  const kind = shareKind()?.toLowerCase()
  if (!kind) { loadError = 'not available on this platform'; return null }
  try {
    const base = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    const m = { exports: {} as ShareAddon }
    process.dlopen(m as unknown as NodeModule, join(base, 'native', kind, 'build', 'Release', `${kind}.node`))
    mod = m.exports
    return mod
  } catch (e) {
    loadError = (e as Error).message
    console.warn(`[output] ${shareKind()} unavailable : ${loadError}`)
    return null
  }
}

export class OutputSender {
  private open = false

  /** On : create the sender (receivers now list "Palinopsia"). Off : release it
   *  (the source leaves their lists). Resolves false when it can't run here. */
  async setShare(on: boolean): Promise<boolean> {
    if (!on) {
      if (this.open) mod?.close()
      this.open = false
      return true
    }
    if (this.open) return true
    const m = loadAddon()
    if (!m) return false
    try {
      this.open = m.open('Palinopsia')
    } catch (e) {
      console.warn(`[output] ${shareKind()} open failed : ${(e as Error).message}`)
      this.open = false
    }
    return this.open
  }

  /** Push a presented RGBA8 frame (from the renderer readback). */
  send(width: number, height: number, pixels: Uint8Array): void {
    if (this.open && mod) {
      mod.send(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height)
    }
  }

  dispose(): void {
    if (this.open) mod?.close()
    this.open = false
  }
}
