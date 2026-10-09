// Small-grid readback WITHOUT stalling the render loop : the return path for
// everything that turns the picture back into control data (vision features,
// the sonify taps, the depth estimator's input frame).
//
// These grids are tiny — a few KB — so the cost was assumed to be the bytes.
// It isn't. A synchronous readPixels cannot return until the GPU has finished
// every command queued ahead of it, so it drains the whole pipeline, and the
// drain costs the same whether you ask for one pixel or 64K of them : on a
// tile-based GPU (the integrated ones, where the render passes resolve lazily)
// each of these reads measured ~17 ms, 1x1 and 256x256 alike. Three of them
// running at once took a 60 fps session to a third of that, and the readback
// time showed up nowhere in the frame budget because the stall happens inside
// the driver.
//
// So: same approach as frameCapture.ts, scaled down. A ring of pixel-pack
// buffers plus fences. kick() queues the downsample and the readback and
// returns immediately; takeLatest() hands back the newest grid whose fence has
// signaled, which is one or two frames old. For a control signal that is free :
// these consumers are all throttled to 11-30 Hz anyway, so the reading they got
// synchronously was already older than the latency this adds. Nothing here ever
// WAITS on the GPU : when every slot is still in flight, kick() skips.

export class GridReadback {
  private fbo: WebGLFramebuffer | null = null
  private tex: WebGLTexture | null = null
  private size = 0
  private pbos: WebGLBuffer[] = []
  private fences: Array<WebGLSync | null> = []
  private phase = 0 // the next slot to write = the oldest one
  private out: Uint8Array | null = null

  /** `slots` : readbacks in flight. Three is enough for a consumer polling at
   *  30 Hz or slower (the fence from the previous poll has long signaled), and
   *  the whole ring costs size²·4·3 bytes — 110 KB at 96², nothing. */
  constructor(
    private gl: WebGL2RenderingContext,
    private slots = 3
  ) {}

  private ensure(size: number): void {
    if (this.size === size) return
    const gl = this.gl
    // A size change makes everything in flight the wrong shape : drop it all.
    this.release()
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const bytes = size * size * 4
    for (let i = 0; i < this.slots; i++) {
      const pb = gl.createBuffer()!
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pb)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ)
      this.pbos.push(pb)
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    this.fences = new Array(this.slots).fill(null)
    this.out = new Uint8Array(bytes)
    this.fbo = fbo
    this.tex = tex
    this.size = size
  }

  private release(): void {
    const gl = this.gl
    for (const f of this.fences) {
      if (f) {
        try {
          gl.deleteSync(f)
        } catch {
          /* context lost */
        }
      }
    }
    this.fences = []
    for (const pb of this.pbos) gl.deleteBuffer(pb)
    this.pbos = []
    if (this.fbo) {
      gl.deleteFramebuffer(this.fbo)
      this.fbo = null
    }
    if (this.tex) {
      gl.deleteTexture(this.tex)
      this.tex = null
    }
    this.out = null
    this.size = 0
    this.phase = 0
  }

  /** Readbacks queued and not yet taken. */
  get pending(): number {
    return this.fences.reduce((n: number, f) => n + (f ? 1 : 0), 0)
  }

  /** Queue one `size`x`size` downsample of `src` and its readback. `prog`/`uTex`
   *  is a copy shader sampling unit 0, `vao` a fullscreen triangle. Returns false
   *  when every slot is still in flight (the GPU is behind : never wait for it). */
  kick(
    size: number,
    src: WebGLTexture,
    prog: WebGLProgram,
    uTex: WebGLUniformLocation | null,
    vao: WebGLVertexArrayObject
  ): boolean {
    const gl = this.gl
    this.ensure(size)
    const wi = this.phase
    if (this.fences[wi]) return false
    gl.bindVertexArray(vao)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.viewport(0, 0, size, size)
    gl.useProgram(prog)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.uniform1i(uTex, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbos[wi])
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null)
    this.fences[wi] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    // Submit now : a window that doesn't paint (minimized, the output window on
    // another space) never flushes on its own, and the GPU would only start this
    // readback when we came to read it, which is the stall we are avoiding.
    gl.flush()
    this.phase = (wi + 1) % this.slots
    return true
  }

  private ready(ri: number): boolean {
    const gl = this.gl
    const f = this.fences[ri]
    if (!f) return false
    const st = gl.clientWaitSync(f, gl.SYNC_FLUSH_COMMANDS_BIT, 0)
    return st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED
  }

  /** The NEWEST finished grid, older finished ones dropped unread : a control
   *  signal wants the freshest reading, not every one. Null while none is ready
   *  (the first poll after a start or a size change). Rows run bottom-up, as GL
   *  reads them. The buffer is reused, so read it before the next kick. */
  takeLatest(): { grid: Uint8Array; size: number } | null {
    const gl = this.gl
    const out = this.out
    if (!out) return null
    let best = -1
    for (let k = 0; k < this.slots; k++) {
      const ri = (this.phase + k) % this.slots
      if (this.ready(ri)) best = ri // iterating oldest → newest, so the last wins
    }
    if (best < 0) return null
    // Anything queued before it is stale now : free those slots unread.
    for (let k = 0; k < this.slots; k++) {
      const ri = (this.phase + k) % this.slots
      if (ri === best) break
      if (this.fences[ri]) {
        gl.deleteSync(this.fences[ri]!)
        this.fences[ri] = null
      }
    }
    gl.deleteSync(this.fences[best]!)
    this.fences[best] = null
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbos[best])
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    return { grid: out, size: this.size }
  }

  dispose(): void {
    this.release()
  }
}
