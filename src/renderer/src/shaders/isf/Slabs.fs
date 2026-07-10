/*{
  "DESCRIPTION": "Slabs : sparse horizontal slabs on a stepped clock, with slice-displacement jitter on a minority of bands and a single accent tint on rare cells. The slice/shuffle glitch register: stepped time (not flow), asymmetric, matte greys over near-black. CHAOS bends and distorts every cell on its own non-linear curve (each rectangle warps differently, not a global shear). NONLINEAR randomly thins the width and height of every cell so the slabs break into a field of many different lines. Built to be blended (difference / screen / multiply). Palinopsia seed generator.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Glitch", "Geometry"],
  "INPUTS": [
    { "NAME": "rate",      "TYPE": "float", "MIN": 0.0, "MAX": 20.0, "DEFAULT": 0.3 },
    { "NAME": "bands",     "TYPE": "float", "MIN": 4.0, "MAX": 80.0, "DEFAULT": 24.0 },
    { "NAME": "density",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "jitter",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "drift",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.2 },
    { "NAME": "accent",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.2 },
    { "NAME": "chaos",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0, "LABEL": "chaos (bend)" },
    { "NAME": "nonlinear", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0, "LABEL": "nonlinear (thin)" },
    { "NAME": "tint",      "TYPE": "color", "DEFAULT": [0.9, 0.5, 0.18, 1.0] }
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

  // CHAOS bends the grid NON-LINEARLY at CELL SCALE : the warp is sampled near
  // the band/cell frequency so each region (each rectangle) bends on its own
  // curve instead of the whole grid shearing together. The sin-of-noise and the
  // squared ripple are the non-linearities. Zero at chaos 0.
  if (chaos > 0.001) {
    float w = chaos;
    vec2 cq = vec2(uv.x * bands * 0.9, uv.y * bands);
    float a = vn(cq * 0.6 + TIME * 0.25);
    float b = vn(cq * 1.7 - TIME * 0.18);
    uv.x += (sin((a - 0.5) * 6.28318) * 0.5 + (b - 0.5)) * 0.13 * w;
    uv.y += (sin((b - 0.5) * 6.28318) * 0.4 + (a - 0.5)) * 0.08 * w;
    uv.x += pow(abs(sin(uv.y * bands * 3.14159 + a * 6.0)), 2.5) * 0.05 * w * sign(b - 0.5);
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

  // Local coords inside this cell (0..1 across the cell, 0..1 up the band).
  float lx = fract(x * cells);
  float ly = fract(uv.y * bands);
  float cseed = hash(vec2(cell * 7.0 + band * 131.0, 21.0));

  // CHAOS bends each rectangle's INTERIOR on its own non-linear curve, seeded per
  // cell, so every little cell warps a different way (creative, not a uniform shear).
  if (chaos > 0.001) {
    float bnd = chaos;
    lx += (sin(ly * 6.28318 + cseed * 6.28318) * 0.3
         + (vn(vec2(ly * 3.0 + cseed * 11.0, cseed * 7.0)) - 0.5)) * bnd * 0.6;
    ly += sin(lx * 6.28318 * 1.3 + cseed * 4.0) * bnd * 0.28;
  }

  // NONLINEAR : randomise each cell's WIDTH and HEIGHT independently (only ever
  // THINNER, never fatter) so the slabs break into a field of many different
  // lines / thin rectangles. `inCell` carves the cell down to that sub-rectangle.
  float wf = mix(1.0, 0.12 + 0.88 * hash(vec2(cell * 7.0 + band * 131.0, 3.0)), nonlinear);
  float hf = mix(1.0, 0.12 + 0.88 * hash(vec2(cell * 7.0 + band * 131.0, 8.0)), nonlinear);
  float inCell = step(abs(lx - 0.5), wf * 0.5) * step(abs(ly - 0.5), hf * 0.5);

  float v = hash(vec2(cell * 17.0 + band * 131.0, tC));
  float lit = step(1.0 - density * mix(1.0, 1.6, isChaos), v) * inCell;

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
