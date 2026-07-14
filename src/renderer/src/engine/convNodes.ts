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
  depth?: WebGLTexture | null // shared scene-depth map (Depth engine), if any
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
uniform float uBlock, uMotion, uRefresh, uResidual, uReseed, uDecay, uBleed, uThresh, uSeed, uAutoBloom, uBloom, uSwirl;
uniform int uMode, uFlowInvert;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  // BLOOM : a detected cut (auto, held in the 1×1 energy state) OR a manual/beat
  // BLOOM TRIGGER (uBloom, a decaying envelope) momentarily drives the I-frame
  // refresh toward 0 and boosts persistence, so the picture blooms : the current
  // motion keeps dragging the held texture around (the classic datamosh burst).
  float bloom = max(uAutoBloom * texture(uEnergy, vec2(0.5)).r, uBloom);
  float refresh = uRefresh * (1.0 - bloom);
  vec2 texel = 1.0 / uRes;
  vec2 blk = max(uBlock, 1.0) * texel;                 // macroblock size in UV
  vec2 blockCenter = (floor(vUV / blk) + 0.5) * blk;
  // STICKY = one vector per macroblock (block-constant → the whole block slides as
  // a rigid tile, tearing at block edges : the real datamosh look). MELT/FLUID = the
  // per-pixel flow → a softer warp/smear (FLUID feeds a temporally-averaged flow).
  vec2 rawmv = (uMode == 1 ? texture(uFlow, blockCenter).rg : texture(uFlow, vUV).rg) * uMotion;
  // Motion-vector manipulation (ffglitch-style, on our flow field) : invert the
  // direction (reverse-smear) and/or rotate every vector (vortex mosh).
  if (uFlowInvert == 1) rawmv = -rawmv;
  if (abs(uSwirl) > 0.001) { float cs = cos(uSwirl), sn = sin(uSwirl); rawmv = mat2(cs, -sn, sn, cs) * rawmv; }
  float fmag = length(rawmv);
  // Suppress sub-threshold flow noise so still areas don't creep; above it, the
  // block advects. NOT an output gate : the accumulator always shows through, so
  // the smear PERSISTS after motion stops (real datamosh) and only fades via decay.
  vec2 mv = rawmv * smoothstep(uThresh, uThresh * 2.0 + 0.001, fmag);

  vec2 dispUV = vUV - mv;                               // advect along motion
  vec2 cb = mv * uBleed * 3.0;                          // chroma bleed keyed to motion
  vec3 advected = vec3(
    texture(uPrev, dispUV + cb).r,
    texture(uPrev, dispUV).g,
    texture(uPrev, dispUV - cb).b);

  vec3 host = texture(uHost, vUV).rgb;

  // Accumulator persists by DECAY. Still areas (mv≈0) sample themselves and
  // converge back to host over ~1/(1-decay) frames : the smear LINGERS where the
  // motion was, then cleans up. Moving areas keep sliding (the P-frame smear).
  float dec = mix(uDecay, 0.985, bloom * 0.6);         // bloom boosts persistence
  vec3 outc = mix(host, advected, dec);
  outc = mix(outc, host, uResidual * 0.5);             // extra live-texture re-inject (mush control)
  outc = mix(outc, host, refresh);                     // I-frame reset

  // Stochastic block reseed : whole blocks snap back to host, re-introducing
  // detail so the smear never fully mushes (transflow's random-reset idea).
  float rs = step(1.0 - uReseed * 0.3, hash(floor(vUV * uRes / max(uBlock, 1.0)) + uSeed));
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

// ── Scanner (flatbed slit-scan) ──────────────────────────────────────────
// A scan head sweeps the frame over one pass; as it crosses each line, that line
// is CAPTURED from the live signal at that instant into a persistent buffer, and
// held until the head passes again. Because different lines are grabbed at
// different times, any motion during the sweep smears/tears across scanlines —
// the flatbed-scanner-with-a-moving-object glitch. `drag` shears the capture (the
// paper sliding under the head), `wobble` adds a hand-wave, `jitter`/`tear` add
// per-line rips, `rgb` splits the CCD channels. Content only (no scan bar) — the
// bar is added in the present pass so it never bakes into the frozen document.
const F_SCAN = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev; uniform vec2 uRes; uniform int uAxis;
uniform float uPrevP, uCurP; uniform int uWrapped;
uniform float uDrag, uWobble, uJitter, uTear, uRgb, uSeed;
float hash(float x){ return fract(sin(x * 127.1 + uSeed * 13.0) * 43758.5453); }
vec2 axisUV(int a, float s, float c){
  if (a == 0) return vec2(c, s);
  if (a == 1) return vec2(c, 1.0 - s);
  if (a == 2) return vec2(s, c);
  return vec2(1.0 - s, c);
}
void main(){
  // s = progress along the scan axis (0 where the head starts); c = cross-axis.
  float s = (uAxis == 0) ? vUV.y : (uAxis == 1) ? 1.0 - vUV.y : (uAxis == 2) ? vUV.x : 1.0 - vUV.x;
  float c = (uAxis <= 1) ? vUV.x : vUV.y;
  // Captured this frame = the band the head crossed since last frame (wrap-aware).
  bool captured = (uWrapped == 0) ? (s > uPrevP && s <= uCurP) : (s > uPrevP || s <= uCurP);
  vec3 col;
  if (captured){
    float span = (uAxis <= 1) ? uRes.y : uRes.x;
    float tearQ = mix(1.0, 6.0 + floor(uTear * 40.0), step(0.001, uTear));
    float tline = floor(s * (span / tearQ));
    float jit = (hash(tline) - 0.5) * uJitter * 0.12;                 // per-slab rip
    float drag = (s - 0.5) * uDrag * 0.35;                            // steady shear
    float wob = sin(s * 20.0 + uSeed * 6.283) * uWobble * 0.06;       // hand wobble
    float off = jit + drag + wob;
    float k = uRgb * 0.02;                                            // CCD channel split
    col = vec3(
      texture(uHost, axisUV(uAxis, s, c + off + k)).r,
      texture(uHost, axisUV(uAxis, s, c + off)).g,
      texture(uHost, axisUV(uAxis, s, c + off - k)).b);
  } else {
    col = texture(uPrev, vUV).rgb;                                    // hold the document
  }
  o = vec4(col, 1.0);
}`

// Scanner present : copy the frozen buffer + add the soft bright scan bar at the
// head. Kept out of the persistent buffer so the bar never leaves a permanent streak.
const F_SCANOUT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uBuf; uniform int uAxis; uniform float uCurP, uBar; uniform int uWrapped;
void main(){
  float s = (uAxis == 0) ? vUV.y : (uAxis == 1) ? 1.0 - vUV.y : (uAxis == 2) ? vUV.x : 1.0 - vUV.x;
  float d = abs(s - uCurP);
  if (uWrapped == 1) d = min(d, min(abs(s - uCurP + 1.0), abs(s - uCurP - 1.0)));
  float bar = exp(-d * d * 1400.0) * uBar;
  o = vec4(clamp(texture(uBuf, vUV).rgb + bar, 0.0, 1.0), 1.0);
}`

