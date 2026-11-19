/*{
  "DESCRIPTION": "Glass : the picture seen through a pane of patterned glass that really refracts. Each pattern is a surface (fluted columns, fine reeds, rippled cathedral glass, hammered dimples, a stippled pebble, prisms, or plain frost); its slope bends the light by DEPTH, red, green and blue a little apart by DISPERSION (the color split at every edge), FROST scatters it, SHINE puts the window's light on the ridges and the seams go dark. SCALE is how many across the frame, ANGLE turns the pattern, TINT colors the glass. DRIFT lets the pane wander and flow, EVOLVE bends the pattern out of its classic shape : meandering ribbons, breathing scale, one glass turning into another.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glass", "Distortion"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "pattern", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4, 5, 6], "LABELS": ["fluted", "reeded", "rippled", "hammered", "pebbled", "prism", "frosted"], "DEFAULT": 0, "LABEL": "pattern" },
    { "NAME": "scale", "TYPE": "float", "MIN": 2.0, "MAX": 120.0, "DEFAULT": 18.0, "LABEL": "scale" },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 3.1416, "DEFAULT": 0.0, "LABEL": "angle" },
    { "NAME": "depth", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.45, "LABEL": "depth" },
    { "NAME": "dispersion", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "dispersion" },
    { "NAME": "frost", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1, "LABEL": "frost" },
    { "NAME": "shine", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35, "LABEL": "shine" },
    { "NAME": "seams", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "seams" },
    { "NAME": "lightAngle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 2.36, "LABEL": "light angle" },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [0.94, 0.97, 1.0, 1.0], "LABEL": "tint" },
    { "NAME": "drift", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "drift" },
    { "NAME": "evolve", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "evolve" }
  ]
}*/

// DRIFT and EVOLVE run on integrated phases (a knob change never jumps them) :
// the pane wanders along a slow path in every direction and a soft current bends
// it as it goes (DRIFT : how lively, 0 still); EVOLVE meanders the pattern into
// ribbons, lets its scale breathe and turns regions into the next glass, on its
// own clock (0 : the classic pattern, as before).
uniform float PH_drift;
uniform float PH_evolve;

