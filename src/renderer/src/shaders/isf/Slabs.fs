/*{
  "DESCRIPTION": "Slabs : sparse horizontal slabs on a stepped clock, with slice-displacement jitter on a minority of bands and a single accent tint on rare cells. The slice/shuffle glitch register: stepped time (not flow), asymmetric, matte grays over near-black. CHAOS bends and distorts every cell on its own non-linear curve (each rectangle warps differently, not a global shear) and turns a minority of bands rogue. NONLINEAR randomly thins the width and height of every cell so the slabs break into a field of many different lines. SPECTRUM LIGHT lets each band light more cells as its own frequency band gets loud (bass at the bottom, treble at the top). Built to be blended (difference / screen / multiply). Palinopsia seed generator.",
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
    { "NAME": "chaos",     "TYPE": "float", "MIN": 0.0, "MAX": 0.2,  "DEFAULT": 0.0, "LABEL": "chaos (bend + break)" },
    { "NAME": "nonlinear", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0, "LABEL": "nonlinear (thin)" },
    { "NAME": "audioScatter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio scatter" },
    { "NAME": "audioLight", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "spectrum light" },
    { "NAME": "tint",      "TYPE": "color", "DEFAULT": [0.9, 0.5, 0.18, 1.0] },
    { "NAME": "reseed",    "TYPE": "event", "LABEL": "reseed ▸" },
    { "NAME": "audioTex",  "TYPE": "image" }
  ],
  "PASSES": [
    { "TARGET": "seedState", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { }
  ]
}*/

// Integrated phases (set by the engine) : a knob change alters the tempo from
// here on, never jumps the picture. PH_rate = ∫ rate dt, PH_drift = ∫ drift dt.
uniform float PH_rate;
uniform float PH_drift;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// A hash keyed on a stepped clock. `n` counts cuts and grows without bound, so
// it is split into two small parts : every hash input stays small and exact,
// and the cut sequence never loops or freezes (exact up to 2^24 cuts).
float hashStep(vec2 key, float n, float salt) {
  float hi = floor(n / 2048.0);
  float lo = n - hi * 2048.0;
  return hash13(vec3(key.x + salt * 61.0, key.y + hash(vec2(hi, salt)) * 409.0, lo));
}

// Smooth 2D value noise (for the chaos domain warp : bends, not per-pixel snow).
// Tiles every 256 cells, so its clock offsets can be wrapped without a seam.
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, 256.0), i1 = i0 + 1.0;
  i1 *= step(i1, vec2(255.5));
  float a = hash(i0), b = hash(vec2(i1.x, i0.y));
  float c = hash(vec2(i0.x, i1.y)), d = hash(i1);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Per-element audio : the shared waveform texture (row 0), ±1 around silence.
