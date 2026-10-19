// Codec Mosh : the real datamosh. The picture goes through an actual H.264
// encoder and decoder (WebCodecs, the graphics card's own), and the stream
// between the two is broken on purpose, the way datamoshers edit their files :
//
// - a keyframe WITHHELD : at a cut (or ▸ mosh) the encoder starts over from the
//   new picture, but the decoder never hears of it. The new motion then drags
//   the OLD picture around, and only the blocks the encoder repaints bring the
//   new one through, until a clean keyframe comes back (refresh, ▸ clean).
// - a motion frame REPEATED (bloom) : the same motion vectors applied again and
//   again, so the smear compounds outward.
// - a motion frame DROPPED (drop) : the next ones land on the wrong picture.
// - MOTION FROM the sidechain : the encoder watches another layer while the
//   decoder holds a keyframe of this one, so the other's movement paints this
//   layer's texture around.
//
// The input is read back small (an async readback ring, never a stall),
// encoded at that size so the 16-pixel macroblocks show, decoded, and the
// newest decoded frame drawn over the input. Everything codec-side is
// asynchronous : the picture runs a few frames late, and until the first frame
// decodes the input passes through. The readback rows run bottom-up and stay
// that way through the codec, so the upload needs no flip.

import { GridReadback } from './gridReadback'
import { glGeneration } from './glGeneration'
import type { ConvNode, NodeContext } from './convNodes'

const num = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' ? v : d)
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** The long edge the picture is encoded at, per `size` : fine · medium · coarse · huge. */
const SIZES = [960, 640, 416, 256]
const CODEC = 'avc1.42001f' // baseline (no B-frames : every frame is decodable at once), level 3.1

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

// What the encoder sees : the picture over black (a transparent layer encodes as black).
const F_PACK = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex;
void main(){ vec4 c = texture(uTex, vUV); o = vec4(c.rgb * c.a, 1.0); }`

// The decoded picture over the input, by mix; the input keeps its own transparency.
const F_OUT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uDec; uniform float uMix;
void main(){
  vec4 h = texture(uHost, vUV);
  vec3 d = texture(uDec, vUV).rgb;
  float a = max(h.a, uMix * step(0.004, max(d.r, max(d.g, d.b))));
  vec3 hs = h.a > 1e-4 ? h.rgb : vec3(0.0);
  o = vec4(mix(hs, d, uMix), a);
}`

type Intent = 'clean' | 'mosh' | 'normal'

interface Prog {
  p: WebGLProgram
  u: Record<string, WebGLUniformLocation | null>
}

export class CodecMoshNode implements ConvNode {
  private disposed = false
  private gen = glGeneration()
  // GL
  private vao: WebGLVertexArrayObject | null = null
  private quad: WebGLBuffer | null = null
  private pack: Prog | null = null
  private out: Prog | null = null
  private decTex: WebGLTexture | null = null
  private decW = 0
  private decH = 0
  private read: GridReadback | null = null
  // codec
  private enc: VideoEncoder | null = null
  private dec: VideoDecoder | null = null
  private starting = false
  private failed = false
  private quantizer = false // per-frame quality (no reconfigure) when the encoder takes it
  private cfgKey = ''
  private encW = 0
  private encH = 0
  private intents: Intent[] = []
  private decodedKey = false // the decoder has had a keyframe since its last (re)start
  private latest: VideoFrame | null = null
  private ts = 0
  private decTs = 0
  // the state of the mosh
  private wantClean = true // the next encode is a clean keyframe for the decoder
  private wantSideKey = false // motion mode : the next encode is the sidechain's keyframe, withheld
  private wantMosh = false // the next encode is a keyframe, withheld
  private holding = false // a withheld keyframe is in force : unasked keyframes are withheld too
  private holdLeft = 0 // seconds until the automatic refresh (Infinity : never)
  private prevMosh = 0
  private prevClean = 0
  private pulseAcc = 0
  private lastFrame = -1
  private prevLuma: Float32Array | null = null
  private cutCool = 0
  private lastQuality = -1
  private lastSize = -1
  private sizeAt = 0

  constructor(private gl: WebGL2RenderingContext) {}

