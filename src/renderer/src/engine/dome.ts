// Fulldome stage : the flat composite → a square domemaster (see shared/dome.ts
// for the convention). One fragment pass per master pixel : find the direction
// that pixel looks at on the dome, then decide which point of the flat picture
// belongs there (wrap / screen / fisheye). Output is RGBA8 so an 8K master is
// 256 MB, not 512.

import type { DomeConfig } from '@shared/dome'

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`

const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src;
uniform float uHalfAp;      // half the aperture, radians (105° for a 210° dome)
uniform int uMode;          // 0 wrap · 1 screen · 2 fisheye
uniform float uRot;         // azimuth rotation (rotate + spin), radians
uniform int uFlip;
uniform float uFeather;
uniform int uGrid;
uniform float uPix;         // radians per master pixel (grid line width)
uniform float uAspect;      // source width / height
uniform float uTurns;
uniform int uMirror;
uniform float uTop, uBottom; // radians of elevation
uniform int uCap;           // 0 fade · 1 stretch · 2 black
uniform vec3 uC, uR, uU;    // screen centre + basis
uniform float uHalfW, uHalfH, uSurround;
uniform float uScale;
uniform vec2 uOffset;
const float PI = 3.14159265359;

vec3 wrapAt(float az, float el){
  float u = az / (2.0 * PI) * uTurns + 0.5;          // the front lands on the picture's centre
  float k = floor(u);
  float fu = u - k;
  if (uMirror == 1 && mod(k, 2.0) > 0.5) fu = 1.0 - fu; // alternate copies mirror : no seams
  float v = (el - uBottom) / max(uTop - uBottom, 1e-4);
  if (v < 0.0) return vec3(0.0);
  float fade = 1.0;
  if (v > 1.0) {
    if (uCap == 2) return vec3(0.0);
    if (uCap == 0) fade = 1.0 - smoothstep(0.0, 1.0, (el - uTop) / max(0.5 * PI - uTop, 1e-3));
    v = 1.0;
  }
  vec2 s = vec2(fu, v);
  return texture(src, s).rgb * fade;
}

void main(){
  vec2 q = uv * 2.0 - 1.0;
  if (uFlip == 1) q.x = -q.x;
  float r = length(q);
  if (r > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float theta = r * uHalfAp;                      // angle from the zenith (equidistant)
  float az = atan(q.x, -q.y);                     // 0 = front (bottom), + = the audience's right
  float el = 0.5 * PI - theta;
  vec3 col = vec3(0.0);
  if (uMode == 0) {
    col = wrapAt(az - uRot, el);
  } else if (uMode == 1) {
    vec3 D = vec3(sin(theta) * sin(az), cos(theta), -sin(theta) * cos(az));
    vec3 back = uSurround > 0.001 ? wrapAt(az - uRot, el) * uSurround : vec3(0.0);
    float d = dot(D, uC);
    col = back;
    if (d > 1e-4) {
      vec3 t = D / d;
      float sx = dot(t, uR) / uHalfW;
      float sy = dot(t, uU) / uHalfH;
      float m = max(abs(sx), abs(sy));
      if (m < 1.0) {
        vec2 s = vec2(sx, sy) * 0.5 + 0.5;
        vec3 scr = texture(src, s).rgb;
        col = mix(back, scr, 1.0 - smoothstep(0.985, 1.0, m));
      }
    }
  } else {
    float c = cos(uRot), s = sin(uRot);
    vec2 qq = mat2(c, s, -s, c) * q / uScale - uOffset;
    vec2 p = vec2(qq.x / uAspect, qq.y) * 0.5 + 0.5;  // cover : the height spans the circle
    if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) col = texture(src, p).rgb;
  }
  if (uGrid == 1) {
    // Alignment grid : every 10° of elevation, every 30° of azimuth; the horizon
    // in cyan, the front meridian in red.
    float lw = uPix * 1.2;
    float e10 = radians(10.0), a30 = radians(30.0);
    float onEl = step(abs(mod(el + 0.5 * e10, e10) - 0.5 * e10), lw);
    float onAz = step(abs(mod(az + 0.5 * a30, a30) - 0.5 * a30), lw / max(sin(theta), 0.02));
    float hor = step(abs(el), lw * 1.8);
    float front = step(abs(az), lw * 1.8 / max(sin(theta), 0.02)) * step(0.0, el + 0.2);
    col = mix(col, vec3(0.85), max(onEl, onAz) * 0.6);
    col = mix(col, vec3(0.1, 0.9, 1.0), hor);
    col = mix(col, vec3(1.0, 0.15, 0.1), front);
  }
  float edge = 1.0 - smoothstep(1.0 - max(uFeather, 1e-4), 1.0, r);
  o = vec4(col * edge, 1.0);
}`

