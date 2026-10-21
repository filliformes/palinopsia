
// ── The Finalizer's film and digital grain, one place ─────────────────────
// Inserted by the registry at the Finalizer's "// @grain" line, and into the
// dome stage (engine/dome.ts). GLSL ES 1.00 and 3.00 alike : math only.
//
// The Finalizer draws it over the flat frame. While the dome is on, the dome
// stage draws it instead, AFTER the mapping, in master pixels : drawn before,
// the dome's stretch blew each grain up 2-4x and pulled it oblong (worst at the
// fill's corner pinches), mud instead of grain. CRT and VHS noise stay in the
// Finalizer : their rows are the picture's own scan lines, bent and turned with
// it like their parasites.
//
// px : the pixel (gl_FragCoord.xy) · gs : the grain cell, in pixels · lum : the
// graded picture's luma there · t : seconds · chr : chroma grain · amt : amount.

float fgHash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 fgHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float fgNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fgHash21(i), fgHash21(i + vec2(1.0, 0.0)), f.x),
             mix(fgHash21(i + vec2(0.0, 1.0)), fgHash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fgGauss(float u1, float u2) {
  return sqrt(-2.0 * log(max(u1, 1e-6))) * cos(6.2831853 * u2);
}

// Film : two octaves of value noise, re-drawn 24 times a second, strongest in the
// midtones (none in pure black or white), optional dye-cloud chroma.
vec3 finalFilmGrain(vec2 px, float gs, float lum, float t, float chr, float amt) {
  float seed = mod(floor(t * 24.0), 32749.0);
  vec2 jit = fgHash22(vec2(seed, 1.0)) * 64.0;
  vec2 p = px / (gs * 1.9) + jit;
  float g = fgNoise(p) * 0.62 + fgNoise(p * 2.3 + 11.0) * 0.38 - 0.5;
  g = sign(g) * pow(abs(g) * 2.0, 1.3) * 0.5;
  float mid = pow(1.0 - abs(2.0 * lum - 1.0), 0.6);
  vec3 gn = vec3(g);
  if (chr > 0.001) {
    gn = mix(vec3(g), vec3(fgNoise(p + vec2(19.0, 3.0)) - 0.5, g, fgNoise(p + vec2(7.0, 23.0)) - 0.5) * 1.1, chr);
  }
  return gn * amt * 1.15 * mid;
}

// Digital : one sensel per grain cell, 30 frames a second : shot noise (grows
// with the light), read noise (even in black), fixed pattern (PRNU), optional
// chroma blotches in the shadows.
vec3 finalDigitalGrain(vec2 px, float gs, float lum, float t, float chr, float amt) {
  float fs = mod(floor(t * 30.0), 4096.0);
  // One sensel per grain cell : the hash needs whole-number-spaced input
  // (an unfloored coordinate made the size knob do nothing). The frame
  // offset is wrapped small so the hash keeps its precision.
  vec2 pxg = floor(px / gs);
  vec2 fo = vec2(mod(fs * 37.0, 1024.0), mod(fs * 91.0, 1024.0));
  float shot = fgGauss(fgHash21(pxg + fo), fgHash21(pxg + fo + 57.0)) * sqrt(clamp(lum, 0.02, 1.0));
  float rd = fgGauss(fgHash21(pxg + fo + 123.0), fgHash21(pxg + fo + 199.0)) * 0.5;
  float prnu = (fgHash21(pxg) - 0.5) * 0.12 * lum;
  vec3 gn = vec3(shot * 0.7 + rd * 0.45 + prnu);
  if (chr > 0.001) {
    float cn = fgHash21(floor(pxg * 0.5) + fo * 0.5) - 0.5;
    gn += vec3(cn, -cn * 0.3, -cn) * chr * 0.35 * (1.0 - lum * 0.7);
  }
  return gn * amt * 0.55;
}