  // ── GL ──────────────────────────────────────────────────────────────────
  private program(fs: string, names: string[]): Prog {
    const gl = this.gl
    const sh = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[codecMosh] shader:', gl.getShaderInfoLog(s))
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(p, 0, 'p')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('[codecMosh] link:', gl.getProgramInfoLog(p))
    const u: Record<string, WebGLUniformLocation | null> = {}
    for (const n of names) u[n] = gl.getUniformLocation(p, n)
    return { p, u }
  }

  /** Our own triangle in our own VAO : the default VAO belongs to the ISF runtime. */
  private ensureGL(): void {
    const gl = this.gl
    if (this.gen !== glGeneration()) {
      // a GPU reset : every object below is dead, start over (the codec too, for a clean keyframe)
      this.vao = null; this.quad = null; this.pack = null; this.out = null; this.decTex = null; this.read = null
      this.gen = glGeneration()
      this.wantClean = true
    }
    if (this.vao) return
    this.vao = gl.createVertexArray()
    this.quad = gl.createBuffer()
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.pack = this.program(F_PACK, ['uTex'])
    this.out = this.program(F_OUT, ['uHost', 'uDec', 'uMix'])
    this.read = new GridReadback(gl, 3)
  }

  // ── codec ───────────────────────────────────────────────────────────────
  private async startCodec(w: number, h: number, quality: number): Promise<void> {
    if (this.starting || typeof VideoEncoder === 'undefined') return
    this.starting = true
    const base: VideoEncoderConfig = { codec: CODEC, width: w, height: h, latencyMode: 'realtime', avc: { format: 'annexb' } }
    const tries: VideoEncoderConfig[] = [
      { ...base, bitrateMode: 'quantizer', hardwareAcceleration: 'prefer-hardware' },
      { ...base, bitrateMode: 'quantizer', hardwareAcceleration: 'prefer-software' },
      { ...base, bitrate: bitrateFor(quality, w, h), hardwareAcceleration: 'prefer-hardware' },
      { ...base, bitrate: bitrateFor(quality, w, h) }
    ]
    let cfg: VideoEncoderConfig | null = null
    // the graphics card's encoders are few (a handful of streams at once) : once
    // one refused, this node stays on the processor's
    for (const t of this.hwFailed ? tries.filter((t) => t.hardwareAcceleration !== 'prefer-hardware') : tries) {
      try {
        if ((await VideoEncoder.isConfigSupported(t)).supported) { cfg = t; break }
      } catch { /* next */ }
    }
    this.starting = false
    if (this.disposed) return
    if (!cfg) { this.failed = true; console.warn('[codecMosh] no H.264 encoder here'); return }
    this.stopCodec()
    this.quantizer = cfg.bitrateMode === 'quantizer'
    try {
      const enc = new VideoEncoder({
        output: (chunk) => this.onChunk(chunk),
        error: (e) => {
          console.warn('[codecMosh] encoder', e.message)
          if (cfg?.hardwareAcceleration === 'prefer-hardware') this.hwFailed = true
          this.restartSoon()
        }
      })
      enc.configure(cfg)
      const dec = new VideoDecoder({
        output: (f) => {
          if (this.disposed) { f.close(); return }
          this.latest?.close()
          this.latest = f
        },
        error: (e) => { console.warn('[codecMosh] decoder', e.message); this.restartSoon() }
      })
      dec.configure({ codec: CODEC, hardwareAcceleration: cfg.hardwareAcceleration ?? 'no-preference', optimizeForLatency: true })
      this.enc = enc
      this.dec = dec
      this.encW = w
      this.encH = h
      this.cfgKey = `${w}x${h}${this.quantizer ? '' : ':' + bitrateFor(quality, w, h)}`
      this.intents = []
      this.decodedKey = false
      this.wantClean = true
      console.info(`[codecMosh] H.264 ${w}x${h}, ${cfg.hardwareAcceleration === 'prefer-hardware' ? 'graphics card' : cfg.hardwareAcceleration === 'prefer-software' ? 'processor' : 'any'} encoder, ${this.quantizer ? 'per-frame quality' : 'bitrate ' + cfg.bitrate}`)
    } catch (e) {
      console.warn('[codecMosh] start', (e as Error).message)
      this.failed = true
    }
  }

