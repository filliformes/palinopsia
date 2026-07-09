// External GPU output (brief §9) : Spout (Windows) / NDI (cross-platform).
//
// The renderer reads back the final composite (gl.readPixels : negligible on a
// 4070) and sends the RGBA8 buffer here over IPC; this module forwards it to a
// native sender. Native senders can't be bundled/tested headless, so both are
// LAZY-LOADED optional dependencies (drop-ins, not in package.json):
//   • NDI   → `grandiose` (libNDI bindings)      → cross-platform, OBS or any receiver
//   • Spout → a Spout sender addon (leadedge SDK) → Windows, OBS or any receiver
// Install the module (+ any runtime) and the matching toggle activates; else we
// log once and no-op. The RGBA8 buffer is GL bottom-up (senders can flip).

import { app } from 'electron'
import { join } from 'path'

type NdiSender = {
  video: (frame: { data: Buffer; xres: number; yres: number; frameRateN?: number; frameRateD?: number }) => void
  destroy?: () => void
}
// Our vendored Spout (DX11) N-API addon : native/spout/build/Release/spout.node.
type SpoutAddon = {
  open: (name: string) => boolean
  send: (pixels: Buffer, width: number, height: number) => void
  close: () => void
}

let ndi: NdiSender | null = null
let spout: SpoutAddon | null = null
const warned = new Set<string>()

function warnOnce(key: string, msg: string): void {
  if (!warned.has(key)) {
    console.warn(msg)
    warned.add(key)
  }
}

async function ensureNdi(): Promise<NdiSender | null> {
  if (ndi) return ndi
  try {
    const mod = 'grandiose' // variable specifier + @vite-ignore → runtime-only
    const grandiose = (await import(/* @vite-ignore */ mod)) as unknown as {
      send: (opts: { name: string }) => Promise<NdiSender>
    }
    ndi = await grandiose.send({ name: 'Palinopsia' })
    return ndi
  } catch {
    warnOnce('ndi', '[output] NDI unavailable : `npm i grandiose` (+ NDI runtime) to enable NDI output.')
    return null
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
  private ndiOn = false
  private spoutOn = false

  async setNdi(on: boolean): Promise<boolean> {
    this.ndiOn = on
    return on ? (await ensureNdi()) !== null : true
  }

  async setSpout(on: boolean): Promise<boolean> {
    this.spoutOn = on
    return on ? ensureSpout() !== null : true
  }

  /** Push a presented RGBA8 frame (from the renderer readback) to the sinks. */
  send(width: number, height: number, pixels: Uint8Array): void {
    if (this.ndiOn && ndi) {
      ndi.video({
        data: Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength),
        xres: width,
        yres: height,
        frameRateN: 60000,
        frameRateD: 1000
      })
    }
    if (this.spoutOn && spout) {
      spout.send(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height)
    }
  }

  dispose(): void {
    ndi?.destroy?.()
    spout?.close()
    ndi = null
    spout = null
  }
}
