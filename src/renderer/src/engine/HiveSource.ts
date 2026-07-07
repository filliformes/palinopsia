// HiveSource — live HIVE stream as a layer source. The main process connects
// over TCP and forwards HEVC access units; here we decode them with WebCodecs
// (VideoDecoder) and upload each frame to a GL texture. Waits for a keyframe
// before decoding, and only holds the latest frame (live, never buffered).
//
// EXPERIMENTAL: depends on Chromium's platform HEVC decoder (feature flag set
// in the main process). If unsupported, the source stays black and logs.

import type { HiveAU, HiveStatus } from '@shared/types'

// WebCodecs is ambient in Chromium 94+/Electron 33 but not in the TS DOM lib
// used here — declare the minimum we touch.
declare const VideoDecoder: {
  new (init: { output: (frame: VideoFrameLike) => void; error: (e: Error) => void }): VideoDecoderLike
}
declare const EncodedVideoChunk: {
  new (init: { type: 'key' | 'delta'; timestamp: number; data: unknown }): unknown
}
interface VideoDecoderLike {
  state: string
  configure: (cfg: { codec: string; optimizeForLatency?: boolean }) => void
  decode: (chunk: unknown) => void
  close: () => void
}
interface VideoFrameLike {
  close: () => void
  codedWidth: number
  codedHeight: number
}

export class HiveSource {
  private tex: WebGLTexture | null = null
  private decoder: VideoDecoderLike | null = null
  private latest: VideoFrameLike | null = null
  private configured = false
  private sawKey = false
  private off: (() => void) | null = null
  private offStatus: (() => void) | null = null
  private id = ''
  // Last connection health reported by the main process. Readable so a future
  // UI badge can show it; for now a link error is logged instead of swallowed.
  private lastStatus: HiveStatus | null = null

  constructor(private gl: WebGL2RenderingContext) {}

  get status(): HiveStatus | null {
    return this.lastStatus
  }

  start(spec: string): void {
    // spec = "host:port"
    const idx = spec.lastIndexOf(':')
    const host = spec.slice(0, idx)
    const port = Number(spec.slice(idx + 1))
    if (!host || !Number.isFinite(port)) return
    this.id = spec
    try {
      this.decoder = new VideoDecoder({
        output: (frame) => {
          this.latest?.close()
          this.latest = frame
        },
        error: (e) => console.error('[hive] decode', e.message)
      })
    } catch (e) {
      console.error('[hive] VideoDecoder unavailable:', (e as Error).message)
      return
    }
    this.off = window.api.onHiveAU((au: HiveAU) => this.onAU(au))
    this.offStatus = window.api.onHiveStatus((s: HiveStatus) => {
      if (s.id !== this.id) return
      this.lastStatus = s
      if (s.ok) console.info(`[hive] ${this.id} connected`)
      else console.warn(`[hive] ${this.id} link error: ${s.error ?? 'unknown'}`)
    })
    window.api.hiveConnect(this.id, host, port)
  }

  private onAU(au: HiveAU): void {
    if (au.id !== this.id || !this.decoder) return
    if (!this.configured) {
      try {
        // hev1 = Annex-B with in-band parameter sets (no description needed).
        this.decoder.configure({ codec: 'hev1.1.6.L153.B0', optimizeForLatency: true })
        this.configured = true
      } catch (e) {
        console.error('[hive] configure failed:', (e as Error).message)
        return
      }
    }
    if (!this.sawKey) {
      if (!au.key) return // a decoder can only start on a keyframe
      this.sawKey = true
    }
    try {
      this.decoder.decode(
        new EncodedVideoChunk({ type: au.key ? 'key' : 'delta', timestamp: au.timestamp, data: au.data })
      )
    } catch (e) {
      console.error('[hive] decode enqueue:', (e as Error).message)
    }
  }

  upload(): WebGLTexture | null {
    const f = this.latest
    if (!f || f.codedWidth === 0) return this.tex
    const gl = this.gl
    if (!this.tex) {
      this.tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    // A VideoFrame is a valid texImage2D source in WebGL2.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, f as unknown as TexImageSource)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    return this.tex
  }

  dispose(): void {
    this.off?.()
    this.off = null
    this.offStatus?.()
    this.offStatus = null
    if (this.id) window.api.hiveDisconnect(this.id)
    this.latest?.close()
    this.latest = null
    try {
      this.decoder?.close()
    } catch {
      /* already closed */
    }
    this.decoder = null
    if (this.tex) this.gl.deleteTexture(this.tex)
    this.tex = null
  }
}
