/*{
  "DESCRIPTION": "Shatter : motion shown as texture. A still frame is grabbed again and again (at GRAB RATE, on a beat division with SYNC, or on grab ▸) and a 1-bit PATTERN switches each pixel between that held still and the live picture. Where nothing moves the still equals the live picture and the pattern vanishes; wherever something moves, the pattern appears. DENSITY is the share of the pattern that shows the still. FLIP trades the pattern's two halves on a clock and SLIDE moves it : both keep that share, so a fine pattern never flashes as a whole, only its moving parts shimmer. KEY uses the picture's own darks as the pattern : a moving bright subject leaves its last grab behind. Keeps the layer's transparency.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Time", "Texture"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0, "MAX": 8.0,  "DEFAULT": 1.5, "LABEL": "grab rate (Hz)" },
    { "NAME": "sync",    "TYPE": "long",  "VALUES": [0, 1, 2, 3, 4], "LABELS": ["free (rate)", "1 bar", "1/2", "1/4", "1/8"], "DEFAULT": 0, "LABEL": "sync", "COMPACT": true },
    { "NAME": "grab",    "TYPE": "event", "LABEL": "grab ▸" },
    { "NAME": "pattern", "TYPE": "long",  "VALUES": [0, 1, 2, 3, 4, 5, 6, 7], "LABELS": ["checker", "lines", "columns", "diagonals", "bricks", "dither", "cells", "key"], "DEFAULT": 0, "LABEL": "pattern" },
    { "NAME": "scale",   "TYPE": "float", "MIN": 1.0, "MAX": 40.0, "DEFAULT": 3.0, "LABEL": "scale" },
    { "NAME": "density", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.5, "LABEL": "density" },
    { "NAME": "flip",    "TYPE": "float", "MIN": 0.0, "MAX": 6.0,  "DEFAULT": 0.0, "LABEL": "flip (Hz)" },
    { "NAME": "slide",   "TYPE": "float", "MIN": -8.0, "MAX": 8.0, "DEFAULT": 0.0, "LABEL": "slide" },
    { "NAME": "wet",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 1.0, "LABEL": "mix" }
  ],
  "PASSES": [
    { "TARGET": "latch", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { "TARGET": "held", "PERSISTENT": true },
    { }
  ]
}*/

// Integrated clocks (engine/phases.ts) : the grab clock (one grab per whole
// step, at `rate` Hz or on the tempo with `sync`, capped at 8 a second), the flip
// (one trade per whole step) and the slide (in pattern cells). A knob changes the
// pace from here on, it never jumps the pattern. The wraps are multiples of what
// each one repeats on (the latch keeps the step mod 256, the flip its parity,
// every pattern tiles 4096 cells).
uniform float PH_shatterGrab; // wrap 256
uniform float PH_flip; // wrap 2
uniform float PH_slide; // wrap 4096

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // precise hash : whole-number inputs, kept small
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Ordered (Bayer) threshold of an 8 x 8 tile from the cell index : 64 levels, each
// once per tile, the finest 2 x 2 step weighing most (a dispersed dot screen).
// The cell index is taken mod 2 per level, so it stays exact on a 4096 dome.
float bayer2(vec2 a) {
  a = mod(floor(a), 2.0);
  return fract(a.x * 0.5 + a.y * 0.75);
}
float bayer8(vec2 a) {
  return bayer2(a) + bayer2(a * 0.5) * 0.25 + bayer2(a * 0.25) * 0.0625;
}

