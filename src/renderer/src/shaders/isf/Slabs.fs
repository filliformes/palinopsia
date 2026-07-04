/*{
  "DESCRIPTION": "Slabs — sparse horizontal slabs on a stepped clock, with slice-displacement jitter on a minority of bands and a single accent tint on rare cells. The slice/shuffle glitch register: stepped time (not flow), asymmetric, matte greys over near-black. Contrasts with Drift Field's continuous drift; built to be blended (difference / screen / multiply). Palinopsia seed generator.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Glitch", "Geometry"],
  "INPUTS": [
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.3 },
    { "NAME": "bands",   "TYPE": "float", "MIN": 4.0, "MAX": 80.0, "DEFAULT": 24.0 },
    { "NAME": "density", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "jitter",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "drift",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.2 },
    { "NAME": "accent",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.2 },
    { "NAME": "tint",    "TYPE": "color", "DEFAULT": [0.9, 0.5, 0.18, 1.0] }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;

  // Stepped clock — the glitch register moves in cuts, not flow.
  float t = floor(TIME * (0.5 + rate * 5.5));

  float band = floor(uv.y * bands);

  // A minority of bands get horizontally displaced this step (slice-shuffle).
  float pick = hash(vec2(band, t));
  float disp = step(1.0 - jitter * 0.5, pick) * (hash(vec2(band, t + 13.7)) - 0.5) * 0.4;

  // Slow per-band scroll keeps it asymmetric even between cuts.
  float x = fract(uv.x + disp + drift * TIME * 0.03 * (hash(vec2(band, 3.0)) - 0.5) * 2.0);

  // Coarse cells along the band; sparse subset lit.
  float cells = 5.0 + floor(hash(vec2(band, 27.0)) * 6.0);
  float cell = floor(x * cells);
  float v = hash(vec2(cell * 17.0 + band * 131.0, t));
  float lit = step(1.0 - density, v);

  // Matte grey slab values — mid-tones, never neon.
  float shade = lit * (0.18 + 0.55 * hash(vec2(cell + 7.0, band)));
  vec3 col = vec3(0.03, 0.03, 0.035) + vec3(shade);

  // Rare accent cells carry the single tint.
  float acc = step(1.0 - accent * 0.35, hash(vec2(band * 3.1, cell + t)));
  col = mix(col, tint.rgb * (0.25 + shade), acc * lit);

  // Faint scanline signature — controlled texture, never spectacle.
  col *= 0.94 + 0.06 * sin(uv.y * RENDERSIZE.y * 3.14159);

  gl_FragColor = vec4(col, 1.0);
}
