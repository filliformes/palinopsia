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

import { glGeneration } from './glGeneration'

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
  sidechain2?: WebGLTexture | null // a second input (the Matte node's matte)
  inputs: Record<string, number | number[]> // param values (from the FxInstance)
  dt: number // seconds of THIS rack's clock (layer Speed / global speed / background 0.25x applied; 0 when frozen)
  depth?: WebGLTexture | null // shared scene-depth map : null when Depth is off (no flat stand-in)
  audioTex?: WebGLTexture | null // the shared 128x2 R8 audio texture (row 0 waveform at v .25, row 1 log spectrum at v .75)
  frame?: number // engine frame counter : a node that sees a gap (frame !== last + 1) was just (re)enabled
  bpm?: number // the transport tempo, for beat-synced nodes
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

// GLSL shared by the first-half node shaders : the Hoskins hash (feed it
// integer-spaced inputs, each under ~1e4) and straight-alpha helpers.
const GLSL_HASH = `
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`
const GLSL_PM = `
vec4 pm(vec4 c){ return vec4(c.rgb * c.a, c.a); }
vec4 unpm(vec4 c){ return vec4(c.a > 1e-5 ? c.rgb / c.a : vec3(0.0), c.a); }
// Dry/wet of two straight-alpha pictures, mixed premultiplied. The result never
// covers less than the dry picture : content moved into transparency shows, and
// a transparent past never punches a hole in the present.
vec4 mixStraight(vec4 a, vec4 b, float t){
  vec4 c = mix(pm(a), pm(b), t);
  return vec4(c.a > 1e-5 ? c.rgb / c.a : a.rgb, max(a.a, c.a));
}`

// Luma of the flow source at flow resolution. uBox > 0 averages a 4×4 grid over
// the output texel's footprint (a box prefilter : fine texture no longer aliases
// into flow noise); 0 = one bilinear tap.
const F_DOWNSAMPLE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex; uniform float uBox;
float lum(vec2 uv){ return dot(texture(uTex, uv).rgb, vec3(0.299,0.587,0.114)); }
void main(){
  float l = 0.0;
  if (uBox > 0.0) {
    for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
      vec2 d = (vec2(float(i), float(j)) - 1.5) * 0.25 * uBox;
      vec2 uv = vUV + d;
      l += lum(uv);
    }
    l *= 0.0625;
  } else l = lum(vUV);
  o = vec4(l, 0.0, 0.0, 1.0);
}`

// Gradient (poor-man's Lucas–Kanade) flow : RG = flow vector, in texels of a
// 256-wide field whatever the flow resolution (uScale = 256/res), so the flow-res
// dial is a quality knob, not a hidden gain.
const F_FLOW = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uCur, uPrev; uniform vec2 uRes; uniform float uLambda, uClamp, uScale;
void main(){
  vec2 texel = 1.0 / uRes;
  float c = texture(uCur, vUV).r;
  float p = texture(uPrev, vUV).r;
  float dx = texture(uCur, vUV + vec2(texel.x,0.0)).r - texture(uCur, vUV - vec2(texel.x,0.0)).r;
  float dy = texture(uCur, vUV + vec2(0.0,texel.y)).r - texture(uCur, vUV - vec2(0.0,texel.y)).r;
  float dt = c - p;
  vec2 grad = vec2(dx, dy) * 0.5;
  float mag2 = dot(grad, grad) + uLambda;
  vec2 flow = -dt * grad / mag2 * uScale;
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
// The warp carries alpha (a transparent layer stays transparent); reads past the
// frame mirror instead of smearing the border row across.
const F_DISPLACE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uFlow; uniform float uAmount, uMagGamma, uSpread, uSign;
vec2 mirror(vec2 u){ return 1.0 - abs(1.0 - mod(u, 2.0)); }
void main(){
  vec2 f = texture(uFlow, vUV).rg; float m = length(f);
  vec2 dir = m > 1e-6 ? f / m : vec2(0.0);
  // Below gamma 1 the curve lifts flow NOISE into visible motion : a small dead
  // zone (0 at gamma >= 1) keeps still areas still.
  m = pow(max(m - 0.0027 * max(1.0 - uMagGamma, 0.0), 0.0), uMagGamma);
  vec2 flow = dir * m * uAmount * uSign;
  vec2 ur = mirror(vUV + flow * (1.0 + uSpread));
  vec2 ug = mirror(vUV + flow);
  vec2 ub = mirror(vUV + flow * (1.0 - uSpread));
  vec4 R = texture(uHost, ur), G = texture(uHost, ug), B = texture(uHost, ub);
  o = vec4(R.r, G.g, B.b, max(G.a, max(R.a, B.a)));
}`

// « Traînée » : flow-steered 1D line blur (poor-man's SepConv), accumulated
// premultiplied so a stroke over transparency keeps its color and coverage.
const F_TRAINEE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uFlow;
uniform float uAmount, uMagGamma, uFalloff, uSign, uBidir; uniform int uTaps;
vec2 mirror(vec2 u){ return 1.0 - abs(1.0 - mod(u, 2.0)); }
void main(){
  vec2 f = texture(uFlow, vUV).rg * uAmount * uSign; float len = length(f);
  vec2 dir = len > 1e-5 ? f / len : vec2(0.0);
  len = pow(max(len - 0.0027 * uAmount * max(1.0 - uMagGamma, 0.0), 0.0), uMagGamma);
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int i = -uTaps; i <= uTaps; i++){
    float t = float(i) / float(uTaps);
    if (uBidir < 0.5 && t < 0.0) continue; // trailing only
    float w = 1.0 - abs(t) * uFalloff;
    vec2 uv = mirror(vUV + dir * t * len);
    vec4 s = texture(uHost, uv);
    acc += vec4(s.rgb * s.a, s.a) * w; wsum += w;
  }
  acc /= max(wsum, 1e-4);
  o = vec4(acc.a > 1e-5 ? acc.rgb / acc.a : vec3(0.0), acc.a);
}`

// ── Module 1 : Convolution (ConvolveSpatial), direct kernel path ─────────
// The sidechain frame is the kernel (point-spread function): every host pixel
// stamps a scaled copy of it. Direct brute-force gather (the spec's `quality:
// "direct"` path, done well) at reduced res : reliable + verifiable now; FFT
// large-kernel is a future `quality` upgrade. Kernel is read LIVE from the
// sidechain each frame, normalized per-output by the accumulated weight
// (energy-conserving, no reduction pass).
// The kernel weights are the same for every output pixel, so a tiny prepass
// thresholds + gammas them once into a (2R+1)² texture (F_CONV_KERNEL) instead of
// per pixel per tap. Texel (i+R, j+R) holds tap (i, j).
const F_CONV_KERNEL = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uKernel; uniform float uThreshold, uGamma; uniform int uR;
void main(){
  vec2 ij = floor(gl_FragCoord.xy) - float(uR);
  vec2 kuv = 0.5 + ij / float(2 * uR + 1);
  vec4 k = texture(uKernel, kuv);
  float kw = max(0.0, dot(k.rgb, vec3(0.299,0.587,0.114)) * k.a - uThreshold);
  o = vec4(kw > 0.0 ? pow(kw, uGamma) : 0.0, 0.0, 0.0, 1.0);
}`
// Wet out is PREMULTIPLIED (so the mix pass composites coverage correctly); an
// empty kernel (a blank sidechain) writes alpha -1, which the mix pass reads as
// "leave the layer as it is" (the weight sum is the same at every pixel).
const F_CONVOLVE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uKW;
uniform float uExtent, uAspect, uBoost;
uniform int uR;
const int MAXR = 12;
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
void main(){
  // Kernel spread as a fraction of the frame, aspect-corrected so it stays round.
  float stepUV = uExtent / float(2 * uR + 1);
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int j = -MAXR; j <= MAXR; j++){
    if (j < -uR || j > uR) continue;
    for (int i = -MAXR; i <= MAXR; i++){
      if (i < -uR || i > uR) continue;
      float kw = texelFetch(uKW, ivec2(i + uR, j + uR), 0).r;
      if (kw <= 0.0) continue;
      // host sample, highlight-boosted so only hot pixels bloom (uBoost gate).
      vec2 off = vec2(float(i) * stepUV / uAspect, float(j) * stepUV);
      vec2 uv = vUV - off;
      vec4 h = texture(uHost, uv);
      float b = uBoost <= 0.0 ? 1.0 : smoothstep(uBoost, 1.0, luma(h.rgb));
      acc += vec4(h.rgb * h.a, h.a) * (b * kw); wsum += kw;
    }
  }
  o = wsum > 1e-5 ? acc / wsum : vec4(0.0, 0.0, 0.0, -1.0);
}`

// Composite the (reduced-res) convolved 'wet' back over the full-res dry host.
// With the highlight gate on, the wet can only LIGHTEN in mix mode : a gated wet
// is dark away from the highlights and must not dim the layer there.
const F_CONV_MIX = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uDry, uWet; uniform float uGain, uMix, uAdditive, uGate;
void main(){
  vec4 dry = texture(uDry, vUV);
  vec4 w = texture(uWet, vUV);
  if (w.a < -0.5) { o = dry; return; }            // empty kernel : untouched
  vec4 d = vec4(dry.rgb * dry.a, dry.a);
  vec4 wet = vec4(w.rgb * uGain, clamp(w.a, 0.0, 1.0));
  vec4 c;
  if (uAdditive > 0.5) c = vec4(d.rgb + wet.rgb * uMix, d.a + wet.a * uMix * (1.0 - d.a));
  else {
    if (uGate > 0.5) wet = max(wet, d);
    c = mix(d, wet, uMix);
  }
  c.a = max(c.a, d.a);
  o = vec4(c.a > 1e-5 ? c.rgb / c.a : dry.rgb, c.a);
}`

// ── Module 3 : Réponse (temporal frame-echo convolution) ─────────────────
// A ring of N past host frames (half-res, tiled into one atlas). Output =
// Σ history[i]·envelope[i], normalized : trails that pulse with a shaped
// temporal IR (attack/decay/reverse). Convolves the host's OWN time-history
// (no sidechain needed). Copy a downsampled host frame into the write tile
// (alpha kept : rings, seeds and accumulators carry the layer's coverage).
const F_COPY = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex;
void main(){ o = texture(uTex, vUV); }`

// Echo: tap 0 is the live host (full res, so a still picture stays sharp); taps
// 1.. are the ring's past frames (uLast = the newest stored one). Weighted by the
// envelope, normalized, then scaled by GAIN, and mixed with dry premultiplied.
const F_ECHO = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uRing;
uniform int uCols, uRows, uLast, uLen;
uniform float uEnv[16]; uniform float uMix, uGain;
${GLSL_PM}
void main(){
  vec4 host = texture(uHost, vUV);
  vec4 acc = pm(host) * uEnv[0]; float wsum = uEnv[0];
  vec2 tile = 1.0 / vec2(float(uCols), float(uRows));
  vec2 ins = tile * 0.001; // half-texel-ish inset to avoid tile bleed
  int N = uCols * uRows;
  for (int i = 1; i < 16; i++){
    if (i >= uLen) break;
    int slot = uLast - (i - 1); slot = slot - N * int(floor(float(slot) / float(N)));
    int col = slot % uCols; int row = slot / uCols;
    vec2 base = vec2(float(col), float(row)) * tile;
    vec2 tuv = base + ins + clamp(vUV, 0.0, 1.0) * (tile - ins * 2.0);
    vec4 s = texture(uRing, tuv);
    acc += pm(s) * uEnv[i]; wsum += uEnv[i];
  }
  vec4 e = wsum > 1e-5 ? acc / wsum : pm(host);
  vec4 echo = vec4(e.a > 1e-5 ? clamp(e.rgb / e.a * uGain, 0.0, 1.0) : vec3(0.0), e.a);
  o = mixStraight(host, echo, uMix);
}`

interface Prog {
  prog: WebGLProgram
  u: (n: string) => WebGLUniformLocation | null
}

// ── Feedback engine (video-feedback spike) : sample last output through a
//    drifting-pivot transform + self-displacement, mix a fresh source, with a
//    built-in AGC + noise-floor so it sits at the edge of chaos without dying or
//    blowing out. Ping-pong RGBA16F, owned by FeedbackNode.
//    The buffer holds STRAIGHT RGBA (it is also the node's output); the loop's
//    linear steps run premultiplied so a transparent layer's trails carry their
//    coverage. Per-frame constants arrive pre-scaled by the rack's frame step
//    (uFrames = dt*60), so trails and spin keep their speed at any frame rate.
const F_FEEDBACK = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev, uRing, uCross, uAgcTex;
uniform vec2 uRes, uOff, uPivot, uRingTexel;
uniform float uFeedback, uGain, uScaleZ, uRot, uWarp, uHue, uBlur, uAgc, uNoise, uSeed, uFrames, uAspect;
uniform float uKeyThresh, uKeySoft, uBorder, uBorderHue, uHueCurve, uDelayMix, uCouple, uSat;
uniform int uBlend, uKeyMode, uRingCols, uRingRows, uDelayTileR, uDelayTileG, uDelayTileB, uRoute, uPlacement;
${GLSL_HASH}
${GLSL_PM}
// One tile of the delay ring atlas at uv, inset half a texel (no seam bleeding in
// from the neighboring tile).
vec4 ringTap(int tile, vec2 uv){
  int col = tile - (tile / uRingCols) * uRingCols;
  int row = tile / uRingCols;
  vec2 span = 1.0 / vec2(float(uRingCols), float(uRingRows));
  vec2 base = vec2(float(col), float(row)) * span;
  vec2 rtUV = clamp(base + clamp(uv, 0.0, 1.0) * span, base + 0.5 * uRingTexel, base + span - 0.5 * uRingTexel);
  return texture(uRing, rtUV);
}
float inFrame(vec2 u){ return step(0.0, u.x) * step(u.x, 1.0) * step(0.0, u.y) * step(u.y, 1.0); }
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
  // Transform the read-UV about the (drifting, off-center) pivot : zoom + rotate
  // + drift. Rotation runs in aspect-true space, so the spiral stays rigid at
  // 16:9 instead of shearing into an ellipse. Small values → structure emerges
  // slowly, stays matte.
  vec2 c = vUV - uPivot;
  c.x *= uAspect;
  float ca = cos(uRot), sa = sin(uRot);
  c = mat2(ca, -sa, sa, ca) * (c * uScaleZ); // uScaleZ = (1 - zoom)^frames : zoom>0 magnifies outward
  c.x /= uAspect;
  vec2 ruv = c + uPivot + uOff;
  vec4 host = texture(uHost, vUV);

  // Self-displacement by the buffer's own hue/value (the "alive" term : organic
  // boiling / reaction-diffusion motion instead of a rigid spiral).
  vec4 p0 = texture(uPrev, uPlacement == 1 ? vUV : ruv);
  vec3 hsv0 = rgb2hsv(p0.rgb);
  vec2 disp = uWarp * 0.03 * (hsv0.z * hsv0.y * p0.a) * vec2(cos(hsv0.x * 6.2831853), sin(hsv0.x * 6.2831853));
  ruv += disp;

  // PLACEMENT : the spatial process (zoom/rotate/drift/self-warp) sits EITHER on
  // the recirculating buffer (feedback : the classic wandering tunnel) OR on the
  // incoming live image (painting : the source is smeared into a still
  // accumulator that holds its shape). One transform, two very different looks.
  vec2 bufUV = (uPlacement == 1) ? vUV : ruv;
  vec2 srcUV = (uPlacement == 1) ? ruv : vUV;

  vec4 pv; // premultiplied from here to the blend
  if (uBlur > 0.001){
    // Sized on frame height; the spread grows with √(frame step), so the softening
    // per second is the same at any frame rate (and a frozen layer stops blurring).
    vec2 t = (0.5 + uBlur * 2.0) * sqrt(min(uFrames, 4.0)) * (uRes.y / 1080.0) / uRes;
    vec2 u1 = bufUV + vec2(t.x, 0.0), u2 = bufUV - vec2(t.x, 0.0), u3 = bufUV + vec2(0.0, t.y), u4 = bufUV - vec2(0.0, t.y);
    pv = (pm(texture(uPrev, bufUV)) * 2.0 + pm(texture(uPrev, u1)) + pm(texture(uPrev, u2))
        + pm(texture(uPrev, u3)) + pm(texture(uPrev, u4))) / 6.0;
  } else pv = pm(texture(uPrev, bufUV));

  // COUPLE : cross-inject the companion buffer (fb1) which evolves under a DIFFERENT
  // transform → emergent behavior no single loop shows (dual coupled buffers).
  if (uCouple > 0.001) pv = mix(pv, pm(texture(uCross, bufUV)), uCouple);

  // DELAY TAP with PER-CHANNEL RGB delay (time-shear : each channel from a slightly
  // different past frame). ROUTE : fed BACK into the loop (accumulates) or FED
  // FORWARD onto the output only (a non-accumulating echo, screen-blended at the end).
  vec4 dtap = vec4(0.0);
  bool hasDelay = uDelayMix > 0.001;
  if (hasDelay){
    vec4 tr = ringTap(uDelayTileR, bufUV), tg = ringTap(uDelayTileG, bufUV), tb = ringTap(uDelayTileB, bufUV);
    dtap = pm(vec4(tr.r, tg.g, tb.b, tg.a));
    if (uRoute == 0) pv = mix(pv, dtap, uDelayMix); // feedback : re-enters the loop
  }

  // A read past the frame takes the LIVE picture there, never the clamped edge
  // row (which re-entered the loop every frame and grew streaks).
  pv = mix(pm(host), pv, inFrame(bufUV));

  // AGC : the correction comes from a 1×1 prepass that compares the buffer's mean
  // (premultiplied) luma with the LIVE source's, smoothed over ~0.1 s. The loop
  // settles at the brightness of what feeds it : gain can sit at G≈1 without
  // runaway or collapse, and a near-black ground stays near-black (no gray lift).
  float agcCorr = 1.0;
  if (uAgc > 0.001) agcCorr = mix(1.0, clamp(texture(uAgcTex, vec2(0.5)).r, 0.35, 2.5), uAgc);
  vec4 pc = unpm(pv); // straight color for the nonlinear steps
  pc.rgb *= pow(max(uGain * agcCorr, 1e-4), uFrames);

  // Hue cycle : linear rate uHue, made NONLINEAR by uHueCurve (a sine term on
  // the hue itself) so the palette churns chaotically instead of drifting evenly.
  // SAT DRIFT : nudge saturation a little every repeat so the trail bleaches
  // toward gray (uSat<0) or intensifies toward neon (uSat>0) as it ages.
  if (abs(uHue) > 0.001 || uHueCurve > 0.001 || abs(uSat) > 0.001){
    vec3 h = rgb2hsv(pc.rgb);
    h.x = fract(h.x + uHue * (1.0 + uHueCurve * 3.0 * sin(h.x * 12.566371)));
    h.y = clamp(h.y * (1.0 + uSat), 0.0, 1.0);
    pc.rgb = hsv2rgb(h);
  }

  // KEYER : where the source is keyed out (dark for key-black, bright for
  // key-white) the feedback fills in; elsewhere the source shows. A bright border
  // around the key edge re-enters the loop → regenerating hard-edged shapes.
  vec4 src = texture(uHost, srcUV);
  if (uPlacement == 1) src = mix(host, src, inFrame(srcUV)); // painting : no edge-row smear
  float fbAmt = uFeedback;
  float keyed = 0.0;
  if (uKeyMode > 0){
    // Modes 1/2 key on LUMA (black / white); modes 3/4 key on CHROMA = saturation
    // (desat / colorful). Low-side modes (1,3) invert. The keyed region is where
    // the feedback fills in; elsewhere the live source shows through.
    float kv = (uKeyMode <= 2) ? dot(src.rgb, vec3(0.299, 0.587, 0.114)) : rgb2hsv(src.rgb).y;
    float k = smoothstep(uKeyThresh - uKeySoft - 0.001, uKeyThresh + uKeySoft + 0.001, kv);
    keyed = (uKeyMode == 1 || uKeyMode == 3) ? (1.0 - k) : k;
    fbAmt = uFeedback * keyed;
  }

  vec4 sP = pm(src), fP = pm(pc);
  vec4 oP;
  float trailA = max(sP.a, fP.a * fbAmt);
  if (uBlend == 1) {
    // ADD with luma headroom : a bright live pixel leaves less room for the loop
    // on top, so hot trails glow and saturate instead of running away to white.
    float room = 1.0 - clamp(dot(src.rgb, vec3(0.299, 0.587, 0.114)) * src.a, 0.0, 1.0);
    oP = vec4(sP.rgb + fP.rgb * fbAmt * room, trailA);
  }
  else if (uBlend == 2) oP = vec4(sP.rgb + fP.rgb * fbAmt - sP.rgb * fP.rgb * fbAmt, trailA);
  else if (uBlend == 3) oP = vec4(mix(sP.rgb, abs(sP.rgb - fP.rgb), fbAmt), trailA);
  else if (uBlend == 4) oP = vec4(mix(sP.rgb, max(sP.rgb, fP.rgb), fbAmt), trailA);
  else oP = mix(sP, fP, fbAmt);
  vec4 outc = vec4(oP.a > 1e-5 ? oP.rgb / oP.a : src.rgb, max(src.a, oP.a));

  if (uKeyMode > 0 && uBorder > 0.001){
    float edge = clamp(length(vec2(dFdx(keyed), dFdy(keyed))) * 40.0, 0.0, 1.0) * uBorder;
    outc.rgb = mix(outc.rgb, hsv2rgb(vec3(uBorderHue, 0.9, 1.0)), edge);
    outc.a = max(outc.a, edge);
  }

  // Feedforward routing : the delay echo rides on top of the output only (screen),
  // so it never compounds in the accumulator.
  if (hasDelay && uRoute == 1){
    vec4 op = pm(outc), dd = clamp(dtap, 0.0, 1.0) * uDelayMix;
    outc = unpm(op + dd - op * dd);
  }

  // Noise floor : never dies flat (scaled to the frame step, so a frozen layer
  // holds still instead of accumulating grain).
  outc.rgb += (hash13(vec3(floor(gl_FragCoord.xy), uSeed)) - 0.5) * uNoise * 0.04 * sqrt(clamp(uFrames, 0.0, 4.0));
  o = vec4(clamp(outc.rgb, 0.0, 1.0), clamp(outc.a, 0.0, 1.0));
}`

// Feedback AGC state (1×1, ping-pong) : R = smoothed correction (live source
// mean luma / buffer mean luma), both read premultiplied on a 16×16 grid.
const F_FB_AGC = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev, uState; uniform float uK;
float lumP(vec4 c){ return dot(c.rgb, vec3(0.299, 0.587, 0.114)) * c.a; }
void main(){
  float m = 0.0, s = 0.0;
  for (int j = 0; j < 16; j++) for (int i = 0; i < 16; i++) {
    vec2 uv = (vec2(float(i), float(j)) + 0.5) / 16.0;
    m += lumP(texture(uPrev, uv)); s += lumP(texture(uHost, uv));
  }
  m /= 256.0; s /= 256.0;
  float ratio = s / max(m, 0.01);
  o = vec4(mix(texture(uState, vec2(0.5)).r, ratio, uK), m, s, 1.0);
}`

// Straight alpha from a premultiplied buffer (Autocutter's crossfade).
const F_UNPREMUL = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex;
void main(){ vec4 c = texture(uTex, vUV); o = vec4(c.a > 1e-5 ? c.rgb / c.a : vec3(0.0), clamp(c.a, 0.0, 1.0)); }`

// ── Datamosh engine ──────────────────────────────────────────────────────
// The real datamosh look, faked in real time (no codec): a per-MACROBLOCK motion
// field (optical flow of the live signal, or a sidechain layer, quantized to a
// block grid) advects an accumulator buffer each frame, so the picture keeps
// sliding along motion (the P-frame smear). A `refresh` term lerps the buffer back
// to the live frame (the I-frame); dropping it low lets a new scene's motion drag
// the PREVIOUS scene's texture around (the bloom). `residual` re-injects live
// texture (the mosh↔mush line); a block-granular stochastic `reseed` keeps it from
// mushing. STICKY mode slides each block as a rigid tile (crisp, real-datamosh
// tearing); MELT mode is a softer per-pixel smear. Chroma `bleed` = codec color
// bleed. Block-constant vectors tear at block edges : the macroblock signature.
// The accumulator is straight RGBA (a transparent layer moshes its coverage too)
// and every per-frame constant is raised to uFrames (= dt*60), so the smear
// lingers the same time at any frame rate and holds still on a frozen layer.
const F_DATAMOSH = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev, uFlow, uEnergy, uActantMask;
uniform vec2 uRes;
uniform float uBlock, uMotion, uRefresh, uResidual, uReseed, uDecay, uBleed, uThresh, uSeed, uAutoBloom, uBloom, uSwirl, uActant, uManifest;
uniform float uMoshGate, uRepel, uResharp, uFrames;
uniform int uMode, uFlowInvert;
${GLSL_HASH}
${GLSL_PM}
float lumD(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float inFrame(vec2 u){ return step(0.0, u.x) * step(u.x, 1.0) * step(0.0, u.y) * step(u.y, 1.0); }
// A per-frame blend weight w, applied f times : 1 - (1 - w)^f.
float perFrames(float w){ return 1.0 - pow(max(1.0 - w, 1e-6), uFrames); }
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
  // a rigid tile, tearing at block edges : the real datamosh look), read as the
  // mean of 4 taps around the block center. MELT/FLUID = the per-pixel flow → a
  // softer warp/smear (FLUID feeds a temporally-averaged flow).
  vec2 rawmv;
  if (uMode == 1) {
    vec2 q = blk * 0.25;
    vec2 b0 = blockCenter - q, b1 = blockCenter + vec2(q.x, -q.y), b2 = blockCenter + vec2(-q.x, q.y), b3 = blockCenter + q;
    rawmv = (texture(uFlow, b0).rg + texture(uFlow, b1).rg + texture(uFlow, b2).rg + texture(uFlow, b3).rg) * 0.25;
  } else rawmv = texture(uFlow, vUV).rg;
  rawmv *= uMotion;
  // EDGE REPEL : push the motion by the host's own luma gradient, so the smear
  // slides along / away from content edges instead of purely along motion (a more
  // liquid, contour-hugging melt). Signed : +away from bright, −toward.
  if (abs(uRepel) > 0.001) {
    float rx = lumD(texture(uHost, vUV + vec2(texel.x, 0.0)).rgb) - lumD(texture(uHost, vUV - vec2(texel.x, 0.0)).rgb);
    float ry = lumD(texture(uHost, vUV + vec2(0.0, texel.y)).rgb) - lumD(texture(uHost, vUV - vec2(0.0, texel.y)).rgb);
    rawmv += vec2(rx, ry) * uRepel * 0.06;
  }
  // Motion-vector manipulation (as ffglitch does, on our flow field) : invert the
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
  vec2 uvR = dispUV + cb, uvB = dispUV - cb;
  vec4 ag = texture(uPrev, dispUV);
  vec4 advected = vec4(texture(uPrev, uvR).r, ag.g, texture(uPrev, uvB).b, ag.a);

  vec4 hostS = texture(uHost, vUV);
  vec3 host = hostS.rgb;
  vec4 H = pm(hostS);
  // Advection from past the frame takes the live picture (no border streaks).
  vec4 A = mix(H, pm(advected), inFrame(dispUV));

  // ACTANTS : sparse localized patches (seeded by a trigger, advecting along the
  // flow in their own mask) that FREEZE and drag their texture : autonomous
  // persistent blocks. Where the mask is high, force near-total persistence and
  // immunity to reset/reseed, so the patch sticks and smears.
  float act = uActant * texture(uActantMask, vUV).r;

  // Accumulator persists by DECAY. Still areas (mv≈0) sample themselves and
  // converge back to host over ~1/(1-decay) frames : the smear LINGERS where the
  // motion was, then cleans up. Moving areas keep sliding (the P-frame smear).
  float dec = mix(uDecay, 0.985, bloom * 0.6);         // bloom boosts persistence
  dec = mix(dec, 0.99, act);                           // actants : near-total hold
  // MOSH GATE : bias the hold toward MOVING parts (+) or STILL parts (−). Positive
  // freezes the smear only where there's motion (the rest stays live); negative
  // holds the still background and lets the moving figures read through clean.
  if (abs(uMoshGate) > 0.001) {
    float mg = smoothstep(uThresh, uThresh * 8.0 + 0.01, fmag);
    dec *= mix(1.0, (uMoshGate > 0.0) ? mg : (1.0 - mg), abs(uMoshGate)) * (1.0 - act) + act;
  }
  dec = pow(max(dec, 1e-6), uFrames);                   // per-frame hold, at any frame rate
  vec4 outP = mix(H, A, dec);
  outP = mix(outP, H, perFrames(uResidual * 0.5 * (1.0 - act))); // extra live-texture re-inject

  // MANIFESTATION : instead of a clean I-frame cut, the live frame re-enters only
  // where there's MOTION : the new source completes itself out of the retained
  // frame along the flow. Still regions stay frozen; moving edges reveal the live.
  float mo = smoothstep(uThresh, uThresh * 4.0 + 0.001, fmag);
  float reset = clamp(refresh + uManifest * mo, 0.0, 1.0) * (1.0 - act);
  outP = mix(outP, H, perFrames(reset));               // I-frame reset / manifestation

  // Stochastic block reseed : whole blocks snap back to host, re-introducing
  // detail so the smear never fully mushes (the random-reset idea of optical-flow
  // transfer tools). The per-block chance is per 1/60 s.
  vec3 bid = vec3(floor(vUV * uRes / max(uBlock, 1.0)), uSeed);
  float rs = step(1.0 - perFrames(uReseed * 0.3), hash13(bid)) * (1.0 - act);
  outP = mix(outP, H, rs);
  vec4 outc = unpm(outP);

  // RE-SHARP : the smear softens the picture; add the host's own high-frequency
  // detail back so edges crisp up again without breaking the mosh (unsharp mask
  // against a 4-tap box of the live frame).
  if (uResharp > 0.001) {
    vec3 hb = (texture(uHost, vUV + vec2(texel.x, 0.0)).rgb + texture(uHost, vUV - vec2(texel.x, 0.0)).rgb
             + texture(uHost, vUV + vec2(0.0, texel.y)).rgb + texture(uHost, vUV - vec2(0.0, texel.y)).rgb) * 0.25;
    outc.rgb += (host - hb) * uResharp * 2.0 * min(uFrames, 4.0);
  }

  o = vec4(clamp(outc.rgb, 0.0, 1.0), clamp(outc.a, 0.0, 1.0));
}`

// Actant mask : a single-channel field of localized "sticky" patches. Each frame
// it ADVECTS along the same motion field as the mosh (so the patches drift with
// the picture) and DECAYS; on a trigger frame it STAMPS a burst of soft blobs at
// random centers. The datamosh pass reads this mask to freeze + hold those spots.
const F_ACTANT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uPrev, uFlow;
uniform vec2 uRes, uCenters[6];
uniform float uDecay, uMotion, uStamp, uRad, uNStamp;
uniform int uFlowInvert;
void main(){
  vec2 mv = texture(uFlow, vUV).rg * uMotion;
  if (uFlowInvert == 1) mv = -mv;
  // advect + decay the mask (a half-float buffer, with a tiny floor so it truly
  // reaches 0 : an 8-bit mask stalled at a permanent partial freeze)
  float m = max(texture(uPrev, vUV - mv).r * uDecay - 1e-4, 0.0);
  if (uStamp > 0.5) {
    float aspect = uRes.x / uRes.y;
    for (int i = 0; i < 6; i++) {
      if (float(i) < uNStamp) {
        vec2 d = vUV - uCenters[i]; d.x *= aspect;      // aspect-correct blobs
        m = max(m, 1.0 - smoothstep(uRad * 0.25, uRad, length(d)));
      }
    }
  }
  o = vec4(clamp(m, 0.0, 1.0), 0.0, 0.0, 1.0);
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
// different times, any motion during the sweep smears/tears across scanlines :
// the flatbed-scanner-with-a-moving-object glitch. `drag` shears the capture (the
// paper sliding under the head), `wobble` adds a hand-wave (a fresh phase every
// pass), `jitter`/`tear` add per-line rips (slabs sized on frame height), `rgb`
// splits the CCD channels, `audio` offsets each captured line by the waveform.
// Content only (no scan bar) : the bar is added in the present pass so it never
// bakes into the frozen document. The clamp smear at the side edges stays : it
// reads as the paper dragged past the glass.
const F_SCAN = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev, uAudioTex; uniform vec2 uRes; uniform int uAxis;
uniform float uPrevP, uCurP; uniform int uWrapped;
uniform float uDrag, uWobble, uJitter, uTear, uRgb, uSeed, uPhase, uPx, uAudio;
${GLSL_HASH}
float hash(float x){ return hash13(vec3(x, uSeed, 7.0)); }
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
  vec4 col;
  if (captured){
    float span = (uAxis <= 1) ? uRes.y : uRes.x;
    // Slab height in pixels, scaled with the render size (1 px at 1080p per step).
    float tearQ = mix(1.0, 6.0 + floor(uTear * 40.0), step(0.001, uTear)) * uPx;
    float tline = floor(s * (span / tearQ));
    float jit = (hash(tline) - 0.5) * uJitter * 0.12;                 // per-slab rip
    float drag = (s - 0.5) * uDrag * 0.35;                            // steady shear
    float wob = sin(s * 20.0 + uPhase) * uWobble * 0.06;              // hand wobble
    float aud = (texture(uAudioTex, vec2(s, 0.25)).r - 0.5) * uAudio * 0.2; // the waveform, line by line
    float off = jit + drag + wob + aud;
    float k = uRgb * 0.02;                                            // CCD channel split
    vec4 G = texture(uHost, axisUV(uAxis, s, c + off));
    col = vec4(
      texture(uHost, axisUV(uAxis, s, c + off + k)).r,
      G.g,
      texture(uHost, axisUV(uAxis, s, c + off - k)).b,
      G.a);
  } else {
    col = texture(uPrev, vUV);                                        // hold the document
  }
  o = col;
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
  vec4 b = texture(uBuf, vUV);
  o = vec4(clamp(b.rgb * b.a + bar, 0.0, 1.0) / max(max(b.a, bar), 1e-5), clamp(max(b.a, bar), 0.0, 1.0));
}`

