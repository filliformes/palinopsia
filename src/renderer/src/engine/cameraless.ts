// Cameraless — the "direct-on-film" draw-hold stage (spec: docs/opsia-cameraless-spec.md,
// §2–3, stage 1: draw clock + hold + boil). Runs after the Finalizer output-shape stage,
// just before xfade/present. A DRAW CLOCK ticks at a hand-drawn frame rate (2–12 fps):
// on a tick it copies the live graded composite into a persistent HELD frame; every
// render frame it presents that held frame through a BOIL pass (gate weave + flutter +
// blank leader). This manufactures the discreteness + registration jitter the smooth
// 60 fps engine actively smooths away — the thing that makes a field read as film.
//
// Two hold modes (the §2.2 fork, both offered):
//   film-hold — re-read the LIVE composite each tick, so upstream feedback / motion keep
//               integrating underneath and you see them STEPPED (sampling a live process
//               at a low rate). Trails should look stepped, not frozen.
//   freeze    — capture ONCE, then only the boil animates the held cell (content frozen
//               in the gate, still weaving). Distinct from Compositor.setFreeze (which
//               dead-holds the WHOLE present, incl. warp/xfade) and from the Transport
//               Shutter (a global full-freeze stop-motion).
//
// Self-contained GL: own program + two persistent targets. The Compositor feeds it the
// live composite + params each frame and swaps in the returned texture. Off (hold===0)
// is handled by the Compositor skipping the stage entirely — genuine null passthrough.

