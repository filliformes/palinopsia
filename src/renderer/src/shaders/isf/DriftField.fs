/*{
  "DESCRIPTION": "Drift Field : a slow directional value-noise flow, posterized into matte bands over near-black, carrying a single accent tint and a restrained chroma-split at band edges. Asymmetric and matte by design: the disciplined generative register, NOT kaleidoscope, plasma, or neon-on-void. ANGLE turns the strata and their drift; RESEED cuts to a new field. Palinopsia seed generator.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Noise", "Glitch"],
  "INPUTS": [
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 20.0,  "DEFAULT": 0.15 },
    { "NAME": "scale",    "TYPE": "float", "MIN": 0.5, "MAX": 8.0,  "DEFAULT": 2.6 },
    { "NAME": "warp",     "TYPE": "float", "MIN": 0.0, "MAX": 1.5,  "DEFAULT": 0.55 },
    { "NAME": "steps",    "TYPE": "float", "MIN": 2.0, "MAX": 16.0, "DEFAULT": 5.0 },
    { "NAME": "contrast", "TYPE": "float", "MIN": 0.5, "MAX": 2.0,  "DEFAULT": 1.15 },
    { "NAME": "split",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.25, "LABEL": "color split" },
    { "NAME": "angle",    "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": 0.0, "LABEL": "strata angle" },
    { "NAME": "tint",     "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0] },
    { "NAME": "reseed",   "TYPE": "event", "LABEL": "reseed ▸" }
  ],
  "PASSES": [
    { "TARGET": "seedState", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { }
  ]
}*/

// Integrated drift phase (∫ rate dt, set by the engine) : a rate change alters
// the speed from here on, never the position.
uniform float PH_rate;

// --- value noise + fbm (matte, band-friendly; no neon gradients) ----------
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise that tiles every `per` lattice cells. The drift phase grows
// without bound, so every drift offset is wrapped (mod PER) before it reaches
// the lattice : seamless, because the noise repeats with the same period.
float vnoise(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, per), i1 = i0 + 1.0;
  i1 *= step(i1, vec2(per - 0.5)); // per → 0 (one mod instead of two)
  float a = hash(i0);
  float b = hash(vec2(i1.x, i0.y));
  float c = hash(vec2(i0.x, i1.y));
  float d = hash(i1);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

#define PER 256.0
// Octave k runs at 2^k with a period of 2^k·PER, so the whole fbm tiles every PER.
float fbm(vec2 p) {
  float s = 0.0, a = 0.5, per = PER;
  for (int k = 0; k < 5; k++) {
    s += a * vnoise(p, per);
    p = p * 2.0 + vec2(7.37, 3.61);
    per *= 2.0;
    a *= 0.5;
  }
  return s;
}

// Screen → field coordinates. ANISOTROPIC : X is compressed so features
// stretch into flowing strata / grain (directional layers) instead of round
// camouflage blobs. ANGLE turns the strata (and their drift) on screen.
vec2 fieldCoord(vec2 uv) {
  vec2 aspect = vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0);
  vec2 p = (uv - 0.5) * aspect * scale;
  float ca = cos(angle), sa = sin(angle);
  p = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
  p.x *= 0.42;
  return p;
}

// Posterized into TERRACES with intra-band relief + a thin dark contour seam at
// each edge : the bands read as lit strata with depth, not flat matte patches.
float terrace(float n) {
  n = pow(clamp(n, 0.0, 1.0), contrast);
  float q = n * steps;
  float band = floor(q) / steps;                                          // terrace level
  float f = fract(q);                                                     // across the terrace
  float seam = smoothstep(0.0, 0.07, f) * (1.0 - smoothstep(0.9, 1.0, f)); // darken band edges
  float relief = 0.78 + 0.22 * f;                                         // lift toward the top
  return band * relief * (0.45 + 0.55 * seam);
}

void main() {
  // Pass 0 : the 1×1 reseed latch (rising edge → golden-ratio seed step,
  // time-salted; .y remembers the trigger level so a held 1 fires once).
  if (PASSINDEX == 0) {
    vec4 prev = IMG_NORM_PIXEL(seedState, vec2(0.5));
    float fire = (reseed && prev.y < 0.5) ? 1.0 : 0.0;
    float s = fract(prev.x + fire * (0.61803399 + fract(TIME * 0.7317)));
    gl_FragColor = vec4(s, reseed ? 1.0 : 0.0, 0.0, 1.0);
    return;
  }
  // RESEED jumps the whole noise domain : a cut to a new field.
  float seed = IMG_NORM_PIXEL(seedState, vec2(0.5)).x;
  vec2 so = vec2(seed, fract(seed * 7.13 + 0.31)) * PER;

  vec2 uv = isf_FragNormCoord;
  float t = PH_rate;
  // Asymmetric directional drift + domain warp (never radial symmetry). The
  // four drift speeds are incommensurate, so the wrapped offsets never line up
  // into a repeating loop.
  vec2 dFlowA = mod(vec2(t * 0.5) + so, PER);
  vec2 dFlowB = mod(vec2(t * 0.4142) - so.yx, PER);
  vec2 dMain = mod(vec2(t * 0.8, -t * 0.3183) + so * 1.618, PER);

  // The warp is low-frequency : evaluated once at the pixel and shared by the
  // three chroma taps (25 noise evaluations instead of 45; 15 when split is 0).
  vec2 pc = fieldCoord(uv);
  vec2 flow = vec2(fbm(pc * 0.7 + dFlowA), fbm(pc.yx * 0.7 - dFlowB));
  vec2 wf = warp * flow + dMain;

  float g = terrace(fbm(pc + wf));
  float r = g, b = g;
  if (split > 0.001) {
    float off = split * 0.02;
    r = terrace(fbm(fieldCoord(uv + vec2(off, 0.0)) + wf));
    b = terrace(fbm(fieldCoord(uv - vec2(off, 0.0)) + wf));
  }

  // Near-black base, one accent tint pushed through the band values.
  vec3 base = vec3(0.025, 0.025, 0.03);
  vec3 col = base + tint.rgb * vec3(r, g, b);

  // Soft, slow-drifting directional light so the strata read as a lit surface
  // with depth rather than a flat repeating pattern.
  float lum = dot(vec3(r, g, b), vec3(0.3333));
  float lightPos = 0.5 + 0.35 * sin(t * 0.5);
  col *= 0.8 + 0.35 * smoothstep(0.0, 1.0, 1.0 - abs(uv.y - lightPos) * 1.4);
  // A faint matte glaze on the brightest strata (no bloom).
  col += tint.rgb * pow(lum, 3.0) * 0.12;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