// ── Autocutter (BSP cut-up rearrange) ────────────────────────────────────
// The frame is recursively split (binary space partition) into ragged rectangles,
// then the pieces are SHUFFLED among their own slots (a seeded permutation) and
// optionally rotated 90°/180°/270°. Each output cell samples the LIVE host from a
// different cell's region, so the scramble layout holds while the video keeps
// moving inside each piece : a live cut-up collage. Cells/permutation/rotation are
// computed on the CPU (see AutocutterNode) and passed as uniform arrays; the
// fragment just finds its dest cell and remaps. Seams, tears and Voronoi
// distances are measured in aspect-true units (frame height), so vertical and
// horizontal cuts match. Output is straight alpha; the crossfade passes
// (uPremul = 1) write premultiplied for their additive blend.
// TORN : the torn-paper code is compiled only into its own variant, so an
// Autocutter with torn at 0 runs exactly the plain program.
const F_AUTOCUT = (torn: boolean): string => `#version 300 es
#define TORN ${torn ? 1 : 0}
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost;
uniform int uCount;
uniform int uShape;       // 0 = cut-up rectangles (BSP), 1 = mosaic (Voronoi)
uniform vec4 uCell[64];   // rect: dest (x,y,w,h) - mosaic: seed .xy (dest cell)
uniform vec4 uMap[64];    // rect: source rect  - mosaic: source seed .xy
uniform float uRot[64];   // 0..3 (x90 deg)
uniform float uGap, uSlip, uMix, uSeed, uContour, uTorn, uMask, uCurve, uFade, uAspect, uPremul;
uniform float uRank[64];  // per-piece dropout order; the survivor holds 2.0
uniform float uPx;        // one pixel, in frame-height units
${GLSL_HASH}
float hash(float i, float k){ return hash13(vec3(i, k, uSeed)); }
// 2D value noise for the tear lines : re-seeded per cut, so every re-cut tears
// along fresh contours.
float vhash(vec2 p){ return hash13(vec3(mod(p, 4096.0), uSeed)); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), f.x),
             mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// CONTOUR : a continuous domain warp of the cell lookup. Because every pixel
// still resolves to exactly ONE (warped) cell, the pieces stay a perfect
// tessellation - no gaps, no overlaps - while their boundaries wander (coarse
// octave) and fray (fine octave) like torn paper instead of ruled cuts. In
// mosaic mode the same warp bends the Voronoi borders the same way.
// CURVE LENGTH picks the warp's wavelength : low = many small waves, high = few
// LONG sweeping curves. Default 0.3 reproduces the original fixed frequency.
vec2 tearWarp(vec2 p){
  float fc = mix(12.0, 2.2, clamp(uCurve, 0.0, 1.0));
  float ff = fc * 5.2;
  float fray = (0.25 + 0.2 * max(uContour - 1.0, 0.0)) * (1.0 - 0.7 * uCurve);
  vec2 q = vec2(p.x * uAspect, p.y); // aspect-true noise : tears are not stretched sideways
  vec2 w = (vec2(vnoise(q * fc), vnoise(q * fc + 31.7)) - 0.5) * (1.0 - fray)
         + (vec2(vnoise(q * ff + 11.3), vnoise(q * ff + 71.9)) - 0.5) * fray;
  w.x /= uAspect;
  return p + w * uContour * 0.045 * (1.0 + uCurve * 1.1);
}
vec2 rot90(vec2 p, float r){
  p -= 0.5; int ri = int(r + 0.5);
  if (ri == 1) p = vec2(-p.y, p.x);
  else if (ri == 2) p = -p;
  else if (ri == 3) p = vec2(p.y, -p.x);
  return p + 0.5;
}
// Quarter-turn about the origin (mosaic content rotation, no 0.5 recenter).
vec2 rotL(vec2 v, float r){
  int ri = int(r + 0.5);
  if (ri == 1) return vec2(-v.y, v.x);
  if (ri == 2) return -v;
  if (ri == 3) return vec2(v.y, -v.x);
  return v;
}
float keepOf(int i){ return smoothstep(uMask - 0.06, uMask, uRank[i]); }
// Piece i's picture at wUV (its source region, turned and slipped). Past the
// piece's own edge it simply reads on into the host (a torn overhang is a few
// pixels). Explicit LOD : torn paper reads a neighbour inside per-pixel
// branches, where implicit derivatives are undefined (the chain has no mips).
vec4 pieceAt(int i, vec2 wUV, vec2 A){
  if (uShape == 1){
    vec2 slip = (vec2(hash(float(i), 1.0), hash(float(i), 2.0)) - 0.5) * uSlip * 0.3;
    vec2 local = rotL((wUV - uCell[i].xy) * A, uRot[i]) / A;
    return textureLod(uHost, clamp(uMap[i].xy + local + slip, 0.0, 1.0), 0.0);
  }
  vec4 d = uCell[i];
  vec2 luv = rot90((wUV - d.xy) / d.zw, uRot[i]);
  vec4 sr = uMap[i];
  vec2 slip = (vec2(hash(float(i), 1.0), hash(float(i), 2.0)) - 0.5) * uSlip;
  return textureLod(uHost, sr.xy + (luv + slip) * sr.zw, 0.0);
}
#if TORN
// TORN PAPER, modelled on a real torn-magazine collage (as Collage's). Along
// every tear one piece lies OVER its neighbour (a per-piece order; a masked
// piece is a hole and always lies under) : only that upper piece shows the
// white core of the paper, where the tear stripped its printed skin at an
// angle; the other side is just covered. The rip line is ragged at every scale,
// the white is a hairline for long stretches and then bites in deep (a
// heavy-tailed width), its outer rim is thin and fibrous, a few loose fibres
// stick out past it, the printed skin ends in a faint ink line, and the upper
// piece casts a soft shadow on what lies below, longer on the side away from
// the light (top left). The fine raggedness, rim and fibres are the paper's own
// fibre size, never a share of the bite (that turned a deep tear furry). A tear
// over a hole drops its shadow onto the layers underneath. Frame borders are
// cuts, not tears. Returns PREMULTIPLIED colour, coverage in alpha.
float order(int i){ return hash(float(i) * 1.618 + 0.37, 4.21); }
vec4 tornPaper(int C, int N, vec4 colC, float ed, vec2 dir, vec2 qa, vec2 wUV, vec2 A){
  float keepC = keepOf(C);
  float keepN = keepOf(N);
  float zC = keepC > 0.5 ? order(C) : -1.0;
  float zN = keepN > 0.5 ? order(N) : -1.0;
  if (zC < 0.0 && zN < 0.0) return vec4(0.0);
  bool upC = zC >= zN;
  float s = upC ? ed : -ed; // signed distance into the upper piece
  float keepU = upC ? keepC : keepN;
  float keepL = upC ? keepN : keepC;
  float T = uTorn;
  float along = dot(qa, vec2(-dir.y, dir.x)); // position along the tear
  float bite = pow(vnoise(vec2(along * 5.0 + 13.7, 3.1)), 3.0);
  float rag = vnoise(vec2(along * 70.0, 9.4));
  float fw = max(T * 0.0095 * (0.10 + 2.8 * bite + 0.55 * rag), 1.5 * uPx);
  float ff = min(600.0, 0.5 / uPx);
  float jag = (vnoise(vec2(along * 140.0, 1.7)) - 0.5) * 0.35 * fw
            + (vnoise(vec2(along * ff, 5.3)) - 0.5) * (0.0010 * min(T, 1.5) + 1.2 * uPx);
  float eOut = -fw * (0.2 + 0.45 * vnoise(vec2(along * 11.0, 7.7))) + jag;
  float ePrint = eOut + fw;
  if (s >= ePrint){
    vec4 cu = upC ? colC : pieceAt(N, wUV, A);
    float ink = 1.0 - 0.16 * min(T, 1.0) * (1.0 - smoothstep(0.0, 0.15 * fw + 1.5 * uPx, s - ePrint));
    return vec4(cu.rgb * ink * cu.a, cu.a) * keepU;
  }
  vec4 cl = upC ? pieceAt(N, wUV, A) : colC; // the lower piece, under the white and the shadow
  float fq = min(330.0, 0.33 / uPx);
  vec3 paper = vec3(0.95, 0.935, 0.90) * (0.88 + 0.12 * vnoise(qa * 260.0));
  paper *= 1.0 - 0.06 * smoothstep(0.55, 0.95, vnoise(vec2(along * fq, s * 2.0 / fw)));
  vec4 under = vec4(cl.rgb * cl.a, cl.a) * keepL;
  if (s >= eOut){
    float t = (s - eOut) / fw;
    paper *= mix(1.0, 0.92, smoothstep(0.55, 1.0, t));
    float a = mix(0.55, 1.0, smoothstep(0.0, min(0.35 * fw, 0.0018) + uPx, s - eOut));
    return vec4(paper, 1.0) * a + under * (1.0 - a);
  }
  float past = eOut - s;
  vec2 away = upC ? dir : -dir; // from the upper piece toward the lower
  float lit = 0.3 + 0.7 * max(0.0, dot(away, vec2(0.55, -0.835))); // light from the top left
  float shw = (0.0025 + 0.009 * min(T, 1.5)) * lit;
  float sh = 0.5 * min(T, 1.0) * exp(-past / max(shw, uPx)) * (0.45 + 0.55 * lit);
  float fl = 0.06 * fw + 0.0009 * min(T, 1.5);
  float fib = smoothstep(0.86, 0.98, vnoise(vec2(along * fq, past / max(fl, uPx) * 0.7)))
            * exp(-past / max(fl, uPx)) * 0.7 * min(T * 1.5, 1.0);
  under = vec4(under.rgb * (1.0 - sh), under.a + (1.0 - under.a) * sh * 0.85);
  return vec4(paper, 1.0) * fib + under * (1.0 - fib);
}
#endif
void main(){
  vec4 orig = texture(uHost, vUV);
  vec4 col = orig;
  float keep = 1.0;
  vec2 wUV = uContour > 0.001 ? clamp(tearWarp(vUV), 0.0001, 0.9999) : vUV;
  vec2 A = vec2(uAspect, 1.0);             // UV → aspect-true (frame-height) units
  vec2 wq = wUV * A;                        // torn-paper noise domain
  // This pixel's piece C, the distance to its nearest border (warped domain, so
  // seams, shadow and fringe follow the torn contour; frame-height units, so
  // vertical and horizontal seams match) and the direction across it.
  int C = -1, N = -1;
  float ed = 1e9;
  vec2 dir = vec2(0.0);
  if (uShape == 1) {
    // ── MOSAIC : Voronoi cells. Each pixel belongs to its nearest seed, so the
    // pieces are irregular convex polygons instead of rectangles. The border
    // distance (2nd-nearest minus nearest) drives the same seams / torn paper
    // the rectangles use, so contour, torn and mask all behave identically.
    int mi = 0, mi2 = 0; float d1 = 1e9, d2 = 1e9;
    for (int i = 0; i < 64; i++){
      if (i >= uCount) break;
      float dd = distance(wq, uCell[i].xy * A);
      if (dd < d1) { d2 = d1; mi2 = mi; d1 = dd; mi = i; }
      else if (dd < d2) { d2 = dd; mi2 = i; }
    }
    C = mi;
    ed = 0.5 * (d2 - d1);
    if (uCount > 1 && mi2 != mi){
      N = mi2;
      vec2 dv = (uCell[mi2].xy - uCell[mi].xy) * A;
      dir = dv / max(length(dv), 1e-5);
    }
  } else {
    // ── CUT-UP : the rectangle holding this pixel.
    for (int i = 0; i < 64; i++){
      if (i >= uCount) break;
      vec4 d = uCell[i];
      if (wUV.x >= d.x && wUV.x < d.x + d.z && wUV.y >= d.y && wUV.y < d.y + d.w){ C = i; break; }
    }
    if (C >= 0){
      vec4 d = uCell[C];
      vec2 elo = (wUV - d.xy) * A;
      vec2 ehi = (d.xy + d.zw - wUV) * A;
      ed = elo.x; dir = vec2(-1.0, 0.0);
      if (ehi.x < ed){ ed = ehi.x; dir = vec2(1.0, 0.0); }
      if (elo.y < ed){ ed = elo.y; dir = vec2(0.0, -1.0); }
      if (ehi.y < ed){ ed = ehi.y; dir = vec2(0.0, 1.0); }
    }
  }
  if (C >= 0){
    // MASK : pieces drop out in their seeded order as the dial rises; a quick
    // per-piece fade instead of a hard pop so modulation sweeps read as pieces
    // peeling away. The survivor's rank of 2 can never be reached, so at full
    // mask exactly one shape remains - and each cut re-rolls which one.
    keep = keepOf(C);
    if (uShape == 1){
      vec2 slip = (vec2(hash(float(C), 1.0), hash(float(C), 2.0)) - 0.5) * uSlip * 0.3;
      vec2 local = rotL((wUV - uCell[C].xy) * A, uRot[C]) / A; // rigid quarter-turns
      col = texture(uHost, clamp(uMap[C].xy + local + slip, 0.0, 1.0));
    } else {
      vec4 d = uCell[C];
      vec2 luv = rot90((wUV - d.xy) / d.zw, uRot[C]);
      vec4 sr = uMap[C];
      vec2 slip = (vec2(hash(float(C), 1.0), hash(float(C), 2.0)) - 0.5) * uSlip;
      col = texture(uHost, sr.xy + (luv + slip) * sr.zw);
    }
#if TORN
    if (ed < uTorn * 0.035 + 0.02){
      if (uShape != 1){
        // The rectangle just across the nearest border (none past the frame :
        // a cut, not a tear). Only pixels near a border pay for this search.
        vec2 pr = wUV + dir * (ed + 0.5 * uPx) / A;
        if (pr.x > 0.0 && pr.x < 1.0 && pr.y > 0.0 && pr.y < 1.0){
          for (int i = 0; i < 64; i++){
            if (i >= uCount) break;
            vec4 c = uCell[i];
            if (i != C && pr.x >= c.x && pr.x < c.x + c.z && pr.y >= c.y && pr.y < c.y + c.w){ N = i; break; }
          }
        }
      }
      if (N >= 0){
        // Coverage moves into the mask (keep), so dry/wet treats a tear's
        // see-through edge exactly like a hole.
        vec4 t = tornPaper(C, N, col, ed, dir, wq, wUV, A);
        keep = t.a;
        col = vec4(t.a > 1e-5 ? t.rgb / t.a : vec3(0.0), 1.0);
      }
    }
#endif
    if (uGap > 0.001) col.rgb *= smoothstep(0.0, uGap * 0.02, ed); // dark seams
  }
  // Masked pieces leave TRANSPARENT holes (the collage's table shows through :
  // lower layers / background), whatever the dry/wet mix says. Straight alpha;
  // the crossfade passes write premultiplied × uFade so two layouts add up.
  vec4 c = mix(vec4(orig.rgb * orig.a, orig.a), vec4(clamp(col.rgb, 0.0, 1.0) * col.a, col.a), uMix);
  float a = clamp(c.a, 0.0, 1.0) * keep;
  vec3 rgb = c.a > 1e-5 ? clamp(c.rgb / c.a, 0.0, 1.0) : vec3(0.0);
  o = uPremul > 0.5 ? vec4(rgb * a, a) * uFade : vec4(rgb, a);
}`

// ── Chronoscan (per-pixel time displacement / slit-scan) ─────────────────
// A ring-atlas of the last N frames; a CONTROL field sets a per-pixel age, so each
// region of the picture reads from a different past frame : every region living
// in a different present. Control = the host's own luminance, a sidechain layer's
// luminance, or a moving gradient (the classic slit-scan sweep). The temporal twin
// of the convolution trio : it convolves TIME the way they convolve space.
// Age 0 is the LIVE host (full res, no latency); ages from 1 frame read the
// quarter-res ring, so only the past goes soft. The slit runs at a true screen
// angle and spans the whole frame at any angle; PING-PONG folds the sweep so it
// never wraps into a hard time seam.
const F_CHRONO = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uCtrl, uRing;
uniform vec2 uAtlasTexel;
uniform float uCols, uRows, uN, uWrite, uFilled;
uniform int uSrcMode, uInvert, uSmooth, uPingPong;
uniform float uReach, uAngle, uSweep, uCurve, uMix, uAspect;
${GLSL_PM}
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec4 tile(float idx, vec2 uv){
  float col = mod(idx, uCols);
  float row = floor(idx / uCols);
  vec2 base = vec2(col, row) / vec2(uCols, uRows);
  vec2 span = 1.0 / vec2(uCols, uRows);
  vec2 tuv = clamp(base + clamp(uv, 0.0, 1.0) * span, base + 0.5 * uAtlasTexel, base + span - 0.5 * uAtlasTexel);
  return pm(texture(uRing, tuv));
}
void main(){
  vec4 host = texture(uHost, vUV);
  if (uFilled < 1.0) { o = host; return; }
  float ctrl;
  if (uSrcMode == 0) ctrl = luma(host.rgb) * host.a;
  else if (uSrcMode == 1) { vec4 k = texture(uCtrl, vUV); ctrl = luma(k.rgb) * k.a; }
  else {
    vec2 d = vec2(cos(uAngle), sin(uAngle));
    float proj = dot((vUV - 0.5) * vec2(uAspect, 1.0), d) / (abs(d.x) * uAspect + abs(d.y)); // -0.5..0.5 corner to corner
    float x = proj + 0.5 + uSweep;
    ctrl = uPingPong == 1 ? 1.0 - abs(fract(x * 0.5) * 2.0 - 1.0) : fract(x);
  }
  ctrl = pow(clamp(ctrl, 0.0, 1.0), uCurve);
  if (uInvert == 1) ctrl = 1.0 - ctrl;
  float age = ctrl * uReach * max(uFilled - 1.0, 0.0);    // frames into the past (0 = now)
  float recent = mod(uWrite - 1.0 + uN, uN);              // newest stored frame (1 frame ago)
  vec4 col;
  if (uSmooth == 1) {
    if (age < 1.0) col = mix(pm(host), tile(recent, vUV), age);
    else {
      float idxF = mod(recent - (age - 1.0) + uN * 4.0, uN);
      float lo = floor(idxF);
      col = mix(tile(mod(lo, uN), vUV), tile(mod(lo + 1.0, uN), vUV), fract(idxF));
    }
  } else {
    float a = floor(age + 0.5);
    col = a < 0.5 ? pm(host) : tile(mod(recent - (a - 1.0) + uN * 4.0, uN), vUV);
  }
  o = mixStraight(host, unpm(col), uMix);
}`

// ── Sediment : long-term image memory ────────────────────────────────────
// The instrument is named for image persistence but only remembered ~16 frames.
// This keeps a decaying long-exposure ACCUMULATOR (peaks that slowly sink over
// seconds→minutes) plus a sparse KEYFRAME ring (a snapshot every few seconds, so
// minutes of the past are recallable). `age` sweeps from the recent accumulator to
// the oldest keyframe; `resurface` bleeds that memory back under the live image,
// `stir` drifts it so it sediments rather than sitting as a frozen loop.
// The accumulator holds PREMULTIPLIED color (a transparent layer deposits nothing
// where it is empty). Its decay factor is stepped from the CPU in chunks : a
// per-frame factor this close to 1 is below half-float precision, and the memory
// froze into a permanent peak-hold.
const F_SED_ACC = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev; uniform float uDecay, uDeposit;
void main(){
  vec4 h = texture(uHost, vUV);
  vec4 prev = texture(uPrev, vUV);
  o = max(prev * uDecay, vec4(h.rgb * h.a, h.a) * uDeposit);   // decaying peak memory
}`

// ── Parallax : real 2.5D from the shared depth map (native, so the passthrough
// and the two image inputs are exact : an ISF FX with a 2nd image input tangled
// with the rack's inputImage binding). host + depth are bound explicitly here.
// Depth 1 = near, 0 = far. The push and the blur radius are aspect-true (a
// vertical push moves as many pixels as a horizontal one); reads past the frame
// mirror. BLUR shape : the 4-tap cross (a ghosted four-way double image at wide
// radii, the original look) or a 12-tap disc (a smooth lens blur). ──
const F_PARALLAX = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uDepth;
uniform float uAmount, uAngle, uDof, uFocus, uFog, uWet, uAspect;
uniform vec2 uSwayV;
uniform int uInvert, uHasDepth, uDofShape;
${GLSL_PM}
vec2 mirror(vec2 u){ return 1.0 - abs(1.0 - mod(u, 2.0)); }
void main(){
  vec4 src = texture(uHost, vUV);
  if (uHasDepth == 0 || uWet < 0.001) { o = src; return; } // exact passthrough
  float d = texture(uDepth, vUV).r;
  if (uInvert == 1) d = 1.0 - d;
  float dc = d - 0.5;
  vec2 dir = vec2(cos(uAngle), sin(uAngle));
  vec2 suv = vUV + (dir * uAmount * vec2(1.0, uAspect) + uSwayV) * dc * 0.15;
  float r = uDof * 0.03 * abs(d - uFocus);
  vec2 rr = vec2(r, r * uAspect);
  vec4 col;
  if (uDofShape == 0) {
    vec2 a0 = mirror(suv), a1 = mirror(suv + vec2(rr.x, 0.0)), a2 = mirror(suv - vec2(rr.x, 0.0));
    vec2 a3 = mirror(suv + vec2(0.0, rr.y)), a4 = mirror(suv - vec2(0.0, rr.y));
    col = pm(texture(uHost, a0)) * 0.4
      + (pm(texture(uHost, a1)) + pm(texture(uHost, a2)) + pm(texture(uHost, a3)) + pm(texture(uHost, a4))) * 0.15;
  } else {
    col = vec4(0.0);
    for (int i = 0; i < 12; i++) {                 // Vogel spiral
      float fi = float(i) + 0.5;
      float th = fi * 2.39996323;
      vec2 u = mirror(suv + vec2(cos(th), sin(th)) * sqrt(fi / 12.0) * rr);
      col += pm(texture(uHost, u));
    }
    col /= 12.0;
  }
  // Aerial recession : the FAR planes (below the focus depth) sink toward black.
  col.rgb *= 1.0 - uFog * (1.0 - smoothstep(0.0, max(uFocus, 0.001), d));
  o = unpm(mix(pm(src), col, uWet));
}`

const F_SED_OUT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uAcc, uRing;
uniform vec2 uAtlasTexel;
uniform float uCols, uRows, uN, uWrite, uFilled;
uniform float uAge, uResurface, uStir, uMix, uTime;
uniform int uBlend;
${GLSL_PM}
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec4 tile(float idx, vec2 uv){
  float col = mod(idx, uCols); float row = floor(idx / uCols);
  vec2 base = vec2(col, row) / vec2(uCols, uRows); vec2 span = 1.0 / vec2(uCols, uRows);
  vec2 tuv = clamp(base + clamp(uv, 0.0, 1.0) * span, base + 0.5 * uAtlasTexel, base + span - 0.5 * uAtlasTexel);
  return pm(texture(uRing, tuv));
}
void main(){
  vec4 host = texture(uHost, vUV);
  vec4 hP = pm(host);
  vec2 st = vUV + vec2(sin(vUV.y * 6.28 + uTime * 0.11), cos(vUV.x * 6.28 - uTime * 0.09)) * uStir * 0.03;
  vec4 acc = texture(uAcc, st);                                  // premultiplied
  // Keyframe at a fractional age : blend the two nearest snapshots (a fractional
  // atlas index straddled two tiles and split the picture with a seam).
  float kf = mod(uWrite - 1.0 - uAge * max(uFilled - 1.0, 0.0) + uN * 4.0, uN);
  float lo = floor(kf);
  vec4 key = uFilled > 1.0 ? mix(tile(lo, st), tile(mod(lo + 1.0, uN), st), kf - lo) : acc;
  vec4 mem = mix(acc, key, smoothstep(0.0, 1.0, uAge));
  vec4 m = mem * uResurface;
  vec4 res;
  if (uBlend == 0) res = hP + m - hP * m;                        // screen
  else if (uBlend == 1) res = max(hP, m);                         // lighten
  else if (uBlend == 2) {
    // under : the memory lies BENEATH the live picture, showing only where it is
    // dark or transparent (bright live areas cover it).
    float cover = smoothstep(0.1, 0.85, luma(host.rgb)) * host.a;
    res = hP + m * (1.0 - cover);
  }
  else res = vec4(mix(hP.rgb, abs(hP.rgb - mem.rgb), uResurface), max(hP.a, mem.a * uResurface)); // difference
  res = clamp(res, 0.0, 1.0);
  vec4 c = mix(hP, res, uMix);
  float a = max(host.a, c.a);
  o = vec4(c.a > 1e-5 ? clamp(c.rgb / c.a, 0.0, 1.0) : host.rgb, a);
}`