// ── Autocutter (BSP cut-up rearrange) ────────────────────────────────────
// The frame is recursively split (binary space partition) into ragged rectangles,
// then the pieces are SHUFFLED among their own slots (a seeded permutation) and
// optionally rotated 90°/180°/270°. Each output cell samples the LIVE host from a
// different cell's region, so the scramble layout holds while the video keeps
// moving inside each piece — a live cut-up collage. Cells/permutation/rotation are
// computed on the CPU (see AutocutterNode) and passed as uniform arrays; the
// fragment just finds its dest cell and remaps.
const F_AUTOCUT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost;
uniform int uCount;
uniform vec4 uCell[64];   // dest rect (x,y,w,h)
uniform vec4 uMap[64];    // source rect (x,y,w,h)
uniform float uRot[64];   // 0..3 (×90°)
uniform float uGap, uSlip, uMix, uSeed;
float hash(float x){ return fract(sin(x * 91.7 + uSeed * 57.0) * 43758.5453); }
vec2 rot90(vec2 p, float r){
  p -= 0.5; int ri = int(r + 0.5);
  if (ri == 1) p = vec2(-p.y, p.x);
  else if (ri == 2) p = -p;
  else if (ri == 3) p = vec2(p.y, -p.x);
  return p + 0.5;
}
void main(){
  vec3 orig = texture(uHost, vUV).rgb;
  vec3 col = orig;
  for (int i = 0; i < 64; i++){
    if (i >= uCount) break;
    vec4 d = uCell[i];
    if (vUV.x >= d.x && vUV.x < d.x + d.z && vUV.y >= d.y && vUV.y < d.y + d.w){
      vec2 luv = rot90((vUV - d.xy) / d.zw, uRot[i]);
      vec4 sr = uMap[i];
      vec2 slip = (vec2(hash(float(i) + 1.3), hash(float(i) + 7.7)) - 0.5) * uSlip;
      col = texture(uHost, sr.xy + (luv + slip) * sr.zw).rgb;
      if (uGap > 0.001){                                             // dark seams
        vec2 e = min(vUV - d.xy, d.xy + d.zw - vUV);
        col *= smoothstep(0.0, uGap * 0.02, min(e.x, e.y));
      }
      break;
    }
  }
  o = vec4(clamp(mix(orig, col, uMix), 0.0, 1.0), 1.0);
}`

// ── Chronoscan (per-pixel time displacement / slit-scan) ─────────────────
// A ring-atlas of the last N frames; a CONTROL field sets a per-pixel age, so each
// region of the picture reads from a different past frame — every region living in
// a different present. Control = the host's own luminance, a sidechain layer's
// luminance, or a moving gradient (the classic slit-scan sweep). The temporal twin
// of the convolution trio : it convolves TIME the way they convolve space.
const F_CHRONO = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uCtrl, uRing;
uniform vec2 uAtlasTexel;
uniform float uCols, uRows, uN, uWrite, uFilled;
uniform int uSrcMode, uInvert, uSmooth;
uniform float uReach, uAngle, uSweep, uCurve, uMix;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 tile(float idx, vec2 uv){
  float col = mod(idx, uCols);
  float row = floor(idx / uCols);
  vec2 base = vec2(col, row) / vec2(uCols, uRows);
  vec2 span = 1.0 / vec2(uCols, uRows);
  vec2 tuv = clamp(base + clamp(uv, 0.0, 1.0) * span, base + 0.5 * uAtlasTexel, base + span - 0.5 * uAtlasTexel);
  return texture(uRing, tuv).rgb;
}
void main(){
  vec3 host = texture(uHost, vUV).rgb;
  if (uFilled < 2.0) { o = vec4(host, 1.0); return; }
  float ctrl;
  if (uSrcMode == 0) ctrl = luma(host);
  else if (uSrcMode == 1) ctrl = luma(texture(uCtrl, vUV).rgb);
  else { vec2 d = vec2(cos(uAngle), sin(uAngle)); ctrl = fract(dot(vUV - 0.5, d) + 0.5 + uSweep); }
  ctrl = pow(clamp(ctrl, 0.0, 1.0), uCurve);
  if (uInvert == 1) ctrl = 1.0 - ctrl;
  float back = ctrl * uReach * max(uFilled - 2.0, 0.0);   // frames into the past
  float recent = mod(uWrite - 1.0 + uN, uN);              // newest stored frame
  float idxF = mod(recent - back + uN * 4.0, uN);
  vec3 col;
  if (uSmooth == 1) {
    float lo = floor(idxF);
    col = mix(tile(mod(lo, uN), vUV), tile(mod(lo + 1.0, uN), vUV), fract(idxF));
  } else {
    col = tile(mod(floor(idxF + 0.5), uN), vUV);
  }
  o = vec4(mix(host, col, uMix), 1.0);
}`

// ── Sediment : long-term image memory ────────────────────────────────────
// The instrument is named for image persistence but only remembered ~16 frames.
// This keeps a decaying long-exposure ACCUMULATOR (peaks that slowly sink over
// seconds→minutes) plus a sparse KEYFRAME ring (a snapshot every few seconds, so
// minutes of the past are recallable). `age` sweeps from the recent accumulator to
// the oldest keyframe; `resurface` bleeds that memory back under the live image,
// `stir` drifts it so it sediments rather than sitting as a frozen loop.
const F_SED_ACC = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev; uniform float uDecay, uDeposit;
void main(){
  vec3 host = texture(uHost, vUV).rgb;
  vec3 prev = texture(uPrev, vUV).rgb;
  o = vec4(max(prev * uDecay, host * uDeposit), 1.0);   // decaying peak memory
}`

// ── Parallax : real 2.5D from the shared depth map (native, so the passthrough
// and the two image inputs are exact — an ISF FX with a 2nd image input tangled
// with the rack's inputImage binding). host + depth are bound explicitly here. ──
const F_PARALLAX = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uDepth;
uniform float uAmount, uAngle, uSway, uDof, uFocus, uFog, uWet, uTime;
uniform int uInvert, uHasDepth;
void main(){
  vec3 src = texture(uHost, vUV).rgb;
  if (uHasDepth == 0 || uWet < 0.001) { o = vec4(src, 1.0); return; } // exact passthrough
  float d = texture(uDepth, vUV).r;
  if (uInvert == 1) d = 1.0 - d;
  float dc = d - 0.5;
  vec2 dir = vec2(cos(uAngle), sin(uAngle));
  vec2 swayv = vec2(sin(uTime * 0.5), cos(uTime * 0.37)) * uSway;
  vec2 suv = vUV + (dir * uAmount + swayv) * dc * 0.15;
  float r = uDof * 0.03 * abs(d - uFocus);
  vec3 col = texture(uHost, suv).rgb * 0.4
    + (texture(uHost, suv + vec2(r, 0.0)).rgb + texture(uHost, suv - vec2(r, 0.0)).rgb
     + texture(uHost, suv + vec2(0.0, r)).rgb + texture(uHost, suv - vec2(0.0, r)).rgb) * 0.15;
  col = mix(col, vec3(0.0), uFog * smoothstep(uFocus, 1.0, d));
  o = vec4(mix(src, col, uWet), 1.0);
}`

