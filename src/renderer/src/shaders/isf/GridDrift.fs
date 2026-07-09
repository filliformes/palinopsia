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
    { "NAME": "lineW",   "TYPE": "float", "MIN": 0.01, "MAX": 0.2,  "DEFAULT": 0.05 },
    { "NAME": "density", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.12 },
    { "NAME": "tint",    "TYPE": "color", "DEFAULT": [0.55, 0.6, 0.7, 1.0] }
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

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float t = TIME * rate;
  float tStep = floor(TIME * (0.5 + rate * 4.0)); // the slip clock : cuts

  vec2 g = vec2(uv.x * cells * aspect, uv.y * cells);
  float col0 = floor(g.x);
  float row0 = floor(g.y);

  // Breathe: every lane drifts continuously by its own slow noise.
  float rowShift = (vnoise(vec2(row0 * 3.1, t)) - 0.5) * breathe;
  float colShift = (vnoise(vec2(col0 * 5.7, t + 40.0)) - 0.5) * breathe;

  // Slip: a stepped clock occasionally knocks whole lanes off the grid.
  float rowSlip = step(1.0 - slip * 0.4, hash(vec2(row0, tStep))) *
    (hash(vec2(row0, tStep + 11.0)) - 0.5) * 1.5;
  float colSlip = step(1.0 - slip * 0.4, hash(vec2(col0, tStep + 5.0))) *
    (hash(vec2(col0, tStep + 17.0)) - 0.5) * 1.5;

  vec2 gg = vec2(g.x + rowShift + rowSlip, g.y + colShift + colSlip);
  vec2 f = fract(gg);
  vec2 cell = floor(gg);

  // Matte line-work on both axes.
  float lx = 1.0 - smoothstep(0.0, lineW, min(f.x, 1.0 - f.x));
  float ly = 1.0 - smoothstep(0.0, lineW, min(f.y, 1.0 - f.y));
  float line = max(lx, ly);

  // A sparse population of filled cells, refreshed on the slip clock.
  float lit = step(1.0 - density, hash(cell + tStep * 0.37));
  float shade = lit * (0.15 + 0.35 * hash(cell + 3.0));

  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 colr = base + tint.rgb * (line * 0.55 + shade);

  colr *= 0.94 + 0.06 * sin(uv.y * RENDERSIZE.y * 3.14159);
  gl_FragColor = vec4(colr, 1.0);
}
