/*{
  "DESCRIPTION": "Ten Print : the Commodore one-liner maze (10 PRINT CHR$(205.5+RND(1))). Every cell holds one diagonal, / or \\, dealt by a seeded coin-flip : together they read as an endless maze. RESEED re-deals the whole lattice on a trigger (bind M to fire it from audio : the EYESY gesture); FLIP lets sparse cells flip on their own stepped clock between deals. AUDIO SCATTER rotates each segment by its own live audio sample, so the maze shivers apart with sound and reconnects in silence. Matte line-work over near-black.",
  "CREDIT": "Palinopsia (after 10 PRINT / EYESY)",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry", "Glitch"],
  "INPUTS": [
    { "NAME": "cells",        "TYPE": "float", "MIN": 6.0,  "MAX": 64.0, "DEFAULT": 22.0 },
    { "NAME": "thickness",    "TYPE": "float", "MIN": 0.02, "MAX": 0.4,  "DEFAULT": 0.12 },
    { "NAME": "bias",         "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.5, "LABEL": "slant bias" },
    { "NAME": "flip",         "TYPE": "float", "MIN": 0.0,  "MAX": 8.0,  "DEFAULT": 0.6, "LABEL": "flip clock" },
    { "NAME": "audioScatter", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.25, "LABEL": "audio scatter" },
    { "NAME": "accent",       "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.12 },
    { "NAME": "ink",          "TYPE": "color", "DEFAULT": [0.78, 0.79, 0.76, 1.0] },
    { "NAME": "tint",         "TYPE": "color", "DEFAULT": [0.9, 0.5, 0.18, 1.0] },
    { "NAME": "reseed",       "TYPE": "event", "LABEL": "reseed ▸" },
    { "NAME": "audioTex",     "TYPE": "image" }
  ],
  "PASSES": [
    { "TARGET": "seedState", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

// Per-element audio : the shared waveform texture (row 0), ±1 around silence.
float aud(float idx01) {
  return (IMG_NORM_PIXEL(audioTex, vec2(fract(idx01), 0.25)).r - 0.5) * 2.0;
}

void main() {
  // Pass 0 : the 1×1 reseed latch. Rising edge on `reseed` steps the seed by
  // the golden ratio (time-salted so repeats never land on the same deal);
  // channel .y remembers the trigger level so a held 1 fires exactly once.
  if (PASSINDEX == 0) {
    vec4 prev = IMG_NORM_PIXEL(seedState, vec2(0.5));
    float fire = (reseed && prev.y < 0.5) ? 1.0 : 0.0;
    float s = fract(prev.x + fire * (0.61803399 + fract(TIME * 0.7317)));
    gl_FragColor = vec4(s, reseed ? 1.0 : 0.0, 0.0, 1.0);
    return;
  }

  float seedShift = IMG_NORM_PIXEL(seedState, vec2(0.5)).x * 89.0;

  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 g = vec2(uv.x * aspect, uv.y) * cells;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;

  // The coin flip : / or \ per cell, dealt from the latched seed. FLIP lets a
  // sparse population flip on its own stepped clock between deals (cuts, not
  // flow) : 0 = the lattice holds perfectly still until you reseed.
  float tStep = floor(TIME * flip);
  float base = step(hash(cell + seedShift), bias);
  float flipped = step(0.94, hash(cell + seedShift + tStep * 7.31)) * step(0.001, flip);
  float slant = abs(base - flipped); // XOR

  // The diagonal : ±45°, micro-rotated by this cell's OWN audio sample
  // (adjacent cells read adjacent samples → waves travel across the maze).
  float colsTotal = ceil(cells * aspect);
  float idx01 = (cell.y * colsTotal + cell.x) / (colsTotal * cells);
  float ang = (slant * 2.0 - 1.0) * 0.78539816 + aud(idx01) * audioScatter * 0.6;

  vec2 dir = vec2(cos(ang), sin(ang));
  float along = dot(f, dir);
  float d = abs(dot(f, vec2(-dir.y, dir.x)));
  // Clip the infinite line to the cell's diagonal reach; soften the tips a touch.
  float tip = smoothstep(0.7671, 0.6871, abs(along));
  float w = thickness * 0.5;
  float line = (1.0 - smoothstep(w * 0.6, w + 0.015, d)) * tip;

  // Rare accent cells carry the single tint; everything else is matte ink.
  float acc = step(1.0 - accent * 0.3, hash(cell * 1.7 + seedShift + 31.0));
  vec3 base3 = vec3(0.025, 0.025, 0.03);
  vec3 col = base3 + mix(ink.rgb, tint.rgb, acc) * line * (0.55 + 0.45 * hash(cell + 13.0));

  // Faint scanline signature : controlled texture, never spectacle.
  col *= 0.94 + 0.06 * sin(uv.y * RENDERSIZE.y * 3.14159);
  gl_FragColor = vec4(col, 1.0);
}
