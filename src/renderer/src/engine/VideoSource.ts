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
  private seekBusy = false // a manual seek is in flight (wait for 'seeked')
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
    // Manual reverse/step seeks: only issue the next once the last one settled,
    // otherwise the element seeks forever and never paints a frame (stays black).
    this.video.addEventListener('seeked', () => {
      this.seekBusy = false
    })
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
    // `pos` is the true intended playhead (kept in sync with the element during
    // native playback); during manual/reverse it leads the lagging seek, so the
    // timeline shows smooth motion at the real rate.
    return this.pos >= 0 ? this.pos : this.video.currentTime
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

    // Instantaneous direction: pendulum bounces between +1 and -1 at the trims.
    let dir = 1
    if (this.pb.direction === 'reverse') dir = -1
    else if (this.pb.direction === 'pendulum') dir = this.pendDir

    // Native playback handles smooth FORWARD-in-range motion. Reverse and
    // out-of-range speeds step currentTime manually.
    const nativeOk = dir > 0 && rate >= 0.0625 && rate <= 16
    if (nativeOk) {
      if (v.playbackRate !== rate) v.playbackRate = rate
      if (v.paused) void v.play().catch(() => {})
      this.pos = v.currentTime // keep the manual clock synced for a later flip
      if (v.currentTime >= hi - 0.02) {
        if (this.pb.direction === 'pendulum') {
          this.pendDir = -1 // bounce back — manual reverse takes over next frame
          this.pos = hi
        } else if (this.pb.loop) {
          v.currentTime = lo
        } else {
          v.currentTime = hi
          v.pause()
        }
      } else if (v.currentTime < lo - 0.02) {
        v.currentTime = lo
      }
      return
    }

    // Manual stepping — decouple from the element clock (internal `pos`).
    // Advance `pos` EVERY frame at the true rate (so reverse covers the same
    // clip-time per second as forward — no slow-down), and only issue a new seek
    // once the previous finished (backward seeks are slow), catching up to the
    // latest pos. The result is choppier than native forward, never slower.
    if (!v.paused) v.pause()
    if (this.pos < 0) this.pos = v.currentTime
    this.pos += rawDt * rate * dir
    if (this.pb.direction === 'pendulum') {
      if (this.pos >= hi) {
        this.pos = hi
        this.pendDir = -1 // reached the top → swing back down
      } else if (this.pos <= lo) {
        this.pos = lo
        this.pendDir = 1 // reached the bottom → swing forward again
      }
    } else if (this.pos < lo) {
      this.pos = this.pb.loop ? hi : lo
    } else if (this.pos > hi) {
      this.pos = this.pb.loop ? lo : hi
    }
    if (!Number.isFinite(this.pos)) this.pos = lo
    if (!this.seekBusy && Math.abs(this.pos - v.currentTime) > 1e-4) {
      this.seekBusy = true
      try {
        v.currentTime = this.pos
      } catch {
        this.seekBusy = false // a seek can race a src reload — retry next frame
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
