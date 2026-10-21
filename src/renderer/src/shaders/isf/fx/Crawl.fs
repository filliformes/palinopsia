/*{
  "DESCRIPTION": "Crawl : colors each place by how long ago it last changed. A pixel that changes by more than the THRESHOLD is stamped with the time, and the stamps are read through a slowly turning palette : motion leaves bands of color behind it (every place it passed at the same moment shares one) and CYCLE makes them crawl along its path. BAND is how many seconds of history one turn of the palette spans, STEPS cuts it into hard bands, FADE hands a stamp back to the picture after that many seconds. The palette is a ramp of 2 to 5 stops, or PICTURE : each place's own color run from near-black to pale. A pixel still changing shows the live picture. GROUND : the live picture, black, or clear (only the contours, over the layers below). CLEAR ▸ forgets the history.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Frame Store", "Time", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "threshold", "TYPE": "float", "MIN": 0.01, "MAX": 0.5,  "DEFAULT": 0.08, "LABEL": "threshold" },
    { "NAME": "fade",      "TYPE": "float", "MIN": 0.25, "MAX": 60.0, "DEFAULT": 8.0,  "LABEL": "fade (s)" },
    { "NAME": "clear",     "TYPE": "event", "LABEL": "clear ▸" },
    { "NAME": "ground",    "TYPE": "long",  "VALUES": [0, 1, 2], "LABELS": ["live", "black", "clear"], "DEFAULT": 0, "LABEL": "ground", "COMPACT": true },
    { "NAME": "wet",       "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 1.0,  "LABEL": "mix" },
    { "NAME": "band",      "TYPE": "float", "MIN": 0.05, "MAX": 4.0,  "DEFAULT": 1.0,  "LABEL": "band (s)" },
    { "NAME": "cycle",     "TYPE": "float", "MIN": -0.5, "MAX": 0.5,  "DEFAULT": 0.1,  "LABEL": "cycle (Hz)" },
    { "NAME": "steps",     "TYPE": "float", "MIN": 0.0, "MAX": 16.0,  "DEFAULT": 8.0,  "LABEL": "steps", "INTEGER": true },
    { "NAME": "palette",   "TYPE": "long",  "VALUES": [0, 1], "LABELS": ["ramp", "picture"], "DEFAULT": 0, "LABEL": "palette", "COMPACT": true },
    { "NAME": "stops",     "TYPE": "float", "MIN": 2.0, "MAX": 5.0,   "DEFAULT": 4.0,  "LABEL": "color stops", "INTEGER": true },
    { "NAME": "colorA", "TYPE": "color", "DEFAULT": [0.03, 0.03, 0.04, 1.0], "LABEL": "stop 1" },
    { "NAME": "colorB", "TYPE": "color", "DEFAULT": [0.12, 0.2, 0.28, 1.0],  "LABEL": "stop 2" },
    { "NAME": "colorC", "TYPE": "color", "DEFAULT": [0.78, 0.5, 0.22, 1.0],  "LABEL": "stop 3" },
    { "NAME": "colorD", "TYPE": "color", "DEFAULT": [0.94, 0.9, 0.8, 1.0],   "LABEL": "stop 4" },
    { "NAME": "colorE", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0],    "LABEL": "stop 5" }
  ],
  "PASSES": [
    { "TARGET": "hist", "PERSISTENT": true },
    { }
  ]
}*/

// Integrated clocks (engine/phases.ts) : the stamp clock, in seconds on the
// layer's own clock (Speed and freeze carry : a frozen layer holds its history),
// kept in [0, SPAN); and the palette index, ∫ (1 / band + cycle) : at cycle 0 a
// stamped pixel keeps its color while the newest stamps take the next ones.
uniform float PH_crawlClock; // wrap 128
uniform float PH_crawlIdx; // wrap 1

const vec3 LUMA = vec3(0.299, 0.587, 0.114);
const float SPAN = 128.0;  // the stamp clock's period : every age up to FADE's 60 s reads true
const float ATTACK = 0.12; // a fresh stamp shows the live picture, its color comes in over this