const F_SED_OUT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uAcc, uRing;
uniform vec2 uAtlasTexel;
uniform float uCols, uRows, uN, uWrite, uFilled;
uniform float uAge, uResurface, uStir, uMix, uTime;
uniform int uBlend;
vec3 tile(float idx, vec2 uv){
  float col = mod(idx, uCols); float row = floor(idx / uCols);
  vec2 base = vec2(col, row) / vec2(uCols, uRows); vec2 span = 1.0 / vec2(uCols, uRows);
  vec2 tuv = clamp(base + clamp(uv, 0.0, 1.0) * span, base + 0.5 * uAtlasTexel, base + span - 0.5 * uAtlasTexel);
  return texture(uRing, tuv).rgb;
}
void main(){
  vec3 host = texture(uHost, vUV).rgb;
  vec2 st = vUV + vec2(sin(vUV.y * 6.28 + uTime * 0.11), cos(vUV.x * 6.28 - uTime * 0.09)) * uStir * 0.03;
  vec3 acc = texture(uAcc, st).rgb;
  float kf = mod(uWrite - 1.0 - uAge * max(uFilled - 1.0, 0.0) + uN * 4.0, uN);
  vec3 key = uFilled > 1.0 ? tile(kf, st) : acc;
  vec3 mem = mix(acc, key, smoothstep(0.0, 1.0, uAge));
  vec3 m = mem * uResurface;
  vec3 res;
  if (uBlend == 0) res = 1.0 - (1.0 - host) * (1.0 - m);          // screen
  else if (uBlend == 1) res = max(host, m);                        // lighten
  else if (uBlend == 2) res = host + m * (1.0 - host);             // under
  else res = mix(host, abs(host - mem), uResurface);               // difference
  o = vec4(clamp(mix(host, res, uMix), 0.0, 1.0), 1.0);
}`

// ── Eternalism / Phase-Drift (the afterimage family : persistence of vision) ──
// A frame-history ring, read as two temporal taps. HOLD = Ken Jacobs' Eternalism:
// two frames a `gap` apart, alternated across a BLACK shutter interval at `rate` →
// an unfrozen slice of time, a held micro-motion going nowhere. DRIFT = Sherwin/
// McClure's phase-drift twins: two delayed copies whose delay difference slowly
// beats in and out of lock (coherent → double-exposed → coherent), the second copy
// a touch larger with an amber cast. The app's name, made a signal path.
const F_ETERNAL = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uRing;
uniform vec2 uAtlasTexel;
uniform float uCols, uRows, uN, uWrite, uFilled;
uniform int uMode;
uniform float uGap, uOffB, uPhase, uInterval, uTint, uMix;
vec3 tile(float idx, vec2 uv){
  float col = mod(idx, uCols); float row = floor(idx / uCols);
  vec2 base = vec2(col, row) / vec2(uCols, uRows); vec2 span = 1.0 / vec2(uCols, uRows);
  vec2 tuv = clamp(base + clamp(uv, 0.0, 1.0) * span, base + 0.5 * uAtlasTexel, base + span - 0.5 * uAtlasTexel);
  return texture(uRing, tuv).rgb;
}
void main(){
  vec3 host = texture(uHost, vUV).rgb;
  if (uFilled < 3.0) { o = vec4(host, 1.0); return; }
  float recent = mod(uWrite - 1.0 + uN, uN);
  vec3 col;
  if (uMode == 0) {
    // HOLD : two taps gap apart, alternated across a black shutter (uPhase 0..1).
    vec3 A = tile(mod(recent - uGap + uN * 4.0, uN), vUV);
    vec3 B = tile(mod(recent - uGap - 1.0 + uN * 4.0, uN), vUV);
    float g = uInterval * 0.5;
    float winA = smoothstep(0.0, 0.06, uPhase) * (1.0 - smoothstep(0.5 - g, 0.5, uPhase));
    float winB = smoothstep(0.5, 0.56, uPhase) * (1.0 - smoothstep(1.0 - g, 1.0, uPhase));
    col = A * winA + B * winB;
  } else {
    // DRIFT : two delayed copies (offsets uGap / uOffB from JS); the second is
    // slightly larger with an amber cast. When the offsets coincide → locked.
    vec3 A = tile(mod(recent - uGap + uN * 4.0, uN), vUV);
    vec2 buv = (vUV - 0.5) * 0.985 + 0.5;
    vec3 B = tile(mod(recent - uOffB + uN * 4.0, uN), buv);
    B = mix(B, B * vec3(1.0, 0.82, 0.5), uTint);
    col = (A + B) * 0.5;
  }
  o = vec4(mix(host, col, uMix), 1.0);
}`

// ── Afterimage (Goethe's complement : a removed bright form leaves a dark/negative
// ghost). A decaying per-channel brightness high-water of recent frames; where a
// bright form has DEPARTED a spot, the ghost blooms — as a dark subtraction, and/or
// its complementary colour (a red form leaves a cyan trace). Two passes : acc, out. ──
const F_AFTER_ACC = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev; uniform float uDecay;
void main(){
  vec3 host = texture(uHost, vUV).rgb;
  vec3 prev = texture(uPrev, vUV).rgb;
  o = vec4(max(prev * uDecay, host), 1.0);   // decaying brightness high-water
}`

const F_AFTER_OUT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uAcc; uniform float uAmount, uChroma, uMix;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec3 host = texture(uHost, vUV).rgb;
  vec3 acc = texture(uAcc, vUV).rgb;
  float leave = max(0.0, luma(acc) - luma(host));   // brightness that has left this spot
  vec3 comp = 1.0 - acc;                            // complementary colour of what was here
  vec3 dark = host - vec3(leave) * uAmount;                     // Goethe dark afterimage
  vec3 chroma = host + (comp - 0.5) * 2.0 * leave * uAmount;    // complementary-colour ghost
  vec3 col = mix(dark, chroma, uChroma);
  o = vec4(clamp(mix(host, col, uMix), 0.0, 1.0), 1.0);
}`

