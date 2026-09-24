// Frame capture : the clean output → the exact bytes one outside consumer wants,
// converted on the GPU and read back WITHOUT ever stalling the render loop.
//
// NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).
//
// One pass turns the source (the pre-keystone composite, or the domemaster in
// dome mode) into a consumer's format :
//   · uyvy     NDI's own 4:2:2 (BT.709 video range, U Y0 V Y1 per texel), top-down;
//   · rgbx     plain 8-bit RGB, top-down (NDI's RGB option);
//   · rgba-up  RGBA in GL's own bottom-up order (Spout / Syphon flip it themselves,
//              the projector window draws it as is);
//   · dxt1     DXT1 (BC1) texture blocks, compressed right here on the GPU, 4×4
//              blocks from the top, padded to 16 pixels : the body of a DXV3 frame
//              (Resolume's codec), so a recording needs no CPU image work at all.
// The readback is asynchronous (a ring of PBOs + fences) : kick() queues this
// frame, harvest() hands back a finished one. Nothing here ever WAITS on the GPU :
// when every slot is still in flight, kick() skips that capture. Waiting instead
// (reading a pending slot) cost ~35 ms per frame on a scene that already fills the
// GPU, and dragged the whole render loop, the operator view and the stream itself,
// from 60 to ~23 fps (measured). A consumer that hands the buffers back
// (recycle) makes a steady stream allocate nothing.

export type CaptureFormat = 'uyvy' | 'rgbx' | 'rgba-up' | 'dxt1'

const VS = `#version 300 es
in vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }`

const FS: Record<CaptureFormat, string> = {
  uyvy: `#version 300 es
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
}`,
  rgbx: `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 uOut;
out vec4 o;
void main(){
  vec2 f = floor(gl_FragCoord.xy);
  o = vec4(clamp(texture(src, vec2((f.x + 0.5) / uOut.x, 1.0 - (f.y + 0.5) / uOut.y)).rgb, 0.0, 1.0), 1.0);
}`,
  'rgba-up': `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 uOut;
out vec4 o;
void main(){
  o = vec4(clamp(texture(src, gl_FragCoord.xy / uOut).rgb, 0.0, 1.0), 1.0);
}`,
  // One texel pair per 4×4 block : the even texel holds the two 565 endpoints,
  // the odd one the 16 two-bit indices (bytes little-endian, as DXT1 stores them).
  // Endpoints = the block's colour bounding box, inset by 1/16 (the classic
  // real-time DXT recipe), each pixel then takes its nearest palette colour.
  dxt1: `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D src;
uniform vec2 uOut;     // real frame size (w, h); the blocks beyond it are black
out vec4 o;
vec3 px(int x, int y){
  if (x >= int(uOut.x) || y >= int(uOut.y)) return vec3(0.0);
  return clamp(texture(src, vec2((float(x) + 0.5) / uOut.x, 1.0 - (float(y) + 0.5) / uOut.y)).rgb, 0.0, 1.0);
}
uint pack565(vec3 c){
  uvec3 q = uvec3(clamp(floor(c * vec3(31.0, 63.0, 31.0) + 0.5), vec3(0.0), vec3(31.0, 63.0, 31.0)));
  return (q.r << 11u) | (q.g << 5u) | q.b;
}
vec3 unpack565(uint v){
  return vec3(float((v >> 11u) & 31u) / 31.0, float((v >> 5u) & 63u) / 63.0, float(v & 31u) / 31.0);
}
void main(){
  int bx = int(gl_FragCoord.x) >> 1;
  int by = int(gl_FragCoord.y); // memory row = block row counted from the TOP
  vec3 c[16];
  vec3 mn = vec3(1.0), mx = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    c[i] = px(bx * 4 + (i & 3), by * 4 + (i >> 2));
    mn = min(mn, c[i]);
    mx = max(mx, c[i]);
  }
  vec3 inset = (mx - mn) / 16.0;
  uint c0 = pack565(clamp(mx - inset, 0.0, 1.0));
  uint c1 = pack565(clamp(mn + inset, 0.0, 1.0));
  if (c0 < c1) { uint t = c0; c0 = c1; c1 = t; } // c0 > c1 : four-colour mode
  uint idx = 0u;
  if (c0 != c1) {
    vec3 p0 = unpack565(c0), p1 = unpack565(c1);
    vec3 p2 = (2.0 * p0 + p1) / 3.0, p3 = (p0 + 2.0 * p1) / 3.0;
    for (int i = 0; i < 16; i++) {
      vec3 v = c[i];
      float d = dot(v - p0, v - p0);
      uint k = 0u;
      float e = dot(v - p1, v - p1); if (e < d) { d = e; k = 1u; }
      e = dot(v - p2, v - p2); if (e < d) { d = e; k = 2u; }
      e = dot(v - p3, v - p3); if (e < d) { d = e; k = 3u; }
      idx |= k << uint(2 * i);
    }
  }
  uint word = (int(gl_FragCoord.x) & 1) == 0 ? (c0 | (c1 << 16u)) : idx;
  o = vec4(float(word & 255u), float((word >> 8u) & 255u), float((word >> 16u) & 255u), float(word >> 24u)) / 255.0;
}`
}

