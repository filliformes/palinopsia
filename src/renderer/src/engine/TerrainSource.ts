// TerrainSource : the native Terrain generator (id 'gen-terrain'). A picture raised
// into a solid landscape and seen across : the layer picked as SIDECHAIN (or a land
// of its own : rolling hills, ridges, dunes, a crater, islands) becomes the height
// of a lit, occluding land, raised by its brightness, its darkness or its depth (the
// depth model reading THAT picture, as the Point Cloud does), cut into stepped
// terraces with contour lines on the steps, colored by the picture or a ramp by
// height, lit by a sun that casts shadows across it, hazed toward the horizon, with
// an optional lake at a level. The camera stands over it (TILT from grazing to
// straight down, TURN, HEIGHT, DISTANCE, LENS) and can FLY forward over an endless
// field (the picture repeated, mirrored, or one island on a plain).
//
// How it is drawn : a height-field ray march per pixel at the composition's size,
// walking a MAX PYRAMID of the height (each cell holds the highest point under it),
// so a ray skips whole empty cells instead of creeping : a grazing view stays cheap
// and nothing is stepped over. The march ends in a few bisections on the real
// (filtered, terraced) surface. Far away the surface is read from coarser mip levels
// and the terraces soften, so flying never shimmers. One more small pass finds, by
// the same march, where each hand points on the land and how high the ground stands
// under the camera (it rises over the peaks instead of entering them).
//
// What the hand does (the mouse on the preview, a pinching hand, the Room's people) :
// it PRESSES the land down, RAISES it, or SPREADS it apart, and the marks heal back
// over HEAL seconds (a field of its own, kept in the land's coordinates).
//
// An OIL SLICK on the water : a black sheen spreading over the lake between the land,
// its edges in the petrol rainbow (the thin-film colors Thin Film and the Slick effect
// share), gathering along the shores and lapping at them, a dark wet line on the beach
// above. Its coverage grows toward OIL ON THE WATER at SLICK SPREAD's pace; it calms the
// ripples where it is thick (oil damps them) and drifts slowly with the water.
// third-party: Oil appearance code (the order from the thin edge in : rainbow, then black)
//
// THE SOUND AS LAND (raised by : the sound) : the spectrum heard now is laid down as a
// strip of land at the camera's feet, bass to the left, treble to the right, the loud
// bands rising into hills; each strip moves away toward the horizon as new ones come,
// at SOUND SPEED, and the land SURGES forward on the sound's hits. A history texture
// of its own (256 strips), drawn by the same passes as a picture's brightness.
// third-party: Form Vision (the idea : the spectrum laid down as a strip of land that
// recedes to the horizon, and the land surging forward on a hit)
//
// Dome (full-dome fill) : stretched like any picture, the view kept square so the
// land keeps its proportions. Never re-projected to true directions.
//
// third-party: ReactDrops (the idea : a picture raised into a terraced, lit landscape)
// third-party: Terrain raymarching (the method : marching a height field from the camera,
// and the shadows softened by how near the ray toward the sun passes the land)
// third-party: Maximum mipmaps (the method : a pyramid of the highest points, so a ray
// skips whole empty cells)
// Written for Palinopsia from the idea and the published methods alone : no code taken.

import { EngineGL, SlotClock, Edge, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator, SourcePointer } from './nativeGenerators'
import { domeFill } from './domeSignal'
import { TouchPoints, Onset } from './touchInput'
import { PictureDepthReader, pictureDepth } from './pictureDepth'
import { FILM_GLSL } from './reliefShade'

const LMAX = 5 // max pyramid levels above the field (cells of 2..32 texels)
const MAX_HANDS = 8
const PROBE_W = MAX_HANDS + 1 // the hands, then the ground under the camera
const TAU = Math.PI * 2
const FIELD_LONG = 1024 // field texels on the picture's long side (a multiple of 2^LMAX)

// ── Shared GLSL : the land, its height, the march ────────────────────────────

const LAND_GLSL = `
uniform sampler2D uField;   // rgb : the picture's color, a : its height (mipmapped, wrapped by the sampler)
uniform sampler2D uMax;     // the max pyramid of the height (mips 0..${LMAX})
uniform vec2 uFieldRes;     // field texels across one tile
uniform float uTexel;       // world size of one texel
uniform float uHt;          // world height of a full white
uniform float uN;           // terraces (0 : none)
uniform float uR;           // the riser's share of a step (1 : soft, small : a cliff)
uniform int uEdge;          // beyond the picture : 0 mirrored, 1 repeated, 2 an island on a plain
uniform vec2 uOff;          // the flight, in texels
uniform float uPix;         // one pixel's angle
uniform float uTop;         // nothing stands higher
uniform float uLeaf;        // the march's finest cell, in pixels' footprints (a power of two)
int gIt = 0;                // (the march's steps, for the test hook's heat map)
bool gLost = false;         // the march ran out of steps (far, skimming the peaks)
vec3 gN = vec3(0.0);        // (the last normal shaded, for the test hook)

vec2 toG(vec2 xz) { return vec2(xz.x, -xz.y) / uTexel + uOff + 0.5 * uFieldRes; }

// the picture's place for a point of the land, and (island) how much of it is there
vec2 placeAt(vec2 G, out float m) {
  m = 1.0;
  if (uEdge != 2) return G / uFieldRes;
  vec2 q = mod(G + uFieldRes, 3.0 * uFieldRes) - uFieldRes;
  vec2 e = min(q, uFieldRes - q) / uFieldRes.y;
  m = smoothstep(0.0, 0.06, min(e.x, e.y));
  return clamp(q / uFieldRes, 0.0, 1.0);
}

float terrace(float h, float r) {
  if (uN < 0.5) return h;
  float y = h * uN;
  float i = floor(y);
  return (i + smoothstep(1.0 - r, 1.0, y - i)) / uN;
}
// far away the steps soften : a crisp step a pixel wide would crawl as the camera moves
float riserAt(float lod) { return mix(uR, 1.0, smoothstep(0.5, 2.5, lod)); }

float rawAt(vec2 G, float lod) {
  float m;
  vec2 uv = placeAt(G, m);
  return m * textureLod(uField, uv, lod).a;
}
float hgt(vec2 G, float lod) { return uHt * terrace(rawAt(G, lod), riserAt(lod)); }

// Close up (a texel over several pixels) the bilinear height shows its facets, one
// per texel : stripes on a steep wall under a low sun. The shading reads a cubic
// B-spline there instead (four filtered taps), the far land the plain filtered one.
float rawSmooth(vec2 G, float lod) {
  float k = smoothstep(0.6, 1.4, lod);
  if (k >= 1.0) return rawAt(G, lod);
  vec2 st = G - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = i - 0.5 + w1 / g0, h1 = i + 1.5 + w3 / g1;
  float c = g0.y * (g0.x * rawAt(vec2(h0.x, h0.y), 0.0) + g1.x * rawAt(vec2(h1.x, h0.y), 0.0))
          + g1.y * (g0.x * rawAt(vec2(h0.x, h1.y), 0.0) + g1.x * rawAt(vec2(h1.x, h1.y), 0.0));
  return k > 0.0 ? mix(c, rawAt(G, lod), k) : c;
}

float lodAt(float t) { return max(0.0, log2(max(t * uPix / uTexel, 1e-6))); }

// the highest point in cell c of level L (cs : its size in texels). Mirrored and
// repeated, the sampler wraps it; the island's plain is folded here.
float maxAt(vec2 c, float cs, int L) {
  if (uEdge != 2) return textureLod(uMax, (c + 0.5) * cs / uFieldRes, float(L)).r;
  vec2 n = uFieldRes / cs;
  c = clamp(mod(c + n, 3.0 * n) - n, vec2(0.0), n - 1.0);
  return max(texelFetch(uMax, ivec2(c), L).r, 0.0);
}

// The march : the first point where the ray meets the land, or -1. Every cell of the
// pyramid is a box the land never rises out of (its top : the soft terrace of its
// highest point, above every sharper one), so a ray passing over a box skips it whole.
float trace(vec3 ro, vec3 rd, float tEnd) {
  float t = 0.0;
  if (ro.y > uTop) {
    if (rd.y >= -1e-5) return -1.0;
    t = (ro.y - uTop) / -rd.y;
  }
  vec2 G0 = toG(ro.xz);
  vec2 Gd = vec2(rd.x, -rd.z) / uTexel;
  Gd = vec2(abs(Gd.x) < 1e-7 ? 1e-7 : Gd.x, abs(Gd.y) < 1e-7 ? 1e-7 : Gd.y);
  float nudge = 1e-3 / max(max(abs(Gd.x), abs(Gd.y)), 1e-3);
  // A ray skimming the land far away crosses many small cells for little on the
  // screen (its pixel stretches along the ground) : there the finest cell grows.
  float graze = clamp(-log2(max(abs(rd.y), 0.01)) - 2.0, 0.0, 3.5);
  gLost = false;
  int L = ${LMAX};
  for (int i = 0; i < 200; i++) {
    if (t > tEnd) return -1.0;
    vec3 p = ro + rd * t;
    if (rd.y >= 0.0 && p.y > uTop) return -1.0;
    gIt = i;
    float lod = lodAt(t);
    int leaf = min(int(lod + uLeaf + graze * smoothstep(0.8, 4.0, t)), ${LMAX});
    L = max(L, leaf);
    vec2 G = G0 + Gd * t;
    float cs = exp2(float(L));
    vec2 c = floor(G / cs);
    vec2 tb = ((c + step(0.0, Gd)) * cs - G0) / Gd;
    // (a span never longer than two cells of the world : a ray looking straight
    // down leaves no cell, and bisecting a long span would lose the surface)
    float tx = min(max(min(tb.x, tb.y), t), t + cs * uTexel * 2.0);
    float hm = uHt * terrace(maxAt(c, cs, L), 1.0);
    float yB = ro.y + rd.y * tx;
    // (up a level only on leaving the parent cell : inside it the parent says nothing new)
    if (min(p.y, yB) > hm) {
      t = tx + nudge;
      if (any(notEqual(floor((G0 + Gd * t) / (2.0 * cs)), floor(c * 0.5)))) L = min(L + 1, ${LMAX});
      continue;
    }
    if (L > leaf) {
      if (rd.y < 0.0 && p.y > hm) t = (hm - ro.y) / rd.y;
      L--;
      continue;
    }
    // the leaf : the real surface, at the middle and the end of the span
    float ta = t, tb2 = -1.0;
    float tm = 0.5 * (t + tx);
    if (ro.y + rd.y * tm < hgt(G0 + Gd * tm, lod)) tb2 = tm;
    else {
      ta = tm;
      if (yB < hgt(G0 + Gd * tx, lod)) tb2 = tx;
    }
    if (tb2 > 0.0) {
      for (int k = 0; k < 7; k++) {
        float tc = 0.5 * (ta + tb2);
        if (ro.y + rd.y * tc < hgt(G0 + Gd * tc, lod)) tb2 = tc; else ta = tc;
      }
      return 0.5 * (ta + tb2);
    }
    t = tx + nudge;
    if (any(notEqual(floor((G0 + Gd * t) / (2.0 * cs)), floor(c * 0.5)))) L = min(L + 1, ${LMAX});
  }
  // Out of steps (far, skimming peak after peak) : a coarse walk the rest of the
  // way on the softened land, then the bisections. Neighbors find the same land, so
  // no streaks; the haze hides what the coarse walk misses.
  gLost = true;
  float te = tEnd;
  float dt = max((te - t) / 40.0, uTexel);
  float ta = t;
  for (int k = 0; k < 40; k++) {
    float tc = ta + dt;
    if (tc > te) break;
    float lod = lodAt(tc) + 1.5;
    if (ro.y + rd.y * tc < hgt(G0 + Gd * tc, lod)) {
      float tb3 = tc;
      for (int j = 0; j < 6; j++) {
        float tm = 0.5 * (ta + tb3);
        if (ro.y + rd.y * tm < hgt(G0 + Gd * tm, lod)) tb3 = tm; else ta = tm;
      }
      return 0.5 * (ta + tb3);
    }
    ta = tc;
  }
  return -1.0;
}

// the camera : its eye rises over the ground under it (the probe's last texel)
uniform vec3 uEye, uTgt;
uniform float uFocal, uClear;
uniform sampler2D uProbe;
uniform vec2 uRes;
uniform int uSquare;
void camera(out vec3 ro, out vec3 F, out vec3 R, out vec3 U) {
  ro = uEye;
  ro.y = max(ro.y, texelFetch(uProbe, ivec2(${MAX_HANDS}, 0), 0).r + uClear);
  F = normalize(uTgt - ro);
  R = normalize(cross(F, abs(F.y) > 0.999 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0)));
  U = cross(R, F);
}
// s : frame heights from the center (under fill the view is square)
vec3 rayFor(vec2 s, vec3 F, vec3 R, vec3 U) { return normalize(F * uFocal + R * s.x + U * s.y); }
`

