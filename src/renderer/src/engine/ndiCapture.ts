// NDI capture : the clean output → an NDI-ready frame, converted on the GPU.
//
// NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).
//
// One pass turns the source (the pre-keystone composite, or the domemaster in
// dome mode) into the exact bytes NDI wants, TOP-DOWN :
//   · UYVY (default) : 4:2:2 BT.709 video range, packed as one RGBA8 texel per
//     two pixels (U Y0 V Y1), so the readback is half an RGBA frame and NDI
//     skips its own colour conversion;
//   · RGBX : plain 8-bit RGB (flipped).
// The readback is asynchronous (a ring of PBOs + fences) : kick() queues this
// frame, harvest() hands back the oldest one the GPU is done with. Nothing here
// ever WAITS on the GPU : when every slot is still in flight, kick() skips that
// capture. Waiting instead (reading a pending slot) cost ~35 ms per frame on a
// scene that already fills the GPU, and dragged the whole render loop, the
// operator view and the stream itself, from 60 to ~23 fps (measured). The returned
// ArrayBuffer is TRANSFERRED to the NDI sender (the preload), which sends it
// without copying and transfers it back once NDI lets go : recycle() pools it,
// so a steady stream allocates nothing.

import type { NdiFormat } from '@shared/ndi'

const VS = `#version 300 es
in vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }`

const FS_UYVY = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 uOut;     // output frame size in pixels (w, h)
out vec4 o;
vec3 at(float x, float row){
  // row counts from the TOP : NDI is top-down, GL textures are bottom-up.
  return clamp(texture(src, vec2((x + 0.5) / uOut.x, 1.0 - (row + 0.5) / uOut.y)).rgb, 0.0, 1.0);
}
void main(){
  float x = floor(gl_FragCoord.x) * 2.0;
  float row = floor(gl_FragCoord.y);
  vec3 a = at(x, row), b = at(x + 1.0, row);
  // BT.709, video range (Y 16..235, C 16..240).
  float y0 = 16.0 + 219.0 * dot(a, vec3(0.2126, 0.7152, 0.0722));
  float y1 = 16.0 + 219.0 * dot(b, vec3(0.2126, 0.7152, 0.0722));
  vec3 m = (a + b) * 0.5;
  float u = 128.0 + 224.0 * dot(m, vec3(-0.114572, -0.385428, 0.5));
  float v = 128.0 + 224.0 * dot(m, vec3(0.5, -0.454153, -0.045847));
  o = vec4(u, y0, v, y1) / 255.0;
}`

const FS_RGBX = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 uOut;
out vec4 o;
void main(){
  vec2 f = floor(gl_FragCoord.xy);
  o = vec4(clamp(texture(src, vec2((f.x + 0.5) / uOut.x, 1.0 - (f.y + 0.5) / uOut.y)).rgb, 0.0, 1.0), 1.0);
}`

export interface NdiFrameOut {
  w: number
  h: number
  fourcc: 'UYVY' | 'RGBX'
  stride: number
  buf: ArrayBuffer
}

function compile(gl: WebGL2RenderingContext, fs: string): WebGLProgram {
  const mk = (t: number, s: string): WebGLShader => {
    const sh = gl.createShader(t)!
    gl.shaderSource(sh, s)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('[ndiCapture] ' + gl.getShaderInfoLog(sh))
    return sh
  }
  const p = gl.createProgram()!
  gl.attachShader(p, mk(gl.VERTEX_SHADER, VS))
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
  gl.bindAttribLocation(p, 0, 'p')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[ndiCapture] ' + gl.getProgramInfoLog(p))
  return p
}

// Readbacks in flight. A fence can report well after the GPU is done (Chromium
// refreshes its status only between tasks, lazier still while the window doesn't
// paint), and on a scene that keeps the GPU busy the readback itself queues
// behind several frames. Measured on a GPU-bound scene, 30 fps NDI : four slots
// still skipped a third of the captures in front (NDI ~13-25 fps), six skipped
// none (29-30). ~100 MB of readback buffers at 4K, ~200 MB at 4096².
const SLOTS = 6

export class NdiCapture {
  private progs: Record<NdiFormat, WebGLProgram>
  private target: { fbo: WebGLFramebuffer; tex: WebGLTexture; tw: number; th: number } | null = null
  private pbos: WebGLBuffer[] | null = null
  private pboBytes = 0
  private fences: Array<WebGLSync | null> = new Array(SLOTS).fill(null)
  private meta: Array<Omit<NdiFrameOut, 'buf'> | null> = new Array(SLOTS).fill(null)
  private phase = 0 // the next slot to write = the oldest one
  // Frame buffers back from the sender, ready to be refilled.
  private pool: ArrayBuffer[] = []
  private locs = new Map<string, WebGLUniformLocation | null>()
  private loc(f: NdiFormat, n: string): WebGLUniformLocation | null {
    const k = f + n
    if (!this.locs.has(k)) this.locs.set(k, this.gl.getUniformLocation(this.progs[f], n))
    return this.locs.get(k)!
  }

