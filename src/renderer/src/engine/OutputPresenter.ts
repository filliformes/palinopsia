// OutputPresenter : the output window's WHOLE renderer, replacing the old
// second Compositor. The control window streams its finished RGBA8 frame each
// tick (via a zero-copy MessagePort); this uploads it to a texture and draws it
// to the output canvas through the SAME projection-warp as the compositor — so
// the projector shows the control window's pixels EXACTLY, not an independent
// re-render that diverges on every stochastic source (Collage, video, feedback).
//
// The warp shader, corner→vertex maths and UV orientation are the compositor's
// own (engine/warpQuad.ts) : the streamed buffer is a `readPixels` of the
// composite (GL bottom-up), which is precisely the orientation those UVs assume,
// so the result is pixel-for-pixel what the compositor presents.

import { IDENTITY_CORNERS, WARP_FS, WARP_SHARP_FS, WARP_VS, computeWarpVerts } from './warpQuad'

interface WarpProgram {
  prog: WebGLProgram
  uTex: WebGLUniformLocation
  uGrid: WebGLUniformLocation
  uFeather: WebGLUniformLocation
}

export class OutputPresenter {
  private gl: WebGL2RenderingContext
  private plain: WarpProgram
  private sharpProg: WarpProgram | null = null // made the first time Sharp enlargement is on
  private sharp = false
  private vao: WebGLVertexArrayObject
  private buf: WebGLBuffer
  private tex: WebGLTexture
  private feather = 0
  private vertsW = 0 // the drawn size the quad was built for (its margin is in pixels)
  private vertsH = 0
  private texW = 0
  private texH = 0
  private lastCorners: number[] = []
  private disposed = false

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' })
    if (!gl) throw new Error('WebGL2 unavailable for output presenter')
    this.gl = gl
    this.plain = this.build(WARP_FS)
    const prog = this.plain.prog
    const aPos = gl.getAttribLocation(prog, 'pos')
    const aUvq = gl.getAttribLocation(prog, 'uvq')
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, 30 * 4, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 20, 0)
    gl.enableVertexAttribArray(aUvq)
    gl.vertexAttribPointer(aUvq, 3, gl.FLOAT, false, 20, 8)
    gl.bindVertexArray(null)
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  private build(fs: string): WarpProgram {
    const gl = this.gl
    const mk = (t: number, src: string): WebGLShader => {
      const sh = gl.createShader(t)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(sh) || 'output shader')
      return sh
    }
    const prog = gl.createProgram()!
    const vs = mk(gl.VERTEX_SHADER, WARP_VS), f = mk(gl.FRAGMENT_SHADER, fs)
    gl.attachShader(prog, vs)
    gl.attachShader(prog, f)
    // both programs read the one VAO : the attributes sit where the first one put them
    gl.bindAttribLocation(prog, 0, 'pos')
    gl.bindAttribLocation(prog, 1, 'uvq')
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(f)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog) || 'output link')
    return {
      prog,
      uTex: gl.getUniformLocation(prog, 'tex')!,
      uGrid: gl.getUniformLocation(prog, 'grid')!,
      uFeather: gl.getUniformLocation(prog, 'feather')!
    }
  }

  /** Sharp enlargement on / off (Output page) : the cubic warp program, else the
   *  plain bilinear one. A failed compile leaves the plain one in place. */
  setSharp(on: boolean): void {
    if (on && !this.sharpProg && !this.disposed) {
      try { this.sharpProg = this.build(WARP_SHARP_FS) } catch (e) { console.warn('[output] sharp enlargement unavailable', e); this.sharp = false; return }
    }
    this.sharp = on
  }

  /** Set the projection warp. `corners` = 8 normalized numbers (TL,TR,BR,BL x,y)
   *  or null for a plain full-frame fit; `feather` = output pixels its edge fades
   *  over (0 : crisp, still anti-aliased). */
  setWarp(corners: number[] | null, grid: boolean, feather = 0): void {
    const c = corners && corners.length === 8 ? corners : IDENTITY_CORNERS
    let changed = this.lastCorners.length !== c.length
    if (!changed) for (let i = 0; i < c.length; i++) if (this.lastCorners[i] !== c[i]) { changed = true; break }
    if (changed) {
      this.lastCorners = c.slice()
      this.vertsW = 0 // rebuilt at the next present, at the drawn size
    }
    this.gridOn = grid
    this.feather = Math.max(0, feather)
  }
  private gridOn = false

  /** Upload one streamed frame and present it through the warp. `pixels` is a
   *  bottom-up RGBA8 readback of the control window's composite, w×h×4. */
  present(w: number, h: number, pixels: Uint8Array): void {
    if (this.disposed || w <= 0 || h <= 0) return
    const gl = this.gl
    // Match the drawing buffer to the physical output canvas.
    const cw = this.canvas.clientWidth || w
    const ch = this.canvas.clientHeight || h
    const dw = Math.max(1, Math.round(cw * (window.devicePixelRatio || 1)))
    const dh = Math.max(1, Math.round(ch * (window.devicePixelRatio || 1)))
    if (this.canvas.width !== dw || this.canvas.height !== dh) {
      this.canvas.width = dw
      this.canvas.height = dh
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    if (this.texW !== w || this.texH !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      this.texW = w
      this.texH = h
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    // A square frame is a fulldome master : letterbox it (never stretch a
    // fisheye), centred, instead of filling the window like a flat composite.
    let vw = this.canvas.width, vh = this.canvas.height
    if (w === h && this.canvas.width !== this.canvas.height) {
      const side = Math.min(this.canvas.width, this.canvas.height)
      gl.viewport(Math.round((this.canvas.width - side) / 2), Math.round((this.canvas.height - side) / 2), side, side)
      vw = vh = side
    }
    // The quad reaches a couple of pixels past the frame for its anti-aliased
    // edge : rebuilt when the corners or the drawn size change.
    if (this.lastCorners.length !== 8) this.lastCorners = IDENTITY_CORNERS.slice()
    if (this.vertsW !== vw || this.vertsH !== vh) {
      this.vertsW = vw
      this.vertsH = vh
      gl.bindVertexArray(this.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, computeWarpVerts(this.lastCorners, vw, vh))
      gl.bindVertexArray(null)
    }
    const wp = this.sharp && this.sharpProg ? this.sharpProg : this.plain
    gl.useProgram(wp.prog)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.uniform1i(wp.uTex, 0)
    gl.uniform1f(wp.uGrid, this.gridOn ? 1 : 0)
    gl.uniform1f(wp.uFeather, this.feather)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    gl.deleteTexture(this.tex)
    gl.deleteBuffer(this.buf)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.plain.prog)
    if (this.sharpProg) gl.deleteProgram(this.sharpProg.prog)
  }
}
