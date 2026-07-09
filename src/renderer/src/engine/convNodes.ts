// Native convolution nodes (visual-convolution spec) : multi-pass render effects
// that can't be ISF shaders (dynamic pass counts, persistent inter-frame FBO
// state). They live in a layer's FX rack like any FX (same param/UI/modulation
// surface) but the rack runs THIS class instead of the ISF runtime, and hands it
// a sidechain texture (another layer / an imported asset) as the "impulse" source.
//
// Module 2 : Transfert (MotionTransfer): estimate the movement of the sidechain
// (poor-man's Lucas–Kanade optical flow), condition it (blur + inertia), then
// imprint it on the host : as a displacement field (« Déplacement ») or a
// per-pixel flow-steered line blur (« Traînée », poor-man's SepConv). This is the
// M factor of Filter Flow's T = MK, run forward (synthesis).

export interface ChainLike {
  next(): { fbo: WebGLFramebuffer; tex: WebGLTexture }
  readonly w: number
  readonly h: number
}

export interface NodeContext {
  gl: WebGL2RenderingContext
  chain: ChainLike // full-res RGBA16F ping-pong for the application output
  host: WebGLTexture // the layer signal so far (what the FX operates on)
  sidechain: WebGLTexture | null // the impulse source (null ⇒ node is inert)
  inputs: Record<string, number | number[]> // param values (from the FxInstance)
  dt: number
}

export interface ConvNode {
  render(ctx: NodeContext): WebGLTexture
  dispose(): void
}

const num = (v: number | number[] | undefined, d: number): number =>
  typeof v === 'number' ? v : d

// ── Shared GL (programs + fullscreen triangle), one set per context ─────
const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const F_DOWNSAMPLE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex;
void main(){ vec3 c = texture(uTex, vUV).rgb; o = vec4(dot(c, vec3(0.299,0.587,0.114)), 0.0, 0.0, 1.0); }`

// Gradient (poor-man's Lucas–Kanade) flow : RG = flow vector.
const F_FLOW = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uCur, uPrev; uniform vec2 uRes; uniform float uLambda, uClamp;
void main(){
  vec2 texel = 1.0 / uRes;
  float c = texture(uCur, vUV).r;
  float p = texture(uPrev, vUV).r;
  float dx = texture(uCur, vUV + vec2(texel.x,0.0)).r - texture(uCur, vUV - vec2(texel.x,0.0)).r;
  float dy = texture(uCur, vUV + vec2(0.0,texel.y)).r - texture(uCur, vUV - vec2(0.0,texel.y)).r;
  float dt = c - p;
  vec2 grad = vec2(dx, dy) * 0.5;
  float mag2 = dot(grad, grad) + uLambda;
  vec2 flow = -dt * grad / mag2;
  o = vec4(clamp(flow, -uClamp, uClamp), 0.0, 1.0);
}`

// Separable blur on the flow field (dynamic radius : WebGL2 allows it).
const F_BLUR = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex; uniform vec2 uStep; uniform float uRadius;
void main(){
  vec2 acc = vec2(0.0); float wsum = 0.0; int R = int(uRadius);
  for (int i = -R; i <= R; i++){
    float w = 1.0 - abs(float(i)) / (uRadius + 1.0);
    acc += texture(uTex, vUV + uStep * float(i)).rg * w; wsum += w;
  }
  o = vec4(acc / max(wsum, 1e-4), 0.0, 1.0);
}`

// Temporal smoothing / inertia: state = mix(prevState, newFlow, response).
const F_CONDITION = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uFlow, uPrev; uniform float uResponse;
void main(){
  vec2 f = texture(uFlow, vUV).rg; vec2 pr = texture(uPrev, vUV).rg;
  o = vec4(mix(pr, f, uResponse), 0.0, 1.0);
}`

