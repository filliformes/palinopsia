// NcaSource : a neural cellular automaton texture (the native generator
// 'gen-nca', "Grown"). A grid of cells, each holding 12 numbers (the first 3 are
// the visible colour); every step each cell reads its 3x3 neighbourhood through
// four fixed filters (identity, Sobel x / y, Laplacian), runs the 48 values
// through a tiny trained network (48 -> 96 ReLU -> 12) and adds the result, on a
// random half of the cells. Trained offline on a CC0 scan
// (tools/nca/train_texture_nca.py, after Niklasson et al., "Self-Organising
// Textures", Distill 2021), it grows that texture from an empty grid, keeps it
// alive, and heals where it is damaged.
//
// GL : 12 channels = three RGBA32F targets written at once (MRT), ping-pong; the
// 5,856 weights sit in a uniform buffer (23 KB : fine on ANGLE, whose limit is
// 64 KB) so every cell reads them from the constant cache. The grid wraps (a
// torus, as in training). Display is a bilinear upscale of the first 3 channels.

import { handle, type TextureHandle } from './isfTextureBridge'

export interface NcaTexture {
  id: string // file under public/nca/<id>.bin
  name: string // label (the header's LABELS must match this order)
}

// ORDER IS THE ENUM (the `texture` input's VALUES index into it). Append only.
export const NCA_TEXTURES: NcaTexture[] = [
  { id: 'lava', name: 'lava' },
  { id: 'moss-rock', name: 'mossy rock' },
  { id: 'bark', name: 'bark' }
]

const N_W = 5856 // floats : W1 4608 + B1 96 + W2 1152

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const STEP_FS = `#version 300 es
precision highp float; precision highp int;
layout(std140) uniform Weights { vec4 W1[1152]; vec4 B1[24]; vec4 W2[288]; };
uniform highp sampler2D uS0, uS1, uS2;
uniform ivec2 uN;
uniform uint uSalt;
uniform vec4 uDamage;   // centre (cells), radius (cells), 1 = clear the whole grid
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
uint pcg(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (uDamage.w > 0.5) { o0 = vec4(0.0); o1 = vec4(0.0); o2 = vec4(0.0); return; }
  if (uDamage.z > 0.0) {
    vec2 d = abs(vec2(c) - uDamage.xy);
    d = min(d, vec2(uN) - d);                           // wrapped distance
    if (dot(d, d) < uDamage.z * uDamage.z) { o0 = vec4(0.0); o1 = vec4(0.0); o2 = vec4(0.0); return; }
  }
  // Perception : identity, Sobel x, Sobel y, Laplacian over the 3x3 (torus).
  vec4 i0 = vec4(0.0), i1 = vec4(0.0), i2 = vec4(0.0);
  vec4 x0 = vec4(0.0), x1 = vec4(0.0), x2 = vec4(0.0);
  vec4 y0 = vec4(0.0), y1 = vec4(0.0), y2 = vec4(0.0);
  vec4 l0 = vec4(0.0), l1 = vec4(0.0), l2 = vec4(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 q = (c + ivec2(dx, dy) + uN) % uN;
      vec4 a = texelFetch(uS0, q, 0), b = texelFetch(uS1, q, 0), e = texelFetch(uS2, q, 0);
      float kx = float(dx) * (dy == 0 ? 2.0 : 1.0);
      float ky = float(dy) * (dx == 0 ? 2.0 : 1.0);
      float kl = (dx == 0 && dy == 0) ? -12.0 : ((dx == 0 || dy == 0) ? 2.0 : 1.0);
      x0 += kx * a; x1 += kx * b; x2 += kx * e;
      y0 += ky * a; y1 += ky * b; y2 += ky * e;
      l0 += kl * a; l1 += kl * b; l2 += kl * e;
      if (dx == 0 && dy == 0) { i0 = a; i1 = b; i2 = e; }
    }
  }
  // Per-channel perception vectors (channel-major, as in training).
  vec4 pc[12];
  pc[0] = vec4(i0.x, x0.x, y0.x, l0.x); pc[1] = vec4(i0.y, x0.y, y0.y, l0.y);
  pc[2] = vec4(i0.z, x0.z, y0.z, l0.z); pc[3] = vec4(i0.w, x0.w, y0.w, l0.w);
  pc[4] = vec4(i1.x, x1.x, y1.x, l1.x); pc[5] = vec4(i1.y, x1.y, y1.y, l1.y);
  pc[6] = vec4(i1.z, x1.z, y1.z, l1.z); pc[7] = vec4(i1.w, x1.w, y1.w, l1.w);
  pc[8] = vec4(i2.x, x2.x, y2.x, l2.x); pc[9] = vec4(i2.y, x2.y, y2.y, l2.y);
  pc[10] = vec4(i2.z, x2.z, y2.z, l2.z); pc[11] = vec4(i2.w, x2.w, y2.w, l2.w);
  vec4 u0 = vec4(0.0), u1 = vec4(0.0), u2 = vec4(0.0);
  for (int j = 0; j < 96; j++) {
    vec4 bb = B1[j >> 2];
    int jm = j & 3;
    float h = jm == 0 ? bb.x : jm == 1 ? bb.y : jm == 2 ? bb.z : bb.w;
    int base = j * 12;
    for (int k = 0; k < 12; k++) h += dot(W1[base + k], pc[k]);
    h = max(h, 0.0);
    u0 += h * W2[j * 3]; u1 += h * W2[j * 3 + 1]; u2 += h * W2[j * 3 + 2];
  }
  // Stochastic update : a random half of the cells fire each step.
  uint r = pcg(uint(c.x) * 73856093u ^ uint(c.y) * 19349663u ^ uSalt);
  float m = (r & 1u) == 1u ? 1.0 : 0.0;
  // Training penalised any state outside [-1, 1] (the overflow loss), so the
  // rule was only ever learnt inside that box. Hold it there : a damaged edge
  // otherwise drives a few cells out of range and the runaway eats the grid.
  o0 = clamp(i0 + u0 * m, -1.0, 1.0); o1 = clamp(i1 + u1 * m, -1.0, 1.0); o2 = clamp(i2 + u2 * m, -1.0, 1.0);
}`