// ── Eternalism / Phase-Drift (the afterimage family : persistence of vision) ──
// A frame-history ring, read as two temporal taps. HOLD : two frames exactly
// `gap` apart, alternated across a BLACK shutter interval at `rate` : an unfrozen
// slice of time, a held micro-motion going nowhere (FREEZE stops the ring, so the
// pair holds for good). DRIFT (phase-drift twins) : two delayed copies whose delay
// difference slowly beats in and out of lock (coherent → double-exposed →
// coherent), the second copy a touch larger with an amber cast; at lock the twin
// is exactly superimposed. A fractional delay blends the two nearest frames. The
// app's name, made a signal path. The shutter blacks an opaque layer and empties
// a transparent one.
const F_ETERNAL = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uRing;
uniform vec2 uAtlasTexel;
uniform float uCols, uRows, uN, uWrite, uFilled;
uniform int uMode;
uniform float uGap, uOffB, uPhase, uInterval, uTint, uMix, uTwinScale;
${GLSL_PM}
vec4 tile(float idx, vec2 uv){
  float col = mod(idx, uCols); float row = floor(idx / uCols);
  vec2 base = vec2(col, row) / vec2(uCols, uRows); vec2 span = 1.0 / vec2(uCols, uRows);
  vec2 tuv = clamp(base + clamp(uv, 0.0, 1.0) * span, base + 0.5 * uAtlasTexel, base + span - 0.5 * uAtlasTexel);
  return pm(texture(uRing, tuv));
}
vec4 tileLerp(float idx, vec2 uv){
  float lo = floor(idx);
  return mix(tile(mod(lo, uN), uv), tile(mod(lo + 1.0, uN), uv), idx - lo);
}
void main(){
  vec4 host = texture(uHost, vUV);
  if (uFilled < 2.0) { o = host; return; }
  float recent = mod(uWrite - 1.0 + uN, uN);
  vec4 col;
  if (uMode == 0) {
    // HOLD : the newest frame and the one GAP before it, alternated across a
    // black shutter (uPhase 0..1).
    vec4 A = tile(recent, vUV);
    vec4 B = tile(mod(recent - uGap + uN * 4.0, uN), vUV);
    float g = max(uInterval * 0.5, 1e-3); // interval 0 would make smoothstep edges equal (UB)
    float winA = smoothstep(0.0, 0.06, uPhase) * (1.0 - smoothstep(0.5 - g, 0.5, uPhase));
    float winB = smoothstep(0.5, 0.56, uPhase) * (1.0 - smoothstep(1.0 - g, 1.0, uPhase));
    col = A * winA + B * winB;
  } else {
    // DRIFT : two delayed copies (offsets uGap / uOffB from JS); the second is
    // slightly larger with an amber cast. When the offsets coincide → locked.
    vec4 A = tileLerp(mod(recent - uGap + uN * 4.0, uN), vUV);
    vec2 buv = (vUV - 0.5) * uTwinScale + 0.5;
    vec4 B = tileLerp(mod(recent - uOffB + uN * 4.0, uN), buv);
    B.rgb = mix(B.rgb, B.rgb * vec3(1.0, 0.82, 0.5), uTint);
    col = (A + B) * 0.5;
  }
  vec4 c = mix(pm(host), col, uMix);
  float a = max(c.a, host.a); // the shutter blacks an opaque layer, empties a transparent one
  o = vec4(a > 1e-5 ? clamp(c.rgb / a, 0.0, 1.0) : vec3(0.0), a);
}`

// ── Afterimage (Goethe's complement : a removed bright form leaves a dark/negative
// ghost). A decaying per-channel brightness high-water of recent frames; where a
// bright form has DEPARTED a spot, the ghost appears at once and fades : as a dark
// subtraction, and/or its complementary color (a red form leaves a cyan trace).
// acc.a is the eye's ADAPTATION : it charges toward the light at the dwell rate
// (instantly at dwell 0) and discharges with the ghost, so with DWELL up a flash
// leaves a faint ghost and a long stare the full one. Light is measured
// premultiplied (a transparent spot is no light). Two passes : acc, out. ──
const F_AFTER_ACC = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev; uniform float uDecay, uCharge;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec4 h = texture(uHost, vUV);
  vec3 host = h.rgb * h.a;
  vec4 prev = texture(uPrev, vUV);
  float L = luma(host);
  float ad = L > prev.a ? mix(prev.a, L, uCharge) : max(prev.a * uDecay, L);
  o = vec4(max(prev.rgb * uDecay, host), ad);   // decaying brightness high-water + adaptation
}`

const F_AFTER_OUT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uAcc; uniform float uAmount, uChroma, uMix, uDwell;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec4 h = texture(uHost, vUV);
  vec3 host = h.a > 0.0 ? h.rgb : vec3(0.0);
  vec3 hp = host * h.a;                             // premultiplied light
  vec4 acc = texture(uAcc, vUV);
  float La = luma(acc.rgb);
  float leave = max(0.0, La - luma(hp));            // brightness that has left this spot
  if (uDwell > 0.0) leave *= clamp(acc.a / max(La, 1e-3), 0.0, 1.0); // a flash leaves less
  vec3 comp = 1.0 - acc.rgb;                        // complementary color of what was here
  vec3 dark = hp - vec3(leave) * uAmount;                       // Goethe dark afterimage
  vec3 chroma = hp + (comp - 0.5) * 2.0 * leave * uAmount;      // complementary-color ghost
  // the ghost also lands where this layer is transparent (it darkens what is
  // below); opaque pixels are exactly the classic subtraction
  float a = max(h.a, clamp(leave * uAmount * 2.0, 0.0, 1.0));
  vec3 col = mix(dark, chroma, uChroma) / max(a, 1e-4);
  o = vec4(clamp(mix(host, col, uMix), 0.0, 1.0), mix(h.a, a, uMix));
}`

// ── Melt : seam-local dissolve that CREEPS. The host's own luma edges give a SEAM
// (a fine band at a 1080p-pixel scale) and a MELT ZONE (the same edges seen at the
// REACH scale, which also gives the push its direction away from the seam). Each
// frame the node's OWN previous output is fetched from up the gradient (CREEP > 0 :
// the bright side bleeds out; < 0 : the dark side eats in) and dissolved back in :
// at the seam by MELT, and across the zone wherever that pulled history already
// departs from the live picture (held for a persistence set by MELT), so the melted
// front walks outward at the creep speed until the zone ends. Unlike Datamosh
// (motion-driven, full-frame) this is EDGE-driven and self-feeding : it keeps going
// on a still picture. Premultiplied, so melted forms spill into transparency.
// One ping-pong buffer holds the last output. ──
const F_MELT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev; uniform vec2 uRes;
uniform float uAmount, uWidth, uGate, uStep, uReach, uPush, uHold;
float lum(vec4 c){ return dot(c.rgb * c.a, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec2 px = 1.0 / uRes;
  vec4 h = texture(uHost, vUV);
  vec2 s = px * uStep;                                  // the seam : a 1080p-pixel gradient
  vec2 dx = vec2(s.x, 0.0), dy = vec2(0.0, s.y);
  vec2 grad = vec2(lum(texture(uHost, vUV + dx)) - lum(texture(uHost, vUV - dx)),
                   lum(texture(uHost, vUV + dy)) - lum(texture(uHost, vUV - dy)));
  float glen = length(grad);
  float lo = 0.01 + uGate * 0.30;                       // GATE : only the strong edges
  float band = smoothstep(lo, lo + 0.02 + uWidth * 0.50, glen);
  vec2 rx = vec2(px.x * uReach, 0.0), ry = vec2(0.0, px.y * uReach);
  vec2 gz = vec2(lum(texture(uHost, vUV + rx)) - lum(texture(uHost, vUV - rx)),
                 lum(texture(uHost, vUV + ry)) - lum(texture(uHost, vUV - ry)));
  float gl = length(gz);
  vec2 n = gl > 1e-4 ? gz / gl : vec2(0.0);             // up the gradient (toward light)
  float zone = smoothstep(lo * 0.5, lo * 0.5 + 0.06, gl);
  // creep : the previous output pulled from up (or down) the gradient
  vec2 q = vUV + n * uPush * px;
  bool inside = q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0;
  vec4 pv = inside ? texture(uPrev, q) : h;            // no border smear
  vec4 hp = vec4(h.rgb * h.a, h.a), pp = vec4(pv.rgb * pv.a, pv.a);
  float melted = clamp(length(pp - hp) * 4.0, 0.0, 1.0);
  float m = min(max(band * uAmount, zone * melted * uHold), 0.995);
  vec4 c = mix(hp, pp, m);
  o = vec4(c.a > 1e-4 ? c.rgb / c.a : vec3(0.0), c.a);
}`

// Dry/wet of two straight-alpha pictures, mixed premultiplied (Melt's MIX).
const F_MIX_PM = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uA, uB; uniform float uMix;
void main(){
  vec4 a = texture(uA, vUV), b = texture(uB, vUV);
  vec4 c = mix(vec4(a.rgb * a.a, a.a), vec4(b.rgb * b.a, b.a), uMix);
  o = vec4(c.a > 1e-4 ? c.rgb / c.a : vec3(0.0), c.a);
}`

// A copy that keeps alpha (F_COPY writes a = 1 : right for its rings, wrong for
// the second-half nodes' seeds, grabs and rings, which carry the layer's alpha).
const F_COPY_A = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex;
void main(){ o = texture(uTex, vUV); }`

// ── Pulfrich : real monocular 3D from a temporal eye-delay ────────────────
// The Pulfrich effect : one eye seeing a slightly DELAYED image (a dark filter
// slows its neural response) turns lateral motion into stereo depth. Here the
// delay is read per-pixel from a frame-history ring, keyed by the shared DEPTH
// map (or luminance), so near/bright planes lag more (depth 1 = near). A ZERO
// plane splits the key : planes above it lag in one eye, planes below it in the
// other, so they land in front of and behind the screen. A matte companion to the
// anaglyph stage. The disparity is TEMPORAL, not spatial : each delayed eye is the
// live frame plus only the CHANGE the ring saw over its delay, so a still picture
// has no fringes at all (DESAT alone tints it) and depth blooms on lateral motion.
// The ring is written on a 60 Hz clock, so a delay "frame" is 1/60 s at any
// display rate. Reuses the Chronoscan/Eternalism ring-atlas. Layer / source / master.
const F_PULFRICH = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uRing, uDepth;
uniform vec2 uAtlasTexel;
uniform float uCols, uRows, uN, uRecent, uFilled, uAspect;
uniform int uMode, uSrc, uSwap, uHasDepth;
uniform float uDelay, uCurve, uSep, uDesat, uMix, uZero;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec4 tile(float idx, vec2 uv){
  float col = mod(idx, uCols); float row = floor(idx / uCols);
  vec2 base = vec2(col, row) / vec2(uCols, uRows); vec2 span = 1.0 / vec2(uCols, uRows);
  vec2 tuv = clamp(base + clamp(uv, 0.0, 1.0) * span, base + 0.5 * uAtlasTexel, base + span - 0.5 * uAtlasTexel);
  return texture(uRing, tuv);
}
// the ring frame BACK frames before the most recent write (fractional : a blend
// of two neighboring tiles, never a seam)
vec4 tap(float back){
  float idxF = mod(uRecent - back + uN * 4.0, uN);
  float lo = floor(idxF);
  return mix(tile(mod(lo, uN), vUV), tile(mod(lo + 1.0, uN), vUV), fract(idxF));
}
void main(){
  vec4 h = texture(uHost, vUV);
  if (uFilled < 2.0) { o = h; return; }
  float maxBack = uFilled - 1.0;
  // luminance key : the brighter of now and one full delay ago, so a bright form
  // keys its whole path (both of its eye fringes), not just where it is now
  vec4 far = tap(min(uDelay, maxBack));
  float key = (uSrc == 1 && uHasDepth == 1) ? texture(uDepth, vUV).r
            : max(luma(h.rgb * h.a), luma(far.rgb * far.a));
  key = pow(clamp(key, 0.0, 1.0), uCurve);
  if (uSwap == 1) key = 1.0 - key;
  float bR = min(max(key - uZero, 0.0) / max(1.0 - uZero, 1e-3) * uDelay, maxBack);
  float bL = min(max(uZero - key, 0.0) / max(uZero, 1e-3) * uDelay, maxBack);
  vec4 rec = tile(uRecent, vUV);
  vec4 dR = h + (tap(bR) - rec);                 // live + the change over the delay
  vec4 dL = h + (tap(bL) - rec);
  // Assign eyes : swap chooses which eye carries the lag (i.e. its motion direction).
  vec4 L = (uSwap == 1) ? dR : dL;
  vec4 R = (uSwap == 1) ? dL : dR;
  vec3 res;
  float a = max(h.a, clamp(max(L.a, R.a), 0.0, 1.0)); // moved content over transparency
  if (uMode == 0) {
    // Anaglyph red/cyan. SEPARATION amplifies each eye's disparity from the live frame.
    float g = 1.0 + uSep * 2.0;
    vec3 La = h.rgb + (L.rgb - h.rgb) * g;
    vec3 Ra = h.rgb + (R.rgb - h.rgb) * g;
    vec3 Ld = mix(La, vec3(luma(La)), uDesat);   // desat curbs retinal rivalry
    vec3 Rd = mix(Ra, vec3(luma(Ra)), uDesat);
    res = vec3(Ld.r, Rd.g, Rd.b);
  } else {
    // Glasses-free : a horizontal parallax slide gated by motion, so stills stay clean.
    float mo = clamp(max(length(dR.rgb - h.rgb), length(dL.rgb - h.rgb)) * 6.0, 0.0, 1.0);
    vec2 suv = vUV + vec2((key - 0.5) * uSep * 0.2133 * mo / uAspect, 0.0);
    vec4 s = texture(uHost, suv);
    res = s.rgb; a = max(h.a, s.a);
  }
  o = vec4(clamp(mix(h.rgb, res, uMix), 0.0, 1.0), mix(h.a, a, uMix));
}`

// ── Corrode / Weathered : durational corrosion over a whole set ───────────
// A time-integrated corrosion mask that only ever GROWS (buried/weathered, the
// process/entropy family). A static blotch field seeds new corrosion as the
// integrated `bury` LEVEL rises (BURY sets the time to full : an hour down to a
// minute), and the mask creeps outward in whole-texel steps taken on the clock
// (CREEP sets how far the fronts travel over that time), so the picture is eaten
// away over minutes, never recovering until you EXHUME (reset). The present pass
// stains/darkens the corroded zones (or eats them to transparency) and cracks them
// with reticulation (émulsion crackle). Layer / source / master.
const F_CORRODE_GROW = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform float uLevel, uStep, uSeed, uAspect;
float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h(i), b = h(i + vec2(1, 0)), c = h(i + vec2(0, 1)), d = h(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  float nb = texture(uPrev, vUV).r;
  // Creep : one texel of growth per step (1 = the 4 neighbors, 2 = all 8 :
  // alternated, the fronts grow as octagons). Exact texel centers, no dot grid.
  if (uStep > 0.5) {
    nb = max(nb, max(texture(uPrev, vUV + vec2(uTexel.x, 0.0)).r, texture(uPrev, vUV - vec2(uTexel.x, 0.0)).r));
    nb = max(nb, max(texture(uPrev, vUV + vec2(0.0, uTexel.y)).r, texture(uPrev, vUV - vec2(0.0, uTexel.y)).r));
    if (uStep > 1.5) {
      nb = max(nb, max(texture(uPrev, vUV + uTexel).r, texture(uPrev, vUV - uTexel).r));
      vec2 t2 = vec2(uTexel.x, -uTexel.y);
      nb = max(nb, max(texture(uPrev, vUV + t2).r, texture(uPrev, vUV - t2).r));
    }
  }
  // New corrosion : a static blotch field (round, aspect-true) whose threshold
  // falls as LEVEL rises; stretched over 0..1 so the first blotches come early.
  vec2 p = vec2(vUV.x * uAspect, vUV.y);
  float field = fbm(p * 6.0 + uSeed) * 0.6 + fbm(p * 17.0 + uSeed * 1.7) * 0.4;
  field = clamp((field - 0.25) / 0.45, 0.0, 1.0);
  float seed = smoothstep(1.0 - uLevel - 0.06, 1.0 - uLevel + 0.02, field);
  o = vec4(clamp(max(nb, seed), 0.0, 1.0), 0.0, 0.0, 1.0); // monotonic : only grows
}`

const F_CORRODE_OUT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uCorr;
uniform float uEat, uCrackle, uTone, uMix, uSeed, uAspect; uniform int uEatTo;
float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h(i), b = h(i + vec2(1, 0)), c = h(i + vec2(0, 1)), d = h(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main(){
  vec4 hh = texture(uHost, vUV);
  vec3 host = hh.rgb;
  float c = texture(uCorr, vUV).r;
  // Reticulation : thin dark cracks (a difference-of-noise ridge), only in corroded zones.
  float cr = 0.0;
  if (uCrackle > 0.0) {
    vec2 p = vec2(vUV.x * uAspect, vUV.y) * 68.0 + uSeed;
    float n = vnoise(p) - vnoise(p + 3.7);
    cr = (1.0 - smoothstep(0.0, 0.16, abs(n))) * smoothstep(0.15, 0.6, c) * uCrackle;
  }
  float k = clamp(c * uEat, 0.0, 1.0);
  vec3 eaten; float a = hh.a;
  if (uEatTo == 1) {
    // eaten to TRANSPARENCY : the zones dissolve into the layers below, the cracks
    // stay as dark lines over the hole
    eaten = mix(host, vec3(0.0), cr * 0.85);
    a = max(hh.a * (1.0 - k), hh.a * cr * 0.85);
  } else {
    vec3 stain = mix(vec3(0.02, 0.02, 0.025), vec3(0.20, 0.13, 0.07), uTone); // leader-dark ↔ sepia
    eaten = mix(host, stain, k) * (1.0 - cr * 0.85);
  }
  o = vec4(clamp(mix(host, eaten, uMix), 0.0, 1.0), mix(hh.a, a, uMix));
}`

// ── Decimate / Time-Lapse : sample-and-hold at a chosen rate ──────────────
// Holds a captured frame and only refreshes it on a clock (or a trigger), so the
// picture STEPS through time : the time-lapse / stutter register the smooth engine
// smooths away. Between samples it crossfades the last two grabs by `smooth` (0 =
// hard snap, 1 = a continuous tween across the whole interval → slow-motion). The
// signature use is two rates of the SAME source across A/B (control vs lapse).
// Grabs keep alpha; the crossfade and the mix run premultiplied.
const F_DECIMATE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev, uCur;
uniform float uF, uMix;
vec4 pm(vec4 c){ return vec4(c.rgb * c.a, c.a); }
void main(){
  vec4 held = mix(pm(texture(uPrev, vUV)), pm(texture(uCur, vUV)), uF);
  vec4 c = mix(pm(texture(uHost, vUV)), held, uMix);
  o = vec4(c.a > 1e-4 ? c.rgb / c.a : vec3(0.0), c.a);
}`

// ── Mosaïque : spatial concatenative synthesis (CIS + Image-Melding wins) ──
// The sidechain frame IS the live corpus (a grid of tiles); the host is the
// target. Per-patch nearest-tile match on color mean/variance + a directional
// gradient, with orientation search, temporal stickiness (its own ping-pong,
// cleared on Flush by node re-creation), a gain/bias re-tint and a seam melt.
// Both grids are split to the frame's aspect (cols × rows, square cells), so a
// rotated tile stays undistorted and Voronoi cells are not stretched sideways.

// Reduce one tile to (meanRGB, luma variance). Rendered at grid resolution.
const F_MOSAIC_FEAT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uGrid; uniform int uTaps;
void main(){
  vec2 base = floor(vUV*uGrid)/uGrid;
  vec2 inv = 1.0/uGrid; int K = uTaps;
  vec3 sum = vec3(0.0); float sumL2 = 0.0; float n = 0.0;
  for(int y=0;y<16;y++){ if(y>=K) break;
    for(int x=0;x<16;x++){ if(x>=K) break;
      vec2 uv = base + (vec2(float(x),float(y))+0.5)/float(K)*inv;
      vec3 c = texture(uSrc, uv).rgb;
      float l = dot(c, vec3(0.299,0.587,0.114));
      sum += c; sumL2 += l*l; n += 1.0;
    }
  }
  vec3 mean = sum/max(n,1.0);
  float meanL = dot(mean, vec3(0.299,0.587,0.114));
  o = vec4(mean, max(0.0, sumL2/max(n,1.0) - meanL*meanL));
}`

// Mean SIGNED luma gradient of a tile (a directional signature for orient search).
// uPix is a fixed UV step (1 px at 1080p), so the structure term reads the same at
// every render size.
const F_MOSAIC_GRAD = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uGrid; uniform int uTaps; uniform vec2 uPix;
float lum(vec2 uv){ return dot(texture(uSrc,uv).rgb, vec3(0.299,0.587,0.114)); }
void main(){
  vec2 base = floor(vUV*uGrid)/uGrid;
  vec2 inv = 1.0/uGrid; int K = uTaps;
  vec2 g = vec2(0.0); float n = 0.0;
  for(int y=0;y<16;y++){ if(y>=K) break;
    for(int x=0;x<16;x++){ if(x>=K) break;
      vec2 uv = base + (vec2(float(x),float(y))+0.5)/float(K)*inv;
      g += vec2(lum(uv+vec2(uPix.x,0.0))-lum(uv-vec2(uPix.x,0.0)),
                lum(uv+vec2(0.0,uPix.y))-lum(uv-vec2(0.0,uPix.y)));
      n += 1.0;
    }
  }
  o = vec4(g/max(n,1.0), 0.0, 0.0);
}`

// Per target patch : nearest corpus tile (color + structure), best orientation,
// with stickiness + jitter. Writes (cx, cy, orient, valid) to the index texture.
// The 8 orientations are exact quarter-turn / flip matrices (no trig in the loop).
const F_MOSAIC_MATCH = `#version 300 es
precision highp float; precision highp int; in vec2 vUV; out vec4 o;
uniform sampler2D uTMean, uTGrad, uCMean, uCGrad, uPrev;
uniform vec2 uG, uC;
uniform float uStructure, uStick, uJitter, uWVar, uWGrad;
uniform int uCount, uMode;
${GLSL_HASH}
mat2 orientMat(int oi){
  int r = oi & 3;
  mat2 R = r == 0 ? mat2(1.0, 0.0, 0.0, 1.0) : r == 1 ? mat2(0.0, -1.0, 1.0, 0.0) : r == 2 ? mat2(-1.0, 0.0, 0.0, -1.0) : mat2(0.0, 1.0, -1.0, 0.0);
  return ((oi >> 2) & 1) == 1 ? R * mat2(-1.0, 0.0, 0.0, 1.0) : R;
}
float dist(vec3 tM, float tV, vec2 tG, vec3 cM, float cV, vec2 cG, int oi){
  vec3 dC = tM - cM;
  float colorD = dot(dC,dC) + uWVar*(tV-cV)*(tV-cV);
  vec2 gd = tG - orientMat(oi)*cG;
  float gradD = dot(gd,gd); if(!(gradD < 1e18)) gradD = 0.0;
  // Color ALWAYS carries part of the weight (never fully replaced), so a flat /
  // degenerate gradient can't collapse the match onto one tile.
  return mix(colorD, uWGrad*gradD, uStructure*0.85);
}
void main(){
  vec2 cellId = floor(vUV*uG); vec2 tuv = (cellId+0.5)/uG;
  vec4 tm = texture(uTMean, tuv); vec3 tMean = tm.rgb; float tVar = tm.a;
  vec2 tGrad = texture(uTGrad, tuv).rg;
  int norient = (uMode==0)?1:(uMode==1)?2:8;
  int Ci = int(uC.x + 0.5);
  float best = 1e20; float bcx = 0.0, bcy = 0.0; int bo = 0;
  for(int i=0;i<1024;i++){
    if(i>=uCount) break;
    int cx = i % Ci; int cy = i / Ci;
    vec2 cuv = (vec2(float(cx),float(cy))+0.5)/uC;
    vec4 cm = texture(uCMean, cuv); vec3 cMean = cm.rgb; float cVar = cm.a;
    vec2 cGrad = texture(uCGrad, cuv).rg;
    float gBest = 1e20; int goBest = 0;
    for(int k=0;k<8;k++){
      if(k>=norient) break;
      int oi = (uMode==1)? k*4 : k;
      vec2 gd = tGrad - orientMat(oi)*cGrad; float gg = dot(gd,gd);
      if(gg < gBest){ gBest = gg; goBest = oi; }
    }
    if(!(gBest < 1e18)) gBest = 0.0; // NaN / unset gradient must not swamp color
    vec3 dC = tMean - cMean;
    float colorD = dot(dC,dC) + uWVar*(tVar-cVar)*(tVar-cVar);
    float total = mix(colorD, uWGrad*gBest, uStructure*0.85);
    total += uJitter*0.25*hash13(vec3(cellId, float(i)));
    if(total < best){ best = total; bcx = float(cx); bcy = float(cy); bo = goBest; }
  }
  vec4 prev = texture(uPrev, tuv);
  int pcx = int(prev.r+0.5), pcy = int(prev.g+0.5), po = int(prev.b+0.5);
  // A held tile must still exist in the corpus (it can shrink) and use an
  // orientation the current mode allows (off : upright, flip : upright or flipped).
  bool heldOk = pcx < int(uC.x + 0.5) && pcy < int(uC.y + 0.5);
  if (uMode == 0) po = 0; else if (uMode == 1) po = po & 4;
  if(prev.a > 0.5 && uStick > 0.001 && heldOk){
    vec2 cuv = (vec2(float(pcx),float(pcy))+0.5)/uC;
    vec4 cm = texture(uCMean, cuv); vec2 cGrad = texture(uCGrad, cuv).rg;
    float heldD = dist(tMean, tVar, tGrad, cm.rgb, cm.a, cGrad, po);
    if(best > heldD - uStick*0.25){ bcx = prev.r; bcy = prev.g; bo = po; }
  }
  o = vec4(bcx, bcy, float(bo), 1.0);
}`

// Full-res tiling : sample the matched corpus tile (oriented), re-tint toward the
// target patch mean (gain/bias), and melt seams by blending toward neighbors.
// Coverage is the host's : the mosaic re-paints the layer, never its alpha.
// uTime drives the seed wobble (wrapped at 20π, a whole period of both sines);
// uTimeN drives the warp noise, which tiles every 256 units and wraps there.
const F_MOSAIC_RENDER = `#version 300 es
precision highp float; precision highp int; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uSide, uIndex, uCMean, uTMean;
uniform vec2 uG, uC;
uniform float uCorrect, uMelt, uGain, uMix, uIrregular, uTime, uTimeN;
uniform int uShape; // 0 grid · 1 brick · 2 voronoi · 3 warp
${GLSL_HASH}
mat2 orientMat(int oi){
  int r = oi & 3;
  mat2 R = r == 0 ? mat2(1.0, 0.0, 0.0, 1.0) : r == 1 ? mat2(0.0, -1.0, 1.0, 0.0) : r == 2 ? mat2(-1.0, 0.0, 0.0, -1.0) : mat2(0.0, 1.0, -1.0, 0.0);
  return ((oi >> 2) & 1) == 1 ? R * mat2(-1.0, 0.0, 0.0, 1.0) : R;
}
float h21(vec2 p){ return hash12(mod(p, 256.0)); }
vec2 h22(vec2 p){ vec2 q = mod(p, 256.0); return vec2(hash12(q), hash12(q + 311.0)); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
vec3 tileAt(vec2 cell, vec2 local){
  cell = clamp(cell, vec2(0.0), uG-1.0);
  vec2 ic = (cell+0.5)/uG;
  vec4 idx = texture(uIndex, ic);
  vec2 cc = idx.rg; int oi = int(idx.b+0.5);
  vec2 ol = orientMat(oi)*(local-0.5)+0.5; ol = clamp(ol, 0.0, 1.0);
  vec3 col = texture(uSide, (cc+ol)/uC).rgb;
  vec3 cM = texture(uCMean, (cc+0.5)/uC).rgb;
  vec3 tM = texture(uTMean, ic).rgb;
  return col + (tM - cM)*uCorrect;
}
void main(){
  vec2 pg = vUV*uG;
  vec3 mosaic;
  if(uShape==2){
    // Voronoi : jittered seeds → organic polygons of varying size. Drift wobbles
    // the seeds over time; melt blends across the nearest edge.
    vec2 base = floor(pg);
    float d1=1e9, d2=1e9; vec2 c1=base, c2=base;
    for(int y=-1;y<=1;y++){ for(int x=-1;x<=1;x++){
      vec2 nc = base + vec2(float(x),float(y));
      float a = h21(nc)*6.2831853;
      vec2 seed = nc + 0.5 + uIrregular*0.5*((h22(nc)-0.5)*2.0 + 0.35*vec2(sin(uTime+a), cos(uTime*1.1+a)));
      float d = distance(pg, seed);
      if(d<d1){ d2=d1; c2=c1; d1=d; c1=nc; } else if(d<d2){ d2=d; c2=nc; }
    }}
    vec3 t1 = tileAt(c1, clamp(pg-c1, 0.0, 1.0));
    if(uMelt > 0.001){
      vec3 t2 = tileAt(c2, clamp(pg-c2, 0.0, 1.0));
      float bw = clamp((d2-d1)/(uMelt*0.7+0.001), 0.0, 1.0); // 0 at edge → 1 interior
      mosaic = mix(t2, t1, 0.5+0.5*bw);
    } else mosaic = t1;
  } else {
    // grid / brick / warp : a (possibly transformed) regular grid + seam melt.
    vec2 pp = pg;
    if(uShape==1){ float row=floor(pp.y); pp.x += uIrregular*(0.5*mod(row,2.0) + 0.35*(h21(vec2(row,7.0))-0.5)); }
    else if(uShape==3){ vec2 wv=vec2(vnoise(vUV*3.0+uTimeN), vnoise(vUV*3.0+5.2-uTimeN))*2.0-1.0; pp = pg + uIrregular*1.3*wv; }
    vec2 cell = floor(pp); vec2 local = pp - cell;
    vec3 c = tileAt(cell, local);
    if (uMelt > 0.001) {
      vec2 edge = abs(local-0.5)*2.0;
      vec2 w = smoothstep(vec2(1.0-uMelt), vec2(1.0), edge)*0.5;
      vec2 dir = step(0.5, local)*2.0 - 1.0;
      vec3 cx  = tileAt(cell+vec2(dir.x,0.0), local);
      vec3 cy  = tileAt(cell+vec2(0.0,dir.y), local);
      vec3 cxy = tileAt(cell+dir, local);
      mosaic = c*(1.0-w.x)*(1.0-w.y) + cx*w.x*(1.0-w.y) + cy*(1.0-w.x)*w.y + cxy*w.x*w.y;
    } else mosaic = c; // no melt : skip the neighbor taps (and smoothstep(1,1) is undefined)
  }
  vec4 dry = texture(uHost, vUV);
  o = vec4(mix(dry.rgb, mosaic*uGain, uMix), dry.a);
}`

// ── Sidechain recipes (v1.2.0) : Remap · Luma Blur · Gooey · Matte · Lookup ──
// Classic compositing moves, as native nodes. Each one reads an optional sidechain
// (another layer) and falls back to the host itself when none is picked, so they
// work in any rack and never go inert.

// Remap : the map's red/green channels say WHERE each pixel reads from.
// Absolute = RG is the coordinate; offset = RG around mid-gray displaces from where
// the pixel already is. EXTEND picks what lies past the edge. A transparent map
// leaves the picture in place; the moved picture brings its own alpha.
const F_REMAP = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uImg, uMap, uHost;
uniform float uAmount, uScale, uMix; uniform vec2 uOffset; uniform int uMode, uExtend;
vec2 ext(vec2 p){
  if (uExtend == 1) return fract(p);
  if (uExtend == 2) return 1.0 - abs(1.0 - mod(p, 2.0));
  return clamp(p, 0.0, 1.0);
}
void main(){
  vec4 mp = texture(uMap, vUV);
  vec2 q = (mp.rg - 0.5) * uScale;
  vec2 uv = uMode == 0 ? mix(vUV, q + 0.5 + uOffset, uAmount) : vUV + (q + uOffset) * uAmount;
  uv = ext(mix(vUV, uv, mp.a));
  vec4 c = texture(uImg, uv);
  vec4 dry = texture(uHost, vUV);
  vec4 r = mix(vec4(dry.rgb * dry.a, dry.a), vec4(c.rgb * c.a, c.a), uMix);
  o = vec4(r.a > 1e-4 ? r.rgb / r.a : vec3(0.0), r.a);
}`

// One axis of a variable-width blur : the control's brightness at THIS pixel sets
// the width (black level width ↔ white level width). Run twice (H then V) for a
// separable approximation that reads as a true lens blur. The H pass blurs the
// straight picture PREMULTIPLIED (no dark halos at alpha edges) and writes it so;
// the V pass unpremultiplies and mixes with the dry host. Taps read a mip level :
// never finer than 1080p (so the sparse-tap steps look the same at 4K and on the
// dome as at 1080p), or, in SMOOTH quality, the level matching the tap spacing.
const F_VBLUR = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex, uCtrl, uHost; uniform vec2 uStep;
uniform float uBlack, uWhite, uGamma, uFocus, uLodMax, uMix;
uniform int uInvert, uTaps, uDepth, uPass, uSmooth;
void main(){
  vec3 cv = texture(uCtrl, vUV).rgb;
  // Depth mode : distance from the focus plane (0 in focus → 1 far from it).
  float l = uDepth == 1 ? clamp(abs(cv.r - uFocus) * 2.0, 0.0, 1.0)
                        : clamp(dot(cv, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  if (uInvert == 1) l = 1.0 - l;
  float r = mix(uBlack, uWhite, pow(l, uGamma));
  vec4 res;
  if (r < 0.5) {
    res = textureLod(uTex, vUV, 0.0);
    if (uPass == 0) res.rgb *= res.a;
  } else {
    float sp = r / float(uTaps);
    float lod = log2(max(1.0, sp));
    if (uSmooth == 0) lod = min(lod, uLodMax);
    vec4 acc = vec4(0.0); float ws = 0.0;
    for (int i = -uTaps; i <= uTaps; i++) {
      float x = float(i) / float(uTaps);
      float w = exp(-x * x * 2.5);
      vec4 t = textureLod(uTex, vUV + uStep * float(i) * sp, lod);
      if (uPass == 0) t.rgb *= t.a;
      acc += t * w; ws += w;
    }
    res = acc / ws;
  }
  if (uPass == 0) { o = res; return; }
  vec4 hh = texture(uHost, vUV);
  vec4 c = mix(vec4(hh.rgb * hh.a, hh.a), res, uMix);
  o = vec4(c.a > 1e-4 ? c.rgb / c.a : vec3(0.0), c.a);
}`

// Fixed-width separable gaussian on RGBA (the Gooey's blur stage). The H pass
// premultiplies (uPass 0), the V pass keeps it premultiplied. Taps read the
// uLod mip level, so the blur sees a 1080p picture at any output size.
const F_GBLUR = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex; uniform vec2 uStep; uniform float uRadius, uLod; uniform int uTaps, uPass;
void main(){
  if (uRadius < 0.5) { vec4 t = textureLod(uTex, vUV, uLod); if (uPass == 0) t.rgb *= t.a; o = t; return; }
  float sp = uRadius / float(uTaps);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = -uTaps; i <= uTaps; i++) {
    float x = float(i) / float(uTaps);
    float w = exp(-x * x * 3.0);
    vec4 t = textureLod(uTex, vUV + uStep * float(i) * sp, uLod);
    if (uPass == 0) t.rgb *= t.a;
    acc += t * w; ws += w;
  }
  o = acc / ws;
}`

// Blur → threshold ("gooey" / metaballs) : shapes near each other melt into one
// blob because their blurred halos add up past the level. FILL picks what the
// blob shows : the crisp source (the blurred color where the source is empty, so
// blobs bridge gaps over transparency too), the blurred color pushed to full
// strength, or a plain white matte. OUTSIDE is how much of the source survives
// around the blobs. The blur arrives premultiplied.
const F_GOOEY = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uBlur;
uniform float uThresh, uSoft, uBg, uMix; uniform int uFill, uKey, uInvert;
void main(){
  vec4 h = texture(uHost, vUV);
  vec4 b = texture(uBlur, vUV);
  float mx = max(b.r, max(b.g, b.b));
  float k = uKey == 0 ? dot(b.rgb, vec3(0.299, 0.587, 0.114)) : mx;
  if (uInvert == 1) k = 1.0 - k;
  float m = smoothstep(uThresh - uSoft, uThresh + uSoft, k);
  vec3 bu = b.a > 1e-4 ? b.rgb / b.a : vec3(0.0);   // the blurred color, unpremultiplied
  vec3 fill = mix(bu, h.rgb, h.a);
  if (uFill == 1) fill = clamp(b.rgb / max(mx, 1e-3) * mix(mx, 1.0, 0.6), 0.0, 1.0);
  else if (uFill == 2) fill = vec3(1.0);
  vec3 c = mix(h.rgb * uBg, fill, m);
  o = vec4(mix(h.rgb, c, uMix), mix(h.a, max(h.a, m), uMix));
}`