// « Déplacement » : warp host by the flow field (+ per-channel chromatic spread).
const F_DISPLACE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uFlow; uniform float uAmount, uMagGamma, uSpread, uSign;
void main(){
  vec2 f = texture(uFlow, vUV).rg; float m = length(f);
  vec2 dir = m > 1e-6 ? f / m : vec2(0.0);
  m = pow(m, uMagGamma);
  vec2 flow = dir * m * uAmount * uSign;
  float r = texture(uHost, vUV + flow * (1.0 + uSpread)).r;
  float g = texture(uHost, vUV + flow).g;
  float b = texture(uHost, vUV + flow * (1.0 - uSpread)).b;
  o = vec4(r, g, b, 1.0);
}`

// « Traînée » : flow-steered 1D line blur (poor-man's SepConv).
const F_TRAINEE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uFlow;
uniform float uAmount, uMagGamma, uFalloff, uSign, uBidir; uniform int uTaps;
void main(){
  vec2 f = texture(uFlow, vUV).rg * uAmount * uSign; float len = length(f);
  vec2 dir = len > 1e-5 ? f / len : vec2(0.0);
  len = pow(len, uMagGamma);
  vec3 acc = vec3(0.0); float wsum = 0.0;
  for (int i = -uTaps; i <= uTaps; i++){
    float t = float(i) / float(uTaps);
    if (uBidir < 0.5 && t < 0.0) continue; // trailing only
    float w = 1.0 - abs(t) * uFalloff;
    acc += texture(uHost, vUV + dir * t * len).rgb * w; wsum += w;
  }
  o = vec4(acc / max(wsum, 1e-4), 1.0);
}`

// ── Module 1 : Convolution (ConvolveSpatial), direct kernel path ─────────
// The sidechain frame is the kernel (point-spread function): every host pixel
// stamps a scaled copy of it. Direct brute-force gather (the spec's `quality:
// "direct"` path, done well) at reduced res : reliable + verifiable now; FFT
// large-kernel is a future `quality` upgrade. Kernel is read LIVE from the
// sidechain each frame (threshold/gamma inline), normalized per-output by the
// accumulated weight (energy-conserving, no reduction pass).
const F_CONVOLVE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uKernel;
uniform float uExtent, uAspect, uThreshold, uGamma, uBoost;
uniform int uR;
const int MAXR = 12;
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
void main(){
  // Kernel spread as a fraction of the frame, aspect-corrected so it stays round.
  float step = uExtent / float(2 * uR + 1);
  vec3 acc = vec3(0.0); float wsum = 0.0;
  for (int j = -MAXR; j <= MAXR; j++){
    if (j < -uR || j > uR) continue;
    for (int i = -MAXR; i <= MAXR; i++){
      if (i < -uR || i > uR) continue;
      // kernel weight from the sidechain (centred), thresholded + gamma'd.
      vec2 kuv = 0.5 + vec2(float(i), float(j)) / float(2 * uR + 1);
      float kw = luma(texture(uKernel, kuv).rgb);
      kw = max(0.0, kw - uThreshold);
      kw = pow(kw, uGamma);
      if (kw <= 0.0) continue;
      // host sample, highlight-boosted so only hot pixels bloom (uBoost gate).
      vec2 off = vec2(float(i) * step / uAspect, float(j) * step);
      vec3 h = texture(uHost, vUV - off).rgb;
      float b = uBoost <= 0.0 ? 1.0 : smoothstep(uBoost, 1.0, luma(h));
      acc += h * b * kw; wsum += kw;
    }
  }
  o = vec4(wsum > 1e-5 ? acc / wsum : vec3(0.0), 1.0);
}`

// Composite the (reduced-res) convolved 'wet' back over the full-res dry host.
const F_CONV_MIX = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uDry, uWet; uniform float uGain, uMix, uAdditive;
void main(){
  vec3 dry = texture(uDry, vUV).rgb;
  vec3 wet = texture(uWet, vUV).rgb * uGain;
  vec3 outc = uAdditive > 0.5 ? dry + wet * uMix : mix(dry, wet, uMix);
  o = vec4(outc, 1.0);
}`

