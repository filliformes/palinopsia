/*{
  "DESCRIPTION": "Hue Rotate : a hue-rotation primitive: rotate the image's hue by an amount, optionally weighted by luminance (shift more in the lights, or the darks). Cycle rate turns the wheel on its own, so the whole picture cycles color with no modulator and the shift knob stays free. Preserves saturation and value.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "shift",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "hue shift" },
    { "NAME": "byLuma", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "luma weight" },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0,  "MAX": 0.2, "DEFAULT": 0.0, "LABEL": "cycle rate" }
  ],
  "PASSES": [
    { "TARGET": "cycleLatch", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { }
  ]
}*/

// ∫ rate dt on the layer clock (engine/phases.ts) : turning `rate` changes the
// speed of the cycle from here on, never jumps the hue.
uniform float PH_rate;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  // The engine starts every phase at a random offset, which would turn the hue
  // by a random amount even at rate 0. Pass 0 latches the phase this instance
  // started at (16 bits over two 8-bit channels) and the cycle is counted from
  // there : rate 0 is exactly today's picture, and PANIC (which empties the
  // latch) returns the wheel to zero.
  float ph = fract(PH_rate);
  vec2 lc = vec2(0.5);
  vec4 st = IMG_NORM_PIXEL(cycleLatch, lc);
  if (PASSINDEX == 0) {
    if (st.a > 0.5) { gl_FragColor = st; return; }
    gl_FragColor = vec4(floor(ph * 255.0) / 255.0, fract(ph * 255.0), 0.0, 1.0);
    return;
  }
  float cyc = st.a > 0.5 ? fract(ph - (st.x + st.y / 255.0)) : 0.0;

  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  // byLuma>0 → shift more in the highlights; <0 → more in the shadows.
  float w = 1.0 + byLuma * (l * 2.0 - 1.0);
  vec3 hsv = rgb2hsv(src.rgb);
  // The cycle turns the whole wheel evenly (not luma-weighted : weighting a
  // growing phase would smear the picture into ever finer hue bands).
  hsv.x = fract(hsv.x + shift * w + cyc);
  gl_FragColor = vec4(hsv2rgb(hsv), src.a);
}