// Matte (three inputs) : input 1 where the matte is bright, input 2 where it is
// dark, each with its own alpha. LOW/HIGH are levels on the matte (a contrast /
// choke control; LOW above HIGH inverts the ramp). With no input 2 the dark side
// is black (on input 1's alpha) or, EMPTY = transparent, a cut-out.
const F_MATTE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uA, uB, uM;
uniform int uChan, uInvert, uHasB, uEmpty; uniform float uLo, uHi, uMix;
void main(){
  vec4 a = texture(uA, vUV);
  vec4 b = uHasB == 1 ? texture(uB, vUV) : vec4(0.0, 0.0, 0.0, uEmpty == 1 ? 0.0 : a.a);
  vec4 mm = texture(uM, vUV);
  float m = uChan == 0 ? dot(mm.rgb, vec3(0.299, 0.587, 0.114))
          : uChan == 1 ? mm.r : uChan == 2 ? mm.g : uChan == 3 ? mm.b : mm.a;
  float d = uHi - uLo;
  if (abs(d) < 1e-4) d = d < 0.0 ? -1e-4 : 1e-4;
  m = clamp((m - uLo) / d, 0.0, 1.0);
  if (uInvert == 1) m = 1.0 - m;
  vec4 pa = vec4(a.rgb * a.a, a.a);
  vec4 k = mix(vec4(b.rgb * b.a, b.a), pa, m);
  vec4 r = mix(pa, k, uMix);
  o = vec4(r.a > 1e-4 ? r.rgb / r.a : vec3(0.0), r.a);
}`

// Lookup with a LIVE palette : the host's brightness (or each channel, or its
// hue) indexes a line drawn across the palette layer. POSITION slides that line
// (the diagonal slides across the frame, it no longer tilts), OFFSET cycles the
// table, CYCLES repeats it (MIRROR folds instead of wrapping), BAND averages a
// stripe around the line so a busy palette reads as a gradient. Where the palette
// layer is empty (transparent) the host serves as its own palette instead of black.
const F_LOOKUP = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPal;
uniform int uIndex, uAxis, uMirror;
uniform float uPos, uOffset, uCycles, uGamma, uBand, uMix;
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 pal(float l){
  float t = clamp(l, 0.0, 1.0) * 0.999 * uCycles + uOffset;
  t = uMirror == 1 ? 1.0 - abs(1.0 - mod(t, 2.0)) : fract(t);
  vec2 perp = uAxis == 0 ? vec2(0.0, 1.0) : uAxis == 1 ? vec2(1.0, 0.0) : vec2(-0.7071, 0.7071);
  vec2 p = uAxis == 0 ? vec2(t, uPos) : uAxis == 1 ? vec2(uPos, t) : vec2(t) + perp * (uPos - 0.5) * 1.4142;
  vec4 acc = vec4(0.0);
  for (int i = -2; i <= 2; i++) {
    vec2 q = clamp(p + perp * float(i) * uBand * 0.12, 0.0, 1.0);
    vec4 c = textureLod(uPal, q, 0.0);
    acc += vec4(c.rgb * c.a, c.a);
  }
  vec3 pc = acc.rgb / max(acc.a, 1e-4);
  if (acc.a < 2.5) {                       // an empty palette : fall back to the host
    vec3 self = vec3(0.0);
    for (int i = -2; i <= 2; i++) {
      vec2 q = clamp(p + perp * float(i) * uBand * 0.12, 0.0, 1.0);
      self += textureLod(uHost, q, 0.0).rgb;
    }
    pc = mix(self / 5.0, pc, smoothstep(0.25, 2.5, acc.a));
  }
  return pc;
}
void main(){
  vec4 h = texture(uHost, vUV);
  vec3 c;
  if (uIndex == 1) {
    vec3 g = pow(clamp(h.rgb, 0.0, 1.0), vec3(uGamma));
    c = vec3(pal(g.r).r, pal(g.g).g, pal(g.b).b);
  } else if (uIndex == 2) {
    // grays and near-blacks have no hue : they keep their own color
    vec3 hsv = rgb2hsv(clamp(h.rgb, 0.0, 1.0));
    c = mix(h.rgb, pal(hsv.x), smoothstep(0.0, 0.25, hsv.y) * smoothstep(0.08, 0.3, hsv.z));
  } else {
    c = pal(pow(clamp(dot(h.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0), uGamma));
  }
  o = vec4(mix(h.rgb, c, uMix), h.a);
}`


class NodeGL {
  quad: WebGLBuffer
  // Our own VAO : the ISF runtime draws off the DEFAULT VAO's attribute 0, so a
  // node must never rewire it (every ISF draw after a node would read our 3-vertex
  // triangle). use() binds this; FxRack.apply unbinds it after each node render.
  vao: WebGLVertexArrayObject
  private vs: WebGLShader | null = null // one vertex shader shared by every program
  checkedAt = 0 // last context-health check (performance.now ms)
  gen = glGeneration() // the GL generation it was built in (glGeneration.ts)
  convKernel: Prog
  fbAgc: Prog
  unpremul: Prog
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
  actant: Prog
  energy: Prog
  scan: Prog
  scanout: Prog
  autocut: Prog
  autocutTorn: Prog
  chrono: Prog
  sedAcc: Prog
  sedOut: Prog
  parallax: Prog
  eternal: Prog
  afterAcc: Prog
  afterOut: Prog
  pulfrich: Prog
  corrodeGrow: Prog
  corrodeOut: Prog
  decimate: Prog
  melt: Prog
  faultline: Prog
  ibfv: Prog
  ibfvOut: Prog
  toileTensor: Prog
  toileTBlur: Prog
  toile: Prog
  mosaicFeat: Prog
  mosaicGrad: Prog
  mosaicMatch: Prog
  mosaicRender: Prog
  remap: Prog
  vblur: Prog
  gblur: Prog
  gooey: Prog
  matte: Prog
  lookup: Prog

  constructor(readonly gl: WebGL2RenderingContext) {
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    // Programs are compiled on first use (build() is lazy), so the first node
    // render no longer compiles every node type's passes in one frame.
    this.convKernel = this.build(F_CONV_KERNEL)
    this.fbAgc = this.build(F_FB_AGC)
    this.unpremul = this.build(F_UNPREMUL)
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
    this.actant = this.build(F_ACTANT)
    this.energy = this.build(F_ENERGY)
    this.scan = this.build(F_SCAN)
    this.scanout = this.build(F_SCANOUT)
    this.autocut = this.build(F_AUTOCUT(false))
    this.autocutTorn = this.build(F_AUTOCUT(true))
    this.chrono = this.build(F_CHRONO)
    this.sedAcc = this.build(F_SED_ACC)
    this.sedOut = this.build(F_SED_OUT)
    this.parallax = this.build(F_PARALLAX)
    this.eternal = this.build(F_ETERNAL)
    this.afterAcc = this.build(F_AFTER_ACC)
    this.afterOut = this.build(F_AFTER_OUT)
    this.pulfrich = this.build(F_PULFRICH)
    this.corrodeGrow = this.build(F_CORRODE_GROW)
    this.corrodeOut = this.build(F_CORRODE_OUT)
    this.decimate = this.build(F_DECIMATE)
    this.melt = this.build(F_MELT)
    this.faultline = this.build(F_FAULTLINE)
    this.ibfv = this.build(F_IBFV)
    this.ibfvOut = this.build(F_IBFV_OUT)
    this.toileTensor = this.build(F_TOILE_TENSOR)
    this.toileTBlur = this.build(F_TOILE_TBLUR)
    this.toile = this.build(F_TOILE)
    this.mosaicFeat = this.build(F_MOSAIC_FEAT)
    this.mosaicGrad = this.build(F_MOSAIC_GRAD)
    this.mosaicMatch = this.build(F_MOSAIC_MATCH)
    this.mosaicRender = this.build(F_MOSAIC_RENDER)
    this.remap = this.build(F_REMAP)
    this.vblur = this.build(F_VBLUR)
    this.gblur = this.build(F_GBLUR)
    this.gooey = this.build(F_GOOEY)
    this.matte = this.build(F_MATTE)
    this.lookup = this.build(F_LOOKUP)
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

  // Lazy : the program is compiled + linked the first time it is used (each
  // status query is a GPU sync, so a node type only pays for its own passes).
  private build(fs: string): Prog {
    const gl = this.gl
    let prog: WebGLProgram | null = null
    const link = (): WebGLProgram => {
      if (!this.vs) this.vs = this.compile(gl.VERTEX_SHADER, VS)
      const p = gl.createProgram()!
      gl.attachShader(p, this.vs)
      gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs))
      gl.bindAttribLocation(p, 0, 'p')
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        console.error('[convNode] link:', gl.getProgramInfoLog(p))
      return p
    }
    const cache = new Map<string, WebGLUniformLocation | null>()
    return {
      get prog(): WebGLProgram {
        if (!prog) prog = link()
        return prog
      },
      u(n) {
        if (!cache.has(n)) cache.set(n, gl.getUniformLocation(this.prog, n))
        return cache.get(n)!
      }
    }
  }

  /** Bind a program + our fullscreen-triangle VAO, ready for uniform sets + draw.
   *  Attribute 0 is re-pointed at our triangle every time (cheap client state) :
   *  if anything wired its own buffer into this VAO while it was left bound (an
   *  ISF program created or drawn after a node, the warm-up path), the node would
   *  otherwise draw that quad's first triangle, half the frame. Callers unbind the
   *  VAO after a node renders (FxRack.apply, prewarmShader). */
  use(p: Prog): Prog {
    const gl = this.gl
    gl.useProgram(p.prog)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    return p
  }
}

/** True when a node renders after a gap in the engine frame counter : it was just
 *  inserted, re-enabled, or its layer skipped frames. Temporal nodes restart from
 *  the live frame instead of replaying stale history. */
function resumed(last: number, ctx: NodeContext): boolean {
  return ctx.frame === undefined ? last < 0 : last < 0 || ctx.frame !== last + 1
}

const shared = new WeakMap<WebGL2RenderingContext, NodeGL>()
function nodeGL(gl: WebGL2RenderingContext): NodeGL {
  let g = shared.get(gl)
  // After a GPU reset the context object survives but every program and buffer
  // it held is dead : rebuild rather than draw with stale handles. isBuffer is a
  // blocking GPU round-trip, so look at most once a second, never per render.
  // A GPU reset this window saw bumps the generation : rebuild at once (the check
  // below alone drew up to a second with dead programs first).
  if (g && g.gen !== glGeneration()) g = undefined
  if (g) {
    const now = performance.now()
    if (now - g.checkedAt > 1000) {
      g.checkedAt = now
      if (!gl.isContextLost() && !gl.isBuffer(g.quad)) g = undefined
    }
  }
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

// Module-level GL helpers for the first-half nodes (no per-frame closures).
function bindUnit(gl: WebGL2RenderingContext, unit: number, tex: WebGLTexture): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, tex)
}
function drawFull(gl: WebGL2RenderingContext, fbo: WebGLFramebuffer | null, w: number, h: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.viewport(0, 0, w, h)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}
function clearTarget(gl: WebGL2RenderingContext, fbo: WebGLFramebuffer): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
}
/** This rack's frame step in 60 Hz frames (1 at 60 fps, 0 when frozen), capped so
 *  a hitch or a 64× global speed can't blow a per-frame transform apart. */
const frames60 = (ctx: NodeContext): number => clampf(ctx.dt * 60, 0, 8)

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
  private lastFrame = -1
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
    // Fresh buffers or a gap in the frame counter (just inserted, re-enabled, a
    // flow-res change, PANIC) : prime the previous luma with this frame and zero
    // the inertia, so the first flow is 0 instead of a jolt against black.
    const prime = this.res !== n || resumed(this.lastFrame, ctx)
    this.lastFrame = ctx.frame ?? 0
    this.ensure(n)
    const bind = (unit: number, tex: WebGLTexture): void => bindUnit(gl, unit, tex)

    const lumaCur = this.lumaCurIsA ? this.lumaA : this.lumaB
    const lumaPrev = this.lumaCurIsA ? this.lumaB : this.lumaA

    // 1) downsample sidechain → luma (4×4 box prefilter : fine texture no longer
    //    aliases into flow noise).
    let p = g.use(g.downsample)
    bind(0, ctx.sidechain)
    gl.uniform1i(p.u('uTex'), 0)
    gl.uniform1f(p.u('uBox'), 1 / n)
    drawFull(gl, lumaCur.fbo, n, n)
    if (prime) {
      drawFull(gl, lumaPrev.fbo, n, n)
      clearTarget(gl, this.stateA.fbo); clearTarget(gl, this.stateB.fbo)
    }

    // 2) flow(cur, prev), in 256-field texels whatever the flow res.
    p = g.use(g.flow)
    bind(0, lumaCur.tex); bind(1, lumaPrev.tex)
    gl.uniform1i(p.u('uCur'), 0); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform2f(p.u('uRes'), n, n)
    gl.uniform1f(p.u('uLambda'), 0.001)
    gl.uniform1f(p.u('uClamp'), 0.25)
    gl.uniform1f(p.u('uScale'), 256 / n)
    drawFull(gl, this.scratch1.fbo, n, n)

    // 3) separable blur (radius = flowBlur), scratch1 → scratch2 → scratch1.
    const radius = Math.max(0, Math.min(24, num(inp.flowBlur, 8)))
    if (radius >= 1) {
      p = g.use(g.blur)
      bind(0, this.scratch1.tex); gl.uniform1i(p.u('uTex'), 0)
      gl.uniform1f(p.u('uRadius'), radius)
      gl.uniform2f(p.u('uStep'), 1 / n, 0)
      drawFull(gl, this.scratch2.fbo, n, n)
      bind(0, this.scratch2.tex)
      gl.uniform2f(p.u('uStep'), 0, 1 / n)
      drawFull(gl, this.scratch1.fbo, n, n)
    }

    // 4) temporal inertia: state = mix(prevState, flow, response), per 1/60 s of
    //    the rack clock (the same glide at any frame rate; a frozen layer holds).
    const inertie = Math.max(0, Math.min(1, num(inp.inertie, 0.6)))
    const response = 1 - Math.pow(inertie * 0.95, frames60(ctx)) // heavy inertia ⇒ slow follow
    const stateRead = this.stateReadIsA ? this.stateA : this.stateB
    const stateWrite = this.stateReadIsA ? this.stateB : this.stateA
    p = g.use(g.condition)
    bind(0, this.scratch1.tex); bind(1, stateRead.tex)
    gl.uniform1i(p.u('uFlow'), 0); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform1f(p.u('uResponse'), response)
    drawFull(gl, stateWrite.fbo, n, n)

    // 5) application at full res → a chain buffer.
    const out = ctx.chain.next()
    const amount = num(inp.amount, 0.35) * num(inp.flowScale, 1)
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
    drawFull(gl, out.fbo, ctx.chain.w, ctx.chain.h)

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
  private kw: RGBA | null = null // (2R+1)² thresholded kernel weights, R ≤ 12
  private ww = 0
  private wh = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed || !ctx.sidechain) return ctx.host // needs a kernel (sidechain)
    const inp = ctx.inputs
    // The O(R²) gather (up to 625 taps/pixel) is the most expensive avoidable
    // pass in the file : skip it entirely while the node is mixed out.
    if (clampf(num(inp.mix, 0.6), 0, 1) <= 0.001) return ctx.host
    const gl = ctx.gl
    const g = nodeGL(gl)
    const fullW = ctx.chain.w
    const fullH = ctx.chain.h
    const ww = Math.max(2, fullW >> 1)
    const wh = Math.max(2, fullH >> 1)
    if (!this.wet || this.ww !== ww || this.wh !== wh) {
      if (this.wet) { gl.deleteTexture(this.wet.tex); gl.deleteFramebuffer(this.wet.fbo) }
      this.wet = makeRGBA(gl, ww, wh, true)
      this.ww = ww; this.wh = wh
    }
    if (!this.kw) { this.kw = makeRGBA(gl, 25, 25, true); setNearest(gl, this.kw.tex) }
    const bind = (unit: number, tex: WebGLTexture): void => bindUnit(gl, unit, tex)
    const R = Math.max(1, Math.min(12, Math.round(num(inp.taps, 7))))
    const boost = clampf(num(inp.boost, 0), 0, 0.999) // 1 would make smoothstep(1, 1, x)

    // Kernel weights once per frame (they are the same for every output pixel).
    let p = g.use(g.convKernel)
    bind(0, ctx.sidechain); gl.uniform1i(p.u('uKernel'), 0)
    gl.uniform1f(p.u('uThreshold'), clampf(num(inp.threshold, 0.1), 0, 1))
    gl.uniform1f(p.u('uGamma'), Math.max(0.25, num(inp.kernelGamma, 1)))
    gl.uniform1i(p.u('uR'), R)
    drawFull(gl, this.kw.fbo, 2 * R + 1, 2 * R + 1)

    // Convolve host ⊛ kernel(sidechain) → reduced-res wet (premultiplied).
    p = g.use(g.convolve)
    bind(0, ctx.host); bind(1, this.kw.tex)
    gl.uniform1i(p.u('uHost'), 0); gl.uniform1i(p.u('uKW'), 1)
    gl.uniform1f(p.u('uExtent'), clampf(num(inp.scale, 0.8), 0, 2) * 0.35)
    gl.uniform1f(p.u('uAspect'), fullW / Math.max(1, fullH))
    gl.uniform1f(p.u('uBoost'), boost)
    gl.uniform1i(p.u('uR'), R)
    drawFull(gl, this.wet.fbo, ww, wh)

    // Composite wet over the full-res dry host.
    const out = ctx.chain.next()
    p = g.use(g.convMix)
    bind(0, ctx.host); bind(1, this.wet.tex)
    gl.uniform1i(p.u('uDry'), 0); gl.uniform1i(p.u('uWet'), 1)
    gl.uniform1f(p.u('uGain'), num(inp.gain, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 0.6), 0, 1))
    gl.uniform1f(p.u('uAdditive'), num(inp.additive, 0) >= 0.5 ? 1 : 0)
    gl.uniform1f(p.u('uGate'), boost > 0 ? 1 : 0)
    drawFull(gl, out.fbo, fullW, fullH)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    if (this.wet) { this.gl.deleteTexture(this.wet.tex); this.gl.deleteFramebuffer(this.wet.fbo); this.wet = null }
    if (this.kw) { this.gl.deleteTexture(this.kw.tex); this.gl.deleteFramebuffer(this.kw.fbo); this.kw = null }
  }
}

// ── Mosaïque : spatial concatenative synthesis (native, sidechain) ────────
const CORPUS_SIDES = [8, 16, 24, 32]
function setNearest(gl: WebGL2RenderingContext, tex: WebGLTexture): void {
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
}

// A count N of cells "across" split to the frame's aspect : cols × rows with
// square cells and about N² in total (the corpus capped at the match loop's 1024).
function aspectGrid(n: number, aspect: number, maxCount: number): [number, number] {
  const s = Math.sqrt(Math.max(0.1, aspect))
  const rows = Math.max(2, Math.round(n / s))
  let cols = Math.max(2, Math.round(n * s))
  if (cols * rows > maxCount) cols = Math.max(2, Math.floor(maxCount / rows))
  return [cols, rows]
}

export class MosaiqueNode implements ConvNode {
  private gx = 0 // target grid (cols × rows)
  private gy = 0
  private cx = 0 // corpus grid (cols × rows)
  private cy = 0
  private cMean!: RGBA // corpus tile mean+var (cx × cy)
  private cGrad!: RGBA // corpus tile signed gradient in .rg (cx × cy)
  private tMean!: RGBA // target patch mean+var (gx × gy)
  private tGrad!: RGBA // target patch gradient in .rg (gx × gy)
  private idxA!: RGBA // index-map ping-pong (gx × gy) : (cx, cy, orient, valid)
  private idxB!: RGBA
  private readIsA = true
  private phase = 0 // accumulated time for drift (frozen while drift = 0)
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private clear(t: RGBA | RG, w: number, h: number): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
  }

  private ensure(gx: number, gy: number, cx: number, cy: number): void {
    const gl = this.gl
    const corpusChanged = this.cx !== cx || this.cy !== cy
    if (corpusChanged) {
      for (const t of [this.cMean, this.cGrad]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
      this.cMean = makeRGBA(gl, cx, cy, true); setNearest(gl, this.cMean.tex); this.clear(this.cMean, cx, cy)
      this.cGrad = makeRGBA(gl, cx, cy, true); setNearest(gl, this.cGrad.tex); this.clear(this.cGrad, cx, cy)
      this.cx = cx; this.cy = cy
    }
    if (this.gx !== gx || this.gy !== gy) {
      for (const t of [this.tMean, this.tGrad, this.idxA, this.idxB]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
      this.tMean = makeRGBA(gl, gx, gy, true); setNearest(gl, this.tMean.tex); this.clear(this.tMean, gx, gy)
      this.tGrad = makeRGBA(gl, gx, gy, true); setNearest(gl, this.tGrad.tex); this.clear(this.tGrad, gx, gy)
      // The index map starts empty (valid=0) so stickiness has nothing to hold.
      this.idxA = makeRGBA(gl, gx, gy, true); setNearest(gl, this.idxA.tex); this.clear(this.idxA, gx, gy)
      this.idxB = makeRGBA(gl, gx, gy, true); setNearest(gl, this.idxB.tex); this.clear(this.idxB, gx, gy)
      this.readIsA = true
      this.gx = gx; this.gy = gy
    } else if (corpusChanged) {
      // A new corpus : held indices point at tiles that may no longer exist.
      this.clear(this.idxA, gx, gy); this.clear(this.idxB, gx, gy)
    }
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed || !ctx.sidechain) return ctx.host // needs a corpus (sidechain)
    const inp = ctx.inputs
    if (clampf(num(inp.mix, 0.85), 0, 1) <= 0.001) return ctx.host
    const gl = ctx.gl
    const g = nodeGL(gl)
    const fullW = ctx.chain.w, fullH = ctx.chain.h
    const aspect = fullW / Math.max(1, fullH)
    const G = Math.max(2, Math.min(64, Math.round(num(inp.tile, 24))))
    const C = CORPUS_SIDES[Math.max(0, Math.min(3, Math.round(num(inp.corpus, 1))))]
    const [gx, gy] = aspectGrid(G, aspect, 64 * 64)
    const [cx, cy] = aspectGrid(C, aspect, 1024)
    this.ensure(gx, gy, cx, cy)
    const K = 8
    const bind = (unit: number, tex: WebGLTexture): void => bindUnit(gl, unit, tex)
    // Gradient step fixed in UV (1 px at 1080p) : the structure term no longer
    // shrinks at 4K or grows at lo-fi render sizes.
    const pixX = 1 / 1920, pixY = 1 / 1080

    // ── Descriptors : corpus (from the sidechain) + target (from the host) ──
    let p = g.use(g.mosaicFeat)
    bind(0, ctx.sidechain); gl.uniform1i(p.u('uSrc'), 0)
    gl.uniform2f(p.u('uGrid'), cx, cy); gl.uniform1i(p.u('uTaps'), K)
    drawFull(gl, this.cMean.fbo, cx, cy)
    p = g.use(g.mosaicGrad)
    bind(0, ctx.sidechain); gl.uniform1i(p.u('uSrc'), 0)
    gl.uniform2f(p.u('uGrid'), cx, cy); gl.uniform1i(p.u('uTaps'), K); gl.uniform2f(p.u('uPix'), pixX, pixY)
    drawFull(gl, this.cGrad.fbo, cx, cy)
    p = g.use(g.mosaicFeat)
    bind(0, ctx.host); gl.uniform1i(p.u('uSrc'), 0)
    gl.uniform2f(p.u('uGrid'), gx, gy); gl.uniform1i(p.u('uTaps'), K)
    drawFull(gl, this.tMean.fbo, gx, gy)
    p = g.use(g.mosaicGrad)
    bind(0, ctx.host); gl.uniform1i(p.u('uSrc'), 0)
    gl.uniform2f(p.u('uGrid'), gx, gy); gl.uniform1i(p.u('uTaps'), K); gl.uniform2f(p.u('uPix'), pixX, pixY)
    drawFull(gl, this.tGrad.fbo, gx, gy)

    // ── Match → index map (ping-pong for stickiness) ──
    const idxRead = this.readIsA ? this.idxA : this.idxB
    const idxWrite = this.readIsA ? this.idxB : this.idxA
    p = g.use(g.mosaicMatch)
    bind(0, this.tMean.tex); gl.uniform1i(p.u('uTMean'), 0)
    bind(1, this.tGrad.tex); gl.uniform1i(p.u('uTGrad'), 1)
    bind(2, this.cMean.tex); gl.uniform1i(p.u('uCMean'), 2)
    bind(3, this.cGrad.tex); gl.uniform1i(p.u('uCGrad'), 3)
    bind(4, idxRead.tex); gl.uniform1i(p.u('uPrev'), 4)
    gl.uniform2f(p.u('uG'), gx, gy); gl.uniform2f(p.u('uC'), cx, cy)
    gl.uniform1i(p.u('uCount'), cx * cy)
    gl.uniform1i(p.u('uMode'), Math.max(0, Math.min(2, Math.round(num(inp.orient, 1)))))
    gl.uniform1f(p.u('uStructure'), clampf(num(inp.structure, 0.4), 0, 1))
    gl.uniform1f(p.u('uStick'), clampf(num(inp.stick, 0.6), 0, 1))
    gl.uniform1f(p.u('uJitter'), clampf(num(inp.jitter, 0.1), 0, 1))
    gl.uniform1f(p.u('uWVar'), 0.5)
    gl.uniform1f(p.u('uWGrad'), 3.0)
    drawFull(gl, idxWrite.fbo, gx, gy)
    this.readIsA = !this.readIsA

    // ── Render : tile the frame from the matched corpus ──
    const out = ctx.chain.next()
    p = g.use(g.mosaicRender)
    bind(0, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    bind(1, ctx.sidechain); gl.uniform1i(p.u('uSide'), 1)
    bind(2, idxWrite.tex); gl.uniform1i(p.u('uIndex'), 2)
    bind(3, this.cMean.tex); gl.uniform1i(p.u('uCMean'), 3)
    bind(4, this.tMean.tex); gl.uniform1i(p.u('uTMean'), 4)
    gl.uniform2f(p.u('uG'), gx, gy); gl.uniform2f(p.u('uC'), cx, cy)
    gl.uniform1f(p.u('uCorrect'), clampf(num(inp.correct, 0.5), 0, 1))
    gl.uniform1f(p.u('uMelt'), clampf(num(inp.melt, 0.3), 0, 1))
    gl.uniform1f(p.u('uGain'), Math.max(0, num(inp.gain, 1)))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 0.85), 0, 1))
    // Cell shape (grid/brick/voronoi/warp), its irregularity, and drift (only
    // advances the phase clock while > 0, so shapes hold still at drift 0).
    this.phase += clampf(ctx.dt, 0, 0.1) * clampf(num(inp.drift, 0), 0, 1) * 0.6
    gl.uniform1i(p.u('uShape'), Math.max(0, Math.min(3, Math.round(num(inp.shape, 2)))))
    gl.uniform1f(p.u('uIrregular'), clampf(num(inp.irregular, 0.5), 0, 1))
    // Wrapped so float32 precision holds over a long show : the seed wobble at a
    // whole period of sin(t) and cos(1.1 t), the warp noise at its tiling period.
    gl.uniform1f(p.u('uTime'), this.phase % (20 * Math.PI))
    gl.uniform1f(p.u('uTimeN'), this.phase % 256)
    drawFull(gl, out.fbo, fullW, fullH)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    for (const t of [this.cMean, this.cGrad, this.tMean, this.tGrad, this.idxA, this.idxB])
      if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
  }
}

