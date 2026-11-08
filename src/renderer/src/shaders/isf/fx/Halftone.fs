/*{
  "DESCRIPTION": "Halftone : the picture as a printed screen. Each cell of a turned grid reads the tone under its middle and grows a dot that size : round, square, diamond, a line or an ellipse. MODE : one ink on paper, two inks (the dark in one, the color in the other), CMYK (four plates at their own screen angles, cyan 15, magenta 75, yellow 0, black 45, slightly out of register), or the picture's own colors as dots on black. CELL is the dot pitch (in 1080p pixels), ANGLE turns the screen, GAIN swells the dots as wet ink does, SOFT and GRIT shape their edges, MISREG slips the plates apart.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Print"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "mode", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["ink on paper", "two inks", "CMYK", "color dots on black"], "DEFAULT": 0, "LABEL": "mode" },
    { "NAME": "cell", "TYPE": "float", "MIN": 3.0, "MAX": 48.0, "DEFAULT": 9.0, "LABEL": "cell" },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 1.5708, "DEFAULT": 0.785, "LABEL": "angle" },
    { "NAME": "shape", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["round", "square", "diamond", "line", "ellipse"], "DEFAULT": 0, "LABEL": "dot" },
    { "NAME": "gain", "TYPE": "float", "MIN": -0.5, "MAX": 0.5, "DEFAULT": 0.08, "LABEL": "dot gain" },
    { "NAME": "soft", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2, "LABEL": "soft" },
    { "NAME": "grit", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2, "LABEL": "grit" },
    { "NAME": "misreg", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "misregister" },
    { "NAME": "ink", "TYPE": "color", "DEFAULT": [0.08, 0.08, 0.1, 1.0], "LABEL": "ink" },
    { "NAME": "ink2", "TYPE": "color", "DEFAULT": [0.86, 0.24, 0.2, 1.0], "LABEL": "second ink" },
    { "NAME": "paper", "TYPE": "color", "DEFAULT": [0.95, 0.93, 0.88, 1.0], "LABEL": "paper" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" }
  ]
}*/

float hHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hHash(i), hHash(i + vec2(1.0, 0.0)), f.x), mix(hHash(i + vec2(0.0, 1.0)), hHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// How far a point is from its dot's middle, for each dot shape, 0..~1 at the cell's
// edge : a dot covering `a` of the cell is where this is under dotR(a).
float dotDist(vec2 f, int sh) {
  if (sh == 1) return max(abs(f.x), abs(f.y)) * 2.0;
  if (sh == 2) return (abs(f.x) + abs(f.y));
  if (sh == 3) return abs(f.y) * 2.0;
  if (sh == 4) return length(f * vec2(0.7, 1.3)) * 2.0;
  return length(f) * 2.0;
}
float dotR(float a, int sh) {
  // the radius (in dotDist's units) that covers a share `a` of the cell
  if (sh == 1) return sqrt(a);
  if (sh == 3) return a;
  if (sh == 2) return a <= 0.5 ? sqrt(a * 0.5) : 1.0 - sqrt((1.0 - a) * 0.5);
  float r = sqrt(a * 4.0 * (sh == 4 ? 0.91 : 1.0) / 3.14159265);
  // past the round dot's own reach the corners close up, as on press : solid ink
  return mix(r, 1.55, smoothstep(0.72, 0.98, a));
}

// One plate : its screen turned by `ang`, `tone` (a share 0..1 of ink) read at
// each cell's middle; returns the ink cover at this pixel (the cell's own dot and
// its four neighbors', for dots grown past the cell).
float plate(vec2 px, float ang, float pitch, int sh, vec2 shift, int which, out vec3 dotCol) {
  float ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(ca * px.x + sa * px.y, -sa * px.x + ca * px.y) / pitch;
  vec2 i0 = floor(q);
  float cover = 0.0;
  dotCol = vec3(0.0);
  for (int k = 0; k < 5; k++) {
    vec2 o = k == 0 ? vec2(0.0) : k == 1 ? vec2(1.0, 0.0) : k == 2 ? vec2(-1.0, 0.0) : k == 3 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
    vec2 cc = (i0 + o + 0.5) * pitch;
    vec2 cp = vec2(ca * cc.x - sa * cc.y, sa * cc.x + ca * cc.y);
    vec2 cuv = clamp((cp + shift) / RENDERSIZE, 0.0, 1.0);
    vec4 t = IMG_NORM_PIXEL(inputImage, cuv);
    vec3 v = t.rgb * t.a;
    float a;
    float kk = 1.0 - max(v.r, max(v.g, v.b));
    if (which == 0) a = 1.0 - dot(v, vec3(0.299, 0.587, 0.114));
    else if (which == 1) a = kk < 0.999 ? (1.0 - v.r - kk) / (1.0 - kk) : 0.0;
    else if (which == 2) a = kk < 0.999 ? (1.0 - v.g - kk) / (1.0 - kk) : 0.0;
    else if (which == 3) a = kk < 0.999 ? (1.0 - v.b - kk) / (1.0 - kk) : 0.0;
    else if (which == 4) a = kk;
    else if (which == 5) {
      // the color of the dot itself : as bright as the color is
      a = max(v.r, max(v.g, v.b));
    } else {
      // two inks : the second takes the saturated part
      float mx = max(v.r, max(v.g, v.b)), mn = min(v.r, min(v.g, v.b));
      a = (mx - mn) * 1.2;
    }
    a = clamp(a + gain * a * (1.0 - a) * 2.0, 0.0, 1.0);
    vec2 f = q - (i0 + o) - 0.5;
    float d = dotDist(f, sh);
    float r = dotR(a, sh);
    float e = (0.04 + soft * 0.35) * (1.0 + grit * (hNoise(px * 0.35) - 0.5) * 2.0);
    float cov = (a > 0.002) ? 1.0 - smoothstep(r - e, r + e, d + grit * 0.18 * (hNoise(px * 0.9 + 7.0) - 0.5)) : 0.0;
    if (cov > cover) { cover = cov; dotCol = v; }
  }
  return cover;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  int md = int(float(mode) + 0.5);
  int sh = int(float(shape) + 0.5);
  float k1080 = RENDERSIZE.y / 1080.0;
  float pitch = max(2.0, cell * k1080);
  vec2 px = gl_FragCoord.xy;
  vec3 col;
  vec3 dc;
  float mr = misreg * 4.0 * k1080;
  if (md == 2) {
    // CMYK : each plate its own angle (the classic 15 / 75 / 0 / 45, turned with
    // ANGLE) and its own slip; the inks multiply on the paper
    float base = angle - 0.785398;
    float cC = plate(px, base + 0.261799, pitch, sh, vec2(mr, 0.0), 1, dc);
    float cM = plate(px, base + 1.308997, pitch, sh, vec2(-mr * 0.6, mr * 0.8), 2, dc);
    float cY = plate(px, base, pitch, sh, vec2(0.0, -mr), 3, dc);
    float cK = plate(px, base + 0.785398, pitch, sh, vec2(0.0), 4, dc);
    col = paper.rgb;
    col *= mix(vec3(1.0), vec3(0.0, 0.66, 0.92), cC);
    col *= mix(vec3(1.0), vec3(0.92, 0.1, 0.56), cM);
    col *= mix(vec3(1.0), vec3(1.0, 0.92, 0.0), cY);
    col *= mix(vec3(1.0), vec3(0.12, 0.12, 0.13), cK);
  } else if (md == 1) {
    // two inks : the dark in the first, the color in the second, at their own angles
    float c1 = plate(px, angle, pitch, sh, vec2(0.0), 0, dc);
    float c2 = plate(px, angle + 0.523599, pitch, sh, vec2(mr, -mr * 0.5), 6, dc);
    col = paper.rgb;
    col *= mix(vec3(1.0), ink2.rgb, c2);
    col = mix(col, ink.rgb, c1);
  } else if (md == 3) {
    // the picture's own colors, as dots of light on black
    float c = plate(px, angle, pitch, sh, vec2(0.0), 5, dc);
    float mx = max(dc.r, max(dc.g, dc.b));
    col = (mx > 0.0 ? dc / mx : vec3(0.0)) * c;
  } else {
    float c = plate(px, angle, pitch, sh, vec2(0.0), 0, dc);
    col = mix(paper.rgb, ink.rgb, c);
  }
  gl_FragColor = vec4(mix(src.rgb, col, amount), mix(src.a, 1.0, amount));
}