// ── Pulfrich : real monocular 3D from a temporal eye-delay ────────────────
// The Pulfrich effect : one eye seeing a slightly DELAYED image (a dark filter
// slows its neural response) turns lateral motion into stereo depth. Here the
// delay is read per-pixel from a frame-history ring, keyed by the shared DEPTH
// map (or luminance) so far/dark planes lag more — a matte companion to the
// anaglyph stage. Crucially the disparity is TEMPORAL, not spatial : on a still
// frame both eyes read the same stored frame, so the picture is byte-exact and
// shows NO colour fringing — depth only blooms on lateral motion. Reuses the
// Chronoscan/Eternalism ring-atlas. Layer / source / master.
const F_PULFRICH = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uRing, uDepth;
uniform vec2 uAtlasTexel;
uniform float uCols, uRows, uN, uWrite, uFilled;
uniform int uMode, uSrc, uSwap, uHasDepth;
uniform float uDelay, uCurve, uSep, uDesat, uMix;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 tile(float idx, vec2 uv){
  float col = mod(idx, uCols); float row = floor(idx / uCols);
  vec2 base = vec2(col, row) / vec2(uCols, uRows); vec2 span = 1.0 / vec2(uCols, uRows);
  vec2 tuv = clamp(base + clamp(uv, 0.0, 1.0) * span, base + 0.5 * uAtlasTexel, base + span - 0.5 * uAtlasTexel);
  return texture(uRing, tuv).rgb;
}
void main(){
  vec3 host = texture(uHost, vUV).rgb;
  if (uFilled < 2.0) { o = vec4(host, 1.0); return; }
  float key = (uSrc == 1 && uHasDepth == 1) ? texture(uDepth, vUV).r : luma(host);
  key = pow(clamp(key, 0.0, 1.0), uCurve);
  if (uSwap == 1) key = 1.0 - key;
  float back = key * uDelay * max(uFilled - 2.0, 0.0);   // frames of eye-delay
  float recent = mod(uWrite - 1.0 + uN, uN);
  float idxF = mod(recent - back + uN * 4.0, uN);
  float lo = floor(idxF);
  vec3 delayed = mix(tile(mod(lo, uN), vUV), tile(mod(lo + 1.0, uN), vUV), fract(idxF));
  // Assign eyes : swap chooses which eye carries the lag (i.e. its motion direction).
  vec3 L = (uSwap == 1) ? delayed : host;
  vec3 R = (uSwap == 1) ? host : delayed;
  vec3 res;
  if (uMode == 0) {
    // Anaglyph red/cyan. Identical eyes (a still) → exactly host : no fringe.
    vec3 diff = R - L;
    vec3 Ra = L + diff * (1.0 + uSep * 2.0);   // uSep amplifies the disparity
    vec3 Ld = mix(L,  vec3(luma(L)),  uDesat);  // desat curbs retinal rivalry
    vec3 Rd = mix(Ra, vec3(luma(Ra)), uDesat);
    res = vec3(Ld.r, Rd.g, Rd.b);
  } else {
    // Glasses-free : a horizontal parallax slide gated by motion, so stills stay clean.
    float mo = clamp(length(host - delayed) * 6.0, 0.0, 1.0);
    vec2 suv = vUV + vec2((key - 0.5) * uSep * 0.12 * mo, 0.0);
    res = texture(uHost, suv).rgb;
  }
  o = vec4(clamp(mix(host, res, uMix), 0.0, 1.0), 1.0);
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
  scan: Prog
  scanout: Prog
  autocut: Prog
  chrono: Prog
  sedAcc: Prog
  sedOut: Prog
  parallax: Prog
  eternal: Prog
  afterAcc: Prog
  afterOut: Prog
  pulfrich: Prog

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
    this.scan = this.build(F_SCAN)
    this.scanout = this.build(F_SCANOUT)
    this.autocut = this.build(F_AUTOCUT)
    this.chrono = this.build(F_CHRONO)
    this.sedAcc = this.build(F_SED_ACC)
    this.sedOut = this.build(F_SED_OUT)
    this.parallax = this.build(F_PARALLAX)
    this.eternal = this.build(F_ETERNAL)
    this.afterAcc = this.build(F_AFTER_ACC)
    this.afterOut = this.build(F_AFTER_OUT)
    this.pulfrich = this.build(F_PULFRICH)
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
  private flowStateA!: RG // temporally-averaged flow (FLUID mode)
  private flowStateB!: RG
  private flowStateCur = true
  private accum: [RGBA, RGBA] | null = null
  private energyBuf: [RGBA, RGBA] | null = null // 1×1 decaying cut-bloom state
  private energyCur = 0
  private w = 0
  private h = 0
  private cur = 0
  private seeded = false
  private frame = 0
  private bloomEnv = 0 // decaying bloom-trigger envelope
  private prevTrig = 0
  private pulseT = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensureFlow(n: number): void {
    if (this.res === n) return
    this.freeFlow()
    const gl = this.gl
    this.lumaA = makeRG(gl, n)
    this.lumaB = makeRG(gl, n)
    this.flowT = makeRG(gl, n)
    this.flowStateA = makeRG(gl, n)
    this.flowStateB = makeRG(gl, n)
    this.res = n
  }
  private freeFlow(): void {
    const gl = this.gl
    for (const t of [this.lumaA, this.lumaB, this.flowT, this.flowStateA, this.flowStateB]) {
      if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
    }
    this.res = 0
  }
  private ensureAccum(w: number, h: number): void {
    if (this.accum && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.accum) for (const b of this.accum) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
    this.accum = [makeRGBA(gl, w, h, true), makeRGBA(gl, w, h, true)]
    this.w = w; this.h = h; this.cur = 0; this.seeded = false
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

    // Bloom trigger : a rising edge on `trig` (or the `pulse` auto-clock) sets a
    // decaying bloom envelope that the shader turns into an I-frame hold + a
    // persistence boost — the classic datamosh burst, fireable on the beat.
    const trig = num(inp.trig, 0)
    if (trig >= 0.5 && this.prevTrig < 0.5) this.bloomEnv = 1
    this.prevTrig = trig
    const pulse = clampf(num(inp.pulse, 0), 0, 8)
    if (pulse > 0) { this.pulseT += ctx.dt; if (this.pulseT >= 1 / pulse) { this.pulseT = 0; this.bloomEnv = 1 } }
    this.bloomEnv *= Math.exp(-ctx.dt / 0.4) // ~0.4s bloom tail

    const draw = (fbo: WebGLFramebuffer, w: number, h: number): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const bind = (unit: number, tex: WebGLTexture): void => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex) }

    // Seed the accumulator with the live frame so the mosh never starts from a
    // black buffer (which, with high persistence, would take ~12 frames to fill).
    if (!this.seeded) {
      const cp = g.use(g.copy)
      bind(0, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
      for (const b of this.accum!) draw(b.fbo, W, H)
      this.seeded = true
    }

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
    gl.uniform1f(p.u('uClamp'), 0.06) // max per-frame flow (must exceed the motion gate)
    draw(this.flowT.fbo, n, n)

    // 2a) FLUID mode : temporally average the flow (ffglitch's "average motion") →
    //     a smooth liquid melt. melt/sticky feed the RAW flow (response 1 = no avg).
    const mode = Math.round(num(inp.mode, 1))
    const fsRead = this.flowStateCur ? this.flowStateA : this.flowStateB
    const fsWrite = this.flowStateCur ? this.flowStateB : this.flowStateA
    p = g.use(g.condition)
    bind(0, this.flowT.tex); bind(1, fsRead.tex)
    gl.uniform1i(p.u('uFlow'), 0); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform1f(p.u('uResponse'), mode === 2 ? 0.12 : 1.0)
    draw(fsWrite.fbo, n, n)

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
    bind(0, ctx.host); bind(1, read.tex); bind(2, fsWrite.tex); bind(3, eWrite.tex) // conditioned flow
    gl.uniform1i(p.u('uHost'), 0); gl.uniform1i(p.u('uPrev'), 1); gl.uniform1i(p.u('uFlow'), 2); gl.uniform1i(p.u('uEnergy'), 3)
    gl.uniform1f(p.u('uAutoBloom'), clampf(num(inp.autoBloom, 0.7), 0, 1))
    gl.uniform1f(p.u('uBloom'), Math.min(1, this.bloomEnv))
    gl.uniform1i(p.u('uFlowInvert'), num(inp.flowInvert, 0) >= 0.5 ? 1 : 0)
    gl.uniform1f(p.u('uSwirl'), clampf(num(inp.swirl, 0), -1, 1) * 1.5708)
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
    this.flowStateCur = !this.flowStateCur
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

// ── Scanner (flatbed slit-scan) ──────────────────────────────────────────
// A scan head sweeps the frame; the band it crosses each frame is captured live
// into a persistent buffer and held until the head passes again, so motion during
// the sweep smears across scanlines. Loop mode scans continuously (live); one-shot
// does a single pass on TRIGGER then holds the frozen document. `trig` fires a fresh
// pass on the rising edge (manual toggle / OSC / a modulator's square/S&H/audio edge).
export class ScannerNode implements ConvNode {
  private bufs: [RGBA, RGBA] | null = null
  private w = 0
  private h = 0
  private cur = 0
  private seeded = false
  private pos = 0 // scan-head position 0..1 along the axis
  private prevTrig = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    if (this.bufs && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.bufs) for (const b of this.bufs) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
    this.bufs = [makeRGBA(gl, w, h, true), makeRGBA(gl, w, h, true)]
    this.w = w; this.h = h; this.cur = 0; this.seeded = false
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)
    const inp = ctx.inputs
    const read = this.bufs![this.cur], write = this.bufs![1 - this.cur]

    // Seed both buffers with the live frame so the document never starts black.
    if (!this.seeded) {
      const cp = g.use(g.copy)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
      for (const b of this.bufs!) { gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3) }
      this.seeded = true
    }

    // Advance the scan head (rising-edge trigger restarts the pass).
    const rate = clampf(num(inp.scanRate, 0.4), 0.02, 4)
    const oneShot = Math.round(num(inp.mode, 0)) === 1
    const trig = num(inp.trig, 0)
    const restart = trig >= 0.5 && this.prevTrig < 0.5
    this.prevTrig = trig
    let prevP: number, curP: number, wrapped = 0
    if (restart) { prevP = 0; curP = ctx.dt * rate }
    else if (oneShot && this.pos >= 1.0) { prevP = 1.0; curP = 1.0 } // finished → hold
    else {
      prevP = this.pos; curP = this.pos + ctx.dt * rate
      if (curP >= 1.0) { if (oneShot) curP = 1.0; else { curP -= 1.0; wrapped = 1 } }
    }
    this.pos = curP
    const axis = Math.round(num(inp.axis, 0))

    // Pass 1 : capture the band / hold the rest → write buffer (no scan bar).
    let p = g.use(g.scan)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, read.tex); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform2f(p.u('uRes'), W, H)
    gl.uniform1i(p.u('uAxis'), axis)
    gl.uniform1f(p.u('uPrevP'), prevP); gl.uniform1f(p.u('uCurP'), curP); gl.uniform1i(p.u('uWrapped'), wrapped)
    gl.uniform1f(p.u('uDrag'), clampf(num(inp.drag, 0.3), 0, 1))
    gl.uniform1f(p.u('uWobble'), clampf(num(inp.wobble, 0.2), 0, 1))
    gl.uniform1f(p.u('uJitter'), clampf(num(inp.jitter, 0.15), 0, 1))
    gl.uniform1f(p.u('uTear'), clampf(num(inp.tear, 0.3), 0, 1))
    gl.uniform1f(p.u('uRgb'), clampf(num(inp.rgb, 0.2), 0, 1))
    gl.uniform1f(p.u('uSeed'), Math.floor(this.pos * 997) % 1024)
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    // Pass 2 : present the frozen buffer + the scan bar → chain output.
    const out = ctx.chain.next()
    p = g.use(g.scanout)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, write.tex); gl.uniform1i(p.u('uBuf'), 0)
    gl.uniform1i(p.u('uAxis'), axis)
    gl.uniform1f(p.u('uCurP'), curP); gl.uniform1i(p.u('uWrapped'), wrapped)
    gl.uniform1f(p.u('uBar'), clampf(num(inp.bar, 0.25), 0, 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.cur = 1 - this.cur
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.bufs) { for (const b of this.bufs) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.bufs = null }
  }
}

