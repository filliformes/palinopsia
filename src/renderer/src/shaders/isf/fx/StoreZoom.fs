/*{
  "DESCRIPTION": "Store Zoom : the picture read through the address counters of a low-resolution frame store. One ZOOM both enlarges and mosaics : each store pixel is held for a run of screen pixels, and because the zoom is a whole-number step added up pixel by pixel, the runs come out uneven (2, 3, 2, 3...) : the stepped look of a hardware zoom. MAGNIFY 1 enlarges the picture (a frozen store); 0 keeps it in place and only cuts it into those uneven blocks (live video written through a zoomed store). STRETCH makes the blocks tall (up) or wide (down). PAN and SCROLL move the read address, wrapping around the frame; MIRROR reflects the picture where the address runs off the end of the store, on one axis, so its axis moves with pan and zoom. LINES is the store's resolution, PIXEL WIDTH its pixel shape. Keeps the layer's transparency.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Frame Store", "Distortion", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "zoom",    "TYPE": "float", "MIN": 0.5,  "MAX": 12.0,   "DEFAULT": 1.6,   "LABEL": "zoom" },
    { "NAME": "stretch", "TYPE": "float", "MIN": -1.0, "MAX": 1.0,    "DEFAULT": 0.0,   "LABEL": "stretch" },
    { "NAME": "magnify", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 1.0,   "LABEL": "magnify" },
    { "NAME": "mirror",  "TYPE": "long",  "VALUES": [0, 1, 2], "LABELS": ["off", "left / right", "top / bottom"], "DEFAULT": 0, "LABEL": "mirror", "COMPACT": true },
    { "NAME": "panX",    "TYPE": "float", "MIN": -1.0, "MAX": 1.0,    "DEFAULT": 0.0,   "LABEL": "pan ←→" },
    { "NAME": "panY",    "TYPE": "float", "MIN": -1.0, "MAX": 1.0,    "DEFAULT": 0.0,   "LABEL": "pan ↑↓" },
    { "NAME": "scrollX", "TYPE": "float", "MIN": -0.5, "MAX": 0.5,    "DEFAULT": 0.0,   "LABEL": "scroll ←→" },
    { "NAME": "scrollY", "TYPE": "float", "MIN": -0.5, "MAX": 0.5,    "DEFAULT": 0.0,   "LABEL": "scroll ↑↓" },
    { "NAME": "lines",   "TYPE": "float", "MIN": 32.0, "MAX": 1080.0, "DEFAULT": 256.0, "LABEL": "lines", "INTEGER": true },
    { "NAME": "wide",    "TYPE": "float", "MIN": 1.0,  "MAX": 2.0,    "DEFAULT": 1.5,   "LABEL": "pixel width" },
    { "NAME": "wet",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 1.0,   "LABEL": "mix" }
  ]
}*/

// The scroll, integrated (engine/phases.ts) in store widths / heights : a new
// speed moves on from where the picture is. Wrapped at 2, the mirror's period
// (the plain wrap repeats every 1).
uniform float PH_scrollX; // wrap 2
uniform float PH_scrollY; // wrap 2

// One axis of the store's address logic, after the hardware : an 8-bit zoom latch
// Z is added to an accumulator at every screen pixel (a clock), and each carry
// steps the address counter, so a store pixel is held for 256 / Z clocks : a
// whole number of them, unevenly when 256 / Z is not (Z = 100 : 2, 3, 3, 2, 3...).
// The counter starts so the middle clock reads the store's middle, moved by the
// pan p (in store widths). N clocks across = N store pixels across.
//   magnify 1 : read the counter's address (the store enlarged);
//   magnify 0 : read where the address's run STARTS on the screen (the picture
//               stays in place, cut into the same uneven runs : live video
//               written through a zoomed store keeps its scale and mosaics).
// Then the address wraps around the store (a torus), or with the mirror the
// counter runs back down from the end : the axis sits where it runs off, so it
// moves with pan and zoom.
float address(float c, float N, float Z, float p, float mag, bool mirrored) {
  float mid = floor(N * 0.5);
  float F0 = floor((mid + p * N) * 256.0 + 0.5) - mid * Z;
  float A = floor((F0 + c * Z) / 256.0);
  // the first clock of this address's run (a margin under 1 / Z keeps an exact
  // whole-number quotient from rounding up)
  float c0 = ceil((A * 256.0 - F0) / Z - 0.001);
  float M = c0 + floor(p * N + 0.5);
  float a = floor(mix(M, A, mag) + 0.5);
  if (mirrored) {
    float m = mod(a, 2.0 * N);
    return m < N ? m : 2.0 * N - 1.0 - m;
  }
  return mod(a, N);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 live = IMG_NORM_PIXEL(inputImage, uv);

  // The store : LINES tall, its pixels WIDE times wider than tall (a square-pixel
  // frame at 1; on a 16:9 frame 1.5 gives the wide pixels of a store clocked at
  // the color subcarrier).
  float aspect = RENDERSIZE.x / max(RENDERSIZE.y, 1.0);
  vec2 N = vec2(max(floor(lines * aspect / max(wide, 1.0) + 0.5), 1.0), max(floor(lines + 0.5), 1.0));
  // STRETCH : up = taller blocks (the vertical zoom grows), down = wider ones, up
  // to four times. Each axis's zoom becomes its whole-number latch (8 to 512 :
  // below 1 the store shrinks and repeats).
  vec2 zm = zoom * vec2(pow(4.0, max(-stretch, 0.0)), pow(4.0, max(stretch, 0.0)));
  vec2 Z = clamp(floor(256.0 / max(zm, vec2(0.01)) + 0.5), 8.0, 512.0);
  vec2 c = floor(uv * N);
  vec2 p = vec2(panX + PH_scrollX, panY + PH_scrollY);
  float ax = address(c.x, N.x, Z.x, p.x, magnify, mirror == 1);
  float ay = address(c.y, N.y, Z.y, p.y, magnify, mirror == 2);
  vec2 suv = (vec2(ax, ay) + 0.5) / N;
  vec4 st = IMG_NORM_PIXEL(inputImage, suv);
  gl_FragColor = mix(live, st, wet);
}
