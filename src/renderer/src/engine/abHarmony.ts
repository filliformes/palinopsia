// A/B harmony : B's colors set against A's, the layer's consonance axis.
//
//   harmony -1 : B pulled onto A's hue (matched; with a grey A, B greys out)
//   harmony  0 : B untouched (the default : every session made before keeps its
//                look)
//   harmony  1 : B pushed onto A's complement (clashing)
//
// The hues are read from each source's color : its average weighted by
// brightness (an 8 x 8 grid of samples, MEANS_FS), so a figure on black reads
// as its own color, not as the black around it. B is turned around the grey axis by the
// way from its mean hue to the target, |harmony| of it : so B keeps its own
// variety of colors, only its center moves. A grey B, which has no hue to turn,
// takes the target as a tint instead. Clipped, as before : the clash can burn.
//
// The means are eased over time per layer (MEANS_FS reads its own last measure) :
// the 64 samples' jitter on a busy picture is smoothed away, a cut lands at once.
// And the way B turns is the shortest arc except near the far side of the circle,
// where it keeps the way it turned last (the side, texel 2) : a mean sitting on
// the antipode of the target no longer flips B's turn back and forth each frame.
//
// HARMONY_GLSL is the GPU half (the Compositor's mix pass); harmonizeRgb is the
// same math on the CPU, for the Mixer's swatch of where B lands.

export const HARMONY_GLSL = `
const float H_PI = 3.14159265;
const vec3 H_U = vec3(0.70710678, -0.70710678, 0.0);
const vec3 H_V = vec3(0.40824829, 0.40824829, -0.81649658);
vec3 hRot(vec3 c, float a){
  vec3 k = vec3(0.57735);
  float ca = cos(a), sa = sin(a);
  return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.0-ca);
}
// A hue's angle; a grey (no hue at all, e.g. a black frame) reads 0, never atan(0, 0).
float hAng(vec2 p){ return dot(p, p) > 1e-12 ? atan(p.y, p.x) : 0.0; }
// The shortest way from B's hue to the target (A's hue, or its complement).
float hArc(vec3 mA, vec3 mB, float h){
  float target = hAng(vec2(dot(mA, H_U), dot(mA, H_V))) + (h > 0.0 ? H_PI : 0.0);
  return mod(target - hAng(vec2(dot(mB, H_U), dot(mB, H_V))) + H_PI, 2.0 * H_PI) - H_PI;
}
// side : the way B turned last (+1 / -1, 0 none), kept by MEANS_FS near the antipode.
vec3 harmonize(vec3 c, vec3 mA, vec3 mB, float h, float side){
  if (abs(h) < 0.001) return c;
  vec2 pa = vec2(dot(mA, H_U), dot(mA, H_V));
  vec2 pb = vec2(dot(mB, H_U), dot(mB, H_V));
  float okA = smoothstep(0.015, 0.08, length(pa));
  float okB = smoothstep(0.01, 0.05, length(pb));
  float target = hAng(pa) + (h > 0.0 ? H_PI : 0.0);
  float d = hArc(mA, mB, h);
  // the long way round when the means pass kept that side (only ever near the
  // antipode : below 0.85 pi it sets the side from this same arc)
  if (abs(d) > 0.5 * H_PI && d * side < 0.0) d += sign(side) * 2.0 * H_PI;
  vec3 o = hRot(c, d * abs(h) * okA * okB);
  vec3 tint = H_U * cos(target) + H_V * sin(target);
  o += tint * abs(h) * (1.0 - okB) * okA * 0.22 * (0.3 + dot(c, vec3(0.3333)));
  if (h < 0.0) o = mix(o, vec3(dot(o, vec3(0.299, 0.587, 0.114))), (1.0 - okA) * -h);
  return clamp(o, 0.0, 1.0);
}
`

/** The two sources' colors into a layer's 3 x 1 target : texel 0 A, texel 1 B,
 *  each the average of an 8 x 8 grid weighted by brightness, eased from the
 *  layer's last measure (prev); texel 2 the way B turns (0.5 + 0.5 x side). */
