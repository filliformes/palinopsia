// ParametricSource : the "Parametric" diegesis generator, a literal audio-buffer
// → texture reading. Each frame it reads the audio bus's spectrum or waveform,
// uploads it to a small 1-D texture and draws it as a hard raster, a waveform
// trace, spectrum bars, or a scrolling spectrogram. Native node (no ISF
// compile) : a TS class the layer owns, like TextSource.
//
// Where the signal comes from:
//  - local audio input : the real spectrum (log axis 30 Hz..16 kHz, bass left,
//    each column the loudest bin it covers) and the real waveform;
//  - OSC audio only : the six audio-bus bands (as six wide steps; the waveform
//    mode rebuilds a wave from them);
//  - no audio at all : a slow procedural test signal, so it is never blank.
// Raster / spectrogram stay abstract and monochrome-friendly : a raster,
// waveform or spectrogram, never an oscilloscope figure.
//
// GL hygiene : its own VAO (never the default one the ISF runtime wires), the
// shared programs are rebuilt after a GPU reset, and the spectrogram history
// targets are only allocated once the spectrogram mode is first drawn.

import { audioBus } from './audioIn'

const AUDIO_W = 512 // columns of the audio texture
const F_LO = 30
const F_HI = 16000

const VS = `#version 300 es
layout(location = 0) in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

// One small program per mode (a single multi-mode shader had its branches
// flattened by the D3D compiler, so every mode paid for all four). uAudio is
// AUDIO_W×4 R8 : row 0 this frame, row 1 the spectrum of the previous
// spectrogram write, rows 2 / 3 the waveform's local min / max (its envelope
// over the trace's reach, so pixels far from the curve skip the polyline).
const HEAD = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag;
uniform sampler2D uAudio;
uniform float uGain, uScale, uSeam, uMono; uniform vec3 uColor; uniform vec2 uRes;
float aud(float x){ return textureLod(uAudio, vec2(clamp(x, 0.0, 1.0), 0.125), 0.0).r; }
void out1(float v){ frag = vec4(mix(uColor, vec3(1.0), uMono) * v, 1.0); }
`