export interface CameralessParams {
  hold: number // 0 off · 1 film-hold · 2 freeze
  rate: number // draw fps, 1..60
  jitter: number // 0..1 — tick-interval irregularity (hand timing)
  boil: number // 0..1 — registration jitter (XY + micro rot/scale)
  flutter: number // 0..1 — per-tick density/luminance pump
  blank: number // 0..1 — probability a tick shows leader instead of the frame
  blankMode: number // 0 black · 1 white · 2 both
}

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag;
uniform sampler2D uTex;
uniform vec2  uBoil;       // registration offset (normalized)
uniform float uBoilRot;    // micro-rotation (radians)
uniform float uBoilScale;  // ~0.997..1.003 breathe about centre
uniform float uFlutter;    // density multiplier
uniform float uBlank;      // 0 show · 1 leader this frame
uniform vec3  uBlankCol;   // black or white leader
void main(){
  vec2 c = vUV - 0.5;
  float s = sin(uBoilRot), co = cos(uBoilRot);
  c = mat2(co, -s, s, co) * (c / uBoilScale);
  vec2 uv = c + 0.5 + uBoil;
  // Film-gate edge: sampling past the frame shows leader-black, not edge smear.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { frag = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec4 col = texture(uTex, uv);
  col.rgb *= uFlutter;
  frag = mix(col, vec4(uBlankCol, 1.0), uBlank);
}`

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

export class Cameraless {
  private prog: WebGLProgram
  private quad: WebGLBuffer
  private u: (n: string) => WebGLUniformLocation | null
  private held: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null
  private out: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null
  private w = 0
  private h = 0
  // Draw clock.
  private acc = 0
  private next = 0
  private frozen = false
  // Held boil uniforms — re-rolled on a tick, held between ticks.
  private bx = 0
  private by = 0
  private brot = 0
  private bscale = 1
  private flut = 1
  private blank = 0
  private blankCol: [number, number, number] = [0, 0, 0]

  constructor(private gl: WebGL2RenderingContext) {
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error('[cameraless] compile:', gl.getShaderInfoLog(s))
      return s
    }
    this.prog = gl.createProgram()!
    gl.attachShader(this.prog, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(this.prog, compile(gl.FRAGMENT_SHADER, FS))
    gl.bindAttribLocation(this.prog, 0, 'p')
    gl.linkProgram(this.prog)
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS))
      console.error('[cameraless] link:', gl.getProgramInfoLog(this.prog))
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const cache = new Map<string, WebGLUniformLocation | null>()
    this.u = (n) => {
      if (!cache.has(n)) cache.set(n, gl.getUniformLocation(this.prog, n))
      return cache.get(n)!
    }
  }

  private mkTarget(w: number, h: number): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
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

  private ensureTargets(w: number, h: number): void {
    if (this.held && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.held) {
      gl.deleteFramebuffer(this.held.fbo)
      gl.deleteTexture(this.held.tex)
    }
    if (this.out) {
      gl.deleteFramebuffer(this.out.fbo)
      gl.deleteTexture(this.out.tex)
    }
    this.held = this.mkTarget(w, h)
    this.out = this.mkTarget(w, h)
    this.w = w
    this.h = h
    this.next = 0 // re-prime the clock on a resize
    this.frozen = false
  }

  /** Advance the draw clock; true on a draw tick. Primes (ticks) on the first call
   *  so the held frame is never empty. Interval re-jittered each tick (hand timing). */
  private tick(dt: number, p: CameralessParams): boolean {
    const base = 1 / clamp(p.rate, 1, 60)
    if (this.next === 0) {
      this.next = base
      return true
    }
    this.acc += dt
    if (this.acc < this.next) return false
    this.acc -= this.next
    this.next = base * (1 + (Math.random() * 2 - 1) * p.jitter * 0.5)
    return true
  }

  /** Re-roll the boil/flutter/blank state for the coming drawn frame. */
  private reroll(p: CameralessParams): void {
    const b = p.boil
    this.bx = (Math.random() * 2 - 1) * b * 0.01
    this.by = (Math.random() * 2 - 1) * b * 0.01
    this.brot = (Math.random() * 2 - 1) * b * 0.02
    this.bscale = 1 + (Math.random() * 2 - 1) * b * 0.006
    this.flut = 1 + (Math.random() * 2 - 1) * p.flutter * 0.25
    if (Math.random() < p.blank * 0.25) {
      this.blank = 1
      const white = p.blankMode === 1 || (p.blankMode === 2 && Math.random() < 0.5)
      this.blankCol = white ? [1, 1, 1] : [0, 0, 0]
    } else {
      this.blank = 0
    }
  }

  /** Draw `srcTex` into `fbo`. `boil` false = identity copy (grab the held frame);
   *  true = present with the current held boil/flutter/blank uniforms. */
  private blit(srcTex: WebGLTexture, fbo: WebGLFramebuffer, boil: boolean): void {
    const gl = this.gl
    gl.useProgram(this.prog)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
    gl.uniform1i(this.u('uTex'), 0)
    if (boil) {
      gl.uniform2f(this.u('uBoil'), this.bx, this.by)
      gl.uniform1f(this.u('uBoilRot'), this.brot)
      gl.uniform1f(this.u('uBoilScale'), this.bscale)
      gl.uniform1f(this.u('uFlutter'), this.flut)
      gl.uniform1f(this.u('uBlank'), this.blank)
      gl.uniform3f(this.u('uBlankCol'), this.blankCol[0], this.blankCol[1], this.blankCol[2])
    } else {
      gl.uniform2f(this.u('uBoil'), 0, 0)
      gl.uniform1f(this.u('uBoilRot'), 0)
      gl.uniform1f(this.u('uBoilScale'), 1)
      gl.uniform1f(this.u('uFlutter'), 1)
      gl.uniform1f(this.u('uBlank'), 0)
      gl.uniform3f(this.u('uBlankCol'), 0, 0, 0)
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** Run the stage over the live composite; returns the drawn-film texture. */
  apply(srcTex: WebGLTexture, dt: number, p: CameralessParams, w: number, h: number): WebGLTexture {
    this.ensureTargets(w, h)
    const isTick = this.tick(dt, p)
    if (p.hold === 2) {
      // freeze — capture once; only the boil animates the held cell thereafter.
      if (!this.frozen) {
        this.blit(srcTex, this.held!.fbo, false)
        this.frozen = true
      }
      if (isTick) this.reroll(p)
    } else {
      // film-hold — re-read the live composite on each tick (stepped live process).
      this.frozen = false
      if (isTick) {
        this.blit(srcTex, this.held!.fbo, false)
        this.reroll(p)
      }
    }
    this.blit(this.held!.tex, this.out!.fbo, true)
    return this.out!.tex
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteProgram(this.prog)
    gl.deleteBuffer(this.quad)
    if (this.held) {
      gl.deleteFramebuffer(this.held.fbo)
      gl.deleteTexture(this.held.tex)
    }
    if (this.out) {
      gl.deleteFramebuffer(this.out.fbo)
      gl.deleteTexture(this.out.tex)
    }
    this.held = null
    this.out = null
  }
}
