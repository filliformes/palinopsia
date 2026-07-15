// Strobe-safety limiter : a photosensitive-safety net on the FINAL presented frame
// (after the finalizer / Cameraless / xfade). Every frame it measures the full-field
// MEAN LUMINANCE and slew-limits how far it may jump from the previous presented
// frame : if the whole picture would flash (a big mean-luminance step), the output
// is blended back toward the last frame so the step stays within a cap. Localized
// motion (small mean change) passes through untouched; only large full-field flashes
// are damped, which also caps the flash RATE (you can't strobe fast if each step is
// small). All on the GPU (no readback stall). Runs on the preview AND the output
// window (each Compositor owns one), so the projection is protected too.

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

// Mean luminance of the frame, sampled on an N×N grid → a 1×1 target.
const F_MEASURE = `#version 300 es
precision highp float; out vec4 frag;
uniform sampler2D uTex;
const int N = 8;
void main(){
  float sum = 0.0;
  for (int y = 0; y < N; y++) for (int x = 0; x < N; x++) {
    vec2 uv = (vec2(float(x), float(y)) + 0.5) / float(N);
    sum += dot(texture(uTex, uv).rgb, vec3(0.299, 0.587, 0.114));
  }
  float m = sum / float(N * N);
  frag = vec4(m, m, m, 1.0);
}`

// Slew-limit the tracked mean : newMean moves toward the current mean by at most
// `cap` (1×1 → 1×1). alpha is the fraction of the step allowed.
const F_MEANUPD = `#version 300 es
precision highp float; out vec4 frag;
uniform sampler2D uCur, uPrev; uniform float uCap;
void main(){
  float cur = texture(uCur, vec2(0.5)).r;
  float prev = texture(uPrev, vec2(0.5)).r;
  float ad = abs(cur - prev);
  float alpha = ad <= uCap ? 1.0 : uCap / max(ad, 1e-5);
  float nm = prev + alpha * (cur - prev);
  frag = vec4(nm, nm, nm, 1.0);
}`

// Blend the live frame back toward the previous safe frame by the same alpha, so
// the presented full-field brightness moves at most `cap`.
const F_LIMIT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag;
uniform sampler2D uSrc, uSafe, uCur, uPrev; uniform float uCap;
void main(){
  float cur = texture(uCur, vec2(0.5)).r;
  float prev = texture(uPrev, vec2(0.5)).r;
  float ad = abs(cur - prev);
  float alpha = ad <= uCap ? 1.0 : uCap / max(ad, 1e-5);
  vec3 src = texture(uSrc, vUV).rgb;
  vec3 safe = texture(uSafe, vUV).rgb;
  frag = vec4(mix(safe, src, alpha), 1.0);
}`

const F_COPY = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag; uniform sampler2D uTex;
void main(){ frag = texture(uTex, vUV); }`

type Prog = { prog: WebGLProgram; u: (n: string) => WebGLUniformLocation | null }
type Target = { fbo: WebGLFramebuffer; tex: WebGLTexture }

export class StrobeLimiter {
  private quad: WebGLBuffer
  private measure: Prog
  private meanUpd: Prog
  private limit: Prog
  private copy: Prog
  private safe: [Target, Target] | null = null
  private meanBuf: [Target, Target] | null = null
  private curMean: Target | null = null
  private w = 0
  private h = 0
  private cur = 0
  private seeded = false

  constructor(private gl: WebGL2RenderingContext) {
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    this.measure = this.build(F_MEASURE)
    this.meanUpd = this.build(F_MEANUPD)
    this.limit = this.build(F_LIMIT)
    this.copy = this.build(F_COPY)
  }

  private build(fs: string): Prog {
    const gl = this.gl
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[strobe] compile:', gl.getShaderInfoLog(s))
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(prog, 0, 'p')
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error('[strobe] link:', gl.getProgramInfoLog(prog))
    const cache = new Map<string, WebGLUniformLocation | null>()
    return { prog, u: (n) => { if (!cache.has(n)) cache.set(n, gl.getUniformLocation(prog, n)); return cache.get(n)! } }
  }

