// Complex Output : one screen, drawn. Each screen's window (same renderer process
// as the engine, see cxWindows.ts) holds a canvas with a WebGL2 context of its own;
// the finished picture comes over from the engine's canvas GPU to GPU (texImage2D
// of a canvas : no pixel ever goes through the CPU), then the slices are drawn from
// it, bent, cut, colored and blended, and the screen's own color and masks go over
// the whole.
//
// Measured on the owner's machine (RTX 4070, 1080p composition) against a shared
// offscreen context handing out ImageBitmaps (60 fps for 1 screen, 21 fps for three
// at 4K) and a worker fed VideoFrames (60 fps, 1 to 1.4 ms later) : this holds 60
// fps for three 4K screens for 0.1 ms of the engine's frame.

// third-party: Complex Output's mapping math (published methods, named in part 6)

import type { CxColor, CxMask, CxScreen, CxSlice, CxSource, CxWarp } from '@shared/complexOut'
import { bounds, evalWarp, flattenMask, inputMap, maskOnScreen, polyArea, polyInput, warpMesh, warpOutline } from './cxMath'

const VS_SLICE = `#version 300 es
in vec3 pos;   // the screen's 0..1 (y down), and the projective weight
in vec2 st;
out vec2 vSt;
void main(){
  vSt = st;
  gl_Position = vec4((pos.x * 2.0 - 1.0) * pos.z, (1.0 - pos.y * 2.0) * pos.z, 0.0, pos.z);
}`

const COLOR_FN = `
vec3 grade(vec3 c, vec3 k, vec3 rgb){
  c = max(vec3(0.0), (c - 0.5) * k.y + 0.5);
  return pow(clamp(c * rgb * k.x, 0.0, 1.0), vec3(1.0 / k.z));
}`