// ── Module 3 : Réponse (temporal frame-echo convolution) ──────────────────
const ECHO_COLS = 4
const ECHO_ROWS = 4
const ECHO_N = ECHO_COLS * ECHO_ROWS // 16 history frames

// A ring written every `stride` × 1/60 s of the rack clock (a frame at 60 fps), so
// a history of N frames spans the same time at any frame rate, a longer one at a
// wider stride, and holds still on a frozen layer. Returns true when a write is due.
function strideDue(acc: { t: number }, dt: number, stride: number, empty: boolean): boolean {
  const interval = Math.max(1, stride) / 60
  acc.t += dt
  if (!empty && acc.t < interval - 0.004) return false
  acc.t = Math.min(Math.max(acc.t - interval, -0.004), interval) // keep the mean rate, never bank a burst
  return true
}

export class ReponseNode implements ConvNode {
  private ring: RGBA | null = null
  private tileW = 0
  private tileH = 0
  private writeIdx = 0
  private filled = 0
  private lastFrame = -1
  private clock = { t: 0 }
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
    // Just inserted / re-enabled : forget the history instead of replaying frames
    // from when the node was switched off.
    if (resumed(this.lastFrame, ctx)) { this.writeIdx = 0; this.filled = 0 }
    this.lastFrame = ctx.frame ?? 0
    const bind = (unit: number, tex: WebGLTexture): void => bindUnit(gl, unit, tex)

    // 1) Build the temporal envelope (attack onset × exponential decay tail). Tap 0
    //    is the live frame, taps 1.. the stored past.
    const len = Math.max(1, Math.min(ECHO_N, Math.min(this.filled + 1, Math.round(num(inp.length, 10)))))
    const decayTaps = Math.max(0.5, clampf(num(inp.decay, 0.5), 0.02, 1) * ECHO_N)
    const attackTaps = Math.max(0.02, clampf(num(inp.attack, 0.1), 0, 1) * ECHO_N)
    this.env.fill(0)
    for (let i = 0; i < len; i++) {
      this.env[i] = (1 - Math.exp(-(i + 1) / attackTaps)) * Math.exp(-i / decayTaps)
    }
    if (num(inp.reverse, 0) >= 0.5) {
      for (let i = 0; i < len >> 1; i++) { const t = this.env[i]; this.env[i] = this.env[len - 1 - i]; this.env[len - 1 - i] = t }
    }

    // 2) Echo: Σ tap[age i] · env[i], normalized, × GAIN, mixed with the dry host.
    //    (Gain used to scale every weight, which the normalization cancelled.)
    const out = ctx.chain.next()
    let p = g.use(g.echo)
    bind(0, ctx.host); bind(1, this.ring.tex)
    gl.uniform1i(p.u('uHost'), 0); gl.uniform1i(p.u('uRing'), 1)
    gl.uniform1i(p.u('uCols'), ECHO_COLS); gl.uniform1i(p.u('uRows'), ECHO_ROWS)
    gl.uniform1i(p.u('uLast'), (this.writeIdx - 1 + ECHO_N) % ECHO_N); gl.uniform1i(p.u('uLen'), len)
    gl.uniform1fv(p.u('uEnv'), this.env)
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 0.6), 0, 1))
    gl.uniform1f(p.u('uGain'), Math.max(0, num(inp.gain, 1)))
    drawFull(gl, out.fbo, fullW, fullH)

    // 3) Store the current host frame into the ring's write tile (downsampled),
    //    every STRIDE frames of 60 Hz.
    if (strideDue(this.clock, ctx.dt, Math.round(num(inp.stride, 1)), this.filled === 0)) {
      const col = this.writeIdx % ECHO_COLS
      const row = Math.floor(this.writeIdx / ECHO_COLS)
      p = g.use(g.copy)
      bind(0, ctx.host); gl.uniform1i(p.u('uTex'), 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ring.fbo)
      gl.viewport(col * tw, row * th, tw, th)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      this.writeIdx = (this.writeIdx + 1) % ECHO_N
      this.filled = Math.min(ECHO_N, this.filled + 1)
    }
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
  private bufsB: [RGBA, RGBA] | null = null // 2nd coupled buffer (fb1), lazy when couple > 0
  private curB = 0
  private idleB = 0 // seconds fb1 has sat unused (freed after a while, not on every crossing)
  private wasDual = false
  private agc: [RGBA, RGBA] | null = null // 1×1 smoothed AGC state
  private agcCur = 0
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
  private lastFrame = -1
  private seeded = false
  private prevClear = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    if (this.bufs && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.bufs) for (const b of this.bufs) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
    if (this.bufsB) { for (const b of this.bufsB) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.bufsB = null }
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo) }
    this.bufs = [makeRGBA(gl, w, h, true), makeRGBA(gl, w, h, true)]
    this.ringTW = Math.max(2, w >> 1); this.ringTH = Math.max(2, h >> 1)
    this.ring = makeRGBA(gl, this.ringTW * FB_COLS, this.ringTH * FB_ROWS, false)
    this.ringWrite = 0; this.ringFilled = 0
    this.w = w; this.h = h; this.cur = 0; this.seeded = false
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)
    const inp = ctx.inputs
    this.t += ctx.dt; this.frame++
    const f = frames60(ctx)

    // Start from the live frame : on insert, resize, PANIC, re-enable (a gap in
    // the engine frame counter) or the local CLEAR event. An unseeded loop started
    // black and dipped the picture for several frames.
    const clr = num(inp.clear, 0)
    const clearNow = clr >= 0.5 && this.prevClear < 0.5
    this.prevClear = clr
    const reseed = !this.seeded || clearNow || resumed(this.lastFrame, ctx)
    this.lastFrame = ctx.frame ?? 0
    if (!this.agc) { this.agc = [makeRGBA(gl, 1, 1, true), makeRGBA(gl, 1, 1, true)]; this.agcCur = 0 }
    if (reseed) {
      const cp = g.use(g.copy)
      bindUnit(gl, 0, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
      for (const b of this.bufs!) drawFull(gl, b.fbo, W, H)
      if (this.bufsB) for (const b of this.bufsB) drawFull(gl, b.fbo, W, H)
      this.ringWrite = 0; this.ringFilled = 0
      this.seeded = true
    }
    const read = this.bufs![this.cur]
    const write = this.bufs![1 - this.cur]

    // AGC state : compare the loop's mean luma with the live source's, smoothed
    // over ~0.1 s of the rack clock (snapped on a reseed).
    const aRead = this.agc[this.agcCur], aWrite = this.agc[1 - this.agcCur]
    {
      const p = g.use(g.fbAgc)
      bindUnit(gl, 0, ctx.host); gl.uniform1i(p.u('uHost'), 0)
      bindUnit(gl, 1, read.tex); gl.uniform1i(p.u('uPrev'), 1)
      bindUnit(gl, 2, aRead.tex); gl.uniform1i(p.u('uState'), 2)
      gl.uniform1f(p.u('uK'), reseed ? 1 : 1 - Math.exp(-ctx.dt / 0.1))
      drawFull(gl, aWrite.fbo, 1, 1)
      this.agcCur = 1 - this.agcCur
    }

    // Drifting off-center pivot : the anti-mandala key (keeps feedback organic
    // and wandering rather than a centered radial tunnel).
    const drift = clampf(num(inp.pivot, 0.4), 0, 1)
    const pvx = 0.5 + Math.sin(this.t * 0.13) * drift * 0.3
    const pvy = 0.5 + Math.cos(this.t * 0.11) * drift * 0.3

    // Delay tap : most-recent past tile = (ringWrite-1); go `delay` frames back,
    // clamped to what's actually been filled so we never read a black tile. RGB
    // delay shears the channels by ±spread frames (time-shear).
    const delayMixIn = this.ringFilled > 1 ? clampf(num(inp.delayMix, 0), 0, 1) : 0
    const delayReq = Math.round(clampf(num(inp.delay, 0), 0, FB_N - 1))
    const spread = Math.round(clampf(num(inp.rgbDelay, 0), 0, 8))
    const maxBack = Math.max(0, this.ringFilled - 1)
    const tile = (back: number): number => ((this.ringWrite - 1 - Math.min(maxBack, Math.max(0, back))) % FB_N + FB_N) % FB_N
    const dg = Math.min(delayReq, maxBack)
    const tileR = tile(dg + spread), tileG = tile(dg), tileB = tile(dg - spread)
    const route = Math.round(num(inp.route, 0))

    const couple = clampf(num(inp.couple, 0), 0, 1)
    const couple2 = clampf(num(inp.couple2, 1.3), 0, 2)
    const dual = couple > 0.001

    // Set every (shared) uniform + draw one feedback pass. `prev`/`cross` are the
    // buffers this pass reads; `tmul` scales this buffer's transform (fb1 diverges).
    // Every per-frame step is raised / scaled to this rack's frame step `f`.
    const drawFB = (writeFbo: WebGLFramebuffer, prev: WebGLTexture, cross: WebGLTexture, tmul: number, coupleAmt: number): void => {
      const p = g.use(g.feedback)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev); gl.uniform1i(p.u('uPrev'), 1)
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.ring!.tex); gl.uniform1i(p.u('uRing'), 2)
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, cross); gl.uniform1i(p.u('uCross'), 3)
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, aWrite.tex); gl.uniform1i(p.u('uAgcTex'), 4)
      gl.uniform1i(p.u('uRingCols'), FB_COLS); gl.uniform1i(p.u('uRingRows'), FB_ROWS)
      gl.uniform2f(p.u('uRingTexel'), 1 / (this.ringTW * FB_COLS), 1 / (this.ringTH * FB_ROWS))
      gl.uniform1i(p.u('uDelayTileR'), tileR); gl.uniform1i(p.u('uDelayTileG'), tileG); gl.uniform1i(p.u('uDelayTileB'), tileB)
      gl.uniform1f(p.u('uDelayMix'), delayMixIn); gl.uniform1i(p.u('uRoute'), route)
      gl.uniform1i(p.u('uPlacement'), Math.round(num(inp.placement, 0)))
      gl.uniform1f(p.u('uCouple'), coupleAmt)
      gl.uniform2f(p.u('uRes'), W, H)
      gl.uniform1f(p.u('uAspect'), W / Math.max(1, H))
      gl.uniform1f(p.u('uFrames'), f)
      gl.uniform1f(p.u('uFeedback'), Math.pow(clampf(num(inp.feedback, 0.85), 0, 1), f))
      gl.uniform1f(p.u('uGain'), clampf(num(inp.gain, 1.0), 0.2, 2.0))
      gl.uniform1f(p.u('uScaleZ'), Math.pow(1 - clampf(num(inp.zoom, 0.01), -0.2, 0.2) * tmul, f))
      gl.uniform1f(p.u('uRot'), clampf(num(inp.rotate, 0), -0.3, 0.3) * tmul * f)
      gl.uniform2f(p.u('uOff'), clampf(num(inp.driftX, 0), -0.1, 0.1) * f, clampf(num(inp.driftY, 0), -0.1, 0.1) * f)
      gl.uniform2f(p.u('uPivot'), pvx, pvy)
      gl.uniform1f(p.u('uWarp'), clampf(num(inp.warp, 0.4), 0, 1) * f)
      gl.uniform1f(p.u('uHue'), clampf(num(inp.hue, 0), -0.5, 0.5) * f)
      gl.uniform1f(p.u('uHueCurve'), clampf(num(inp.hueCurve, 0), 0, 1))
      gl.uniform1f(p.u('uSat'), Math.pow(1 + clampf(num(inp.sat, 0), -0.15, 0.15), f) - 1)
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo)
      gl.viewport(0, 0, W, H)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    if (dual) {
      // fb1 is (re)seeded from fb0 whenever coupling starts, so it never starts
      // black or resumes from stale frames (a visible pop).
      if (!this.bufsB) {
        this.bufsB = [makeRGBA(gl, W, H, true), makeRGBA(gl, W, H, true)]
        this.curB = 0
        this.wasDual = false
      }
      if (!this.wasDual) {
        const cp0 = g.use(g.copy)
        bindUnit(gl, 0, read.tex); gl.uniform1i(cp0.u('uTex'), 0)
        for (const b of this.bufsB) drawFull(gl, b.fbo, W, H)
      }
      this.idleB = 0
      const readB = this.bufsB[this.curB], writeB = this.bufsB[1 - this.curB]
      // Both passes read the OLD (read) buffers so the coupling is symmetric.
      drawFB(write.fbo, read.tex, readB.tex, 1.0, couple) // fb0 ← fb0 × fb1
      drawFB(writeB.fbo, readB.tex, read.tex, couple2, couple) // fb1 : diverged transform
      this.curB = 1 - this.curB
    } else {
      // Couple off : free fb1 (2× full-res RGBA16F ≈ 33MB at 1080p would
      // otherwise sit in VRAM), but only after it has sat unused for a few
      // seconds : an LFO sweeping couple through 0 must not reallocate it on
      // every crossing.
      if (this.bufsB) {
        this.idleB += ctx.dt
        if (this.idleB > 3) {
          for (const b of this.bufsB) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
          this.bufsB = null
        }
      }
      drawFB(write.fbo, read.tex, read.tex, 1.0, 0)
    }
    this.wasDual = dual

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
    if (this.bufsB) { for (const b of this.bufsB) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.bufsB = null }
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo); this.ring = null }
    if (this.agc) { for (const b of this.agc) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.agc = null }
  }
}