// Every pattern is a RANK in [0, 1) spread evenly over its area : a pixel shows the
// still where its rank is under `density`, so density is the still's share for
// every pattern, and a flip (the rank moved on by a half) or a slide keeps that
// share exactly. A fine pattern then holds its average brightness through any
// flip : only the moving parts shimmer, and Flash safety (which reads whole sixths
// of the frame) sees no swing. q is in pattern cells.
float rankOf(vec2 q, float lum) {
  vec2 cell = floor(q);
  vec2 f = fract(q);
  if (pattern == 0) {
    // checker : alternate cells, each filling from its middle outward (the squared
    // largest axis distance is even over the cell's area)
    vec2 d = abs(f * 2.0 - 1.0);
    float c = max(d.x, d.y);
    return mod(cell.x + cell.y, 2.0) * 0.5 + 0.5 * c * c;
  }
  if (pattern == 1) return fract(q.y * 0.5);          // lines : bars, two cells a period
  if (pattern == 2) return fract(q.x * 0.5);          // columns
  if (pattern == 3) return fract((q.x + q.y) * 0.25); // diagonals
  if (pattern == 4) {
    // bricks : two cells wide, every other row moved on by half a brick
    float bx = q.x * 0.5 + 0.5 * mod(cell.y, 2.0);
    vec2 d = abs(vec2(fract(bx), f.y) * 2.0 - 1.0);
    float c = max(d.x, d.y);
    return mod(floor(bx) + cell.y, 2.0) * 0.5 + 0.5 * c * c;
  }
  if (pattern == 5) return bayer8(cell) + 0.5 / 64.0; // dither
  if (pattern == 6) {
    vec2 hc = mod(cell, 4096.0);
    return hash12(hc);                                // cells : one random rank each
  }
  return lum;                                         // key : the picture's own tones
}

// The 1 x 1 latch holds the grab clock's last whole step (mod 256) and the grab ▸
// button as it was, so a held button or a modulator grabs once, on its rising
// edge. Every pass reads the latch as it was LAST frame (the runtime flips the
// targets after all passes), so every pass takes the same decision.
bool grabNow() {
  vec2 c0 = vec2(0.5);
  vec4 L = IMG_NORM_PIXEL(latch, c0);
  if (L.a < 0.5) return true; // empty (the first frame, or PANIC) : grab now
  float was = floor(L.r * 255.0 + 0.5);
  float stepNow = mod(floor(PH_shatterGrab), 256.0);
  return abs(stepNow - was) > 0.5 || (grab && L.g < 0.5);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  bool take = grabNow();

  if (PASSINDEX == 0) {
    gl_FragColor = vec4(mod(floor(PH_shatterGrab), 256.0) / 255.0, grab ? 1.0 : 0.0, 0.0, 1.0);
    return;
  }

  vec4 live = IMG_NORM_PIXEL(inputImage, uv);
  vec4 prev = IMG_NORM_PIXEL(held, uv);
  // An EMPTY buffer (alpha exactly 0 : the first frames, or PANIC) holds nothing
  // yet : take the live frame. Written pixels keep alpha >= 1/255, so a
  // transparent input still counts as written (the output maps that floor back
  // to 0). The output recomputes the grab, so a grab shows this very frame.
  vec4 h = (take || prev.a < 0.5 / 255.0) ? live : prev;

  if (PASSINDEX == 1) {
    // The very first draw samples a black input (the runtime binds the input on a
    // unit its pass buffers then take) : store EMPTY, never that black.
    if (FRAMEINDEX == 0) { gl_FragColor = vec4(0.0); return; }
    gl_FragColor = vec4(h.rgb, max(h.a, 1.0 / 255.0));
    return;
  }
  h.a = h.a < 1.5 / 255.0 ? 0.0 : h.a; // undo the written-pixel floor

  // Pattern cells in WHOLE pixels, sized in 1080p pixels (the pattern keeps its
  // size at 4K and on the dome, and stays crisp at the finest scale).
  float sz = max(floor(scale * RENDERSIZE.y / 1080.0 + 0.5), 1.0);
  vec2 q = (floor(gl_FragCoord.xy) + 0.5) / sz;
  float lum = dot(live.rgb, LUMA) * live.a;
  float r;
  if (pattern == 7) {
    r = lum; // the key neither flips nor slides : its halves are the picture's own
  } else {
    // slide : the bars roll up or down, every other pattern moves sideways
    if (pattern == 1) q.y += PH_slide; else q.x += PH_slide;
    r = fract(rankOf(q, lum) + 0.5 * mod(floor(PH_flip), 2.0));
  }
  float on = r < density ? 1.0 : 0.0;
  vec4 o = mix(live, h, on);
  gl_FragColor = mix(live, o, wet);
}