// ── Module 3 : Réponse (temporal frame-echo convolution) ─────────────────
// A ring of N past host frames (half-res, tiled into one atlas). Output =
// Σ history[i]·envelope[i], normalized : trails that pulse with a shaped
// temporal IR (attack/decay/reverse). Convolves the host's OWN time-history
// (no sidechain needed). Copy a downsampled host frame into the write tile:
const F_COPY = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex;
void main(){ o = vec4(texture(uTex, vUV).rgb, 1.0); }`

// Echo: sum the ring tiles weighted by the envelope, normalize, mix with dry.
const F_ECHO = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uRing;
uniform int uCols, uRows, uLast, uLen;
uniform float uEnv[16]; uniform float uMix;
void main(){
  vec3 acc = vec3(0.0); float wsum = 0.0;
  vec2 tile = 1.0 / vec2(float(uCols), float(uRows));
  vec2 ins = tile * 0.001; // half-texel-ish inset to avoid tile bleed
  int N = uCols * uRows;
  for (int i = 0; i < 16; i++){
    if (i >= uLen) break;
    int slot = uLast - i; slot = slot - N * int(floor(float(slot) / float(N)));
    int col = slot % uCols; int row = slot / uCols;
    vec2 base = vec2(float(col), float(row)) * tile;
    vec3 s = texture(uRing, base + ins + clamp(vUV, 0.0, 1.0) * (tile - ins * 2.0)).rgb;
    acc += s * uEnv[i]; wsum += uEnv[i];
  }
  vec3 echo = wsum > 1e-5 ? acc / wsum : vec3(0.0);
  o = vec4(mix(texture(uHost, vUV).rgb, echo, uMix), 1.0);
}`

interface Prog {
  prog: WebGLProgram
  u: (n: string) => WebGLUniformLocation | null
}

class NodeGL {
  quad: WebGLBuffer
  downsample: Prog
  flow: Prog
  blur: Prog
  condition: Prog
  displace: Prog
  trainee: Prog
  convolve: Prog
  convMix: Prog
  copy: Prog
  echo: Prog

  constructor(readonly gl: WebGL2RenderingContext) {
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    this.downsample = this.build(F_DOWNSAMPLE)
    this.flow = this.build(F_FLOW)
    this.blur = this.build(F_BLUR)
    this.condition = this.build(F_CONDITION)
    this.displace = this.build(F_DISPLACE)
    this.trainee = this.build(F_TRAINEE)
    this.convolve = this.build(F_CONVOLVE)
    this.convMix = this.build(F_CONV_MIX)
    this.copy = this.build(F_COPY)
    this.echo = this.build(F_ECHO)
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      console.error('[convNode] shader compile:', gl.getShaderInfoLog(s))
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
      console.error('[convNode] link:', gl.getProgramInfoLog(prog))
    const cache = new Map<string, WebGLUniformLocation | null>()
    return {
      prog,
      u: (n) => {
        if (!cache.has(n)) cache.set(n, gl.getUniformLocation(prog, n))
        return cache.get(n)!
      }
    }
  }

  /** Bind a program + the fullscreen triangle, ready for uniform sets + draw. */
  use(p: Prog): Prog {
    const gl = this.gl
    gl.useProgram(p.prog)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    return p
  }
}

const shared = new WeakMap<WebGL2RenderingContext, NodeGL>()
function nodeGL(gl: WebGL2RenderingContext): NodeGL {
  let g = shared.get(gl)
  if (!g) {
    g = new NodeGL(gl)
    shared.set(gl, g)
  }
  return g
}

// ── RG16F flow target ───────────────────────────────────────────────────
interface RG {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
}
function makeRG(gl: WebGL2RenderingContext, n: number): RG {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, n, n, 0, gl.RG, gl.HALF_FLOAT, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  return { fbo, tex }
}

const FLOW_RES = [128, 256, 512]

export class TransfertNode implements ConvNode {
  private res = 0
  private lumaA!: RG
  private lumaB!: RG
  private lumaCurIsA = true
  private scratch1!: RG
  private scratch2!: RG
  private stateA!: RG
  private stateB!: RG
  private stateReadIsA = true
  private disposed = false

  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(n: number): void {
    if (this.res === n) return
    this.freeTargets()
    const gl = this.gl
    this.lumaA = makeRG(gl, n)
    this.lumaB = makeRG(gl, n)
    this.scratch1 = makeRG(gl, n)
    this.scratch2 = makeRG(gl, n)
    this.stateA = makeRG(gl, n)
    this.stateB = makeRG(gl, n)
    this.res = n
  }

