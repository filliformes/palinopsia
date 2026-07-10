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

// ── Feedback engine (video-feedback spike) : sample last output through a
//    drifting-pivot transform + self-displacement, mix a fresh source, with a
//    built-in AGC + noise-floor so it sits at the edge of chaos without dying or
//    blowing out. Ping-pong RGBA16F, owned by FeedbackNode.
const F_FEEDBACK = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev, uRing;
uniform vec2 uRes, uOff, uPivot;
uniform float uFeedback, uGain, uZoom, uRot, uWarp, uHue, uBlur, uAgc, uNoise, uSeed;
uniform float uKeyThresh, uKeySoft, uBorder, uBorderHue, uHueCurve, uDelayMix;
uniform int uBlend, uKeyMode, uRingCols, uRingRows, uDelayTile;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0., -1./3., 2./3., -1.);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y); float e = 1e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.*d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1., 2./3., 1./3., 3.);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6. - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0., 1.), c.y);
}

void main(){
  // Transform the read-UV about the (drifting, off-centre) pivot : zoom + rotate
  // + per-frame drift. Small values → structure emerges slowly, stays matte.
  vec2 c = vUV - uPivot;
  float sc = 1.0 - uZoom;                 // zoom>0 magnifies outward
  float ca = cos(uRot), sa = sin(uRot);
  c = mat2(ca, -sa, sa, ca) * (c * sc);
  vec2 ruv = c + uPivot + uOff;

  // Self-displacement by the buffer's own hue/value (the "alive" term : organic
  // boiling / reaction-diffusion motion instead of a rigid spiral).
  vec3 p0 = texture(uPrev, ruv).rgb;
  vec3 hsv0 = rgb2hsv(p0);
  vec2 disp = uWarp * 0.03 * (hsv0.z * hsv0.y) * vec2(cos(hsv0.x * 6.2831853), sin(hsv0.x * 6.2831853));
  ruv += disp;

  vec3 pv;
  if (uBlur > 0.001){
    vec2 t = (0.5 + uBlur * 2.0) / uRes;
    pv = (texture(uPrev, ruv).rgb * 2.0
        + texture(uPrev, ruv + vec2(t.x, 0.0)).rgb + texture(uPrev, ruv - vec2(t.x, 0.0)).rgb
        + texture(uPrev, ruv + vec2(0.0, t.y)).rgb + texture(uPrev, ruv - vec2(0.0, t.y)).rgb) / 6.0;
  } else pv = texture(uPrev, ruv).rgb;

  // DELAY TAP : blend in a frame from uDelay frames ago (a ring atlas of recent
  // outputs), sampled with the SAME transform → echo / ghosting / time-shear.
  if (uDelayMix > 0.001){
    int col = uDelayTile - (uDelayTile / uRingCols) * uRingCols;
    int row = uDelayTile / uRingCols;
    vec2 rtUV = (vec2(float(col), float(row)) + clamp(ruv, 0.0, 1.0)) / vec2(float(uRingCols), float(uRingRows));
    pv = mix(pv, texture(uRing, rtUV).rgb, uDelayMix);
  }

  // AGC : normalise toward a target mean luma (from a coarse read of the buffer,
  // 1-frame delayed) so gain can sit at G≈1 without runaway / collapse.
  float agcCorr = 1.0;
  if (uAgc > 0.001){
    float m = 0.0;
    for (int i = 0; i < 9; i++){
      vec2 sp = vec2(float(i - (i/3)*3), float(i/3)) / 2.0 * 0.9 + 0.05;
      m += dot(texture(uPrev, sp).rgb, vec3(0.299, 0.587, 0.114));
    }
    m /= 9.0;
    agcCorr = mix(1.0, clamp(0.32 / max(m, 0.02), 0.35, 2.5), uAgc);
  }
  pv *= uGain * agcCorr;

  // Hue cycle : linear rate uHue, made NONLINEAR by uHueCurve (Andrei Jay's
  // sin(x)+c idea) so the palette churns chaotically instead of drifting evenly.
  if (abs(uHue) > 0.001 || uHueCurve > 0.001){
    vec3 h = rgb2hsv(pv);
    h.x = fract(h.x + uHue * (1.0 + uHueCurve * 3.0 * sin(h.x * 12.566371)));
    pv = hsv2rgb(h);
  }

  // KEYER : where the source is keyed out (dark for key-black, bright for
  // key-white) the feedback fills in; elsewhere the source shows. A bright border
  // around the key edge re-enters the loop → regenerating hard-edged shapes.
  vec3 src = texture(uHost, vUV).rgb;
  float fbAmt = uFeedback;
  float keyed = 0.0;
  if (uKeyMode > 0){
    float sl = dot(src, vec3(0.299, 0.587, 0.114));
    float k = smoothstep(uKeyThresh - uKeySoft - 0.001, uKeyThresh + uKeySoft + 0.001, sl);
    keyed = (uKeyMode == 1) ? (1.0 - k) : k;
    fbAmt = uFeedback * keyed;
  }

  vec3 outc;
  if (uBlend == 1) outc = src + pv * fbAmt;
  else if (uBlend == 2) outc = 1.0 - (1.0 - src) * (1.0 - pv * fbAmt);
  else if (uBlend == 3) outc = mix(src, abs(src - pv), fbAmt);
  else if (uBlend == 4) outc = mix(src, max(src, pv), fbAmt);
  else outc = mix(src, pv, fbAmt);

  if (uKeyMode > 0 && uBorder > 0.001){
    float edge = clamp(length(vec2(dFdx(keyed), dFdy(keyed))) * 40.0, 0.0, 1.0);
    outc = mix(outc, hsv2rgb(vec3(uBorderHue, 0.9, 1.0)), edge * uBorder);
  }

  outc += (hash(vUV * uRes + uSeed) - 0.5) * uNoise * 0.04; // noise floor : never dies flat
  o = vec4(clamp(outc, 0.0, 1.0), 1.0);
}`

// ── Datamosh engine ──────────────────────────────────────────────────────
// The real datamosh look, faked in real time (no codec): a per-MACROBLOCK motion
// field (optical flow of the live signal — or a sidechain layer — quantised to a
// block grid) advects an accumulator buffer each frame, so the picture keeps
// sliding along motion (the P-frame smear). A `refresh` term lerps the buffer back
// to the live frame (the I-frame); dropping it low lets a new scene's motion drag
// the PREVIOUS scene's texture around (the bloom). `residual` re-injects live
// texture (the mosh↔mush line); a block-granular stochastic `reseed` keeps it from
// mushing. STICKY mode slides each block as a rigid tile (crisp, real-datamosh
// tearing); MELT mode is a softer per-pixel smear. Chroma `bleed` = codec colour
// bleed. Block-constant vectors tear at block edges : the macroblock signature.
const F_DATAMOSH = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev, uFlow, uEnergy;
uniform vec2 uRes;
uniform float uBlock, uMotion, uRefresh, uResidual, uReseed, uDecay, uBleed, uThresh, uSeed, uAutoBloom;
uniform int uMode;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  // AUTO-BLOOM : a detected cut (global-motion spike, held in the 1×1 energy
  // state) momentarily drives the I-frame refresh toward 0, so a scene change
  // blooms : the new shot's motion drags the previous shot's texture around.
  float refresh = uRefresh * (1.0 - uAutoBloom * texture(uEnergy, vec2(0.5)).r);
  vec2 texel = 1.0 / uRes;
  vec2 blk = max(uBlock, 1.0) * texel;                 // macroblock size in UV
  vec2 blockOrigin = floor(vUV / blk) * blk;
  vec2 blockCenter = blockOrigin + blk * 0.5;
  vec2 mv = texture(uFlow, blockCenter).rg * uMotion;  // one vector per block
  float fmag = length(mv);
  float gate = smoothstep(uThresh, uThresh + 0.03, fmag); // mosh only where it moves

  // Displaced read : STICKY slides the whole block as a rigid tile (crisp,
  // tearing at 16px edges); MELT displaces per-pixel (softer smear).
  vec2 dispUV;
  if (uMode == 1) {
    vec2 local = vUV - blockOrigin;
    dispUV = (blockOrigin - mv) + local;
  } else {
    dispUV = vUV - mv;
  }

  // Chroma bleed keyed to motion (codec colour bleed).
  vec2 cb = mv * uBleed * 3.0;
  vec3 prev = vec3(
    texture(uPrev, dispUV + cb).r,
    texture(uPrev, dispUV).g,
    texture(uPrev, dispUV - cb).b);

  vec3 host = texture(uHost, vUV).rgb;

  // The mosh : the advected accumulator, retained by decay; residual re-injects
  // live texture. Gated to moving regions (still areas stay clean : "skip" blocks).
  vec3 mosh = mix(host, prev, uDecay);
  mosh = mix(mosh, host, uResidual);
  vec3 outc = mix(host, mosh, gate);

  // I-frame reset : lerp the buffer back to the clean live frame.
  outc = mix(outc, host, refresh);

  // Stochastic block reseed : whole blocks snap back to host, re-introducing
  // detail so the smear never fully mushes (transflow's random-reset idea).
  float rs = step(1.0 - uReseed * 0.06, hash(floor(vUV * uRes / max(uBlock, 1.0)) + uSeed));
  outc = mix(outc, host, rs);

  o = vec4(clamp(outc, 0.0, 1.0), 1.0);
}`

