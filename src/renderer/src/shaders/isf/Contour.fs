/*{
  "DESCRIPTION": "Contour — slow marching contour lines over a drifting, domain-warped noise basin. The topographic register (the disciplined nannou-sketch look): matte line-work over near-black, optional faint band fill. Asymmetric by construction.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Noise", "Geometry"],
  "INPUTS": [
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.1 },
    { "NAME": "scale",  "TYPE": "float", "MIN": 0.5,  "MAX": 8.0,  "DEFAULT": 2.2 },
    { "NAME": "levels", "TYPE": "float", "MIN": 3.0,  "MAX": 30.0, "DEFAULT": 12.0 },
    { "NAME": "width",  "TYPE": "float", "MIN": 0.02, "MAX": 0.5,  "DEFAULT": 0.12 },
    { "NAME": "warp",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.5,  "DEFAULT": 0.5 },
    { "NAME": "fill",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.15 },
    { "NAME": "tint",   "TYPE": "color", "DEFAULT": [0.75, 0.78, 0.72, 1.0] }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 5; k++) {
    s += a * vnoise(p);
    p = p * 2.02 + 7.1;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 aspect = vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0);
  vec2 p = (uv - 0.5) * aspect * scale;
  float t = TIME * rate;

  // The basin: fbm with directional drift + a warp of itself.
  vec2 flow = vec2(fbm(p * 0.6 + t * 0.4), fbm(p.yx * 0.6 - t * 0.3));
  float n = fbm(p + warp * flow + vec2(t * 0.5, -t * 0.2));

  // Elevation bands. A line lives wherever the banded value crosses zero.
  float f = fract(n * levels);
  float line = 1.0 - (smoothstep(0.0, width * 0.5, f) * smoothstep(1.0, 1.0 - width * 0.5, f));

  // Faint band fill (staircase shading) under the line-work.
  float band = floor(n * levels) / levels;
  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 col = base + tint.rgb * (band * fill * 0.35);
  col += tint.rgb * line * 0.85;

  // Faint scanline signature.
  col *= 0.94 + 0.06 * sin(uv.y * RENDERSIZE.y * 3.14159);

  gl_FragColor = vec4(col, 1.0);
}
