// DepthShadow : a contact/drop shadow the FOREGROUND casts onto the Background,
// for separation and depth. Bright foreground content (text, particles, shapes,
// figures on a ground) is blurred + offset and used to DARKEN the background in a
// soft halo around it : so the layers read as lifted above the background plane.
//
// Applied once, right after the background composites and BEFORE the layers do,
// so the shadow sits in the background and the foreground lands on top of it.
// A no-op at depth 0. Presence is luma-based (weighted by each layer's opacity),
// so a full-frame generator barely shadows while a figure-on-black casts a clear
// halo : exactly where depth reads.

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

// Foreground presence = max opacity-weighted luma across the four layers.
const MASK_FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uL0, uL1, uL2, uL3; uniform vec4 uW;
float L(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  float p = 0.0;
  p = max(p, L(texture(uL0, vUV).rgb) * uW.x);
  p = max(p, L(texture(uL1, vUV).rgb) * uW.y);
  p = max(p, L(texture(uL2, vUV).rgb) * uW.z);
  p = max(p, L(texture(uL3, vUV).rgb) * uW.w);
  o = vec4(p, p, p, 1.0);
}`

const BLUR_FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex; uniform vec2 uStep; uniform float uRadius;
void main(){
  float acc = 0.0, wsum = 0.0; int R = int(uRadius);
  for (int i = -R; i <= R; i++){
    float w = 1.0 - abs(float(i)) / (uRadius + 1.0);
    acc += texture(uTex, vUV + uStep * float(i)).r * w; wsum += w;
  }
  o = vec4(vec3(acc / max(wsum, 1e-4)), 1.0);
}`

// Darken the background by the offset, blurred presence (minus its own core so it
// reads as a HALO the foreground then covers, not a flat wash under everything).
const APPLY_FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uBg, uMask; uniform float uDepth; uniform vec2 uOffset;
void main(){
  vec3 bg = texture(uBg, vUV).rgb;
  float halo = texture(uMask, vUV + uOffset).r;
  float core = texture(uMask, vUV).r;
  float shadow = clamp(halo - core * 0.5, 0.0, 1.0);
  bg *= 1.0 - clamp(uDepth, 0.0, 1.0) * 0.85 * shadow;
  o = vec4(bg, 1.0);
}`

interface Prog {
  prog: WebGLProgram
  u: (n: string) => WebGLUniformLocation | null
}
interface Buf {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
}

export class DepthShadow {
  private quad: WebGLBuffer
  private mask: Prog
  private blur: Prog
  private applyP: Prog
  private a: Buf | null = null
  private b: Buf | null = null
  private hw = 0
  private hh = 0

  constructor(private gl: WebGL2RenderingContext) {
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    this.mask = this.build(MASK_FS)
    this.blur = this.build(BLUR_FS)
    this.applyP = this.build(APPLY_FS)
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      console.error('[depth] shader compile:', gl.getShaderInfoLog(s))
    return s
  }

  private build(fs: string): Prog {
    const gl = this.gl
    const prog = gl.createProgram()!
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(prog, 0, 'p')
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      console.error('[depth] link:', gl.getProgramInfoLog(prog))
    const cache = new Map<string, WebGLUniformLocation | null>()
    return {
      prog,
      u: (n) => {
        if (!cache.has(n)) cache.set(n, gl.getUniformLocation(prog, n))
        return cache.get(n)!
      }
    }
  }

  private makeBuf(w: number, h: number): Buf {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { fbo, tex }
  }

  private ensure(hw: number, hh: number): void {
    if (this.hw === hw && this.hh === hh) return
    const gl = this.gl
    for (const buf of [this.a, this.b]) {
      if (buf) {
        gl.deleteTexture(buf.tex)
        gl.deleteFramebuffer(buf.fbo)
      }
    }
    this.a = this.makeBuf(hw, hh)
    this.b = this.makeBuf(hw, hh)
    this.hw = hw
    this.hh = hh
  }

  private use(p: Prog): void {
    const gl = this.gl
    gl.useProgram(p.prog)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  }

  /** Render `bgTex` darkened by the foreground's shadow into `targetFbo`. */
  apply(
    bgTex: WebGLTexture,
    layerTex: WebGLTexture[],
    weights: number[],
    depth: number,
    targetFbo: WebGLFramebuffer,
    w: number,
    h: number
  ): void {
    const gl = this.gl
    const hw = Math.max(2, Math.floor(w / 2))
    const hh = Math.max(2, Math.floor(h / 2))
    this.ensure(hw, hh)
    const a = this.a!
    const b = this.b!
    const draw = (fbo: WebGLFramebuffer, vw: number, vh: number): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.viewport(0, 0, vw, vh)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const bind = (unit: number, tex: WebGLTexture): void => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
    }

    // 1) presence mask at half-res.
    this.use(this.mask)
    for (let i = 0; i < 4; i++) bind(i, layerTex[i] ?? layerTex[0])
    gl.uniform1i(this.mask.u('uL0'), 0)
    gl.uniform1i(this.mask.u('uL1'), 1)
    gl.uniform1i(this.mask.u('uL2'), 2)
    gl.uniform1i(this.mask.u('uL3'), 3)
    gl.uniform4f(this.mask.u('uW'), weights[0] ?? 0, weights[1] ?? 0, weights[2] ?? 0, weights[3] ?? 0)
    draw(a.fbo, hw, hh)

    // 2) separable blur : bigger + softer with depth.
    const radius = 2 + depth * 8
    this.use(this.blur)
    bind(0, a.tex)
    gl.uniform1i(this.blur.u('uTex'), 0)
    gl.uniform1f(this.blur.u('uRadius'), radius)
    gl.uniform2f(this.blur.u('uStep'), 1 / hw, 0)
    draw(b.fbo, hw, hh)
    bind(0, b.tex)
    gl.uniform2f(this.blur.u('uStep'), 0, 1 / hh)
    draw(a.fbo, hw, hh)

    // 3) darken the background by the offset shadow → target.
    this.use(this.applyP)
    bind(0, bgTex)
    bind(1, a.tex)
    gl.uniform1i(this.applyP.u('uBg'), 0)
    gl.uniform1i(this.applyP.u('uMask'), 1)
    gl.uniform1f(this.applyP.u('uDepth'), depth)
    // Shadow falls down-right; engine space is bottom-left, so down = -y. Longer
    // with depth for a lifted, further-above feel.
    const off = 0.004 * (0.5 + depth)
    gl.uniform2f(this.applyP.u('uOffset'), off, -off)
    draw(targetFbo, w, h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteBuffer(this.quad)
    for (const p of [this.mask, this.blur, this.applyP]) gl.deleteProgram(p.prog)
    for (const buf of [this.a, this.b]) {
      if (buf) {
        gl.deleteTexture(buf.tex)
        gl.deleteFramebuffer(buf.fbo)
      }
    }
  }
}