// ── Autocutter (BSP cut-up rearrange) ────────────────────────────────────
// Recursive binary-space-partition of the frame into ragged rectangles, then the
// pieces are shuffled among their slots (seeded permutation) + optionally rotated.
// The layout is computed on the CPU here and passed as uniform arrays; the shader
// remaps each output cell to a different cell's live content, so the scramble holds
// while the video animates inside it. `trig` re-cuts on the rising edge; `rate` (Hz)
// auto-re-cuts for hands-free live rhythm.
const AC_MAX = 64
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
interface Rect { x: number; y: number; w: number; h: number }
export class AutocutterNode implements ConvNode {
  private cellArr = new Float32Array(AC_MAX * 4)
  private mapArr = new Float32Array(AC_MAX * 4)
  private rotArr = new Float32Array(AC_MAX)
  private count = 0
  private seed = 0x1a2b3c4d
  private prevTrig = 0
  private timer = 0
  private lastCuts = -1
  private lastRotate = -1
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private rebuild(cuts: number, rotateFrac: number): void {
    const rnd = mulberry32(this.seed)
    const minW = 0.06, minH = 0.06
    let cells: Rect[] = [{ x: 0, y: 0, w: 1, h: 1 }]
    while (cells.length < cuts) {
      let idx = -1, area = -1
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]
        if (c.w >= minW * 2 || c.h >= minH * 2) { const a = c.w * c.h; if (a > area) { area = a; idx = i } }
      }
      if (idx < 0) break
      const c = cells[idx]
      const canV = c.w >= minW * 2, canH = c.h >= minH * 2
      const vertical = canV && canH ? rnd() < c.w / (c.w + c.h) : canV
      const t = 0.35 + rnd() * 0.3
      if (vertical) { const sw = c.w * t; cells.splice(idx, 1, { x: c.x, y: c.y, w: sw, h: c.h }, { x: c.x + sw, y: c.y, w: c.w - sw, h: c.h }) }
      else { const sh = c.h * t; cells.splice(idx, 1, { x: c.x, y: c.y, w: c.w, h: sh }, { x: c.x, y: c.y + sh, w: c.w, h: c.h - sh }) }
    }
    if (cells.length > AC_MAX) cells = cells.slice(0, AC_MAX)
    const n = cells.length
    const perm = cells.map((_, i) => i)
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp }
    for (let i = 0; i < n; i++) {
      const d = cells[i], sIdx = perm[i], s = cells[sIdx]
      this.cellArr[i * 4] = d.x; this.cellArr[i * 4 + 1] = d.y; this.cellArr[i * 4 + 2] = d.w; this.cellArr[i * 4 + 3] = d.h
      this.mapArr[i * 4] = s.x; this.mapArr[i * 4 + 1] = s.y; this.mapArr[i * 4 + 2] = s.w; this.mapArr[i * 4 + 3] = s.h
      this.rotArr[i] = rotateFrac > 0 && rnd() < rotateFrac ? 1 + Math.floor(rnd() * 3) : 0
    }
    this.count = n
    this.lastCuts = cuts; this.lastRotate = rotateFrac
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    const inp = ctx.inputs

    const cuts = Math.round(clampf(num(inp.cuts, 20), 2, AC_MAX))
    const rotate = clampf(num(inp.rotate, 0.3), 0, 1)
    const trig = num(inp.trig, 0)
    const recut = trig >= 0.5 && this.prevTrig < 0.5
    this.prevTrig = trig
    const autoRate = clampf(num(inp.rate, 0), 0, 8)
    if (autoRate > 0) { this.timer += ctx.dt; if (this.timer >= 1 / autoRate) { this.timer = 0; this.reseed(); this.rebuild(cuts, rotate) } }
    if (recut) { this.reseed(); this.rebuild(cuts, rotate) }
    else if (this.count === 0 || cuts !== this.lastCuts || rotate !== this.lastRotate) this.rebuild(cuts, rotate)

    const out = ctx.chain.next()
    const p = g.use(g.autocut)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.uniform1i(p.u('uCount'), this.count)
    gl.uniform4fv(p.u('uCell'), this.cellArr.subarray(0, this.count * 4))
    gl.uniform4fv(p.u('uMap'), this.mapArr.subarray(0, this.count * 4))
    gl.uniform1fv(p.u('uRot'), this.rotArr.subarray(0, this.count))
    gl.uniform1f(p.u('uGap'), clampf(num(inp.gap, 0.15), 0, 1))
    gl.uniform1f(p.u('uSlip'), clampf(num(inp.slip, 0), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.uniform1f(p.u('uSeed'), this.seed % 1024)
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  private reseed(): void { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0 }
  dispose(): void { this.disposed = true }
}

// ── Chronoscan : per-pixel time displacement / slit-scan ─────────────────
// A ring-atlas of the last CH_N frames (quarter-res tiles). A control field sets a
// per-pixel age into that history, so each region shows a different past frame :
// slit-scan (gradient control), luminance-driven time-warp (self/sidechain), or a
// moving-slit sweep. Reuses the ring-atlas machinery of Réponse/Feedback. Layer-FX.
const CH_COLS = 8, CH_ROWS = 4, CH_N = CH_COLS * CH_ROWS
export class ChronoscanNode implements ConvNode {
  private ring: RGBA | null = null
  private w = 0
  private h = 0
  private tw = 0
  private th = 0
  private writeHead = 0
  private filled = 0
  private sweep = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    const tw = Math.max(2, w >> 2), th = Math.max(2, h >> 2)
    if (this.ring && this.tw === tw && this.th === th) return
    const gl = this.gl
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo) }
    this.ring = makeRGBA(gl, tw * CH_COLS, th * CH_ROWS, false)
    this.tw = tw; this.th = th; this.w = w; this.h = h
    this.writeHead = 0; this.filled = 0
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)
    const inp = ctx.inputs
    const ring = this.ring as RGBA
    this.sweep = (this.sweep + ctx.dt * clampf(num(inp.sweep, 0.15), 0, 1) * 0.5) % 1

    // 1) Present : read the history atlas at each pixel's computed age.
    const out = ctx.chain.next()
    const p = g.use(g.chrono)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ctx.sidechain ?? ctx.host); gl.uniform1i(p.u('uCtrl'), 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ring.tex); gl.uniform1i(p.u('uRing'), 2)
    gl.uniform2f(p.u('uAtlasTexel'), 1 / (this.tw * CH_COLS), 1 / (this.th * CH_ROWS))
    gl.uniform1f(p.u('uCols'), CH_COLS); gl.uniform1f(p.u('uRows'), CH_ROWS); gl.uniform1f(p.u('uN'), CH_N)
    gl.uniform1f(p.u('uWrite'), this.writeHead); gl.uniform1f(p.u('uFilled'), this.filled)
    gl.uniform1i(p.u('uSrcMode'), Math.round(num(inp.source, 2)))
    gl.uniform1i(p.u('uInvert'), num(inp.invert, 0) >= 0.5 ? 1 : 0)
    gl.uniform1i(p.u('uSmooth'), num(inp.smooth, 1) >= 0.5 ? 1 : 0)
    gl.uniform1f(p.u('uReach'), clampf(num(inp.reach, 0.6), 0, 1))
    gl.uniform1f(p.u('uAngle'), num(inp.angle, 0))
    gl.uniform1f(p.u('uSweep'), this.sweep)
    gl.uniform1f(p.u('uCurve'), clampf(num(inp.curve, 1), 0.2, 3))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    // 2) Store the current frame into the ring (quarter-res tile).
    const cp = g.use(g.copy)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, ring.fbo)
    const col = this.writeHead % CH_COLS, row = Math.floor(this.writeHead / CH_COLS)
    gl.viewport(col * this.tw, row * this.th, this.tw, this.th)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.writeHead = (this.writeHead + 1) % CH_N
    this.filled = Math.min(CH_N, this.filled + 1)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo); this.ring = null }
  }
}

