// ParametricSource : the "Parametric" diegesis generator: a
// literal audio-buffer → texture reading. Reads the local
// audio bus's spectrum / waveform each frame, uploads it to a 1-D texture, and
// renders it as a hard raster, a waveform trace, spectrum bars, or a scrolling
// spectrogram. Native node (no ISF compile) : a TS class the layer owns like
// TextSource. With no local audio it synthesises a procedural signal so it's
// never blank. Raster/spectrogram stay abstract + monochrome-friendly (on-brand,
// NOT oscilloscope/Lissajous : a raster/waveform/spectrogram, per the shelf).

import { audioBus } from './audioIn'

const AUDIO_W = 256 // 1-D audio texture width

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

// Pattern shader: mode 0 raster · 1 waveform · 2 bars · 3 (spectrogram handled
// by the history pass). Samples the 1-D audio texture uAudio.
const FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag;
uniform sampler2D uAudio; uniform sampler2D uHist;
uniform int uMode; uniform float uGain, uScale, uTime, uMono; uniform vec3 uColor;
uniform vec2 uRes;
float aud(float x){ return texture(uAudio, vec2(clamp(x,0.0,1.0), 0.5)).r; }
void main(){
  vec2 uv = vUV;
  float v = 0.0;
  if (uMode == 3) {
    frag = vec4(texture(uHist, uv).rgb, 1.0); return; // spectrogram: show history
  } else if (uMode == 0) {
    // Raster / test-pattern: hard vertical bars gated by the spectrum, plus a
    // scanning horizontal seam : pure black/white cells.
    float m = aud(uv.x) * uGain;
    float cell = step(0.5, fract(uv.x * mix(24.0, 96.0, uScale)));
    float bar = step(1.0 - m, cell);
    float scan = step(0.985, fract(uv.y * 40.0 - uTime * 0.7));
    v = max(bar, scan * step(0.2, m));
  } else if (uMode == 1) {
    // Waveform trace: |uv.y - centre| under the sample amplitude.
    float w = (aud(uv.x) - 0.5) * 2.0 * uGain;        // −1..1 (time byte centred at 128)
    float d = abs((uv.y - 0.5) - w * 0.45);
    v = smoothstep(0.012 + 0.03 * uScale, 0.0, d);
  } else {
    // Spectrum bars: magnitude as bar height from the bottom.
    float m = aud(uv.x) * uGain;
    v = step(uv.y, m);
  }
  vec3 col = mix(uColor, vec3(1.0), uMono) * v;
  frag = vec4(col, 1.0);
}`

// History advance for the spectrogram: scroll the previous frame up by one row
// and write the current spectrum (colorised) along the new bottom row.
const SPEC_FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag;
uniform sampler2D uAudio; uniform sampler2D uHist;
uniform float uGain, uMono, uScan; uniform vec3 uColor; uniform vec2 uRes;
float aud(float x){ return texture(uAudio, vec2(clamp(x,0.0,1.0), 0.5)).r; }
void main(){
  float rows = mix(1.0, 4.0, uScan) / uRes.y; // scroll speed (rows/frame)
  if (vUV.y > 1.0 - rows) {
    float m = clamp(aud(vUV.x) * uGain, 0.0, 1.0);
    frag = vec4(mix(uColor, vec3(1.0), uMono) * m, 1.0);
  } else {
    frag = vec4(texture(uHist, vUV + vec2(0.0, rows)).rgb, 1.0);
  }
}`

interface Target {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
}

export class ParametricSource {
  private prog: WebGLProgram
  private specProg: WebGLProgram
  private quad: WebGLBuffer
  private audioTex: WebGLTexture
  private hist: [Target, Target]
  private histIdx = 0
  private buf = new Uint8Array(AUDIO_W)
  private inputs: Record<string, number | number[]> = {}
  private u: (p: WebGLProgram, n: string) => WebGLUniformLocation | null
  private t0 = 0

