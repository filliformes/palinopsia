/*{
  "DESCRIPTION": "Dither : the picture in few levels, the steps between them broken into a pattern of dots at a chosen dot scale (in 1080p pixels, so it holds at 4K). PATTERN : Bayer 2x2, 4x4 or 8x8 (ordered cross-hatches, coarse to fine), blue noise (fine, even, no pattern), white noise (grainy, re-rolled by BOIL), clustered dots (a halftone), a line screen, a cross-hatch, or a diffusion look (the even grain and crisp detail of an error-diffusion print). COLOR : each channel on its own (colors), gray levels, or ink on paper (two colors you pick). ANGLE turns the dots, lines and hatches. The libretro/common-shaders dithering register : matte texture, not noise spectacle.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Print", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "levels", "TYPE": "float", "MIN": 2.0, "MAX": 8.0,  "DEFAULT": 3.0 },
    { "NAME": "scale",  "TYPE": "float", "MIN": 1.0, "MAX": 8.0,  "DEFAULT": 2.0 },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 1.0 },
    { "NAME": "pattern", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8], "LABELS": ["Bayer 2x2", "Bayer 4x4", "Bayer 8x8", "blue noise", "white noise", "clustered dots", "line screen", "cross-hatch", "diffusion look"], "DEFAULT": 1, "LABEL": "pattern" },
    { "NAME": "color", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["colors", "gray", "ink on paper"], "DEFAULT": 0, "LABEL": "color" },
    { "NAME": "ink", "TYPE": "color", "DEFAULT": [0.07, 0.07, 0.09, 1.0], "LABEL": "ink" },
    { "NAME": "paper", "TYPE": "color", "DEFAULT": [0.93, 0.91, 0.86, 1.0], "LABEL": "paper" },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 3.1416, "DEFAULT": 0.785, "LABEL": "angle" },
    { "NAME": "boil", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "boil" }
  ]
}*/

// The white noise re-rolls at BOIL (an integrated phase : no jump on a change).
uniform float PH_boil;

