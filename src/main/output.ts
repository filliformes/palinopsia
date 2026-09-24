// External GPU output (brief §9) : Spout (Windows).
//
// NDI is separate (the sender runs in the main window's preload, see
// src/preload/ndi.ts; main/ndi/ only finds the runtime). This module keeps the
// Spout sender : the renderer reads back the presented
// frame (async PBO, RGBA8 GL bottom-up) and sends it here over IPC; the vendored
// Spout (DX11) N-API addon (native/spout) publishes it to any Spout receiver.

import { app } from 'electron'
import { join } from 'path'

// Our vendored Spout (DX11) N-API addon : native/spout/build/Release/spout.node.
type SpoutAddon = {
  open: (name: string) => boolean
  send: (pixels: Buffer, width: number, height: number) => void
  close: () => void
}

let spout: SpoutAddon | null = null
const warned = new Set<string>()

function warnOnce(key: string, msg: string): void {
  if (!warned.has(key)) {
    console.warn(msg)
    warned.add(key)
  }
}

function ensureSpout(): SpoutAddon | null {
  if (spout) return spout
  try {
    // Load the native .node directly (dlopen bypasses the bundler). In dev
    // getAppPath() is the project root; packaged builds unpack it (asarUnpack).
    const base = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    const addonPath = join(base, 'native', 'spout', 'build', 'Release', 'spout.node')
    const m = { exports: {} as SpoutAddon }
    process.dlopen(m as unknown as NodeModule, addonPath)
    if (!m.exports.open('Palinopsia')) throw new Error('open failed (no DirectX11?)')
    spout = m.exports
    return spout
  } catch (e) {
    warnOnce('spout', `[output] Spout unavailable : ${(e as Error).message}. Rebuild native/spout for your Electron.`)
    return null
  }
}

export class OutputSender {
  private spoutOn = false

  async setSpout(on: boolean): Promise<boolean> {
    this.spoutOn = on
    return on ? ensureSpout() !== null : true
  }

  /** Push a presented RGBA8 frame (from the renderer readback) to Spout. */
  send(width: number, height: number, pixels: Uint8Array): void {
    if (this.spoutOn && spout) {
      spout.send(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height)
    }
  }

  dispose(): void {
    spout?.close()
    spout = null
  }
}