// ── Sediment : long-term image memory ────────────────────────────────────
// A decaying long-exposure accumulator (peaks that sink over seconds→minutes) +
// a sparse keyframe ring (a snapshot every `interval` seconds → minutes recallable).
// `age` sweeps recent→old; `resurface` bleeds the memory back under the live image;
// `stir` drifts it so it sediments rather than loops. Earns the app's name. Layer-FX.
const SED_COLS = 4, SED_ROWS = 4, SED_N = SED_COLS * SED_ROWS
export class SedimentNode implements ConvNode {
  private acc: [RGBA, RGBA] | null = null
  private ring: RGBA | null = null
  private w = 0
  private h = 0
  private tw = 0
  private th = 0
  private accCur = 0
  private writeHead = 0
  private filled = 0
  private kfTimer = 0
  private time = 0
  private seeded = false
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    if (this.acc && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.acc) for (const b of this.acc) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo) }
    this.acc = [makeRGBA(gl, w, h, true), makeRGBA(gl, w, h, true)]
    this.tw = Math.max(2, w >> 2); this.th = Math.max(2, h >> 2)
    this.ring = makeRGBA(gl, this.tw * SED_COLS, this.th * SED_ROWS, false)
    this.w = w; this.h = h; this.accCur = 0; this.writeHead = 0; this.filled = 0; this.kfTimer = 0; this.seeded = false
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)
    const inp = ctx.inputs
    const acc = this.acc as [RGBA, RGBA], ring = this.ring as RGBA
    this.time += ctx.dt

    // Seed the accumulator with the live frame so memory doesn't start black.
    if (!this.seeded) {
      const cp = g.use(g.copy)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
      for (const b of acc) { gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3) }
      this.seeded = true
    }

    const read = acc[this.accCur], write = acc[1 - this.accCur]
    // 1) Accumulator : decaying peak memory (framerate-independent decay).
    const decayP = clampf(num(inp.decay, 0.6), 0, 1)
    const tau = 0.5 + decayP * decayP * 299.5 // half-life 0.5s → 300s
    let p = g.use(g.sedAcc)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, read.tex); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform1f(p.u('uDecay'), Math.exp(-ctx.dt / tau))
    gl.uniform1f(p.u('uDeposit'), clampf(num(inp.deposit, 0.5), 0, 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    // 2) Keyframe capture every `interval` seconds → the sparse long ring.
    this.kfTimer += ctx.dt
    const interval = clampf(num(inp.interval, 4), 0.5, 30)
    if (this.kfTimer >= interval) {
      this.kfTimer = 0
      const cp = g.use(g.copy)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, ring.fbo)
      const col = this.writeHead % SED_COLS, row = Math.floor(this.writeHead / SED_COLS)
      gl.viewport(col * this.tw, row * this.th, this.tw, this.th)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      this.writeHead = (this.writeHead + 1) % SED_N
      this.filled = Math.min(SED_N, this.filled + 1)
    }

    // 3) Output : live image with the resurfaced memory blended under it.
    const out = ctx.chain.next()
    p = g.use(g.sedOut)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, write.tex); gl.uniform1i(p.u('uAcc'), 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ring.tex); gl.uniform1i(p.u('uRing'), 2)
    gl.uniform2f(p.u('uAtlasTexel'), 1 / (this.tw * SED_COLS), 1 / (this.th * SED_ROWS))
    gl.uniform1f(p.u('uCols'), SED_COLS); gl.uniform1f(p.u('uRows'), SED_ROWS); gl.uniform1f(p.u('uN'), SED_N)
    gl.uniform1f(p.u('uWrite'), this.writeHead); gl.uniform1f(p.u('uFilled'), this.filled)
    gl.uniform1f(p.u('uAge'), clampf(num(inp.age, 0.3), 0, 1))
    gl.uniform1f(p.u('uResurface'), clampf(num(inp.resurface, 0.5), 0, 1))
    gl.uniform1f(p.u('uStir'), clampf(num(inp.stir, 0.2), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.uniform1f(p.u('uTime'), this.time)
    gl.uniform1i(p.u('uBlend'), Math.round(num(inp.blend, 0)))
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.accCur = 1 - this.accCur
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.acc) { for (const b of this.acc) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.acc = null }
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo); this.ring = null }
  }
}

