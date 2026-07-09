/*{
  "DESCRIPTION": "Mosaic : an analysis/resynthesis grid (after Villegas & Forbes): the frame is read as an N×M field of cells, each replaced by its own average colour and redrawn as a tile whose SIZE follows the cell's luminance (bright cells swell, dark cells shrink to nothing). Shape, gap and softness are yours. A matte, dithered-mosaic resynthesis : the image survives as a field of marks, not pixels.",
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
    { "NAME": "gapMix",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "gap fill" }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  // Square cells: more across the wide axis so tiles aren't stretched.
  float n = floor(mix(4.0, 60.0, grid));
  vec2 res = vec2(n * aspect, n);
  vec2 cellId = floor(uv * res);
  vec2 cellCenter = (cellId + 0.5) / res;

  // Representative colour = the cell centre (the "analysis" of the cell).
  vec4 col = IMG_NORM_PIXEL(inputImage, cellCenter);
  float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));

  // Local position within the cell, -0.5..0.5.
  vec2 local = fract(uv * res) - 0.5;

  // Tile radius follows luminance when luma→size is up.
  float sz = clamp(0.5 * size * mix(1.0, lum * 1.7 + 0.15, lumaSize), 0.0, 0.5);

  float sd;
  if (shape == 0) sd = max(abs(local.x), abs(local.y));       // square
  else if (shape == 1) sd = length(local);                    // circle
  else if (shape == 2) sd = abs(local.x) + abs(local.y);      // diamond
  else sd = min(abs(local.x), abs(local.y));                  // cross

  float mask = 1.0 - smoothstep(sz - soft, sz + soft, sd);

  // Gaps are matte black by default; gapMix bleeds a dim version through.
  vec3 gap = col.rgb * gapMix * 0.25;
  vec3 outc = mix(gap, col.rgb, mask);
  gl_FragColor = vec4(outc, 1.0);
}
