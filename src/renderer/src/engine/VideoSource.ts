// VideoSource : imported video as a layer source (brief §4, §7).
//
// Wraps an HTML <video> (hardware-decoded H.264/HEVC/AV1 via Quick Sync / the
// 4070), auto-loops it, and uploads each frame to a GL texture the Compositor
// samples. The "synthify" macro sub-chain (posterize → ordered dither →
// luma/edge key → chroma shift → optional feedback) runs as ISF FX on top of
// this texture : it lives in the FX rack, not here. No Hap dependency.

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
  // Frame presentation (requestVideoFrameCallback): only upload when a genuinely
  // NEW frame is presented. Uploading every render frame while seeking grabs the
  // pre-seek (frozen) frame : the "playhead moves, image doesn't" bug.
  private pendingFrame = true
  private rvfcId = 0
  private rvfcOn = false
  // Override-mode seek gate: own ONE in-flight seek so we don't re-seek every
  // frame (perpetual seeking never settles a frame). Cleared by 'seeked' + safety.
  private seeking = false
  private seekAt = 0
  private pb: VideoPlayback = {
    playing: true,
    speed: 1,
    direction: 'forward',
    loop: true,
    inN: 0,
    outN: 1
  }
  // Modulation overrides, written post-modulation each frame and CONSUMED by the
  // next tick (one-frame values : unbinding the modulator releases them).
  // posMod : normalized playhead 0..1 within the in/out trim — the modulatable
  // playhead. On all-intra clips (the ffmpeg import cache) every frame is a
  // keyframe, so the override-seek lands frame-accurately at speed.
  private posMod: number | null = null
  private speedMod: number | null = null
  setPosMod(v: number): void {
    this.posMod = Math.max(0, Math.min(1, v))
  }
  setSpeedMod(v: number): void {
    this.speedMod = Math.max(0, v)
  }

  // ── Video granulation (multi-voice) ──────────────────────────────────
  // 3 voice <video> elements on the SAME src, each an independent seek head.
  // On all-intra clips (the import cache) a grain-seek decodes one frame, so
  // three scattered heads run in real time. Each grain: born at (playhead ±
  // spray), a direction (reverse with probability), a jittered rate, and a
  // raised-cosine envelope; voices are staggered a third of a grain apart and
  // blended by envelope weight in a small GL pass. The transport (or the
  // MODULATED playhead) keeps moving underneath : it is the cloud's centre.
  private grain = { on: false, size: 0.25, spray: 0.15, reverseP: 0.25, jitter: 0.2 }
  private grainSizeMod: number | null = null
  private grainSprayMod: number | null = null
  private voices: Array<{
    v: HTMLVideoElement
    tex: WebGLTexture | null
    born: number
    dur: number
    start: number
    dir: number
    rate: number
    seeking: boolean
    seekAt: number
  }> | null = null
  private blendProg: WebGLProgram | null = null
  private blendFbo: WebGLFramebuffer | null = null
  private blendTex: WebGLTexture | null = null
  private blendW = 0
  private blendH = 0
  private quad: WebGLBuffer | null = null

  setGrain(g: { on: boolean; size: number; spray: number; reverseP: number; jitter: number }): void {
    this.grain = g
  }
  setGrainMod(name: string, v: number): void {
    if (name === 'grainSize') this.grainSizeMod = v
    else if (name === 'grainSpray') this.grainSprayMod = v
  }

  private ensureVoices(): void {
    if (this.voices) return
    this.voices = [0, 1, 2].map(() => {
      const v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.preload = 'auto'
      v.loop = false
      v.src = this.video.src
      v.playbackRate = 0.1 // pipeline kept hot; grains are seek-driven
      void v.play().catch(() => {})
      return { v, tex: null, born: -1, dur: 0.2, start: 0, dir: 1, rate: 1, seeking: false, seekAt: 0 }
    })
  }

  /** Drive the 3 grain voices : retrigger ended grains around the playhead,
   *  step each voice's clip-time along its grain, one seek at a time. */
  private tickGrains(nowS: number, lo: number, hi: number): void {
    this.ensureVoices()
    const size = Math.max(0.05, Math.min(1, this.grainSizeMod ?? this.grain.size))
    const spray = Math.max(0, Math.min(1, this.grainSprayMod ?? this.grain.spray))
    this.grainSizeMod = null
    this.grainSprayMod = null
    const span = Math.max(0.05, hi - lo)
    for (let i = 0; i < this.voices!.length; i++) {
      const g = this.voices![i]
      const age = g.born < 0 ? Infinity : nowS - g.born
      if (age >= g.dur) {
        // Retrigger : scatter around the current (possibly modulated) playhead.
        g.dur = size
        g.born = nowS - (g.born < 0 ? (i / 3) * size : 0) // stagger the first round
        g.start = Math.max(lo, Math.min(hi - 0.05, this.pos + (Math.random() * 2 - 1) * spray * span))
        g.dir = Math.random() < this.grain.reverseP ? -1 : 1
        g.rate = Math.max(0.1, 1 + (Math.random() * 2 - 1) * this.grain.jitter)
      }
      if (g.v.paused) void g.v.play().catch(() => {})
      // Target clip-time for this voice = grain start + progress along the grain.
      const t = Math.max(lo, Math.min(hi - 0.02, g.start + Math.min(age, g.dur) * g.rate * g.dir))
      if (g.seeking && performance.now() - g.seekAt > 2000) g.seeking = false
      if (!g.seeking && Math.abs(t - g.v.currentTime) > 0.02) {
        try {
          g.v.currentTime = t
          g.seeking = true
          g.seekAt = performance.now()
          const done = (): void => {
            g.seeking = false
          }
          g.v.addEventListener('seeked', done, { once: true })
        } catch {
          /* seek can race a reload */
        }
      }
    }
  }

  /** Blend the 3 voice textures by envelope weight into one output texture. */
  private blendVoices(nowS: number): WebGLTexture | null {
    const gl = this.gl
    const vs0 = this.voices![0].v
    const w = vs0.videoWidth, h = vs0.videoHeight
    if (!w || !h) return this.tex
    if (!this.blendProg) {
      const compile = (type: number, src: string): WebGLShader => {
        const s = gl.createShader(type)!
        gl.shaderSource(s, src); gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[grain] compile:', gl.getShaderInfoLog(s))
        return s
      }
      const p = gl.createProgram()!
      gl.attachShader(p, compile(gl.VERTEX_SHADER,
        `#version 300 es\nin vec2 p; out vec2 vUV; void main(){ vUV = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`))
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER,
        `#version 300 es\nprecision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D t0, t1, t2; uniform vec3 uW;
void main(){
  vec2 uv = vec2(vUV.x, 1.0 - vUV.y);
  vec3 c = texture(t0, uv).rgb * uW.x + texture(t1, uv).rgb * uW.y + texture(t2, uv).rgb * uW.z;
  o = vec4(c / max(uW.x + uW.y + uW.z, 0.001), 1.0);
}`))
      gl.bindAttribLocation(p, 0, 'p')
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('[grain] link:', gl.getProgramInfoLog(p))
      this.blendProg = p
      this.quad = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    }
    if (!this.blendTex || this.blendW !== w || this.blendH !== h) {
      if (this.blendTex) gl.deleteTexture(this.blendTex)
      if (this.blendFbo) gl.deleteFramebuffer(this.blendFbo)
      this.blendTex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.blendTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.blendFbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blendFbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.blendTex, 0)
      this.blendW = w; this.blendH = h
    }
    // Upload each voice's current frame + compute its raised-cosine envelope.
    const weights: number[] = []
    for (const g of this.voices!) {
      g.tex = uploadVideoFrame(gl, g.v, g.tex)
      const k = g.dur > 0 ? Math.max(0, Math.min(1, (nowS - g.born) / g.dur)) : 1
      weights.push(g.tex ? Math.pow(Math.sin(Math.PI * k), 2) : 0)
    }
    gl.useProgram(this.blendProg)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blendFbo)
    gl.viewport(0, 0, w, h)
    for (let i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, this.voices![i].tex)
      gl.uniform1i(gl.getUniformLocation(this.blendProg, `t${i}`), i)
    }
    gl.uniform3f(gl.getUniformLocation(this.blendProg, 'uW'), weights[0], weights[1], weights[2])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return this.blendTex
  }

  private disposeVoices(): void {
    if (!this.voices) return
    for (const g of this.voices) {
      g.v.pause()
      g.v.removeAttribute('src')
      g.v.load()
      if (g.tex) this.gl.deleteTexture(g.tex)
    }
    this.voices = null
  }

  constructor(private gl: WebGL2RenderingContext) {
    this.video = document.createElement('video')
    // Native looping off : we own the loop/trim/direction.
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
    // A completed seek frees the override seek gate.
    this.video.addEventListener('seeked', () => {
      this.seeking = false
      this.pendingFrame = true // the seeked frame is now presentable
    })
  }

  // Upload only when a genuinely new frame is presented (rVFC). This is what lets
  // a seek's frame reach texImage2D instead of the stale pre-seek one.
  private startFrameLoop(): void {
    const v = this.video
    if (typeof v.requestVideoFrameCallback !== 'function') {
      this.rvfcOn = false // no rVFC → fall back to uploading every frame
      return
    }
    this.rvfcOn = true
    const cb = (): void => {
      this.pendingFrame = true
      this.rvfcId = v.requestVideoFrameCallback(cb)
    }
    this.rvfcId = v.requestVideoFrameCallback(cb)
  }

  load(src: string): void {
    this.disposeVoices() // grain voices re-create lazily on the new src
    // Reset every per-clip transient : a stale playhead (beyond the new clip's
    // duration), a stuck seek gate, or a pending rVFC chain from a previous load
    // can strand the new clip on a frozen frame.
    this.pos = -1
    this.seeking = false
    this.pendingFrame = true
    this.lastCT = -1
    this.stallSince = 0
    this.pendDir = 1
    this.posMod = null
    this.speedMod = null
    if (this.rvfcOn && typeof this.video.cancelVideoFrameCallback === 'function' && this.rvfcId) {
      this.video.cancelVideoFrameCallback(this.rvfcId)
      this.rvfcId = 0
    }
    this.video.src = src
    // Start native playback (import is a user gesture, so autoplay is allowed);
    // tick() takes over rate/direction/loop from here. Re-assert play once the
    // clip can actually run, in case the eager first play() rejected (no data yet).
    const kick = (): void => void this.video.play().catch(() => {})
    kick()
    this.video.addEventListener('canplay', kick, { once: true })
    this.startFrameLoop()
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
   *  speed. The element is kept PLAYING in every mode : a PAUSED <video> stops
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
    // Native playback is smooth only while the decoder can sustain the rate. Near
    // its 16× cap it stalls (can't decode 16× realtime; a short clip re-seeking
    // its loop point every few ms makes it worse) : which reads as a frozen image
    // even though the playhead moves. Above this we fast-forward with the same
    // keyframe-seek pump reverse uses (choppier, but it never freezes).
    const NATIVE_MAX = 8

    if (!this.pb.playing) {
      if (!v.paused) v.pause()
      return
    }
    // Always keep the media pipeline hot so frames flow to the texture.
    if (v.paused) void v.play().catch(() => {})

    // Modulated playhead : a bound modulator wrote a normalized position this
    // frame. It OWNS the playhead — place it inside the trim and drive the
    // element through the override-seek path (below). Consumed per-frame, so
    // unbinding the modulator hands the transport back seamlessly.
    const posN = this.posMod
    this.posMod = null
    const spMod = this.speedMod ?? 1
    this.speedMod = null
    if (posN !== null) {
      if (v.playbackRate !== 0.1) v.playbackRate = 0.1
      this.pos = lo + posN * Math.max(0, hi - lo - 0.02)
      if (!Number.isFinite(this.pos)) this.pos = lo
      if (this.grain.on) this.tickGrains(performance.now() / 1000, lo, hi)
      else this.seekTowardPos(v)
      return
    }

    // Instantaneous direction: pendulum bounces between +1 and -1 at the trims.
    let dir = 1
    if (this.pb.direction === 'reverse') dir = -1
    else if (this.pb.direction === 'pendulum') dir = this.pendDir

    const rate = Math.max(0, mul * this.pb.speed * spMod) // over realtime
    if (this.pos < 0) this.pos = v.currentTime

    // Pure-native forward: follow the element's own clock (no per-frame seeking).
    const pureNative = dir > 0 && rate <= NATIVE_MAX
    if (pureNative) {
      const pr = Math.max(0.0625, rate)
      if (v.playbackRate !== pr) v.playbackRate = pr
      // Stall watchdog : if it claims to be playing but currentTime stops moving,
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
      // Reverse / pendulum-reverse / above the native cap: keep the pipeline hot
      // at a minimal forward rate, drive the intended playhead ourselves at the
      // TRUE rate, and seek toward it ONE completed seek at a time (below). We do
      // NOT seek every frame : that keeps the decoder perpetually seeking and the
      // presented frame never updates (playhead moves, image freezes).
      if (v.playbackRate !== 0.1) v.playbackRate = 0.1
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
    // only intervene at the trim boundaries (else it runs free, smooth). When
    // overriding, issue ONE seek at a time toward `pos` : wait for the previous to
    // finish ('seeked' clears the gate) so each frame settles and reaches the
    // texture; a generous safety timeout recovers from a dropped 'seeked'.
    // Granular : the transport above still advances `pos` (the cloud's centre);
    // the picture comes from the grain voices, so skip correcting the element.
    if (this.grain.on) {
      this.tickGrains(performance.now() / 1000, lo, hi)
      return
    }

    if (pureNative) {
      if (v.currentTime > hi - 0.02 || v.currentTime < lo - 0.05) {
        try { v.currentTime = this.pos } catch { /* seek can race a reload */ }
      }
    } else {
      this.seekTowardPos(v)
    }
  }

  /** Override-seek : one completed seek at a time toward the intended playhead.
   *  A large backward / fast-forward seek can take a while to decode. The
   *  safety must sit ABOVE any real seek time : otherwise it fires mid-seek,
   *  issues a new seek that CANCELS the in-flight one, and the frame never
   *  settles (the >1× reverse / >16× forward freeze). 'seeked' is the primary
   *  release; this only rescues a genuinely hung seek. */
  private seekTowardPos(v: HTMLVideoElement): void {
    if (this.seeking && performance.now() - this.seekAt > 4000) this.seeking = false
    if (!this.seeking && Math.abs(this.pos - v.currentTime) > 0.02) {
      try {
        v.currentTime = this.pos
        this.seeking = true
        this.seekAt = performance.now()
      } catch {
        /* a seek can race a src reload : retry next frame */
      }
    }
  }

  /** Upload the current frame to a GL texture and return it (null until the
   *  first frame is decodable). Called once per frame for a video slot. Only
   *  re-uploads when a new frame was actually presented (rVFC) : so a seek's
   *  frame reaches the texture and steady playback isn't re-uploaded needlessly.
   *  Without rVFC support it uploads every frame (previous behaviour). */
  upload(): WebGLTexture | null {
    if (this.grain.on && this.voices) return this.blendVoices(performance.now() / 1000)
    if (this.pendingFrame || !this.rvfcOn || !this.tex) {
      this.tex = uploadVideoFrame(this.gl, this.video, this.tex)
      this.pendingFrame = false
    }
    return this.tex
  }

  dispose(): void {
    const v = this.video
    if (this.rvfcOn && typeof v.cancelVideoFrameCallback === 'function' && this.rvfcId) {
      v.cancelVideoFrameCallback(this.rvfcId)
    }
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load() // release the decoder
    if (this.tex) this.gl.deleteTexture(this.tex)
    this.tex = null
    this.disposeVoices()
    if (this.blendTex) this.gl.deleteTexture(this.blendTex)
    if (this.blendFbo) this.gl.deleteFramebuffer(this.blendFbo)
    if (this.blendProg) this.gl.deleteProgram(this.blendProg)
    if (this.quad) this.gl.deleteBuffer(this.quad)
    this.blendTex = null
    this.blendFbo = null
    this.blendProg = null
    this.quad = null
  }
}
