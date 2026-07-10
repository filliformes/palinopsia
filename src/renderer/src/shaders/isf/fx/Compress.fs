/*{
  "DESCRIPTION": "Compress : real intra-frame compression artefacts (the JPEG / MPEG keyframe look, not motion). The image is cut into macroblocks, each crushed toward its DC average + a coarse low-frequency reconstruction (blockiness + tone banding as quality drops); chroma is subsampled to a coarser grid so colour bleeds across luma edges; and quantisation RINGING haloes strong edges (Gibbs echoes). Morgan's macroblock / quantisation aesthetic : the successful-lossy-compression artefact.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "block",   "TYPE": "float", "MIN": 2.0, "MAX": 32.0, "DEFAULT": 8.0,  "LABEL": "block" },
    { "NAME": "quality", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35, "LABEL": "quality" },
    { "NAME": "ring",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4,  "LABEL": "ringing" },
    { "NAME": "chroma",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.6,  "LABEL": "chroma bleed" },
    { "NAME": "grid",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0,  "LABEL": "block grid" }
  ]
}*/

vec3 rgb2ycc(vec3 c) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  return vec3(y, (c.b - y) * 0.564, (c.r - y) * 0.713);
}
vec3 ycc2rgb(vec3 v) {
  return vec3(v.x + 1.403 * v.z, v.x - 0.344 * v.y - 0.714 * v.z, v.x + 1.773 * v.y);
}

void main() {
  vec2 res = RENDERSIZE;
  vec2 uv = isf_FragNormCoord;
  vec2 blockPx = vec2(max(2.0, block));
  vec2 bsize = blockPx / res;                          // block size in UV
  vec2 origin = floor(uv / bsize) * bsize;             // block origin (UV)

  // DC + coarse structure : average a 4×4 grid of sub-cells inside the block.
  vec3 dc = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 sub = origin + (vec2(float(i), float(j)) + 0.5) / 4.0 * bsize;
      dc += rgb2ycc(IMG_NORM_PIXEL(inputImage, sub).rgb);
    }
  }
  dc /= 16.0;

  vec3 cur = rgb2ycc(IMG_NORM_PIXEL(inputImage, uv).rgb);

  // Luma : keep detail ∝ quality (else collapse to the DC block), then quantise
  // to a level count ∝ quality (the tone banding).
  float keep = quality * quality;
  float y = mix(dc.x, cur.x, keep);
  float levels = mix(4.0, 40.0, quality);
  y = floor(y * levels + 0.5) / levels;

  // Chroma : subsample toward the block DC + coarser quantise (colour bleed).
  vec2 cc = mix(cur.yz, dc.yz, chroma);
  float clev = mix(6.0, 48.0, quality);
  cc = floor(cc * clev + 0.5) / clev;

  // Ringing : a high-pass echo keyed to the block's edge energy (Gibbs).
  float l = rgb2ycc(IMG_NORM_PIXEL(inputImage, origin - vec2(bsize.x, 0.0)).rgb).x;
  float r = rgb2ycc(IMG_NORM_PIXEL(inputImage, origin + vec2(bsize.x, 0.0)).rgb).x;
  float u = rgb2ycc(IMG_NORM_PIXEL(inputImage, origin - vec2(0.0, bsize.y)).rgb).x;
  float d = rgb2ycc(IMG_NORM_PIXEL(inputImage, origin + vec2(0.0, bsize.y)).rgb).x;
  float edge = abs(r - l) + abs(d - u);
  vec2 inCell = fract(uv / bsize);
  float ripple = sin((inCell.x + inCell.y) * 3.14159265 * 4.0);
  y += ring * edge * ripple * 0.25 * (1.0 - quality);

  vec3 col = ycc2rgb(vec3(y, cc));

  // Faint block-edge grid (off by default).
  vec2 g = abs(inCell - 0.5);
  float gline = step(0.47, max(g.x, g.y));
  col = mix(col, col * 0.7, gline * grid);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