  private freeTargets(): void {
    const gl = this.gl
    for (const t of [this.lumaA, this.lumaB, this.scratch1, this.scratch2, this.stateA, this.stateB]) {
      if (t) {
        gl.deleteTexture(t.tex)
        gl.deleteFramebuffer(t.fbo)
      }
    }
    this.res = 0
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed || !ctx.sidechain) return ctx.host // inert without a sidechain
    const gl = ctx.gl
    const g = nodeGL(gl)
    const inp = ctx.inputs
    const n = FLOW_RES[Math.max(0, Math.min(2, Math.round(num(inp.flowRes, 1))))]
    this.ensure(n)

    const draw = (fbo: WebGLFramebuffer, w: number, h: number): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.viewport(0, 0, w, h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const bind = (unit: number, tex: WebGLTexture): void => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
    }

    const lumaCur = this.lumaCurIsA ? this.lumaA : this.lumaB
    const lumaPrev = this.lumaCurIsA ? this.lumaB : this.lumaA

    // 1) downsample sidechain → luma.
    let p = g.use(g.downsample)
    bind(0, ctx.sidechain)
    gl.uniform1i(p.u('uTex'), 0)
    draw(lumaCur.fbo, n, n)

    // 2) flow(cur, prev).
    p = g.use(g.flow)
    bind(0, lumaCur.tex); bind(1, lumaPrev.tex)
    gl.uniform1i(p.u('uCur'), 0); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform2f(p.u('uRes'), n, n)
    gl.uniform1f(p.u('uLambda'), 0.001)
    gl.uniform1f(p.u('uClamp'), 0.25)
    draw(this.scratch1.fbo, n, n)

    // 3) separable blur (radius = flowBlur), scratch1 → scratch2 → scratch1.
    const radius = Math.max(0, Math.min(24, num(inp.flowBlur, 8)))
    if (radius >= 1) {
      p = g.use(g.blur)
      bind(0, this.scratch1.tex); gl.uniform1i(p.u('uTex'), 0)
      gl.uniform1f(p.u('uRadius'), radius)
      gl.uniform2f(p.u('uStep'), 1 / n, 0)
      draw(this.scratch2.fbo, n, n)
      bind(0, this.scratch2.tex)
      gl.uniform2f(p.u('uStep'), 0, 1 / n)
      draw(this.scratch1.fbo, n, n)
    }

    // 4) temporal inertia: state = mix(prevState, flow, response). Ping-pong.
    const inertie = Math.max(0, Math.min(1, num(inp.inertie, 0.6)))
    const response = 1 - inertie * 0.95 // heavy inertia ⇒ slow follow
    const stateRead = this.stateReadIsA ? this.stateA : this.stateB
    const stateWrite = this.stateReadIsA ? this.stateB : this.stateA
    p = g.use(g.condition)
    bind(0, this.scratch1.tex); bind(1, stateRead.tex)
    gl.uniform1i(p.u('uFlow'), 0); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform1f(p.u('uResponse'), response)
    draw(stateWrite.fbo, n, n)

    // 5) application at full res → a chain buffer.
    const out = ctx.chain.next()
    const amount = num(inp.amount, 0.3) * num(inp.flowScale, 1)
    const sign = num(inp.invert, 0) >= 0.5 ? -1 : 1
    const magGamma = Math.max(0.1, num(inp.magnitudeGamma, 1))
    const mode = Math.round(num(inp.mode, 0)) // 0 déplacement, 1 traînée
    if (mode >= 1) {
      p = g.use(g.trainee)
      bind(0, ctx.host); bind(1, stateWrite.tex)
      gl.uniform1i(p.u('uHost'), 0); gl.uniform1i(p.u('uFlow'), 1)
      gl.uniform1f(p.u('uAmount'), amount)
      gl.uniform1f(p.u('uMagGamma'), magGamma)
      gl.uniform1f(p.u('uFalloff'), Math.max(0, Math.min(1, num(inp.falloff, 0.5))))
      gl.uniform1f(p.u('uSign'), sign)
      gl.uniform1f(p.u('uBidir'), num(inp.bidirectional, 1) >= 0.5 ? 1 : 0)
      gl.uniform1i(p.u('uTaps'), Math.max(2, Math.min(24, Math.round(num(inp.taps, 12)))))
    } else {
      p = g.use(g.displace)
      bind(0, ctx.host); bind(1, stateWrite.tex)
      gl.uniform1i(p.u('uHost'), 0); gl.uniform1i(p.u('uFlow'), 1)
      gl.uniform1f(p.u('uAmount'), amount)
      gl.uniform1f(p.u('uMagGamma'), magGamma)
      gl.uniform1f(p.u('uSpread'), Math.max(0, Math.min(1, num(inp.channelSpread, 0))))
      gl.uniform1f(p.u('uSign'), sign)
    }
    draw(out.fbo, ctx.chain.w, ctx.chain.h)