  constructor(private gl: WebGL2RenderingContext) {
    this.progs = { uyvy: compile(gl, FS_UYVY), rgbx: compile(gl, FS_RGBX) }
  }

  private ensure(tw: number, th: number, bytes: number): void {
    const gl = this.gl
    if (!this.target || this.target.tw !== tw || this.target.th !== th) {
      if (this.target) { gl.deleteFramebuffer(this.target.fbo); gl.deleteTexture(this.target.tex) }
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      this.target = { fbo, tex, tw, th }
    }
    if (!this.pbos || this.pboBytes !== bytes) {
      this.freePbos()
      this.pbos = []
      for (let i = 0; i < SLOTS; i++) {
        const pb = gl.createBuffer()!
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pb)
        gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ)
        this.pbos.push(pb)
      }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
      this.pboBytes = bytes
    }
  }

  private freePbos(): void {
    const gl = this.gl
    for (let i = 0; i < SLOTS; i++) {
      if (this.fences[i]) { gl.deleteSync(this.fences[i]!); this.fences[i] = null }
      this.meta[i] = null
    }
    if (this.pbos) { for (const pb of this.pbos) gl.deleteBuffer(pb); this.pbos = null }
  }

  /** Queue this frame's conversion + readback. `vao` = a fullscreen triangle
   *  with its positions on attribute 0. */
  kick(src: WebGLTexture, srcW: number, srcH: number, format: NdiFormat, maxEdge: number, vao: WebGLVertexArrayObject): void {
    const gl = this.gl
    const scale = maxEdge > 0 ? Math.min(1, maxEdge / Math.max(srcW, srcH)) : 1
    let w = Math.max(2, Math.round(srcW * scale))
    const h = Math.max(2, Math.round(srcH * scale))
    w -= w & 1 // UYVY packs pixel pairs : the width must be even
    const tw = format === 'uyvy' ? w / 2 : w
    const stride = tw * 4
    const bytes = stride * h
    this.ensure(tw, h, bytes)
    const t = this.target!
    const wi = this.phase
    // A still-pending readback in this slot means the consumer is slower than
    // us : drop it, overwrite.
    // Every slot still in flight (the oldest is this one) : skip this capture.
    if (this.fences[wi]) return
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.viewport(0, 0, tw, h)
    gl.useProgram(this.progs[format])
    gl.bindVertexArray(vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.uniform1i(this.loc(format, 'src'), 0)
    gl.uniform2f(this.loc(format, 'uOut'), w, h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbos![wi])
    gl.readPixels(0, 0, tw, h, gl.RGBA, gl.UNSIGNED_BYTE, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.fences[wi] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    // Submit now : a window that doesn't paint (minimized) never flushes on its
    // own, and the GPU would only start this readback when we come to read it.
    gl.flush()
    this.meta[wi] = { w, h, fourcc: format === 'uyvy' ? 'UYVY' : 'RGBX', stride }
    this.phase = (wi + 1) % SLOTS
  }

  /** The oldest finished frame (else null) : the older slot first, then the
   *  one just kicked, so a frame ready on the next render isn't held back. */
  harvest(): NdiFrameOut | null {
    const gl = this.gl
    if (!this.pbos) return null
    for (let k = 0; k < SLOTS; k++) {
      const ri = (this.phase + k) % SLOTS
      const sync = this.fences[ri]
      if (!sync || !this.meta[ri]) continue
      const st = gl.clientWaitSync(sync, gl.SYNC_FLUSH_COMMANDS_BIT, 0)
      if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) continue
      return this.read(ri)
    }
    return null
  }

  /** Read slot `ri` into a pooled buffer and free the slot. */
  private read(ri: number): NdiFrameOut {
    const gl = this.gl
    const meta = this.meta[ri]!
    if (this.fences[ri]) gl.deleteSync(this.fences[ri]!)
    this.fences[ri] = null
    this.meta[ri] = null
    const need = meta.stride * meta.h
    let buf = this.pool.pop()
    if (!buf || buf.byteLength !== need) buf = new ArrayBuffer(need)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbos![ri])
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, new Uint8Array(buf))
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    return { ...meta, buf }
  }

  /** Take a buffer back from the sender (a size change just lets old ones go). */
  recycle(buf: ArrayBuffer): void {
    if (buf.byteLength === this.pboBytes && this.pool.length < 4) this.pool.push(buf)
  }

  dispose(): void {
    const gl = this.gl
    this.pool = []
    this.freePbos()
    if (this.target) { gl.deleteFramebuffer(this.target.fbo); gl.deleteTexture(this.target.tex); this.target = null }
    gl.deleteProgram(this.progs.uyvy)
    gl.deleteProgram(this.progs.rgbx)
  }
}