// ── Parallax node : real 2.5D from the shared depth map ──────────────────
// Native (not ISF) so host + depth are bound explicitly and the passthrough is
// exact — an ISF FX with a second image input fought the rack's inputImage bind
// (dry-wet + colours broke). Works on layer AND master racks (both are given a
// node context carrying `depth`). Flat / absent depth = clean passthrough.
export class ParallaxNode implements ConvNode {
  private time = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    const inp = ctx.inputs
    this.time += ctx.dt
    const out = ctx.chain.next()
    const p = g.use(g.parallax)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ctx.depth ?? ctx.host); gl.uniform1i(p.u('uDepth'), 1)
    gl.uniform1i(p.u('uHasDepth'), ctx.depth ? 1 : 0)
    gl.uniform1f(p.u('uAmount'), clampf(num(inp.amount, 0.4), 0, 1))
    gl.uniform1f(p.u('uAngle'), num(inp.angle, 0))
    gl.uniform1f(p.u('uSway'), clampf(num(inp.sway, 0.3), 0, 1))
    gl.uniform1f(p.u('uDof'), clampf(num(inp.dof, 0), 0, 1))
    gl.uniform1f(p.u('uFocus'), clampf(num(inp.focus, 0.5), 0, 1))
    gl.uniform1f(p.u('uFog'), clampf(num(inp.fog, 0), 0, 1))
    gl.uniform1f(p.u('uWet'), clampf(num(inp.wet, 1), 0, 1))
    gl.uniform1i(p.u('uInvert'), num(inp.invert, 0) >= 0.5 ? 1 : 0)
    gl.uniform1f(p.u('uTime'), this.time)
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void { this.disposed = true }
}

// ── Eternalism / Phase-Drift node : the persistence-of-vision family ─────
const ET_COLS = 4, ET_ROWS = 4, ET_N = ET_COLS * ET_ROWS // 16-frame ring (half-res)
export class EternalismNode implements ConvNode {
  private ring: RGBA | null = null
  private tw = 0
  private th = 0
  private writeHead = 0
  private filled = 0
  private time = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    const tw = Math.max(2, w >> 1), th = Math.max(2, h >> 1)
    if (this.ring && this.tw === tw && this.th === th) return
    const gl = this.gl
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo) }
    this.ring = makeRGBA(gl, tw * ET_COLS, th * ET_ROWS, false)
    this.tw = tw; this.th = th; this.writeHead = 0; this.filled = 0
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)
    const inp = ctx.inputs
    const ring = this.ring as RGBA
    this.time += ctx.dt

    const mode = Math.round(num(inp.mode, 0))
    const gap = clampf(Math.round(num(inp.gap, 4)), 1, ET_N - 2)
    let uGap = gap, uOffB = gap, uPhase = 0
    if (mode === 0) {
      uPhase = ((this.time * clampf(num(inp.rate, 6), 0.5, 20)) % 1 + 1) % 1
    } else {
      const det = clampf(num(inp.detune, 0.1), 0, 1)
      const beat = 0.5 + 0.5 * Math.sin(this.time * (0.2 + det * 1.5))
      uOffB = Math.min(ET_N - 2, gap + beat * det * (ET_N - 2))
    }

    // Present : read the ring's two taps.
    const out = ctx.chain.next()
    const p = g.use(g.eternal)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ring.tex); gl.uniform1i(p.u('uRing'), 1)
    gl.uniform2f(p.u('uAtlasTexel'), 1 / (this.tw * ET_COLS), 1 / (this.th * ET_ROWS))
    gl.uniform1f(p.u('uCols'), ET_COLS); gl.uniform1f(p.u('uRows'), ET_ROWS); gl.uniform1f(p.u('uN'), ET_N)
    gl.uniform1f(p.u('uWrite'), this.writeHead); gl.uniform1f(p.u('uFilled'), this.filled)
    gl.uniform1i(p.u('uMode'), mode)
    gl.uniform1f(p.u('uGap'), uGap); gl.uniform1f(p.u('uOffB'), uOffB); gl.uniform1f(p.u('uPhase'), uPhase)
    gl.uniform1f(p.u('uInterval'), clampf(num(inp.interval, 0.3), 0, 1))
    gl.uniform1f(p.u('uTint'), clampf(num(inp.tint, 0.3), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    // Store the current frame into the ring (half-res tile).
    const cp = g.use(g.copy)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, ring.fbo)
    const col = this.writeHead % ET_COLS, row = Math.floor(this.writeHead / ET_COLS)
    gl.viewport(col * this.tw, row * this.th, this.tw, this.th)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.writeHead = (this.writeHead + 1) % ET_N
    this.filled = Math.min(ET_N, this.filled + 1)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo); this.ring = null }
  }
}

