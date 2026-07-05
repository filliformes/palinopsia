// VideoSource — imported video as a layer source (brief §4, §7).
//
// Wraps an HTML <video> (hardware-decoded H.264/HEVC/AV1 via Quick Sync / the
// 4070), auto-loops it, and uploads each frame to a GL texture the Compositor
// samples. The "synthify" macro sub-chain (posterize → ordered dither →
// luma/edge key → chroma shift → optional feedback) runs as ISF FX on top of
// this texture — it lives in the FX rack, not here. No Hap dependency.

export class VideoSource {
  readonly video: HTMLVideoElement
  private tex: WebGLTexture | null = null

  constructor(private gl: WebGL2RenderingContext) {
    this.video = document.createElement('video')
    this.video.loop = true
    this.video.muted = true
    this.video.playsInline = true
  }

  load(src: string): void {
    this.video.src = src
    // Autoplay may defer until a user gesture; the app is always gesture-driven
    // (the user just clicked to import), so this resolves in practice.
    void this.video.play().catch(() => {})
  }

  /** Upload the current frame to a GL texture and return it (null until the
   *  first frame is decodable). Called once per frame for a video slot. */
  upload(): WebGLTexture | null {
    const gl = this.gl
    const v = this.video
    // HAVE_CURRENT_DATA and a real size — else there's nothing to upload yet.
    if (v.readyState < 2 || v.videoWidth === 0 || v.videoHeight === 0) return this.tex
    if (!this.tex) {
      this.tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    // Video frames are top-row-first; flip so the texture matches the engine's
    // bottom-left GL orientation (same as every other layer buffer).
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    return this.tex
  }

  dispose(): void {
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load() // release the decoder
    if (this.tex) this.gl.deleteTexture(this.tex)
    this.tex = null
  }
}