// Cut detector → decaying bloom state (rendered to a 1×1 buffer). Averages the
// flow field's magnitude (a scene cut spikes it everywhere); the state holds a
// level that jumps to 1 on a cut and decays over frames, so the bloom is
// SUSTAINED (a cut lasts many frames), all on the GPU (no readback stall).
const F_ENERGY = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uFlow, uPrevE;
uniform float uCutSense, uEDecay;
void main(){
  float m = 0.0;
  for (int j = 0; j < 8; j++){
    for (int i = 0; i < 8; i++){
      m += length(texture(uFlow, (vec2(float(i), float(j)) + 0.5) / 8.0).rg);
    }
  }
  m /= 64.0;
  float spike = smoothstep(uCutSense, uCutSense * 2.0, m * 4.0);
  float prev = texture(uPrevE, vec2(0.5)).r;
  o = vec4(max(prev * uEDecay, spike), 0.0, 0.0, 1.0);
}`

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
  feedback: Prog
  datamosh: Prog
  energy: Prog

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
    this.feedback = this.build(F_FEEDBACK)
    this.datamosh = this.build(F_DATAMOSH)
    this.energy = this.build(F_ENERGY)
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

// ── Feedback engine (video-feedback spike) ───────────────────────────────
// A ping-pong RGBA16F loop: each frame samples its OWN last output through the
// drifting-pivot transform + self-displacement (F_FEEDBACK), mixes the layer
// signal (host), and writes the new frame. Ignores the sidechain : it feeds on
// the host. Returns its own write buffer (valid through this frame's downstream
// use; only re-touched two frames later, so no read/write aliasing).
const FB_COLS = 4
const FB_ROWS = 4
const FB_N = FB_COLS * FB_ROWS // 16-frame delay ring

export class FeedbackNode implements ConvNode {
  private bufs: [RGBA, RGBA] | null = null
  private ring: RGBA | null = null // atlas of recent OUTPUTS (half-res, RGBA8) for the delay tap
  private ringTW = 0
  private ringTH = 0
  private ringWrite = 0
  private ringFilled = 0
  private w = 0
  private h = 0
  private cur = 0
  private t = 0
  private frame = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    if (this.bufs && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.bufs) for (const b of this.bufs) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo) }
    this.bufs = [makeRGBA(gl, w, h, true), makeRGBA(gl, w, h, true)]
    this.ringTW = Math.max(2, w >> 1); this.ringTH = Math.max(2, h >> 1)
    this.ring = makeRGBA(gl, this.ringTW * FB_COLS, this.ringTH * FB_ROWS, false)
    this.ringWrite = 0; this.ringFilled = 0
    this.w = w; this.h = h; this.cur = 0
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)
    const inp = ctx.inputs
    this.t += ctx.dt; this.frame++
    const read = this.bufs![this.cur]
    const write = this.bufs![1 - this.cur]

    // Drifting off-centre pivot : the anti-mandala key (keeps feedback organic
    // and wandering rather than a centred radial tunnel).
    const drift = clampf(num(inp.pivot, 0.4), 0, 1)
    const pvx = 0.5 + Math.sin(this.t * 0.13) * drift * 0.3
    const pvy = 0.5 + Math.cos(this.t * 0.11) * drift * 0.3

    // Delay tap : most-recent past tile = (ringWrite-1); go `delay` frames back,
    // clamped to what's actually been filled so we never read a black tile.
    const delayMixIn = clampf(num(inp.delayMix, 0), 0, 1)
    const delayReq = Math.round(clampf(num(inp.delay, 0), 0, FB_N - 1))
    const delayFrames = Math.min(delayReq, Math.max(0, this.ringFilled - 1))
    const delayTile = ((this.ringWrite - 1 - delayFrames) % FB_N + FB_N) % FB_N

    const p = g.use(g.feedback)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, read.tex); gl.uniform1i(p.u('uPrev'), 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.ring!.tex); gl.uniform1i(p.u('uRing'), 2)
    gl.uniform1i(p.u('uRingCols'), FB_COLS); gl.uniform1i(p.u('uRingRows'), FB_ROWS)
    gl.uniform1i(p.u('uDelayTile'), delayTile)
    gl.uniform1f(p.u('uDelayMix'), this.ringFilled > 1 ? delayMixIn : 0)
    gl.uniform2f(p.u('uRes'), W, H)
    gl.uniform1f(p.u('uFeedback'), clampf(num(inp.feedback, 0.85), 0, 1))
    gl.uniform1f(p.u('uGain'), clampf(num(inp.gain, 1.0), 0.2, 2.0))
    gl.uniform1f(p.u('uZoom'), clampf(num(inp.zoom, 0.01), -0.2, 0.2))
    gl.uniform1f(p.u('uRot'), clampf(num(inp.rotate, 0), -0.3, 0.3))
    gl.uniform2f(p.u('uOff'), clampf(num(inp.driftX, 0), -0.1, 0.1), clampf(num(inp.driftY, 0), -0.1, 0.1))
    gl.uniform2f(p.u('uPivot'), pvx, pvy)
    gl.uniform1f(p.u('uWarp'), clampf(num(inp.warp, 0.4), 0, 1))
    gl.uniform1f(p.u('uHue'), clampf(num(inp.hue, 0), -0.5, 0.5))
    gl.uniform1f(p.u('uHueCurve'), clampf(num(inp.hueCurve, 0), 0, 1))
    gl.uniform1f(p.u('uBlur'), clampf(num(inp.blur, 0.2), 0, 1))
    gl.uniform1i(p.u('uBlend'), Math.round(num(inp.blend, 0)))
    gl.uniform1i(p.u('uKeyMode'), Math.round(num(inp.keyMode, 0)))
    gl.uniform1f(p.u('uKeyThresh'), clampf(num(inp.keyThresh, 0.4), 0, 1))
    gl.uniform1f(p.u('uKeySoft'), clampf(num(inp.keySoft, 0.1), 0.001, 0.5))
    gl.uniform1f(p.u('uBorder'), clampf(num(inp.border, 0), 0, 1))
    gl.uniform1f(p.u('uBorderHue'), clampf(num(inp.borderHue, 0.6), 0, 1))
    gl.uniform1f(p.u('uAgc'), clampf(num(inp.agc, 0.5), 0, 1))
    gl.uniform1f(p.u('uNoise'), clampf(num(inp.noise, 0.15), 0, 1))
    gl.uniform1f(p.u('uSeed'), this.frame % 1024)
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo)
    gl.viewport(0, 0, W, H)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    // Store this frame's output into the delay ring (downsampled to the tile).
    const cp = g.use(g.copy)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, write.tex); gl.uniform1i(cp.u('uTex'), 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ring!.fbo)
    const col = this.ringWrite % FB_COLS, row = Math.floor(this.ringWrite / FB_COLS)
    gl.viewport(col * this.ringTW, row * this.ringTH, this.ringTW, this.ringTH)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.ringWrite = (this.ringWrite + 1) % FB_N
    this.ringFilled = Math.min(FB_N, this.ringFilled + 1)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.cur = 1 - this.cur // next frame reads what we just wrote
    return write.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.bufs) { for (const b of this.bufs) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.bufs = null }
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo); this.ring = null }
  }
}

// ── Datamosh engine (real-time faux-codec mosh) ──────────────────────────
// Optical flow of the live signal (or a sidechain layer, for cross-layer motion
// transfer) → block-quantised macroblock vectors → advect an RGBA16F accumulator
// (F_DATAMOSH). Reuses the flow pipeline (downsample + F_FLOW) like Transfert and
// the ping-pong accumulator like Feedback. Layer-FX only.
export class DatamoshNode implements ConvNode {
  private res = 0
  private lumaA!: RG
  private lumaB!: RG
  private lumaCurIsA = true
  private flowT!: RG
  private accum: [RGBA, RGBA] | null = null
  private energyBuf: [RGBA, RGBA] | null = null // 1×1 decaying cut-bloom state
  private energyCur = 0
  private w = 0
  private h = 0
  private cur = 0
  private frame = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensureFlow(n: number): void {
    if (this.res === n) return
    this.freeFlow()
    const gl = this.gl
    this.lumaA = makeRG(gl, n)
    this.lumaB = makeRG(gl, n)
    this.flowT = makeRG(gl, n)
    this.res = n
  }
  private freeFlow(): void {
    const gl = this.gl
    for (const t of [this.lumaA, this.lumaB, this.flowT]) {
      if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
    }
    this.res = 0
  }
  private ensureAccum(w: number, h: number): void {
    if (this.accum && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.accum) for (const b of this.accum) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
    this.accum = [makeRGBA(gl, w, h, true), makeRGBA(gl, w, h, true)]
    this.w = w; this.h = h; this.cur = 0
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const inp = ctx.inputs
    const W = ctx.chain.w, H = ctx.chain.h
    const n = FLOW_RES[Math.max(0, Math.min(2, Math.round(num(inp.flowRes, 1))))]
    this.ensureFlow(n)
    this.ensureAccum(W, H)
    this.frame++

    const draw = (fbo: WebGLFramebuffer, w: number, h: number): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const bind = (unit: number, tex: WebGLTexture): void => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex) }

    const lumaCur = this.lumaCurIsA ? this.lumaA : this.lumaB
    const lumaPrev = this.lumaCurIsA ? this.lumaB : this.lumaA
    // Flow source : a sidechain layer (motion transfer / "diegetic datamosh") if
    // present + enabled, else the host's own motion.
    const flowSrc = ctx.sidechain && num(inp.sidechainFlow, 0) >= 0.5 ? ctx.sidechain : ctx.host

    // 1) downsample flow source → luma
    let p = g.use(g.downsample)
    bind(0, flowSrc); gl.uniform1i(p.u('uTex'), 0)
    draw(lumaCur.fbo, n, n)
    // 2) flow(cur, prev)
    p = g.use(g.flow)
    bind(0, lumaCur.tex); bind(1, lumaPrev.tex)
    gl.uniform1i(p.u('uCur'), 0); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform2f(p.u('uRes'), n, n)
    gl.uniform1f(p.u('uLambda'), 0.002)
    gl.uniform1f(p.u('uClamp'), 0.03)
    draw(this.flowT.fbo, n, n)

    // 2b) cut detector → 1×1 decaying bloom state (scene-cut auto-mosh).
    if (!this.energyBuf) { this.energyBuf = [makeRGBA(gl, 1, 1, false), makeRGBA(gl, 1, 1, false)]; this.energyCur = 0 }
    const eRead = this.energyBuf[this.energyCur], eWrite = this.energyBuf[1 - this.energyCur]
    p = g.use(g.energy)
    bind(0, this.flowT.tex); bind(1, eRead.tex)
    gl.uniform1i(p.u('uFlow'), 0); gl.uniform1i(p.u('uPrevE'), 1)
    gl.uniform1f(p.u('uCutSense'), clampf(num(inp.cutSense, 0.35), 0.02, 1))
    gl.uniform1f(p.u('uEDecay'), 0.92) // bloom sustains ~25–30 frames after a cut
    draw(eWrite.fbo, 1, 1)

    // 3) datamosh advection → accumulator write
    const read = this.accum![this.cur], write = this.accum![1 - this.cur]
    p = g.use(g.datamosh)
    bind(0, ctx.host); bind(1, read.tex); bind(2, this.flowT.tex); bind(3, eWrite.tex)
    gl.uniform1i(p.u('uHost'), 0); gl.uniform1i(p.u('uPrev'), 1); gl.uniform1i(p.u('uFlow'), 2); gl.uniform1i(p.u('uEnergy'), 3)
    gl.uniform1f(p.u('uAutoBloom'), clampf(num(inp.autoBloom, 0.7), 0, 1))
    gl.uniform2f(p.u('uRes'), W, H)
    gl.uniform1f(p.u('uBlock'), clampf(num(inp.block, 16), 2, 64))
    gl.uniform1f(p.u('uMotion'), clampf(num(inp.motion, 1), 0, 4))
    gl.uniform1f(p.u('uRefresh'), clampf(num(inp.refresh, 0.06), 0, 1))
    gl.uniform1f(p.u('uResidual'), clampf(num(inp.residual, 0.15), 0, 1))
    gl.uniform1f(p.u('uReseed'), clampf(num(inp.reseed, 0.1), 0, 1))
    gl.uniform1f(p.u('uDecay'), clampf(num(inp.decay, 0.92), 0, 1))
    gl.uniform1f(p.u('uBleed'), clampf(num(inp.bleed, 0.2), 0, 1))
    gl.uniform1f(p.u('uThresh'), clampf(num(inp.thresh, 0.06), 0, 1))
    gl.uniform1i(p.u('uMode'), Math.round(num(inp.mode, 1)))
    gl.uniform1f(p.u('uSeed'), this.frame % 2048)
    draw(write.fbo, W, H)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.lumaCurIsA = !this.lumaCurIsA
    this.cur = 1 - this.cur
    this.energyCur = 1 - this.energyCur
    return write.tex
  }

  dispose(): void {
    this.disposed = true
    this.freeFlow()
    const gl = this.gl
    if (this.accum) { for (const b of this.accum) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.accum = null }
    if (this.energyBuf) { for (const b of this.energyBuf) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.energyBuf = null }
  }
}

/** Instantiate the native node for a reserved `node-*` shaderId (null if none). */
export function makeConvNode(gl: WebGL2RenderingContext, shaderId: string): ConvNode | null {
  if (shaderId === 'node-transfert') return new TransfertNode(gl)
  if (shaderId === 'node-convolve') return new ConvolveNode(gl)
  if (shaderId === 'node-reponse') return new ReponseNode(gl)
  if (shaderId === 'node-feedback') return new FeedbackNode(gl)
  if (shaderId === 'node-datamosh') return new DatamoshNode(gl)
  return null
}

export const NATIVE_NODE_IDS = ['node-transfert', 'node-convolve', 'node-reponse', 'node-feedback', 'node-datamosh']
export const isNativeNode = (id: string | null | undefined): boolean =>
  !!id && NATIVE_NODE_IDS.includes(id)