const FS_SLICE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vSt; out vec4 o;
uniform sampler2D tex, uMask, uPts, uLabel;
uniform mat3 uIn;           // the slice's square to the source (y down)
uniform vec2 uSize;         // the canvas, px
uniform vec3 uK, uRGB;      // brightness, contrast, gamma
uniform vec4 uEdge, uEp;    // l r t b · power, 1/gamma, luminance, black
uniform float uOpacity, uShow;
uniform int uPoly, uHasMask, uCard;
uniform vec3 uTint;
uniform vec2 uPs;           // the slice's own size, px (its sides' mean : the test card's round things stay round)
${COLOR_FN}
float ramp(float x){
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? uEp.z * pow(2.0 * x, uEp.x) : 1.0 - (1.0 - uEp.z) * pow(2.0 * (1.0 - x), uEp.x);
}
// the outline's points pinned one for one, between them by mean value coordinates
vec2 pinned(vec2 p, vec2 was){
  float sw = 0.0; vec2 acc = vec2(0.0);
  int n = uPoly;
  vec2 d0 = texelFetch(uPts, ivec2(n - 1, 0), 0).xy - p;
  float r0 = length(d0);
  vec2 d1 = texelFetch(uPts, ivec2(0, 0), 0).xy - p;
  float r1 = length(d1);
  float t0 = (d0.x * d1.y - d1.x * d0.y) / max(1e-6, r0 * r1 + dot(d0, d1));
  for (int i = 0; i < n; i++){
    if (r1 < 1e-3) return texelFetch(uPts, ivec2(i, 1), 0).xy;
    int j = i + 1 < n ? i + 1 : 0;
    vec2 d2 = texelFetch(uPts, ivec2(j, 0), 0).xy - p;
    float r2 = length(d2);
    float A = d1.x * d2.y - d2.x * d1.y, D = dot(d1, d2);
    if (abs(A) < 1e-3 * r1 * r2 + 1e-4 && D < 0.0){
      float k = r1 / (r1 + r2);
      return mix(texelFetch(uPts, ivec2(i, 1), 0).xy, texelFetch(uPts, ivec2(j, 1), 0).xy, k);
    }
    float den = r1 * r2 + D;
    float t1 = A / (abs(den) < 1e-6 ? 1e-6 : den);
    float w = (t0 + t1) / r1;
    sw += w; acc += w * texelFetch(uPts, ivec2(i, 1), 0).xy;
    t0 = t1; d1 = d2; r1 = r2;
  }
  return abs(sw) < 1e-9 ? was : acc / sw;
}
void main(){
  vec2 gx = dFdx(vSt), gy = dFdy(vSt);
  vec2 fw = max(sqrt(gx * gx + gy * gy), vec2(1e-7)); // (fwidth reads a slanted side up to 1.4 times too soft)
  float cov = 1.0;
  if (uPoly == 0){
    vec2 c = clamp(min(vSt, 1.0 - vSt) / fw + 0.5, 0.0, 1.0);
    cov = c.x * c.y;
  }
  vec2 px = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  if (uHasMask > 0) cov *= texture(uMask, gl_FragCoord.xy / uSize).r;
  if (cov <= 0.0) discard;
  vec2 st = uPoly > 0 ? vSt : clamp(vSt, 0.0, 1.0);
  vec3 c;
  if (uCard > 0){
    vec2 cell = abs(fract(st * 8.0) - 0.5);
    vec2 ln = (0.5 - cell) / (fw * 8.0);
    float line = 1.0 - smoothstep(0.5, 1.5, min(ln.x, ln.y));
    vec2 q = floor(st * 8.0);
    c = uTint * (mod(q.x + q.y, 2.0) < 0.5 ? 0.16 : 0.3);
    c = mix(c, uTint, line * 0.75);
    vec2 e = min(st, 1.0 - st) / fw;
    float rim = 1.0 - smoothstep(2.5, 3.5, min(e.x, e.y));
    vec2 ps = uPs;
    vec2 m = (st - 0.5) * ps;
    float mw = max(length(vec2(dFdx(m.x), dFdy(m.x))), length(vec2(dFdx(m.y), dFdy(m.y))));
    float R = 0.42 * min(ps.x, ps.y);
    float ring = 1.0 - smoothstep(0.8, 1.8, abs(length(m) - R) / mw);
    float cross = 1.0 - smoothstep(0.5, 1.5, min(abs(st.x - 0.5) / fw.x, abs(st.y - 0.5) / fw.y));
    c = mix(c, vec3(1.0), max(max(rim, ring), cross * 0.8));
    float lw = min(ps.x * 0.7, ps.y * 1.4);
    vec2 l = m / vec2(lw, lw * 0.5) + 0.5;
    if (l.x > 0.0 && l.y > 0.0 && l.x < 1.0 && l.y < 1.0){ vec4 t = texture(uLabel, l); c = mix(c, t.rgb / max(t.a, 1e-3), t.a); }
    c *= uShow;
  } else {
    vec2 uv;
    if (uPoly > 0){
      vec2 q = pinned(px, st);
      uv = q;
    } else {
      vec3 h = uIn * vec3(st, 1.0);
      uv = h.xy / h.z;
    }
    uv = vec2(uv.x, 1.0 - uv.y);
    vec2 in01 = step(vec2(0.0), uv) * step(uv, vec2(1.0));
    c = texture(tex, uv).rgb * in01.x * in01.y;
    c = grade(c, uK, uRGB);
  }
  if (uEp.y > 0.0){
    vec4 x = vec4(st.x, 1.0 - st.x, st.y, 1.0 - st.y) / max(uEdge, vec4(1e-6));
    float v = 1.0, outside = 1.0;
    for (int i = 0; i < 4; i++) if (uEdge[i] > 0.0005){ v *= ramp(x[i]); if (x[i] < 1.0) outside = 0.0; }
    c *= pow(max(v, 0.0), uEp.y);
    float b = uEp.w * outside * uShow;
    c = c * (1.0 - b) + b;
  }
  o = vec4(c, 1.0) * (cov * uOpacity);
}`

const VS_FULL = `#version 300 es
in vec2 p; out vec2 v;
void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const FS_SCREEN = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D tex, uMask, uOver;
uniform vec3 uK, uRGB;
uniform int uHasMask, uHasOver;
${COLOR_FN}
void main(){
  vec3 c = grade(texture(tex, v).rgb, uK, uRGB);
  if (uHasMask > 0) c *= texture(uMask, v).r;
  if (uHasOver > 0){ vec4 t = texture(uOver, vec2(v.x, 1.0 - v.y)); c = c * (1.0 - t.a) + t.rgb; }
  o = vec4(c, 1.0);
}`

// A mask's outline as coverage : the distance to its nearest side (px), its sign
// by the crossings (even-odd).
const FS_MASK = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
uniform sampler2D uPts;
uniform int uN; uniform vec2 uSize; uniform float uSoft;
void main(){
  vec2 p = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  float d = 1e20; bool in_ = false;
  vec2 b = texelFetch(uPts, ivec2(uN - 1, 0), 0).xy;
  for (int i = 0; i < uN; i++){
    vec2 a = texelFetch(uPts, ivec2(i, 0), 0).xy;
    vec2 e = b - a, w = p - a;
    vec2 q = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    d = min(d, dot(q, q));
    if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) in_ = !in_;
    b = a;
  }
  float s = max(1.0, uSoft);
  float k = clamp((in_ ? sqrt(d) : -sqrt(d)) / s + 0.5, 0.0, 1.0);
  if (uSoft > 1.0) k = k * k * (3.0 - 2.0 * k);
  o = vec4(k);
}`