// The buffer `hist` : r = the brightness the pixel had at its last stamp (what it
// is compared with, so slow drifts add up to a change too), gb = the stamp time
// in 16 bits, a = the state : 0 empty (first frame, PANIC), ~0.5 no history (never
// changed, or faded), 1 stamped.
vec2 enc16(float x) {
  float v = floor(clamp(x, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  return vec2(hi, v - hi * 256.0) / 255.0;
}
float dec16(vec2 c) {
  vec2 b = floor(c * 255.0 + 0.5);
  return (b.x * 256.0 + b.y) / 65535.0;
}

vec3 stopColor(float idx) {
  if (idx < 0.5) return colorA.rgb;
  if (idx < 1.5) return colorB.rgb;
  if (idx < 2.5) return colorC.rgb;
  if (idx < 3.5) return colorD.rgb;
  return colorE.rgb;
}

// This frame's age of a pixel (seconds; -1 = no history), from LAST frame's
// buffer : the same in both passes (the output reads `hist` as it was before this
// frame's write), so a change shows this very frame.
float ageNow(vec4 h, float lum) {
  if (FRAMEINDEX == 0 || clear || h.a < 0.25) return -1.0;
  if (abs(lum - h.r) > threshold) return 0.0;
  if (h.a < 0.75) return -1.0;
  float age = fract(PH_crawlClock / SPAN - dec16(h.gb)) * SPAN;
  return age < fade ? age : -1.0;
}

// The palette at r (0..1) : the ramp of stops, or the place's own color run from
// near-black through itself to pale (its hue held even in the darks).
vec3 crawlColor(float r, vec3 src) {
  if (palette == 1) {
    float m = max(max(src.r, src.g), src.b);
    vec3 c = src / max(m, 0.2) * 0.8;
    return r < 0.5 ? mix(c * 0.06, c, r * 2.0) : mix(c, mix(c, vec3(1.0), 0.7), r * 2.0 - 1.0);
  }
  float n = floor(stops + 0.5);
  float t = r * (n - 1.0);
  float i = floor(min(t, n - 1.001));
  return mix(stopColor(i), stopColor(i + 1.0), t - i);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 live = IMG_NORM_PIXEL(inputImage, uv);
  vec4 h = IMG_NORM_PIXEL(hist, uv);
  // brightness over black : a transparent part counts as dark, so a shape moving
  // over transparency stamps its path too
  float lum = dot(live.rgb, LUMA) * live.a;

  if (PASSINDEX == 0) {
    // The very first draw samples a black input : stay EMPTY, never that black.
    if (FRAMEINDEX == 0) { gl_FragColor = vec4(0.0); return; }
    // (Re)start : the picture as it is becomes the reference, with no history,
    // so inserting the effect does not stamp the whole frame at once.
    if (clear || h.a < 0.25) { gl_FragColor = vec4(lum, 0.0, 0.0, 0.5); return; }
    if (abs(lum - h.r) > threshold) {
      gl_FragColor = vec4(lum, enc16(PH_crawlClock / SPAN), 1.0);
      return;
    }
    // A stamp past its fade becomes "no history" (before the 128 s clock wraps
    // and would make it young again).
    if (h.a > 0.75 && ageNow(h, lum) < 0.0) { gl_FragColor = vec4(h.r, 0.0, 0.0, 0.5); return; }
    gl_FragColor = h;
    return;
  }

  float age = ageNow(h, lum);
  float w = age < 0.0 ? 0.0 : smoothstep(0.0, ATTACK, age) * (1.0 - smoothstep(fade * 0.6, fade, age));
  float k = w * wet;

  // The palette index : when it was stamped, turned by the cycle. A ping-pong over
  // the ramp (dark, light, dark) so a turn has no hard seam; STEPS cuts it into
  // flat bands (the contour lines).
  float idx = fract(PH_crawlIdx - max(age, 0.0) / max(band, 0.05));
  float r = 1.0 - abs(idx * 2.0 - 1.0);
  float n = floor(steps + 0.5);
  if (n >= 2.0) r = min(floor(r * n), n - 1.0) / (n - 1.0);
  vec3 col = crawlColor(r, live.rgb);

  // The contours laid over the ground (straight alpha : premultiplied sum, then
  // divided back), so over transparency they keep their own color, no dark fringe.
  vec3 base = ground == 1 ? vec3(0.0) : live.rgb;
  float baseA = ground == 2 ? 0.0 : live.a;
  float A = k + baseA * (1.0 - k);
  vec3 P = col * k + base * baseA * (1.0 - k);
  gl_FragColor = vec4(A > 0.0 ? P / A : vec3(0.0), A);
}
