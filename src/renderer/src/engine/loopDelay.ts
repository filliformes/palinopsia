// loopDelay.ts : a layer's loop that comes back after a delay.
//
// Without a delay the Loop rack and the loop blend read the layer's last frame.
// With one, they read the frame from `delay` ago : a ring of past frames, stored
// small (about half the layer's size, inside a 64 MB budget), each with the
// time it was taken, read back into one full-size 8-bit target (a 4096 dome
// layer : about 130 MB in all). A slot is written
// every delay / 30 seconds, so the ring always spans the delay at any length
// up to LOOP_DELAY_MAX_MS; the two slots around "now - delay" are crossfaded,
// so a long delay does not step. Each echo comes back through the small ring,
// so it softens a little on every pass : a tape echo, not a mirror.
//
// The clock is the global one (the layer's own Speed leaves it alone, so an
// echo set in beats stays on the beat); a frozen picture freezes its echoes.

import { glGeneration } from './glGeneration'

export const LOOP_DELAY_MAX_MS = 4000
const SLOTS = 32
const BUDGET = 64 * 1024 * 1024 // bytes, per layer

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`
const COPY_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src;
void main(){ o = clamp(texture(src, uv), 0.0, 1.0); }`
const READ_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 uv; out vec4 o;
uniform sampler2DArray ring;
uniform float la, lb, k;
void main(){ o = mix(texture(ring, vec3(uv, la)), texture(ring, vec3(uv, lb)), k); }`

interface Progs {
  gen: number // the GL generation it was built in (a GPU reset kills programs)
  copy: WebGLProgram
  uSrc: WebGLUniformLocation | null
  read: WebGLProgram
  uRing: WebGLUniformLocation | null
  uLa: WebGLUniformLocation | null
  uLb: WebGLUniformLocation | null
  uK: WebGLUniformLocation | null
}
const progsByGl = new WeakMap<WebGL2RenderingContext, Progs>()

function compile(gl: WebGL2RenderingContext, fs: string): WebGLProgram {
  const mk = (t: number, s: string): WebGLShader => {
    const sh = gl.createShader(t)!
    gl.shaderSource(sh, s)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('[loopDelay] ' + (gl.getShaderInfoLog(sh) || 'shader'))
    return sh
  }
  const p = gl.createProgram()!
  gl.attachShader(p, mk(gl.VERTEX_SHADER, VS))
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
  gl.bindAttribLocation(p, 0, 'p')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[loopDelay] ' + (gl.getProgramInfoLog(p) || 'link'))
  return p
}

function progs(gl: WebGL2RenderingContext): Progs {
  let p = progsByGl.get(gl)
  if (!p || p.gen !== glGeneration()) {
    const copy = compile(gl, COPY_FS)
    const read = compile(gl, READ_FS)
    p = {
      gen: glGeneration(),
      copy,
      uSrc: gl.getUniformLocation(copy, 'src'),
      read,
      uRing: gl.getUniformLocation(read, 'ring'),
      uLa: gl.getUniformLocation(read, 'la'),
      uLb: gl.getUniformLocation(read, 'lb'),
      uK: gl.getUniformLocation(read, 'k')
    }
    progsByGl.set(gl, p)
  }
  return p
}

export class LoopDelayRing {
  private ring: WebGLTexture
  private fbos: WebGLFramebuffer[] = []
  private outTex: WebGLTexture
  private outFbo: WebGLFramebuffer
  readonly rw: number
  readonly rh: number
  private times = new Float64Array(SLOTS).fill(-Infinity)
  private head = 0
  private filled = 0
  private clock = 0
  private lastWrite = -Infinity
  /** Seconds the ring has gone unused (freed by the owner after a while). */
  idle = 0

  constructor(private gl: WebGL2RenderingContext, private vao: WebGLVertexArrayObject, readonly w: number, readonly h: number) {
    const scale = Math.min(0.5, Math.sqrt(BUDGET / (SLOTS * 4 * w * h)))
    this.rw = Math.max(16, Math.round(w * scale))
    this.rh = Math.max(16, Math.round(h * scale))
    this.ring = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.ring)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, this.rw, this.rh, SLOTS)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    for (let i = 0; i < SLOTS; i++) {
      const f = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, f)
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.ring, 0, i)
      this.fbos.push(f)
    }
    this.outTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.outTex)
    // (8-bit : the ring is, so half floats here held nothing more, at twice the size)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.outFbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outTex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    progs(gl)
  }

  /** Bytes it holds on the card (the resource HUD). */
  bytes(): number {
    return this.rw * this.rh * 4 * SLOTS + this.w * this.h * 4
  }

  /** Advance the clock by `dt`, then the picture `delaySec` ago into the ring's
   *  own full-size target : the two stored frames around that moment,
   *  crossfaded. null while nothing is stored yet. */
  read(dt: number, delaySec: number): WebGLTexture | null {
    this.clock += Math.max(0, dt)
    this.idle = 0
    if (this.filled === 0) return null
    const want = this.clock - delaySec
    let older = -1
    let newer = -1
    for (let i = 0; i < SLOTS; i++) {
      const t = this.times[i]
      if (t === -Infinity) continue
      if (t <= want && (older < 0 || t > this.times[older])) older = i
      if (t >= want && (newer < 0 || t < this.times[newer])) newer = i
    }
    // Before the history reaches that far back : the oldest there is
    if (older < 0) older = newer
    if (newer < 0) newer = older
    const span = this.times[newer] - this.times[older]
    const k = span > 1e-6 ? Math.min(1, Math.max(0, (want - this.times[older]) / span)) : 0
    const gl = this.gl
    const p = progs(gl)
    gl.bindVertexArray(this.vao)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.useProgram(p.read)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.ring)
    gl.uniform1i(p.uRing, 0)
    gl.uniform1f(p.uLa, older)
    gl.uniform1f(p.uLb, newer)
    gl.uniform1f(p.uK, k)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
    gl.bindVertexArray(null)
    return this.outTex
  }

  /** Store `src` (the layer's newest frame) when a slot is due. */
  write(src: WebGLTexture, delaySec: number): void {
    const interval = Math.max(0, delaySec / (SLOTS - 2))
    if (this.filled > 0 && this.clock - this.lastWrite < interval - 1e-4) return
    const gl = this.gl
    const p = progs(gl)
    gl.bindVertexArray(this.vao)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[this.head])
    gl.viewport(0, 0, this.rw, this.rh)
    gl.useProgram(p.copy)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.uniform1i(p.uSrc, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
    this.times[this.head] = this.clock
    this.head = (this.head + 1) % SLOTS
    this.filled = Math.min(SLOTS, this.filled + 1)
    this.lastWrite = this.clock
  }

  /** PANIC / a re-enable : forget the stored frames. */
  reset(): void {
    this.times.fill(-Infinity)
    this.head = 0
    this.filled = 0
    this.lastWrite = -Infinity
  }

  dispose(): void {
    const gl = this.gl
    for (const f of this.fbos) gl.deleteFramebuffer(f)
    gl.deleteFramebuffer(this.outFbo)
    gl.deleteTexture(this.ring)
    gl.deleteTexture(this.outTex)
    this.fbos = []
  }
}