interface Mesh {
  warp: CxWarp
  w: number
  h: number
  vao: WebGLVertexArrayObject
  vb: WebGLBuffer
  ib: WebGLBuffer
  n: number
}
interface Baked {
  key: unknown[]
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
}
interface Label {
  text: string
  tex: WebGLTexture
}
interface Src {
  tex: WebGLTexture
  w: number
  h: number
  mip: boolean
}

export interface CxDrawOpts {
  /** slices to show, in order (the screen's, with solo and on / off applied) */
  slices: CxSlice[]
  brightness: number
  opacityOf: (s: CxSlice) => number
  /** the whole show's Black, 0..1 (the sources carry it already; the cards and the raised black do not) */
  show: number
  /** a number over the whole screen */
  identify: string | null
  /** each slice's number and color */
  tag: (s: CxSlice) => { n: number; rgb: [number, number, number] }
}

const same = (a: unknown[], b: unknown[]): boolean => a.length === b.length && a.every((v, i) => v === b[i])

export class CxRenderer {
  private gl: WebGL2RenderingContext
  private progs: { slice: WebGLProgram; screen: WebGLProgram; mask: WebGLProgram } | null = null
  private loc = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>()
  private fullVao: WebGLVertexArrayObject | null = null
  private blank: WebGLTexture | null = null
  private ptsTex: WebGLTexture | null = null
  private work: { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number } | null = null
  private meshes = new Map<string, Mesh>()
  private masks = new Map<string, Baked>()
  private labels = new Map<string, Label>()
  private srcs = new Map<CxSource, Src>()
  private over: { key: string; tex: WebGLTexture } | null = null
  private lost = false
  private off: () => void

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' })
    if (!gl) throw new Error('no WebGL in this window')
    this.gl = gl
    const lost = (e: Event): void => {
      e.preventDefault()
      this.lost = true
    }
    const back = (): void => {
      this.lost = false
      this.forget()
      this.init()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', back)
    this.off = () => {
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', back)
    }
    this.init()
  }

  get alive(): boolean {
    return !this.lost && !!this.progs
  }

  private forget(): void {
    this.progs = null
    this.loc.clear()
    this.meshes.clear()
    this.masks.clear()
    this.labels.clear()
    this.srcs.clear()
    this.over = null
    this.work = null
  }

