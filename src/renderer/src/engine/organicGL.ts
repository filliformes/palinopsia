// Shared GL plumbing for the native organic engines (Reaction, Fluid, Slime
// Mould, Mycelium, Veins : engine/nativeGenerators.ts). Each engine keeps its
// state in float textures at its OWN grid size (set by its scale knob, tied to
// the frame HEIGHT so 1080p, 4K and the 4096² dome show the same pattern) and
// steps it on a fixed clock, so it runs the same at any frame rate.
//
// - Programs get the organic toolkit (lib/organic.glsl : hashes, noise, cells,
//   blackbody) and, after the engine's `og_height`, the relief light
//   (lib/organicRelief.glsl), so a native engine is lit exactly like the ISF
//   organic sources.
// - Every engine draws with its OWN vertex array : never the default one, which
//   the ISF runtime owns (the shared default-VAO trap froze the whole app once).

import organicLib from '../shaders/isf/lib/organic.glsl?raw'
import organicRelief from '../shaders/isf/lib/organicRelief.glsl?raw'

export const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

/** Fragment prelude : ES 3.00, the organic toolkit, and RENDERSIZE (the target
 *  size the relief light reads). */
export const FS_HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec2 RENDERSIZE;
${organicLib}
`

/** The relief light : place after the shader defines `float og_height(vec2 uv)`.
 *  #define OG_RELIEF_E / OG_SHADOW_STEPS / OG_SHADOW_HEIGHT before it to tune. */
export const RELIEF = organicRelief

export interface Target {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
}

export class Prog {
  readonly p: WebGLProgram
  private locs = new Map<string, WebGLUniformLocation | null>()
  ok = true
  constructor(private gl: WebGL2RenderingContext, fs: string, label: string, vs = VS) {
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(`[${label}] compile:`, gl.getShaderInfoLog(s))
        this.ok = false
      }
      return s
    }
    const v = compile(gl.VERTEX_SHADER, vs)
    const f = compile(gl.FRAGMENT_SHADER, fs)
    const p = gl.createProgram()!
    gl.attachShader(p, v)
    gl.attachShader(p, f)
    gl.bindAttribLocation(p, 0, 'p')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(`[${label}] link:`, gl.getProgramInfoLog(p))
      this.ok = false
    }
    gl.deleteShader(v)
    gl.deleteShader(f)
    this.p = p
  }
  u(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name)
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.p, name)
      this.locs.set(name, l)
    }
    return l
  }
  use(): this {
    this.gl.useProgram(this.p)
    return this
  }
  f1(n: string, a: number): this { this.gl.uniform1f(this.u(n), a); return this }
  f2(n: string, a: number, b: number): this { this.gl.uniform2f(this.u(n), a, b); return this }
  f3(n: string, a: number, b: number, c: number): this { this.gl.uniform3f(this.u(n), a, b, c); return this }
  f4(n: string, a: number, b: number, c: number, d: number): this { this.gl.uniform4f(this.u(n), a, b, c, d); return this }
  i1(n: string, a: number): this { this.gl.uniform1i(this.u(n), a); return this }
  i2(n: string, a: number, b: number): this { this.gl.uniform2i(this.u(n), a, b); return this }
  dispose(): void { this.gl.deleteProgram(this.p) }
}

/** Fullscreen triangle on its own VAO, float targets, and the bookkeeping to
 *  free them all. */
export class EngineGL {
  readonly vao: WebGLVertexArrayObject
  private quad: WebGLBuffer
  private progs: Prog[] = []
  constructor(readonly gl: WebGL2RenderingContext, readonly label: string) {
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
  }

  prog(fs: string, vs?: string): Prog {
    const p = new Prog(this.gl, fs, this.label, vs)
    this.progs.push(p)
    return p
  }

  get ok(): boolean {
    return this.progs.every((p) => p.ok)
  }

  /** A float (RGBA32F), half-float (R16F / RGBA16F) or 8-bit target. `linear`
   *  filtering on 32F needs OES_texture_float_linear : state targets stay NEAREST
   *  (read with texelFetch); a half-float display copy is the filtered one. */
  target(w: number, h: number, opts: { float?: boolean; half?: 'r' | 'rgba'; linear?: boolean; repeat?: boolean } = {}): Target {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    // Half floats filter in hardware (no extension) : the display copies engines
    // sample with texture(), bilinear and wrapped, one fetch instead of four.
    if (opts.half === 'r') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, null)
    else if (opts.half === 'rgba') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else if (opts.float !== false) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const f = opts.linear ? gl.LINEAR : gl.NEAREST
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f)
    const wr = opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr)
    gl.bindTexture(gl.TEXTURE_2D, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex, fbo, w, h }
  }

  freeTarget(t: Target | null | undefined): void {
    if (!t) return
    this.gl.deleteFramebuffer(t.fbo)
    this.gl.deleteTexture(t.tex)
  }

  bind(unit: number, tex: WebGLTexture | null): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
  }

  /** Draw `prog` (already in use, uniforms set) into `fbo` at w×h. */
  draw(fbo: WebGLFramebuffer | null, w: number, h: number): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.viewport(0, 0, w, h)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Leave the GL state the way the ISF runtime expects it. */
  done(units = 4): void {
    const gl = this.gl
    for (let i = units - 1; i >= 0; i--) {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    const gl = this.gl
    for (const p of this.progs) p.dispose()
    this.progs = []
    gl.bindVertexArray(this.vao)
    gl.deleteBuffer(this.quad)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(this.vao)
  }
}

/** The slot clock : seconds since the last frame from the layer clock (Speed,
 *  freeze and reverse applied upstream), clamped so a stall or a seek never
 *  fires a burst of steps. 0 while frozen. */
export class SlotClock {
  private last = -1
  tick(clockSec: number): number {
    const now = Number.isFinite(clockSec) ? clockSec : performance.now() / 1000
    const dt = this.last < 0 ? 1 / 60 : Math.max(0, Math.min(0.1, now - this.last))
    this.last = now
    return dt
  }
}

/** Grid for a pattern whose cell is `cellPx` output pixels at 1080p : the grid
 *  follows the frame HEIGHT (1080 rows reference), so the pattern keeps its size
 *  in the frame at any resolution, and the frame's aspect. Rows snap to 4. */
export function gridFor(w: number, h: number, cellPx: number, minRows = 64, maxRows = 1080): [number, number] {
  const rows = Math.max(minRows, Math.min(maxRows, Math.round(1080 / Math.max(0.25, cellPx) / 4) * 4))
  const cols = Math.max(4, Math.round((rows * w) / Math.max(1, h)))
  return [cols, rows]
}

/** Numbers-only view of a slot's inputs (colours stay arrays). */
export function num(inputs: Record<string, number | number[]>, k: string, d: number): number {
  const v = inputs[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}
export function col(inputs: Record<string, number | number[]>, k: string, d: [number, number, number]): [number, number, number] {
  const v = inputs[k]
  return Array.isArray(v) && v.length >= 3 ? [v[0], v[1], v[2]] : d
}

/** Rising edge of an event input (an ISF `event` arrives as 0 / 1). */
export class Edge {
  private prev = 0
  fired(v: number): boolean {
    const f = v > 0.5 && this.prev <= 0.5
    this.prev = v
    return f
  }
}