export const MEANS_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D a;
uniform sampler2D b;
uniform sampler2D prev; // this layer's last measure
uniform float rate;     // how far toward the new measure : 1 takes it whole (a first look, or a stale one)
uniform float harm;
${HARMONY_GLSL}
vec3 lit(sampler2D t){
  vec3 s = vec3(0.0); float ws = 0.0;
  for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) {
    vec3 c = texture(t, (vec2(float(i), float(j)) + 0.5) / 8.0).rgb;
    // one bad texel (a NaN from some source) must not blank the whole of B
    if (any(isnan(c)) || any(isinf(c))) continue;
    c = clamp(c, 0.0, 64.0);
    float w = 0.02 + max(c.r, max(c.g, c.b));
    s += c * w; ws += w;
  }
  return ws > 0.0 ? s / ws : vec3(0.0);
}
// Toward the new measure : at once when it moved far (a cut), at rate when it only
// jitters (the 64 samples on a busy picture).
vec3 ease(vec3 p, vec3 n){
  return mix(p, n, max(rate, smoothstep(0.06, 0.25, length(n - p))));
}
void main(){
  int x = int(gl_FragCoord.x);
  vec3 pA = texelFetch(prev, ivec2(0, 0), 0).rgb;
  vec3 pB = texelFetch(prev, ivec2(1, 0), 0).rgb;
  if (x == 0) { o = vec4(ease(pA, lit(a)), 1.0); return; }
  if (x == 1) { o = vec4(ease(pB, lit(b)), 1.0); return; }
  // the side : the shortest arc's, but kept from the last measure while the arc
  // is near the antipode (beyond 0.85 pi), so a mean jittering across it holds
  float d = hArc(ease(pA, lit(a)), ease(pB, lit(b)), harm);
  float was = texelFetch(prev, ivec2(2, 0), 0).r * 2.0 - 1.0;
  float side = abs(d) > 0.85 * H_PI && abs(was) > 0.5 && rate < 1.0 ? sign(was) : sign(d);
  o = vec4(vec3(0.5 + 0.5 * side), 1.0);
}
`

type Rgb = [number, number, number]
const U: Rgb = [0.70710678, -0.70710678, 0]
const V: Rgb = [0.40824829, 0.40824829, -0.81649658]
const dot = (a: Rgb, b: Rgb): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
function rot(c: Rgb, a: number): Rgb {
  const k = 0.57735
  const ca = Math.cos(a), sa = Math.sin(a)
  const kc = k * (c[0] + c[1] + c[2])
  const cr: Rgb = [k * (c[2] - c[1]), k * (c[0] - c[2]), k * (c[1] - c[0])] // k × c
  return [0, 1, 2].map((i) => c[i] * ca + cr[i] * sa + k * kc * (1 - ca)) as Rgb
}

/** harmonize() on the CPU : where a color `c` of B lands, given the sources'
 *  mean colors, the harmony (all 0..1 RGB) and the way B turned (side, texel 2). */
export function harmonizeRgb(c: Rgb, mA: Rgb, mB: Rgb, h: number, side = 0): Rgb {
  if (Math.abs(h) < 0.001) return c
  const pa = [dot(mA, U), dot(mA, V)], pb = [dot(mB, U), dot(mB, V)]
  const okA = smooth(0.015, 0.08, Math.hypot(pa[0], pa[1]))
  const okB = smooth(0.01, 0.05, Math.hypot(pb[0], pb[1]))
  const target = Math.atan2(pa[1], pa[0]) + (h > 0 ? Math.PI : 0)
  let d = target - Math.atan2(pb[1], pb[0]) + Math.PI
  d = d - 2 * Math.PI * Math.floor(d / (2 * Math.PI)) - Math.PI
  if (Math.abs(d) > 0.5 * Math.PI && d * side < 0) d += Math.sign(side) * 2 * Math.PI
  let o = rot(c, d * Math.abs(h) * okA * okB)
  const tint = [0, 1, 2].map((i) => U[i] * Math.cos(target) + V[i] * Math.sin(target))
  const lift = Math.abs(h) * (1 - okB) * okA * 0.22 * (0.3 + (c[0] + c[1] + c[2]) * 0.3333)
  o = o.map((v, i) => v + tint[i] * lift) as Rgb
  if (h < 0) {
    const l = 0.299 * o[0] + 0.587 * o[1] + 0.114 * o[2]
    const g = (1 - okA) * -h
    o = o.map((v) => v + (l - v) * g) as Rgb
  }
  return o.map((v) => Math.max(0, Math.min(1, v))) as Rgb
}

/** Each layer's sources' mean colors (A, B), 0..1, and the way B turns (side :
 *  +1 / -1, 0 none), read back a few times a second while the Mixer shows them
 *  (abSwatchWanted). Null : not measured. */
export const abSwatches: Array<{ a: Rgb; b: Rgb; side: number } | null> = [null, null, null, null]
let wanted = 0
/** The Mixer asks for the swatches while it is open (a count : it nests). */
export function wantAbSwatches(on: boolean): void {
  wanted = Math.max(0, wanted + (on ? 1 : -1))
}
export const abSwatchWanted = (): boolean => wanted > 0
