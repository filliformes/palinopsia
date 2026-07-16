/*{
  "DESCRIPTION": "Ash : sparse particulate falling at per-column rates with lateral wander and flicker; rare flecks carry the accent. Near-black particulate weather : settling, not snowing: matte, slow, asymmetric. Physics sets the mass: low = heavy flecks dropping fast and straight, high = light ash drifting down softly with more sway and float.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Particles"],
  "INPUTS": [
    { "NAME": "count",   "TYPE": "float", "MIN": 6.0,  "MAX": 60.0, "DEFAULT": 24.0 },
    { "NAME": "speed",   "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,  "DEFAULT": 0.25 },
    { "NAME": "physics", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "size",    "TYPE": "float", "MIN": 0.02, "MAX": 0.35, "DEFAULT": 0.08 },
    { "NAME": "wander",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.4 },
    { "NAME": "flicker", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.3 },
    { "NAME": "accent",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.25 },
    { "NAME": "audioScatter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio scatter" },
    { "NAME": "tint",    "TYPE": "color", "DEFAULT": [0.9, 0.55, 0.25, 1.0] },
    { "NAME": "audioTex","TYPE": "image" }
  ]
}*/

// Per-element audio : the shared waveform texture (row 0), ±1 around silence.
float aud(float idx01) {
  return (IMG_NORM_PIXEL(audioTex, vec2(fract(idx01), 0.25)).r - 0.5) * 2.0;
}

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

  // Physics = inverse mass. Light ash (high physics) falls slowly and sways
  // more; heavy flecks (low physics) drop fast and nearly straight.
  float fall = mix(1.0, 0.32, physics);
  float sway = mix(1.0, 2.2, physics);

  // Column-space grid; every column falls at its own rate (ash, not snow —
  // no uniform sheet of motion).
  float colIdx = floor(uv.x * count * aspect);
  float colRate = 0.35 + hash(vec2(colIdx, 1.7)) * 0.65;
  // Audio scatter : each column gusts sideways on its OWN live sample — the
  // ash bed is blown around by the waveform, column by column.
  uv.x += aud(colIdx / (count * aspect)) * audioScatter * 0.06;
  vec2 q = vec2(uv.x * count * aspect, uv.y * count + TIME * speed * count * 0.2 * colRate * fall);
  vec2 cell0 = floor(q);

  float lum = 0.0;
  float acc = 0.0;
  // Wide in x so a fleck scattered off its own column is still found.
  for (int j = -1; j <= 1; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 cell = cell0 + vec2(float(i), float(j));
      // Not every cell holds a fleck : sparseness is the register.
      if (hash(cell * 1.13) < 0.45) continue;
      // Per-fleck RANDOM horizontal scatter (breaks the columnar lines the old
      // smooth-only wander produced), plus a gentle sway and a physics-scaled
      // lateral float; a little vertical jitter too.
      float sx = (hash(cell + 5.0) - 0.5) * 0.85
        + (vnoise(cell * 0.8 + vec2(TIME * 0.3, 0.0)) - 0.5) * wander * sway
        + physics * 0.22 * sin(TIME * (0.5 + hash(cell + 2.0)) + hash(cell) * 6.28);
      vec2 pos = cell + 0.5 + vec2(sx, (hash(cell + 7.0) - 0.5) * 0.6);
      float d = length(q - pos);
      // Flicker: slow per-fleck brightness breathing.
      float fl = 1.0 - flicker * (0.5 + 0.5 * sin(TIME * (1.0 + hash(cell) * 3.0) + hash(cell + 3.0) * 6.28));
      float dot_ = (1.0 - smoothstep(size * 0.5, size, d)) * fl;
      lum = max(lum, dot_ * (0.4 + 0.6 * hash(cell + 11.0)));
      // Rare accent flecks.
      acc = max(acc, dot_ * step(1.0 - accent * 0.35, hash(cell + 23.0)));
    }
  }

  vec3 base = vec3(0.025, 0.025, 0.03);
  vec3 grey = vec3(0.75, 0.74, 0.7);
  vec3 col = base + grey * lum * 0.7;
  col = mix(col, base + tint.rgb * lum, acc);
  gl_FragColor = vec4(col, 1.0);
}
