/*{
  "DESCRIPTION": "Grain — three characters: DIGITAL (square-cell static), FILM (irregular clumped 35mm-style grain, 24fps cadence, mid-tone weighted), CRT (row-correlated snow with occasional dropout lines and slight chroma noise). Matte texture, never sparkle.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Texture"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "character", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["digital", "film", "crt"], "DEFAULT": 0 },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15 },
    { "NAME": "size",   "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 1.5 },
    { "NAME": "mono",   "TYPE": "bool",  "DEFAULT": true }
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
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));

  vec3 noise = vec3(0.0);
  float w = 1.0;

  if (character == 0) {
    // DIGITAL — per-cell static at ~24fps, uniform hard cells.
    vec2 cell = floor(gl_FragCoord.xy / max(size, 1.0));
    float seed = floor(TIME * 24.0);
    float n = hash(cell + seed * 13.7) - 0.5;
    noise = vec3(n);
    if (!mono) {
      noise = vec3(
        n,
        hash(cell + seed * 13.7 + 101.0) - 0.5,
        hash(cell + seed * 13.7 + 202.0) - 0.5
      );
    }
    w = smoothstep(0.0, 0.25, l) * (1.0 - smoothstep(0.7, 1.0, l) * 0.6);
  } else if (character == 1) {
    // FILM — irregular clumps: two octaves of value noise at grain scale,
    // re-seeded every 1/24s with a per-frame offset so clumps crawl the way
    // silver halide does; strongest in the mid-tones, soft at both ends.
    float seed = floor(TIME * 24.0);
    vec2 jitter = vec2(hash(vec2(seed, 1.0)), hash(vec2(seed, 7.0))) * 100.0;
    vec2 p = gl_FragCoord.xy / (max(size, 1.0) * 2.2) + jitter;
    float n = vnoise(p) * 0.65 + vnoise(p * 2.7 + 31.0) * 0.35 - 0.5;
    // Sharpen the clumps a touch — grain, not fog.
    n = sign(n) * pow(abs(n) * 2.0, 1.4) * 0.5;
    noise = vec3(n); // film grain is monochrome by nature
    w = smoothstep(0.02, 0.3, l) * (1.0 - smoothstep(0.65, 1.0, l) * 0.75);
  } else {
    // CRT — snow correlated along scanline rows, refreshed at frame rate,
    // with rare full-row dropouts and slight chroma noise on the beam.
    float row = floor(gl_FragCoord.y / max(size, 1.0));
    float seed = floor(TIME * 50.0); // PAL-ish field rate
    float rowSeed = hash(vec2(row, seed));
    vec2 cell = vec2(floor(gl_FragCoord.x / max(size, 1.0)), row);
    float n = (hash(cell + seed * 17.3) - 0.5) * (0.5 + rowSeed);
    // Dropout: a rare row goes loud for one field.
    float dropout = step(0.992, rowSeed);
    n += dropout * (hash(cell + 77.0) - 0.3) * 1.5;
    noise = vec3(n);
    if (!mono) {
      noise += vec3(
        (hash(cell + 301.0) - 0.5) * 0.35,
        0.0,
        (hash(cell + 502.0) - 0.5) * 0.35
      );
    }
    w = 0.35 + 0.65 * smoothstep(0.0, 0.4, l); // CRT snow rides the dark too
  }

  gl_FragColor = vec4(clamp(src.rgb + noise * amount * w, 0.0, 1.0), src.a);
}