  constructor(private gl: WebGL2RenderingContext, private w: number, private h: number) {
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[parametric]', gl.getShaderInfoLog(s))
      return s
    }
    const link = (fs: string): WebGLProgram => {
      const p = gl.createProgram()!
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VS))
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
      gl.bindAttribLocation(p, 0, 'p')
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('[parametric] link', gl.getProgramInfoLog(p))
      return p
    }
    this.prog = link(FS)
    this.specProg = link(SPEC_FS)
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

    this.audioTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, AUDIO_W, 1, 0, gl.RED, gl.UNSIGNED_BYTE, this.buf)

    this.hist = [this.makeTarget(), this.makeTarget()]
    const cache = new Map<string, WebGLUniformLocation | null>()
    this.u = (p, n) => {
      const k = (p === this.prog ? 'a' : 'b') + n
      if (!cache.has(k)) cache.set(k, gl.getUniformLocation(p, n))
      return cache.get(k)!
    }
  }

  private makeTarget(): Target {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
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
    return typeof v === 'number' ? v : d
  }

  // Fill `buf` from the audio bus (spectrum for bars/raster/spectrogram, waveform
  // for the trace); synthesise a procedural signal when local audio is absent.
  private fillBuffer(mode: number, tSec: number): void {
    const src = mode === 1 ? audioBus.waveformBytes() : audioBus.spectrumBytes()
    if (src && src.length) {
      for (let i = 0; i < AUDIO_W; i++) this.buf[i] = src[Math.floor((i / AUDIO_W) * src.length)] ?? 0
    } else {
      // No audio → a slow procedural test signal so the source is never blank.
      for (let i = 0; i < AUDIO_W; i++) {
        const x = i / AUDIO_W
        const v =
          mode === 1
            ? 0.5 + 0.35 * Math.sin(x * 40 + tSec * 2)
            : Math.max(0, 0.6 * Math.exp(-x * 4) + 0.4 * Math.abs(Math.sin(x * 12 - tSec)))
        this.buf[i] = Math.max(0, Math.min(255, Math.round(v * 255)))
      }
    }
  }

  render(targetFbo: WebGLFramebuffer): void {
    const gl = this.gl
    if (this.t0 === 0) this.t0 = performance.now()
    const tSec = (performance.now() - this.t0) / 1000
    const mode = Math.round(this.num('mode', 0))
    this.fillBuffer(mode, tSec)

    gl.bindTexture(gl.TEXTURE_2D, this.audioTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, AUDIO_W, 1, gl.RED, gl.UNSIGNED_BYTE, this.buf)

    const gain = this.num('gain', 1)
    const scale = this.num('scale', 0.4)
    const mono = this.num('mono', 1) >= 0.5 ? 1 : 0
    const c = this.inputs.color
    const col = Array.isArray(c) ? c : [0.6, 0.85, 1]
    const scan = this.num('scan', 0.3)

    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.disable(gl.BLEND)

    if (mode === 3) {
      // Advance the spectrogram history (ping-pong), then present it.
      const prev = this.hist[this.histIdx]
      const next = this.hist[this.histIdx ^ 1]
      gl.useProgram(this.specProg)
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.audioTex); gl.uniform1i(this.u(this.specProg, 'uAudio'), 0)
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.tex); gl.uniform1i(this.u(this.specProg, 'uHist'), 1)
      gl.uniform1f(this.u(this.specProg, 'uGain'), gain)
      gl.uniform1f(this.u(this.specProg, 'uMono'), mono)
      gl.uniform1f(this.u(this.specProg, 'uScan'), scan)
      gl.uniform3f(this.u(this.specProg, 'uColor'), col[0], col[1], col[2])
      gl.uniform2f(this.u(this.specProg, 'uRes'), this.w, this.h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      this.histIdx ^= 1
      this.blit(next.tex, targetFbo)
      return
    }

    gl.useProgram(this.prog)
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.audioTex); gl.uniform1i(this.u(this.prog, 'uAudio'), 0)
    gl.uniform1i(this.u(this.prog, 'uMode'), mode)
    gl.uniform1f(this.u(this.prog, 'uGain'), gain)
    gl.uniform1f(this.u(this.prog, 'uScale'), scale)
    gl.uniform1f(this.u(this.prog, 'uTime'), tSec)
    gl.uniform1f(this.u(this.prog, 'uMono'), mono)
    gl.uniform3f(this.u(this.prog, 'uColor'), col[0], col[1], col[2])
    gl.uniform2f(this.u(this.prog, 'uRes'), this.w, this.h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  // Copy a texture into the target FBO with the pattern program (uMode 3 = show).
  private blit(tex: WebGLTexture, targetFbo: WebGLFramebuffer): void {
    const gl = this.gl
    gl.useProgram(this.prog)
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(this.u(this.prog, 'uHist'), 1)
    gl.uniform1i(this.u(this.prog, 'uMode'), 3)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteProgram(this.prog)
    gl.deleteProgram(this.specProg)
    gl.deleteBuffer(this.quad)
    gl.deleteTexture(this.audioTex)
    for (const t of this.hist) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex) }
  }
}
