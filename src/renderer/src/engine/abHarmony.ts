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
vec3 harmonize(vec3 c, vec3 mA, vec3 mB, float h){
  if (abs(h) < 0.001) return c;
  vec2 pa = vec2(dot(mA, H_U), dot(mA, H_V));
  vec2 pb = vec2(dot(mB, H_U), dot(mB, H_V));
  float okA = smoothstep(0.015, 0.08, length(pa));
  float okB = smoothstep(0.01, 0.05, length(pb));
  float target = atan(pa.y, pa.x) + (h > 0.0 ? H_PI : 0.0);
  float d = mod(target - atan(pb.y, pb.x) + H_PI, 2.0 * H_PI) - H_PI;
  vec3 o = hRot(c, d * abs(h) * okA * okB);
  vec3 tint = H_U * cos(target) + H_V * sin(target);
  o += tint * abs(h) * (1.0 - okB) * okA * 0.22 * (0.3 + dot(c, vec3(0.3333)));
  if (h < 0.0) o = mix(o, vec3(dot(o, vec3(0.299, 0.587, 0.114))), (1.0 - okA) * -h);
  return clamp(o, 0.0, 1.0);
}
`

/** The two sources' colors into a 2 x 1 target : texel 0 A, texel 1 B, each
 *  the average of an 8 x 8 grid weighted by brightness. */
export const MEANS_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D a;
uniform sampler2D b;
vec3 lit(sampler2D t){
  vec3 s = vec3(0.0); float ws = 0.0;
  for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) {
    vec3 c = texture(t, (vec2(float(i), float(j)) + 0.5) / 8.0).rgb;
    float w = 0.02 + max(c.r, max(c.g, c.b));
    s += c * w; ws += w;
  }
  return s / ws;
}
void main(){ o = vec4(gl_FragCoord.x < 1.0 ? lit(a) : lit(b), 1.0); }
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
 *  mean colors and the harmony (all 0..1 RGB). */
export function harmonizeRgb(c: Rgb, mA: Rgb, mB: Rgb, h: number): Rgb {
  if (Math.abs(h) < 0.001) return c
  const pa = [dot(mA, U), dot(mA, V)], pb = [dot(mB, U), dot(mB, V)]
  const okA = smooth(0.015, 0.08, Math.hypot(pa[0], pa[1]))
  const okB = smooth(0.01, 0.05, Math.hypot(pb[0], pb[1]))
  const target = Math.atan2(pa[1], pa[0]) + (h > 0 ? Math.PI : 0)
  let d = target - Math.atan2(pb[1], pb[0]) + Math.PI
  d = d - 2 * Math.PI * Math.floor(d / (2 * Math.PI)) - Math.PI
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

/** Each layer's sources' mean colors (A, B), 0..1, read back a few times a
 *  second while the Mixer shows them (abSwatchWanted). Null : not measured. */
export const abSwatches: Array<{ a: Rgb; b: Rgb } | null> = [null, null, null, null]
let wanted = 0
/** The Mixer asks for the swatches while it is open (a count : it nests). */
export function wantAbSwatches(on: boolean): void {
  wanted = Math.max(0, wanted + (on ? 1 : -1))
}
export const abSwatchWanted = (): boolean => wanted > 0
