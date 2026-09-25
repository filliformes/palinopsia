/*{
  "DESCRIPTION": "Grain : physically-modelled noise per medium. FILM: clumped photochemical grain (value-noise, NOT white), 24fps reseed, amplitude peaking in the MIDTONES; optional colour-stock chroma grain. DIGITAL: honest sensor noise : signal-dependent SHOT noise (highlights), a constant READ-noise floor (shadows), and faint static fixed-pattern (PRNU). CRT: row-correlated snow; PARASITES add a rolling hum bar, faint RF herringbone and impulse specks. VHS: luma smear + chroma phase error; PARASITES add line jitter, the head-switch tear at the bottom, single-scanline dropouts with a recovery tail (in bursts) and, high up, a drifting tracking band. Parasites apply to CRT/VHS only.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Texture"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "character", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["digital", "film", "crt", "vhs"], "DEFAULT": 1 },
    { "NAME": "amount",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15 },
    { "NAME": "size",      "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 1.5 },
    { "NAME": "chroma",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "chroma grain" },
    { "NAME": "parasites", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2, "LABEL": "parasites (crt/vhs)" }
  ]
}*/

// Dave Hoskins hashes : strong, low-pattern distribution.
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// Box-Muller: two uniforms → ~N(0,1).
float gauss(float u1, float u2) {
  return sqrt(-2.0 * log(max(u1, 1e-6))) * cos(6.2831853 * u2);
}

// @parasites

void main() {
  vec2 uv0 = isf_FragNormCoord;
  float band = 0.0;
  bool vhsPar = character == 3 && parasites > 0.001;
  vec2 uv = vhsPar ? vhsWarp(uv0, parasites, TIME, band) : uv0;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  vec3 add = vec3(0.0); // total additive contribution

  if (character == 1) {
    // FILM : clumped grain (value noise), midtone-weighted, 24fps reseed.
    float seed = floor(TIME * 24.0);
    vec2 jit = hash22(vec2(seed, 1.0)) * 64.0;
    vec2 p = gl_FragCoord.xy / (max(size, 1.0) * 1.9) + jit;
    float g = vnoise(p) * 0.62 + vnoise(p * 2.3 + 11.0) * 0.38 - 0.5;
    g = sign(g) * pow(abs(g) * 2.0, 1.3) * 0.5; // gentle clump contrast
    float mid = pow(1.0 - abs(2.0 * l - 1.0), 0.6); // grain lives in the mids
    vec3 gn = vec3(g);
    if (chroma > 0.001) {
      float gr = vnoise(p + vec2(19.0, 3.0)) - 0.5;
      float gb = vnoise(p + vec2(7.0, 23.0)) - 0.5;
      gn = mix(vec3(g), vec3(gr, g, gb) * 1.1, chroma);
    }
    add = gn * amount * 1.15 * mid;
  } else if (character == 0) {
    // DIGITAL : sensor noise: shot (∝√signal, highlights) + read floor
    // (shadows) + static fixed-pattern gain. Fine, per-pixel. No debris.
    float fs = floor(TIME * 30.0);
    vec2 px = gl_FragCoord.xy / max(size, 1.0);
    float shot = gauss(hash21(px + fs * 7.3), hash21(px + fs * 7.3 + 57.0)) * sqrt(clamp(l, 0.02, 1.0));
    float read = gauss(hash21(px + fs * 7.3 + 123.0), hash21(px + fs * 7.3 + 199.0)) * 0.5;
    float n = shot * 0.7 + read * 0.45;
    float prnu = (hash21(floor(px)) - 0.5) * 0.12 * l; // static PRNU
    vec3 gn = vec3(n + prnu);
    if (chroma > 0.001) {
      float cn = hash21(px * 0.5 + fs * 3.0) - 0.5; // low-freq colour noise
      gn += vec3(cn, -cn * 0.3, -cn) * chroma * 0.35 * (1.0 - l * 0.7);
    }
    add = gn * amount * 0.55;
  } else if (character == 2) {
    // CRT : row-correlated snow at field rate + dropout bands (parasites).
    float row = floor(gl_FragCoord.y / max(size, 1.0));
    float seed = floor(TIME * 50.0);
    float rowSeed = hash21(vec2(row, seed));
    vec2 cell = vec2(floor(gl_FragCoord.x / max(size, 1.0)), row);
    float n = (hash21(cell + seed * 17.3) - 0.5) * (0.5 + rowSeed);
    vec3 noise = vec3(n);
    if (chroma > 0.001) {
      noise += vec3((hash21(cell + 301.0) - 0.5), 0.0, (hash21(cell + 502.0) - 0.5)) * chroma * 0.5;
    }
    float w = 0.35 + 0.65 * smoothstep(0.0, 0.4, l);
    add = noise * amount * w;
    if (parasites > 0.001) src.rgb = crtParasites(src.rgb, uv0, parasites, TIME);
  } else {
    // VHS : luma smear (horizontally correlated) + chroma phase error + streaks.
    float row = floor(gl_FragCoord.y / max(size, 1.0));
    float seed = floor(TIME * 30.0);
    float smear = vnoise(vec2(gl_FragCoord.x / (max(size, 1.0) * 14.0), row * 0.7 + seed * 3.0)) - 0.5;
    float fine = (hash21(vec2(floor(gl_FragCoord.x / max(size, 1.0)), row) + seed * 13.1) - 0.5) * 0.5;
    vec3 noise = vec3(smear * 0.7 + fine);
    float chromaErr = vnoise(vec2(row * 0.4, seed * 2.0)) - 0.5;
    noise += vec3(chromaErr * 0.6, 0.0, -chromaErr * 0.6);
    float w = 0.4 + 0.6 * smoothstep(0.0, 0.35, l);
    add = noise * amount * w;
    if (vhsPar) src.rgb = vhsParasites(src.rgb, uv0, parasites, TIME, band);
  }

  gl_FragColor = vec4(clamp(src.rgb + add, 0.0, 1.0), src.a);
}
