/*{
  "DESCRIPTION": "Ten Print : the one-line maze program (10 PRINT CHR$(205.5+RND(1)); : GOTO 10). Every cell holds one diagonal, / or \\, dealt by a seeded coin-flip : together they read as an endless maze. STYLE swaps the diagonals for quarter-circle arcs, a maze of winding curves. RESEED re-deals the whole lattice on a trigger (bind M to fire it from audio : a new maze on every hit); FLIP lets sparse cells flip on their own stepped clock between deals. AUDIO SCATTER turns each diagonal (or swells each arc) by its own live audio sample, so the maze shivers apart with sound and reconnects in silence. Matte line-work over near-black.",
  "CREDIT": "Palinopsia (after the one-line maze program)",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry", "Glitch"],
  "INPUTS": [
    { "NAME": "cells",        "TYPE": "float", "MIN": 6.0,  "MAX": 64.0, "DEFAULT": 22.0 },
    { "NAME": "thickness",    "TYPE": "float", "MIN": 0.02, "MAX": 0.4,  "DEFAULT": 0.12 },
    { "NAME": "bias",         "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.5, "LABEL": "slant bias" },
    { "NAME": "flip",         "TYPE": "float", "MIN": 0.0,  "MAX": 8.0,  "DEFAULT": 0.6, "LABEL": "flip clock" },
    { "NAME": "audioScatter", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.25, "LABEL": "audio scatter" },
    { "NAME": "accent",       "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.12 },
    { "NAME": "style",        "TYPE": "long",  "VALUES": [0, 1], "LABELS": ["diagonals", "arcs"], "DEFAULT": 0, "LABEL": "style" },
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

// Integrated flip clock (∫ flip dt, set by the engine) : turning `flip`
// changes how often cells flip from here on, never re-deals the lattice.
uniform float PH_flip;

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

// A hash keyed on the stepped flip clock. `n` counts steps and grows without
// bound, so it is split into two small parts : every hash input stays small
// and exact (no precision collapse into whole-column flips on long shows).
float hashStep(vec2 key, float n, float salt) {
  float hi = floor(n / 2048.0);
  float lo = n - hi * 2048.0;
  return hash13(vec3(key.x + salt * 61.0, key.y + hash(vec2(hi, salt)) * 409.0, lo));
}

// Per-element audio : the shared waveform texture (row 0), ±1 around silence.
float aud(float idx01) {
  vec2 ac = vec2(fract(idx01), 0.25);
  return (IMG_NORM_PIXEL(audioTex, ac).r - 0.5) * 2.0;
}

// Distance to a quarter arc of radius r about corner c of the cell, bending
// into the cell (q = the quadrant's direction); round caps past its ends.
float arcDist(vec2 f, vec2 c, float r) {
  vec2 d = (f - c) * (-2.0 * c);
  if (d.x >= 0.0 && d.y >= 0.0) return abs(length(d) - r);
  return min(length(d - vec2(r, 0.0)), length(d - vec2(0.0, r)));
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

  // Stroke half-width in cell units, anti-aliased over one PIXEL (px) and never
  // thinner than ~1.5 px : crisp at 64 cells on 1080p, not blurry at 4K.
  float px = cells / RENDERSIZE.y;
  float hw = max(thickness * 0.45, 0.75 * px);

  // FLIP lets a sparse population flip on its own stepped clock between deals
  // (cuts, not flow) : 0 = the lattice holds perfectly still until you reseed.
  float tStep = floor(PH_flip);
  float flipOn = step(0.001, flip);
  float colsTotal = ceil(cells * aspect);

  // Every stroke touching a lattice vertex is drawn by the 4 cells around it,
  // so joins are whole (no pinched or notched corners where a stroke used to
  // be clipped by its own cell).
  vec2 v = floor(g + 0.5);
  vec3 col = vec3(0.0);
  float best = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 cell = v + vec2(float(i) - 1.0, float(j) - 1.0);
      vec2 f = g - cell - 0.5;
      vec2 sk = cell + seedShift;

      // The coin flip : / or \ per cell, dealt from the latched seed.
      float base = step(hash13(vec3(sk, 1.0)), bias);
      float flipped = step(0.94, hashStep(sk, tStep, 1.0)) * flipOn;
      float slant = abs(base - flipped); // XOR

      // This cell's OWN audio sample (adjacent cells read adjacent samples →
      // waves travel across the maze).
      float idx01 = (cell.y * colsTotal + cell.x) / (colsTotal * cells);
      float a = aud(idx01) * audioScatter;

      float d;
      if (style == 1) {
        // Quarter-circle arcs about two opposite corners; the radius swells
        // with sound, so the curves part from the cell edges and reconnect.
        vec2 c1 = slant > 0.5 ? vec2(0.5, -0.5) : vec2(-0.5, -0.5);
        float r = 0.5 + a * 0.18;
        d = min(arcDist(f, c1, r), arcDist(f, -c1, r));
      } else {
        // The diagonal : ±45°, corner to corner, micro-rotated by the audio.
        float ang = (slant * 2.0 - 1.0) * 0.78539816 + a * 0.6;
        vec2 dir = vec2(cos(ang), sin(ang));
        d = length(f - dir * clamp(dot(f, dir), -0.7071, 0.7071));
      }
      float cov = 1.0 - smoothstep(hw - 0.5 * px, hw + 0.5 * px, d);

      // Rare accent cells carry the single tint; everything else is matte ink.
      float acc = step(1.0 - accent * 0.3, hash13(vec3(sk, 2.0)));
      vec3 c = mix(ink.rgb, tint.rgb, acc) * (0.55 + 0.45 * hash13(vec3(cell, 3.0)));
      // Where strokes overlap at a join, the brighter one wins whole (a
      // per-channel max would mix accent and ink into a third color).
      float s = cov * dot(c, vec3(0.333));
      if (s > best) { best = s; col = c * cov; }
    }
  }

  col += vec3(0.025, 0.025, 0.03);
  gl_FragColor = vec4(col, 1.0);
}
