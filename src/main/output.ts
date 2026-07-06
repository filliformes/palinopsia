// External GPU output (brief §9) — Spout (Windows) / NDI (cross-platform).
//
// The renderer reads back the final composite (gl.readPixels — negligible on a
// 4070) and sends the RGBA8 buffer here over IPC; this module forwards it to a
// native sender. Native senders can't be bundled/tested headless, so both are
// LAZY-LOADED optional dependencies (drop-ins, not in package.json):
//   • NDI   → `grandiose` (libNDI bindings)      → cross-platform, Resolume/OBS
//   • Spout → a Spout sender addon (leadedge SDK) → Windows, Resolume/OBS
// Install the module (+ any runtime) and the matching toggle activates; else we
// log once and no-op. The RGBA8 buffer is GL bottom-up (senders can flip).

type NdiSender = {
  video: (frame: { data: Buffer; xres: number; yres: number; frameRateN?: number; frameRateD?: number }) => void
  destroy?: () => void
}
// Minimal shape a Spout addon must expose (a thin wrapper over SpoutSender's
// SendImage). Any module providing this works.
type SpoutSender = {
  sendFrame: (pixels: Buffer, width: number, height: number) => void
  release?: () => void
}

let ndi: NdiSender | null = null
let spout: SpoutSender | null = null
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
    warnOnce('ndi', '[output] NDI unavailable — `npm i grandiose` (+ NDI runtime) to enable NDI output.')
    return null
  }
}

async function ensureSpout(): Promise<SpoutSender | null> {
  if (spout) return spout
  try {
    const mod = 'spout'
    const m = (await import(/* @vite-ignore */ mod)) as unknown as {
      createSender?: (name: string) => SpoutSender
      default?: { createSender?: (name: string) => SpoutSender }
    }
    const create = m.createSender ?? m.default?.createSender
    spout = create ? create('Palinopsia') : null
    if (!spout) throw new Error('no createSender export')
    return spout
  } catch {
    warnOnce('spout', '[output] Spout unavailable — add a Spout sender addon (leadedge SDK) to enable Spout output.')
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
    return on ? (await ensureSpout()) !== null : true
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
      spout.sendFrame(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height)
    }
  }

  dispose(): void {
    ndi?.destroy?.()
    spout?.release?.()
    ndi = null
    spout = null
  }
}