/** One captured frame. `w`×`h` is the picture; `stride`×`rows` the bytes. For
 *  dxt1, `blocksPerRow` blocks of 8 bytes per row, rows = 16-padded height / 4. */
export interface CapturedFrame {
  format: CaptureFormat
  w: number
  h: number
  stride: number
  rows: number
  blocksPerRow: number
  buf: ArrayBuffer
}

function compile(gl: WebGL2RenderingContext, fs: string): WebGLProgram {
  const mk = (t: number, s: string): WebGLShader => {
    const sh = gl.createShader(t)!
    gl.shaderSource(sh, s)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('[frameCapture] ' + gl.getShaderInfoLog(sh))
    return sh
  }
  const p = gl.createProgram()!
  gl.attachShader(p, mk(gl.VERTEX_SHADER, VS))
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
  gl.bindAttribLocation(p, 0, 'p')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[frameCapture] ' + gl.getProgramInfoLog(p))
  return p
}

/** The picture size a capture will produce for a source and an edge cap (0 =
 *  native). UYVY needs an even width (it packs pixel pairs). */
export function captureSize(srcW: number, srcH: number, maxEdge: number, format: CaptureFormat): { w: number; h: number } {
  const scale = maxEdge > 0 ? Math.min(1, maxEdge / Math.max(srcW, srcH)) : 1
  let w = Math.max(2, Math.round(srcW * scale))
  const h = Math.max(2, Math.round(srcH * scale))
  if (format === 'uyvy') w -= w & 1
  return { w, h }
}

export class FrameCapture {
  private prog: WebGLProgram | null = null
  private progFormat: CaptureFormat | null = null
  private uSrc: WebGLUniformLocation | null = null
  private uOut: WebGLUniformLocation | null = null
  private target: { fbo: WebGLFramebuffer; tex: WebGLTexture; tw: number; th: number } | null = null
  private pbos: WebGLBuffer[] | null = null
  private pboBytes = 0
  private fences: Array<WebGLSync | null>
  private meta: Array<Omit<CapturedFrame, 'buf'> | null>
  private phase = 0 // the next slot to write = the oldest one
  // Buffers back from the consumer, ready to be refilled.
  private pool: ArrayBuffer[] = []

  /** `slots` : readbacks in flight. A fence can report well after the GPU is
   *  done (Chromium refreshes its status only between tasks, lazier still while
   *  the window doesn't paint), and on a scene that keeps the GPU busy the
   *  readback queues behind several frames : at 30 fps, four slots still skipped
   *  a third of NDI's captures on a GPU-bound scene, six skipped none (measured). */
  constructor(private gl: WebGL2RenderingContext, private slots = 6) {
    this.fences = new Array(slots).fill(null)
    this.meta = new Array(slots).fill(null)
  }