const FS: Record<'raster' | 'wave' | 'bars' | 'show', string> = {
  // Raster : hard columns, each lit when its band beats its own threshold
  // (louder = more columns), plus scanning seams where the band is alive.
  raster: HEAD + `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
void main(){
  float cols = floor(mix(24.0, 96.0, uScale));
  float k = floor(vUV.x * cols);
  float m = aud((k + 0.5) / cols) * uGain;
  float cell = step(0.5, fract(vUV.x * cols));
  float bar = cell * step(0.12 + 0.76 * hash11(k + 17.0), m);
  // 40 seams over the height, ~1 px at 1080p (scaled with the frame).
  float f = fract(vUV.y * 40.0 - uSeam);
  float dpx = min(f, 1.0 - f) * uRes.y / 40.0;
  float lw = max(1.0, uRes.y / 1080.0);
  float seam = clamp(0.5 * lw + 0.5 - dpx, 0.0, 1.0);
  out1(max(bar, seam * step(0.2, m)));
}`,
  // Waveform trace : the true distance to the curve, a short polyline through
  // the texture's own columns (fixed points, the same for every pixel) as far
  // either side as the trace is wide, in frame-height units. Steep edges keep
  // the flat runs' thickness and sharp peaks stay clean.
  wave: HEAD + `
void main(){
  float aspect = uRes.x / uRes.y;
  float amp = 0.9 * uGain;
  float hw = max(0.012 + 0.03 * uScale, 1.5 / uRes.y);
  float cw = aspect / ${AUDIO_W}.0;
  int reach = min(24, int(ceil(hw / cw)) + 1);
  int c0 = int(floor(vUV.x * ${AUDIO_W}.0));
  // Envelope early-out : outside the curve's local range (+ the trace width)
  // nothing is lit.
  int cc = clamp(c0, 0, ${AUDIO_W - 1});
  float lo = 0.5 + (texelFetch(uAudio, ivec2(cc, 2), 0).r - 0.5) * amp - hw;
  float hi = 0.5 + (texelFetch(uAudio, ivec2(cc, 3), 0).r - 0.5) * amp + hw;
  if (vUV.y < lo || vUV.y > hi) { out1(0.0); return; }
  vec2 q = vec2(vUV.x * aspect, vUV.y);
  float d = 1e9;
  vec2 prev = vec2(0.0);
  for (int k = -24; k <= 24; k++) {
    if (k < -reach || k > reach) continue;
    float a = texelFetch(uAudio, ivec2(clamp(c0 + k, 0, ${AUDIO_W - 1}), 0), 0).r;
    vec2 pt = vec2((float(c0 + k) + 0.5) * cw, 0.5 + (a - 0.5) * amp);
    if (k > -reach) {
      vec2 ab = pt - prev;
      float t = clamp(dot(q - prev, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
      d = min(d, length(q - prev - ab * t));
    }
    prev = pt;
  }
  out1(1.0 - smoothstep(0.0, hw, d));
}`,
  // Bars : scale sets how many, each as tall as the loudest column it covers,
  // with a gap between bars once they are wide enough to show one.
  bars: HEAD + `
void main(){
  float n = floor(mix(8.0, 160.0, uScale));
  float k = floor(vUV.x * n);
  float pitch = uRes.x / n;
  float gap = pitch >= 3.0 ? max(1.0, 0.2 * pitch) : 0.0;
  float fx = fract(vUV.x * n) * pitch;
  float inBar = step(0.5 * gap, fx) * step(fx, pitch - 0.5 * gap);
  // Every column this bar covers (texelFetch : exact columns, no filtering).
  int i0 = int(floor(k / n * ${AUDIO_W}.0));
  int i1 = max(i0, int(ceil((k + 1.0) / n * ${AUDIO_W}.0)) - 1);
  float m = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i0 + i > i1) break;
    m = max(m, texelFetch(uAudio, ivec2(min(i0 + i, ${AUDIO_W - 1}), 0), 0).r);
  }
  out1(inBar * step(vUV.y, m * uGain));
}`,
  // Spectrogram display : stored magnitudes, gain + contrast applied here so a
  // knob change reaches the whole history at once (scale 0.4 = linear).
  show: HEAD + `
uniform sampler2D uHist;
void main(){
  float m = texelFetch(uHist, ivec2(gl_FragCoord.xy), 0).r;
  out1(pow(clamp(m * uGain, 0.0, 1.0), exp2((uScale - 0.4) * 2.5)));
}`
}

// Spectrogram history advance : shift the previous history DOWN by uRows whole
// rows (texelFetch, no resampling, so it never blurs) and write the new rows
// along the TOP, spread from the previous spectrum (lowest new row) to this
// one (top row). Stores raw magnitudes (R8).
const SPEC_FS = `#version 300 es
precision highp float; out vec4 frag;
uniform sampler2D uAudio; uniform sampler2D uHist;
uniform int uRows; uniform vec2 uRes;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  int age = int(uRes.y) - 1 - p.y; // 0 = the top row (newest)
  if (age < uRows) {
    float t = (float(age) + 0.5) / float(uRows);
    float x = (float(p.x) + 0.5) / uRes.x;
    float cur = textureLod(uAudio, vec2(x, 0.125), 0.0).r;
    float prv = textureLod(uAudio, vec2(x, 0.375), 0.0).r;
    frag = vec4(mix(cur, prv, t), 0.0, 0.0, 1.0);
  } else {
    frag = vec4(texelFetch(uHist, ivec2(p.x, p.y + uRows), 0).r, 0.0, 0.0, 1.0);
  }
}`

interface Target {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
}

type ProgKey = keyof typeof FS | 'spec'
const UNIFORMS = ['uAudio', 'uHist', 'uGain', 'uScale', 'uSeam', 'uMono', 'uColor', 'uRes', 'uRows'] as const
interface Prog {
  prog: WebGLProgram
  u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>
}

