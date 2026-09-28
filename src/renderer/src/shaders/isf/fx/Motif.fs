/*{
  "DESCRIPTION": "Motif : spatial counterpoint: re-instantiates the image's gesture ELSEWHERE in the frame, transposed : translated, rotated, scaled, optionally mirrored : so the same motif recurs at a new position with the same internal relations. Directional echoes (NOT radial/kaleidoscope symmetry): 1–3 copies stacking away from the source, each fainter. In over mode an echo covers the picture only where it has content (its dark ground lets the source through); echoes moved off the frame show nothing, and echoes moved into transparent areas stay visible. Audio lets echo 1, 2 and 3 ride the low, mid and high bands.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Stylize"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "copies", "TYPE": "long", "VALUES": [1, 2, 3], "LABELS": ["1", "2", "3"], "DEFAULT": 2, "LABEL": "copies" },
    { "NAME": "offX", "TYPE": "float", "MIN": -0.5, "MAX": 0.5, "DEFAULT": 0.16, "LABEL": "offset x" },
    { "NAME": "offY", "TYPE": "float", "MIN": -0.5, "MAX": 0.5, "DEFAULT": 0.1, "LABEL": "offset y" },
    { "NAME": "rotate", "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": 0.35, "LABEL": "rotate" },
    { "NAME": "scale", "TYPE": "float", "MIN": 0.5, "MAX": 1.6, "DEFAULT": 0.88, "LABEL": "scale" },
    { "NAME": "fade", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.62, "LABEL": "fade" },
    { "NAME": "invert", "TYPE": "bool", "DEFAULT": false, "LABEL": "mirror", "COMPACT": true },
    { "NAME": "mode", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["over", "add", "screen", "max"], "DEFAULT": 0, "LABEL": "combine" },
    { "NAME": "audio", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio echoes" },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// Sample coordinate for echo `i`: undo the echo's transposition (translate,
// rotate, scale about center; optional mirror) so we read the source content
// that lands there. Aspect-corrected so rotation isn't sheared.
vec2 xform(vec2 uv, float i) {
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float a = -rotate * i;
  float cs = cos(a), sn = sin(a);
  p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
  p /= pow(scale, i);
  p /= vec2(aspect, 1.0);
  p += 0.5;
  p -= vec2(offX, offY) * i;
  if (invert) p.x = 1.0 - p.x;
  return p;
}

// Soft in-frame mask (1.5 px ramp) : an echo transposed off the frame shows
// nothing there, instead of dragging the clamped edge row across the picture
// (wedge-shaped streaks when rotated).
float inFrame(vec2 c) {
  vec2 px = 1.5 / RENDERSIZE;
  vec2 lo = smoothstep(vec2(0.0), px, c);
  vec2 hi = smoothstep(vec2(0.0), px, 1.0 - c);
  return lo.x * lo.y * hi.x * hi.y;
}

// Spectrum band for echo i (1 = low, 2 = mid, 3 = high) : three taps across a
// third of the log-spaced spectrum row.
float band(float i) {
  float u0 = (i - 1.0) / 3.0;
  float s = 0.0;
  for (int k = 0; k < 3; k++) {
    vec2 ac = vec2(u0 + (float(k) + 0.5) / 9.0, 0.75);
    s += IMG_NORM_PIXEL(audioTex, ac).r;
  }
  return s / 3.0;
}

vec3 combine(vec3 base, vec3 e, float f, int m) {
  vec3 c = e * f;
  if (m == 1) return base + c;                          // add
  if (m == 2) return 1.0 - (1.0 - base) * (1.0 - c);    // screen
  if (m == 3) return max(base, c);                      // max
  return mix(base, e, f);                               // over (alpha = fade)
}

// Lay echo i (sampled at c) onto the running color / alpha. On an opaque
// base this is exactly `combine`; where the base is transparent the echo keeps
// its own color at alpha = its weight, so moved content never vanishes.
void addEcho(inout vec3 col, inout float a, vec2 c, float i) {
  vec4 e = IMG_NORM_PIXEL(inputImage, c);
  float w = pow(fade, i);
  if (audio > 0.0) w *= mix(1.0, clamp(band(i) * 2.0, 0.0, 1.5), audio); // skip the taps when off
  // Coverage : the echo's own alpha, in frame. In over mode also keyed by its
  // brightness, so a dark ground does not paint over (and dim) the source :
  // the crossfade of whole frames left the source at 23% at the defaults.
  float key = mode == 0 ? smoothstep(0.04, 0.25, dot(e.rgb, vec3(0.299, 0.587, 0.114))) : 1.0;
  w *= e.a * inFrame(c) * key;
  vec3 r = combine(col, e.rgb, w, mode);
  float na = a + w * (1.0 - a);
  col = (r * a + e.rgb * w * (1.0 - a)) / max(na, 1e-4);
  a = na;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 base = IMG_NORM_PIXEL(inputImage, uv);
  vec3 col = base.rgb;
  float a = base.a;

  // Echo 1 : always (copies >= 1). Coords hoisted to a bare vec2 (runtime rule).
  vec2 c1 = xform(uv, 1.0);
  addEcho(col, a, c1, 1.0);
  if (copies >= 2) {
    vec2 c2 = xform(uv, 2.0);
    addEcho(col, a, c2, 2.0);
  }
  if (copies >= 3) {
    vec2 c3 = xform(uv, 3.0);
    addEcho(col, a, c3, 3.0);
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), a);
}
