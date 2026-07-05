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
    // Start native playback (import is a user gesture, so autoplay is allowed);
    // tick() takes over rate/direction/loop from here.
    void this.video.play().catch(() => {})
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

  /** Drive the clip each frame. `rawDt` is the real frame delta (seconds);
   *  `mul` is the layer×global speed multiplier over realtime. The total rate is
   *  `mul × clip speed`. FORWARD in-range playback runs NATIVELY (smooth — no
   *  per-frame seeking, which would keep the element perpetually seeking and
   *  black); reverse or out-of-range speed steps currentTime manually. */
  tick(rawDt: number, mul: number): void {
    const v = this.video
    const d = this.duration()
    if (d <= 0) return
    const lo = Math.max(0, Math.min(1, Math.min(this.pb.inN, this.pb.outN))) * d
    const hi = Math.max(0, Math.min(1, Math.max(this.pb.inN, this.pb.outN))) * d
    const span = Math.max(0.001, hi - lo)
    const rate = Math.max(0, mul * this.pb.speed) // over realtime

    if (!this.pb.playing) {
      if (!v.paused) v.pause()
      return
    }

    // Native forward playback handles the common case smoothly.
    const nativeOk = !this.pb.reverse && rate >= 0.0625 && rate <= 16
    if (nativeOk) {
      if (v.playbackRate !== rate) v.playbackRate = rate
      if (v.paused) void v.play().catch(() => {})
      // Only touch currentTime at the trim boundaries — not every frame.
      if (v.currentTime >= hi - 0.02 || v.currentTime < lo - 0.02) {
        if (this.pb.loop) v.currentTime = lo
        else {
          v.currentTime = hi
          v.pause()
        }
      }
      return
    }

    // Manual stepping (reverse / very slow / very fast). Only issue a new seek
    // once the previous one finished, or it never settles a frame (black).
    if (!v.paused) v.pause()
    if (v.seeking) return
    let t = v.currentTime
    if (t < lo || t > hi) t = this.pb.reverse ? hi : lo
    t += rawDt * rate * (this.pb.reverse ? -1 : 1)
    if (t > hi) t = this.pb.loop ? lo + ((t - lo) % span) : hi
    else if (t < lo) t = this.pb.loop ? hi - ((lo - t) % span) : lo
    if (!Number.isFinite(t)) t = lo
    if (Math.abs(t - v.currentTime) > 1e-4) {
      try {
        v.currentTime = t
      } catch {
        /* a seek can race a src reload — ignore, next frame retries */
      }
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
