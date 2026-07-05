/*{
  "DESCRIPTION": "Filaments — vertical strands swaying like kelp: each filament is a curve whose lateral sway deepens toward the free end, with its own rate and phase. Matte line-work over near-black; drift makes the whole bed lean.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "strands", "TYPE": "float", "MIN": 3.0,  "MAX": 40.0, "DEFAULT": 14.0 },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,  "DEFAULT": 0.4 },
    { "NAME": "sway",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.45 },
    { "NAME": "width",   "TYPE": "float", "MIN": 0.05, "MAX": 0.6,  "DEFAULT": 0.18 },
    { "NAME": "lean",    "TYPE": "float", "MIN": -1.0, "MAX": 1.0,  "DEFAULT": 0.15 },
    { "NAME": "tint",    "TYPE": "color", "DEFAULT": [0.5, 0.68, 0.55, 1.0] }
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

// Lateral offset of strand k at height y (0 = root, 1 = free end).
float strandX(float k, float y, float t) {
  float own = 0.6 + hash(vec2(k, 3.3)) * 0.8; // per-strand rate
  float phase = hash(vec2(k, 7.7)) * 6.2832;
  // Sway grows toward the free end (y²) — anchored at the root.
  float s = sin(t * own + phase + y * (2.0 + hash(vec2(k, 11.0)) * 3.0));
  float n = vnoise(vec2(k * 3.1, y * 2.0 + t * 0.3)) - 0.5;
  return (s * 0.6 + n * 0.8) * sway * y * y * 0.35 + lean * y * y * 0.25;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float t = TIME * rate * 2.0;
  float px = 1.0 / strands;

  float lum = 0.0;
  float k0 = floor(uv.x * strands);
  for (int i = -2; i <= 2; i++) {
    float k = k0 + float(i);
    if (k < 0.0 || k >= strands) continue;
    float rootX = (k + 0.5) * px + (hash(vec2(k, 1.0)) - 0.5) * px * 0.8;
    float x = rootX + strandX(k, uv.y, t);
    float d = abs(uv.x - x);
    // Strands taper toward the free end.
    float w = width * px * (1.0 - uv.y * 0.6);
    float line = 1.0 - smoothstep(w * 0.4, w, d);
    // Root darker, tip brighter — the light is above.
    lum = max(lum, line * (0.35 + 0.65 * uv.y) * (0.6 + 0.4 * hash(vec2(k, 5.0))));
  }

  vec3 base = vec3(0.02, 0.025, 0.025);
  vec3 col = base + tint.rgb * lum * 0.85;
  gl_FragColor = vec4(col, 1.0);
}
