// HiveSource — live networked video as a layer source (brief §9).
//
// PHASE 7. HIVE (G. Arsenault, MPL-2.0) is HEVC-over-TCP with mDNS discovery.
// Its WebCodecs receiver runs directly in the Electron renderer: connect to a
// discovered stream → decode HEVC via VideoDecoder → upload each VideoFrame to
// a GL texture → use as a layer source. No native addon needed (the whole
// point of choosing HIVE for live-in). Stubbed so the seam exists from Phase 0.

export interface HiveStreamInfo {
  id: string
  name: string
  host: string
  port: number
}

export class HiveSource {
  private tex: WebGLTexture | null = null
  // Typed structurally to avoid depending on ambient WebCodecs lib types at
  // build time; Phase 7 swaps this for the real `VideoDecoder`.
  private decoder: { close: () => void } | null = null

  constructor(private gl: WebGL2RenderingContext) {}

  /** Phase 7: mDNS-discover HIVE streams on the LAN for the source browser. */
  static async discover(): Promise<HiveStreamInfo[]> {
    // TODO Phase 7 — mDNS browse for HIVE services.
    return []
  }

  /** Phase 7: connect + spin up a WebCodecs VideoDecoder for `stream`. */
  async connect(_stream: HiveStreamInfo): Promise<void> {
    // TODO Phase 7 — open the TCP stream, feed EncodedVideoChunks to the
    // decoder, and upload decoded VideoFrames to `this.tex`.
  }

  texture(): WebGLTexture | null {
    return this.tex
  }

  dispose(): void {
    this.decoder?.close()
    this.decoder = null
    if (this.tex) this.gl.deleteTexture(this.tex)
    this.tex = null
  }
}
