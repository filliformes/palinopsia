/*{
  "DESCRIPTION": "Motif — spatial counterpoint (Basanta #8): re-instantiates the image's gesture ELSEWHERE in the frame, transposed — translated, rotated, scaled, optionally mirrored — so the same motif recurs at a new position with the same internal relations. Directional echoes (NOT radial/kaleidoscope symmetry): 1–3 copies stacking away from the source, each fainter.",
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
    { "NAME": "mode", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["over", "add", "screen", "max"], "DEFAULT": 0, "LABEL": "combine" }
  ]
}*/

// Sample coordinate for echo `i`: undo the echo's transposition (translate,
// rotate, scale about centre; optional mirror) so we read the source content
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

vec3 combine(vec3 base, vec3 e, float f, int m) {
  vec3 c = e * f;
  if (m == 1) return base + c;                          // add
  if (m == 2) return 1.0 - (1.0 - base) * (1.0 - c);    // screen
  if (m == 3) return max(base, c);                      // max
  return mix(base, e, f);                               // over (alpha = fade)
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 base = IMG_NORM_PIXEL(inputImage, uv);
  vec3 col = base.rgb;

  // Echo 1 — always (copies >= 1). Coord hoisted to a bare vec2 (runtime rule).
  vec2 c1 = xform(uv, 1.0);
  vec4 e1 = IMG_NORM_PIXEL(inputImage, c1);
  col = combine(col, e1.rgb, pow(fade, 1.0), mode);

  if (copies >= 2) {
    vec2 c2 = xform(uv, 2.0);
    vec4 e2 = IMG_NORM_PIXEL(inputImage, c2);
    col = combine(col, e2.rgb, pow(fade, 2.0), mode);
  }
  if (copies >= 3) {
    vec2 c3 = xform(uv, 3.0);
    vec4 e3 = IMG_NORM_PIXEL(inputImage, c3);
    col = combine(col, e3.rgb, pow(fade, 3.0), mode);
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), base.a);
}