// third-party: Hash without Sine
const HASH_GLSL = `
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}`

// The land of its own : gradient noise that repeats across the tile (so the
// repeated edge is seamless) and moves slowly in its third axis (EVOLVE).
const OWN_GLSL = `
${HASH_GLSL}
uniform int uOwn;
uniform float uScale, uEvo, uAsp;
vec3 grad(vec3 i, vec2 P) { return hash33(vec3(mod(i.xy, P), i.z)) * 2.0 - 1.0; }
float gnoise(vec3 p, vec2 P) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(grad(i, P), f);
  float n100 = dot(grad(i + vec3(1, 0, 0), P), f - vec3(1, 0, 0));
  float n010 = dot(grad(i + vec3(0, 1, 0), P), f - vec3(0, 1, 0));
  float n110 = dot(grad(i + vec3(1, 1, 0), P), f - vec3(1, 1, 0));
  float n001 = dot(grad(i + vec3(0, 0, 1), P), f - vec3(0, 0, 1));
  float n101 = dot(grad(i + vec3(1, 0, 1), P), f - vec3(1, 0, 1));
  float n011 = dot(grad(i + vec3(0, 1, 1), P), f - vec3(0, 1, 1));
  float n111 = dot(grad(i + vec3(1, 1, 1), P), f - vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
// periods : whole cells across the tile, doubled each octave (still whole)
vec2 periodFor(float base) { return max(vec2(1.0), floor(vec2(base * uAsp, base) * uScale + 0.5)); }
float fbm(vec2 uv, float base, int oct, float gain) {
  vec2 P = periodFor(base);
  float a = 0.5, s = 0.0, z = uEvo;
  for (int k = 0; k < 6; k++) {
    if (k >= oct) break;
    s += a * gnoise(vec3(uv * P, z), P);
    P *= 2.0;
    a *= gain;
    z = z * 1.7 + 3.1;
  }
  return s;
}
float ridged(vec2 uv, float base) {
  vec2 P = periodFor(base);
  float s = 0.0, w = 1.0, a = 0.55, z = uEvo;
  for (int k = 0; k < 6; k++) {
    float n = 1.0 - abs(gnoise(vec3(uv * P, z), P) * 1.6);
    n *= n;
    s += n * a * w;
    w = clamp(n * 1.4, 0.0, 1.0);
    P *= 2.0;
    a *= 0.5;
    z = z * 1.7 + 3.1;
  }
  return s;
}
float ownLand(vec2 uv) {
  if (uOwn == 0) { // rolling hills
    float n = fbm(uv, 2.0, 5, 0.45);
    return clamp(0.5 + 1.1 * n, 0.0, 1.0);
  }
  if (uOwn == 1) { // ridges : a mountain range with sharp crests
    return clamp(ridged(uv, 1.3) * 0.95 - 0.08, 0.0, 1.0);
  }
  if (uOwn == 2) { // dunes : a long windward slope, a steep lee, crests that wander
    vec2 P = periodFor(1.0);
    float cnt = max(3.0, floor(6.0 * uAsp * uScale + 0.5));
    float ph = uv.x * cnt + 1.3 * fbm(uv, 1.0, 3, 0.5) * cnt / 6.0 + 0.35 * fbm(uv + 0.37, 2.0, 2, 0.5);
    float f = fract(ph);
    float r = f < 0.72 ? f / 0.72 : (1.0 - f) / 0.28;
    r = r * r * (3.0 - 2.0 * r);
    float swell = 0.7 + 0.6 * fbm(uv + 0.71, 1.0, 2, 0.5);
    return clamp(0.08 + 0.72 * r * swell + 0.06 * fbm(uv, 6.0, 3, 0.5), 0.0, 1.0);
  }
  if (uOwn == 3) { // a crater : the bowl, its rim, a central peak, ejecta
    vec2 d = (uv - 0.5) * vec2(uAsp, 1.0);
    float rr = length(d) / (0.34 * uScale);
    float wall = smoothstep(0.45, 1.0, rr);
    float bowl = rr < 1.0 ? -0.3 * (1.0 - rr * rr) + 0.3 * wall * wall : 0.0;
    float rq = (rr - 1.0) / 0.24; // (squared by hand : pow() of a negative base is undefined)
    float rim = 0.26 * exp(-rq * rq);
    float ej = rr > 1.0 ? 0.14 * exp(-(rr - 1.0) * 1.8) : 0.0;
    float peak = 0.2 * exp(-pow(rr / 0.2, 2.0));
    float det = fbm(uv, 3.0, 5, 0.5);
    return clamp(0.42 + bowl + rim + ej + peak + 0.1 * det, 0.0, 1.0);
  }
  // islands : land rising out of a flat sea floor
  float n = fbm(uv, 2.0, 5, 0.5);
  return clamp(smoothstep(-0.05, 0.42, n) * 0.9 + 0.05 * fbm(uv, 8.0, 2, 0.5), 0.0, 1.0);
}`

