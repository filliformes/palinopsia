/*{
  "DESCRIPTION": "Riso : the picture printed on a risograph. It is separated into two or three spot inks (fluorescent pink, blue and yellow by default : any colors), each ink taking the part of the picture it can print; every plate gets its own screen (a stochastic GRAIN, DOTS or LINES) at CELL size, is slightly out of register (MISREG, wandering slowly by DRIFT, re-dealt by SEED), runs short of ink in patches and streaks along the drum (STARVE), and the inks overprint each other on the PAPER, whose own grain shows (TOOTH).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Print"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "inks", "TYPE": "long", "VALUES": [2, 3], "LABELS": ["two inks", "three inks"], "DEFAULT": 2, "LABEL": "inks" },
    { "NAME": "ink1", "TYPE": "color", "DEFAULT": [1.0, 0.28, 0.55, 1.0], "LABEL": "ink 1" },
    { "NAME": "ink2", "TYPE": "color", "DEFAULT": [0.0, 0.47, 0.75, 1.0], "LABEL": "ink 2" },
    { "NAME": "ink3", "TYPE": "color", "DEFAULT": [1.0, 0.91, 0.0, 1.0], "LABEL": "ink 3" },
    { "NAME": "screen", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["grain", "dots", "lines"], "DEFAULT": 0, "LABEL": "screen" },
    { "NAME": "cell", "TYPE": "float", "MIN": 1.0, "MAX": 16.0, "DEFAULT": 3.0, "LABEL": "cell" },
    { "NAME": "contrast", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.1, "LABEL": "contrast" },
    { "NAME": "misreg", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35, "LABEL": "misregister" },
    { "NAME": "drift", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "drift" },
    { "NAME": "seed", "TYPE": "float", "MIN": 0.0, "MAX": 100.0, "DEFAULT": 7.0, "LABEL": "seed" },
    { "NAME": "starve", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "starve" },
    { "NAME": "paper", "TYPE": "color", "DEFAULT": [0.95, 0.93, 0.88, 1.0], "LABEL": "paper" },
    { "NAME": "tooth", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "tooth" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" }
  ]
}*/

// The plates wander at DRIFT (an integrated phase : no jump on a change).
uniform float PH_drift;

float rsHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float rsNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rsHash(i), rsHash(i + vec2(1.0, 0.0)), f.x), mix(rsHash(i + vec2(0.0, 1.0)), rsHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// What each ink takes of a color : its cover k (0..1) so that the paper times the
// inks overprinted comes nearest the color (a small non-negative least squares on
// the absorbances, a few rounds), for two or three inks.
vec3 separate(vec3 v, vec3 a1, vec3 a2, vec3 a3, float n3) {
  vec3 d = clamp(1.0 - v, 0.0, 1.0); // the darkness to print, per channel
  vec3 k = vec3(0.0);
  for (int it = 0; it < 6; it++) {
    vec3 r = d - (k.x * a1 + k.y * a2 + k.z * a3 * n3);
    k.x = clamp(k.x + dot(r, a1) / max(dot(a1, a1), 1e-3), 0.0, 1.0);
    r = d - (k.x * a1 + k.y * a2 + k.z * a3 * n3);
    k.y = clamp(k.y + dot(r, a2) / max(dot(a2, a2), 1e-3), 0.0, 1.0);
    if (n3 > 0.5) {
      r = d - (k.x * a1 + k.y * a2 + k.z * a3);
      k.z = clamp(k.z + dot(r, a3) / max(dot(a3, a3), 1e-3), 0.0, 1.0);
    }
  }
  return k;
}

// One plate's screen threshold at a pixel, its own angle
float screenT(vec2 px, float sc, float ang, int scr, float salt) {
  if (scr == 0) {
    // grain : the riso's own stochastic dots, a little clustered
    vec2 g = floor(px / sc);
    return rsHash(g + salt) * 0.7 + rsNoise(px / (sc * 2.5) + salt) * 0.3;
  }
  float ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(ca * px.x + sa * px.y, -sa * px.x + ca * px.y) / (sc * 3.0);
  if (scr == 1) return clamp(length(fract(q) - 0.5) * 1.41421, 0.0, 1.0);
  return abs(fract(q.y) - 0.5) * 2.0;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float k1080 = RENDERSIZE.y / 1080.0;
  float sc = max(1.0, floor(cell * k1080 + 0.5));
  int scr = int(float(screen) + 0.5);
  float n3 = int(float(inks) + 0.5) >= 3 ? 1.0 : 0.0;
  vec3 a1 = 1.0 - ink1.rgb, a2 = 1.0 - ink2.rgb, a3 = 1.0 - ink3.rgb;
  // each plate slipped its own way : dealt by SEED, wandering by DRIFT
  float mr = misreg * 7.0 * k1080;
  vec2 s1 = (vec2(rsHash(vec2(seed, 1.0)), rsHash(vec2(seed, 2.0))) - 0.5) * 2.0 * mr;
  vec2 s2 = (vec2(rsHash(vec2(seed, 3.0)), rsHash(vec2(seed, 4.0))) - 0.5) * 2.0 * mr;
  vec2 s3 = (vec2(rsHash(vec2(seed, 5.0)), rsHash(vec2(seed, 6.0))) - 0.5) * 2.0 * mr;
  vec2 w = vec2(sin(PH_drift * 0.7), cos(PH_drift * 0.53)) * mr * 0.5;
  s1 += w; s2 -= w.yx; s3 += w * vec2(-1.0, 1.0);
  vec2 px = gl_FragCoord.xy;
  // each plate reads the picture where it sits
  vec2 u1 = clamp((px + s1) / RENDERSIZE, 0.0, 1.0);
  vec2 u2 = clamp((px + s2) / RENDERSIZE, 0.0, 1.0);
  vec2 u3 = clamp((px + s3) / RENDERSIZE, 0.0, 1.0);
  vec4 t1 = IMG_NORM_PIXEL(inputImage, u1);
  vec4 t2 = IMG_NORM_PIXEL(inputImage, u2);
  vec4 t3 = IMG_NORM_PIXEL(inputImage, u3);
  vec3 c1 = clamp((t1.rgb * t1.a - 0.5) * contrast + 0.5, 0.0, 1.0);
  vec3 c2 = clamp((t2.rgb * t2.a - 0.5) * contrast + 0.5, 0.0, 1.0);
  vec3 c3 = clamp((t3.rgb * t3.a - 0.5) * contrast + 0.5, 0.0, 1.0);
  float k1 = separate(c1, a1, a2, a3, n3).x;
  float k2 = separate(c2, a1, a2, a3, n3).y;
  float k3 = n3 > 0.5 ? separate(c3, a1, a2, a3, n3).z : 0.0;
  // starved ink : patches and streaks along the drum (horizontal), each plate its own
  float st = starve;
  float v1 = 1.0 - st * smoothstep(0.35, 0.85, rsNoise(px / (90.0 * k1080) + seed) * 0.7 + rsNoise(vec2(px.x / (400.0 * k1080), px.y / (6.0 * k1080)) + seed) * 0.3);
  float v2 = 1.0 - st * smoothstep(0.35, 0.85, rsNoise(px / (90.0 * k1080) + seed + 11.0) * 0.7 + rsNoise(vec2(px.x / (400.0 * k1080), px.y / (6.0 * k1080)) + seed + 5.0) * 0.3);
  float v3 = 1.0 - st * smoothstep(0.35, 0.85, rsNoise(px / (90.0 * k1080) + seed + 23.0) * 0.7 + rsNoise(vec2(px.x / (400.0 * k1080), px.y / (6.0 * k1080)) + seed + 9.0) * 0.3);
  // the screens : ink where the cover beats the plate's threshold
  float p1 = step(1.0 - k1 * v1, screenT(px + s1, sc, 0.26, scr, 1.0));
  float p2 = step(1.0 - k2 * v2, screenT(px + s2, sc, 1.31, scr, 2.0));
  float p3 = step(1.0 - k3 * v3, screenT(px + s3, sc, 0.0, scr, 3.0)) * n3;
  // the paper's tooth, then the inks overprinted (they multiply, as on the drum)
  vec3 pap = paper.rgb * (1.0 - tooth * 0.12 * (rsNoise(px * 0.7) - 0.5) * 2.0);
  vec3 col = pap;
  col *= mix(vec3(1.0), ink1.rgb, p1 * 0.92);
  col *= mix(vec3(1.0), ink2.rgb, p2 * 0.92);
  col *= mix(vec3(1.0), ink3.rgb, p3 * 0.92);
  gl_FragColor = vec4(mix(src.rgb, col, amount), mix(src.a, 1.0, amount));
}