// Programs shared per context and compiled on first use, validated once per
// ParametricSource and mode (never per frame : gl.isProgram is a blocking
// round-trip to the GPU process). A GPU reset keeps the same context object but
// kills its programs; the engine then rebuilds its sources, and the first new
// one finds the cached program dead and rebuilds it.
const progs = new WeakMap<WebGL2RenderingContext, Map<ProgKey, Prog>>()
function paramProg(gl: WebGL2RenderingContext, key: ProgKey): Prog {
  let m = progs.get(gl)
  if (!m) progs.set(gl, (m = new Map()))
  const have = m.get(key)
  if (have && gl.isProgram(have.prog)) return have
  const compile = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[parametric]', key, gl.getShaderInfoLog(s))
    return s
  }
  const prog = gl.createProgram()!
  const v = compile(gl.VERTEX_SHADER, VS)
  const f = compile(gl.FRAGMENT_SHADER, key === 'spec' ? SPEC_FS : FS[key])
  gl.attachShader(prog, v)
  gl.attachShader(prog, f)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error('[parametric] link', key, gl.getProgramInfoLog(prog))
  gl.deleteShader(v)
  gl.deleteShader(f)
  const u = {} as Prog['u']
  for (const n of UNIFORMS) u[n] = gl.getUniformLocation(prog, n)
  const g = { prog, u }
  m.set(key, g)
  return g
}

const MODE_KEY: (keyof typeof FS)[] = ['raster', 'wave', 'bars', 'show']

// OSC waveform : cycles across the frame for each of the six bands.
const OSC_CYCLES = [1.5, 3, 6, 12, 24, 48]

export class ParametricSource {
  private vao: WebGLVertexArrayObject
  private quad: WebGLBuffer
  private audioTex: WebGLTexture
  private hist: [Target, Target] | null = null // lazy : first spectrogram frame
  private progs = new Map<ProgKey, Prog>() // resolved per mode on first use
  private histIdx = 0
  private buf = new Uint8Array(AUDIO_W * 4) // this frame · previous spectrogram write · wave min · wave max
  private inputs: Record<string, number | number[]> = {}
  private t0 = 0
  private lastClock: number | null = null
  private tSig = 0 // integrated test-signal time
  private seam = 0 // raster seam phase (fract)
  private rowAcc = 0 // spectrogram rows owed (fractional carry)
  private oscPh = new Float64Array(6)
  private disposed = false