// ── Datamosh engine (real-time faux-codec mosh) ──────────────────────────
// Optical flow of the live signal (or a sidechain layer, for cross-layer motion
// transfer) → block-quantized macroblock vectors → advect an RGBA16F accumulator
// (F_DATAMOSH). Reuses the flow pipeline (downsample + F_FLOW) like Transfert and
// the ping-pong accumulator like Feedback. Any rack.
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
  private actBuf: [RGBA, RGBA] | null = null // actant mask ping-pong (localized sticky patches)
  private actW = 0
  private actH = 0
  private actCur = 0
  private prevActTrig = 0
  private actPulseT = 0
  private actCenters = new Float32Array(12) // up to 6 stamp centers (vec2 each)
  private lastFrame = -1
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
    // Fresh flow buffers or a gap in the frame counter (inserted, re-enabled, a
    // flow-res change, PANIC) : prime the previous luma with this frame (no false
    // flow jolt or false cut-bloom), and on a gap restart the accumulator from the
    // live frame instead of replaying what it held when switched off.
    const gap = resumed(this.lastFrame, ctx)
    const prime = this.res !== n || gap
    this.lastFrame = ctx.frame ?? 0
    this.ensureFlow(n)
    this.ensureAccum(W, H)
    if (gap) this.seeded = false
    this.frame++
    const f = frames60(ctx)

    // Bloom trigger : a rising edge on `trig` (or the `pulse` auto-clock) sets a
    // decaying bloom envelope that the shader turns into an I-frame hold + a
    // persistence boost : the classic datamosh burst, fireable on the beat.
    const trig = num(inp.trig, 0)
    if (trig >= 0.5 && this.prevTrig < 0.5) this.bloomEnv = 1
    this.prevTrig = trig
    const pulse = clampf(num(inp.pulse, 0), 0, 8)
    if (pulse > 0) {
      this.pulseT += ctx.dt
      if (this.pulseT >= 1 / pulse) { this.pulseT = Math.min(this.pulseT - 1 / pulse, 1 / pulse); this.bloomEnv = 1 }
    }
    this.bloomEnv *= Math.exp(-ctx.dt / 0.4) // ~0.4s bloom tail

    // Actant spawn : a rising edge on `actantTrig` (or the `actantRate` clock) seeds
    // a burst of localized sticky patches at random centers. Fill the center array
    // and flag how many to stamp this frame (0 = advect+decay only).
    const actStrength = clampf(num(inp.actant, 0), 0, 1)
    const actTrig = num(inp.actantTrig, 0)
    const actRate = clampf(num(inp.actantRate, 0), 0, 8)
    let spawn = 0
    if (actStrength > 0.001) {
      if (actTrig >= 0.5 && this.prevActTrig < 0.5) spawn = 3
      if (actRate > 0) {
        this.actPulseT += ctx.dt
        if (this.actPulseT >= 1 / actRate) { this.actPulseT = Math.min(this.actPulseT - 1 / actRate, 1 / actRate); spawn = 3 }
      }
    }
    this.prevActTrig = actTrig
    if (spawn > 0) {
      for (let i = 0; i < spawn; i++) {
        this.actCenters[i * 2] = 0.12 + Math.random() * 0.76
        this.actCenters[i * 2 + 1] = 0.12 + Math.random() * 0.76
      }
    }

    const bind = (unit: number, tex: WebGLTexture): void => bindUnit(gl, unit, tex)

    // Seed the accumulator with the live frame so the mosh never starts from a
    // black buffer (which, with high persistence, would take ~12 frames to fill).
    if (!this.seeded) {
      const cp = g.use(g.copy)
      bind(0, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
      for (const b of this.accum!) drawFull(gl, b.fbo, W, H)
      this.seeded = true
    }

    const lumaCur = this.lumaCurIsA ? this.lumaA : this.lumaB
    const lumaPrev = this.lumaCurIsA ? this.lumaB : this.lumaA
    // Flow source : a sidechain layer (motion transfer / "diegetic datamosh") if
    // present + enabled, else the host's own motion.
    const flowSrc = ctx.sidechain && num(inp.sidechainFlow, 0) >= 0.5 ? ctx.sidechain : ctx.host

    // 1) downsample flow source → luma (one bilinear tap : the fine-texture flow
    //    noise is part of the mosh's creep)
    let p = g.use(g.downsample)
    bind(0, flowSrc); gl.uniform1i(p.u('uTex'), 0)
    gl.uniform1f(p.u('uBox'), 0)
    drawFull(gl, lumaCur.fbo, n, n)
    if (prime) {
      drawFull(gl, lumaPrev.fbo, n, n)
      clearTarget(gl, this.flowStateA.fbo); clearTarget(gl, this.flowStateB.fbo)
      if (this.energyBuf) for (const b of this.energyBuf) clearTarget(gl, b.fbo)
      if (this.actBuf) for (const b of this.actBuf) clearTarget(gl, b.fbo)
    }
    // 2) flow(cur, prev), in 256-field texels whatever the flow res
    p = g.use(g.flow)
    bind(0, lumaCur.tex); bind(1, lumaPrev.tex)
    gl.uniform1i(p.u('uCur'), 0); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform2f(p.u('uRes'), n, n)
    gl.uniform1f(p.u('uLambda'), 0.002)
    gl.uniform1f(p.u('uClamp'), 0.06) // max per-frame flow (must exceed the motion gate)
    gl.uniform1f(p.u('uScale'), 256 / n)
    drawFull(gl, this.flowT.fbo, n, n)

    // 2a) FLUID mode : temporally average the flow (ffglitch's "average motion") →
    //     a smooth liquid melt. melt/sticky feed the RAW flow (response 1 = no avg).
    const mode = Math.round(num(inp.mode, 1))
    const fsRead = this.flowStateCur ? this.flowStateA : this.flowStateB
    const fsWrite = this.flowStateCur ? this.flowStateB : this.flowStateA
    p = g.use(g.condition)
    bind(0, this.flowT.tex); bind(1, fsRead.tex)
    gl.uniform1i(p.u('uFlow'), 0); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform1f(p.u('uResponse'), mode === 2 ? 1 - Math.pow(0.88, f) : 1.0)
    drawFull(gl, fsWrite.fbo, n, n)

    // 2b) cut detector → 1×1 decaying bloom state (scene-cut auto-mosh).
    // 16F : an 8-bit exponential decay quantize-sticks at a faint non-zero level.
    if (!this.energyBuf) { this.energyBuf = [makeRGBA(gl, 1, 1, true), makeRGBA(gl, 1, 1, true)]; this.energyCur = 0 }
    const eRead = this.energyBuf[this.energyCur], eWrite = this.energyBuf[1 - this.energyCur]
    p = g.use(g.energy)
    bind(0, this.flowT.tex); bind(1, eRead.tex)
    gl.uniform1i(p.u('uFlow'), 0); gl.uniform1i(p.u('uPrevE'), 1)
    gl.uniform1f(p.u('uCutSense'), clampf(num(inp.cutSense, 0.35), 0.02, 1))
    gl.uniform1f(p.u('uEDecay'), Math.pow(0.92, f)) // bloom sustains ~0.4–0.5 s after a cut
    drawFull(gl, eWrite.fbo, 1, 1)

    // 2c) actant mask : advect the sticky-patch field along the conditioned flow,
    //     decay it, and stamp any spawn burst. Only when actants are enabled.
    //     Half float : an 8-bit mask stalled at a permanent partial freeze.
    let actMask: WebGLTexture = ctx.host // fallback tex (unused when uActant = 0)
    if (actStrength > 0.001) {
      if (!this.actBuf || this.actW !== W || this.actH !== H) {
        if (this.actBuf) for (const b of this.actBuf) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
        this.actBuf = [makeRGBA(gl, W, H, true), makeRGBA(gl, W, H, true)]
        this.actW = W; this.actH = H; this.actCur = 0
      }
      const aRead = this.actBuf[this.actCur], aWrite = this.actBuf[1 - this.actCur]
      p = g.use(g.actant)
      bind(0, aRead.tex); bind(1, fsWrite.tex)
      gl.uniform1i(p.u('uPrev'), 0); gl.uniform1i(p.u('uFlow'), 1)
      gl.uniform2f(p.u('uRes'), W, H)
      const life = clampf(num(inp.actantLife, 0.6), 0, 1)
      gl.uniform1f(p.u('uDecay'), Math.exp(-ctx.dt / (0.15 + life * life * 6))) // ~0.15–6s life
      gl.uniform1f(p.u('uMotion'), clampf(num(inp.motion, 1), 0, 4))
      gl.uniform1i(p.u('uFlowInvert'), num(inp.flowInvert, 0) >= 0.5 ? 1 : 0)
      gl.uniform1f(p.u('uStamp'), spawn > 0 ? 1 : 0)
      gl.uniform1f(p.u('uNStamp'), spawn)
      gl.uniform1f(p.u('uRad'), clampf(num(inp.block, 16) * Math.max(1, Math.floor(H / 1080 + 0.5)) / Math.min(W, H) * 4, 0.03, 0.4))
      gl.uniform2fv(p.u('uCenters'), this.actCenters)
      drawFull(gl, aWrite.fbo, W, H)
      actMask = aWrite.tex
      this.actCur = 1 - this.actCur
    }
    // Macroblocks scale with the render size (in whole pixels : 16 px at 1080p,
    // 32 px at 4K), so the mosh has the same grain at every output size.
    const pxs = Math.max(1, Math.floor(H / 1080 + 0.5))

    // 3) datamosh advection → accumulator write
    const read = this.accum![this.cur], write = this.accum![1 - this.cur]
    p = g.use(g.datamosh)
    bind(0, ctx.host); bind(1, read.tex); bind(2, fsWrite.tex); bind(3, eWrite.tex) // conditioned flow
    bind(4, actMask)
    gl.uniform1i(p.u('uHost'), 0); gl.uniform1i(p.u('uPrev'), 1); gl.uniform1i(p.u('uFlow'), 2); gl.uniform1i(p.u('uEnergy'), 3)
    gl.uniform1i(p.u('uActantMask'), 4)
    gl.uniform1f(p.u('uActant'), actStrength)
    gl.uniform1f(p.u('uManifest'), clampf(num(inp.manifest, 0), 0, 1))
    gl.uniform1f(p.u('uAutoBloom'), clampf(num(inp.autoBloom, 0.7), 0, 1))
    gl.uniform1f(p.u('uBloom'), Math.min(1, this.bloomEnv))
    gl.uniform1i(p.u('uFlowInvert'), num(inp.flowInvert, 0) >= 0.5 ? 1 : 0)
    gl.uniform1f(p.u('uSwirl'), clampf(num(inp.swirl, 0), -1, 1) * 1.5708)
    gl.uniform2f(p.u('uRes'), W, H)
    gl.uniform1f(p.u('uBlock'), clampf(num(inp.block, 16), 2, 64) * pxs)
    gl.uniform1f(p.u('uMotion'), clampf(num(inp.motion, 1), 0, 4))
    gl.uniform1f(p.u('uRefresh'), clampf(num(inp.refresh, 0.06), 0, 1))
    gl.uniform1f(p.u('uResidual'), clampf(num(inp.residual, 0.15), 0, 1))
    gl.uniform1f(p.u('uReseed'), clampf(num(inp.reseed, 0.1), 0, 1))
    gl.uniform1f(p.u('uDecay'), clampf(num(inp.decay, 0.92), 0, 1))
    gl.uniform1f(p.u('uBleed'), clampf(num(inp.bleed, 0.2), 0, 1))
    // The gate compares per-frame motion : at a higher frame rate the same motion
    // moves less per frame, so the threshold follows the frame step.
    gl.uniform1f(p.u('uThresh'), clampf(num(inp.thresh, 0.012), 0, 0.1) * clampf(f, 0.25, 4))
    gl.uniform1f(p.u('uFrames'), f)
    gl.uniform1i(p.u('uMode'), Math.round(num(inp.mode, 1)))
    gl.uniform1f(p.u('uMoshGate'), clampf(num(inp.moshGate, 0), -1, 1))
    gl.uniform1f(p.u('uRepel'), clampf(num(inp.edgeRepel, 0), -1, 1))
    gl.uniform1f(p.u('uResharp'), clampf(num(inp.resharp, 0), 0, 1))
    gl.uniform1f(p.u('uSeed'), this.frame % 1024)
    drawFull(gl, write.fbo, W, H)

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
    if (this.actBuf) { for (const b of this.actBuf) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.actBuf = null }
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
  private wobblePhase = Math.random() * 6.2832 // the hand-wave's phase : a new one every pass
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
    // Each new pass (a wrap or a restart) waves by a different hand : step the
    // wobble phase by the golden angle, so passes never repeat.
    if (restart || wrapped) this.wobblePhase = (this.wobblePhase + 2.39996) % 6.2832
    const axis = Math.round(num(inp.axis, 0))

    // Pass 1 : capture the band / hold the rest → write buffer (no scan bar).
    let p = g.use(g.scan)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, read.tex); gl.uniform1i(p.u('uPrev'), 1)
    const audio = ctx.audioTex ? clampf(num(inp.audio, 0), 0, 1) : 0
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ctx.audioTex ?? ctx.host); gl.uniform1i(p.u('uAudioTex'), 2)
    gl.uniform1f(p.u('uAudio'), audio)
    gl.uniform1f(p.u('uPhase'), this.wobblePhase)
    gl.uniform1f(p.u('uPx'), Math.max(1, Math.floor(H / 1080 + 0.5)))
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
  // The live (incoming) layout.
  private cellArr = new Float32Array(AC_MAX * 4)
  private mapArr = new Float32Array(AC_MAX * 4)
  private rotArr = new Float32Array(AC_MAX)
  private rankArr = new Float32Array(AC_MAX)
  // Each piece's two rotation draws, kept so ROTATE can be modulated without a
  // rebuild : the random stream (and so the mask order and the survivor) never
  // depends on the rotate dial.
  private rotPick = new Float32Array(AC_MAX)
  private rotTurn = new Float32Array(AC_MAX)
  private tmp: RGBA | null = null // premultiplied crossfade target (lazy)
  private tmpW = 0
  private tmpH = 0
  private count = 0
  private seed = 0x1a2b3c4d
  // The outgoing layout, kept only while an auto/trig recut is crossfading.
  private oldCell = new Float32Array(AC_MAX * 4)
  private oldMap = new Float32Array(AC_MAX * 4)
  private oldRot = new Float32Array(AC_MAX)
  private oldRank = new Float32Array(AC_MAX)
  private oldCount = 0
  private oldSeed = 0
  private oldShape = 0
  // Crossfade progress 0..1 (1 = done, single-pass). Advanced by dt/xfadeDur.
  private xfade = 1
  private prevTrig = 0
  private timer = 0
  private lastCuts = -1
  private lastRotate = -1
  private lastShape = -1
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private rebuild(cuts: number, rotateFrac: number, shape: number): void {
    const rnd = mulberry32(this.seed)
    if (shape === 1) {
      this.rebuildMosaic(cuts, rnd)
    } else {
      this.rebuildRects(cuts, rnd)
    }
    this.assignMaskAndSurvivor(this.count, rnd)
    this.applyRotate(rotateFrac)
    this.lastCuts = cuts; this.lastShape = shape
  }

  // Which pieces turn, and by how much, from the stored draws.
  private applyRotate(rotateFrac: number): void {
    for (let i = 0; i < this.count; i++)
      this.rotArr[i] = this.rotPick[i] < rotateFrac ? 1 + Math.floor(this.rotTurn[i] * 3) : 0
    this.lastRotate = rotateFrac
  }

  // Cut-up : recursive binary space partition into rectangles (the original).
  private rebuildRects(cuts: number, rnd: () => number): void {
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
      const d = cells[i], sIdx = perm[i], src = cells[sIdx]
      this.cellArr[i * 4] = d.x; this.cellArr[i * 4 + 1] = d.y; this.cellArr[i * 4 + 2] = d.w; this.cellArr[i * 4 + 3] = d.h
      this.mapArr[i * 4] = src.x; this.mapArr[i * 4 + 1] = src.y; this.mapArr[i * 4 + 2] = src.w; this.mapArr[i * 4 + 3] = src.h
      this.rotPick[i] = rnd(); this.rotTurn[i] = rnd() // always two draws per piece
    }
    this.count = n
  }

  // Mosaic : a jittered grid of Voronoi seeds. Each pixel belongs to its nearest
  // seed, so the pieces are irregular convex polygons (a real mosaic). Every
  // cell samples the neighborhood of a SHUFFLED seed, so the picture is
  // scrambled the way the rectangles are. The unconditional rng draws keep a
  // seed replaying identically whichever branch runs.
  private rebuildMosaic(cuts: number, rnd: () => number): void {
    const n = Math.min(cuts, AC_MAX)
    const cols = Math.max(1, Math.round(Math.sqrt(n)))
    const rows = Math.max(1, Math.ceil(n / cols))
    const seeds: Array<[number, number]> = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (seeds.length >= n) { rnd(); rnd(); continue }
        const jx = (c + 0.15 + rnd() * 0.7) / cols
        const jy = (r + 0.15 + rnd() * 0.7) / rows
        seeds.push([jx, jy])
      }
    }
    const m = seeds.length
    const perm = seeds.map((_, i) => i)
    for (let i = m - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp }
    for (let i = 0; i < m; i++) {
      const s0 = seeds[i], src = seeds[perm[i]]
      this.cellArr[i * 4] = s0[0]; this.cellArr[i * 4 + 1] = s0[1]; this.cellArr[i * 4 + 2] = 0; this.cellArr[i * 4 + 3] = 0
      this.mapArr[i * 4] = src[0]; this.mapArr[i * 4 + 1] = src[1]; this.mapArr[i * 4 + 2] = 0; this.mapArr[i * 4 + 3] = 0
      this.rotPick[i] = rnd(); this.rotTurn[i] = rnd() // always two draws per piece
    }
    this.count = m
  }

  // MASK dropout order : a shuffled EVEN spacing over (0,0.90], so the dial
  // removes pieces at a steady rate instead of in random clumps. The ceiling
  // sits BELOW the shader's 0.06 fade band under mask=1. One seeded SURVIVOR
  // gets rank 2 (unreachable by a 0..1 mask), so full mask always leaves exactly
  // one piece and every re-cut elects a new one.
  private assignMaskAndSurvivor(n: number, rnd: () => number): void {
    const order: number[] = []
    for (let i = 0; i < n; i++) order.push(i)
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = order[i]; order[i] = order[j]; order[j] = tmp }
    const survivor = Math.floor(rnd() * Math.max(1, n))
    for (let i = 0; i < n; i++) this.rankArr[order[i]] = ((i + 1) / n) * 0.90
    this.rankArr[survivor] = 2.0
  }

  // Snapshot the live layout as the outgoing one and start a crossfade.
  private beginCrossfade(shape: number): void {
    this.oldCell.set(this.cellArr); this.oldMap.set(this.mapArr)
    this.oldRot.set(this.rotArr); this.oldRank.set(this.rankArr)
    this.oldCount = this.count; this.oldSeed = this.seed; this.oldShape = shape
    this.xfade = 0
  }

  // Upload one layout + the shared scalar params, and draw a fade-scaled pass.
  private drawLayout(
    ctx: NodeContext, p: Prog, fbo: WebGLFramebuffer,
    cell: Float32Array, map: Float32Array, rot: Float32Array, rank: Float32Array,
    count: number, seed: number, shape: number, fade: number, premul: boolean
  ): void {
    const gl = ctx.gl, inp = ctx.inputs
    const W = ctx.chain.w, H = ctx.chain.h
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.uniform1i(p.u('uCount'), count)
    gl.uniform1i(p.u('uShape'), shape)
    // The (data, offset, length) overload : no per-frame subarray views.
    const n = Math.max(1, count)
    gl.uniform4fv(p.u('uCell'), cell, 0, n * 4)
    gl.uniform4fv(p.u('uMap'), map, 0, n * 4)
    gl.uniform1fv(p.u('uRot'), rot, 0, n)
    gl.uniform1fv(p.u('uRank'), rank, 0, n)
    gl.uniform1f(p.u('uAspect'), W / Math.max(1, H))
    gl.uniform1f(p.u('uPx'), 1 / Math.max(1, H))
    gl.uniform1f(p.u('uPremul'), premul ? 1 : 0)
    gl.uniform1f(p.u('uGap'), clampf(num(inp.gap, 0.15), 0, 1))
    gl.uniform1f(p.u('uSlip'), clampf(num(inp.slip, 0), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.uniform1f(p.u('uContour'), clampf(num(inp.contour, 0), 0, 2))
    gl.uniform1f(p.u('uTorn'), clampf(num(inp.torn, 0), 0, 2))
    gl.uniform1f(p.u('uMask'), clampf(num(inp.mask, 0), 0, 1))
    gl.uniform1f(p.u('uCurve'), clampf(num(inp.curve, 0.3), 0, 1))
    gl.uniform1f(p.u('uFade'), fade)
    gl.uniform1f(p.u('uSeed'), seed % 1024)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const inp = ctx.inputs

    const cuts = Math.round(clampf(num(inp.cuts, 20), 2, AC_MAX))
    const rotate = clampf(num(inp.rotate, 0.3), 0, 1)
    const shape = Math.round(clampf(num(inp.shape, 0), 0, 1))
    const trig = num(inp.trig, 0)
    const recut = trig >= 0.5 && this.prevTrig < 0.5
    this.prevTrig = trig
    const autoRate = clampf(num(inp.rate, 0), 0, 8)
    // A crossfade longer than the recut period would be cut short by the next
    // recut (the outgoing layout popped out) : keep it inside 0.9 of the period.
    const xfadeDur = Math.min(clampf(num(inp.xfade, 0), 0, 4), autoRate > 0 ? 0.9 / autoRate : 4)

    // A reseed recut (auto clock or the trigger) starts a crossfade from the
    // outgoing layout when xfade time is set; a structural param edit
    // (cuts / shape) rebuilds in place and snaps; ROTATE only re-picks turns.
    let didReseedRecut = false
    if (autoRate > 0) {
      this.timer += ctx.dt
      if (this.timer >= 1 / autoRate) { this.timer = Math.min(this.timer - 1 / autoRate, 1 / autoRate); didReseedRecut = true }
    }
    if (recut) didReseedRecut = true

    if (didReseedRecut) {
      // Snapshot BEFORE the rebuild, with the shape those arrays were built
      // under, so a shape change on the same frame can't draw the outgoing
      // layout with the wrong geometry.
      if (xfadeDur > 0 && this.count > 0) this.beginCrossfade(this.lastShape < 0 ? shape : this.lastShape)
      else { this.xfade = 1; this.oldCount = 0 }
      this.reseed(); this.rebuild(cuts, rotate, shape)
    } else if (this.count === 0 || cuts !== this.lastCuts || shape !== this.lastShape) {
      this.xfade = 1; this.oldCount = 0
      this.rebuild(cuts, rotate, shape)
    } else if (rotate !== this.lastRotate) {
      this.applyRotate(rotate)
    }

    if (this.xfade < 1) {
      // A live crossfade always runs to completion : if the time is pulled to 0
      // mid-fade, snap to done and drop the outgoing layout rather than freezing
      // it (else raising the time later would resurrect a layout retired ago).
      if (xfadeDur > 0) this.xfade = Math.min(1, this.xfade + ctx.dt / xfadeDur)
      else this.xfade = 1
      if (this.xfade >= 1) this.oldCount = 0
    }

    const p = g.use(num(inp.torn, 0) > 0.001 ? g.autocutTorn : g.autocut)
    const out = ctx.chain.next()
    if (this.xfade >= 1 || this.oldCount === 0) {
      // Single pass, straight alpha : identical cost to before the crossfade existed.
      gl.disable(gl.BLEND)
      this.drawLayout(ctx, p, out.fbo, this.cellArr, this.mapArr, this.rotArr, this.rankArr, this.count, this.seed, shape, 1, false)
    } else {
      // Crossfade : old * (1-t) written flat, new * t added on top, both
      // PREMULTIPLIED into a scratch target (so two transparent-holed layouts add
      // correctly), then one pass back to straight alpha for the chain. The old
      // layout draws with ITS OWN shape (finding: a mid-frame shape flip).
      const W = ctx.chain.w, H = ctx.chain.h
      if (!this.tmp || this.tmpW !== W || this.tmpH !== H) {
        if (this.tmp) { gl.deleteTexture(this.tmp.tex); gl.deleteFramebuffer(this.tmp.fbo) }
        this.tmp = makeRGBA(gl, W, H, true); this.tmpW = W; this.tmpH = H
        g.use(p) // makeRGBA left its own bindings; the autocut program stays current
      }
      gl.disable(gl.BLEND)
      this.drawLayout(ctx, p, this.tmp.fbo, this.oldCell, this.oldMap, this.oldRot, this.oldRank, this.oldCount, this.oldSeed, this.oldShape, 1 - this.xfade, true)
      // finally : this is the only pass that enables blending, and every other
      // pass assumes it's OFF. If the add-on-top draw threw, the per-layer
      // try/catch in Compositor.render would swallow it while leaving GL_BLEND
      // on, blowing out the rest of the frame's blend stack. Always turn it off.
      try {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE)
        this.drawLayout(ctx, p, this.tmp.fbo, this.cellArr, this.mapArr, this.rotArr, this.rankArr, this.count, this.seed, shape, this.xfade, true)
      } finally {
        gl.disable(gl.BLEND)
      }
      const u = g.use(g.unpremul)
      bindUnit(gl, 0, this.tmp.tex); gl.uniform1i(u.u('uTex'), 0)
      drawFull(gl, out.fbo, W, H)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  private reseed(): void { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0 }
  dispose(): void {
    this.disposed = true
    if (this.tmp) { this.gl.deleteTexture(this.tmp.tex); this.gl.deleteFramebuffer(this.tmp.fbo); this.tmp = null }
  }
}

// ── Chronoscan : per-pixel time displacement / slit-scan ─────────────────
// A ring-atlas of the last CH_N frames (quarter-res tiles). A control field sets a
// per-pixel age into that history, so each region shows a different past frame :
// slit-scan (gradient control), luminance-driven time-warp (self/sidechain), or a
// moving-slit sweep. Reuses the ring-atlas machinery of Réponse/Feedback. Any rack.
// The ring is written every STRIDE × 1/60 s of the rack clock, so its reach is the
// same time at any frame rate (and seconds long at a wide stride).
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
  private lastFrame = -1
  private clock = { t: 0 }
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
    // Re-enabled : forget the old history (no replay of frames from when it was off).
    if (resumed(this.lastFrame, ctx)) { this.writeHead = 0; this.filled = 0 }
    this.lastFrame = ctx.frame ?? 0
    // The sweep phase runs over [0, 2) : a period of the ping-pong fold (and two of the saw).
    this.sweep = (this.sweep + ctx.dt * clampf(num(inp.sweep, 0.15), 0, 1) * 0.5) % 2

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
    gl.uniform1i(p.u('uPingPong'), Math.round(num(inp.sweepMode, 0)) === 1 ? 1 : 0)
    gl.uniform1f(p.u('uReach'), clampf(num(inp.reach, 0.6), 0, 1))
    gl.uniform1f(p.u('uAngle'), num(inp.angle, 0))
    gl.uniform1f(p.u('uAspect'), W / Math.max(1, H))
    gl.uniform1f(p.u('uSweep'), this.sweep)
    gl.uniform1f(p.u('uCurve'), clampf(num(inp.curve, 1), 0.2, 3))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    drawFull(gl, out.fbo, W, H)

    // 2) Store the current frame into the ring (quarter-res tile), every STRIDE.
    if (strideDue(this.clock, ctx.dt, Math.round(num(inp.stride, 1)), this.filled === 0)) {
      const cp = g.use(g.copy)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, ring.fbo)
      const col = this.writeHead % CH_COLS, row = Math.floor(this.writeHead / CH_COLS)
      gl.viewport(col * this.tw, row * this.th, this.tw, this.th)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      this.writeHead = (this.writeHead + 1) % CH_N
      this.filled = Math.min(CH_N, this.filled + 1)
    }

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
// `stir` drifts it so it sediments rather than loops; `snap` marks a keyframe now.
// Earns the app's name. Any rack. The memory is kept through a re-enable : it is
// the point of the node.
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
  private decAcc = 0 // rack seconds since the last decay step
  private prevSnap = 0
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
    // Wrapped at 200π s : a whole period of both stir sines (0.11 and 0.09 rad/s).
    this.time = (this.time + ctx.dt) % (200 * Math.PI)

    // Seed the accumulator with the live frame so memory doesn't start black.
    if (!this.seeded) {
      const cp = g.use(g.copy)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
      for (const b of acc) { gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3) }
      this.seeded = true
    }

    const read = acc[this.accCur], write = acc[1 - this.accCur]
    // 1) Accumulator : decaying peak memory. `tau` is a time constant (the memory
    //    falls to 37% over it), 0.5 s → 300 s. At long taus the per-frame factor
    //    exp(-dt/tau) is closer to 1 than half float can hold, so the decay froze
    //    into a permanent peak-hold : bank the rack time and apply it in steps of
    //    at least 0.2% (still invisible), frame-rate independent by construction.
    const decayP = clampf(num(inp.decay, 0.6), 0, 1)
    const tau = 0.5 + decayP * decayP * 299.5
    this.decAcc += ctx.dt
    let k = 1
    if (this.decAcc / tau >= 2e-3) { k = Math.exp(-this.decAcc / tau); this.decAcc = 0 }
    let p = g.use(g.sedAcc)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, read.tex); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform1f(p.u('uDecay'), k)
    gl.uniform1f(p.u('uDeposit'), clampf(num(inp.deposit, 0.5), 0, 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    // 2) Keyframe capture every `interval` seconds → the sparse long ring, or now
    //    on the SNAP event's rising edge (a performer marks a moment to resurface).
    this.kfTimer += ctx.dt
    const interval = clampf(num(inp.interval, 4), 0.5, 30)
    const snapV = num(inp.snap, 0)
    const snap = snapV >= 0.5 && this.prevSnap < 0.5
    this.prevSnap = snapV
    if (this.kfTimer >= interval || snap) {
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
// exact : an ISF FX with a second image input fought the rack's inputImage bind
// (dry-wet + colors broke). Works on layer AND master racks (both are given a
// node context carrying `depth`). Depth off (ctx.depth null) = clean passthrough.
export class ParallaxNode implements ConvNode {
  private swayPh = 0 // ∫ swayRate dt : the sway speed can move without a jump
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const inp = ctx.inputs
    // Exact passthrough without even a draw : no depth map, or fully dry.
    if (!ctx.depth || clampf(num(inp.wet, 1), 0, 1) < 0.001) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.swayPh += ctx.dt * clampf(num(inp.swayRate, 1), 0, 4)
    const sway = clampf(num(inp.sway, 0.3), 0, 1)
    const out = ctx.chain.next()
    const p = g.use(g.parallax)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ctx.depth ?? ctx.host); gl.uniform1i(p.u('uDepth'), 1)
    gl.uniform1i(p.u('uHasDepth'), ctx.depth ? 1 : 0)
    gl.uniform1f(p.u('uAmount'), clampf(num(inp.amount, 0.4), 0, 1))
    gl.uniform1f(p.u('uAngle'), num(inp.angle, 0))
    gl.uniform2f(p.u('uSwayV'), Math.sin(this.swayPh * 0.5) * sway, Math.cos(this.swayPh * 0.37) * sway)
    gl.uniform1f(p.u('uAspect'), W / Math.max(1, H))
    gl.uniform1i(p.u('uDofShape'), Math.round(num(inp.dofShape, 0)) === 1 ? 1 : 0)
    gl.uniform1f(p.u('uDof'), clampf(num(inp.dof, 0), 0, 1))
    gl.uniform1f(p.u('uFocus'), clampf(num(inp.focus, 0.5), 0, 1))
    gl.uniform1f(p.u('uFog'), clampf(num(inp.fog, 0), 0, 1))
    gl.uniform1f(p.u('uWet'), clampf(num(inp.wet, 1), 0, 1))
    gl.uniform1i(p.u('uInvert'), num(inp.invert, 0) >= 0.5 ? 1 : 0)
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
  private shutterPh = 0 // ∫ rate dt (turns) : RATE can move without a jump
  private beatPh = 0 // ∫ (0.2 + 1.5·detune) dt (radians)
  private lastFrame = -1
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
    const freeze = num(inp.freeze, 0) >= 0.5
    // Re-enabled : restart the history (no replay of frames from when it was off),
    // unless FREEZE is holding a pair on purpose.
    if (resumed(this.lastFrame, ctx) && !freeze) { this.writeHead = 0; this.filled = 0 }
    this.lastFrame = ctx.frame ?? 0

    // Integrated phases : modulating RATE or DETUNE bends the speed, never jumps.
    const det = clampf(num(inp.detune, 0.12), 0, 1)
    this.shutterPh = (this.shutterPh + ctx.dt * clampf(num(inp.rate, 6), 0.5, 20)) % 1
    this.beatPh = (this.beatPh + ctx.dt * (0.2 + det * 1.5)) % (2 * Math.PI)

    const mode = Math.round(num(inp.mode, 0))
    // Taps never reach past what the ring holds (unwritten tiles are black).
    const maxBack = Math.max(1, this.filled - 1)
    const gap = Math.min(clampf(Math.round(num(inp.gap, 4)), 1, ET_N - 2), maxBack)
    let uGap = gap, uOffB = gap, uPhase = 0
    if (mode === 0) {
      uPhase = this.shutterPh
    } else {
      const beat = 0.5 + 0.5 * Math.sin(this.beatPh)
      uOffB = Math.min(ET_N - 2, maxBack, gap + beat * det * (ET_N - 2))
    }
    // The twin is a touch larger while the copies drift apart, exactly 1 at lock.
    const twinScale = 1 - 0.015 * clampf(Math.abs(uOffB - uGap), 0, 1)

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
    gl.uniform1f(p.u('uTwinScale'), twinScale)
    gl.uniform1f(p.u('uInterval'), clampf(num(inp.interval, 0.3), 0, 1))
    gl.uniform1f(p.u('uTint'), clampf(num(inp.tint, 0.3), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    // Store the current frame into the ring (half-res tile), unless FREEZE holds
    // the pair (the true eternalism : the same slice of time, going nowhere, for good).
    if (!freeze || this.filled < 2) {
      const cp = g.use(g.copy)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(cp.u('uTex'), 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, ring.fbo)
      const col = this.writeHead % ET_COLS, row = Math.floor(this.writeHead / ET_COLS)
      gl.viewport(col * this.tw, row * this.th, this.tw, this.th)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      this.writeHead = (this.writeHead + 1) % ET_N
      this.filled = Math.min(ET_N, this.filled + 1)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo); this.ring = null }
  }
}

// ── Second-half node helpers ─────────────────────────────────────────────
// Extra programs live outside NodeGL, built lazily and cached per NodeGL instance
// (a GPU-reset rebuild of NodeGL gets fresh ones), on the same compile/link path.
const extraProgs = new WeakMap<NodeGL, Map<string, Prog>>()
function extraProg(g: NodeGL, key: string, fs: string): Prog {
  let m = extraProgs.get(g)
  if (!m) { m = new Map(); extraProgs.set(g, m) }
  let p = m.get(key)
  if (!p) {
    const gl = g.gl
    const sh = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[convNode] shader compile:', gl.getShaderInfoLog(s))
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error('[convNode] link:', gl.getProgramInfoLog(prog))
    const cache = new Map<string, WebGLUniformLocation | null>()
    p = { prog, u: (n) => { if (!cache.has(n)) cache.set(n, gl.getUniformLocation(prog, n)); return cache.get(n)! } }
    m.set(key, p)
  }
  return p
}
/** Copy `src` into `fbo` (a viewport rect), alpha kept. */
function copyA(gl: WebGL2RenderingContext, g: NodeGL, src: WebGLTexture, fbo: WebGLFramebuffer, x: number, y: number, w: number, h: number): void {
  const p = g.use(extraProg(g, 'copyA', F_COPY_A))
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(p.u('uTex'), 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(x, y, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3)
}
/** True when a temporal node was just (re)enabled : the engine frame counter
 *  jumped since its last render (or this is its first). */
function frameGap(last: number, ctx: NodeContext): boolean {
  return ctx.frame !== undefined && last >= 0 && ctx.frame !== last + 1
}
/** Seconds per beat division from the transport (1 = a quarter note). */
const beatPeriod = (bpm: number | undefined, div: number): number =>
  60 / Math.max(20, Math.min(300, bpm && bpm > 0 ? bpm : 120)) / div
const SYNC_DIV = [0, 1, 2, 4] // sync : free · 1/4 · 1/8 · 1/16

// ── Afterimage node : Goethe's complementary-negative persistence ────────
export class AfterimageNode implements ConvNode {
  private acc: [RGBA, RGBA] | null = null
  private w = 0
  private h = 0
  private accCur = 0
  private seeded = false
  private lastFrame = -1
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

    // Start (and restart after a bypass) from an empty memory : the first acc pass
    // then holds exactly the live frame (leave = 0), with the adaptation uncharged.
    if (!this.seeded || frameGap(this.lastFrame, ctx)) {
      gl.clearColor(0, 0, 0, 0)
      for (const b of acc) { gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo); gl.viewport(0, 0, W, H); gl.clear(gl.COLOR_BUFFER_BIT) }
      this.seeded = true
    }
    this.lastFrame = ctx.frame ?? -1

    const read = acc[this.accCur], write = acc[1 - this.accCur]
    // 1) decaying brightness high-water (persistence of the departed light) and
    //    the adaptation that DWELL slows down.
    const decayP = clampf(num(inp.decay, 0.6), 0, 1)
    const tau = 0.3 + decayP * decayP * 8 // 0.3s → ~8s afterimage
    const dwell = clampf(num(inp.dwell, 0), 0, 1)
    const tauIn = dwell * dwell * 6 // 0 = instant (the classic look) → 6 s to adapt fully
    let p = g.use(g.afterAcc)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, read.tex); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform1f(p.u('uDecay'), Math.exp(-ctx.dt / tau))
    gl.uniform1f(p.u('uCharge'), tauIn < 1e-3 ? 1 : 1 - Math.exp(-ctx.dt / tauIn))
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    // 2) present : the complementary ghost where a bright form has left.
    const out = ctx.chain.next()
    p = g.use(g.afterOut)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, write.tex); gl.uniform1i(p.u('uAcc'), 1)
    gl.uniform1f(p.u('uAmount'), clampf(num(inp.amount, 0.5), 0, 1))
    gl.uniform1f(p.u('uChroma'), clampf(num(inp.chroma, 0.6), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.uniform1f(p.u('uDwell'), dwell)
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

// ── Melt node : seam-local edge dissolve that creeps ────────────────────
// One ping-pong RGBA16F buffer holds the previous output; the melt pass reads it
// + the live host, and writes the melted frame back : which IS next frame's prev,
// so the melt self-feeds and walks. Returns the written buffer directly (same
// safe pattern as Datamosh : it's only re-read next frame, after the flip), or a
// MIX pass over the live frame when mix < 1. Sizes are in 1080p pixels and the
// creep in pixels per second, so it looks the same at any size and frame rate.
export class MeltNode implements ConvNode {
  private acc: [RGBA, RGBA] | null = null
  private w = 0
  private h = 0
  private cur = 0
  private seeded = false
  private lastFrame = -1
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    if (this.acc && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.acc) for (const b of this.acc) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
    this.acc = [makeRGBA(gl, w, h, true), makeRGBA(gl, w, h, true)]
    this.w = w; this.h = h; this.cur = 0; this.seeded = false
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)
    const inp = ctx.inputs
    const acc = this.acc as [RGBA, RGBA]

    // Seed both buffers with the live frame (alpha kept) so the seam starts from the
    // picture, not black; again after a bypass, so no stale melt flashes back.
    if (!this.seeded || frameGap(this.lastFrame, ctx)) {
      for (const b of acc) copyA(gl, g, ctx.host, b.fbo, 0, 0, W, H)
      this.seeded = true
    }
    this.lastFrame = ctx.frame ?? -1

    const amount = clampf(num(inp.amount, 0.5), 0, 1)
    const width = clampf(num(inp.width, 0.3), 0, 1)
    const dir = clampf(num(inp.dir, 0.3), -1, 1)
    const ref = Math.max(1, H / 1080) // 1080p pixels → this frame's pixels
    // MELT : the seam mix and how long the melted front holds (0.15 s → ~5 s).
    const tau = 0.15 + amount * amount * 5
    // CREEP : pixels per second the front walks (sign = which side bleeds).
    const creep = dir * (14 + width * 120) * ref
    const read = acc[this.cur], write = acc[1 - this.cur]
    const p = g.use(g.melt)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, read.tex); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform2f(p.u('uRes'), W, H)
    gl.uniform1f(p.u('uAmount'), amount)
    gl.uniform1f(p.u('uWidth'), width)
    gl.uniform1f(p.u('uGate'), clampf(num(inp.gate, 0.15), 0, 1))
    gl.uniform1f(p.u('uStep'), ref)
    gl.uniform1f(p.u('uReach'), (6 + width * 90) * ref) // BAND WIDTH : how far from an edge it melts
    gl.uniform1f(p.u('uPush'), creep * ctx.dt)
    gl.uniform1f(p.u('uHold'), Math.exp(-ctx.dt / tau) * Math.min(1, amount * 10))
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.cur = 1 - this.cur

    const mix = clampf(num(inp.mix, 1), 0, 1)
    if (mix >= 0.999) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return write.tex }
    const out = ctx.chain.next()
    const pm = g.use(extraProg(g, 'mixPM', F_MIX_PM))
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(pm.u('uA'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, write.tex); gl.uniform1i(pm.u('uB'), 1)
    gl.uniform1f(pm.u('uMix'), mix)
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.acc) { for (const b of this.acc) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.acc = null }
  }
}

