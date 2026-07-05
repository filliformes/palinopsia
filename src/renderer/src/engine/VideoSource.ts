// VideoSource — imported video as a layer source (brief §4, §7).
//
// Wraps an HTML <video> (hardware-decoded H.264/HEVC/AV1 via Quick Sync / the
// 4070), auto-loops it, and uploads each frame to a GL texture the Compositor
// samples. The "synthify" macro sub-chain (posterize → ordered dither →
// luma/edge key → chroma shift → optional feedback) runs as ISF FX on top of
// this texture — it lives in the FX rack, not here. No Hap dependency.

/** Upload the current frame of a <video> into a GL texture (creating it on
 *  first use), matching the engine's bottom-left orientation. Returns the
 *  texture, or the passed-in one unchanged if no frame is decodable yet. Shared
 *  by VideoSource (files) and CaptureSource (webcam / screen). */
export function uploadVideoFrame(
  gl: WebGL2RenderingContext,
  video: HTMLVideoElement,
  tex: WebGLTexture | null
): WebGLTexture | null {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return tex
  if (!tex) {
    tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  return tex
}

export interface VideoPlayback {
  playing: boolean
  speed: number // base clip speed (× the engine dt this receives)
  reverse: boolean
  loop: boolean
  inN: number // normalized start 0..1
  outN: number // normalized stop 0..1
}

export class VideoSource {
  readonly video: HTMLVideoElement
  private tex: WebGLTexture | null = null
  private pb: VideoPlayback = {
    playing: true,
    speed: 1,
    reverse: false,
    loop: true,
    inN: 0,
    outN: 1
  }

  constructor(private gl: WebGL2RenderingContext) {
    this.video = document.createElement('video')
    // We drive currentTime ourselves (reverse + arbitrary speed need it), so
    // native looping/playback is off — the decoder just has to be warm.
    this.video.loop = false
    this.video.muted = true
    this.video.playsInline = true
    this.video.preload = 'auto'
  }

  load(src: string): void {
    this.video.src = src
    // Play once to warm the decoder (so seeks decode frames), then pause — from
    // there tick() owns the playhead. Autoplay is allowed: import is a gesture.
    void this.video
      .play()
      .then(() => this.video.pause())
      .catch(() => {})
  }

  setPlayback(p: VideoPlayback): void {
    this.pb = p
  }

  duration(): number {
    const d = this.video.duration
    return Number.isFinite(d) && d > 0 ? d : 0
  }

  time(): number {
    return this.video.currentTime
  }

  /** Advance the playhead by `effDt` seconds of engine time (already scaled by
   *  the layer + global speed); the clip's own speed and direction apply here.
   *  Wraps within the [in, out] trim when looping, else clamps at the ends. */
  tick(effDt: number): void {
    const d = this.duration()
    if (d <= 0) return
    const inSec = Math.max(0, Math.min(1, this.pb.inN)) * d
    const outSec = Math.max(0, Math.min(1, this.pb.outN)) * d
    const lo = Math.min(inSec, outSec)
    const hi = Math.max(inSec, outSec)
    const span = Math.max(0.001, hi - lo)
    let t = this.video.currentTime
    // Snap into the trim window if the playhead is outside it.
    if (t < lo || t > hi) t = this.pb.reverse ? hi : lo
    if (!this.pb.playing) return
    t += effDt * this.pb.speed * (this.pb.reverse ? -1 : 1)
    if (t > hi) t = this.pb.loop ? lo + ((t - lo) % span) : hi
    else if (t < lo) t = this.pb.loop ? hi - ((lo - t) % span) : lo
    if (!Number.isFinite(t)) t = lo
    try {
      this.video.currentTime = t
    } catch {
      /* a seek can race a src reload — ignore, next frame retries */
    }
  }

  /** Upload the current frame to a GL texture and return it (null until the
   *  first frame is decodable). Called once per frame for a video slot. */
  upload(): WebGLTexture | null {
    this.tex = uploadVideoFrame(this.gl, this.video, this.tex)
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