float gHash(vec2 p) {
  // third-party: Hash without Sine
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 gHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// The glass's surface height at a point of the pattern's own space (q : one unit
// per element), 0..1, and how dark its seam is there (s).
float surf(vec2 q, int pat, out float s) {
  s = 0.0;
  if (pat == 0) {
    // fluted : rounded columns side by side, a groove between them
    float x = fract(q.x) - 0.5;
    s = smoothstep(0.42, 0.5, abs(x));
    return sqrt(max(0.0, 1.0 - 4.0 * x * x));
  } else if (pat == 1) {
    // reeded : finer, flatter ribs with a sharper groove
    float x = fract(q.x * 2.0) - 0.5;
    s = smoothstep(0.38, 0.5, abs(x));
    return pow(max(0.0, 1.0 - 4.0 * x * x), 0.35);
  } else if (pat == 2) {
    // rippled : cathedral glass, slow uneven waves
    return gNoise(q * 0.55) * 0.65 + gNoise(q * 1.3 + 7.0) * 0.35;
  } else if (pat == 3) {
    // hammered : round dimples, the nearest dimple's bowl
    vec2 i = floor(q), f = fract(q);
    float d1 = 9.0, d2 = 9.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = g + gHash2(i + g) * 0.8 + 0.1 - f;
      float d = dot(o, o);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    s = 1.0 - smoothstep(0.0, 0.12, sqrt(d2) - sqrt(d1));
    // (a shallow bowl : hammered glass dimples, it does not shatter)
    return 1.0 - d1 * 0.9;
  } else if (pat == 4) {
    // pebbled : a fine stipple of small bumps
    return (gNoise(q * 2.2) * 0.6 + gNoise(q * 4.7 + 3.0) * 0.4) * 0.3;
  } else if (pat == 5) {
    // prism : straight facets, a sharp step every element
    float x = fract(q.x);
    s = smoothstep(0.9, 1.0, x);
    return x;
  }
  return 0.0;
}

// The surface with EVOLVE : regions slowly turning into the next glass.
float surfE(vec2 q, int pat, float ev, float te, out float s) {
  float h = surf(q, pat, s);
  if (ev <= 0.0) return h;
  float m = smoothstep(0.3, 0.7, gNoise(q * 0.06 + vec2(te * 0.4, -te * 0.3))) * ev;
  if (m <= 0.001) return h;
  float s2;
  int pat2 = pat >= 5 ? (pat == 5 ? 2 : 3) : pat + 1;
  float h2 = surf(q * 1.15 + 3.7, pat2, s2);
  s = mix(s, s2, m);
  return mix(h, h2, m);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  int pat = int(float(pattern) + 0.5);
  float ca = cos(angle), sa = sin(angle);
  // the frame in frame heights, turned by ANGLE, SCALE elements across its height
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 q = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y) * scale;
  // DRIFT : the pane wanders (a slow meander, every direction) and a current
  // bends it as it goes, livelier with the knob (none at 0 : the pane still)
  float td = PH_drift;
  q += (vec2(gNoise(vec2(td * 0.23, 1.7)), gNoise(vec2(4.3, td * 0.19))) - 0.5) * 8.0;
  float fa = clamp(drift * 3.0, 0.0, 1.0);
  if (fa > 0.0)
    q += (vec2(gNoise(q * 0.21 + vec2(td * 0.35, 3.0)), gNoise(q * 0.21 + vec2(11.0, -td * 0.31))) - 0.5) * fa * 1.4;
  // EVOLVE : the pattern meanders out of its classic shape and its scale breathes
  float ev = evolve;
  float te = PH_evolve * 0.25;
  if (ev > 0.0) {
    vec2 w = vec2(gNoise(q * 0.18 + vec2(te, 0.0)), gNoise(q * 0.18 + vec2(5.2, -te))) - 0.5;
    w += 0.5 * (vec2(gNoise(q * 0.41 + vec2(2.0 - te * 1.3, 0.0)), gNoise(q * 0.41 + vec2(8.0, te * 1.1))) - 0.5);
    q += w * ev * 4.0;
    q *= 1.0 + (gNoise(q * 0.07 + vec2(te * 0.5, 1.3)) - 0.5) * ev * 0.8;
  }
  // the slope by central differences, in the turned space, then back to the frame's
  float e = 0.03;
  float s0, s1, s2;
  float h = surfE(q, pat, ev, te, s0);
  float hx = surfE(q + vec2(e, 0.0), pat, ev, te, s1) - surfE(q - vec2(e, 0.0), pat, ev, te, s2);
  float hy = surfE(q + vec2(0.0, e), pat, ev, te, s1) - surfE(q - vec2(0.0, e), pat, ev, te, s2);
  vec2 gq = vec2(hx, hy) / (2.0 * e);
  vec2 g = vec2(ca * gq.x - sa * gq.y, sa * gq.x + ca * gq.y);
  // (frosted has no relief of its own : only what EVOLVE turns into one)
  if (pat == 6 && ev <= 0.0) g = vec2(0.0);
  // the bend : the slope over the element's size (a fine pattern bends less far)
  vec2 off = -g * depth * 0.06 * (18.0 / max(2.0, scale)) * vec2(1.0 / aspect, 1.0);
  // frost : a few taps scattered round the bent point, per pixel
  float fr = frost * frost * 0.02 + (pat == 6 ? 0.006 + frost * 0.03 : 0.0);
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int k = 0; k < 6; k++) {
    float fk = float(k);
    vec2 j = (gHash2(uv * RENDERSIZE + fk * 17.31) - 0.5) * fr * vec2(1.0 / aspect, 1.0);
    // dispersion : red bends least, blue most
    vec2 cr = clamp(uv + off * (1.0 - 0.25 * dispersion) + j, 0.0, 1.0);
    vec2 cg = clamp(uv + off + j, 0.0, 1.0);
    vec2 cb = clamp(uv + off * (1.0 + 0.3 * dispersion) + j, 0.0, 1.0);
    vec4 tr = IMG_NORM_PIXEL(inputImage, cr);
    vec4 tg = IMG_NORM_PIXEL(inputImage, cg);
    vec4 tb = IMG_NORM_PIXEL(inputImage, cb);
    col += vec3(tr.r, tg.g, tb.b);
    a += tg.a;
  }
  col /= 6.0;
  a /= 6.0;
  // the window's light on the ridges : a soft sheen where the slope faces it
  vec3 N = normalize(vec3(-g * 0.35, 1.0));
  vec3 L = normalize(vec3(cos(lightAngle), sin(lightAngle), 1.1));
  float spec = pow(max(0.0, dot(reflect(-L, N), vec3(0.0, 0.0, 1.0))), 28.0);
  float sheen = (spec * 0.9 + pow(max(0.0, 1.0 - N.z), 2.0) * 0.6) * shine;
  col = col * tint.rgb * (1.0 - seams * 0.55 * s0) + vec3(sheen) * mix(vec3(1.0), tint.rgb, 0.4);
  gl_FragColor = vec4(col, max(a, min(1.0, sheen)));
}