  private useFormat(format: CaptureFormat): void {
    if (this.progFormat === format) return
    const gl = this.gl
    if (this.prog) gl.deleteProgram(this.prog)
    this.prog = compile(gl, FS[format])
    this.progFormat = format
    this.uSrc = gl.getUniformLocation(this.prog, 'src')
    this.uOut = gl.getUniformLocation(this.prog, 'uOut')
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
      for (let i = 0; i < this.slots; i++) {
        const pb = gl.createBuffer()!
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pb)
        gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ)
        this.pbos.push(pb)
      }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
      this.pboBytes = bytes
      this.pool = []
    }
  }

  private freePbos(): void {
    const gl = this.gl
    for (let i = 0; i < this.slots; i++) {
      if (this.fences[i]) { gl.deleteSync(this.fences[i]!); this.fences[i] = null }
      this.meta[i] = null
    }
    if (this.pbos) { for (const pb of this.pbos) gl.deleteBuffer(pb); this.pbos = null }
  }

  /** Frames queued and not yet harvested. */
  get pending(): number {
    return this.fences.reduce((n: number, f) => n + (f ? 1 : 0), 0)
  }

  /** Queue this frame's conversion + readback. `vao` = a fullscreen triangle
   *  with its positions on attribute 0. Returns false when skipped (every slot
   *  still in flight : the GPU is behind, never wait for it). */
  kick(src: WebGLTexture, srcW: number, srcH: number, format: CaptureFormat, maxEdge: number, vao: WebGLVertexArrayObject): boolean {
    const gl = this.gl
    const { w, h } = captureSize(srcW, srcH, maxEdge, format)
    let tw: number, th: number, blocksPerRow = 0
    if (format === 'dxt1') {
      blocksPerRow = Math.ceil(w / 16) * 4 // DXV : padded to 16 pixels
      tw = blocksPerRow * 2
      th = Math.ceil(h / 16) * 4
    } else {
      tw = format === 'uyvy' ? w / 2 : w
      th = h
    }
    const stride = tw * 4
    this.ensure(tw, th, stride * th)
    const wi = this.phase
    if (this.fences[wi]) return false
    this.useFormat(format)
    const t = this.target!
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.viewport(0, 0, tw, th)
    gl.useProgram(this.prog)
    gl.bindVertexArray(vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.uniform1i(this.uSrc, 0)
    gl.uniform2f(this.uOut, w, h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbos![wi])
    gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.fences[wi] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    // Submit now : a window that doesn't paint (minimized) never flushes on its
    // own, and the GPU would only start this readback when we come to read it.
    gl.flush()
    this.meta[wi] = { format, w, h, stride, rows: th, blocksPerRow }
    this.phase = (wi + 1) % this.slots
    return true
  }

  private ready(ri: number): boolean {
    const sync = this.fences[ri]
    if (!sync || !this.meta[ri]) return false
    const st = this.gl.clientWaitSync(sync, this.gl.SYNC_FLUSH_COMMANDS_BIT, 0)
    return st === this.gl.ALREADY_SIGNALED || st === this.gl.CONDITION_SATISFIED
  }

  /** The OLDEST finished frame, else null : call until null to get every frame
   *  in order (a recording, NDI). */
  harvest(): CapturedFrame | null {
    if (!this.pbos) return null
    for (let k = 0; k < this.slots; k++) {
      const ri = (this.phase + k) % this.slots
      if (this.fences[ri] && this.ready(ri)) return this.read(ri)
      if (this.fences[ri]) return null // keep the order : an older one isn't done yet
    }
    return null
  }

  /** The NEWEST finished frame, dropping older finished ones (a live picture :
   *  the projector, Spout / Syphon, a preview). */
  harvestLatest(): CapturedFrame | null {
    if (!this.pbos) return null
    let best = -1
    for (let k = 0; k < this.slots; k++) {
      const ri = (this.phase + k) % this.slots
      if (this.fences[ri] && this.ready(ri)) best = ri
    }
    if (best < 0) return null
    // Everything queued before it is stale now : free those slots unread.
    for (let k = 0; k < this.slots; k++) {
      const ri = (this.phase + k) % this.slots
      if (ri === best) break
      if (this.fences[ri]) { this.gl.deleteSync(this.fences[ri]!); this.fences[ri] = null; this.meta[ri] = null }
    }
    return this.read(best)
  }

  /** Read slot `ri` into a pooled buffer and free the slot. */
  private read(ri: number): CapturedFrame {
    const gl = this.gl
    const meta = this.meta[ri]!
    gl.deleteSync(this.fences[ri]!)
    this.fences[ri] = null
    this.meta[ri] = null
    const need = meta.stride * meta.rows
    let buf = this.pool.pop()
    if (!buf || buf.byteLength !== need) buf = new ArrayBuffer(need)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbos![ri])
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, new Uint8Array(buf))
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    return { ...meta, buf }
  }

  /** Take a buffer back from the consumer (a size change just lets old ones go). */
  recycle(buf: ArrayBuffer): void {
    if (buf.byteLength === this.pboBytes && this.pool.length < 4) this.pool.push(buf)
  }

  dispose(): void {
    const gl = this.gl
    this.pool = []
    this.freePbos()
    if (this.target) { gl.deleteFramebuffer(this.target.fbo); gl.deleteTexture(this.target.tex); this.target = null }
    if (this.prog) { gl.deleteProgram(this.prog); this.prog = null; this.progFormat = null }
  }
}
