// Native convolution nodes (visual-convolution spec) — multi-pass render effects
// that can't be ISF shaders (dynamic pass counts, persistent inter-frame FBO
// state). They live in a layer's FX rack like any FX (same param/UI/modulation
// surface) but the rack runs THIS class instead of the ISF runtime, and hands it
// a sidechain texture (another layer / an imported asset) as the "impulse" source.
//
// Module 2 — Transfert (MotionTransfer): estimate the movement of the sidechain
// (poor-man's Lucas–Kanade optical flow), condition it (blur + inertia), then
// imprint it on the host — as a displacement field (« Déplacement ») or a
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

// Gradient (poor-man's Lucas–Kanade) flow — RG = flow vector.
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

// Separable blur on the flow field (dynamic radius — WebGL2 allows it).
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

// « Déplacement » — warp host by the flow field (+ per-channel chromatic spread).
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

// « Traînée » — flow-steered 1D line blur (poor-man's SepConv).
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

/** Instantiate the native node for a reserved `node-*` shaderId (null if none). */
export function makeConvNode(gl: WebGL2RenderingContext, shaderId: string): ConvNode | null {
  if (shaderId === 'node-transfert') return new TransfertNode(gl)
  return null
}

export const NATIVE_NODE_IDS = ['node-transfert']
export const isNativeNode = (id: string | null | undefined): boolean =>
  !!id && NATIVE_NODE_IDS.includes(id)
