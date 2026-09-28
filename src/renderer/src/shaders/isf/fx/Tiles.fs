/*{
  "DESCRIPTION": "Tiles : an analysis/resynthesis grid (after Villegas & Forbes): the frame is read as an N×M field of cells, each replaced by one color and redrawn as a tile whose SIZE follows the cell's luminance (bright cells swell, dark cells shrink to small marks). The color is the cell's center pixel (crisp and vivid, it pops as detail moves through the cell); `average` blends toward the mean of the cell for a calmer field. Shape, gap and softness are yours; `audio` swells each column of tiles with its own band of the live spectrum. A matte, tiled resynthesis : the image survives as a field of marks, not pixels.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Stylize", "Texture"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "grid",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4 },
    { "NAME": "size",     "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.85 },
    { "NAME": "lumaSize", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "luma→size" },
    { "NAME": "soft",     "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.06 },
    { "NAME": "shape",    "TYPE": "long",  "VALUES": [0, 1, 2, 3], "LABELS": ["square", "circle", "diamond", "cross"], "DEFAULT": 1 },
    { "NAME": "gapMix",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "gap fill" },
    { "NAME": "average",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "average" },
    { "NAME": "audio",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio" },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// Spectrum (row 1, log-spaced : 0 bass .. 1 treble), 0..1. Bare-identifier coord.
float spec(float u) {
  vec2 ac = vec2(clamp(u, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  // Square cells: more across the wide axis so tiles aren't stretched.
  float n = floor(mix(4.0, 60.0, grid));
  vec2 res = vec2(n * aspect, n);
  vec2 cellId = floor(uv * res);
  vec2 cellCenter = (cellId + 0.5) / res;

  // Representative color = the cell center (the "analysis" of the cell) ...
  vec4 col = IMG_NORM_PIXEL(inputImage, cellCenter);
  if (average > 0.0) {
    // ... or, blended in by `average`, the alpha-weighted mean of a 3×3 grid of
    // taps across the cell (bare-identifier coordinates : the ISF parser splits
    // IMG_NORM_PIXEL's arguments on commas).
    vec4 acc = vec4(0.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 tp = cellCenter + vec2(float(i), float(j)) / (3.0 * res);
        vec4 s = IMG_NORM_PIXEL(inputImage, tp);
        acc += vec4(s.rgb * s.a, s.a);
      }
    }
    vec4 m = vec4(acc.a > 1e-4 ? acc.rgb / acc.a : col.rgb, acc.a / 9.0);
    col = mix(col, m, average);
  }
  float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));

  // Local position within the cell, -0.5..0.5.
  vec2 local = fract(uv * res) - 0.5;

  // Tile radius follows luminance when luma→size is up (a black cell keeps a
  // small mark, 15% of full size); audio swells each column with its own band.
  float sz = 0.5 * size * mix(1.0, lum * 1.7 + 0.15, lumaSize);
  if (audio > 0.0) sz += audio * spec((cellId.x + 0.5) / res.x) * 0.35;
  sz = clamp(sz, 0.0, 0.5);

  float sd;
  if (shape == 0) sd = max(abs(local.x), abs(local.y));       // square
  else if (shape == 1) sd = length(local);                    // circle
  else if (shape == 2) sd = abs(local.x) + abs(local.y);      // diamond
  else sd = min(abs(local.x), abs(local.y));                  // cross

  // At least half a pixel of edge (in cell units) : soft 0 made the smoothstep
  // undefined, and hard edges shimmered at 4K.
  float sf = max(soft, 0.5 * n / RENDERSIZE.y);
  float mask = 1.0 - smoothstep(sz - sf, sz + sf, sd);

  // Gaps are matte black by default; gapMix bleeds a dim version through.
  vec3 gap = col.rgb * gapMix * 0.25;
  vec3 outc = mix(gap, col.rgb, mask);
  // The cell's own alpha : a transparent ground stays transparent (the gaps
  // used to turn it into an opaque black sheet).
  gl_FragColor = vec4(outc, col.a);
}
