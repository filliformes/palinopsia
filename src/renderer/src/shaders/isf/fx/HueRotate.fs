/*{
  "DESCRIPTION": "Hue Rotate : Lumen's Hue Mod as a primitive: rotate the image's hue by an amount, optionally weighted by luminance (shift more in the lights, or the darks). The missing colour primitive : beautiful under a slow LFO (the whole picture cycling colour). Preserves saturation and value.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "shift",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "hue shift" },
    { "NAME": "byLuma", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "luma weight" }
  ]
}*/

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
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  // byLuma>0 → shift more in the highlights; <0 → more in the shadows.
  float w = 1.0 + byLuma * (l * 2.0 - 1.0);
  vec3 hsv = rgb2hsv(src.rgb);
  hsv.x = fract(hsv.x + shift * w);
  gl_FragColor = vec4(hsv2rgb(hsv), src.a);
}