  private mkTarget(w: number, h: number): Target {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { fbo, tex }
  }

  private free(t: Target | null): void {
    if (!t) return
    this.gl.deleteFramebuffer(t.fbo); this.gl.deleteTexture(t.tex)
  }

  private ensure(w: number, h: number): void {
    if (this.safe && this.w === w && this.h === h) return
    if (this.safe) { this.free(this.safe[0]); this.free(this.safe[1]) }
    if (this.meanBuf) { this.free(this.meanBuf[0]); this.free(this.meanBuf[1]) }
    this.free(this.curMean)
    this.safe = [this.mkTarget(w, h), this.mkTarget(w, h)]
    this.meanBuf = [this.mkTarget(1, 1), this.mkTarget(1, 1)]
    this.curMean = this.mkTarget(1, 1)
    this.w = w; this.h = h; this.cur = 0; this.seeded = false
  }

  private use(p: Prog): void {
    const gl = this.gl
    gl.useProgram(p.prog)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  }
  private draw(fbo: WebGLFramebuffer, w: number, h: number): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  private bind(unit: number, tex: WebGLTexture): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex)
  }

  /** Slew-limit `srcTex`'s full-field brightness. `cap` = max mean-luminance step
   *  per frame (smaller = safer). Returns the limited texture. */
  apply(srcTex: WebGLTexture, cap: number, w: number, h: number): WebGLTexture {
    const gl = this.gl
    this.ensure(w, h)
    const safe = this.safe!, mean = this.meanBuf!, curMean = this.curMean!

    // 1) measure the live frame's mean luminance.
    this.use(this.measure)
    this.bind(0, srcTex); gl.uniform1i(this.measure.u('uTex'), 0)
    this.draw(curMean.fbo, 1, 1)

    if (!this.seeded) {
      // Seed both safe frames with the live frame + both means with its mean.
      this.use(this.copy)
      this.bind(0, srcTex); gl.uniform1i(this.copy.u('uTex'), 0)
      this.draw(safe[0].fbo, w, h); this.draw(safe[1].fbo, w, h)
      this.bind(0, curMean.tex); gl.uniform1i(this.copy.u('uTex'), 0)
      this.draw(mean[0].fbo, 1, 1); this.draw(mean[1].fbo, 1, 1)
      this.seeded = true
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return srcTex
    }

    const meanRead = mean[1 - this.cur], meanWrite = mean[this.cur]
    const safeRead = safe[1 - this.cur], safeWrite = safe[this.cur]

    // 2) slew-limit the tracked mean.
    this.use(this.meanUpd)
    this.bind(0, curMean.tex); gl.uniform1i(this.meanUpd.u('uCur'), 0)
    this.bind(1, meanRead.tex); gl.uniform1i(this.meanUpd.u('uPrev'), 1)
    gl.uniform1f(this.meanUpd.u('uCap'), cap)
    this.draw(meanWrite.fbo, 1, 1)

    // 3) blend the live frame back toward the previous safe frame by the same alpha.
    this.use(this.limit)
    this.bind(0, srcTex); gl.uniform1i(this.limit.u('uSrc'), 0)
    this.bind(1, safeRead.tex); gl.uniform1i(this.limit.u('uSafe'), 1)
    this.bind(2, curMean.tex); gl.uniform1i(this.limit.u('uCur'), 2)
    this.bind(3, meanRead.tex); gl.uniform1i(this.limit.u('uPrev'), 3)
    gl.uniform1f(this.limit.u('uCap'), cap)
    this.draw(safeWrite.fbo, w, h)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.cur = 1 - this.cur
    return safeWrite.tex
  }

  dispose(): void {
    const gl = this.gl
    for (const p of [this.measure, this.meanUpd, this.limit, this.copy]) gl.deleteProgram(p.prog)
    gl.deleteBuffer(this.quad)
    if (this.safe) { this.free(this.safe[0]); this.free(this.safe[1]); this.safe = null }
    if (this.meanBuf) { this.free(this.meanBuf[0]); this.free(this.meanBuf[1]); this.meanBuf = null }
    this.free(this.curMean); this.curMean = null
  }
}
