// The materials that Relief (a source), Inflate and Drape (effects) share : a height
// given a light, as paint, plastic, chrome, a soap film or a holographic foil. GLSL ES
// 3.00, math only. The foil after Holocloth by Dmitry Kurash (MIT,
// github.com/dmitrykurash/holocloth) : micro-flakes, a diffraction hue that follows
// the angle, glints gated by angle, and the metal's own color tinted by the rainbow
// (what makes a foil flash rather than glow).
// Thin film after the optics every soap bubble obeys : light reflected off a film's two
// faces interferes, by phase 4 pi n d cos(t) / lambda, half a wave shifted at the first face.

export const FILM_GLSL = `
// The color a film of \`nm\` nanometers gives back at this angle (cosI : the incidence).
// Nine wavelengths, each weighted by a rough tristimulus response. 0 nm reflects
// nothing (the black of a bubble about to burst).
vec3 filmColor(float nm, float cosI, float ior) {
  float sinT2 = (1.0 - cosI * cosI) / (ior * ior);
  float cosT = sqrt(max(0.0, 1.0 - sinT2));
  vec3 sum = vec3(0.0);
  vec3 norm = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    float l = 400.0 + 35.0 * float(i);
    float phase = 12.5663706 * ior * nm * cosT / l;
    // two-beam reflectance, the half-wave shift at the first face makes a thin film dark
    float I = 0.5 - 0.5 * cos(phase);
    vec3 w = vec3(exp(-pow((l - 605.0) / 52.0, 2.0)) + 0.18 * exp(-pow((l - 445.0) / 24.0, 2.0)),
                  exp(-pow((l - 545.0) / 48.0, 2.0)),
                  exp(-pow((l - 455.0) / 34.0, 2.0)));
    sum += I * w;
    norm += w;
  }
  return sum / norm;
}
`