// ── Faultline node : the dirty vision-mixer (structural fault generator) ──
// A clock (RATE) and a probability (DIRT) fire momentary STRUCTURAL faults at the
// output : a dropout, a hard cut to a frozen frame, a timebase knock, or a band of
// switching noise, and the picture is COMPLETELY CLEAN between firings (the SLIP
// law, moved from per-parameter to the blend stage). One discrete fault per fire.
// Bands and static are counted in 1080-line units (the same grain at any size),
// hashed on whole-number cells (never quantizes or stripes).
const F_FAULTLINE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uFreeze;
uniform float uAspect;
uniform int uType;        // 0 dropout · 1 cut (freeze) · 2 timebase knock · 3 switching noise
uniform float uDepth;     // fault severity 0..1
uniform float uProgress;  // 0..1 through the fault's life
uniform float uSeed;      // per-fire random, so every fault lands differently
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec4 host = texture(uHost, vUV);
  vec3 col = host.rgb; float a = host.a;
  vec2 cell = floor(vec2(vUV.x * uAspect, vUV.y) * 1080.0);   // one static grain per 1080p pixel
  float fs = floor(uSeed * 997.0);
  if (uType == 0){
    // DROPOUT : the signal cuts out in horizontal STREAKS that sweep the frame, a
    // lost-lock outage, not a global dim. A few bands collapse toward black (with a
    // little snow); the rest of the picture stays live, so it never just darkens.
    float y = vUV.y * 12.0 - uProgress * 7.0 + uSeed * 23.0;
    float band = smoothstep(0.62, 0.9, h12(vec2(floor(y), floor(uSeed * 17.0))));
    float st = h13(vec3(cell, floor(uProgress * 61.0) + fs));
    col = mix(host.rgb, vec3(st * 0.12), band * uDepth);
  } else if (uType == 1){
    // CUT : the mixer holds the frame captured at the fire instant, a clean hard
    // cut to a still that the live picture snaps back from. Depth eases in a partial
    // hold at very low settings; by mid-depth it is a full freeze.
    vec4 f = texture(uFreeze, vUV);
    float hold = clamp(uDepth * 2.0, 0.0, 1.0);
    col = mix(host.rgb, f.rgb, hold); a = mix(host.a, f.a, hold);
  } else if (uType == 2){
    // TIMEBASE KNOCK : a head-switch jolt : blocks of scanlines shear sideways (the
    // line blanks to black where it slides off the raster) and the field rolls, with
    // a torn noise band along the switch line (frame bottom).
    float band = floor(vUV.y * 180.0);
    float shear = (h12(vec2(band, fs)) - 0.5) * uDepth * 0.25 * (0.4 + 0.6 * uProgress);
    float roll = uDepth * 0.12 * uProgress;
    vec2 sp = vec2(vUV.x + shear, fract(vUV.y + roll));
    vec4 s = (sp.x < 0.0 || sp.x > 1.0) ? vec4(0.0, 0.0, 0.0, host.a) : texture(uHost, sp);
    float sw = 1.0 - smoothstep(0.0, 0.10, vUV.y);
    float st = h13(vec3(cell.x, band, floor(uProgress * 53.0) + fs));
    col = mix(s.rgb, vec3(st), sw * uDepth); a = s.a;
  } else {
    // SWITCHING NOISE : a band of static sweeps the frame at the cut point.
    float c = fract(uSeed + uProgress * 0.7);
    float band = 1.0 - smoothstep(0.0, 0.18, abs(vUV.y - c));
    float st = h13(vec3(cell, floor(uProgress * 97.0) + fs));
    col = mix(host.rgb, vec3(st), band * uDepth);
  }
  o = vec4(col, a);
}`

export class FaultlineNode implements ConvNode {
  private freeze: RGBA | null = null
  private w = 0
  private h = 0
  private timer = 0
  private prevTrig = 0
  private faultRemaining = 0
  private faultDur = 0
  private faultType = 0
  private faultSeed = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    if (this.freeze && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.freeze) { gl.deleteTexture(this.freeze.tex); gl.deleteFramebuffer(this.freeze.fbo) }
    this.freeze = makeRGBA(gl, w, h, true)
    this.w = w; this.h = h
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const inp = ctx.inputs
    const rate = clampf(num(inp.rate, 2), 0, 12)
    const dirt = clampf(num(inp.dirt, 0.6), 0, 1)
    const type = Math.round(clampf(num(inp.type, 4), 0, 4))
    const depth = clampf(num(inp.depth, 0.6), 0, 1)
    const hold = clampf(num(inp.hold, 0.08), 0.02, 0.5)
    const trig = num(inp.trig, 0)
    const sync = SYNC_DIV[Math.round(clampf(num(inp.sync, 0), 0, 3))]

    // FIRING (the SLIP law) : the trigger's rising edge, plus a clock whose every
    // tick is a fire OPPORTUNITY that `dirt` accepts with probability : so it skips,
    // never metronomic. The clock runs at RATE, or at a beat division of the tempo
    // (SYNC). A fire (re)starts one discrete fault; catch-up is capped so a stalled
    // frame can't unload a burst.
    let fire = trig >= 0.5 && this.prevTrig < 0.5
    this.prevTrig = trig
    if (sync > 0 || rate > 0.001) {
      const period = sync > 0 ? beatPeriod(ctx.bpm, sync) : 1 / rate
      this.timer += ctx.dt
      let guard = 0
      while (this.timer >= period && guard++ < 8) {
        this.timer -= period
        if (Math.random() < dirt) fire = true
      }
    } else {
      this.timer = 0
    }
    if (fire) {
      this.faultRemaining = hold
      this.faultDur = hold
      this.faultType = type === 4 ? Math.floor(Math.random() * 4) : type
      this.faultSeed = Math.random()
    }

    // CLEAN between firings : no active fault ⇒ byte-identical passthrough (zero cost).
    if (this.faultRemaining <= 0) return ctx.host

    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)

    // A CUT holds the frame grabbed at the fire instant (alpha kept : a cut on a
    // transparent layer holds its shapes, not a black card).
    if (fire && this.faultType === 1) copyA(gl, g, ctx.host, this.freeze!.fbo, 0, 0, W, H)

    const progress = this.faultDur > 0 ? 1 - this.faultRemaining / this.faultDur : 0
    this.faultRemaining -= ctx.dt

    const out = ctx.chain.next()
    const p = g.use(g.faultline)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, (this.freeze as RGBA).tex); gl.uniform1i(p.u('uFreeze'), 1)
    gl.uniform1f(p.u('uAspect'), W / H)
    gl.uniform1i(p.u('uType'), this.faultType)
    gl.uniform1f(p.u('uDepth'), depth)
    gl.uniform1f(p.u('uProgress'), progress)
    gl.uniform1f(p.u('uSeed'), this.faultSeed)
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.freeze) { gl.deleteTexture(this.freeze.tex); gl.deleteFramebuffer(this.freeze.fbo); this.freeze = null }
  }
}

// ── Sillage node : IBFV advected-noise feedback (van Wijk, SIGGRAPH 2002) ──
// Image-Based Flow Visualization : a dye accumulator is advected each frame by a
// FLOW field, then blended with a fresh filtered-noise pattern. The advection
// stretches the noise into flow-aligned filaments (an LIC-like line-integral look),
// and the blend makes it DECAY INTO STRUCTURE instead of blowing to neon : a wake of
// dye trailing the motion. The field is a divergence-free CURL-noise base (always
// flowing, so even a still image streams) plus the host's own OPTICAL FLOW (its
// motion advects the dye). DYE tints the noise by the image so it reads as the
// picture's own material in the wake. Self-contained : runs on any rack.
// Everything is measured in an aspect-true frame (height = 1080 px at any size) and
// per second; the injected noise pulses IN PLACE (each lattice cell on its own
// phase, van Wijk's time-periodic noise), and SCAN brings back a sideways drift of
// the grain (1 = a cell per 60 Hz frame : horizontal tape-like streaks).
const IBFV_RES = 256
const F_IBFV = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uPrev, uFlow;
uniform float uAspect;
uniform float uFlowAmt;   // advection distance (1080p px this frame)
uniform float uInject;    // noise injection / decay (this frame)
uniform float uScale;     // injected-noise cells per frame height
uniform float uField;     // synthetic curl-flow strength
uniform float uMotion;    // host optical-flow strength
uniform float uDye;       // 0 = gray noise, 1 = tinted by the image
uniform float uAngle;     // 0..1 → 0..2π : direction of the wind
uniform float uPush;      // steerable directional wind strength
uniform float uSwirl;     // 0..1 (0.5 = none) : spiral rotation about the swirl center
uniform vec2 uSwirlC;     // the swirl center (uv)
uniform vec2 uOrbit;      // the curl base's slow orbit (bounded, computed on the CPU)
uniform float uPhase;     // per-cell pulse phase (wrapped 0..1 on the CPU)
uniform float uScan;      // sideways drift of the grain, in cells (wrapped)
uniform float uGround;    // 0 = noise everywhere, 1 = only where the picture is lit
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y);
}
float cellv(vec2 i){ return 0.5 + 0.5 * sin(6.2831853 * (h12(i) + uPhase)); }
float pnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cellv(i), cellv(i + vec2(1, 0)), f.x), mix(cellv(i + vec2(0, 1)), cellv(i + vec2(1, 1)), f.x), f.y);
}
// Curl of a scalar noise potential → a smooth, divergence-free (swirling) flow.
vec2 curl(vec2 p){
  float e = 0.05;
  float x1 = vnoise(p + vec2(e, 0.0)), x0 = vnoise(p - vec2(e, 0.0));
  float y1 = vnoise(p + vec2(0.0, e)), y0 = vnoise(p - vec2(0.0, e));
  return vec2(y1 - y0, x0 - x1) / e * 0.5;
}
void main(){
  vec2 iso = vec2(vUV.x * uAspect, vUV.y);
  // combined flow (1080p px). The curl base BREATHES (an orbiting sample) instead of
  // scrolling, so it has no built-in direction; a steerable WIND (angle+push) and a
  // SPIRAL (rotation about the swirl center) then let the wake go anywhere.
  vec2 syn = curl(iso * 2.5 + uOrbit * 0.6) * uField;
  vec2 opt = texture(uFlow, vUV).rg * vec2(uAspect, 1.0) * uMotion * 4.0; // the image's own motion
  float ang = uAngle * 6.2831853;
  vec2 wind = vec2(cos(ang), sin(ang)) * uPush;
  vec2 rc = (vUV - uSwirlC) * vec2(uAspect, 1.0);
  vec2 spin = vec2(-rc.y, rc.x) * (uSwirl - 0.5) * 4.0;
  vec2 flow = (syn + opt + wind + spin) * uFlowAmt;
  vec4 h = texture(uHost, vUV);
  // fresh filtered noise, pulsing in place so injected material scintillates and
  // the filaments keep moving; sparsened so it reads as strands, not flat gray
  float n = pnoise(iso * uScale + vec2(uScan, 0.0));
  n = smoothstep(0.35, 0.66, n);
  float lit = mix(1.0, smoothstep(0.02, 0.35, dot(h.rgb * h.a, vec3(0.299, 0.587, 0.114))), uGround);
  vec4 injected = vec4(mix(vec3(n), h.rgb * (0.4 + 0.6 * n), uDye) * lit, h.a);
  // advect : sample the accumulator UPSTREAM along the flow; upstream of the frame
  // edge the average dye flows in (never the border row dragged across, nor raw
  // full-contrast noise)
  vec2 q = vUV - flow / vec2(1080.0 * uAspect, 1080.0);
  bool inside = q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0;
  vec4 inflow = vec4(mix(vec3(0.5), h.rgb * 0.7, uDye) * lit, h.a);
  vec4 adv = inside ? texture(uPrev, q) : inflow;
  o = clamp(mix(adv, injected, uInject), 0.0, 1.0);
}`
const F_IBFV_OUT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uDye; uniform float uMix;
void main(){
  vec4 h = texture(uHost, vUV), d = texture(uDye, vUV);
  // the wake keeps its own coverage : it streams over transparency, and never
  // turns an empty region into a gray card
  float a = mix(h.a, max(h.a, d.a), uMix);
  vec3 c = mix(h.rgb * h.a, d.rgb * d.a, uMix);
  o = vec4(a > 1e-4 ? c / a : vec3(0.0), a);
}`

export class IBFVNode implements ConvNode {
  private lumaA: RG | null = null
  private lumaB: RG | null = null
  private scratch1: RG | null = null
  private scratch2: RG | null = null
  private lumaCurIsA = true
  private acc: [RGBA, RGBA] | null = null
  private cur = 0
  private w = 0
  private h = 0
  private seeded = false
  private ph = Math.random() * 1000 // integrated churn (orbit of the curl base)
  private pulse = 0                  // per-cell noise pulse phase, wrapped 0..1
  private scan = 0                   // sideways grain drift in cells, wrapped
  private prevClear = 0
  private lastFrame = -1
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    const gl = this.gl
    if (!this.lumaA) {
      this.lumaA = makeRG(gl, IBFV_RES); this.lumaB = makeRG(gl, IBFV_RES)
      this.scratch1 = makeRG(gl, IBFV_RES); this.scratch2 = makeRG(gl, IBFV_RES)
    }
    if (this.acc && this.w === w && this.h === h) return
    if (this.acc) for (const b of this.acc) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
    this.acc = [makeRGBA(gl, w, h, true), makeRGBA(gl, w, h, true)]
    this.w = w; this.h = h; this.cur = 0; this.seeded = false
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)
    const inp = ctx.inputs
    const dt = ctx.dt
    const speed = 0.5 + clampf(num(inp.speed, 0.5), 0, 1) * 2
    this.ph += dt * speed
    this.pulse = (this.pulse + dt * speed * 1.2) % 1
    this.scan = (this.scan + dt * 60 * clampf(num(inp.scan, 1), 0, 1)) % 4096
    const acc = this.acc as [RGBA, RGBA]
    const read = acc[this.cur], write = acc[1 - this.cur]
    const n = IBFV_RES
    const lumaCur = (this.lumaCurIsA ? this.lumaA : this.lumaB) as RG
    const lumaPrev = (this.lumaCurIsA ? this.lumaB : this.lumaA) as RG
    const s1 = this.scratch1 as RG, s2 = this.scratch2 as RG

    // Seed the accumulator from the live frame (alpha kept) so it never dissolves out
    // of black, and the flow's previous luma too (no motion jolt on the first frame) :
    // on insert, after a bypass, and on CLEAR ▸.
    const clear = num(inp.clear, 0)
    const cleared = clear >= 0.5 && this.prevClear < 0.5
    this.prevClear = clear
    if (!this.seeded || cleared || frameGap(this.lastFrame, ctx)) {
      for (const b of acc) copyA(gl, g, ctx.host, b.fbo, 0, 0, W, H)
      const pd = g.use(g.downsample); bindTex(gl, 0, ctx.host); gl.uniform1i(pd.u('uTex'), 0); drawTo(gl, lumaPrev.fbo, n, n)
      this.seeded = true
    }
    this.lastFrame = ctx.frame ?? -1

    // 1) host → luma (low res) · 2) optical flow(cur, prev) · 3) blur it smooth.
    let p = g.use(g.downsample); bindTex(gl, 0, ctx.host); gl.uniform1i(p.u('uTex'), 0); drawTo(gl, lumaCur.fbo, n, n)
    p = g.use(g.flow)
    bindTex(gl, 0, lumaCur.tex); bindTex(gl, 1, lumaPrev.tex); gl.uniform1i(p.u('uCur'), 0); gl.uniform1i(p.u('uPrev'), 1)
    gl.uniform2f(p.u('uRes'), n, n); gl.uniform1f(p.u('uLambda'), 0.001); gl.uniform1f(p.u('uClamp'), 0.25)
    drawTo(gl, s1.fbo, n, n)
    p = g.use(g.blur)
    bindTex(gl, 0, s1.tex); gl.uniform1i(p.u('uTex'), 0); gl.uniform1f(p.u('uRadius'), 6)
    gl.uniform2f(p.u('uStep'), 1 / n, 0); drawTo(gl, s2.fbo, n, n)
    bindTex(gl, 0, s2.tex); gl.uniform2f(p.u('uStep'), 0, 1 / n); drawTo(gl, s1.fbo, n, n)

    // 4) advect + inject into the dye accumulator. Flow and injection are per 60 Hz
    //    frame at 1080p, so the wake is the same at any size and frame rate.
    const step60 = dt * 60
    p = g.use(g.ibfv)
    bindTex(gl, 0, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    bindTex(gl, 1, read.tex); gl.uniform1i(p.u('uPrev'), 1)
    bindTex(gl, 2, s1.tex); gl.uniform1i(p.u('uFlow'), 2)
    gl.uniform1f(p.u('uAspect'), W / H)
    gl.uniform1f(p.u('uFlowAmt'), (clampf(num(inp.flow, 0.5), 0, 1) * 30 + 2) * step60)
    gl.uniform1f(p.u('uInject'), 1 - Math.pow(1 - clampf(num(inp.inject, 0.12), 0.02, 0.6), step60))
    gl.uniform1f(p.u('uScale'), clampf(num(inp.scale, 0.4), 0, 1) * 100 + 12)
    gl.uniform1f(p.u('uField'), clampf(num(inp.field, 0.5), 0, 1))
    gl.uniform1f(p.u('uMotion'), clampf(num(inp.motion, 0.6), 0, 1))
    gl.uniform1f(p.u('uDye'), clampf(num(inp.dye, 0.6), 0, 1))
    gl.uniform1f(p.u('uAngle'), clampf(num(inp.angle, 0), 0, 1))
    gl.uniform1f(p.u('uPush'), clampf(num(inp.push, 0), 0, 1))
    gl.uniform1f(p.u('uSwirl'), clampf(num(inp.swirl, 0.5), 0, 1))
    gl.uniform2f(p.u('uSwirlC'), clampf(num(inp.swirlX, 0.5), 0, 1), clampf(num(inp.swirlY, 0.5), 0, 1))
    gl.uniform2f(p.u('uOrbit'), Math.sin(this.ph * 0.11), Math.cos(this.ph * 0.13))
    gl.uniform1f(p.u('uPhase'), this.pulse)
    gl.uniform1f(p.u('uScan'), this.scan)
    gl.uniform1f(p.u('uGround'), clampf(num(inp.ground, 0), 0, 1))
    drawTo(gl, write.fbo, W, H)

    // 5) composite the dye over the live image.
    const out = ctx.chain.next()
    p = g.use(g.ibfvOut)
    bindTex(gl, 0, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    bindTex(gl, 1, write.tex); gl.uniform1i(p.u('uDye'), 1)
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 0.8), 0, 1))
    drawTo(gl, out.fbo, W, H)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.cur = 1 - this.cur
    this.lumaCurIsA = !this.lumaCurIsA
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    for (const t of [this.lumaA, this.lumaB, this.scratch1, this.scratch2]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
    if (this.acc) for (const b of this.acc) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
    this.lumaA = this.lumaB = this.scratch1 = this.scratch2 = null; this.acc = null
  }
}

// ── Toile node : anisotropic Kuwahara + flow-XDoG (painterly + coherent lines) ──
// A structure-tensor-aligned PAINTERLY flatten (anisotropic Kuwahara after
// Kyprianidis et al. 2009 : the image is smoothed into strokes that follow its own
// structure, so forms flatten into paint instead of a uniform blur) with optional
// flow-XDoG LINE-work (a difference-of-gaussians edge measured across the contour
// and smoothed along it → clean outlines that follow the image's structure).
// STROKES picks the sector weighting : CRISP (hard sectors, the blocky painterly
// look) or SMOOTH (overlapping polynomial sector weights, Kyprianidis et al. 2010).
// All taps are in 1080p pixels (the same brush at 4K and on the dome), premultiplied
// (paint spreads into transparency without dark fringes). Above 1080p the tensor and
// the paint run at the 1080p-equivalent size on a mip of the host (the cost of a
// 1080p frame at any size); the lines and the mix run at full size.
// The real implementation of the Cameraless « Peint » (paint) + « Griffé » (scratch)
// stages, as a rack FX. Stateless spatial filter : four passes (tensor → smooth →
// paint → line + mix), no feedback buffers.
const F_TOILE_TENSOR = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost; uniform vec2 uTexel;
float L(vec2 uv){ vec4 c = texture(uHost, uv); return dot(c.rgb * c.a, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec2 t = uTexel;
  // Sobel gradient of luma → the structure tensor (E,F,G) = (gx², gx·gy, gy²).
  float gx = (L(vUV + vec2(t.x,-t.y)) + 2.0*L(vUV + vec2(t.x,0.0)) + L(vUV + t))
           - (L(vUV + vec2(-t.x,-t.y)) + 2.0*L(vUV + vec2(-t.x,0.0)) + L(vUV + vec2(-t.x,t.y)));
  float gy = (L(vUV + vec2(-t.x,t.y)) + 2.0*L(vUV + vec2(0.0,t.y)) + L(vUV + t))
           - (L(vUV + vec2(-t.x,-t.y)) + 2.0*L(vUV + vec2(0.0,-t.y)) + L(vUV + vec2(t.x,-t.y)));
  o = vec4(gx*gx, gx*gy, gy*gy, 1.0);
}`
const F_TOILE_TBLUR = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex; uniform vec2 uStep; uniform float uRadius;
void main(){
  vec3 acc = vec3(0.0); float wsum = 0.0; int R = int(uRadius);
  float s = uRadius * 0.5 + 0.5;
  for (int i = -12; i <= 12; i++){
    if (i < -R || i > R) continue;
    float w = exp(-float(i*i) / (2.0 * s * s));
    acc += textureLod(uTex, vUV + uStep * float(i), 0.0).rgb * w; wsum += w;
  }
  o = vec4(acc / max(wsum, 1e-4), 1.0);
}`
// The paint pass (premultiplied paint out), in two variants (one small program per
// stroke mode). It runs at the 1080p-equivalent size : one tap = one output texel.
function toileFS(smooth: boolean): string {
  return `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uTensor; uniform vec2 uTexel;
uniform float uRadius, uSharp, uLod;
void main(){
  vec4 h = textureLod(uHost, vUV, uLod);
  vec4 hp = vec4(h.rgb * h.a, h.a);
  // ── orientation from the smoothed structure tensor ──
  vec3 tn = texture(uTensor, vUV).rgb; float E = tn.x, F = tn.y, G = tn.z;
  float disc = sqrt(max(0.0, (E - G) * (E - G) + 4.0 * F * F));
  float l1 = 0.5 * (E + G + disc), l2 = 0.5 * (E + G - disc);
  float aniso = (l1 + l2 > 1e-6) ? (l1 - l2) / (l1 + l2) : 0.0;
  float phi = 0.5 * atan(2.0 * F, E - G);          // gradient orientation
  vec2 grad = vec2(cos(phi), sin(phi));
  vec2 tang = vec2(-grad.y, grad.x);               // along the contour

  // ── anisotropic Kuwahara : 8 sectors over an ellipse elongated along the
  //    tangent (so strokes run along the image's structure). ──
  int R = int(uRadius);
  float Rf = float(R);
  vec4 m[8]; vec3 s2[8]; float w[8];
  for (int k = 0; k < 8; k++){ ${smooth
    ? 'm[k] = vec4(0.0); s2[k] = vec3(0.0); w[k] = 0.0;'
    : 'm[k] = hp; s2[k] = hp.rgb * hp.rgb; w[k] = 1.0; /* the center tap counts in every sector */'} }
  for (int j = -R; j <= R; j++){
    for (int i = -R; i <= R; i++){
      ${smooth ? '' : 'if (i == 0 && j == 0) continue;'}
      vec2 v = vec2(float(i), float(j));
      // rotate into the tangent frame, compress along the tangent → ellipse
      vec2 rv = vec2(dot(v, tang), dot(v, grad));
      rv.x *= (1.0 - 0.55 * aniso);
      if (dot(rv, rv) > Rf * Rf + 0.5) continue;
      vec4 c = textureLod(uHost, vUV + v * uTexel, uLod);
      c.rgb *= c.a;
      vec3 c2 = c.rgb * c.rgb;
${smooth ? `      // overlapping polynomial sector weights on the unit disc (a partition of the
      // sample over the 8 directions, gaussian in radius) : no hard sector edges
      vec2 vn = rv / max(Rf, 1.0);
      vec2 u = 0.70710678 * vec2(vn.x + vn.y, vn.y - vn.x);
      vec4 wa = max(vec4(vn.x, vn.y, -vn.x, -vn.y) + 0.33 - 3.0 * vec4(vn.y * vn.y, vn.x * vn.x, vn.y * vn.y, vn.x * vn.x), 0.0);
      vec4 wb = max(vec4(u.x, u.y, -u.x, -u.y) + 0.33 - 3.0 * vec4(u.y * u.y, u.x * u.x, u.y * u.y, u.x * u.x), 0.0);
      wa *= wa; wb *= wb;
      float gn = exp(-3.125 * dot(vn, vn)) / (dot(wa, vec4(1.0)) + dot(wb, vec4(1.0)) + 1e-6);
      wa *= gn; wb *= gn;
      m[0] += c * wa.x; s2[0] += c2 * wa.x; w[0] += wa.x;
      m[1] += c * wb.x; s2[1] += c2 * wb.x; w[1] += wb.x;
      m[2] += c * wa.y; s2[2] += c2 * wa.y; w[2] += wa.y;
      m[3] += c * wb.y; s2[3] += c2 * wb.y; w[3] += wb.y;
      m[4] += c * wa.z; s2[4] += c2 * wa.z; w[4] += wa.z;
      m[5] += c * wb.z; s2[5] += c2 * wb.z; w[5] += wb.z;
      m[6] += c * wa.w; s2[6] += c2 * wa.w; w[6] += wa.w;
      m[7] += c * wb.w; s2[7] += c2 * wb.w; w[7] += wb.w;`
    : `      // the octant of rv, as floor((atan(y,x) + π) / (π/4)) without the atan
      float ax = abs(rv.x), ay = abs(rv.y);
      int k = rv.y < 0.0 ? (rv.x < 0.0 ? (ax > ay ? 0 : 1) : (ay > ax ? 2 : 3))
                         : (rv.x > 0.0 ? (ax > ay ? 4 : 5) : (ay > ax ? 6 : 7));
      for (int q = 0; q < 8; q++){ float sel = q == k ? 1.0 : 0.0; m[q] += c * sel; s2[q] += c2 * sel; w[q] += sel; }`}
    }
  }
  vec4 paint = vec4(0.0); float aw = 0.0, vmin = 1e9; vec4 best = hp;
  for (int k = 0; k < 8; k++){
    if (w[k] < 1e-3) continue;
    vec4 mk = m[k] / w[k];
    vec3 vk = abs(s2[k] / w[k] - mk.rgb * mk.rgb);
    float var = vk.x + vk.y + vk.z;
    float a = 1.0 / (1.0 + pow(var * 12.0, 1.0 + uSharp * 6.0));  // low-variance sectors win
    paint += mk * a; aw += a;
    if (var < vmin) { vmin = var; best = mk; }
  }
  // very busy spots : every weight underflows, so take the calmest sector outright
  o = aw > 1e-4 ? paint / aw : best;
}`
}
const F_TOILE = toileFS(false)
const F_TOILE_SMOOTH = toileFS(true)
// Full size : the paint (upsampled when it ran smaller) over the live frame, then the
// flow-XDoG line work and the mix.
const F_TOILE_FINAL = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uHost, uTensor, uPaintT; uniform vec2 uTexel;
uniform float uPaint, uLine, uThresh, uMix;
float L(vec2 uv){ vec4 c = textureLod(uHost, uv, 0.0); return dot(c.rgb * c.a, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec4 h = texture(uHost, vUV);
  vec4 hp = vec4(h.rgb * h.a, h.a);
  vec3 tn = texture(uTensor, vUV).rgb; float E = tn.x, F = tn.y, G = tn.z;
  float disc = sqrt(max(0.0, (E - G) * (E - G) + 4.0 * F * F));
  float l1 = 0.5 * (E + G + disc), l2 = 0.5 * (E + G - disc);
  float aniso = (l1 + l2 > 1e-6) ? (l1 - l2) / (l1 + l2) : 0.0;
  float phi = 0.5 * atan(2.0 * F, E - G);
  vec2 grad = vec2(cos(phi), sin(phi));
  vec2 tang = vec2(-grad.y, grad.x);
  vec4 col = mix(hp, texture(uPaintT, vUV), uPaint);

  // ── flow-XDoG line : a high-pass ACROSS the contour, smoothed ALONG it. ──
  if (uLine > 0.001){
    float e = 0.0;
    for (int s = -3; s <= 3; s++){
      vec2 b = vUV + tang * (float(s) * 2.0) * uTexel;         // walk along the contour
      float c = L(b);
      float n = 0.5 * (L(b + grad * 2.0 * uTexel) + L(b - grad * 2.0 * uTexel));
      e += (c - n);                                            // across-contour high pass
    }
    e = abs(e) / 7.0;
    float line = smoothstep(uThresh * 0.03, uThresh * 0.03 + 0.06, e) * aniso;
    col.rgb *= 1.0 - line * uLine;                             // ink the contours dark
  }
  vec4 r = mix(hp, col, uMix);
  o = vec4(r.a > 1e-4 ? clamp(r.rgb / r.a, 0.0, 1.0) : vec3(0.0), clamp(r.a, 0.0, 1.0));
}`