const SHOW_FS = `#version 300 es
precision highp float; precision highp int;
in vec2 vUV; out vec4 frag;
uniform highp sampler2D uS0;
uniform ivec2 uN;
uniform vec2 uOffset;      // slow drift, in cells
uniform float uColour, uBright;
vec3 at(ivec2 q) { q = (q % uN + uN) % uN; return texelFetch(uS0, q, 0).rgb; }
void main(){
  // Grid row 0 is the TOP of the training image (torch order) : flip for display.
  vec2 g = vec2(vUV.x, 1.0 - vUV.y) * vec2(uN) - 0.5 + uOffset;
  vec2 f = fract(g);
  ivec2 b = ivec2(floor(g));
  // Catmull-Rom bicubic over 4x4 cells : the grid is magnified ~5x on a 1080p
  // frame, and a (smoothstep-)bilinear read flattens at every cell centre, which
  // reads as blocks. Bicubic keeps the grown detail continuous and crisp.
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = -0.5 * f3 + f2 - 0.5 * f;
  vec2 w1 = 1.5 * f3 - 2.5 * f2 + 1.0;
  vec2 w2 = -1.5 * f3 + 2.0 * f2 + 0.5 * f;
  vec2 w3 = 0.5 * f3 - 0.5 * f2;
  vec3 c = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    float wy = j == 0 ? w0.y : j == 1 ? w1.y : j == 2 ? w2.y : w3.y;
    vec3 row = at(b + ivec2(-1, j - 1)) * w0.x + at(b + ivec2(0, j - 1)) * w1.x
             + at(b + ivec2(1, j - 1)) * w2.x + at(b + ivec2(2, j - 1)) * w3.x;
    c += row * wy;
  }
  c = clamp(c + 0.5, 0.0, 1.0);
  float grey = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(grey), c, uColour) * uBright;
  frag = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

interface Target {
  fbo: WebGLFramebuffer
  tex: WebGLTexture[]
}

export class NcaSource {
  private gl: WebGL2RenderingContext
  private stepProg: WebGLProgram
  private showProg: WebGLProgram
  private vao: WebGLVertexArrayObject
  private quad: WebGLBuffer
  private ubo: WebGLBuffer
  private uStep: Record<string, WebGLUniformLocation | null> = {}
  private uShow: Record<string, WebGLUniformLocation | null> = {}
  private targets: [Target, Target] | null = null
  private cur = 0
  private gw = 0
  private gh = 0
  private weightsFor = -1 // texture index whose weights are in the UBO (-1 = none yet)
  private loading = -1
  private cache = new Map<number, Float32Array>()
  private inputs: Record<string, number> = {
    texture: 0, cells: 216, speed: 90, colour: 1, bright: 1, drift: 0, damage: 0, reseed: 0
  }
  private prevDamage = 0
  private prevReseed = 0
  private pendingDamage = false
  private pendingClear = true
  private acc = 0
  private last = 0
  private stepN = 0
  private offset = [0, 0]
  ok = true

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    this.gl = gl
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[nca] compile:', gl.getShaderInfoLog(s))
        this.ok = false
      }
      return s
    }
    const link = (fs: string): WebGLProgram => {
      const p = gl.createProgram()!
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VS))
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
      gl.bindAttribLocation(p, 0, 'p')
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error('[nca] link:', gl.getProgramInfoLog(p))
        this.ok = false
      }
      return p
    }
    this.stepProg = link(STEP_FS)
    this.showProg = link(SHOW_FS)
    for (const n of ['uS0', 'uS1', 'uS2', 'uN', 'uSalt', 'uDamage'])
      this.uStep[n] = gl.getUniformLocation(this.stepProg, n)
    for (const n of ['uS0', 'uN', 'uOffset', 'uColour', 'uBright'])
      this.uShow[n] = gl.getUniformLocation(this.showProg, n)
    const bi = gl.getUniformBlockIndex(this.stepProg, 'Weights')
    gl.uniformBlockBinding(this.stepProg, bi, 3)
    this.ubo = gl.createBuffer()!
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo)
    gl.bufferData(gl.UNIFORM_BUFFER, N_W * 4, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.UNIFORM_BUFFER, null)
    // Own VAO : never touch the default one (the ISF runtime's attribute 0).
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
  }

  update(inputs: Record<string, number | number[]>): void {
    for (const [k, v] of Object.entries(inputs)) if (typeof v === 'number') this.setInput(k, v)
  }

  setInput(name: string, value: number | number[]): void {
    if (typeof value !== 'number') return
    if (name === 'damage') {
      if (value > 0.5 && this.prevDamage <= 0.5) this.pendingDamage = true
      this.prevDamage = value
    } else if (name === 'reseed') {
      if (value > 0.5 && this.prevReseed <= 0.5) this.pendingClear = true
      this.prevReseed = value
    }
    this.inputs[name] = value
  }

  private ensureGrid(): void {
    const gh = Math.max(32, Math.min(400, Math.round(this.inputs.cells)))
    const gw = Math.max(32, Math.round((gh * this.w) / Math.max(1, this.h)))
    if (this.targets && gw === this.gw && gh === this.gh) return
    const gl = this.gl
    this.disposeTargets()
    const mk = (): Target => {
      const tex: WebGLTexture[] = []
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      for (let i = 0; i < 3; i++) {
        const t = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, gw, gh, 0, gl.RGBA, gl.FLOAT, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0)
        tex.push(t)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return { fbo, tex }
    }
    this.targets = [mk(), mk()]
    this.gw = gw
    this.gh = gh
    this.pendingClear = true
  }

  private weights(idx: number): Float32Array | null {
    const got = this.cache.get(idx)
    if (got) return got
    if (this.loading !== idx) {
      this.loading = idx
      const tex = NCA_TEXTURES[idx] ?? NCA_TEXTURES[0]
      const url = new URL(`nca/${tex.id}.bin`, document.baseURI).href
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((buf) => {
          if (buf.byteLength !== N_W * 4) throw new Error(`bad size ${buf.byteLength}`)
          this.cache.set(idx, new Float32Array(buf))
        })
        .catch((e) => console.error('[nca] weights', tex.id, e))
    }
    return null
  }

  /** `clockSec` is the layer's own clock (the background's on the slab), so
   *  layer Speed, global speed and freeze pace the growth; the wall clock is
   *  only the fallback when no clock is passed. Reverse just holds. */
  render(targetFbo: WebGLFramebuffer, clockSec?: number): void {
    const gl = this.gl
    this.ensureGrid()
    const now = typeof clockSec === 'number' ? clockSec : performance.now() / 1000
    const dt = this.last > 0 ? Math.max(0, Math.min(0.1, now - this.last)) : 1 / 60
    this.last = now > 0 ? now : 1e-6
    const idx = Math.max(0, Math.min(NCA_TEXTURES.length - 1, Math.round(this.inputs.texture)))
    const W = this.weights(idx)
    if (W && this.weightsFor !== idx) {
      gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo)
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, W)
      gl.bindBuffer(gl.UNIFORM_BUFFER, null)
      if (this.weightsFor !== -1) this.pendingClear = true // a new texture grows afresh
      this.weightsFor = idx
    }
    gl.bindVertexArray(this.vao)
    if (W && this.targets && this.ok) {
      // Steps this frame from the wall clock (the same speed at any frame rate).
      this.acc += dt * Math.max(0, this.inputs.speed)
      let n = Math.min(8, Math.floor(this.acc))
      this.acc -= n
      if (this.pendingClear) n = Math.max(n, 1)
      gl.useProgram(this.stepProg)
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 3, this.ubo)
      gl.uniform2i(this.uStep.uN, this.gw, this.gh)
      gl.viewport(0, 0, this.gw, this.gh)
      for (let s = 0; s < n; s++) {
        const src = this.targets[this.cur]
        const dst = this.targets[1 - this.cur]
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2])
        for (let i = 0; i < 3; i++) {
          gl.activeTexture(gl.TEXTURE0 + i)
          gl.bindTexture(gl.TEXTURE_2D, src.tex[i])
        }
        gl.uniform1i(this.uStep.uS0, 0)
        gl.uniform1i(this.uStep.uS1, 1)
        gl.uniform1i(this.uStep.uS2, 2)
        gl.uniform1ui(this.uStep.uSalt, (Math.imul(++this.stepN, 0x9e3779b1) >>> 0))
        if (this.pendingClear) {
          gl.uniform4f(this.uStep.uDamage, 0, 0, 0, 1)
          this.pendingClear = false
        } else if (this.pendingDamage) {
          const r = this.gh * (0.08 + 0.1 * Math.random())
          gl.uniform4f(this.uStep.uDamage, Math.random() * this.gw, Math.random() * this.gh, r, 0)
          this.pendingDamage = false
        } else {
          gl.uniform4f(this.uStep.uDamage, 0, 0, 0, 0)
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        this.cur = 1 - this.cur
      }
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 3, null)
      for (let i = 2; i >= 0; i--) {
        gl.activeTexture(gl.TEXTURE0 + i)
        gl.bindTexture(gl.TEXTURE_2D, null)
      }
    }
    // Present : the visible channels, upscaled.
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0])
    gl.viewport(0, 0, this.w, this.h)
    if (!W || !this.targets) {
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    } else {
      this.offset[0] += dt * this.inputs.drift * 2
      gl.useProgram(this.showProg)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.targets[this.cur].tex[0])
      gl.uniform1i(this.uShow.uS0, 0)
      gl.uniform2i(this.uShow.uN, this.gw, this.gh)
      gl.uniform2f(this.uShow.uOffset, this.offset[0], this.offset[1])
      gl.uniform1f(this.uShow.uColour, this.inputs.colour)
      gl.uniform1f(this.uShow.uBright, this.inputs.bright)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null)
  }

  /** The live grid's first texture (debug / tests). */
  debugTexture(): TextureHandle | null {
    return this.targets ? handle(this.targets[this.cur].tex[0], this.gw, this.gh) : null
  }

  private disposeTargets(): void {
    const gl = this.gl
    if (!this.targets) return
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fbo)
      for (const x of t.tex) gl.deleteTexture(x)
    }
    this.targets = null
  }

  dispose(): void {
    const gl = this.gl
    this.disposeTargets()
    gl.deleteProgram(this.stepProg)
    gl.deleteProgram(this.showProg)
    gl.deleteBuffer(this.ubo)
    gl.bindVertexArray(this.vao)
    gl.deleteBuffer(this.quad)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(this.vao)
  }
}
