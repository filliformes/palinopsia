// AudioSource : the Import Audio source. A sound file plays in the layer like a
// film does (play, loop, the in / out trim, speed, the playhead scrubbed or
// modulated) and the layer shows its waveform : the whole file, the loop, or a
// window scrolling past the playhead, filled, outlined or as bars, the part
// already played lit, the rest dimmed.
//
// The sound plays through its own <audio> element, to Sonify's output device.
// Speed is tape-like (the pitch moves with it) unless `keep pitch` is on. The
// waveform comes from the file's analysis (audioAnalysis.ts in main : its
// min / max 400 times a second), kept as a pyramid in one RG8 texture, each
// level an eighth of the one below, so a column covering an hour and a column
// covering 10 ms both read a handful of texels.
//
// GL hygiene : its own VAO (never the default one the ISF runtime wires); the
// program is per context and rebuilt after a GPU reset (glGeneration).

import { clipAudio, type ClipAnalysis } from './clipAudio'
import { glGeneration } from './glGeneration'
import { ClipPlayer, type ClipPlayback } from './clipPlayer'

export type AudioPlayback = ClipPlayback

const TEX_W = 4096
const MAX_LEVELS = 8

const VS = `#version 300 es
layout(location = 0) in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const FS = `#version 300 es
precision highp float; precision highp int;
in vec2 vUV; out vec4 frag;
uniform sampler2D uPeaks;
uniform int uLevels;
uniform int uRowOff[${MAX_LEVELS}];
uniform int uCount[${MAX_LEVELS}];
uniform float uRate;          // level-0 buckets a second
uniform float uT0, uT1;       // the frame's left and right edges, seconds
uniform float uPlay;          // the playhead, seconds
uniform float uLo, uHi;       // the loop (in / out), seconds
uniform float uAmp, uDim, uHead, uReady;
uniform int uStyle;           // 0 filled, 1 outline, 2 bars
uniform vec4 uColor, uGround;
uniform vec2 uRes;

