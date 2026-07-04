// VideoSource — imported video as a layer source (brief §4, §7).
//
// PHASE 7. Wraps an HTML <video> (hardware-decoded H.264/HEVC/AV1 via Quick
// Sync / the 4070), auto-loops it, and uploads each frame to a GL texture the
// Compositor can sample. The "synthify" macro sub-chain
// (posterize → ordered dither → luma/edge key → chroma shift → optional
// feedback) runs as ISF FX on top of this texture — it lives in the FX rack,
// not here. No Hap dependency. Stubbed so the engine seam exists from Phase 0.

export class VideoSource {
  readonly video: HTMLVideoElement
  private tex: WebGLTexture | null = null

  constructor(private gl: WebGL2RenderingContext) {
    this.video = document.createElement('video')
    this.video.loop = true
    this.video.muted = true
    this.video.playsInline = true
  }

  async load(src: string): Promise<void> {
    this.video.src = src
    await this.video.play().catch(() => {
      /* autoplay may defer until first user gesture */
    })
  }

  /** Phase 7: (re)upload the current frame to a texture and return it. */
  texture(): WebGLTexture | null {
    // TODO Phase 7 — gl.texImage2D(..., this.video) on each ready frame.
    return this.tex
  }

  dispose(): void {
    this.video.pause()
    this.video.removeAttribute('src')
    if (this.tex) this.gl.deleteTexture(this.tex)
    this.tex = null
  }
}
