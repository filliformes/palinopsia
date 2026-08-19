// OutputPresenter : the output window's WHOLE renderer, replacing the old
// second Compositor. The control window streams its finished RGBA8 frame each
// tick (via a zero-copy MessagePort); this uploads it to a texture and draws it
// to the output canvas through the SAME projection-warp as the compositor — so
// the projector shows the control window's pixels EXACTLY, not an independent
// re-render that diverges on every stochastic source (Collage, video, feedback).
//
// The warp shader, corner→vertex maths and UV orientation are copied verbatim
// from Compositor's present pass : the streamed buffer is a `readPixels` of the
// composite (GL bottom-up), which is precisely the orientation those UVs assume,
// so the result is pixel-for-pixel what the compositor presents.

const WARP_VS = `#version 300 es
in vec2 pos;
in vec3 uvq;
out vec3 vUvq;
void main(){ vUvq = uvq; gl_Position = vec4(pos, 0.0, 1.0); }`

const WARP_FS = `#version 300 es
precision highp float;
in vec3 vUvq; out vec4 o;
uniform sampler2D tex;
uniform float grid;
void main(){
  vec2 uv = vUvq.xy / vUvq.z;
  vec4 c = texture(tex, uv);
  if (grid > 0.5){
    vec2 g = abs(fract(uv * 8.0) - 0.5);
    float line = smoothstep(0.47, 0.5, max(g.x, g.y));
    c.rgb = mix(c.rgb, vec3(0.0, 1.0, 1.0), line * 0.5);
    float edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
    c.rgb = mix(c.rgb, vec3(1.0, 0.2, 0.2), 1.0 - smoothstep(0.0, 0.006, edge));
  }
  o = c;
}`

function lineIntersect(a1: number[], a2: number[], b1: number[], b2: number[]): number[] | null {
  const d = (a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0])
  if (Math.abs(d) < 1e-9) return null
  const t = ((b1[0] - a1[0]) * (b2[1] - b1[1]) - (b1[1] - a1[1]) * (b2[0] - b1[0])) / d
  return [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])]
}

/** 4 normalized corners (TL,TR,BR,BL) → 6 perspective-correct textured verts.
 *  Identity corners (0,0,1,0,1,1,0,1) give a plain full-frame fit. */
function computeWarpVerts(c: number[]): Float32Array {
  const p = [
    [c[0], c[1]],
    [c[2], c[3]],
    [c[4], c[5]],
    [c[6], c[7]]
  ]
  const q = [1, 1, 1, 1]
  const inter = lineIntersect(p[0], p[2], p[1], p[3])
  if (inter) {
    const dist = p.map((pt) => Math.hypot(pt[0] - inter[0], pt[1] - inter[1]))
    for (let i = 0; i < 4; i++) {
      const dopp = dist[(i + 2) % 4]
      q[i] = dopp > 1e-6 ? (dist[i] + dopp) / dopp : 1
    }
  }
  const uv = [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
  ]
  const clip = p.map((pt) => [pt[0] * 2 - 1, 1 - pt[1] * 2])
  const idx = [0, 1, 2, 0, 2, 3]
  const out = new Float32Array(30)
  let o = 0
  for (const i of idx) {
    out[o++] = clip[i][0]
    out[o++] = clip[i][1]
    out[o++] = uv[i][0] * q[i]
    out[o++] = uv[i][1] * q[i]
    out[o++] = q[i]
  }
  return out
}

const IDENTITY_CORNERS = [0, 0, 1, 0, 1, 1, 0, 1]

export class OutputPresenter {
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private vao: WebGLVertexArrayObject
  private buf: WebGLBuffer
  private tex: WebGLTexture
  private uTex: WebGLUniformLocation
  private uGrid: WebGLUniformLocation
  private texW = 0
  private texH = 0
  private lastCorners: number[] = []
  private disposed = false

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false })
    if (!gl) throw new Error('WebGL2 unavailable for output presenter')
    this.gl = gl
    const mk = (t: number, src: string): WebGLShader => {
      const sh = gl.createShader(t)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(sh) || 'output shader')
      return sh
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, WARP_VS))
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, WARP_FS))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog) || 'output link')
    this.prog = prog
    this.uTex = gl.getUniformLocation(prog, 'tex')!
    this.uGrid = gl.getUniformLocation(prog, 'grid')!
    const aPos = gl.getAttribLocation(prog, 'pos')
    const aUvq = gl.getAttribLocation(prog, 'uvq')
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, computeWarpVerts(IDENTITY_CORNERS), gl.DYNAMIC_DRAW)
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

  /** Set the projection warp. `corners` = 8 normalized numbers (TL,TR,BR,BL x,y)
   *  or null for a plain full-frame fit. */
  setWarp(corners: number[] | null, grid: boolean): void {
    const c = corners && corners.length === 8 ? corners : IDENTITY_CORNERS
    let changed = this.lastCorners.length !== c.length
    if (!changed) for (let i = 0; i < c.length; i++) if (this.lastCorners[i] !== c[i]) { changed = true; break }
    if (changed) {
      this.lastCorners = c.slice()
      const gl = this.gl
      gl.bindVertexArray(this.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, computeWarpVerts(c))
      gl.bindVertexArray(null)
    }
    this.gridOn = grid
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
    gl.useProgram(this.prog)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.uniform1i(this.uTex, 0)
    gl.uniform1f(this.uGrid, this.gridOn ? 1 : 0)
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
    gl.deleteProgram(this.prog)
  }
}