float aud(float idx01) {
  vec2 ac = vec2(fract(idx01), 0.25);
  return (IMG_NORM_PIXEL(audioTex, ac).r - 0.5) * 2.0;
}
// The shared spectrum (row 1, log-spaced : 0 = bass, 1 = treble), 0..1.
float spec(float idx01) {
  vec2 ac = vec2(clamp(idx01, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

void main() {
  // Pass 0 : the 1×1 reseed latch (rising-edge → golden-ratio seed step).
  if (PASSINDEX == 0) {
    vec4 prev = IMG_NORM_PIXEL(seedState, vec2(0.5));
    float fire = (reseed && prev.y < 0.5) ? 1.0 : 0.0;
    float s = fract(prev.x + fire * (0.61803399 + fract(TIME * 0.7317)));
    gl_FragColor = vec4(s, reseed ? 1.0 : 0.0, 0.0, 1.0);
    return;
  }
  float seedShift = IMG_NORM_PIXEL(seedState, vec2(0.5)).x * 89.0;

  vec2 uv = isf_FragNormCoord;

  // Stepped clock : the glitch register moves in cuts, not flow. It counts
  // ∫ (0.5 + 5.5·rate) dt, so turning `rate` changes the cut tempo only.
  float t = floor(0.5 * TIME + 5.5 * PH_rate);

  // CHAOS bends the grid NON-LINEARLY at CELL SCALE : the warp is sampled near
  // the band/cell frequency so each region (each rectangle) bends on its own
  // curve instead of the whole grid shearing together. The sin-of-noise and the
  // squared ripple are the non-linearities. Zero at chaos 0.
  if (chaos > 0.001) {
    float w = chaos;
    vec2 cq = vec2(uv.x * bands * 0.9, uv.y * bands);
    float a = vn(cq * 0.6 + mod(TIME * 0.25, 256.0));
    float b = vn(cq * 1.7 - mod(TIME * 0.18, 256.0));
    uv.x += (sin((a - 0.5) * 6.28318) * 0.5 + (b - 0.5)) * 0.13 * w;
    uv.y += (sin((b - 0.5) * 6.28318) * 0.4 + (a - 0.5)) * 0.08 * w;
    uv.x += pow(abs(sin(uv.y * bands * 3.14159 + a * 6.0)), 2.5) * 0.05 * w * sign(b - 0.5);
  }

  float bandRaw = floor(uv.y * bands);
  float band = bandRaw;

  // Per-band audio displacement : each slab band slides on its OWN live sample
  // (adjacent bands read adjacent samples → the waveform ripples the stack).
  if (audioScatter > 0.001) uv.x += aud(band / bands) * audioScatter * 0.22;

  // The reseed latch : band only ever feeds the hashes below, so salting it
  // re-deals every band-keyed decision (widths, picks, accents) in one move.
  band += floor(seedShift);

  // CHAOTIC bands: a chaos-sized minority of bands break the grid's rules :
  // wildly different cell widths, oversized displacement, thin sub-stripes
  // carving the slab, occasionally running on their own faster clock.
  float chaosPick = hash(vec2(band, 99.7));
  float isChaos = step(1.0 - chaos * 0.6, chaosPick);
  float fastT = floor(TIME * (2.0 + hash(vec2(band, 55.0)) * 20.0));
  float tC = mix(t, fastT, isChaos * step(0.5, hash(vec2(band, 71.0))));

  // A minority of bands get horizontally displaced this step (slice-shuffle).
  vec2 bk = vec2(band, 0.0);
  float pick = hashStep(bk, tC, 1.0);
  float dispAmt = mix(0.4, 1.6, isChaos); // chaotic bands throw much further
  float disp = step(1.0 - jitter * 0.5, pick) * (hashStep(bk, tC, 2.0) - 0.5) * dispAmt;

  // Slow per-band scroll keeps it asymmetric even between cuts.
  float x = fract(uv.x + disp + PH_drift * 0.03 * (hash(vec2(band, 3.0)) - 0.5) * 2.0);

  // Coarse cells along the band; sparse subset lit. Chaotic bands get cell
  // counts far outside the family : hair-thin shards or one giant slab (whole
  // cells only, so no partial cell rides the scroll).
  float cells = 5.0 + floor(hash(vec2(band, 27.0)) * 6.0);
  float cellsChaos = floor(mix(1.0, 40.0, pow(hash(vec2(band, 61.0)), 2.0)));
  cells = mix(cells, cellsChaos, isChaos);
  float cell = floor(x * cells);
  vec2 ck = vec2(cell, band);

  // Local coords inside this cell (0..1 across the cell, 0..1 up the band).
  float lx = fract(x * cells);
  float ly = fract(uv.y * bands);
  float cseed = hash13(vec3(ck, 21.0));

  // CHAOS bends each rectangle's INTERIOR on its own non-linear curve, seeded per
  // cell, so every little cell warps a different way (creative, not a uniform shear).
  if (chaos > 0.001) {
    float bnd = chaos;
    lx += (sin(ly * 6.28318 + cseed * 6.28318) * 0.3
         + (vn(vec2(ly * 3.0 + cseed * 11.0, cseed * 7.0)) - 0.5)) * bnd * 0.6;
    ly += sin(lx * 6.28318 * 1.3 + cseed * 4.0) * bnd * 0.28;
  }

  // NONLINEAR : randomize each cell's WIDTH and HEIGHT independently (only ever
  // THINNER, never fatter) so the slabs break into a field of many different
  // lines / thin rectangles. `inCell` carves the cell down to that sub-rectangle.
  float wf = mix(1.0, 0.12 + 0.88 * hash13(vec3(ck, 3.0)), nonlinear);
  float hf = mix(1.0, 0.12 + 0.88 * hash13(vec3(ck, 8.0)), nonlinear);
  float inCell = step(abs(lx - 0.5), wf * 0.5) * step(abs(ly - 0.5), hf * 0.5);

  // SPECTRUM LIGHT : each band's lit share rides its own frequency bin (bass
  // at the bottom, treble at the top), a spectrum-analyzer reading of the slabs.
  float dens = density * mix(1.0, 1.6, isChaos);
  if (audioLight > 0.001) dens += spec((bandRaw + 0.5) / bands) * audioLight;

  float v = hashStep(ck, tC, 3.0);
  float lit = step(1.0 - dens, v) * inCell;

  // Matte grey slab values : mid-tones, never neon.
  float shade = lit * (0.18 + 0.55 * hash13(vec3(ck, 7.0)));

  // Chaotic bands: thin broken sub-stripes carve the slab vertically, and
  // some flip to a bright-on-dark inversion.
  float subN = 2.0 + floor(hash(vec2(band, 83.0)) * 5.0);
  float sub = step(0.35, fract(uv.y * bands * subN));
  shade = mix(shade, shade * sub, isChaos * step(0.4, hash(vec2(band, 91.0))));
  shade = mix(shade, lit * (0.75 - shade), isChaos * step(0.75, hashStep(bk, tC, 4.0)));
  vec3 col = vec3(0.03, 0.03, 0.035) + vec3(shade);

  // Rare accent cells carry the single tint.
  float acc = step(1.0 - accent * 0.35, hashStep(ck, t, 5.0));
  col = mix(col, tint.rgb * (0.25 + shade), acc * lit);

  gl_FragColor = vec4(col, 1.0);
}
