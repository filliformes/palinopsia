// Output transform stage : the finished flat frame moved as one picture (see
// shared/outXform.ts). One fragment pass : every output pixel looks up where it
// sits in the picture, through the inverse of offset · rotate (+ spin) · scale ·
// flips, in aspect-correct units so a turned frame is never sheared. Outside the
// picture : black (with feathered edges), the picture repeated, or mirrored.

import type { OutXform } from '@shared/outXform'

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`

const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src;
uniform float uAspect;
uniform vec2 uOff;     // frame widths / heights
uniform float uScale;
uniform float uRot;    // radians (rotate + spin)
uniform vec2 uFlip;    // -1 = flipped
uniform float uFeather;
uniform int uEdge;     // 0 black · 1 repeat · 2 mirror
void main(){
  vec2 A = vec2(uAspect, 1.0);
  vec2 q = (uv - 0.5) * A - uOff * A;
  float c = cos(uRot), s = sin(uRot);
  q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
  q = q / uScale * uFlip;
  vec2 t = q / A + 0.5;
  if (uEdge == 1) t = fract(t);
  else if (uEdge == 2) t = 1.0 - abs(mod(t, 2.0) - 1.0);
  vec4 col = texture(src, clamp(t, 0.0, 1.0));
  if (uEdge == 0) {
    // Inside the picture by how far (height units, at the picture's own scale)
    vec2 d = min(t, 1.0 - t) * A;
    float inside = min(d.x, d.y);
    float k = uFeather > 0.0 ? smoothstep(0.0, uFeather, inside) : step(0.0, inside);
    col = vec4(col.rgb * k, 1.0);
  }
  o = vec4(col.rgb, 1.0);
}`

function compile(gl: WebGL2RenderingContext): WebGLProgram {
  const mk = (t: number, s: string): WebGLShader => {
    const sh = gl.createShader(t)!
    gl.shaderSource(sh, s)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('[outXform] ' + (gl.getShaderInfoLog(sh) || 'shader'))
    return sh
  }
  const p = gl.createProgram()!
  gl.attachShader(p, mk(gl.VERTEX_SHADER, VS))
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS))
  gl.bindAttribLocation(p, 0, 'p')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[outXform] ' + (gl.getProgramInfoLog(p) || 'link'))
  return p
}

/** Does this transform change the frame at all? (identity : the stage is skipped) */
export function outXformActive(cfg: OutXform, spinDeg: number): boolean {
  return (
    cfg.offsetX !== 0 || cfg.offsetY !== 0 || cfg.scale !== 1 || cfg.rotate !== 0 || cfg.spin !== 0 ||
    spinDeg !== 0 || cfg.feather > 0 || cfg.flipX || cfg.flipY
  )
}

export class OutXformStage {
  private prog: WebGLProgram
  private u = new Map<string, WebGLUniformLocation | null>()
  private target: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null
  private w = 0
  private h = 0

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = compile(gl)
  }

  private loc(n: string): WebGLUniformLocation | null {
    if (!this.u.has(n)) this.u.set(n, this.gl.getUniformLocation(this.prog, n))
    return this.u.get(n)!
  }

  private ensure(w: number, h: number): void {
    if (this.target && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.target) { gl.deleteFramebuffer(this.target.fbo); gl.deleteTexture(this.target.tex) }
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.target = { fbo, tex }
    this.w = w
    this.h = h
  }

  /** The moved frame from `src` (w × h). The caller's fullscreen-triangle VAO
   *  must be bound. `spinDeg` : the spin integrated so far. */
  render(src: WebGLTexture, w: number, h: number, cfg: OutXform, spinDeg: number): WebGLTexture {
    const gl = this.gl
    this.ensure(w, h)
    const t = this.target!
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.viewport(0, 0, w, h)
    gl.useProgram(this.prog)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.uniform1i(this.loc('src'), 0)
    gl.uniform1f(this.loc('uAspect'), w / h)
    gl.uniform2f(this.loc('uOff'), cfg.offsetX, cfg.offsetY)
    gl.uniform1f(this.loc('uScale'), Math.max(0.05, cfg.scale))
    gl.uniform1f(this.loc('uRot'), ((cfg.rotate + spinDeg) * Math.PI) / 180)
    gl.uniform2f(this.loc('uFlip'), cfg.flipX ? -1 : 1, cfg.flipY ? -1 : 1)
    gl.uniform1f(this.loc('uFeather'), cfg.feather)
    gl.uniform1i(this.loc('uEdge'), cfg.edge === 'repeat' ? 1 : cfg.edge === 'mirror' ? 2 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindTexture(gl.TEXTURE_2D, null)
    return t.tex
  }

  dispose(): void {
    if (this.target) { this.gl.deleteFramebuffer(this.target.fbo); this.gl.deleteTexture(this.target.tex) }
    this.target = null
    this.gl.deleteProgram(this.prog)
  }
}