  private init(): void {
    const gl = this.gl
    const compile = (vs: string, fs: string, attrs: string[]): WebGLProgram => {
      const p = gl.createProgram()!
      for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as Array<[number, string]>) {
        const sh = gl.createShader(t)!
        gl.shaderSource(sh, s)
        gl.compileShader(sh)
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('[complex] ' + gl.getShaderInfoLog(sh))
        gl.attachShader(p, sh)
      }
      attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a))
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('[complex] ' + gl.getProgramInfoLog(p))
      this.loc.set(p, new Map())
      return p
    }
    this.progs = { slice: compile(VS_SLICE, FS_SLICE, ['pos', 'st']), screen: compile(VS_FULL, FS_SCREEN, ['p']), mask: compile(VS_FULL, FS_MASK, ['p']) }
    this.fullVao = gl.createVertexArray()
    gl.bindVertexArray(this.fullVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.blank = this.texture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
    this.ptsTex = this.texture(gl.NEAREST)
  }

  private texture(filter: number = this.gl.LINEAR): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }
  private u(p: WebGLProgram, n: string): WebGLUniformLocation | null {
    const m = this.loc.get(p)!
    let l = m.get(n)
    if (l === undefined) m.set(n, (l = this.gl.getUniformLocation(p, n)))
    return l
  }

  /** A source's newest frame, straight from the engine's canvas (GPU to GPU; the
   *  rows flipped so the texture is bottom-up like any GL picture). */
  upload(key: CxSource, from: HTMLCanvasElement | OffscreenCanvas): void {
    if (!this.alive) return
    const gl = this.gl
    let s = this.srcs.get(key)
    if (!s) this.srcs.set(key, (s = { tex: this.texture(), w: 0, h: 0, mip: false }))
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, s.tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    if (s.w !== from.width || s.h !== from.height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, from)
      s.w = from.width
      s.h = from.height
      s.mip = false
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, from)
    if (s.mip) gl.generateMipmap(gl.TEXTURE_2D)
  }
  /** Sources no slice takes from any more give their memory back. */
  keepOnly(keys: Set<CxSource>): void {
    for (const [k, s] of this.srcs) {
      if (keys.has(k)) continue
      this.gl.deleteTexture(s.tex)
      this.srcs.delete(k)
    }
  }

  private mesh(s: CxSlice, w: number, h: number): Mesh {
    const gl = this.gl
    let m = this.meshes.get(s.id)
    if (m && m.warp === s.warp && m.w === w && m.h === h) return m
    const g = warpMesh(s.warp, 2 / Math.min(w, h))
    if (!m) {
      m = { warp: s.warp, w, h, vao: gl.createVertexArray()!, vb: gl.createBuffer()!, ib: gl.createBuffer()!, n: 0 }
      gl.bindVertexArray(m.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vb)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0)
      gl.enableVertexAttribArray(1)
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib)
      this.meshes.set(s.id, m)
    }
    gl.bindVertexArray(m.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vb)
    gl.bufferData(gl.ARRAY_BUFFER, g.v, gl.DYNAMIC_DRAW)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.DYNAMIC_DRAW)
    gl.bindVertexArray(null)
    Object.assign(m, { warp: s.warp, w, h, n: g.idx.length })
    return m
  }

  private points(rows: number[][]): void {
    const gl = this.gl
    const n = rows[0].length / 2
    const d = new Float32Array(n * 2 * rows.length)
    rows.forEach((r, i) => d.set(r, i * n * 2))
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.ptsTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, n, rows.length, 0, gl.RG, gl.FLOAT, d)
  }

  /** The masks of one thing as a coverage picture, drawn again only when they (or
   *  what carries them) change. Null : nothing masks it. */
  private mask(id: string, masks: CxMask[], warp: CxWarp | null, w: number, h: number, scale: number): WebGLTexture | null {
    const gl = this.gl
    const on = masks.filter((m) => m.on)
    const poly = warp?.type === 'poly' ? warp : null
    if (!on.length && !poly) {
      const b = this.masks.get(id)
      if (b) {
        gl.deleteTexture(b.tex)
        gl.deleteFramebuffer(b.fbo)
        this.masks.delete(id)
      }
      return null
    }
    const key = [masks, warp, w, h, scale]
    let b = this.masks.get(id)
    if (b && same(b.key, key)) return b.tex
    if (!b || b.w !== w || b.h !== h) {
      if (b) {
        gl.deleteTexture(b.tex)
        gl.deleteFramebuffer(b.fbo)
      }
      const tex = this.texture()
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, w, h)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      this.masks.set(id, (b = { key, tex, fbo, w, h }))
    }
    b.key = key
    const p = this.progs!.mask
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo)
    gl.viewport(0, 0, w, h)
    const first = on[0]?.mode === 'add' ? 0 : 1
    gl.clearColor(first, first, first, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(p)
    gl.bindVertexArray(this.fullVao)
    gl.uniform1i(this.u(p, 'uPts'), 2)
    gl.uniform2f(this.u(p, 'uSize'), w, h)
    gl.enable(gl.BLEND)
    const px = (line: number[]): number[] => line.map((v, i) => v * (i % 2 ? h : w))
    const draw = (line: number[], soft: number): void => {
      this.points([px(line)])
      gl.uniform1i(this.u(p, 'uN'), line.length / 2)
      gl.uniform1f(this.u(p, 'uSoft'), soft * scale)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    for (const m of on) {
      if (m.mode === 'add') {
        gl.blendEquation(gl.MAX)
        gl.blendFunc(gl.ONE, gl.ONE)
      } else {
        gl.blendEquation(gl.FUNC_ADD)
        gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR)
      }
      draw(warp ? maskOnScreen(warp, m) : flattenMask(m), m.soft)
    }
    if (poly) {
      // its own outline, over them all
      gl.blendEquation(gl.MIN)
      gl.blendFunc(gl.ONE, gl.ONE)
      draw(poly.pts, 0)
    }
    gl.blendEquation(gl.FUNC_ADD)
    gl.disable(gl.BLEND)
    return b.tex
  }

  private label(s: CxSlice, n: number): WebGLTexture {
    const gl = this.gl
    const text = `${n}\n${s.name}`
    let l = this.labels.get(s.id)
    if (l && l.text === text) return l.tex
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 256
    const d = c.getContext('2d')!
    d.textAlign = 'center'
    d.textBaseline = 'middle'
    d.lineJoin = 'round'
    const put = (t: string, size: number, y: number, lw: number): void => {
      d.font = `700 ${size}px ui-monospace, Consolas, monospace`
      while (d.measureText(t).width > 490 && size > 12) d.font = `700 ${(size -= 2)}px ui-monospace, Consolas, monospace`
      d.lineWidth = lw
      d.strokeStyle = '#000'
      d.strokeText(t, 256, y)
      d.fillStyle = '#fff'
      d.fillText(t, 256, y)
    }
    put(String(n), 140, 92, 14)
    put(s.name, 52, 206, 10)
    if (!l) this.labels.set(s.id, (l = { text, tex: this.texture() }))
    l.text = text
    gl.bindTexture(gl.TEXTURE_2D, l.tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    return l.tex
  }

  /** What is written over a whole screen : its test card, its number. */
  private overlay(sc: CxScreen, identify: string | null, w: number, h: number): WebGLTexture | null {
    const gl = this.gl
    if (!sc.card && !identify) {
      if (this.over) {
        gl.deleteTexture(this.over.tex)
        this.over = null
      }
      return null
    }
    const key = [sc.card, identify, w, h, sc.w, sc.h, sc.name].join('|')
    if (this.over?.key === key) return this.over.tex
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const d = c.getContext('2d')!
    const k = h / 1080
    const text = (t: string, x: number, y: number, size: number): void => {
      d.font = `600 ${size}px ui-monospace, Consolas, monospace`
      d.textAlign = 'center'
      d.textBaseline = 'middle'
      d.lineJoin = 'round'
      d.lineWidth = Math.max(2, size / 8)
      d.strokeStyle = '#000'
      d.strokeText(t, x, y)
      d.fillStyle = '#fff'
      d.fillText(t, x, y)
    }
    if (sc.card) {
      d.strokeStyle = 'rgba(255,255,255,0.28)'
      d.lineWidth = 1
      const step = h / 9
      d.beginPath()
      for (let x = w / 2; x < w; x += step) for (const q of [x, w - x]) { d.moveTo(Math.round(q) + 0.5, 0); d.lineTo(Math.round(q) + 0.5, h) }
      for (let y = h / 2; y < h; y += step) for (const q of [y, h - y]) { d.moveTo(0, Math.round(q) + 0.5); d.lineTo(w, Math.round(q) + 0.5) }
      d.stroke()
      // the last row and column of pixels on every side : all four must be seen
      d.strokeStyle = '#fff'
      d.strokeRect(0.5, 0.5, w - 1, h - 1)
      d.strokeStyle = '#ff3b30'
      d.strokeRect(1.5, 1.5, w - 3, h - 3)
      d.strokeStyle = 'rgba(255,255,255,0.8)'
      d.lineWidth = Math.max(1, 2 * k)
      const ring = (x: number, y: number, r: number): void => {
        d.beginPath()
        d.arc(x, y, r, 0, Math.PI * 2)
        d.stroke()
      }
      ring(w / 2, h / 2, h * 0.46)
      for (const x of [step, w - step]) for (const y of [step, h - step]) ring(x, y, step * 0.9)
      // gray steps (equal ones, black to white) and the primaries
      const bw = Math.min(w * 0.5, h * 0.8), bx = (w - bw) / 2, by = h * 0.74, bh = h * 0.05
      for (let i = 0; i < 16; i++) {
        const g = Math.round((i / 15) * 255)
        d.fillStyle = `rgb(${g},${g},${g})`
        d.fillRect(bx + (i * bw) / 16, by, bw / 16 + 1, bh)
      }
      ;['#f00', '#0f0', '#00f', '#0ff', '#f0f', '#ff0', '#fff', '#000'].forEach((q, i) => {
        d.fillStyle = q
        d.fillRect(bx + (i * bw) / 8, by + bh, bw / 8 + 1, bh * 0.7)
      })
      text(sc.name, w / 2, h * 0.13, 54 * k)
      text(`${sc.w} × ${sc.h}`, w / 2, h * 0.195, 34 * k)
    }
    if (identify) {
      const r = h * 0.3
      d.fillStyle = 'rgba(0,0,0,0.72)'
      d.beginPath()
      d.roundRect(w / 2 - r * 1.2, h / 2 - r, r * 2.4, r * 2, r * 0.15)
      d.fill()
      text(identify, w / 2, h / 2 - r * 0.12, r * 1.3)
      text(sc.name, w / 2, h / 2 + r * 0.72, r * 0.2)
    }
    if (!this.over) this.over = { key, tex: this.texture() }
    this.over.key = key
    gl.bindTexture(gl.TEXTURE_2D, this.over.tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    return this.over.tex
  }

  private color(p: WebGLProgram, c: CxColor, brightness = c.brightness): void {
    this.gl.uniform3f(this.u(p, 'uK'), brightness, c.contrast, c.gamma)
    this.gl.uniform3f(this.u(p, 'uRGB'), c.r, c.g, c.b)
  }

  /** The screen, drawn whole (at the canvas's own size : a smaller one previews it). */
  draw(sc: CxScreen, opt: CxDrawOpts): void {
    if (!this.alive) return
    const gl = this.gl
    const w = this.canvas.width, h = this.canvas.height
    const scale = h / sc.h
    const P = this.progs!
    // what is masked is baked first : its targets must not be bound in the draw below
    const baked = opt.slices.map((s) => this.mask(s.id, s.masks, s.warp, w, h, scale))
    const screenMask = this.mask('screen', sc.masks, null, w, h, scale)
    const over = this.overlay(sc, opt.identify, w, h)
    if (!this.work || this.work.w !== w || this.work.h !== h) {
      if (this.work) {
        gl.deleteTexture(this.work.tex)
        gl.deleteFramebuffer(this.work.fbo)
      }
      const tex = this.texture(gl.NEAREST)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB10_A2, w, h) // (two steps finer than what it is shown in)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      this.work = { tex, fbo, w, h }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.work.fbo)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const p = P.slice
    for (let i = 0; i < opt.slices.length; i++) {
      const s = opt.slices[i]
      const opacity = opt.opacityOf(s)
      if (opacity <= 0.0005) continue
      const m = this.mesh(s, w, h)
      const tag = opt.tag(s)
      const poly = s.warp.type === 'poly' ? s.warp.pts.length / 2 : 0
      if (poly) this.points([s.warp.pts.map((v, k) => v * (k % 2 ? h : w)), polyInput(s)])
      const label = sc.card ? this.label(s, tag.n) : null
      const src = this.srcs.get(s.source)
      gl.useProgram(p)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, src?.tex ?? this.blank)
      if (src && src.w) {
        // shown much smaller than it is : read through its mip levels
        const ib = bounds(s.input), area = polyArea(warpOutline(s.warp)) * w * h
        const down = (ib.w * src.w * ib.h * src.h) / Math.max(1, area) > 2.5
        if (down && !src.mip) {
          src.mip = true
          gl.generateMipmap(gl.TEXTURE_2D)
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, down ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
      }
      gl.uniform1i(this.u(p, 'tex'), 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, baked[i] ?? this.blank)
      gl.uniform1i(this.u(p, 'uMask'), 1)
      gl.uniform1i(this.u(p, 'uPts'), 2)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, poly ? this.ptsTex : this.blank)
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, label ?? this.blank)
      gl.uniform1i(this.u(p, 'uLabel'), 3)
      gl.uniform1i(this.u(p, 'uHasMask'), baked[i] ? 1 : 0)
      gl.uniform1i(this.u(p, 'uPoly'), poly)
      gl.uniform1i(this.u(p, 'uCard'), sc.card ? 1 : 0)
      gl.uniform3fv(this.u(p, 'uTint'), tag.rgb)
      if (sc.card) {
        const side = (s0: number, t0: number, s1: number, t1: number): number => {
          const a = evalWarp(s.warp, s0, t0), b = evalWarp(s.warp, s1, t1)
          return Math.hypot((a[0] - b[0]) * w, (a[1] - b[1]) * h)
        }
        gl.uniform2f(this.u(p, 'uPs'), (side(0, 0, 1, 0) + side(0, 1, 1, 1)) / 2, (side(0, 0, 0, 1) + side(1, 0, 1, 1)) / 2)
      }
      gl.uniform2f(this.u(p, 'uSize'), w, h)
      gl.uniform1f(this.u(p, 'uOpacity'), opacity)
      gl.uniform1f(this.u(p, 'uShow'), opt.show)
      gl.uniformMatrix3fv(this.u(p, 'uIn'), true, inputMap(s))
      const e = s.edges
      gl.uniform4f(this.u(p, 'uEdge'), e.l, e.r, e.t, e.b)
      gl.uniform4f(this.u(p, 'uEp'), e.power, e.on ? 1 / e.gamma : 0, e.lum, e.black)
      this.color(p, s)
      gl.bindVertexArray(m.vao)
      gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0)
    }
    gl.disable(gl.BLEND)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
    const q = P.screen
    gl.useProgram(q)
    gl.bindVertexArray(this.fullVao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.work.tex)
    gl.uniform1i(this.u(q, 'tex'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, screenMask ?? this.blank)
    gl.uniform1i(this.u(q, 'uMask'), 1)
    gl.uniform1i(this.u(q, 'uHasMask'), screenMask ? 1 : 0)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, over ?? this.blank)
    gl.uniform1i(this.u(q, 'uOver'), 3)
    gl.uniform1i(this.u(q, 'uHasOver'), over ? 1 : 0)
    this.color(q, sc, opt.brightness)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
    gl.flush()
    if (this.meshes.size > opt.slices.length + 16) this.sweep(new Set(sc.slices.map((s) => s.id)))
  }

  /** Slices that are gone give back what was made for them. */
  private sweep(ids: Set<string>): void {
    const gl = this.gl
    for (const [id, m] of this.meshes) {
      if (ids.has(id)) continue
      gl.deleteVertexArray(m.vao)
      gl.deleteBuffer(m.vb)
      gl.deleteBuffer(m.ib)
      this.meshes.delete(id)
    }
    for (const [id, l] of this.labels) if (!ids.has(id)) { gl.deleteTexture(l.tex); this.labels.delete(id) }
    for (const [id, b] of this.masks) {
      if (ids.has(id) || id === 'screen') continue
      gl.deleteTexture(b.tex)
      gl.deleteFramebuffer(b.fbo)
      this.masks.delete(id)
    }
  }

  /** The window closes : the context goes with it. */
  dispose(): void {
    this.off()
    this.forget()
    this.lost = true
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