vec2 peakAt(int L, int i){
  vec2 v = texelFetch(uPeaks, ivec2(i % ${TEX_W}, uRowOff[L] + i / ${TEX_W}), 0).rg;
  return (v * 255.0 - 128.0) / 127.0;
}
// min / max of the sound over [ta, tb) : the coarsest level that still gives a
// few texels for the span, at most 8 reads.
vec2 span(float ta, float tb){
  float n0 = ta * uRate, n1 = tb * uRate;
  float f = 1.0; int L = 0;
  for (int k = 0; k < ${MAX_LEVELS - 1}; k++) {
    if (L + 1 < uLevels && (n1 - n0) / f > 6.0) { L++; f *= 8.0; }
  }
  int i0 = int(floor(n0 / f)), i1 = max(i0 + 1, int(ceil(n1 / f)));
  float mn = 1.0, mx = -1.0;
  for (int k = 0; k < 8; k++) {
    int j = i0 + k;
    if (j >= i1) break;
    if (j < 0 || j >= uCount[L]) continue;
    vec2 p = peakAt(L, j);
    mn = min(mn, p.x); mx = max(mx, p.y);
  }
  return mx < mn ? vec2(0.0) : vec2(mn, mx);
}
void main(){
  float px = 1.0 / uRes.x, py = 2.0 / uRes.y;   // a pixel, across and in -1..1 up
  float lw = max(1.0, uRes.y / 1080.0);          // line weight, scaled with the frame
  float dt = (uT1 - uT0) * px;                   // seconds a column
  float t = mix(uT0, uT1, vUV.x);
  float y = vUV.y * 2.0 - 1.0;
  float a = 0.0;
  if (uStyle == 2) {
    // bars : one every 6 px (at 1080p), the loudest of the sound it covers
    float bw = 6.0 * lw, col = floor(vUV.x * uRes.x / bw);
    float ta = uT0 + col * bw * dt, tb = ta + bw * dt;
    vec2 m = span(ta, tb) * uAmp * uReady;
    float h = max(max(abs(m.x), abs(m.y)), 1.5 * py * lw);
    float inBar = step(1.0 * lw, mod(vUV.x * uRes.x, bw));
    a = inBar * step(abs(y), h);
    t = ta;
  } else {
    vec2 m = span(t, t + dt) * uAmp * uReady;
    float lo = min(m.x, -0.75 * py * lw), hi = max(m.y, 0.75 * py * lw);
    if (uStyle == 0) a = step(lo, y) * step(y, hi);
    else {
      // the outline : each edge joined to its neighbours' (a jump between two
      // columns is a vertical run, not a gap : drawn alone it broke into dots)
      vec2 mL = span(t - dt, t) * uAmp * uReady, mR = span(t + dt, t + 2.0 * dt) * uAmp * uReady;
      float hL = max(mL.y, 0.75 * py * lw), hR = max(mR.y, 0.75 * py * lw);
      float lL = min(mL.x, -0.75 * py * lw), lR = min(mR.x, -0.75 * py * lw);
      float w = 0.9 * py * lw;
      float top = step(min(hi, 0.5 * (hi + min(hL, hR))) - w, y) * step(y, max(hi, 0.5 * (hi + max(hL, hR))) + w);
      float bot = step(min(lo, 0.5 * (lo + min(lL, lR))) - w, y) * step(y, max(lo, 0.5 * (lo + max(lL, lR))) + w);
      a = max(top, bot);
    }
  }
  // played : lit; still to come : dimmed; outside the loop : dimmer again
  float played = step(t, uPlay);
  float inLoop = step(uLo, t) * step(t, uHi);
  float k = mix(1.0 - uDim, 1.0, played) * mix(0.45, 1.0, inLoop);
  vec4 wave = vec4(uColor.rgb * k, uColor.a);
  vec4 col = mix(uGround, wave, a);
  // the playhead line (where it is inside the frame)
  float hp = abs(t - uPlay) / max(dt, 1e-9);
  float head = uHead * (1.0 - smoothstep(0.5 * lw, 1.5 * lw, hp)) * step(uT0, uPlay) * step(uPlay, uT1);
  col = mix(col, vec4(mix(uColor.rgb, vec3(1.0), 0.6), 1.0), head);
  frag = col;
}`

const UNIFORMS = ['uPeaks', 'uLevels', 'uRowOff', 'uCount', 'uRate', 'uT0', 'uT1', 'uPlay', 'uLo', 'uHi', 'uAmp', 'uDim', 'uHead', 'uReady', 'uStyle', 'uColor', 'uGround', 'uRes'] as const
interface Prog { prog: WebGLProgram; u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>; gen: number }
const progs = new WeakMap<WebGL2RenderingContext, Prog>()
function waveProg(gl: WebGL2RenderingContext): Prog {
  const have = progs.get(gl)
  if (have && have.gen === glGeneration()) return have
  const compile = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[audio source]', gl.getShaderInfoLog(s))
    return s
  }
  const prog = gl.createProgram()!
  const v = compile(gl.VERTEX_SHADER, VS), f = compile(gl.FRAGMENT_SHADER, FS)
  gl.attachShader(prog, v)
  gl.attachShader(prog, f)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error('[audio source] link', gl.getProgramInfoLog(prog))
  gl.deleteShader(v)
  gl.deleteShader(f)
  const u = {} as Prog['u']
  for (const n of UNIFORMS) u[n] = gl.getUniformLocation(prog, n)
  const p = { prog, u, gen: glGeneration() }
  progs.set(gl, p)
  return p
}

const num = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const col = (v: number | number[] | undefined, d: number[]): number[] => (Array.isArray(v) && v.length >= 3 ? [v[0], v[1], v[2], v[3] ?? 1] : d)

export class AudioSource {
  private player = new ClipPlayer(true)
  private vao: WebGLVertexArrayObject
  private quad: WebGLBuffer
  private peakTex: WebGLTexture | null = null
  private peakFor: ClipAnalysis | null = null
  private levels = 0
  private rowOff = new Int32Array(MAX_LEVELS)
  private count = new Int32Array(MAX_LEVELS)
  private path = ''
  private disposed = false
  private inputs: Record<string, number | number[]> = {}
  private muted = false
  private gain = 1 // this frame's scale on the volume (a relay morph's hand-over : setGain)

  constructor(private gl: WebGL2RenderingContext, private w: number, private h: number) {
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
  }

  /** The element (the tests read it). */
  get audio(): HTMLAudioElement {
    return this.player.audio
  }

  /** `url` : what the element plays (opsia-media://…); `path` : the file on disk
   *  (its analysis, its waveform); `at` : where it starts (seconds). */
  load(url: string, path: string, at = 0): void {
    this.path = path
    this.player.load(url, path, at)
  }

  setPlayback(p: AudioPlayback): void {
    this.player.setPlayback(p)
  }
  setPosMod(v: number): void {
    this.player.setPosMod(v)
  }
  setSpeedMod(v: number): void {
    this.player.setSpeedMod(v)
  }
  /** The loop's in / out under modulation (the video's names). */
  setMod(name: string, v: number): void {
    this.player.setMod(name, v)
  }
  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
  }
  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
  }
  /** The layer muted, or another one soloed : silent (it keeps its place). */
  setMuted(m: boolean): void {
    this.muted = m
  }
  setGain(g: number): void {
    this.gain = Math.max(0, Math.min(1, g))
  }

  duration(): number {
    return this.player.duration()
  }
  time(): number {
    return this.player.time()
  }
  /** The file on disk (the modulators read its sound at the playhead). */
  file(): string {
    return this.path
  }

  /** The transport, once a frame : `mul` is the layer's speed × the global one. */
  tick(_rawDt: number, mul: number): void {
    this.player.setVolume(num(this.inputs.volume, 0.8) * this.gain, this.muted)
    this.player.setKeepPitch(num(this.inputs.keepPitch, 0) > 0.5)
    this.player.tick(mul)
  }

  /** The waveform into the slot's target. */
  render(fbo: WebGLFramebuffer): void {
    const gl = this.gl
    // a GPU reset in progress : nothing can be drawn (the engine rebuilds it)
    if (this.disposed || gl.isContextLost()) return
    const an = this.path ? clipAudio.get(this.path) : null
    if (an && an !== this.peakFor) this.buildPeaks(an)
    const p = waveProg(gl)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.disable(gl.BLEND)
    gl.useProgram(p.prog)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.peakTex)
    gl.uniform1i(p.u.uPeaks, 0)
    const d = this.duration() || an?.duration || 1
    const pb = this.player.playback()
    const inN = pb.inN, outN = pb.outN
    const lo = Math.min(inN, outN) * d, hi = Math.max(inN, outN) * d
    const view = Math.round(num(this.inputs.view, 0))
    const win = Math.max(0.05, num(this.inputs.window, 4))
    const play = this.player.time()
    let t0 = 0, t1 = d
    if (view === 1) { t0 = lo; t1 = Math.max(lo + 0.05, hi) }
    else if (view === 2) { t0 = play - win / 2; t1 = play + win / 2 }
    gl.uniform1i(p.u.uLevels, this.peakTex ? this.levels : 0)
    gl.uniform1iv(p.u.uRowOff, this.rowOff)
    gl.uniform1iv(p.u.uCount, this.count)
    gl.uniform1f(p.u.uRate, an?.peakRate ?? 400)
    gl.uniform1f(p.u.uT0, t0)
    gl.uniform1f(p.u.uT1, t1)
    gl.uniform1f(p.u.uPlay, play)
    gl.uniform1f(p.u.uLo, lo)
    gl.uniform1f(p.u.uHi, hi)
    gl.uniform1f(p.u.uAmp, num(this.inputs.amp, 1))
    gl.uniform1f(p.u.uDim, Math.max(0, Math.min(1, num(this.inputs.dim, 0.55))))
    gl.uniform1f(p.u.uHead, num(this.inputs.playhead, 1) > 0.5 ? 1 : 0)
    gl.uniform1f(p.u.uReady, this.peakTex ? 1 : 0)
    gl.uniform1i(p.u.uStyle, Math.round(num(this.inputs.style, 0)))
    const c = col(this.inputs.color, [0.95, 0.75, 0.35, 1]), g = col(this.inputs.ground, [0, 0, 0, 1])
    gl.uniform4f(p.u.uColor, c[0], c[1], c[2], c[3])
    gl.uniform4f(p.u.uGround, g[0], g[1], g[2], g[3])
    gl.uniform2f(p.u.uRes, this.w, this.h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  /** The analysis's min / max as a pyramid in one RG8 texture (level 0 at the
   *  top, each next level an eighth as long, packed TEX_W wide). */
  private buildPeaks(an: ClipAnalysis): void {
    const gl = this.gl
    this.peakFor = an
    const lv: Uint8Array[] = []
    let n = an.peakCount
    let cur = new Uint8Array(n * 2)
    for (let i = 0; i < n * 2; i++) cur[i] = an.peaks[i] + 128
    lv.push(cur)
    while (n > 64 && lv.length < MAX_LEVELS) {
      const m = Math.ceil(n / 8)
      const next = new Uint8Array(m * 2)
      for (let j = 0; j < m; j++) {
        let mn = 255, mx = 0
        for (let k = j * 8; k < Math.min(n, j * 8 + 8); k++) { mn = Math.min(mn, cur[k * 2]); mx = Math.max(mx, cur[k * 2 + 1]) }
        next[j * 2] = mn; next[j * 2 + 1] = mx
      }
      lv.push(next)
      cur = next
      n = m
    }
    let rows = 0
    this.rowOff.fill(0)
    this.count.fill(0)
    lv.forEach((l, i) => { this.rowOff[i] = rows; this.count[i] = l.length / 2; rows += Math.max(1, Math.ceil(l.length / 2 / TEX_W)) })
    const data = new Uint8Array(TEX_W * rows * 2)
    lv.forEach((l, i) => data.set(l, this.rowOff[i] * TEX_W * 2))
    this.levels = lv.length
    if (!this.peakTex) this.peakTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.peakTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, TEX_W, rows, 0, gl.RG, gl.UNSIGNED_BYTE, data)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.player.dispose()
    const gl = this.gl
    if (this.peakTex) gl.deleteTexture(this.peakTex)
    // The quad dies inside our own VAO, never the default one (deleting a buffer
    // the default VAO's attribute 0 points at freezes every ISF draw).
    gl.bindVertexArray(this.vao)
    gl.deleteBuffer(this.quad)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(this.vao)
    this.peakTex = null
  }
}
