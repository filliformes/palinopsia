/*{
  "DESCRIPTION": "Slabs : sparse horizontal slabs on a stepped clock, with slice-displacement jitter on a minority of bands and a single accent tint on rare cells. The slice/shuffle glitch register: stepped time (not flow), asymmetric, matte greys over near-black. Contrasts with Drift Field's continuous drift; built to be blended (difference / screen / multiply). Palinopsia seed generator.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Glitch", "Geometry"],
  "INPUTS": [
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0, "MAX": 20.0,  "DEFAULT": 0.3 },
    { "NAME": "bands",   "TYPE": "float", "MIN": 4.0, "MAX": 80.0, "DEFAULT": 24.0 },
    { "NAME": "density", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "jitter",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "drift",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.2 },
    { "NAME": "accent",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.2 },
    { "NAME": "chaos",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0 },
    { "NAME": "tint",    "TYPE": "color", "DEFAULT": [0.9, 0.5, 0.18, 1.0] }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

// Smooth 2D value noise (for the chaos domain warp : bends, not per-pixel snow).
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;

  // Stepped clock : the glitch register moves in cuts, not flow.
  float t = floor(TIME * (0.5 + rate * 5.5));

  // CHAOS also BENDS the whole grid : a smooth low-frequency domain warp (plus a
  // faster ripple) so the square cells stop reading as clean rectangles : wavy,
  // sheared ribbons at high chaos. Warps x more than y so the bands stay roughly
  // horizontal (still "slabs") but lose their hard geometry. Zero at chaos 0.
  if (chaos > 0.001) {
    float w = chaos;
    uv.x += ((vn(vec2(uv.y * 5.0, TIME * 0.35)) - 0.5) * 0.28
           + sin(uv.y * 11.0 + TIME * 0.6) * 0.05) * w;
    uv.y += ((vn(vec2(uv.x * 4.0, TIME * 0.3 + 9.0)) - 0.5) * 0.10
           + sin(uv.x * 8.0 - TIME * 0.45) * 0.02) * w;
  }

  float band = floor(uv.y * bands);

  // CHAOTIC bands: a chaos-sized minority of bands break the grid's rules —
  // wildly different cell widths, oversized displacement, thin sub-stripes
  // carving the slab, occasionally running on their own faster clock.
  float chaosPick = hash(vec2(band, 99.7));
  float isChaos = step(1.0 - chaos * 0.6, chaosPick);
  float tC = mix(t, floor(TIME * (2.0 + hash(vec2(band, 55.0)) * 20.0)), isChaos * step(0.5, hash(vec2(band, 71.0))));

  // A minority of bands get horizontally displaced this step (slice-shuffle).
  float pick = hash(vec2(band, tC));
  float dispAmt = mix(0.4, 1.6, isChaos); // chaotic bands throw much further
  float disp = step(1.0 - jitter * 0.5, pick) * (hash(vec2(band, tC + 13.7)) - 0.5) * dispAmt;

  // Slow per-band scroll keeps it asymmetric even between cuts.
  float x = fract(uv.x + disp + drift * TIME * 0.03 * (hash(vec2(band, 3.0)) - 0.5) * 2.0);

  // Coarse cells along the band; sparse subset lit. Chaotic bands get cell
  // counts far outside the family : hair-thin shards or one giant slab.
  float cells = 5.0 + floor(hash(vec2(band, 27.0)) * 6.0);
  float cellsChaos = mix(1.0, 40.0, pow(hash(vec2(band, 61.0)), 2.0));
  cells = mix(cells, cellsChaos, isChaos);
  float cell = floor(x * cells);
  float v = hash(vec2(cell * 17.0 + band * 131.0, tC));
  float lit = step(1.0 - density * mix(1.0, 1.6, isChaos), v);

  // Matte grey slab values : mid-tones, never neon.
  float shade = lit * (0.18 + 0.55 * hash(vec2(cell + 7.0, band)));

  // Chaotic bands: thin broken sub-stripes carve the slab vertically, and
  // some flip to a bright-on-dark inversion.
  float subN = 2.0 + floor(hash(vec2(band, 83.0)) * 5.0);
  float sub = step(0.35, fract(uv.y * bands * subN));
  shade = mix(shade, shade * sub, isChaos * step(0.4, hash(vec2(band, 91.0))));
  shade = mix(shade, lit * (0.75 - shade), isChaos * step(0.75, hash(vec2(band, tC + 5.0))));
  vec3 col = vec3(0.03, 0.03, 0.035) + vec3(shade);

  // Rare accent cells carry the single tint.
  float acc = step(1.0 - accent * 0.35, hash(vec2(band * 3.1, cell + t)));
  col = mix(col, tint.rgb * (0.25 + shade), acc * lit);

  // Faint scanline signature : controlled texture, never spectacle.
  col *= 0.94 + 0.06 * sin(uv.y * RENDERSIZE.y * 3.14159);

  gl_FragColor = vec4(col, 1.0);
}