// ── Afterimage node : Goethe's complementary-negative persistence ────────
export class AfterimageNode implements ConvNode {
  private acc: [RGBA, RGBA] | null = null
  private w = 0
  private h = 0
  private accCur = 0
  private seeded = false
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    if (this.acc && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.acc) for (const b of this.acc) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
    this.acc = [makeRGBA(gl, w, h, true), makeRGBA(gl, w, h, true)]
    this.w = w; this.h = h; this.accCur = 0; this.seeded = false
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)
    const inp = ctx.inputs
    const acc = this.acc as [RGBA, RGBA]

    // Seed the high-water with the live frame so it doesn't start black (leave=0).
    if (!this.seeded) {
      const cp = g.use(g.copy)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
      for (const b of acc) { gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3) }
      this.seeded = true
    }

    const read = acc[this.accCur], write = acc[1 - this.accCur]
    // 1) decaying brightness high-water (persistence of the departed light).
    const decayP = clampf(num(inp.decay, 0.6), 0, 1)
    const tau = 0.3 + decayP * decayP * 8 // 0.3s → ~8s afterimage
    let p = g.use(g.afterAcc)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, read.tex); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform1f(p.u('uDecay'), Math.exp(-ctx.dt / tau))
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    // 2) present : bloom the complementary ghost where a bright form has left.
    const out = ctx.chain.next()
    p = g.use(g.afterOut)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, write.tex); gl.uniform1i(p.u('uAcc'), 1)
    gl.uniform1f(p.u('uAmount'), clampf(num(inp.amount, 0.5), 0, 1))
    gl.uniform1f(p.u('uChroma'), clampf(num(inp.chroma, 0.6), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.accCur = 1 - this.accCur
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.acc) { for (const b of this.acc) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.acc = null }
  }
}

// ── Pulfrich node : monocular 3D from a temporal eye-delay ───────────────
// A frame-history ring read as a per-pixel delay, keyed by the shared depth map
// (or luminance), presented as an anaglyph pair or a motion-gated parallax slide.
// The disparity is temporal, so a still frame is byte-exact (no colour fringing)
// and depth blooms only on lateral motion. Works on any rack (both layer and
// master carry the depth context); flat/absent depth falls back to luminance.
const PU_COLS = 4, PU_ROWS = 4, PU_N = PU_COLS * PU_ROWS // 16-frame ring (half-res)
export class PulfrichNode implements ConvNode {
  private ring: RGBA | null = null
  private tw = 0
  private th = 0
  private writeHead = 0
  private filled = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    const tw = Math.max(2, w >> 1), th = Math.max(2, h >> 1)
    if (this.ring && this.tw === tw && this.th === th) return
    const gl = this.gl
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo) }
    this.ring = makeRGBA(gl, tw * PU_COLS, th * PU_ROWS, false)
    this.tw = tw; this.th = th; this.writeHead = 0; this.filled = 0
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)
    const inp = ctx.inputs
    const ring = this.ring as RGBA

    // Present : read the delayed eye from the ring and combine with the live eye.
    const out = ctx.chain.next()
    const p = g.use(g.pulfrich)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ring.tex); gl.uniform1i(p.u('uRing'), 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ctx.depth ?? ctx.host); gl.uniform1i(p.u('uDepth'), 2)
    gl.uniform2f(p.u('uAtlasTexel'), 1 / (this.tw * PU_COLS), 1 / (this.th * PU_ROWS))
    gl.uniform1f(p.u('uCols'), PU_COLS); gl.uniform1f(p.u('uRows'), PU_ROWS); gl.uniform1f(p.u('uN'), PU_N)
    gl.uniform1f(p.u('uWrite'), this.writeHead); gl.uniform1f(p.u('uFilled'), this.filled)
    gl.uniform1i(p.u('uHasDepth'), ctx.depth ? 1 : 0)
    gl.uniform1i(p.u('uMode'), Math.round(num(inp.mode, 0)))
    gl.uniform1i(p.u('uSrc'), Math.round(num(inp.source, 1)))
    gl.uniform1i(p.u('uSwap'), num(inp.swap, 0) >= 0.5 ? 1 : 0)
    gl.uniform1f(p.u('uDelay'), clampf(num(inp.delay, 5), 1, PU_N - 2))
    gl.uniform1f(p.u('uCurve'), clampf(num(inp.curve, 1), 0.2, 3))
    gl.uniform1f(p.u('uSep'), clampf(num(inp.separation, 0.4), 0, 1))
    gl.uniform1f(p.u('uDesat'), clampf(num(inp.desat, 0.4), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    // Store the current frame into the ring (half-res tile).
    const cp = g.use(g.copy)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, ring.fbo)
    const col = this.writeHead % PU_COLS, row = Math.floor(this.writeHead / PU_COLS)
    gl.viewport(col * this.tw, row * this.th, this.tw, this.th)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.writeHead = (this.writeHead + 1) % PU_N
    this.filled = Math.min(PU_N, this.filled + 1)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo); this.ring = null }
  }
}

/** Instantiate the native node for a reserved `node-*` shaderId (null if none). */
export function makeConvNode(gl: WebGL2RenderingContext, shaderId: string): ConvNode | null {
  if (shaderId === 'node-parallax') return new ParallaxNode(gl)
  if (shaderId === 'node-pulfrich') return new PulfrichNode(gl)
  if (shaderId === 'node-eternalism') return new EternalismNode(gl)
  if (shaderId === 'node-afterimage') return new AfterimageNode(gl)
  if (shaderId === 'node-transfert') return new TransfertNode(gl)
  if (shaderId === 'node-convolve') return new ConvolveNode(gl)
  if (shaderId === 'node-reponse') return new ReponseNode(gl)
  if (shaderId === 'node-feedback') return new FeedbackNode(gl)
  if (shaderId === 'node-datamosh') return new DatamoshNode(gl)
  if (shaderId === 'node-scanner') return new ScannerNode(gl)
  if (shaderId === 'node-autocutter') return new AutocutterNode(gl)
  if (shaderId === 'node-chronoscan') return new ChronoscanNode(gl)
  if (shaderId === 'node-sediment') return new SedimentNode(gl)
  return null
}

export const NATIVE_NODE_IDS = ['node-transfert', 'node-convolve', 'node-reponse', 'node-feedback', 'node-datamosh', 'node-scanner', 'node-autocutter', 'node-chronoscan', 'node-sediment', 'node-parallax', 'node-eternalism', 'node-afterimage', 'node-pulfrich']
export const isNativeNode = (id: string | null | undefined): boolean =>
  !!id && NATIVE_NODE_IDS.includes(id)
