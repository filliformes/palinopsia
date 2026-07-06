// External GPU output (brief §9) — Spout (Windows) / NDI (cross-platform).
//
// The renderer reads back the final composite (gl.readPixels — negligible on a
// 4070) and sends the RGBA8 buffer here over IPC; this module forwards it to a
// native sender. Native senders can't be bundled/tested headless, so we
// LAZY-LOAD an optional dependency: install `grandiose` (libNDI bindings) and
// NDI output activates as a drop-in; otherwise we log once and no-op.
//
// Spout (the ideal on Windows — shares the GPU texture with zero readback) needs
// a native DX addon and is a further step; the readback seam here is what a
// sender plugs into.

type NdiSender = {
  video: (frame: {
    data: Buffer
    xres: number
    yres: number
    frameRateN?: number
    frameRateD?: number
  }) => void
  destroy?: () => void
}

let ndi: NdiSender | null = null
let warned = false

/** Lazily create the NDI sender if `grandiose` is installed. */
async function ensureNdi(): Promise<NdiSender | null> {
  if (ndi) return ndi
  try {
    // Optional dependency — not in package.json; present only if the user adds
    // it. The variable specifier + @vite-ignore keep the bundler from trying to
    // resolve it at build time (it's a runtime, may-be-absent require).
    const mod = 'grandiose'
    const grandiose = (await import(/* @vite-ignore */ mod)) as unknown as {
      send: (opts: { name: string }) => Promise<NdiSender>
    }
    ndi = await grandiose.send({ name: 'Palinopsia' })
    return ndi
  } catch {
    if (!warned) {
      console.warn('[output] NDI unavailable — `npm i grandiose` (+ NDI runtime) to enable NDI output.')
      warned = true
    }
    return null
  }
}

export class OutputSender {
  private ndiOn = false

  /** Turn NDI output on/off. Returns whether a sender is actually available. */
  async setNdi(on: boolean): Promise<boolean> {
    this.ndiOn = on
    if (on) return (await ensureNdi()) !== null
    return true
  }

  /** Push a presented RGBA8 frame (from the renderer readback) to NDI. */
  send(width: number, height: number, pixels: Uint8Array): void {
    if (!this.ndiOn || !ndi) return
    ndi.video({
      data: Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      xres: width,
      yres: height,
      frameRateN: 60000,
      frameRateD: 1000
    })
  }

  dispose(): void {
    ndi?.destroy?.()
    ndi = null
  }
}