  private stopCodec(): void {
    try { if (this.enc && this.enc.state !== 'closed') this.enc.close() } catch { /* closing */ }
    try { if (this.dec && this.dec.state !== 'closed') this.dec.close() } catch { /* closing */ }
    this.enc = null
    this.dec = null
    this.intents = []
  }

  /** A codec broke (a stream it refused) : start again from a clean keyframe,
   *  after a second (a codec that keeps refusing must not restart every frame). */
  private restartSoon(): void {
    this.stopCodec()
    this.cfgKey = ''
    this.retryAt = performance.now() + 1000
  }
  private retryAt = 0
  private sideWas = false
  private hwFailed = false

  private decode(type: 'key' | 'delta', data: Uint8Array): void {
    const dec = this.dec
    if (!dec || dec.state !== 'configured') return
    if (type === 'delta' && !this.decodedKey) return // a decoder must start on a keyframe
    try {
      dec.decode(new EncodedVideoChunk({ type, timestamp: (this.decTs += 16667), data }))
      if (type === 'key') this.decodedKey = true
    } catch (e) {
      console.warn('[codecMosh] decode', (e as Error).message)
      this.restartSoon()
    }
  }

  private bloom = 0
  private drop = 0

  /** Each chunk out of the encoder, in order, with why it was asked for. */
  private onChunk(chunk: EncodedVideoChunk): void {
    const intent = this.intents.shift() ?? 'normal'
    if (this.disposed) return
    const data = new Uint8Array(chunk.byteLength)
    chunk.copyTo(data)
    if (chunk.type === 'key') {
      // a keyframe asked for a clean picture goes through; one asked for a mosh
      // (or one the encoder made on its own while a mosh holds) is withheld
      if (intent === 'clean' || (intent === 'normal' && !this.holding)) this.decode('key', data)
      return
    }
    if (this.drop > 0 && this.decodedKey && Math.random() < this.drop * 0.5) return
    this.decode('delta', data)
    // bloom : the same motion again, up to three more times
    if (this.bloom > 0 && this.dec && this.dec.decodeQueueSize < 4) {
      const extra = Math.floor(this.bloom * 3 + Math.random() * this.bloom)
      for (let k = 0; k < extra; k++) this.decode('delta', data)
    }
  }

  private encode(px: Uint8Array, w: number, h: number, keyFrame: boolean, intent: Intent, quality: number): void {
    const enc = this.enc
    if (!enc || enc.state !== 'configured' || w !== this.encW || h !== this.encH) return
    let frame: VideoFrame | null = null
    try {
      frame = new VideoFrame(px, { format: 'RGBA', codedWidth: w, codedHeight: h, timestamp: (this.ts += 16667) })
      const opts: VideoEncoderEncodeOptions & { avc?: { quantizer?: number } } = { keyFrame }
      if (this.quantizer) opts.avc = { quantizer: Math.round(51 - quality * 33) } // 51 (starved) … 18 (clean)
      this.intents.push(intent)
      enc.encode(frame, opts)
    } catch (e) {
      this.intents.pop()
      console.warn('[codecMosh] encode', (e as Error).message)
      this.restartSoon()
    } finally {
      frame?.close()
    }
  }