  constructor(private gl: WebGL2RenderingContext, private w: number, private h: number) {
    // Own VAO : never touch the default one (the ISF runtime's attribute 0).
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    this.audioTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, AUDIO_W, 4, 0, gl.RED, gl.UNSIGNED_BYTE, this.buf)
  }

  private makeTarget(): Target {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.w, this.h, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return { fbo, tex }
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
  }
  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
  }

  private num(name: string, d: number): number {
    const v = this.inputs[name]
    return typeof v === 'number' && Number.isFinite(v) ? v : d
  }

  // Fill row 0 of `buf` : the spectrum (log columns) for raster / bars /
  // spectrogram, the waveform for the trace.
  private fillBuffer(mode: number, dt: number): void {
    const buf = this.buf
    const W = AUDIO_W
    const busMode = audioBus.mode
    const useLocal = busMode !== 'osc'
    const oscOn = busMode === 'osc' || busMode === 'both'
    if (mode === 1) {
      const wave = useLocal ? audioBus.waveformBytes() : null
      if (wave && wave.length) {
        // Box-average down to W columns (anti-aliased decimation).
        const n = wave.length
        for (let i = 0; i < W; i++) {
          const a = Math.floor((i * n) / W)
          const b = Math.max(a + 1, Math.floor(((i + 1) * n) / W))
          let s = 0
          for (let j = a; j < b; j++) s += wave[j]
          buf[i] = Math.round(s / (b - a))
        }
      } else if (oscOn) {
        // A wave rebuilt from the six OSC bands : one partial per band, its
        // amplitude that band's energy, each drifting on its own phase.
        const bands = [0, 1, 2, 3, 4, 5].map((b) => audioBus.feature('band', b))
        let tot = 0
        for (let b = 0; b < 6; b++) {
          tot += bands[b]
          this.oscPh[b] = (this.oscPh[b] + dt * (1.1 + 0.7 * b)) % (Math.PI * 2)
        }
        const norm = 0.9 / Math.max(1, tot)
        for (let i = 0; i < W; i++) {
          const x = i / W
          let s = 0
          for (let b = 0; b < 6; b++) s += bands[b] * Math.sin(Math.PI * 2 * OSC_CYCLES[b] * x + this.oscPh[b])
          buf[i] = Math.max(0, Math.min(255, Math.round(128 + 127 * s * norm)))
        }
      } else {
        for (let i = 0; i < W; i++) {
          const v = 0.5 + 0.35 * Math.sin((i / W) * 40 + this.tSig * 2)
          buf[i] = Math.max(0, Math.min(255, Math.round(v * 255)))
        }
      }
      return
    }
    const spec = useLocal ? audioBus.spectrumBytes() : null
    if (spec && spec.length) {
      // Log axis 30 Hz..16 kHz, each column the LOUDEST bin it covers (a linear
      // read put everything musical in the left fifth and skipped bins).
      const n = spec.length
      const nyq = audioBus.sampleRateHz() / 2
      const ratio = F_HI / F_LO
      for (let i = 0; i < W; i++) {
        const f0 = F_LO * Math.pow(ratio, i / W)
        const f1 = F_LO * Math.pow(ratio, (i + 1) / W)
        const b0 = Math.min(n - 1, Math.floor((f0 / nyq) * n))
        const b1 = Math.min(n - 1, Math.max(b0, Math.floor((f1 / nyq) * n)))
        let m = 0
        for (let b = b0; b <= b1; b++) if (spec[b] > m) m = spec[b]
        buf[i] = m
      }
    } else if (oscOn) {
      // OSC carries six band energies, not a buffer : draw them as six steps.
      for (let i = 0; i < W; i++) {
        const b = Math.min(5, Math.floor((i / W) * 6))
        buf[i] = Math.round(Math.max(0, Math.min(1, audioBus.feature('band', b))) * 255)
      }
    } else {
      // No audio → a slow procedural test signal so the source is never blank.
      for (let i = 0; i < W; i++) {
        const x = i / W
        const v = Math.max(0, 0.6 * Math.exp(-x * 4) + 0.4 * Math.abs(Math.sin(x * 12 - this.tSig)))
        buf[i] = Math.max(0, Math.min(255, Math.round(v * 255)))
      }
    }
  }

  /** `clockSec` is the layer clock (Speed / freeze apply); without it the wall
   *  clock drives the seams, the test signal and the spectrogram scroll. */
  render(targetFbo: WebGLFramebuffer, clockSec?: number): void {
    const gl = this.gl
    // Lost context (a GPU reset in progress) : nothing can be created or drawn;
    // the engine is rebuilt on restore.
    if (this.disposed || gl.isContextLost()) return
    if (this.t0 === 0) this.t0 = performance.now()
    const clock = typeof clockSec === 'number' ? clockSec : (performance.now() - this.t0) / 1000
    const dt = this.lastClock === null ? 0 : Math.max(0, Math.min(0.25, clock - this.lastClock))
    this.lastClock = clock
    this.tSig = (this.tSig + dt) % (Math.PI * 2000)

    const mode = Math.max(0, Math.min(3, Math.round(this.num('mode', 0))))
    const gain = this.num('gain', 1)
    const scale = Math.max(0, Math.min(1, this.num('scale', 0.4)))
    const scan = Math.max(0, Math.min(1, this.num('scan', 0.3)))
    const mono = this.num('mono', 1) >= 0.5 ? 1 : 0
    const c = this.inputs.color
    const col = Array.isArray(c) ? c : [0.6, 0.85, 1]
    // Raster seams : scan 0.3 = the original 0.7 seams per second.
    this.seam = (this.seam + dt * 0.7 * (scan / 0.3)) % 1

    this.fillBuffer(mode, dt)
    if (mode === 1) {
      // The waveform's envelope : min / max over the columns the trace can
      // reach (the same reach the shader's polyline uses).
      const hw = Math.max(0.012 + 0.03 * scale, 1.5 / this.h)
      const cw = this.w / this.h / AUDIO_W
      const R = Math.min(24, Math.ceil(hw / cw) + 1)
      const b = this.buf
      for (let i = 0; i < AUDIO_W; i++) {
        let lo = 255
        let hi = 0
        for (let j = Math.max(0, i - R); j <= Math.min(AUDIO_W - 1, i + R); j++) {
          const v = b[j]
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
        b[AUDIO_W * 2 + i] = lo
        b[AUDIO_W * 3 + i] = hi
      }
    }
    const prog = (k: ProgKey): Prog => {
      let p = this.progs.get(k)
      if (!p) this.progs.set(k, (p = paramProg(gl, k)))
      return p
    }
    gl.bindVertexArray(this.vao)
    gl.disable(gl.BLEND)

    if (mode === 3) {
      if (!this.hist) this.hist = [this.makeTarget(), this.makeTarget()]
      // Whole rows by TIME : 60..240 rows/s at 1080p (scaled with the height),
      // the fraction carried to the next frame.
      this.rowAcc += dt * 60 * (1 + 3 * scan) * (this.h / 1080)
      const rows = Math.min(this.h, Math.floor(this.rowAcc))
      this.rowAcc -= Math.floor(this.rowAcc)
      if (rows > 0) {
        gl.bindTexture(gl.TEXTURE_2D, this.audioTex)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false) // the ISF runtime leaves it on : rows would swap
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, AUDIO_W, 2, gl.RED, gl.UNSIGNED_BYTE, this.buf)
        this.buf.copyWithin(AUDIO_W, 0, AUDIO_W) // this spectrum is the next write's "previous"
        const prev = this.hist[this.histIdx]
        const next = this.hist[this.histIdx ^ 1]
        const g = prog('spec')
        gl.useProgram(g.prog)
        gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo)
        gl.viewport(0, 0, this.w, this.h)
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.audioTex); gl.uniform1i(g.u.uAudio, 0)
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.tex); gl.uniform1i(g.u.uHist, 1)
        gl.uniform1i(g.u.uRows, rows)
        gl.uniform2f(g.u.uRes, this.w, this.h)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        this.histIdx ^= 1
      }
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.audioTex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      if (mode === 1) {
        // Rows 0, 2, 3 : this frame + the envelope (row 1 keeps the spectrogram's).
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, AUDIO_W, 1, gl.RED, gl.UNSIGNED_BYTE, this.buf)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 2, AUDIO_W, 2, gl.RED, gl.UNSIGNED_BYTE, this.buf.subarray(AUDIO_W * 2))
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, AUDIO_W, 1, gl.RED, gl.UNSIGNED_BYTE, this.buf)
      }
    }

    const g = prog(MODE_KEY[mode])
    gl.useProgram(g.prog)
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.audioTex); gl.uniform1i(g.u.uAudio, 0)
    if (mode === 3 && this.hist) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.hist[this.histIdx].tex); gl.uniform1i(g.u.uHist, 1)
    }
    gl.uniform1f(g.u.uGain, gain)
    gl.uniform1f(g.u.uScale, scale)
    gl.uniform1f(g.u.uSeam, this.seam)
    gl.uniform1f(g.u.uMono, mono)
    gl.uniform3f(g.u.uColor, col[0] ?? 0.6, col[1] ?? 0.85, col[2] ?? 1)
    gl.uniform2f(g.u.uRes, this.w, this.h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    // The quad dies inside our own VAO, never the default one (deleting a
    // buffer the default VAO's attribute 0 points at freezes every ISF draw).
    gl.bindVertexArray(this.vao)
    gl.deleteBuffer(this.quad)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(this.vao)
    gl.deleteTexture(this.audioTex)
    if (this.hist) for (const t of this.hist) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex) }
    this.hist = null
  }
}