// ── The passes ────────────────────────────────────────────────────────────────

// The height, gliding toward the picture's (SETTLE).
const HEIGHT_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUV;
out vec4 o;
uniform sampler2D uPrev, uSide, uMap, uDef;
uniform int uMode;    // 0 its own land, 1 brightness, 2 darkness, 3 the depth model's map
uniform float uK;
uniform float uSlide; // the sound : how far it has moved between two strips (v)
uniform vec2 uCell;
${OWN_GLSL}
float lumaA(vec2 uv) {
  vec4 c = texture(uSide, uv);
  return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)) * c.a;
}
void main() {
  vec2 uv = vUV - texture(uDef, vUV).gb;
  uv.y -= uSlide;
  float t;
  if (uMode == 0) t = ownLand(uv);
  else if (uMode == 3) t = texture(uMap, uv).r;
  else {
    vec2 h = uCell * 0.25;
    float l = 0.25 * (lumaA(uv + vec2(-h.x, -h.y)) + lumaA(uv + vec2(h.x, -h.y)) + lumaA(uv + vec2(-h.x, h.y)) + lumaA(uv + vec2(h.x, h.y)));
    if (uMode == 2) {
      float a = texture(uSide, uv).a;
      t = a - l;
    } else t = l;
  }
  o = vec4(mix(texture(uPrev, vUV).r, clamp(t, 0.0, 1.0), uK), 0.0, 0.0, 1.0);
}`

// THE SOUND AS LAND : the history of the spectrum, a strip a row. The rows under SHIFT
// take the spectrum heard now (the shared audio texture's log spectrum, its row at v
// 0.75); the others move up by SHIFT rows, toward the horizon (the land's far side is
// the picture's top). Between two strips the first row keeps the loudest of what it
// heard : at a slow speed a hit fell between two strips and left no hill. Under the sound
// lies a low rolling ground, laid with each strip and moving with it : silence is a quiet
// country, never a blank plane. Gray, so the height pass reads it as brightness.
const SOUND_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUV;
out vec4 o;
uniform sampler2D uPrev, uAudio;
uniform float uShift, uGain;
uniform float uStrip; // how many strips have been laid (wraps at 4096 : the ground's own period)
// third-party: Hash without Sine
float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float quiet(vec2 p, float per) {
  vec2 i = floor(p), f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  float a = mod(i.y, per), b = mod(i.y + 1.0, per);
  return mix(mix(h21(vec2(i.x, a)), h21(vec2(i.x + 1.0, a)), f.x), mix(h21(vec2(i.x, b)), h21(vec2(i.x + 1.0, b)), f.x), f.y);
}
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  float v;
  if (float(px.y) < max(uShift, 1.0)) {
    float s = texture(uAudio, vec2(vUV.x, 0.75)).r;
    float row = uStrip - float(px.y);
    float low = 0.7 * quiet(vec2(vUV.x * 5.0, row / 64.0), 64.0) + 0.3 * quiet(vec2(vUV.x * 13.0 + 7.0, row / 32.0), 128.0);
    v = clamp(pow(max(s, 0.0), 1.3) * uGain + 0.34 * low * low, 0.0, 1.0);
    if (uShift < 0.5) v = max(v, texelFetch(uPrev, px, 0).r);
  } else v = texelFetch(uPrev, ivec2(px.x, px.y - int(uShift)), 0).r;
  o = vec4(v, v, v, 1.0);
}`

// SMOOTH : a gaussian, one axis a pass (taps a quarter sigma apart).
const BLUR_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUV;
out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uDir;     // one tap, in uv
uniform float uSig;    // sigma, in taps
void main() {
  float s = 0.0, w = 0.0;
  for (int i = -12; i <= 12; i++) {
    float x = float(i);
    float k = exp(-x * x / (2.0 * uSig * uSig));
    s += texture(uSrc, vUV + uDir * x).r * k;
    w += k;
  }
  o = vec4(s / w, 0.0, 0.0, 1.0);
}`

// The field the march reads : the picture's color and the land's height, shaped
// (PEAKS draws the summits up out of a mass, ROCK breaks the raised land into
// ridges) with the hand's marks.
const FIELD_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUV;
out vec4 o;
uniform sampler2D uH, uSide, uDef;
uniform int uHasSide;
uniform float uPeaks, uRock;
${OWN_GLSL}
void main() {
  vec4 d = texture(uDef, vUV);
  vec2 uv = vUV - d.gb;
  vec3 c = uHasSide == 1 ? texture(uSide, uv).rgb : vec3(0.0);
  float h = max(texture(uH, vUV).r, 0.0);
  if (uPeaks > 0.001) h = pow(h, 1.0 + 2.5 * uPeaks);
  if (uRock > 0.001) h += uRock * 0.32 * (ridged(uv, 2.5) - 0.42) * smoothstep(0.02, 0.35, h);
  o = vec4(c, clamp(h + d.r, -0.5, 1.2));
}`

// The max pyramid's first level : the highest of each texel and its neighbors (a
// filtered read between texels never rises above them).
const MAX0_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
out vec4 o;
uniform sampler2D uField;
uniform vec2 uFieldRes;
uniform int uWrapX;
void main() {
  vec2 c = floor(gl_FragCoord.xy);
  float m = -1.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 q = c + vec2(float(i), float(j));
    q = uWrapX == 1 ? mod(q, uFieldRes) : clamp(q, vec2(0.0), uFieldRes - 1.0);
    m = max(m, texelFetch(uField, ivec2(q), 0).a);
  }
  o = vec4(m, 0.0, 0.0, 1.0);
}`

// A higher level : the highest of four (reads the level below, the only one the
// sampler sees while this one is drawn).
const MAXN_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
out vec4 o;
uniform sampler2D uSrc;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy) * 2;
  float m = max(max(texelFetch(uSrc, c, 0).r, texelFetch(uSrc, c + ivec2(1, 0), 0).r),
                max(texelFetch(uSrc, c + ivec2(0, 1), 0).r, texelFetch(uSrc, c + ivec2(1, 1), 0).r));
  o = vec4(m, 0.0, 0.0, 1.0);
}`

// The probe : where each hand points on the land (texels 0..7 : place, met, distance)
// and the ground under the camera (the last texel, gliding : quick up, slow down).
const PROBE_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 o;
${LAND_GLSL}
uniform vec2 uHandS[${MAX_HANDS}];
uniform int uNH;
uniform float uUp, uDown;
uniform int uFresh;
void main() {
  int k = int(gl_FragCoord.x);
  vec4 prev = texelFetch(uProbe, ivec2(k, 0), 0);
  if (k == ${MAX_HANDS}) {
    vec2 G = toG(uEye.xz);
    float g = -1.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) g = max(g, hgt(G + vec2(float(i), float(j)) * 6.0, 2.0));
    float kk = uFresh == 1 ? 1.0 : g > prev.r ? uUp : uDown;
    o = vec4(mix(prev.r, g, kk), 0.0, 0.0, 1.0);
    return;
  }
  if (k >= uNH) { o = vec4(0.0); return; }
  vec3 ro, F, R, U;
  camera(ro, F, R, U);
  vec3 rd = rayFor(uHandS[k], F, R, U);
  float t = trace(ro, rd, 40.0);
  if (t < 0.0) { o = vec4(0.0); return; }
  vec2 G = toG((ro + rd * t).xz);
  float m;
  vec2 uv = placeAt(G, m);
  if (uEdge == 0) { vec2 q = mod(uv, 2.0); uv = mix(q, 2.0 - q, step(1.0, q)); }
  else if (uEdge == 1) uv = fract(uv);
  o = vec4(uv, 1.0, t);
}`

// The hand's marks : pressed down, raised, or spread apart, healing back.
const DEF_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUV;
out vec4 o;
uniform sampler2D uPrev, uProbe;
uniform float uDecay, uDt;
uniform vec4 uHand[${MAX_HANDS}]; // strength, radius (tile heights), mode, -
uniform int uNH, uWrap;
uniform float uAsp;
void main() {
  vec4 d = texture(uPrev, vUV) * uDecay;
  for (int i = 0; i < ${MAX_HANDS}; i++) {
    if (i >= uNH) break;
    vec4 pr = texelFetch(uProbe, ivec2(i, 0), 0);
    vec4 hd = uHand[i];
    if (pr.z < 0.5 || hd.x <= 0.0) continue;
    vec2 dv = (vUV - pr.xy) * vec2(uAsp, 1.0);
    if (uWrap == 1) dv -= vec2(uAsp, 1.0) * floor(dv / vec2(uAsp, 1.0) + 0.5);
    float r = hd.y;
    float g = exp(-dot(dv, dv) / (r * r));
    if (g < 0.004) continue;
    if (hd.z < 0.5) d.r = min(d.r, -0.55 * hd.x * g);
    else if (hd.z < 1.5) d.r = max(d.r, 0.55 * hd.x * g);
    else {
      float L = length(dv);
      vec2 dir = L > 1e-5 ? dv / L : vec2(0.0);
      d.gb += dir / vec2(uAsp, 1.0) * g * hd.x * r * uDt * 2.5;
      float cap = 0.6 * r;
      float n = length(d.gb * vec2(uAsp, 1.0));
      if (n > cap) d.gb *= cap / n;
    }
  }
  o = d;
}`