    // Advance ping-pong bookkeeping for next frame.
    this.lumaCurIsA = !this.lumaCurIsA
    this.stateReadIsA = !this.stateReadIsA
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    this.freeTargets()
  }
}

// ── RGBA target helper (16F for the convolution wet, 8 for the echo ring) ──
interface RGBA {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
}
function makeRGBA(gl: WebGL2RenderingContext, w: number, h: number, float: boolean): RGBA {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  return { fbo, tex }
}
const clampf = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

// ── Module 1 : Convolution (ConvolveSpatial, direct kernel path) ──────────
export class ConvolveNode implements ConvNode {
  private wet: RGBA | null = null
  private ww = 0
  private wh = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed || !ctx.sidechain) return ctx.host // needs a kernel (sidechain)
    const gl = ctx.gl
    const g = nodeGL(gl)
    const inp = ctx.inputs
    const fullW = ctx.chain.w
    const fullH = ctx.chain.h
    const ww = Math.max(2, fullW >> 1)
    const wh = Math.max(2, fullH >> 1)
    if (!this.wet || this.ww !== ww || this.wh !== wh) {
      if (this.wet) { gl.deleteTexture(this.wet.tex); gl.deleteFramebuffer(this.wet.fbo) }
      this.wet = makeRGBA(gl, ww, wh, true)
      this.ww = ww; this.wh = wh
    }
    const draw = (fbo: WebGLFramebuffer, w: number, h: number): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const bind = (unit: number, tex: WebGLTexture): void => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex) }
    const R = Math.max(1, Math.min(12, Math.round(num(inp.taps, 7))))

    // Convolve host ⊛ kernel(sidechain) → reduced-res wet.
    let p = g.use(g.convolve)
    bind(0, ctx.host); bind(1, ctx.sidechain)
    gl.uniform1i(p.u('uHost'), 0); gl.uniform1i(p.u('uKernel'), 1)
    gl.uniform1f(p.u('uExtent'), clampf(num(inp.scale, 1), 0, 2) * 0.35)
    gl.uniform1f(p.u('uAspect'), fullW / Math.max(1, fullH))
    gl.uniform1f(p.u('uThreshold'), clampf(num(inp.threshold, 0.1), 0, 1))
    gl.uniform1f(p.u('uGamma'), Math.max(0.25, num(inp.kernelGamma, 1)))
    gl.uniform1f(p.u('uBoost'), clampf(num(inp.boost, 0), 0, 1))
    gl.uniform1i(p.u('uR'), R)
    draw(this.wet.fbo, ww, wh)

    // Composite wet over the full-res dry host.
    const out = ctx.chain.next()
    p = g.use(g.convMix)
    bind(0, ctx.host); bind(1, this.wet.tex)
    gl.uniform1i(p.u('uDry'), 0); gl.uniform1i(p.u('uWet'), 1)
    gl.uniform1f(p.u('uGain'), num(inp.gain, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 0.6), 0, 1))
    gl.uniform1f(p.u('uAdditive'), num(inp.additive, 0) >= 0.5 ? 1 : 0)
    draw(out.fbo, fullW, fullH)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    if (this.wet) { this.gl.deleteTexture(this.wet.tex); this.gl.deleteFramebuffer(this.wet.fbo); this.wet = null }
  }
}