export class ToileNode implements ConvNode {
  private t0: RGBA | null = null
  private t1: RGBA | null = null
  private pt: RGBA | null = null
  private src: MipTarget
  private pw = 0
  private ph = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) { this.src = new MipTarget(gl) }

  private freeWork(): void {
    const gl = this.gl
    for (const t of [this.t0, this.t1, this.pt]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
    this.t0 = this.t1 = this.pt = null
  }

  /** Tensor + paint targets at the working size (1080p-equivalent above 1080p). */
  private ensure(pw: number, ph: number): void {
    if (this.t0 && this.pw === pw && this.ph === ph) return
    const gl = this.gl
    this.freeWork()
    this.t0 = makeRGBA(gl, pw, ph, true); this.t1 = makeRGBA(gl, pw, ph, true); this.pt = makeRGBA(gl, pw, ph, true)
    this.pw = pw; this.ph = ph
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    const inp = ctx.inputs
    const radius = Math.round(clampf(num(inp.radius, 0.5), 0, 1) * 4) + 1
    // One tap = one 1080p pixel : the same brush, tensor and line at any size. Above
    // 1080p the tensor and the paint run at the 1080p-equivalent size, on a mip of
    // the host (the Kuwahara loop costs what it costs at 1080p).
    const sc = Math.max(1, H / 1080)
    const small = sc > 1.05
    const pw = small ? Math.max(2, Math.round(W / sc)) : W, ph = small ? Math.max(2, Math.round(H / sc)) : H
    this.ensure(pw, ph)
    const t0 = this.t0 as RGBA, t1 = this.t1 as RGBA, pt = this.pt as RGBA
    let src = ctx.host, lod = 0
    if (small) {
      lod = Math.log2(H / ph)
      this.src.ensure(W, H)
      copyA(gl, g, ctx.host, this.src.fbo as WebGLFramebuffer, 0, 0, W, H)
      this.src.mip(lod)
      src = this.src.tex as WebGLTexture
    }

    // 1) structure tensor (texture() picks the mip level for the smaller target).
    let p = g.use(g.toileTensor)
    bindTex(gl, 0, src); gl.uniform1i(p.u('uHost'), 0); gl.uniform2f(p.u('uTexel'), 1 / pw, 1 / ph)
    drawTo(gl, t0.fbo, pw, ph)
    // 2) smooth the tensor (separable) for coherent orientation : t0 →H→ t1 →V→ t0.
    const coh = Math.max(2, radius + 2)
    p = g.use(g.toileTBlur)
    bindTex(gl, 0, t0.tex); gl.uniform1i(p.u('uTex'), 0); gl.uniform1f(p.u('uRadius'), coh)
    gl.uniform2f(p.u('uStep'), 1 / pw, 0); drawTo(gl, t1.fbo, pw, ph)
    bindTex(gl, 0, t1.tex); gl.uniform2f(p.u('uStep'), 0, 1 / ph); drawTo(gl, t0.fbo, pw, ph)
    // 3) paint (premultiplied) at the working size.
    p = g.use(Math.round(num(inp.strokes, 0)) === 1 ? extraProg(g, 'toileSmooth', F_TOILE_SMOOTH) : g.toile)
    bindTex(gl, 0, src); gl.uniform1i(p.u('uHost'), 0)
    bindTex(gl, 1, t0.tex); gl.uniform1i(p.u('uTensor'), 1)
    gl.uniform2f(p.u('uTexel'), 1 / pw, 1 / ph)
    gl.uniform1f(p.u('uRadius'), radius)
    gl.uniform1f(p.u('uSharp'), clampf(num(inp.sharp, 0.5), 0, 1))
    gl.uniform1f(p.u('uLod'), lod)
    drawTo(gl, pt.fbo, pw, ph)
    // 4) full size : paint over the live frame, line work, mix.
    const out = ctx.chain.next()
    p = g.use(extraProg(g, 'toileFinal', F_TOILE_FINAL))
    bindTex(gl, 0, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    bindTex(gl, 1, t0.tex); gl.uniform1i(p.u('uTensor'), 1)
    bindTex(gl, 2, pt.tex); gl.uniform1i(p.u('uPaintT'), 2)
    gl.uniform2f(p.u('uTexel'), sc / W, sc / H)
    gl.uniform1f(p.u('uPaint'), clampf(num(inp.paint, 1), 0, 1))
    gl.uniform1f(p.u('uLine'), clampf(num(inp.line, 0.4), 0, 1))
    gl.uniform1f(p.u('uThresh'), clampf(num(inp.threshold, 0.5), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    drawTo(gl, out.fbo, W, H)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    this.freeWork()
    this.src.free()
  }
}

// ── Pulfrich node : monocular 3D from a temporal eye-delay ───────────────
// A frame-history ring read as a per-pixel delay, keyed by the shared depth map
// (or luminance), presented as an anaglyph pair or a motion-gated parallax slide.
// The disparity is temporal (live frame + the ring's change over the delay), so a
// still picture has no fringes and depth blooms only on lateral motion. The ring
// is written BEFORE the present (key 0 has no lag) on a 60 Hz clock (a delay frame
// is 1/60 s at any display rate; a frozen layer stops writing), in tiles of at
// most 540 lines (half-res at 1080p, ~18 MB on the dome instead of the maximum
// texture size). Works on any rack (both layer and master carry the depth
// context); with Depth off (depth = null) the key falls back to luminance.
const PU_COLS = 4, PU_ROWS = 4, PU_N = PU_COLS * PU_ROWS // 16-frame ring
export class PulfrichNode implements ConvNode {
  private ring: RGBA | null = null
  private tw = 0
  private th = 0
  private writeHead = 0
  private recent = 0
  private filled = 0
  private clock = 0
  private lastFrame = -1
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    const s = Math.min(0.5, 540 / h)
    const tw = Math.max(2, Math.round(w * s)), th = Math.max(2, Math.round(h * s))
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
    // After a bypass the ring holds a stale past : start over.
    if (frameGap(this.lastFrame, ctx)) { this.filled = 0; this.clock = 0 }
    this.lastFrame = ctx.frame ?? -1

    // Store the current frame into the ring (alpha kept) : one tile per 1/60 s of
    // this rack's clock (none on a frozen layer, two on a 30 Hz frame).
    this.clock += ctx.dt * 60
    let writes = Math.floor(this.clock)
    this.clock -= writes
    if (this.filled === 0) writes = Math.max(writes, 1)
    writes = Math.min(writes, 4)
    for (let k = 0; k < writes; k++) {
      const col = this.writeHead % PU_COLS, row = Math.floor(this.writeHead / PU_COLS)
      copyA(gl, g, ctx.host, ring.fbo, col * this.tw, row * this.th, this.tw, this.th)
      this.recent = this.writeHead
      this.writeHead = (this.writeHead + 1) % PU_N
      this.filled = Math.min(PU_N, this.filled + 1)
    }

    // Present : read the delayed eyes from the ring and combine with the live eye.
    const out = ctx.chain.next()
    const p = g.use(g.pulfrich)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ring.tex); gl.uniform1i(p.u('uRing'), 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ctx.depth ?? ctx.host); gl.uniform1i(p.u('uDepth'), 2)
    gl.uniform2f(p.u('uAtlasTexel'), 1 / (this.tw * PU_COLS), 1 / (this.th * PU_ROWS))
    gl.uniform1f(p.u('uCols'), PU_COLS); gl.uniform1f(p.u('uRows'), PU_ROWS); gl.uniform1f(p.u('uN'), PU_N)
    gl.uniform1f(p.u('uRecent'), this.recent); gl.uniform1f(p.u('uFilled'), this.filled)
    gl.uniform1f(p.u('uAspect'), W / H)
    gl.uniform1i(p.u('uHasDepth'), ctx.depth ? 1 : 0)
    gl.uniform1i(p.u('uMode'), Math.round(num(inp.mode, 0)))
    gl.uniform1i(p.u('uSrc'), Math.round(num(inp.source, 1)))
    gl.uniform1i(p.u('uSwap'), num(inp.swap, 0) >= 0.5 ? 1 : 0)
    gl.uniform1f(p.u('uDelay'), clampf(num(inp.delay, 5), 1, PU_N - 2))
    gl.uniform1f(p.u('uCurve'), clampf(num(inp.curve, 1), 0.2, 3))
    gl.uniform1f(p.u('uSep'), clampf(num(inp.separation, 0.4), 0, 1))
    gl.uniform1f(p.u('uDesat'), clampf(num(inp.desat, 0.4), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.uniform1f(p.u('uZero'), clampf(num(inp.zero, 0), 0, 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.ring) { gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo); this.ring = null }
  }
}

// ── Corrode node : durational corrosion that only grows over a set ───────
// A persistent single-channel corrosion mask, half-res, that monotonically grows
// (blotch-seeded by a rising integrated LEVEL + a max-of-neighbors creep) and eats
// the picture with reticulation cracks. EXHUME (reset ▸) zeros it + re-rolls the
// blotch pattern. On the master rack it weathers the whole set over minutes.
export class CorrodeNode implements ConvNode {
  private corr: [RGBA, RGBA] | null = null
  private tw = 0
  private th = 0
  private cur = 0
  private level = 0      // integrated corrosion level (0 → 1 over the BURY time)
  private creepAcc = 0   // accumulated creep, in mask texels
  private creepN = 0     // creep steps taken (4- and 8-neighbor steps alternate)
  private seed = Math.random() * 100
  private prevReset = 0
  private seeded = false
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    const tw = Math.max(2, w >> 1), th = Math.max(2, h >> 1)
    if (this.corr && this.tw === tw && this.th === th) return
    const gl = this.gl
    if (this.corr) for (const b of this.corr) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
    this.corr = [makeRGBA(gl, tw, th, false), makeRGBA(gl, tw, th, false)]
    this.tw = tw; this.th = th; this.cur = 0; this.seeded = false
  }

  private clearBuffers(): void {
    const gl = this.gl
    gl.clearColor(0, 0, 0, 1)
    for (const b of this.corr!) { gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo); gl.viewport(0, 0, this.tw, this.th); gl.clear(gl.COLOR_BUFFER_BIT) }
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)
    const inp = ctx.inputs
    const corr = this.corr as [RGBA, RGBA]

    if (!this.seeded) { this.clearBuffers(); this.seeded = true }

    // EXHUME : a rising edge on reset zeros the corrosion + re-rolls the blotch field.
    const reset = num(inp.reset, 0)
    if (reset >= 0.5 && this.prevReset < 0.5) {
      this.clearBuffers(); this.level = 0; this.creepAcc = 0; this.seed = (this.seed + 37.13) % 100
    }
    this.prevReset = reset

    // BURY is the time to full corrosion on a log scale : 0 = an hour, 0.5 ≈ 8 min,
    // 1 = a minute. The level integrates 1/T, so turning BURY never jumps it.
    const T = 3600 * Math.pow(60, -clampf(num(inp.bury, 0.5), 0, 1))
    this.level = Math.min(1.2, this.level + ctx.dt / T)
    // The blotch field is near-normal (mean ≈ 0.49, sd ≈ 0.157 after its stretch) :
    // threshold it at the quantile of the level, so the SEEDED area grows evenly
    // with time instead of all at once mid-way (probit via its logistic fit).
    const pq = clampf(1 - this.level, 1e-4, 1 - 1e-4)
    const thr = clampf(0.49 + 0.157 * Math.log(pq / (1 - pq)) / 1.702, -0.2, 1.2)
    // CREEP : over that same time the fronts travel up to a quarter of the frame
    // height (at creep 1), in whole mask-texel steps taken on the clock.
    this.creepAcc += ctx.dt * clampf(num(inp.spread, 0.4), 0, 1) * 0.25 * this.th / T
    let steps = Math.floor(this.creepAcc)
    this.creepAcc -= steps
    steps = Math.min(steps, 4)

    // 1) grow the mask (creep + new blotches), ping-pong : one pass, or one per step.
    const aspect = W / H
    let p = g.use(g.corrodeGrow)
    gl.uniform2f(p.u('uTexel'), 1 / this.tw, 1 / this.th)
    gl.uniform1f(p.u('uLevel'), 1 - thr)
    gl.uniform1f(p.u('uSeed'), this.seed)
    gl.uniform1f(p.u('uAspect'), aspect)
    for (let s = 0; s < Math.max(1, steps); s++) {
      const read = corr[this.cur], write = corr[1 - this.cur]
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, read.tex); gl.uniform1i(p.u('uPrev'), 0)
      gl.uniform1f(p.u('uStep'), s < steps ? 1 + (this.creepN++ & 1) : 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo); gl.viewport(0, 0, this.tw, this.th); gl.drawArrays(gl.TRIANGLES, 0, 3)
      this.cur = 1 - this.cur
    }
    const mask = corr[this.cur]

    // 2) present : stain (or eat to transparency) + reticulation cracks.
    const out = ctx.chain.next()
    p = g.use(g.corrodeOut)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mask.tex); gl.uniform1i(p.u('uCorr'), 1)
    gl.uniform1f(p.u('uEat'), clampf(num(inp.eat, 0.7), 0, 1))
    gl.uniform1f(p.u('uCrackle'), clampf(num(inp.crackle, 0.4), 0, 1))
    gl.uniform1f(p.u('uTone'), clampf(num(inp.tone, 0.3), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.uniform1f(p.u('uSeed'), this.seed)
    gl.uniform1f(p.u('uAspect'), aspect)
    gl.uniform1i(p.u('uEatTo'), Math.round(num(inp.eatTo, 0)) === 1 ? 1 : 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.corr) { for (const b of this.corr) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.corr = null }
  }
}

// ── Decimate / Time-Lapse node : sample-and-hold at a chosen rate ────────
// Grabs a fresh frame only on a clock (CLOCK mode, `rate` Hz or a beat division
// with SYNC) or on the TRIGGER (HOLD mode : freeze until re-sampled), and
// crossfades the last two grabs by `smooth` between samples. Two persistent
// half-float targets ping-pong the samples (no clipped highlights or banded
// shadows), alpha kept. The clock keeps its overshoot, so 12 Hz at 60 fps is an
// even 5-frame cadence, not a 5/6 judder.
export class DecimateNode implements ConvNode {
  private buf: [RGBA, RGBA] | null = null
  private w = 0
  private h = 0
  private cur = 0
  private timer = 0
  private prevTrig = 0
  private seeded = false
  private lastFrame = -1
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(w: number, h: number): void {
    if (this.buf && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.buf) for (const b of this.buf) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) }
    this.buf = [makeRGBA(gl, w, h, true), makeRGBA(gl, w, h, true)]
    this.w = w; this.h = h; this.cur = 0; this.seeded = false; this.timer = 0
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl)
    const W = ctx.chain.w, H = ctx.chain.h
    this.ensure(W, H)
    const inp = ctx.inputs
    const buf = this.buf as [RGBA, RGBA]

    // Seed both slots with the live frame so it never starts black (and after a
    // bypass, so it doesn't resume on a stale frame).
    if (!this.seeded || frameGap(this.lastFrame, ctx)) {
      copyA(gl, g, ctx.host, buf[0].fbo, 0, 0, W, H); copyA(gl, g, ctx.host, buf[1].fbo, 0, 0, W, H)
      this.seeded = true; this.timer = 0
    }
    this.lastFrame = ctx.frame ?? -1

    const mode = Math.round(num(inp.mode, 0)) // 0 clock · 1 hold (trig-only)
    const sync = SYNC_DIV[Math.round(clampf(num(inp.sync, 0), 0, 3))]
    const interval = sync > 0 ? beatPeriod(ctx.bpm, sync) : 1 / clampf(num(inp.rate, 6), 0.2, 20)
    const smooth = clampf(num(inp.smooth, 0), 0, 1)

    const trig = num(inp.trig, 0)
    const fired = trig >= 0.5 && this.prevTrig < 0.5
    this.prevTrig = trig

    this.timer += ctx.dt
    let tick = fired
    if (mode === 0 && this.timer >= interval) tick = true
    if (tick) {
      // Write the fresh frame into the PREV slot, then make it current : the old
      // current becomes prev (the crossfade source).
      copyA(gl, g, ctx.host, buf[1 - this.cur].fbo, 0, 0, W, H)
      this.cur = 1 - this.cur
      // keep the overshoot on the clock (no judder); a trigger or a long stall restarts it
      this.timer = fired || this.timer >= 2 * interval ? 0 : this.timer - interval
    }

    // Crossfade the previous sample → current over `smooth`·interval seconds.
    const fadeDur = smooth * interval
    const f = fadeDur < 0.001 ? 1 : clampf(this.timer / fadeDur, 0, 1)

    const out = ctx.chain.next()
    const p = g.use(g.decimate)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, buf[1 - this.cur].tex); gl.uniform1i(p.u('uPrev'), 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, buf[this.cur].tex); gl.uniform1i(p.u('uCur'), 2)
    gl.uniform1f(p.u('uF'), f)
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    if (this.buf) { for (const b of this.buf) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo) } this.buf = null }
  }
}


// ── Sidechain recipes (v1.2.0) ────────────────────────────────────────────
// Single-pass helpers shared by the recipe nodes : bind a texture to a unit and
// draw the fullscreen triangle into a target.
function bindTex(gl: WebGL2RenderingContext, unit: number, tex: WebGLTexture): void {
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex)
}
function drawTo(gl: WebGL2RenderingContext, fbo: WebGLFramebuffer, w: number, h: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3)
}

// A half-float target with a mip chain : render into level 0, then mip() it, so a
// blur can read a coarser level (the same picture a 1080p frame would give).
class MipTarget {
  tex: WebGLTexture | null = null
  fbo: WebGLFramebuffer | null = null
  w = 0
  h = 0
  constructor(private gl: WebGL2RenderingContext) {}
  ensure(w: number, h: number): void {
    if (this.tex && this.w === w && this.h === h) return
    const gl = this.gl
    this.free()
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA16F, w, h)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0)
    this.w = w; this.h = h
  }
  /** Build the chain down to `maxLod` (just what the blur will read). */
  mip(maxLod: number): void {
    const gl = this.gl
    const top = Math.min(Math.floor(Math.log2(Math.max(this.w, this.h))), Math.max(1, Math.ceil(maxLod) + 1))
    gl.bindFramebuffer(gl.FRAMEBUFFER, null) // level 0 may still be the draw target
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, top)
    gl.generateMipmap(gl.TEXTURE_2D)
  }
  free(): void {
    if (this.tex) this.gl.deleteTexture(this.tex)
    if (this.fbo) this.gl.deleteFramebuffer(this.fbo)
    this.tex = null; this.fbo = null
  }
}

// Remap : the sidechain's red/green become the coordinates each host pixel reads
// from (SWAP reverses the roles). No sidechain = the host remaps itself.
export class RemapNode implements ConvNode {
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}
  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl), inp = ctx.inputs
    const side = ctx.sidechain ?? ctx.host
    const swap = num(inp.swap, 0) >= 0.5
    const out = ctx.chain.next()
    const p = g.use(g.remap)
    bindTex(gl, 0, swap ? side : ctx.host); gl.uniform1i(p.u('uImg'), 0)
    bindTex(gl, 1, swap ? ctx.host : side); gl.uniform1i(p.u('uMap'), 1)
    bindTex(gl, 2, ctx.host); gl.uniform1i(p.u('uHost'), 2)
    gl.uniform1i(p.u('uMode'), Math.round(num(inp.mode, 0)))
    gl.uniform1i(p.u('uExtend'), Math.round(num(inp.extend, 2)))
    gl.uniform1f(p.u('uAmount'), clampf(num(inp.amount, 1), 0, 1))
    gl.uniform1f(p.u('uScale'), clampf(num(inp.scale, 1), 0, 4))
    gl.uniform2f(p.u('uOffset'), clampf(num(inp.offsetX, 0), -1, 1), clampf(num(inp.offsetY, 0), -1, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    drawTo(gl, out.fbo, ctx.chain.w, ctx.chain.h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }
  dispose(): void { this.disposed = true }
}

// Luma Blur : a blur whose width follows a control image's brightness (the
// sidechain, or the host's own brightness with none). Separable, two passes.
// Above 1080p (or in SMOOTH quality) the taps read a mip level, so the stepped
// sparse-tap look is the 1080p one at any size, or melts away when asked to.
export class LumaBlurNode implements ConvNode {
  private mid: MipTarget
  private src: MipTarget
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) { this.mid = new MipTarget(gl); this.src = new MipTarget(gl) }
  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl), inp = ctx.inputs
    const W = ctx.chain.w, H = ctx.chain.h
    this.mid.ensure(W, H)
    const ref = H / 1080 // widths are authored in 1080p pixels
    const black = clampf(num(inp.blackWidth, 0), 0, 96) * ref
    const white = clampf(num(inp.whiteWidth, 24), 0, 96) * ref
    const mix = clampf(num(inp.mix, 1), 0, 1)
    if ((black < 0.5 && white < 0.5) || mix <= 0) return ctx.host
    // control 1 = the shared depth map around a focus plane (a depth-of-field
    // blur); falls back to brightness when no depth map is live (Depth off).
    const byDepth = Math.round(num(inp.control, 0)) === 1 && !!ctx.depth
    const ctrl = byDepth ? (ctx.depth as WebGLTexture) : ctx.sidechain ?? ctx.host
    const quality = Math.round(num(inp.quality, 1)) // 0 fast · 1 fine · 2 smooth
    const taps = quality >= 1 ? 16 : 8
    const smooth = quality >= 2
    const lodMax = Math.log2(Math.max(1, ref))
    const needLod = smooth ? Math.log2(Math.max(1, Math.max(black, white) / taps)) : Math.min(lodMax, Math.log2(Math.max(1, Math.max(black, white) / taps)))
    let srcTex = ctx.host
    if (needLod > 0.01) {
      this.src.ensure(W, H)
      copyA(gl, g, ctx.host, this.src.fbo as WebGLFramebuffer, 0, 0, W, H)
      this.src.mip(needLod)
      srcTex = this.src.tex as WebGLTexture
    }
    const p = g.use(g.vblur)
    gl.uniform1i(p.u('uTex'), 0); gl.uniform1i(p.u('uCtrl'), 1); gl.uniform1i(p.u('uHost'), 2)
    gl.uniform1f(p.u('uBlack'), black); gl.uniform1f(p.u('uWhite'), white)
    gl.uniform1f(p.u('uGamma'), clampf(num(inp.gamma, 1), 0.25, 4))
    gl.uniform1i(p.u('uInvert'), num(inp.invert, 0) >= 0.5 ? 1 : 0)
    gl.uniform1i(p.u('uTaps'), taps)
    gl.uniform1i(p.u('uDepth'), byDepth ? 1 : 0)
    gl.uniform1f(p.u('uFocus'), clampf(num(inp.focus, 0.5), 0, 1))
    gl.uniform1f(p.u('uLodMax'), lodMax)
    gl.uniform1i(p.u('uSmooth'), smooth ? 1 : 0)
    gl.uniform1f(p.u('uMix'), mix)
    bindTex(gl, 1, ctrl); bindTex(gl, 2, ctx.host)
    gl.uniform1i(p.u('uPass'), 0)
    bindTex(gl, 0, srcTex); gl.uniform2f(p.u('uStep'), 1 / W, 0); drawTo(gl, this.mid.fbo as WebGLFramebuffer, W, H)
    if (needLod > 0.01) this.mid.mip(needLod)
    const out = ctx.chain.next()
    gl.uniform1i(p.u('uPass'), 1)
    bindTex(gl, 0, this.mid.tex as WebGLTexture); gl.uniform2f(p.u('uStep'), 0, 1 / H); drawTo(gl, out.fbo, W, H)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }
  dispose(): void {
    this.disposed = true
    this.mid.free(); this.src.free()
  }
}

// Gooey : blur at half resolution, then threshold, so neighboring shapes merge
// into soft-edged blobs (the metaball move). Above 1080p the blur reads the
// host's mip level nearest 1080p, so blobs and their edges look the same at 4K and
// on the dome as at 1080p.
export class GooeyNode implements ConvNode {
  private b0: RGBA | null = null
  private b1: RGBA | null = null
  private src: MipTarget
  private w = 0
  private h = 0
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) { this.src = new MipTarget(gl) }
  private free(): void {
    const gl = this.gl
    for (const t of [this.b0, this.b1]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
    this.b0 = this.b1 = null
  }
  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl), inp = ctx.inputs
    const W = ctx.chain.w, H = ctx.chain.h
    const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1)
    if (!this.b0 || this.w !== hw || this.h !== hh) {
      this.free()
      this.b0 = makeRGBA(gl, hw, hh, true); this.b1 = makeRGBA(gl, hw, hh, true)
      this.w = hw; this.h = hh
    }
    const b0 = this.b0 as RGBA, b1 = this.b1 as RGBA
    const blur = clampf(num(inp.blur, 0.35), 0, 1)
    const radius = Math.pow(blur, 1.5) * 90 * (H / 1080)
    const lod = Math.log2(Math.max(1, H / 1080))
    let srcTex = ctx.host
    if (lod > 0.01) {
      this.src.ensure(W, H)
      copyA(gl, g, ctx.host, this.src.fbo as WebGLFramebuffer, 0, 0, W, H)
      this.src.mip(lod)
      srcTex = this.src.tex as WebGLTexture
    }
    let p = g.use(g.gblur)
    gl.uniform1i(p.u('uTex'), 0); gl.uniform1f(p.u('uRadius'), radius); gl.uniform1i(p.u('uTaps'), 12)
    gl.uniform1i(p.u('uPass'), 0); gl.uniform1f(p.u('uLod'), lod)
    bindTex(gl, 0, srcTex); gl.uniform2f(p.u('uStep'), 1 / W, 0); drawTo(gl, b0.fbo, hw, hh)
    gl.uniform1i(p.u('uPass'), 1); gl.uniform1f(p.u('uLod'), 0)
    bindTex(gl, 0, b0.tex); gl.uniform2f(p.u('uStep'), 0, 1 / H); drawTo(gl, b1.fbo, hw, hh)
    const out = ctx.chain.next()
    p = g.use(g.gooey)
    bindTex(gl, 0, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    bindTex(gl, 1, b1.tex); gl.uniform1i(p.u('uBlur'), 1)
    gl.uniform1f(p.u('uThresh'), clampf(num(inp.threshold, 0.4), 0, 1))
    gl.uniform1f(p.u('uSoft'), clampf(num(inp.softness, 0.06), 0.002, 0.5))
    gl.uniform1f(p.u('uBg'), clampf(num(inp.outside, 0), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    gl.uniform1i(p.u('uFill'), Math.round(num(inp.fill, 0)))
    gl.uniform1i(p.u('uKey'), Math.round(num(inp.key, 0)))
    gl.uniform1i(p.u('uInvert'), num(inp.invert, 0) >= 0.5 ? 1 : 0)
    drawTo(gl, out.fbo, W, H)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }
  dispose(): void { this.disposed = true; this.free(); this.src.free() }
}

// Matte (three inputs) : this layer where the matte is bright, input 2 (the
// sidechain) where it is dark, each with its own alpha. No matte picked = this
// layer's own brightness; no input 2 = black, or a transparent cut-out (EMPTY).
export class MatteNode implements ConvNode {
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}
  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl), inp = ctx.inputs
    const swap = num(inp.swap, 0) >= 0.5 && !!ctx.sidechain
    const a = swap ? (ctx.sidechain as WebGLTexture) : ctx.host
    const b = swap ? ctx.host : ctx.sidechain
    const out = ctx.chain.next()
    const p = g.use(g.matte)
    bindTex(gl, 0, a); gl.uniform1i(p.u('uA'), 0)
    bindTex(gl, 1, b ?? ctx.host); gl.uniform1i(p.u('uB'), 1)
    bindTex(gl, 2, ctx.sidechain2 ?? ctx.host); gl.uniform1i(p.u('uM'), 2)
    gl.uniform1i(p.u('uHasB'), b ? 1 : 0)
    gl.uniform1i(p.u('uEmpty'), Math.round(num(inp.empty, 0)) === 1 ? 1 : 0)
    gl.uniform1i(p.u('uChan'), Math.round(num(inp.channel, 0)))
    gl.uniform1i(p.u('uInvert'), num(inp.invert, 0) >= 0.5 ? 1 : 0)
    gl.uniform1f(p.u('uLo'), clampf(num(inp.low, 0), 0, 1))
    gl.uniform1f(p.u('uHi'), clampf(num(inp.high, 1), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    drawTo(gl, out.fbo, ctx.chain.w, ctx.chain.h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }
  dispose(): void { this.disposed = true }
}

// Lookup : recolor this layer through a line drawn across a live palette layer
// (the sidechain; none, or an empty one, = this layer is its own palette).
export class LookupNode implements ConvNode {
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}
  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = ctx.gl, g = nodeGL(gl), inp = ctx.inputs
    const out = ctx.chain.next()
    const p = g.use(g.lookup)
    bindTex(gl, 0, ctx.host); gl.uniform1i(p.u('uHost'), 0)
    bindTex(gl, 1, ctx.sidechain ?? ctx.host); gl.uniform1i(p.u('uPal'), 1)
    gl.uniform1i(p.u('uIndex'), Math.round(num(inp.index, 0)))
    gl.uniform1i(p.u('uAxis'), Math.round(num(inp.axis, 0)))
    gl.uniform1i(p.u('uMirror'), num(inp.mirror, 0) >= 0.5 ? 1 : 0)
    gl.uniform1f(p.u('uPos'), clampf(num(inp.position, 0.5), 0, 1))
    gl.uniform1f(p.u('uOffset'), num(inp.offset, 0))
    gl.uniform1f(p.u('uCycles'), clampf(num(inp.cycles, 1), 0.1, 8))
    gl.uniform1f(p.u('uGamma'), clampf(num(inp.gamma, 1), 0.25, 4))
    gl.uniform1f(p.u('uBand'), clampf(num(inp.band, 0.2), 0, 1))
    gl.uniform1f(p.u('uMix'), clampf(num(inp.mix, 1), 0, 1))
    drawTo(gl, out.fbo, ctx.chain.w, ctx.chain.h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out.tex
  }
  dispose(): void { this.disposed = true }
}

/** Instantiate the native node for a reserved `node-*` shaderId (null if none). */
export function makeConvNode(gl: WebGL2RenderingContext, shaderId: string): ConvNode | null {
  if (shaderId === 'node-parallax') return new ParallaxNode(gl)
  if (shaderId === 'node-remap') return new RemapNode(gl)
  if (shaderId === 'node-lumablur') return new LumaBlurNode(gl)
  if (shaderId === 'node-gooey') return new GooeyNode(gl)
  if (shaderId === 'node-matte') return new MatteNode(gl)
  if (shaderId === 'node-lookup') return new LookupNode(gl)
  if (shaderId === 'node-pulfrich') return new PulfrichNode(gl)
  if (shaderId === 'node-corrode') return new CorrodeNode(gl)
  if (shaderId === 'node-decimate') return new DecimateNode(gl)
  if (shaderId === 'node-eternalism') return new EternalismNode(gl)
  if (shaderId === 'node-afterimage') return new AfterimageNode(gl)
  if (shaderId === 'node-melt') return new MeltNode(gl)
  if (shaderId === 'node-faultline') return new FaultlineNode(gl)
  if (shaderId === 'node-ibfv') return new IBFVNode(gl)
  if (shaderId === 'node-toile') return new ToileNode(gl)
  if (shaderId === 'node-transfert') return new TransfertNode(gl)
  if (shaderId === 'node-convolve') return new ConvolveNode(gl)
  if (shaderId === 'node-mosaique') return new MosaiqueNode(gl)
  if (shaderId === 'node-reponse') return new ReponseNode(gl)
  if (shaderId === 'node-feedback') return new FeedbackNode(gl)
  if (shaderId === 'node-datamosh') return new DatamoshNode(gl)
  if (shaderId === 'node-scanner') return new ScannerNode(gl)
  if (shaderId === 'node-autocutter') return new AutocutterNode(gl)
  if (shaderId === 'node-chronoscan') return new ChronoscanNode(gl)
  if (shaderId === 'node-sediment') return new SedimentNode(gl)
  return null
}

export const NATIVE_NODE_IDS = ['node-transfert', 'node-convolve', 'node-mosaique', 'node-reponse', 'node-feedback', 'node-datamosh', 'node-scanner', 'node-autocutter', 'node-chronoscan', 'node-sediment', 'node-parallax', 'node-eternalism', 'node-afterimage', 'node-pulfrich', 'node-corrode', 'node-decimate', 'node-melt', 'node-faultline', 'node-ibfv', 'node-toile', 'node-remap', 'node-lumablur', 'node-gooey', 'node-matte', 'node-lookup']
export const isNativeNode = (id: string | null | undefined): boolean =>
  !!id && NATIVE_NODE_IDS.includes(id)