// The landscape.
const LAND_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUV;
out vec4 o;
${LAND_GLSL}
uniform vec3 uSun, uSunCol, uShadowCol, uHaze, uSkyCol, uLineCol, uWaterCol;
uniform float uSkyOp, uAmb, uShadows, uFog, uFar, uMix, uLines, uLineW, uWater, uMirror, uRipple, uRipPh;
uniform int uPal, uHasPic, uDebug;
uniform float uLineN;
uniform float uSlick, uSlickT;
${FILM_GLSL}
// the slick's own noise (on the land's coordinates, so it stays on the water as you fly)
// third-party: Hash without Sine
float skHash(vec2 p) { p = mod(p, 512.0); vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float skNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(skHash(i), skHash(i + vec2(1.0, 0.0)), f.x), mix(skHash(i + vec2(0.0, 1.0)), skHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float skFbm(vec2 p) { return 0.55 * skNoise(p) + 0.3 * skNoise(p * 2.1 + 7.3) + 0.15 * skNoise(p * 4.3 + 2.9); }
// how thick the oil is at this place of the water (G : field texels), 0 or less : none
float slickAt(vec2 G, float depth) {
  vec2 sp = G / uFieldRes.y;
  float sn = skFbm(sp * 3.2 + vec2(uSlickT * 0.7, -uSlickT * 0.45));
  // it gathers along the shores, and laps at them
  float shore = 1.0 - smoothstep(0.0, 0.07, depth);
  float lap = 0.5 + 0.5 * sin(depth * 160.0 - uRipPh * 1.4 + sn * 6.0);
  // (its coverage : 0.5 covers about half the water, 1 all of it)
  return sn - mix(0.86, 0.12, uSlick) + shore * (0.12 + 0.1 * lap) * uSlick;
}

vec3 sky(vec3 rd) {
  float up = clamp(rd.y, 0.0, 1.0);
  vec3 c = mix(uHaze, uSkyCol, pow(up, 0.55));
  float sd = max(dot(rd, uSun), 0.0);
  c += uSunCol * (0.35 * pow(sd, 18.0) + 0.9 * pow(sd, 900.0));
  return c;
}
vec3 fogCol(vec3 rd) { return uHaze + uSunCol * 0.22 * pow(max(dot(rd, uSun), 0.0), 6.0); }

// the ramp by height (h : the terraced height 0..1, sl : the slope 0 flat .. 1 a wall)
vec3 ramp(float h, float sl, float step01, out vec3 emit) {
  emit = vec3(0.0);
  vec3 c;
  if (uPal == 0) { // earth : green valleys, brown slopes, grey rock, a little snow
    c = mix(vec3(0.13, 0.22, 0.09), vec3(0.33, 0.38, 0.15), smoothstep(0.0, 0.3, h));
    c = mix(c, vec3(0.43, 0.33, 0.21), smoothstep(0.3, 0.6, h));
    c = mix(c, vec3(0.46, 0.44, 0.42), smoothstep(0.62, 0.86, h));
    c = mix(c, vec3(0.38, 0.31, 0.25), smoothstep(0.35, 0.75, sl) * 0.8);
    c = mix(c, vec3(0.92, 0.93, 0.95), smoothstep(0.88, 0.95, h) * (1.0 - smoothstep(0.35, 0.6, sl)));
  } else if (uPal == 1) { // snow peaks : dark rock below, snow wherever it can lie
    c = mix(vec3(0.1, 0.11, 0.13), vec3(0.3, 0.31, 0.34), smoothstep(0.0, 0.5, h));
    float snow = smoothstep(0.3, 0.55, h) * (1.0 - smoothstep(0.3, 0.55, sl));
    c = mix(c, vec3(0.94, 0.96, 1.0), snow);
  } else if (uPal == 2) { // topo map : the hypsometric tints of a survey map
    c = mix(vec3(0.2, 0.42, 0.26), vec3(0.56, 0.72, 0.43), smoothstep(0.0, 0.25, h));
    c = mix(c, vec3(0.93, 0.86, 0.56), smoothstep(0.25, 0.5, h));
    c = mix(c, vec3(0.8, 0.54, 0.3), smoothstep(0.5, 0.72, h));
    c = mix(c, vec3(0.55, 0.34, 0.22), smoothstep(0.72, 0.9, h));
    c = mix(c, vec3(0.96, 0.95, 0.93), smoothstep(0.92, 0.99, h));
  } else if (uPal == 3) { // night : navy valleys, slate slopes, pale moonlit tops
    c = mix(vec3(0.03, 0.04, 0.1), vec3(0.17, 0.19, 0.34), smoothstep(0.0, 0.5, h));
    c = mix(c, vec3(0.58, 0.6, 0.76), smoothstep(0.55, 1.0, h));
  } else if (uPal == 4) { // desert : ochre, sand, pale dust, the walls redder
    c = mix(vec3(0.5, 0.28, 0.15), vec3(0.85, 0.6, 0.36), smoothstep(0.0, 0.55, h));
    c = mix(c, vec3(0.96, 0.84, 0.64), smoothstep(0.6, 1.0, h));
    c = mix(c, vec3(0.62, 0.27, 0.15), smoothstep(0.45, 0.85, sl) * 0.7);
  } else if (uPal == 5) { // lava : black basalt, glowing in the low ground
    c = mix(vec3(0.05, 0.04, 0.04), vec3(0.2, 0.18, 0.17), smoothstep(0.1, 0.9, h));
    float glow = smoothstep(0.36, 0.04, h);
    emit = mix(vec3(0.9, 0.15, 0.02), vec3(1.0, 0.62, 0.18), glow) * glow * 2.2;
  } else { // paper : a model cut from card, one sheet a step, a shade apart
    float alt = mod(floor(step01 + 0.5), 2.0);
    c = mix(vec3(0.86, 0.84, 0.79), vec3(0.93, 0.91, 0.86), alt);
  }
  return c;
}

float shadowAt(vec3 p) {
  float res = 1.0;
  float t = uTexel * 2.0;
  for (int i = 0; i < 32; i++) {
    vec3 q = p + uSun * t;
    if (q.y > uTop) break;
    float lod = max(0.0, log2(t / uTexel) - 3.0);
    float d = q.y - hgt(toG(q.xz), lod);
    res = min(res, 9.0 * d / t);
    if (res < 0.0) break;
    t += max(uTexel * 1.5, t * 0.22);
  }
  return clamp(res, 0.0, 1.0);
}

// a quick look along a reflected ray : the land it meets, darkened, or the sky
vec3 reflectLook(vec3 p, vec3 r) {
  float t = uTexel * 4.0;
  for (int i = 0; i < 24; i++) {
    vec3 q = p + r * t;
    if (q.y > uTop) break;
    vec2 G = toG(q.xz);
    float lod = lodAt(t) + 1.0;
    if (q.y < hgt(G, lod)) {
      float m;
      vec2 uv = placeAt(G, m);
      vec3 em;
      float hh = rawAt(G, lod);
      vec3 alb = mix(textureLod(uField, uv, lod).rgb, ramp(terrace(hh, 1.0), 0.3, hh * uN, em), uHasPic == 1 ? uMix : 1.0);
      return alb * (uSunCol * 0.45 * max(uSun.y, 0.1) + uShadowCol * uAmb) + em;
    }
    t += max(uTexel * 3.0, t * 0.16);
  }
  return sky(r);
}

// the land's look at a point : lit, shadowed, lined, colored
// (fwL : how fast the contour count changes across a pixel, taken in main : a
// derivative inside a branch is undefined)
vec3 shadeLand(vec3 p, float lod, float fwL) {
  vec2 G = toG(p.xz);
  float m;
  vec2 uv = placeAt(G, m);
  float e = max(1.0, exp2(lod));
  float r = riserAt(lod);
  float hx = uHt * (terrace(rawSmooth(G + vec2(e, 0.0), lod), r) - terrace(rawSmooth(G - vec2(e, 0.0), lod), r));
  float hz = uHt * (terrace(rawSmooth(G + vec2(0.0, e), lod), r) - terrace(rawSmooth(G - vec2(0.0, e), lod), r));
  vec3 n = normalize(vec3(-hx, 2.0 * e * uTexel, hz));
  gN = n;
  float a = rawAt(G, lod);
  float th = terrace(a, r);
  float sl = 1.0 - n.y;
  vec3 em;
  vec3 pic = textureLod(uField, uv, lod).rgb;
  vec3 alb = ramp(th, sl, a * uN, em);
  alb = uHasPic == 1 ? mix(pic, alb, uMix) : alb;
  em *= uHasPic == 1 ? uMix : 1.0;
  // AO : the land below its own neighborhood's mean lies in a hollow (four taps of
  // a coarse mip, between its levels : one tap showed the mip's 8-texel boxes as
  // stripes down a steep wall)
  float ol = lod + 2.5;
  float oo = exp2(ol) * 0.7;
  float mean = 0.25 * (rawAt(G + vec2(oo, oo * 0.4), ol) + rawAt(G - vec2(oo, oo * 0.4), ol)
                     + rawAt(G + vec2(-oo * 0.4, oo), ol) + rawAt(G + vec2(oo * 0.4, -oo), ol));
  float ao = clamp(1.0 - (mean - a) * 2.5, 0.45, 1.0);
  float dif = max(dot(n, uSun), 0.0);
  float sh = dif > 0.0 && uShadows > 0.001 ? shadowAt(p + n * uTexel * 1.5) : 1.0;
  sh = mix(1.0, sh, uShadows);
  vec3 lit = uSunCol * dif * sh * 1.2 + uShadowCol * uAmb * (0.55 + 0.45 * n.y) * ao * 1.6;
  vec3 c = alb * lit + em;
  // the contour lines on the steps (every fifth one bolder)
  if (uLines > 0.001) {
    float y = a * uLineN;
    float fw = fwL;
    float d = min(fract(y), 1.0 - fract(y)) / max(fw, 1e-4);
    float idx = mod(floor(y + 0.5), 5.0) < 0.5 ? 1.7 : 1.0;
    float w = uLineW * idx;
    // (no line on flat ground : a plain lying exactly at a level is not a contour,
    // and the ground at 0 is no level at all)
    float ln = (1.0 - smoothstep(w * 0.5 - 0.5, w * 0.5 + 0.5, d)) * (1.0 - smoothstep(0.12, 0.35, fw))
             * smoothstep(0.0005, 0.004, fw) * step(0.5, y);
    c = mix(c, uLineCol * (0.6 + 0.4 * lit), ln * uLines);
  }
  return c;
}

void main() {
  vec3 ro, F, R, U;
  camera(ro, F, R, U);
  vec2 fc = gl_FragCoord.xy;
  vec2 s = uSquare == 1 ? fc / uRes - 0.5 : (fc - 0.5 * uRes) / uRes.y;
  vec3 rd = rayFor(s, F, R, U);
  float t = trace(ro, rd, uFar);
  float tq = t > 0.0 ? t : uFar;
  float fwL = fwidth(rawAt(toG((ro + rd * tq).xz), lodAt(tq)) * uLineN);
  float tw = uWater > 0.0005 && rd.y < 0.0 ? (uHt * uWater - ro.y) / rd.y : -1.0;
  if (tw > 0.0 && ro.y < uHt * uWater) tw = -1.0; // (an eye under the water sees no surface)
  vec3 c;
  float alpha = 1.0;
  float tt = t;
  if (t < 0.0 && tw < 0.0) {
    c = sky(rd);
    alpha = uSkyOp;
  } else {
    bool wet = tw > 0.0 && (t < 0.0 || tw < t);
    if (wet) {
      vec3 pw = ro + rd * tw;
      vec2 Gw = toG(pw.xz);
      float bed = hgt(Gw, lodAt(tw));
      float depth = max(uHt * uWater - bed, 0.0) / max(uHt, 1e-3);
      // the bottom, seen through the water
      vec3 under = t > 0.0 ? shadeLand(ro + rd * t, lodAt(t), fwL) : uWaterCol;
      float clear = exp(-depth * 9.0);
      vec3 wc = mix(uWaterCol * (0.4 + 0.6 * max(uSun.y, 0.0)), under * uWaterCol * 2.2, clear * 0.75);
      // the surface : ripples, the sky and the land in it, the sun's glint
      vec2 q = pw.xz * 70.0;
      vec2 gr = vec2(cos(q.x + uRipPh) + 0.6 * cos(q.x * 0.7 + q.y * 1.3 - uRipPh * 1.3), cos(q.y * 1.1 - uRipPh * 0.8) + 0.6 * cos(q.y * 0.6 - q.x * 1.2 + uRipPh * 1.1));
      vec3 nw = normalize(vec3(gr.x * 0.05 * uRipple, 1.0, gr.y * 0.05 * uRipple));
      vec3 rr = reflect(rd, nw);
      rr.y = abs(rr.y);
      float fr = 0.03 + 0.97 * pow(1.0 - max(dot(-rd, nw), 0.0), 5.0);
      vec3 refl = uMirror > 0.001 ? reflectLook(pw, rr) : sky(rr);
      c = mix(wc, refl, clamp(uMirror * (0.25 + 0.75 * fr), 0.0, 1.0));
      c += uSunCol * pow(max(dot(rr, uSun), 0.0), 220.0) * 2.0 * uMirror;
      // a thin line of foam where it meets the shore
      c = mix(c, vec3(0.85, 0.88, 0.9) * (0.5 + 0.5 * max(uSun.y, 0.0)), (1.0 - smoothstep(0.0, 0.012, depth)) * 0.5);
      // the oil slick : the rainbow at its thin edge, black and calm where it is thick
      if (uSlick > 0.0) {
        float th = slickAt(Gw, depth);
        float edgeS = smoothstep(0.0, 0.04, th);
        float thickS = smoothstep(0.07, 0.19, th);
        if (edgeS > 0.0) {
          // (marbled, so the orders run in streaks rather than rings round the patches)
          float marb = skNoise(Gw / uFieldRes.y * 22.0 + vec2(uSlickT * 1.3, 0.0));
          vec3 film = filmColor(100.0 + 6500.0 * max(th, 0.0) * (0.5 + marb), max(-rd.y, 0.1), 1.45);
          vec3 sheen = c * (0.45 + 0.9 * film) + film * film * 0.18;
          vec3 nO = normalize(mix(nw, vec3(0.0, 1.0, 0.0), 0.8));
          vec3 rO = reflect(rd, nO);
          rO.y = abs(rO.y);
          float frO = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, nO), 0.0), 5.0);
          vec3 oil = vec3(0.02, 0.014, 0.008) + mix(sky(rO), refl, uMirror) * frO * 0.7
                   + uSunCol * pow(max(dot(rO, uSun), 0.0), 600.0) * 2.5;
          oil *= mix(vec3(1.0), 0.5 + 1.0 * filmColor(500.0 + 300.0 * th, max(-rd.y, 0.1), 1.5), 0.25);
          c = mix(c, sheen, edgeS * (1.0 - thickS));
          c = mix(c, oil, thickS);
        }
      }
      tt = tw;
    } else {
      vec3 pl = ro + rd * t;
      c = shadeLand(pl, lodAt(t), fwL);
      // the slick's dark wet line on the beach, just above the water
      if (uSlick > 0.0 && uWater > 0.0005) {
        float above = (pl.y - uHt * uWater) / max(uHt, 1e-3);
        if (above < 0.03) {
          vec2 sp = toG(pl.xz) / uFieldRes.y;
          float sn = skFbm(sp * 3.2 + vec2(uSlickT * 0.7, -uSlickT * 0.45));
          float st = (1.0 - smoothstep(0.0, 0.006 + 0.014 * uSlick, above)) * smoothstep(0.3, 0.55, sn + uSlick * 0.45);
          c = mix(c, c * 0.15 + vec3(0.012, 0.01, 0.007), st * min(1.0, uSlick * 1.6));
        }
      }
    }
    // the haze toward the horizon, and the far edge of the field fading into the sky
    float f = 1.0 - exp(-tt * uFog * uFog * 1.4);
    float edge = smoothstep(uFar * 0.6, uFar, tt);
    c = mix(c, fogCol(rd), max(f, edge));
    alpha = mix(1.0, uSkyOp, edge);
  }
  if (uDebug == 2) { c = gN * 0.5 + 0.5; alpha = 1.0; }
  if (uDebug == 3) { c = vec3(fract(tt * 40.0)); alpha = 1.0; }
  if (uDebug == 4) { c = vec3(fract(rawAt(toG((ro + rd * tt).xz), 0.0) * 60.0)); alpha = 1.0; }
  if (uDebug == 1) { float k = float(gIt) / 200.0; c = vec3(k * 3.0, k * 3.0 - 1.0, k * 3.0 - 2.0); alpha = 1.0; }
  o = vec4(clamp(c, 0.0, 1.0), alpha);
}`

type V3 = [number, number, number]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)

interface Pyramid { tex: WebGLTexture; fbos: WebGLFramebuffer[] }

export class TerrainSource implements NativeGenerator {
  private g: EngineGL
  private heightP: Prog
  private soundP: Prog
  private snd: [Target, Target] | null = null
  private si = 0
  private sndAcc = 0
  private sndStrip = 0
  private audio: WebGLTexture | null = null
  private onset = new Onset()
  private sounding = false
  private blurP: Prog
  private fieldP: Prog
  private max0P: Prog
  private maxNP: Prog
  private probeP: Prog
  private defP: Prog
  private landP: Prog
  private hgt: [Target, Target] | null = null
  private hi = 0
  private tmp: Target | null = null
  private fieldTex: WebGLTexture | null = null
  private fieldFbo: WebGLFramebuffer | null = null
  private pyr: Pyramid | null = null
  private def: [Target, Target] | null = null
  private di = 0
  private probe: [Target, Target] | null = null
  private pi = 0
  private fw = 0
  private fh = 0
  private clock = new SlotClock()
  private inputs: Record<string, number | number[]> = {}
  private side: WebGLTexture | null = null
  private blankTex: WebGLTexture | null = null
  private first = true
  private probeFresh = true
  private spinA = 0
  private swayA = Math.random() * TAU
  private swayB = Math.random() * TAU
  private evoPh = Math.random() * 50
  private ripPh = 0
  private slickNow = 0
  private slickT = Math.random() * 100
  // the flight, in field texels (wrapped by the field's own period)
  private offX = 0
  private offY = 0
  private touch = new TouchPoints()
  private restore = new Edge()
  private lastMark = -1e9
  private now = 0
  private depthRead: PictureDepthReader
  private mode = 0
  /** test hooks : 1 paints the march's steps; the finest cell's bias */
  debug = 0
  leafBias = 0
  /** the land stands on the depth model's map (a test hook reads it) */
  haveMap = false

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    gl.getExtension('EXT_color_buffer_float')
    const g = (this.g = new EngineGL(gl, 'terrain'))
    this.heightP = g.prog(HEIGHT_FS)
    this.soundP = g.prog(SOUND_FS)
    this.blurP = g.prog(BLUR_FS)
    this.fieldP = g.prog(FIELD_FS)
    this.max0P = g.prog(MAX0_FS)
    this.maxNP = g.prog(MAXN_FS)
    this.probeP = g.prog(PROBE_FS)
    this.defP = g.prog(DEF_FS)
    this.landP = g.prog(LAND_FS)
    this.depthRead = new PictureDepthReader(gl)
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
    if (this.restore.fired(num(inputs, 'restore', 0))) this.clearMarks()
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
    if (name === 'restore' && typeof value === 'number' && this.restore.fired(value)) this.clearMarks()
  }

  feed(audio: WebGLTexture | null, side: WebGLTexture | null): void {
    this.side = side
    this.audio = audio
  }

  pointer(ev: SourcePointer): void {
    this.touch.pointer(ev)
  }

  pointerHint(): string {
    const m = Math.round(clamp(num(this.inputs, 'hand', 0), 0, 2))
    return m === 1 ? 'drag : raise the land' : m === 2 ? 'drag : spread the land' : 'drag : press the land'
  }

  status(): string {
    return this.sounding ? 'raised by the sound' : this.mode === 0 ? 'its own land' : this.mode === 3 ? 'raised by the depth map' : this.mode === 2 ? 'raised by darkness' : 'raised by brightness'
  }

  event(name: string): void {
    if (name === 'restore' || name === 'heal') this.clearMarks()
  }

  private clearMarks(): void {
    const gl = this.g.gl
    if (!this.def) return
    for (const t of this.def) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.lastMark = -1e9
  }

  private blank(): WebGLTexture {
    if (this.blankTex) return this.blankTex
    const gl = this.g.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.blankTex = t
    return t
  }

  private freeField(): void {
    const g = this.g, gl = g.gl
    if (this.hgt) for (const t of this.hgt) g.freeTarget(t)
    this.hgt = null
    g.freeTarget(this.tmp)
    this.tmp = null
    if (this.def) for (const t of this.def) g.freeTarget(t)
    this.def = null
    if (this.fieldFbo) gl.deleteFramebuffer(this.fieldFbo)
    if (this.fieldTex) gl.deleteTexture(this.fieldTex)
    this.fieldFbo = null
    this.fieldTex = null
    if (this.pyr) {
      for (const f of this.pyr.fbos) gl.deleteFramebuffer(f)
      gl.deleteTexture(this.pyr.tex)
    }
    this.pyr = null
  }

  private ensure(asp: number): void {
    const g = this.g, gl = g.gl
    const step = 1 << LMAX
    const fw = asp >= 1 ? FIELD_LONG : Math.max(step * 2, Math.round((FIELD_LONG * asp) / step) * step)
    const fh = asp >= 1 ? Math.max(step * 2, Math.round(FIELD_LONG / asp / step) * step) : FIELD_LONG
    if (!this.probe) {
      this.probe = [g.target(PROBE_W, 1), g.target(PROBE_W, 1)]
      this.probeFresh = true
    }
    if (this.hgt && fw === this.fw && fh === this.fh) return
    this.freeField()
    this.fw = fw
    this.fh = fh
    this.hgt = [g.target(fw, fh, { half: 'r', linear: true }), g.target(fw, fh, { half: 'r', linear: true })]
    this.tmp = g.target(fw, fh, { half: 'r', linear: true })
    this.def = [g.target(fw / 2, fh / 2, { half: 'rgba', linear: true }), g.target(fw / 2, fh / 2, { half: 'rgba', linear: true })]
    // the field : color + height, with its mips (the far land reads them)
    const levels = Math.floor(Math.log2(Math.max(fw, fh))) + 1
    const ft = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, ft)
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA16F, fw, fh)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    const ff = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, ff)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ft, 0)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.fieldTex = ft
    this.fieldFbo = ff
    // the max pyramid, one framebuffer a level
    const pt = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, pt)
    gl.texStorage2D(gl.TEXTURE_2D, LMAX + 1, gl.R16F, fw, fh)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbos: WebGLFramebuffer[] = []
    for (let l = 0; l <= LMAX; l++) {
      const f = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, f)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pt, l)
      fbos.push(f)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.pyr = { tex: pt, fbos }
    this.first = true
    this.probeFresh = true
  }

  /** The land's uniforms, shared by the probe and the landscape. */
  private landUniforms(p: Prog, L: LandView): void {
    p.f2('uFieldRes', this.fw, this.fh).f1('uTexel', 1 / this.fh).f1('uHt', L.ht)
      .f1('uN', L.n).f1('uR', L.r).i1('uEdge', L.edge).f2('uOff', this.offX, this.offY)
      .f1('uPix', L.pix).f1('uTop', L.ht * 1.25 + 1e-3)
      // (a larger picture marches the same cells a 1080p one does, each a little
      // smaller on the screen : 4096 dome 2048² 9.7 -> about 5 ms)
      .f1('uLeaf', Math.max(0, Math.log2(this.h / 1080)) * 0.75 + this.leafBias)
      .f3('uEye', ...L.eye).f3('uTgt', ...L.tgt).f1('uFocal', L.focal).f1('uClear', L.clear)
      .f2('uRes', this.w, this.h).i1('uSquare', L.square ? 1 : 0)
      .i1('uField', 0).i1('uMax', 1).i1('uProbe', 2)
  }

  private setWrap(tex: WebGLTexture, mode: number, mips: boolean): void {
    const gl = this.g.gl
    const wr = mode === 0 ? gl.MIRRORED_REPEAT : mode === 1 ? gl.REPEAT : gl.CLAMP_TO_EDGE
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr)
    if (mips) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  render(targetFbo: WebGLFramebuffer, clockSec: number): void {
    const g = this.g
    const gl = g.gl
    if (!g.ok) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return
    }
    const I = this.inputs
    const dt = this.clock.tick(clockSec)
    this.now += dt
    const fill = domeFill() > 0
    const asp = this.w / Math.max(1, this.h)
    const viewAsp = fill ? 1 : asp
    this.ensure(asp)
    const fw = this.fw, fh = this.fh
    const tileAsp = fw / fh
    const edge = Math.round(clamp(num(I, 'edges', 0), 0, 2))

    // ── the clocks ──
    this.spinA = (this.spinA + num(I, 'spin', 0) * 0.35 * dt) % TAU
    const swayRate = clamp(num(I, 'swayRate', 0.3), 0, 2)
    this.swayA = (this.swayA + swayRate * 0.7 * dt) % TAU
    this.swayB = (this.swayB + swayRate * 0.43 * dt) % TAU
    this.evoPh = (this.evoPh + clamp(num(I, 'evolve', 0.1), 0, 1) * 0.08 * dt) % 4096
    this.ripPh = (this.ripPh + dt * 1.6) % (TAU * 100)
    // the slick spreads toward its coverage at its own pace, and drifts with the water
    const slickTo = clamp(num(I, 'slick', 0), 0, 1)
    const slickSp = clamp(num(I, 'slickSpread', 0.3), 0, 1)
    this.slickNow += (slickTo - this.slickNow) * (1 - Math.exp(-dt * (0.03 + 0.6 * slickSp * slickSp)))
    this.slickT = (this.slickT + dt * (0.008 + 0.05 * slickSp)) % 1000

    // ── the camera ──
    const ht = clamp(num(I, 'height', 0.5), 0, 1) * 0.6
    const sway = clamp(num(I, 'sway', 0.3), 0, 1)
    const yaw = num(I, 'turn', 0) * Math.PI + this.spinA + sway * 0.22 * Math.sin(this.swayA)
    const pitch = clamp(0.035 + clamp(num(I, 'tilt', 0.25), 0, 1) * 1.52 + sway * 0.05 * Math.sin(this.swayB), 0.02, 1.56)
    const lens = clamp(num(I, 'lens', 0.5), 0, 1)
    const focal = 0.5 * Math.pow(6, 1 - lens)
    const D = clamp(num(I, 'distance', 1.2), 0.3, 3)
    const lift = clamp(num(I, 'camHeight', 0.15), 0, 1) * 0.6 + sway * 0.01 * Math.sin(this.swayA * 1.7)
    const tgt: V3 = [0, ht * 0.35 + lift, 0]
    const eye: V3 = [tgt[0] + D * Math.sin(yaw) * Math.cos(pitch), tgt[1] + D * Math.sin(pitch), tgt[2] + D * Math.cos(yaw) * Math.cos(pitch)]
    // FLY : the land moves under the camera along its heading, the offset wrapped
    // by the field's period (mirrored : two tiles; repeated : one; islands : three)
    const fly = clamp(num(I, 'fly', 0), -1, 1)
    if (Math.abs(fly) > 1e-4) {
      const sp = (fly * 0.35 * dt) * fh // texels
      this.offX += -Math.sin(yaw) * sp
      this.offY += Math.cos(yaw) * sp
    }
    const per = edge === 0 ? 2 : edge === 1 ? 1 : 3
    const px = fw * per, py = fh * per
    this.offX = ((this.offX % px) + px) % px
    this.offY = ((this.offY % py) + py) % py

    // (a count between two whole ones moves every step a little : modulated, the
    // levels slide instead of jumping)
    const n = clamp(num(I, 'terraces', 12), 0, 40)
    const sharp = clamp(num(I, 'sharp', 0.8), 0, 1)
    const L: LandView = {
      ht: Math.max(ht, 1e-4),
      n,
      r: 1 - 0.96 * sharp,
      edge,
      pix: 1 / (focal * this.h),
      eye,
      tgt,
      focal,
      clear: Math.max(ht, 0.01) * 0.12 + 0.015,
      square: fill
    }

    // ── the hands : each one's place on the screen (frame heights from the center) ──
    const pts = this.touch.step(dt, 0.65, false, viewAsp, { people: clamp(num(I, 'people', 0), 0, 1), point: undefined, press: false })
    const handS = new Float32Array(MAX_HANDS * 2)
    const handU = new Float32Array(MAX_HANDS * 4)
    const amt = clamp(num(I, 'handAmount', 0.6), 0, 1)
    const hsize = clamp(num(I, 'handSize', 0.12), 0.02, 0.6)
    const hmode = Math.round(clamp(num(I, 'hand', 0), 0, 2))
    let nh = 0
    for (const p of pts) {
      if (nh >= MAX_HANDS) break
      handS.set([p.x, p.y], nh * 2)
      handU.set([clamp(p.w, 0, 1) * amt, hsize, hmode, 0], nh * 4)
      nh++
    }
    if (nh > 0 && amt > 0) this.lastMark = this.now

    const heal = clamp(num(I, 'heal', 6), 0.2, 60)
    const P = this.probe!
    const H = this.hgt!
    const DF = this.def!
    this.setWrap(this.fieldTex!, edge, true)
    this.setWrap(this.pyr!.tex, edge, false)

    // ── 1. the probe : the hands on the land, the ground under the camera (on last
    // frame's field : it lags a frame, nothing sees it) ──
    {
      const p = this.probeP.use()
      this.landUniforms(p, L)
      p.i1('uNH', nh).f1('uUp', 1 - Math.exp(-dt / 0.12)).f1('uDown', 1 - Math.exp(-dt / 1.2)).i1('uFresh', this.probeFresh ? 1 : 0)
      gl.uniform2fv(p.u('uHandS'), handS)
      g.bind(0, this.fieldTex)
      g.bind(1, this.pyr!.tex)
      g.bind(2, P[this.pi].tex)
      g.draw(P[1 - this.pi].fbo, PROBE_W, 1)
      this.pi = 1 - this.pi
      this.probeFresh = this.first
    }

    // ── 2. the hand's marks, healing (skipped once healed : nothing left to fade) ──
    const marksLive = this.now - this.lastMark < heal * 8 + 1
    if (marksLive) {
      const p = this.defP.use()
        .i1('uPrev', 0).i1('uProbe', 1)
        .f1('uDecay', Math.exp(-dt / heal)).f1('uDt', dt)
        .i1('uNH', nh).i1('uWrap', edge === 1 ? 1 : 0).f1('uAsp', tileAsp)
      gl.uniform4fv(p.u('uHand'), handU)
      g.bind(0, DF[this.di].tex)
      g.bind(1, P[this.pi].tex)
      g.draw(DF[1 - this.di].fbo, fw / 2, fh / 2)
      this.di = 1 - this.di
    } else if (this.lastMark > -1e8) this.clearMarks()
    const defTex = DF[this.di].tex

    // ── 3. the height : its own land, the picture's brightness, darkness or depth ──
    const raise = Math.round(clamp(num(I, 'raise', 1), 0, 3))
    // the sound as land : its history stands in for the picture
    this.sounding = raise === 3
    const landPic = this.sounding ? this.soundLand(dt) : this.side
    const wantModel = raise === 0 && !!this.side && pictureDepth.wanted()
    const map = wantModel ? this.depthRead.step(this.side!, asp, dt) : null
    if (!wantModel) this.depthRead.stop()
    this.haveMap = !!map
    const mode = !landPic ? 0 : map ? 3 : raise === 2 ? 2 : 1
    if (mode !== this.mode) this.first = this.first || (mode === 0) !== (this.mode === 0)
    this.mode = mode
    const settle = clamp(num(I, 'settle', 0.3), 0, 2)
    // (the sound's land is laid once and only travels : settling it would smear it along its way)
    const k = this.first || this.sounding || settle < 0.01 ? 1 : 1 - Math.exp(-dt / settle)
    for (const t of [H[0].tex, H[1].tex, this.tmp!.tex]) this.setWrap(t, edge === 1 ? 1 : 2, false)
    // (the land glides between its strips : moved a whole strip at a time it stepped)
    this.heightP.use().f1('uSlide', this.sounding && landPic ? this.sndAcc / 256 : 0)
      .i1('uPrev', 0).i1('uSide', 1).i1('uMap', 2).i1('uDef', 3)
      .i1('uMode', mode).f1('uK', k)
      .f2('uCell', 1 / fw, 1 / fh)
      .i1('uOwn', Math.round(clamp(num(I, 'own', 1), 0, 4)))
      .f1('uScale', clamp(num(I, 'scale', 1), 0.3, 3)).f1('uEvo', this.evoPh).f1('uAsp', tileAsp)
    g.bind(0, H[this.hi].tex)
    g.bind(1, landPic ?? this.blank())
    g.bind(2, map ?? this.blank())
    g.bind(3, defTex)
    g.draw(H[1 - this.hi].fbo, fw, fh)
    this.hi = 1 - this.hi
    this.first = false

    // ── 4. SMOOTH : a gaussian, then the field (color + height + the marks) ──
    const smooth = clamp(num(I, 'smooth', 0.3), 0, 1)
    const sigma = smooth * smooth * 96 // texels (a silhouette needs a wide blur to become hills)
    let hTex = H[this.hi].tex
    if (sigma > 0.35) {
      const sp = Math.max(1, sigma / 4)
      const sig = sigma / sp
      this.blurP.use().i1('uSrc', 0).f2('uDir', sp / fw, 0).f1('uSig', sig)
      g.bind(0, hTex)
      g.draw(this.tmp!.fbo, fw, fh)
      this.blurP.use().f2('uDir', 0, sp / fh)
      g.bind(0, this.tmp!.tex)
      g.draw(H[1 - this.hi].fbo, fw, fh)
      // (the glide reads the UNSMOOTHED height next frame : the blur lands in the
      // other buffer, which the next frame's height pass overwrites)
      hTex = H[1 - this.hi].tex
    }
    this.fieldP.use().i1('uH', 0).i1('uSide', 1).i1('uDef', 2).i1('uHasSide', this.side ? 1 : 0)
      .f1('uPeaks', clamp(num(I, 'peaks', 0), 0, 1)).f1('uRock', clamp(num(I, 'rough', 0), 0, 1))
      .f1('uScale', 1).f1('uEvo', this.evoPh).f1('uAsp', tileAsp).i1('uOwn', 0)
    g.bind(0, hTex)
    g.bind(1, this.side ?? this.blank())
    g.bind(2, defTex)
    g.draw(this.fieldFbo, fw, fh)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    g.bind(0, this.fieldTex)
    gl.generateMipmap(gl.TEXTURE_2D)

    // ── 5. the max pyramid ──
    const pyr = this.pyr!
    this.max0P.use().i1('uField', 0).f2('uFieldRes', fw, fh).i1('uWrapX', edge === 1 ? 1 : 0)
    g.bind(0, this.fieldTex)
    g.draw(pyr.fbos[0], fw, fh)
    this.maxNP.use().i1('uSrc', 0)
    g.bind(0, pyr.tex)
    for (let l = 1; l <= LMAX; l++) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, l - 1)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, l - 1)
      g.draw(pyr.fbos[l], fw >> l, fh >> l)
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, LMAX)

    this.landPass(targetFbo, I, L, n, P)
  }

  private landPass(targetFbo: WebGLFramebuffer, I: Record<string, number | number[]>, L: LandView, n: number, P: [Target, Target]): void {
    const g = this.g, gl = g.gl
    const pyr = this.pyr!
    // ── 6. the landscape ──
    const sunA = num(I, 'sunAngle', 2.36)
    const sunE = 0.02 + clamp(num(I, 'sunHeight', 0.3), 0, 1) * 1.5
    const sun: V3 = norm([Math.cos(sunA) * Math.cos(sunE), Math.sin(sunE), -Math.sin(sunA) * Math.cos(sunE)])
    const fog = clamp(num(I, 'fog', 0.35), 0, 1)
    const p = this.landP.use()
    this.landUniforms(p, L)
    p.f3('uSun', ...sun)
      .f3('uSunCol', ...col(I, 'sunColor', [1, 0.93, 0.8]))
      .f3('uShadowCol', ...col(I, 'shadowColor', [0.32, 0.38, 0.55]))
      .f3('uHaze', ...col(I, 'haze', [0.74, 0.78, 0.84]))
      .f3('uSkyCol', ...col(I, 'sky', [0.32, 0.45, 0.66]))
      .f3('uLineCol', ...col(I, 'lineColor', [0.24, 0.15, 0.09]))
      .f3('uWaterCol', ...col(I, 'waterColor', [0.06, 0.18, 0.22]))
      .f1('uSkyOp', clamp(num(I, 'skyOp', 1), 0, 1))
      .f1('uAmb', clamp(num(I, 'ambient', 0.3), 0, 1))
      .f1('uShadows', clamp(num(I, 'shadows', 0.8), 0, 1))
      .f1('uFog', fog)
      .f1('uFar', 14)
      .f1('uMix', clamp(num(I, 'colorMix', 0.5), 0, 1))
      .f1('uLines', clamp(num(I, 'contours', 0.5), 0, 1))
      .f1('uLineW', clamp(num(I, 'lineWidth', 1.2), 0.5, 4) * Math.max(1, this.h / 1080)) // (as thick at 4K and on the dome)
      .f1('uLineN', n > 0 ? n : 10)
      .f1('uWater', clamp(num(I, 'water', 0), 0, 1))
      .f1('uMirror', clamp(num(I, 'mirror', 0.6), 0, 1))
      .f1('uRipple', clamp(num(I, 'ripple', 0.3), 0, 1))
      .f1('uRipPh', this.ripPh)
      .f1('uSlick', this.slickNow > 0.002 ? this.slickNow : 0).f1('uSlickT', this.slickT)
      .i1('uPal', Math.round(clamp(num(I, 'palette', 0), 0, 6)))
      .i1('uHasPic', this.side ? 1 : 0)
      .i1('uDebug', this.debug)
    g.bind(0, this.fieldTex)
    g.bind(1, pyr.tex)
    g.bind(2, P[this.pi].tex)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
    g.draw(targetFbo, this.w, this.h)
    g.done(4)
  }

  /** THE SOUND AS LAND : the spectrum's history, moved on by SOUND SPEED and the hits'
   *  SURGE; null without the audio texture (the land of its own stands in). */
  private soundLand(dt: number): WebGLTexture | null {
    const g = this.g
    if (!this.audio) return null
    // (the first time, the whole field is laid : the quiet ground out to the horizon)
    const start = !this.snd
    if (!this.snd) this.snd = [g.target(256, 256, { float: false, linear: true }), g.target(256, 256, { float: false, linear: true })]
    const I = this.inputs
    // 6 to 120 strips a second; a hit throws the land forward by up to 32 strips
    this.sndAcc += dt * (6 + 114 * clamp(num(I, 'soundSpeed', 0.3), 0, 1))
    const hit = this.onset.hit()
    if (hit > 0) this.sndAcc += 32 * clamp(num(I, 'surge', 0.4), 0, 1) * Math.min(hit, 1.2)
    const whole = Math.floor(this.sndAcc)
    const shift = start ? 256 : Math.min(256, whole)
    this.sndAcc -= whole
    this.sndStrip = (this.sndStrip + whole) % 4096
    this.soundP.use().i1('uPrev', 0).i1('uAudio', 1).f1('uShift', shift).f1('uStrip', this.sndStrip + 4096)
      .f1('uGain', start ? 0 : clamp(num(I, 'soundGain', 1.5), 0, 4))
    g.bind(0, this.snd[this.si].tex)
    g.bind(1, this.audio)
    g.draw(this.snd[1 - this.si].fbo, 256, 256)
    this.si = 1 - this.si
    return this.snd[this.si].tex
  }

  dispose(): void {
    const g = this.g, gl = g.gl
    if (this.snd) for (const t of this.snd) g.freeTarget(t)
    this.snd = null
    this.depthRead.dispose()
    this.freeField()
    if (this.probe) for (const t of this.probe) g.freeTarget(t)
    this.probe = null
    if (this.blankTex) gl.deleteTexture(this.blankTex)
    this.blankTex = null
    g.dispose()
  }
}

interface LandView {
  ht: number
  n: number
  r: number
  edge: number
  pix: number
  eye: V3
  tgt: V3
  focal: number
  clear: number
  square: boolean
}
