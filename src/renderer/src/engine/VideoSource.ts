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

export type PlayDirection = 'forward' | 'reverse' | 'pendulum'

export interface VideoPlayback {
  playing: boolean
  speed: number // base clip speed (× the engine dt this receives)
  direction: PlayDirection
  loop: boolean
  inN: number // normalized start 0..1
  outN: number // normalized stop 0..1
}

export class VideoSource {
  readonly video: HTMLVideoElement
  private tex: WebGLTexture | null = null
  private pos = -1 // internal playhead (seconds) for manual/reverse stepping
  private pendDir = 1 // pendulum instantaneous direction (1 fwd, -1 rev)
  // Forward stall watchdog: if the element claims to be playing but currentTime
  // stops advancing, re-kick play() so a decoder hiccup can't freeze the clip.
  private lastCT = -1
  private stallSince = 0
  private pb: VideoPlayback = {
    playing: true,
    speed: 1,
    direction: 'forward',
    loop: true,
    inN: 0,
    outN: 1
  }

  constructor(private gl: WebGL2RenderingContext) {
    this.video = document.createElement('video')
    // Native looping off — we own the loop/trim/direction.
    this.video.loop = false
    this.video.muted = true
    this.video.playsInline = true
    this.video.preload = 'auto'
    // Surface a failed load instead of a silent black frame (protocol 404, moved
    // file, unsupported codec) so "the video won't play" is diagnosable.
    this.video.addEventListener('error', () => {
      const e = this.video.error
      console.warn(`[video] load error (${e?.code ?? '?'}): ${e?.message || this.video.currentSrc}`)
    })
  }

  load(src: string): void {
    this.video.src = src
    // Start native playback (import is a user gesture, so autoplay is allowed);
    // tick() takes over rate/direction/loop from here. Re-assert play once the
    // clip can actually run, in case the eager first play() rejected (no data yet).
    const kick = (): void => void this.video.play().catch(() => {})
    kick()
    this.video.addEventListener('canplay', kick, { once: true })
  }

  setPlayback(p: VideoPlayback): void {
    this.pb = p
  }

  duration(): number {
    const d = this.video.duration
    return Number.isFinite(d) && d > 0 ? d : 0
  }

  time(): number {
    // `pos` is the true intended playhead (kept in sync with the element during
    // native playback); during manual/reverse it leads the lagging seek, so the
    // timeline shows smooth motion at the real rate.
    return this.pos >= 0 ? this.pos : this.video.currentTime
  }

  /** Drive the clip each frame. `rawDt` is the real frame delta (seconds); `mul`
   *  is the layer×global speed multiplier over realtime; total rate = mul × clip
   *  speed. The element is kept PLAYING in every mode — a PAUSED <video> stops
   *  presenting frames to texImage2D, so a pause+seek approach reads as a frozen
   *  clip (the reverse / >16× bug). Forward within the browser's native rate cap
   *  runs on the element's own clock (smoothest); reverse, pendulum-reverse, and
   *  above-cap speed keep playing but OVERRIDE currentTime each frame. */
  tick(rawDt: number, mul: number): void {
    const v = this.video
    const d = this.duration()
    if (d <= 0) return
    const lo = Math.max(0, Math.min(1, Math.min(this.pb.inN, this.pb.outN))) * d
    const hi = Math.max(0, Math.min(1, Math.max(this.pb.inN, this.pb.outN))) * d
    const NATIVE_MAX = 16 // Chromium clamps playbackRate here

    if (!this.pb.playing) {
      if (!v.paused) v.pause()
      return
    }
    // Always keep the media pipeline hot so frames flow to the texture.
    if (v.paused) void v.play().catch(() => {})

    // Instantaneous direction: pendulum bounces between +1 and -1 at the trims.
    let dir = 1
    if (this.pb.direction === 'reverse') dir = -1
    else if (this.pb.direction === 'pendulum') dir = this.pendDir

    const rate = Math.max(0, mul * this.pb.speed) // over realtime
    if (this.pos < 0) this.pos = v.currentTime

    // Pure-native forward: follow the element's own clock (no per-frame seeking).
    const pureNative = dir > 0 && rate <= NATIVE_MAX
    if (pureNative) {
      const pr = Math.max(0.0625, rate)
      if (v.playbackRate !== pr) v.playbackRate = pr
      // Stall watchdog — if it claims to be playing but currentTime stops moving,
      // re-kick play() so a decoder/GL hiccup can't freeze the clip.
      const t = v.currentTime
      if (Math.abs(t - this.lastCT) < 1e-4) {
        if (this.stallSince === 0) this.stallSince = performance.now()
        else if (performance.now() - this.stallSince > 400) {
          void v.play().catch(() => {})
          this.stallSince = performance.now()
        }
      } else this.stallSince = 0
      this.lastCT = t
      this.pos = t
    } else {
      // Reverse / pendulum-reverse / above the native cap: keep playing (frames
      // stay hot) but drive the position ourselves at the TRUE rate and snap
      // currentTime to it — scrubbing a playing element presents each frame.
      if (v.playbackRate !== 1) v.playbackRate = 1
      this.pos += rawDt * rate * dir
    }

    // Loop / trim / pendulum-bounce on the intended playhead.
    if (this.pb.direction === 'pendulum') {
      if (this.pos >= hi) { this.pos = hi; this.pendDir = -1 }
      else if (this.pos <= lo) { this.pos = lo; this.pendDir = 1 }
    } else if (this.pos > hi - 0.02) {
      this.pos = this.pb.loop ? lo : hi - 0.02
    } else if (this.pos < lo) {
      this.pos = this.pb.loop ? hi - 0.02 : lo
    }
    if (!Number.isFinite(this.pos)) this.pos = lo

    // Correct the element toward the intended playhead. In pure-native forward we
    // only intervene at the trim boundaries (else it runs free, smooth); when
    // overriding we set currentTime every frame.
    if (pureNative) {
      if (v.currentTime > hi - 0.02 || v.currentTime < lo - 0.05) {
        try { v.currentTime = this.pos } catch { /* seek can race a reload */ }
      }
    } else if (Math.abs(this.pos - v.currentTime) > 1e-3) {
      try { v.currentTime = this.pos } catch { /* seek can race a reload */ }
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
