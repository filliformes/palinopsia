/*{
  "DESCRIPTION": "Compress : intra-frame compression artifacts (the JPEG / MPEG keyframe look, not motion). The image is cut into macroblocks, each crushed toward its DC average plus a coarse low-frequency reconstruction (blockiness and tone banding as quality drops); chroma is subsampled to the block so color bleeds across luma edges; and blocks with strong edges pick up a diagonal basis-pattern ripple (the mosquito noise of a starved encoder). `vary` gives every block its own quality, as a real encoder's per-macroblock quantizer does. Block size follows the frame height, so the look holds at 4K and on the dome.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "block",   "TYPE": "float", "MIN": 2.0, "MAX": 32.0, "DEFAULT": 8.0,  "LABEL": "block" },
    { "NAME": "quality", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35, "LABEL": "quality" },
    { "NAME": "ring",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4,  "LABEL": "ringing" },
    { "NAME": "chroma",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.6,  "LABEL": "chroma bleed" },
    { "NAME": "grid",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0,  "LABEL": "block grid" },
    { "NAME": "vary",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0,  "LABEL": "vary" }
  ]
}*/

vec3 rgb2ycc(vec3 c) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  return vec3(y, (c.b - y) * 0.564, (c.r - y) * 0.713);
}
vec3 ycc2rgb(vec3 v) {
  return vec3(v.x + 1.403 * v.z, v.x - 0.344 * v.y - 0.714 * v.z, v.x + 1.773 * v.y);
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 res = RENDERSIZE;
  vec2 uv = isf_FragNormCoord;
  // `block` is in 1080p pixels : scaled by the frame height, so a 4K or dome
  // output keeps the same blocks instead of halving them.
  float pxScale = res.y / 1080.0;
  vec2 blockPx = vec2(max(2.0, block) * pxScale);
  vec2 bsize = blockPx / res;                          // block size in UV
  vec2 cellId = floor(uv / bsize);
  vec2 origin = cellId * bsize;                        // block origin (UV)

  // DC + coarse structure : average a 4×4 grid of sub-cells inside the block.
  vec3 dc = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 sub = origin + (vec2(float(i), float(j)) + 0.5) / 4.0 * bsize;
      dc += rgb2ycc(IMG_NORM_PIXEL(inputImage, sub).rgb);
    }
  }
  dc /= 16.0;

  // Per-block quantizer : `vary` drops some blocks' quality toward 0 (a real
  // encoder spends its bits unevenly). The roll is keyed to the block's own DC
  // level, so it re-rolls as the content through the block changes (an encoder
  // reacting) and holds on a still picture. 0 = every block the same (the old look).
  float qRoll = hash(mod(cellId, 4096.0) + floor(dc.x * 6.0) * 31.0 + 17.0);
  float q = quality * mix(1.0, qRoll, vary);

  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  vec3 cur = rgb2ycc(src.rgb);

  // Luma : keep detail ∝ quality (else collapse to the DC block), then quantize
  // to a level count ∝ quality (the tone banding).
  float keep = q * q;
  float y = mix(dc.x, cur.x, keep);
  float levels = mix(4.0, 40.0, q);
  y = floor(y * levels + 0.5) / levels;

  // Chroma : subsample toward the block DC + coarser quantize (color bleed).
  vec2 cc = mix(cur.yz, dc.yz, chroma);
  float clev = mix(6.0, 48.0, q);
  cc = floor(cc * clev + 0.5) / clev;

  // Ringing : a diagonal basis ripple keyed to the block's edge energy. The
  // taps are hoisted into bare identifiers : the ISF parser splits
  // IMG_NORM_PIXEL's arguments on commas, so an inline vec2(a, b) compiled as
  // vec2(a) (a diagonal tap, and the vertical term was always 0).
  vec2 pL = origin - vec2(bsize.x, 0.0);
  vec2 pR = origin + vec2(bsize.x, 0.0);
  vec2 pU = origin - vec2(0.0, bsize.y);
  vec2 pD = origin + vec2(0.0, bsize.y);
  float l = rgb2ycc(IMG_NORM_PIXEL(inputImage, pL).rgb).x;
  float r = rgb2ycc(IMG_NORM_PIXEL(inputImage, pR).rgb).x;
  float u = rgb2ycc(IMG_NORM_PIXEL(inputImage, pU).rgb).x;
  float d = rgb2ycc(IMG_NORM_PIXEL(inputImage, pD).rgb).x;
  float edge = abs(r - l) + abs(d - u);
  vec2 inCell = fract(uv / bsize);
  float ripple = sin((inCell.x + inCell.y) * 3.14159265 * 4.0);
  y += ring * edge * ripple * 0.25 * (1.0 - q);

  vec3 col = ycc2rgb(vec3(y, cc));

  // Block-edge grid (off by default) : a line one pixel either side of every
  // block border, pixel-scaled with the output (it used to vanish below 17 px
  // blocks, where the border band fell between pixel centers).
  vec2 pin = inCell * blockPx;
  float lw = max(1.0, floor(pxScale + 0.5));
  float gline = 1.0 - step(lw, min(min(pin.x, blockPx.x - pin.x), min(pin.y, blockPx.y - pin.y)));
  col = mix(col, col * 0.7, gline * grid);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
}
