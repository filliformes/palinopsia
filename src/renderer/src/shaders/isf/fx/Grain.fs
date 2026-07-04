/*{
  "DESCRIPTION": "Grain — per-cell digital noise, luma-weighted so shadows stay clean(er) and mid-tones carry the texture. Matte static, not sparkle: subtractive-leaning, never additive glow.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Texture"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15 },
    { "NAME": "size",   "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 1.5 },
    { "NAME": "mono",   "TYPE": "bool",  "DEFAULT": true }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);

  vec2 cell = floor(gl_FragCoord.xy / max(size, 1.0));
  float seed = floor(TIME * 24.0); // refresh at ~24fps — filmic cadence
  float n = hash(cell + seed * 13.7) - 0.5;
  vec3 noise = vec3(n);
  if (!mono) {
    noise = vec3(
      n,
      hash(cell + seed * 13.7 + 101.0) - 0.5,
      hash(cell + seed * 13.7 + 202.0) - 0.5
    );
  }

  // Luma weighting — strongest in the mid-tones, tapering at both ends.
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  float w = smoothstep(0.0, 0.25, l) * (1.0 - smoothstep(0.7, 1.0, l) * 0.6);

  gl_FragColor = vec4(clamp(src.rgb + noise * amount * w, 0.0, 1.0), src.a);
}