function compile(gl: WebGL2RenderingContext): WebGLProgram {
  const mk = (t: number, s: string): WebGLShader => {
    const sh = gl.createShader(t)!
    gl.shaderSource(sh, s)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('[dome] ' + (gl.getShaderInfoLog(sh) || 'shader'))
    return sh
  }
  const p = gl.createProgram()!
  gl.attachShader(p, mk(gl.VERTEX_SHADER, VS))
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS))
  gl.bindAttribLocation(p, 0, 'p')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[dome] ' + (gl.getProgramInfoLog(p) || 'link'))
  return p
}

const rad = (d: number): number => (d * Math.PI) / 180

type V3 = [number, number, number]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

export class DomeStage {
  private prog: WebGLProgram
  private u = new Map<string, WebGLUniformLocation | null>()
  private target: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null
  size = 0

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = compile(gl)
  }

  private loc(n: string): WebGLUniformLocation | null {
    if (!this.u.has(n)) this.u.set(n, this.gl.getUniformLocation(this.prog, n))
    return this.u.get(n)!
  }

  private ensure(n: number): void {
    if (this.target && this.size === n) return
    const gl = this.gl
    if (this.target) { gl.deleteFramebuffer(this.target.fbo); gl.deleteTexture(this.target.tex) }
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    this.target = { fbo, tex }
    this.size = n
  }

  /** Render the master from `src` (the flat composite, `aspect` = w/h). The
   *  caller's fullscreen-triangle VAO must be bound. Returns the master texture. */
  render(src: WebGLTexture, aspect: number, cfg: DomeConfig, timeSec: number): WebGLTexture {
    const gl = this.gl
    this.ensure(cfg.res)
    const t = this.target!
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.viewport(0, 0, this.size, this.size)
    gl.useProgram(this.prog)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.uniform1i(this.loc('src'), 0)
    const rot = rad(cfg.rotate + cfg.spin * timeSec)
    gl.uniform1f(this.loc('uHalfAp'), rad(cfg.aperture) / 2)
    gl.uniform1i(this.loc('uMode'), cfg.mode === 'wrap' ? 0 : cfg.mode === 'screen' ? 1 : 2)
    gl.uniform1f(this.loc('uRot'), rot)
    gl.uniform1i(this.loc('uFlip'), cfg.flipX ? 1 : 0)
    gl.uniform1f(this.loc('uFeather'), cfg.feather)
    gl.uniform1i(this.loc('uGrid'), cfg.grid ? 1 : 0)
    gl.uniform1f(this.loc('uPix'), rad(cfg.aperture) / this.size)
    gl.uniform1f(this.loc('uAspect'), aspect)
    gl.uniform1f(this.loc('uTurns'), cfg.turns)
    gl.uniform1i(this.loc('uMirror'), cfg.mirrorSeams ? 1 : 0)
    gl.uniform1f(this.loc('uTop'), rad(Math.max(cfg.top, cfg.bottom + 1)))
    gl.uniform1f(this.loc('uBottom'), rad(cfg.bottom))
    gl.uniform1i(this.loc('uCap'), cfg.cap === 'fade' ? 0 : cfg.cap === 'stretch' ? 1 : 2)
    // Screen : centre direction + an upright basis, rolled.
    const a = rad(cfg.azimuth) + rot
    const e = rad(cfg.elevation)
    const C: V3 = [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)]
    // Near the zenith "up" is undefined : use the screen's own azimuth instead.
    const upRef: V3 = Math.abs(C[1]) > 0.995 ? [Math.sin(a), 0, -Math.cos(a)] : [0, 1, 0]
    let R = norm(cross(C, upRef))
    let U = norm(cross(R, C))
    const ro = rad(cfg.roll)
    if (ro !== 0) {
      const c = Math.cos(ro), s = Math.sin(ro)
      const R2: V3 = [R[0] * c + U[0] * s, R[1] * c + U[1] * s, R[2] * c + U[2] * s]
      const U2: V3 = [U[0] * c - R[0] * s, U[1] * c - R[1] * s, U[2] * c - R[2] * s]
      R = R2
      U = U2
    }
    gl.uniform3f(this.loc('uC'), C[0], C[1], C[2])
    gl.uniform3f(this.loc('uR'), R[0], R[1], R[2])
    gl.uniform3f(this.loc('uU'), U[0], U[1], U[2])
    const hw = Math.tan(rad(Math.min(170, cfg.width)) / 2)
    gl.uniform1f(this.loc('uHalfW'), hw)
    gl.uniform1f(this.loc('uHalfH'), hw / Math.max(0.1, aspect))
    gl.uniform1f(this.loc('uSurround'), cfg.surround)
    gl.uniform1f(this.loc('uScale'), cfg.scale)
    gl.uniform2f(this.loc('uOffset'), cfg.offsetX, cfg.offsetY)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return t.tex
  }

  dispose(): void {
    const gl = this.gl
    if (this.target) { gl.deleteFramebuffer(this.target.fbo); gl.deleteTexture(this.target.tex); this.target = null }
    gl.deleteProgram(this.prog)
  }
}
