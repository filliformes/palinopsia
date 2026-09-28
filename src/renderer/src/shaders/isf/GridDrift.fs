/*{
  "DESCRIPTION": "Grid Drift : a flat grid whose rows and columns breathe out of alignment, with a stepped clock occasionally slipping whole lanes and a sparse set of filled cells. Structure degrading with dignity: matte line-work, never op-art.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry", "Glitch"],
  "INPUTS": [
    { "NAME": "cells",   "TYPE": "float", "MIN": 3.0,  "MAX": 40.0, "DEFAULT": 12.0 },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,  "DEFAULT": 0.12 },
    { "NAME": "breathe", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "slip",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.25 },
    { "NAME": "lineW",   "TYPE": "float", "MIN": 0.01, "MAX": 0.2,  "DEFAULT": 0.05, "LABEL": "line weight" },
    { "NAME": "density", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.12 },
    { "NAME": "audioScatter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio scatter" },
    { "NAME": "tint",    "TYPE": "color", "DEFAULT": [0.55, 0.6, 0.7, 1.0] },
    { "NAME": "reseed",  "TYPE": "event", "LABEL": "reseed ▸" },
    { "NAME": "audioTex","TYPE": "image" }
  ],
  "PASSES": [
    { "TARGET": "seedState", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { }
  ]
}*/

// Integrated clock (∫ rate dt, set by the engine) : a rate change alters the
// breathing and slipping tempo from here on, never jumps the picture.
uniform float PH_rate;

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

// A hash keyed on the stepped slip clock. `n` counts steps and grows without
// bound, so it is split into two small parts : every hash input stays small
// and exact, and the slips never loop or freeze.
float hashStep(vec2 key, float n, float salt) {
  float hi = floor(n / 2048.0);
  float lo = n - hi * 2048.0;
  return hash13(vec3(key.x + salt * 61.0, key.y + hash(vec2(hi, salt)) * 409.0, lo));
}

// Value noise along a clock axis (y) that tiles every 1024 : the clock is
// wrapped mod 1024 before it gets here, without a seam.
float vnoiseT(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float y0 = mod(i.y, 1024.0), y1 = y0 + 1.0;
  y1 *= step(y1, 1023.5);
  float a = hash(vec2(i.x, y0));
  float b = hash(vec2(i.x + 1.0, y0));
  float c = hash(vec2(i.x, y1));
  float d = hash(vec2(i.x + 1.0, y1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Per-element audio : the shared waveform texture (row 0), ±1 around silence.
float aud(float idx01) {
  vec2 ac = vec2(fract(idx01), 0.25);
  return (IMG_NORM_PIXEL(audioTex, ac).r - 0.5) * 2.0;
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
  float seedShift = floor(IMG_NORM_PIXEL(seedState, vec2(0.5)).x * 89.0);

  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float t = PH_rate;
  // The slip clock : cuts, counting ∫ (0.5 + 4·rate) dt.
  float tStep = floor(0.5 * TIME + 4.0 * PH_rate);

  vec2 g = vec2(uv.x * cells * aspect, uv.y * cells);
  float col0 = floor(g.x);
  float row0 = floor(g.y);

  // Breathe: every lane drifts continuously by its own slow noise; the reseed
  // salt re-deals every lane's character. Audio scatter rides each lane on its
  // OWN live sample (adjacent lanes read adjacent samples → travelling waves) :
  // rows read the first half of the waveform, columns the second.
  float rowA = row0 / cells * 0.5;
  float colA = 0.5 + col0 / (cells * aspect) * 0.5;
  row0 += seedShift;
  col0 += seedShift;
  float rowShift = (vnoiseT(vec2(row0 * 3.1, mod(t, 1024.0))) - 0.5) * breathe
    + aud(rowA) * audioScatter * 0.4;
  float colShift = (vnoiseT(vec2(col0 * 5.7, mod(t + 40.0, 1024.0))) - 0.5) * breathe
    + aud(colA) * audioScatter * 0.4;

  // Slip: a stepped clock occasionally knocks whole lanes off the grid.
  vec2 rk = vec2(row0, 0.0), ck = vec2(col0, 1.0);
  float rowSlip = step(1.0 - slip * 0.4, hashStep(rk, tStep, 1.0)) *
    (hashStep(rk, tStep, 2.0) - 0.5) * 1.5;
  float colSlip = step(1.0 - slip * 0.4, hashStep(ck, tStep, 3.0)) *
    (hashStep(ck, tStep, 4.0) - 0.5) * 1.5;

  vec2 gg = vec2(g.x + rowShift + rowSlip, g.y + colShift + colSlip);
  vec2 f = fract(gg);
  vec2 cell = floor(gg);

  // Matte line-work on both axes, anti-aliased in PIXELS (px = one pixel in
  // cell units) and never thinner than ~1.5 px, so lines neither crawl at
  // 1080p nor go soft at 4K.
  float px = cells / RENDERSIZE.y;
  float w = max(lineW * 0.5, 0.75 * px);
  float lx = 1.0 - smoothstep(w - 0.5 * px, w + 0.5 * px, min(f.x, 1.0 - f.x));
  float ly = 1.0 - smoothstep(w - 0.5 * px, w + 0.5 * px, min(f.y, 1.0 - f.y));
  float line = max(lx, ly);

  // A sparse population of filled cells, refreshed on the slip clock and
  // re-dealt by the reseed latch.
  vec2 fk = cell + seedShift;
  float lit = step(1.0 - density, hashStep(fk, tStep, 5.0));
  float shade = lit * (0.15 + 0.35 * hash13(vec3(fk, 3.0)));

  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 colr = base + tint.rgb * (line * 0.55 + shade);

  gl_FragColor = vec4(colr, 1.0);
}