export const RELIEF_SHADE = `${FILM_GLSL}
// A photo studio to reflect : a dark room, a big softbox where the lamp stands, a
// strip light opposite, a floor. It turns with the lamp, so turning the light slides
// every reflection across the metal.
vec3 studio(vec3 r, float az) {
  float c = cos(-az), s = sin(-az);
  vec3 q = vec3(c * r.x - s * r.y, s * r.x + c * r.y, r.z);
  // a pale ceiling, a hard dark horizon, a warm floor : what makes metal read as metal
  vec3 sky = mix(vec3(0.86, 0.89, 0.95), vec3(0.09, 0.1, 0.13), smoothstep(0.06, 0.92, q.z));
  vec3 gnd = mix(vec3(0.008, 0.008, 0.01), vec3(0.17, 0.145, 0.125), smoothstep(0.0, -0.85, q.z));
  vec3 room = mix(gnd, sky, smoothstep(-0.015, 0.03, q.z));
  // the key softbox
  float bx = smoothstep(0.6, 0.44, abs(q.y)) * smoothstep(0.1, 0.26, q.x) * smoothstep(0.92, 0.7, q.x);
  bx *= smoothstep(0.04, 0.16, q.z);
  // the strip light opposite
  float strip = smoothstep(0.1, 0.05, abs(q.y - 0.25)) * smoothstep(-0.2, -0.32, q.x) * smoothstep(0.92, 0.7, -q.x) * smoothstep(0.0, 0.12, q.z);
  return room + vec3(1.0, 0.98, 0.95) * bx * 1.7 + vec3(0.72, 0.8, 1.0) * strip * 0.9;
}

// Flowing metal : instead of the room, bands of light running across the surface by
// themselves. The bands live in the direction the surface reflects, so they wrap round
// the real volume, and a little in the frame, so a flat top still shows them passing.
// Red and blue read the same bands a little ahead and behind : the color split, widest
// where the surface turns away, as a prism does.
uniform float uFlow, uFlowT, uBands, uSplit, uRipple;
float flowN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 q = vec4(i.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
  vec3 a = fract(vec3(q.xyx) * 0.1031); a += dot(a, a.yzx + 33.33);
  vec3 b = fract(vec3(q.zyz) * 0.1031); b += dot(b, b.yzx + 33.33);
  vec3 c = fract(vec3(q.xwx) * 0.1031); c += dot(c, c.yzx + 33.33);
  vec3 d = fract(vec3(q.zwz) * 0.1031); d += dot(d, d.yzx + 33.33);
  return mix(mix(fract((a.x + a.y) * a.z), fract((b.x + b.y) * b.z), f.x),
             mix(fract((c.x + c.y) * c.z), fract((d.x + d.y) * d.z), f.x), f.y);
}
// Where in the bands this reflection falls (they run at an angle to the lamp, and turn with it)
float flowAt(vec3 r, vec2 P, float az) {
  vec2 d = vec2(cos(az + 1.22), sin(az + 1.22));
  float rip = uRipple > 0.0 ? uRipple * 1.5 * (flowN(P * 3.1 + uFlowT * 0.23) + 0.5 * flowN(P * 7.3 - uFlowT * 0.31) - 0.75) : 0.0;
  return dot(r.xy, d) * uBands * 0.55 + dot(P, d) * uBands * 0.45 + rip - uFlowT;
}
// One band, s in 0..1 : a hard bright line, a dark gap, a thin line, then a long slide to dark
float flowBand(float s, float w) {
  float first = smoothstep(0.0, w, s) - smoothstep(0.07, 0.07 + w, s);
  float rest = smoothstep(0.11, 0.11 + w, s) * (1.0 - smoothstep(0.11, 1.0, s));
  return max(first, rest * rest);
}
// What this direction sees : the room, or as much of the bands as FLOWING asks
vec3 roomAt(vec3 r, float az, vec2 P, float nv, float w) {
  vec3 st = studio(r, az);
  if (uFlow <= 0.0) return st;
  float s = flowAt(r, P, az);
  float sp = uSplit * (0.03 + 0.34 * (1.0 - nv));
  vec3 b = vec3(flowBand(fract(s + sp), w), flowBand(fract(s), w), flowBand(fract(s - 1.3 * sp), w));
  return mix(st, mix(vec3(0.03, 0.03, 0.045), vec3(1.0, 1.0, 1.03), b), uFlow);
}

// The foil's knobs : how much rainbow (0 : silver), the flakes per frame height,
// how many glints fire. A shader that never uses the foil leaves them at 0.
uniform float uFoilSat, uFoilScale, uFoilGlint;
float foilHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 foilHue(float h) {
  vec3 c = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c * c * (3.0 - 2.0 * c);
}

// A surface lit : M the material (0 matte 1 metal 2 brushed 3 gloss plastic 4 chrome
// 5 ink 6 film 7 foil), N its normal, L the lamp, a its color, g how tight its highlight.
vec3 shadeSurface(float M, vec3 a, vec3 N, vec3 L, float az, float g, vec3 reflected, float reflectAmt, float film, float filmNm, vec2 P) {
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float nl = max(0.0, dot(N, L));
  float nv = max(0.0, N.z);
  float fres = pow(1.0 - nv, 5.0);
  vec3 r = reflect(-V, N);
  // (the band edges as wide as a pixel of them, so they never shimmer where they crowd)
  float w = uFlow > 0.0 ? 0.012 + 1.5 * fwidth(flowAt(r, P, az)) : 0.012;
  vec3 env = mix(roomAt(r, az, P, nv, w), reflected, reflectAmt);
  vec3 c;
  if (M < 0.5) {
    // matte : a soft wrapped light and a broad dull sheen, as on modeling clay
    float wrap = (dot(N, L) + 0.45) / 1.45;
    c = a * (0.14 + 0.92 * max(0.0, wrap) * max(0.0, wrap)) + vec3(0.12) * pow(max(0.0, dot(N, H)), 14.0);
    c += a * fres * 0.15 + env * reflectAmt * 0.25;
  } else if (M < 1.5) {
    // polished colored metal
    c = env * mix(vec3(1.0), a * 1.35, 0.72) + vec3(1.0) * pow(max(0.0, dot(N, H)), 90.0 * g) * 0.9;
  } else if (M < 2.5) {
    // brushed metal : the highlight stretched across the cut
    // and the room's reflection blurred by the scratches, with a shoulder : never a flat band
    vec3 e = roomAt(normalize(r + vec3(0.17, 0.0, 0.0)), az, P, nv, w + 0.1) + roomAt(normalize(r - vec3(0.17, 0.0, 0.0)), az, P, nv, w + 0.1)
           + roomAt(normalize(r + vec3(0.0, 0.17, 0.0)), az, P, nv, w + 0.1) + roomAt(normalize(r - vec3(0.0, 0.17, 0.0)), az, P, nv, w + 0.1);
    e = mix(e * 0.25, reflected, reflectAmt);
    e /= 1.0 + 0.35 * e;
    float sp = pow(max(0.0, dot(N, H)), 22.0 * g);
    c = e * mix(vec3(1.0), a * 1.3, 0.8) * 0.85 + a * sp * 0.45 + vec3(0.9) * pow(sp, 6.0) * 0.3;
  } else if (M < 3.5) {
    // molded plastic : a colored body, a clear hard shine
    c = a * (0.2 + 0.85 * nl) + vec3(1.0) * pow(max(0.0, dot(N, H)), 120.0 * g) * 0.75 + env * (0.04 + 0.5 * fres);
  } else if (M < 4.5) {
    // chrome : only what it reflects
    c = env * mix(vec3(1.0), a * 1.25, 0.18) + vec3(1.0) * pow(max(0.0, dot(N, H)), 200.0 * g) * 1.2;
  } else if (M < 5.5) {
    // ink : flat
    c = a;
  } else if (M > 6.5) {
    // foil : each flake (a cell in the frame, so they hold at 4K and on the dome) is
    // tilted a little its own way; the hue follows the angle, the lamp and the place
    vec2 cell = floor(P * max(8.0, uFoilScale));
    float r1 = foilHash(cell), r2 = foilHash(cell + 17.31);
    vec3 Nf = normalize(N + (vec3(r1, r2, 0.5) - 0.5) * 0.09);
    // (the hue from the surface itself, so the rainbow runs in bands over the folds;
    // each flake only nudges it, and tilts its own glint and grain)
    float facing = max(0.0, N.z);
    float fresF = pow(1.0 - facing, 1.5);
    vec3 rb = foilHue(fract(az * 0.159 + facing * 1.7 + length(P) * 0.9 + r1 * 0.03));
    vec3 tintF = mix(vec3(1.0), rb, uFoilSat);
    float flake = 0.82 + 0.18 * r2;
    // a sparse set of flakes flashes at its own angle, as the lamp moves
    float gate = fract(r2 * 13.7 + max(0.0, Nf.z) * 6.0 + az * 0.8);
    float glint = smoothstep(1.0 - 0.012 * (0.3 + 2.0 * uFoilGlint), 1.0, gate) * 5.0 * uFoilGlint;
    vec3 rf = reflect(-V, Nf);
    vec3 e = mix(roomAt(rf, az, P, facing, w), reflected, reflectAmt);
    // the metal's color tinted by the rainbow : the reflections themselves go iridescent
    vec3 F0 = mix(vec3(0.92), a, 0.45) * (0.3 + tintF * 0.85);
    c = e * F0 * flake + tintF * ((0.22 + 0.78 * fresF) * flake * 0.22 + glint * fresF * 0.5)
      + vec3(1.0) * pow(max(0.0, dot(Nf, H)), 160.0 * g) * 0.7;
  } else {
    // a soap film over dark : its colors, what it reflects on top
    vec3 f = filmColor(filmNm, nv, 1.33);
    c = f * f * (0.3 + 0.62 * nv) + env * (0.05 + 0.55 * fres) + vec3(1.0) * pow(max(0.0, dot(N, H)), 160.0 * g) * 0.8;
  }
  // an oil slick over anything shiny
  if (film > 0.0 && M >= 0.5 && M < 5.5) {
    vec3 f = filmColor(filmNm, nv, 1.4);
    c = mix(c, c * (0.2 + 1.5 * f) + f * f * 0.1, film);
  }
  return c;
}
`