  // ── per frame ───────────────────────────────────────────────────────────
  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed || this.failed || typeof VideoEncoder === 'undefined') return ctx.host
    const gl = this.gl
    const inp = ctx.inputs
    const cw = ctx.chain.w
    const ch = ctx.chain.h
    if (cw < 16 || ch < 16) return ctx.host // the warm-up's 8x8 : nothing to encode
    this.ensureGL()
    const dt = Math.max(0, ctx.dt)

    const sizeIdx = Math.max(0, Math.min(3, Math.round(num(inp.size, 1))))
    const quality = clamp01(num(inp.quality, 0.55))
    const refresh = clamp01(num(inp.refresh, 0.35))
    const cutSense = clamp01(num(inp.cuts, 0.6))
    const pulse = Math.max(0, num(inp.pulse, 0))
    const mix = clamp01(num(inp.mix, 1))
    this.bloom = clamp01(num(inp.bloom, 0))
    this.drop = clamp01(num(inp.drop, 0))
    const side = num(inp.motionFrom, 0) >= 0.5 && ctx.sidechain ? ctx.sidechain : null
    // the motion source comes or goes : seat this layer's picture under it again
    if (!!side !== this.sideWas) { this.sideWas = !!side; this.wantClean = true }

    // the encoded size : the long edge from `size`, the picture's own aspect, whole macroblocks
    const L = SIZES[sizeIdx]
    const ew = cw >= ch ? L : Math.max(64, Math.round((L * cw) / ch / 16) * 16)
    const eh = cw >= ch ? Math.max(64, Math.round((L * ch) / cw / 16) * 16) : L
    // a size (or, without per-frame quality, a bitrate) change restarts the codec,
    // at most every 0.4 s so a modulated knob can't thrash it
    const now = performance.now()
    if (sizeIdx !== this.lastSize || (!this.quantizer && Math.abs(quality - this.lastQuality) > 0.04)) {
      this.lastSize = sizeIdx
      this.lastQuality = quality
      this.sizeAt = now
    }
    const key = `${ew}x${eh}${this.quantizer ? '' : ':' + bitrateFor(this.lastQuality < 0 ? quality : this.lastQuality, ew, eh)}`
    if (key !== this.cfgKey && !this.starting && now - this.sizeAt > 400 && now >= this.retryAt) void this.startCodec(ew, eh, quality)

    // a gap in the frames (just inserted, re-enabled, PANIC) : start clean
    if (ctx.frame !== undefined && this.lastFrame >= 0 && ctx.frame !== this.lastFrame + 1) this.wantClean = true
    if (ctx.frame !== undefined) this.lastFrame = ctx.frame

    // triggers : ▸ mosh, ▸ clean, the pulse clock
    const m = num(inp.mosh, 0)
    if (m >= 0.5 && this.prevMosh < 0.5) this.wantMosh = true
    this.prevMosh = m
    const c = num(inp.clean, 0)
    if (c >= 0.5 && this.prevClean < 0.5) this.wantClean = true
    this.prevClean = c
    if (pulse > 0) {
      this.pulseAcc += dt * pulse
      if (this.pulseAcc >= 1) { this.pulseAcc %= 1; this.wantMosh = true }
    }
    // the automatic refresh : 0 never; else after 28 s (low) … 0.25 s (1)
    if (this.holding && refresh > 0) {
      this.holdLeft -= dt
      if (this.holdLeft <= 0) this.wantClean = true
    }
    this.cutCool = Math.max(0, this.cutCool - dt)

    // ── the newest readback → the encoder ──
    const grid = this.read!.takeLatest()
    const cells = side ? 2 : 1
    if (grid && this.enc && grid.w === this.encW && grid.h === this.encH * cells && this.enc.encodeQueueSize <= 2) {
      const n = this.encW * this.encH * 4
      const host = grid.grid.subarray(0, n)
      const motion = side ? grid.grid.subarray(n, 2 * n) : null
      // a cut in the input : a sudden change of the whole picture
      if (!side && cutSense > 0 && this.isCut(host, cutSense)) this.wantMosh = true
      // ▸ mosh with a motion source : re-seat this layer's picture under the motion
      if (motion && this.wantMosh) { this.wantClean = true; this.wantMosh = false }
      if (this.wantClean) {
        // a clean keyframe of THIS layer for the decoder
        this.encode(host, this.encW, this.encH, true, 'clean', quality)
        this.wantClean = false
        this.wantMosh = false
        this.holding = !!motion
        this.wantSideKey = !!motion
        this.holdLeft = holdFor(refresh)
      } else if (motion) {
        // motion mode : the sidechain's frames, its first one a withheld keyframe
        this.encode(motion, this.encW, this.encH, this.wantSideKey, 'mosh', quality)
        this.wantSideKey = false
      } else if (this.wantMosh) {
        this.encode(host, this.encW, this.encH, true, 'mosh', quality)
        this.wantMosh = false
        this.holding = true
        this.holdLeft = holdFor(refresh)
      } else {
        this.encode(host, this.encW, this.encH, false, 'normal', quality)
      }
    }

    // ── queue the next readback (this layer, and the sidechain under it) ──
    if (this.enc && !this.read!.full) {
      gl.useProgram(this.pack!.p)
      gl.bindVertexArray(this.vao)
      this.read!.kickStrip(this.encW, this.encH, side ? [ctx.host, side] : [ctx.host], this.pack!.p, this.pack!.u.uTex, this.vao!, false, cells)
    }

    // ── the newest decoded frame → our texture ──
    if (this.latest) {
      const f = this.latest
      this.latest = null
      try {
        if (!this.decTex) {
          this.decTex = gl.createTexture()
          gl.bindTexture(gl.TEXTURE_2D, this.decTex)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        }
        gl.bindTexture(gl.TEXTURE_2D, this.decTex)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, f as unknown as TexImageSource)
        this.decW = f.codedWidth
        this.decH = f.codedHeight
      } catch (e) {
        console.warn('[codecMosh] upload', (e as Error).message)
      } finally {
        f.close()
      }
    }
    if (!this.decTex || !this.decW) return ctx.host

    // ── the decoded picture over the input ──
    const o = ctx.chain.next()
    const p = this.out!
    gl.useProgram(p.p)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, ctx.host)
    gl.uniform1i(p.u.uHost, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.decTex)
    gl.uniform1i(p.u.uDec, 1)
    gl.uniform1f(p.u.uMix, mix)
    gl.bindFramebuffer(gl.FRAMEBUFFER, o.fbo)
    gl.viewport(0, 0, cw, ch)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.activeTexture(gl.TEXTURE0)
    return o.tex
  }

  /** A sudden change of the whole picture, from a sparse luma sample of the
   *  readback (about 1500 points). `sense` 0..1 : 1 hears the smallest cuts. */
  private isCut(px: Uint8Array, sense: number): boolean {
    const step = 4 * 23 // every 23rd pixel : a sparse, aliasing-proof sample
    const n = Math.floor(px.length / step)
    if (!this.prevLuma || this.prevLuma.length !== n) {
      this.prevLuma = new Float32Array(n)
      for (let i = 0; i < n; i++) this.prevLuma[i] = lumaAt(px, i * step)
      return false
    }
    let diff = 0
    for (let i = 0; i < n; i++) {
      const l = lumaAt(px, i * step)
      diff += Math.abs(l - this.prevLuma[i])
      this.prevLuma[i] = l
    }
    diff /= n * 255
    if (this.cutCool > 0) return false
    const thr = 0.32 - 0.27 * sense // 0.32 (only hard cuts) … 0.05
    if (diff > thr) {
      this.cutCool = 0.3
      return true
    }
    return false
  }

  dispose(): void {
    this.disposed = true
    this.stopCodec()
    this.latest?.close()
    this.latest = null
    const gl = this.gl
    if (this.gen === glGeneration() && !gl.isContextLost()) {
      if (this.decTex) gl.deleteTexture(this.decTex)
      if (this.quad) gl.deleteBuffer(this.quad)
      if (this.vao) gl.deleteVertexArray(this.vao)
      if (this.pack) gl.deleteProgram(this.pack.p)
      if (this.out) gl.deleteProgram(this.out.p)
      this.read?.dispose()
    }
    this.decTex = null
    this.vao = null
    this.read = null
  }
}

function lumaAt(px: Uint8Array, i: number): number {
  return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114
}

/** Seconds a mosh holds before the automatic clean keyframe : `refresh` 0 never,
 *  then 28 s … 0.25 s. */
function holdFor(refresh: number): number {
  return refresh <= 0 ? Infinity : 0.25 * Math.pow(112, 1 - refresh)
}

/** Without per-frame quality : a bitrate from `quality`, 40 kb/s (starved) …
 *  ~6 Mb/s at 640x360, scaled by the encoded area. */
function bitrateFor(quality: number, w: number, h: number): number {
  const at360 = 40_000 * Math.pow(150, clamp01(quality))
  return Math.round((at360 * (w * h)) / (640 * 360) / 10_000) * 10_000
}