float bayer2(vec2 p) {
  vec2 q = floor(mod(p, 2.0));
  float i = q.x + q.y * 2.0;
  float v = i < 0.5 ? 0.0 : i < 1.5 ? 2.0 : i < 2.5 ? 3.0 : 1.0;
  return (v + 0.5) / 4.0;
}
float bayer4(vec2 p) {
  // 4×4 Bayer matrix via bit arithmetic-free lookup (ES 1.00 safe).
  vec2 q = floor(mod(p, 4.0));
  float i = q.x + q.y * 4.0;
  // Row-major 4×4 Bayer values 0..15.
  float v = 0.0;
  if (i < 0.5) v = 0.0;  else if (i < 1.5) v = 8.0;  else if (i < 2.5) v = 2.0;  else if (i < 3.5) v = 10.0;
  else if (i < 4.5) v = 12.0; else if (i < 5.5) v = 4.0;  else if (i < 6.5) v = 14.0; else if (i < 7.5) v = 6.0;
  else if (i < 8.5) v = 3.0;  else if (i < 9.5) v = 11.0; else if (i < 10.5) v = 1.0; else if (i < 11.5) v = 9.0;
  else if (i < 12.5) v = 15.0; else if (i < 13.5) v = 7.0; else if (i < 14.5) v = 13.0; else v = 5.0;
  return (v + 0.5) / 16.0;
}
// 8×8 : the 4×4 recursed (M8 = 4·M4 + M2 offsets), so no 64-entry table
float bayer8(vec2 p) {
  float a = bayer4(floor(p / 2.0)) * 16.0 - 0.5;
  float b = bayer2(p) * 4.0 - 0.5;
  return (a + b * 16.0 + 0.5) / 64.0;
}
float dHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Blue-ish noise : white noise minus its neighbors' mean (the low frequencies, the
// clumps, taken out), then spread back to an even 0..1 through its own bell curve
// (a cheap structured noise drew diagonal stripes)
float tanhF(float x) { float e = exp(2.0 * clamp(x, -9.0, 9.0)); return (e - 1.0) / (e + 1.0); }
float blueish(vec2 p) {
  float n = dHash(p);
  float m = (dHash(p + vec2(1.0, 0.0)) + dHash(p - vec2(1.0, 0.0)) + dHash(p + vec2(0.0, 1.0)) + dHash(p - vec2(0.0, 1.0))
           + dHash(p + vec2(1.0, 1.0)) + dHash(p - vec2(1.0, 1.0)) + dHash(p + vec2(1.0, -1.0)) + dHash(p - vec2(1.0, -1.0))) * 0.125;
  return clamp(0.5 + 0.5 * tanhF((n - m) * 2.6), 0.0, 1.0);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 c = IMG_NORM_PIXEL(inputImage, uv);
  int pat = int(float(pattern) + 0.5);
  int col = int(float(color) + 0.5);
  // Dot cell in WHOLE pixels, scaled by the frame height : `scale` is in 1080p
  // pixels, so the screen keeps its size at 4K and on the dome, and a fractional
  // scale (dice, modulation) no longer mixes 2- and 3-px cells.
  float s = max(floor(scale * RENDERSIZE.y / 1080.0 + 0.5), 1.0);
  vec2 dp = floor(gl_FragCoord.xy / s);
  // the screens that turn : their own space, ANGLE, a cell of four dots
  float ca = cos(angle), sa = sin(angle);
  vec2 fp = gl_FragCoord.xy / (s * 4.0);
  vec2 rp = vec2(ca * fp.x + sa * fp.y, -sa * fp.x + ca * fp.y);
  float threshold;
  if (pat == 0) threshold = bayer2(dp);
  else if (pat == 2) threshold = bayer8(dp);
  else if (pat == 3) threshold = blueish(dp);
  else if (pat == 4) threshold = dHash(dp + floor(PH_boil * 12.0) * vec2(17.13, 31.71));
  else if (pat == 5) {
    // clustered dots : a round dot grows from each cell's middle (the threshold is
    // the share of the cell inside that radius, so the tones come out even)
    vec2 f = fract(rp) - 0.5;
    float r = length(f);
    threshold = r < 0.5 ? 3.14159265 * r * r : clamp(0.785398 + (r - 0.5) / 0.207107 * 0.214602, 0.0, 1.0);
  } else if (pat == 6) {
    threshold = abs(fract(rp.y) - 0.5) * 2.0;
  } else if (pat == 7) {
    float l1 = abs(fract(rp.y) - 0.5) * 2.0;
    float l2 = abs(fract(rp.x) - 0.5) * 2.0;
    // (the nearer of two lines : spread back to even, its share 1 - (1 - m)^2)
    float m = min(l1, l2);
    threshold = 1.0 - (1.0 - m) * (1.0 - m);
  } else if (pat == 8) threshold = blueish(dp);
  else threshold = bayer4(dp);
  vec3 v = c.rgb;
  if (pat == 8) {
    // the diffusion look : an error-diffusion print keeps the edges crisp and the
    // tones even : a little local contrast, then the even threshold
    vec2 px = s / RENDERSIZE;
    vec2 o1 = uv + vec2(px.x, 0.0), o2 = uv - vec2(px.x, 0.0), o3 = uv + vec2(0.0, px.y), o4 = uv - vec2(0.0, px.y);
    vec3 blur = (IMG_NORM_PIXEL(inputImage, o1).rgb + IMG_NORM_PIXEL(inputImage, o2).rgb + IMG_NORM_PIXEL(inputImage, o3).rgb + IMG_NORM_PIXEL(inputImage, o4).rgb) * 0.25;
    v = clamp(v + (v - blur) * 1.6, 0.0, 1.0);
  }
  // Whole levels : a fractional count pushed white off the ramp (a gray checker).
  float steps = max(floor(levels + 0.5) - 1.0, 1.0);
  vec3 dithered;
  if (col == 0) {
    dithered = floor(v * steps + threshold) / steps;
  } else {
    float l = dot(v, vec3(0.299, 0.587, 0.114));
    float q = clamp(floor(l * steps + threshold) / steps, 0.0, 1.0);
    dithered = col == 1 ? vec3(q) : mix(ink.rgb, paper.rgb, q);
  }
  gl_FragColor = vec4(mix(c.rgb, dithered, amount), c.a);
}