// ── Module 3 : Réponse (temporal frame-echo convolution) ──────────────────
const ECHO_COLS = 4
const ECHO_ROWS = 4
const ECHO_N = ECHO_COLS * ECHO_ROWS // 16 history frames

export class ReponseNode implements ConvNode {
  private ring: RGBA | null = null
  private tileW = 0
  private tileH = 0
  private writeIdx = 0
  private filled = 0
  private disposed = false
  private env = new Float32Array(16)
  constructor(private gl: WebGL2RenderingContext) {}

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl
    const g = nodeGL(gl)
    const inp = ctx.inputs
    const fullW = ctx.chain.w
    const fullH = ctx.chain.h
    const tw = Math.max(2, fullW >> 1)
    const th = Math.max(2, fullH >> 1)
    if (!this.ring || this.tileW !== tw || this.tileH !== th) {
      if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo) }
      this.ring = makeRGBA(gl, tw * ECHO_COLS, th * ECHO_ROWS, false)
      this.tileW = tw; this.tileH = th; this.writeIdx = 0; this.filled = 0
    }
    const bind = (unit: number, tex: WebGLTexture): void => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex) }

    // 1) Write the current host frame into the ring's write tile (downsampled).
    const col = this.writeIdx % ECHO_COLS
    const row = Math.floor(this.writeIdx / ECHO_COLS)
    let p = g.use(g.copy)
    bind(0, ctx.host); gl.uniform1i(p.u('uTex'), 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ring.fbo)
    gl.viewport(col * tw, row * th, tw, th)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const lastWritten = this.writeIdx
    this.writeIdx = (this.writeIdx + 1) % ECHO_N
    this.filled = Math.min(ECHO_N, this.filled + 1)

    // 2) Build the temporal envelope (attack onset × exponential decay tail).
    const len = Math.max(1, Math.min(ECHO_N, Math.min(this.filled, Math.round(num(inp.length, 8)))))
    const decayTaps = Math.max(0.5, clampf(num(inp.decay, 0.5), 0.02, 1) * ECHO_N)
    const attackTaps = Math.max(0.02, clampf(num(inp.attack, 0.1), 0, 1) * ECHO_N)
    const gain = Math.max(0, num(inp.gain, 1))
    this.env.fill(0)
    for (let i = 0; i < len; i++) {
      this.env[i] = gain * (1 - Math.exp(-(i + 1) / attackTaps)) * Math.exp(-i / decayTaps)
    }
    if (num(inp.reverse, 0) >= 0.5) {
      for (let i = 0; i < len >> 1; i++) { const t = this.env[i]; this.env[i] = this.env[len - 1 - i]; this.env[len - 1 - i] = t }
    }

    // 3) Echo: Σ ring[age i] · env[i], normalized, mixed with the dry host.
    const out = ctx.chain.next()
    p = g.use(g.echo)
    bind(0, ctx.host); bind(1, this.ring.tex)
    gl.uniform1i(p.u('uHost'), 0); gl.uniform1i(p.u('uRing'), 1)
    gl.uniform1i(p.u('uCols'), ECHO_COLS); gl.uniform1i(p.u('uRows'), ECHO_ROWS)
    gl.uniform1i(p.u('uLast'), lastWritten); gl.uniform1i(p.u('uLen'), len)
    gl.uniform1fv(p.u('uEnv'), this.env)
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 0.6), 0, 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, fullW, fullH); gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    if (this.ring) { this.gl.deleteTexture(this.ring.tex); this.gl.deleteFramebuffer(this.ring.fbo); this.ring = null }
  }
}

/** Instantiate the native node for a reserved `node-*` shaderId (null if none). */
export function makeConvNode(gl: WebGL2RenderingContext, shaderId: string): ConvNode | null {
  if (shaderId === 'node-transfert') return new TransfertNode(gl)
  if (shaderId === 'node-convolve') return new ConvolveNode(gl)
  if (shaderId === 'node-reponse') return new ReponseNode(gl)
  return null
}

export const NATIVE_NODE_IDS = ['node-transfert', 'node-convolve', 'node-reponse']
export const isNativeNode = (id: string | null | undefined): boolean =>
  !!id && NATIVE_NODE_IDS.includes(id)
