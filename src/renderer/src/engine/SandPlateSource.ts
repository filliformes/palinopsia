// SandPlateSource : the native Sand Plate generator (id 'gen-sandplate'). Sand on
// a vibrating plate (the figures a violin bow draws on it) : a grain bounces
// where the plate moves and rests where it doesn't, so the sand gathers on the
// plate's still lines.
//
// The plate : a sum of its modes in a half-float field (their value and slope),
// rebuilt only when the figure changes. Square modes cos(m pi x) cos(n pi y) +- the
// same with m and n swapped, which ring at about m^2 + n^2; round modes J_n(k r)
// cos(n t) with k from n diameters and s circles, which ring at (n + 2s)^2 (the law
// he measured). Several modes at once and a slow warp of the plate break the
// textbook symmetry : a real plate is never perfect, which is what makes its lines
// loop and wander.
//
// The grains : a float texture of up to a million, stepped by a fragment shader.
// The physics is one line, static friction : a grain moves only while the plate's
// acceleration beats its own grip, |phi| * drive > mu. So grains stop in a band
// around each still line, its width mu / |grad phi|, which is why the real lines
// are thin where the plate is steep and pile up where it is flat, at the crossings.
// A few grains grip too hard to ever move : the strays between the lines. A louder
// plate narrows the lines, and a silent one lets everything rest : the picture stops.
//
// The picture : every grain a point added into a half-float target, its mips giving
// the piles a soft shape and the plate a contact shadow, over one of seven surfaces
// that also change how the sand behaves (it slides on glass, snags on felt).
//
// The plate can turn : the figure and the resting sand go round with it, a grain in
// the air slips behind, and the faster it spins the more sand it throws outward
// (what leaves the plate comes back as fresh sand).

import { EngineGL, FS_HEAD, SlotClock, Edge, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator, SourcePointer } from './nativeGenerators'
import { audioBus } from './audioIn'
import { domeFill } from './domeSignal'
import { tempoBpm } from './tempoSignal'

// Up to a million grains in the frame, and as many again past its edges once a
// rectangular plate turns (their sand comes round into the frame) : 1448^2 slots.
const GRAIN_W = 1448
const MAX_TONES = 5
const MAX_PRESS = 3 // the mouse and two hands
const STEP = 1 / 60

// Each surface's grip on the sand : how wide a line it leaves, how far a grain
// hops, how many stay stranded.
const SURFACES: Array<{ grip: number; hop: number; stray: number }> = [
  { grip: 1, hop: 1, stray: 0 }, // black steel
  { grip: 0.9, hop: 1.1, stray: 0 }, // spun metal
  { grip: 1.5, hop: 0.8, stray: 0.03 }, // rust
  { grip: 1.3, hop: 0.9, stray: 0.015 }, // slate
  { grip: 0.55, hop: 1.35, stray: 0 }, // glass
  { grip: 1.2, hop: 0.85, stray: 0.01 }, // paper
  { grip: 2, hop: 0.6, stray: 0.05 } // felt
]

// ── The Bessel table for the round plate : J_n(x), n 0..19, x 0..64 ─────────
const BESSEL_N = 20
const BESSEL_X = 64
const BESSEL_W = 512
let besselData: Float32Array | null = null
function besselTable(): Float32Array {
  if (besselData) return besselData
  // J_n(x) = 1/pi * integral 0..pi of cos(n t - x sin t) dt, trapezoid (it converges
  // fast on a periodic integrand once the samples outrun x + n)
  const S = 112
  const d = new Float32Array(BESSEL_W * BESSEL_N)
  for (let n = 0; n < BESSEL_N; n++) {
    for (let i = 0; i < BESSEL_W; i++) {
      const x = (i / (BESSEL_W - 1)) * BESSEL_X
      let s = 0.5 * (1 + Math.cos(n * Math.PI))
      for (let k = 1; k < S; k++) {
        const t = (k / S) * Math.PI
        s += Math.cos(n * t - x * Math.sin(t))
      }
      d[n * BESSEL_W + i] = s / S
    }
  }
  besselData = d
  return d
}

// ── The plate's field : phi, its slope, how hard this part of the plate shakes ──
const FIELD_FS = `${FS_HEAD}
uniform vec4 uA[${MAX_TONES}], uB[${MAX_TONES}];
uniform int uNA, uNB;
uniform float uSpan, uMix, uWarp, uWarpT, uSeed, uUneven, uRound;
uniform sampler2D uJ;
out vec4 o;
const float PI = 3.14159265;
float jn(float n, float x) { return textureLod(uJ, vec2(min(x, ${BESSEL_X}.0) / ${BESSEL_X}.0, (n + 0.5) / ${BESSEL_N}.0), 0.0).r; }
float square(vec4 m, vec2 q) {
  return cos(m.x * PI * q.x) * cos(m.y * PI * q.y) + m.w * cos(m.y * PI * q.x) * cos(m.x * PI * q.y);
}
float round_(vec4 m, vec2 q) {
  float r = length(q), x = m.y * r;
  // (a real plate's rim moves as much as its middle : J_n alone dies away outward)
  return jn(m.x, x) * cos(m.x * atan(q.y, q.x) + m.w) * sqrt(1.0 + 0.6 * x) * 1.3;
}
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  vec2 P = (uv - 0.5) * uSpan;
  // the plate's imperfection : the figure's own coordinates, gently warped
  vec2 w = vec2(og_fbm(P * 2.1 + vec2(uSeed, uWarpT), 3.0), og_fbm(P * 2.1 + vec2(uSeed + 37.0, uWarpT + 11.0), 3.0)) - 0.5;
  vec2 q = P + uWarp * 0.42 * w;
  float a = 0.0, b = 0.0;
  if (uRound > 0.5) {
    for (int i = 0; i < uNA; i++) a += uA[i].z * round_(uA[i], q);
    for (int i = 0; i < uNB; i++) b += uB[i].z * round_(uB[i], q);
  } else {
    for (int i = 0; i < uNA; i++) a += uA[i].z * square(uA[i], q);
    for (int i = 0; i < uNB; i++) b += uB[i].z * square(uB[i], q);
  }
  float phi = mix(a, b, uMix);
  // an uneven plate : where it shakes less the grains stop further out, and the
  // lines run thick and blurred (the piled-up side of a real photograph)
  float env = 1.0 - uUneven * smoothstep(0.3, 0.72, og_fbm(P * 1.25 + vec2(uSeed * 0.7, 3.0), 2.0));
  o = vec4(phi, dFdx(phi) * RENDERSIZE.x / uSpan, dFdy(phi) * RENDERSIZE.y / uSpan, env);
}`

// ── The grains : xy on the plate (frame heights, 0 the middle), z the grip draw, w a
// second draw (who is a stray, how bright, how big) ─────────────────────────
const SEED_FS = `${FS_HEAD}
uniform vec2 uPlate;
uniform float uSalt, uRound, uDisc, uBase;
out vec4 o;
void main() {
  vec2 c = gl_FragCoord.xy;
  vec2 h = og_hash2(c * 0.917 + uSalt);
  vec2 g = og_hash2(c.yx * 1.31 + uSalt * 0.7);
  vec2 p = (h - 0.5) * uPlate;
  if (uRound > 0.5) { float a = h.x * 6.2831853; p = 0.5 * sqrt(h.y) * vec2(cos(a), sin(a)); }
  else if (uDisc > 0.0 && floor(c.y) * ${GRAIN_W}.0 + floor(c.x) >= uBase) {
    // the sand lying past the frame's edges, on the rest of the turning plate
    float a = h.x * 6.2831853;
    p = uDisc * sqrt(h.y) * vec2(cos(a), sin(a));
    float t = max(abs(p.x) / (uPlate.x * 0.5), abs(p.y) / (uPlate.y * 0.5));
    if (t < 1.0) {
      vec2 dir = vec2(cos(a), sin(a));
      float edge = 1.0 / max(abs(dir.x) / (uPlate.x * 0.5), abs(dir.y) / (uPlate.y * 0.5));
      p = dir * mix(edge, max(edge, uDisc), g.x);
    }
  }
  o = vec4(p, g.x, g.y);
}`

const STEP_FS = `${FS_HEAD}
uniform sampler2D uG, uF, uSand;
uniform vec2 uPlate, uTilt;
uniform float uDrive, uGrip, uHop, uSettle, uStray, uSalt, uPour, uRound, uRadial, uCap, uLod, uPileD;
uniform float uSpan, uTheta, uCarry, uOm2, uDisc, uSlide;
uniform float uFill;
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
vec2 toDisc(vec2 s) { return vec2(s.x * sqrt(1.0 - 0.5 * s.y * s.y), s.y * sqrt(1.0 - 0.5 * s.x * s.x)); }
vec2 toSquare(vec2 d) {
  float u2 = d.x * d.x, v2 = d.y * d.y, t = 2.8284271;
  return vec2(0.5 * sqrt(max(0.0, 2.0 + u2 - v2 + t * d.x)) - 0.5 * sqrt(max(0.0, 2.0 + u2 - v2 - t * d.x)),
              0.5 * sqrt(max(0.0, 2.0 - u2 + v2 + t * d.y)) - 0.5 * sqrt(max(0.0, 2.0 - u2 + v2 - t * d.y)));
}
vec2 turn(vec2 p, float a) {
  if (uFill < 0.5) return rot2(p, a);
  return clamp(toSquare(rot2(toDisc(clamp(p * 2.0, -1.0, 1.0)), a)), -1.0, 1.0) * 0.5;
}

uniform vec4 uPress[${MAX_PRESS}], uDrag[${MAX_PRESS}];
out vec4 o;
void main() {
  vec2 c = gl_FragCoord.xy;
  vec4 g = texelFetch(uG, ivec2(c), 0);
  vec2 p = g.xy;
  // where this grain lies on the turning plate
  vec4 f = texture(uF, turn(p, -uTheta) / uSpan + 0.5);
  // (sand out of sight, on a turning plate, always finds its lines : what comes round
  // into the frame lies as it should, even on a plate that has stopped shaking)
  float outside = uDisc > 0.0 && max(abs(p.x) / uPlate.x, abs(p.y) / uPlate.y) > 0.5 ? 1.0 : 0.0;
  float a = abs(f.r) * f.a * max(uDrive, outside * 1.1);
  // static friction : the plate must beat this grain's grip to move it. Most grip
  // lightly (the line's core), fewer harder (its soft edge); a few never let go.
  float mu = g.w < uStray ? 99.0 : (0.012 + 1.1 * g.z * g.z * g.z) * uGrip;
  if (a > mu) {
    float s = min((a - mu) * uHop, 0.022);
    vec2 h = og_hash2(c * 0.731 + uSalt);
    float an = h.x * 6.2831853;
    vec2 r = vec2(cos(an), sin(an)) * sqrt(h.y);
    float slope = length(f.gb);
    vec2 toward = slope > 1e-4 ? -sign(f.r) * rot2(f.gb, uTheta) / slope : vec2(0.0);
    // the tilt : under full-dome fill "down" is out from the zenith
    vec2 tilt = uRadial > 0.5 ? normalize(p + 1e-5) * length(uTilt) : uTilt;
    p += s * (mix(r, toward, uSettle) + tilt);
  }
  // the plate turning : what rests on it goes round with it, a grain in the air
  // slips behind; spun fast, the pull outward beats the grip and the sand slides off
  if (uCarry != 0.0) p = turn(p, a > mu ? uCarry * 0.35 : uCarry);
  if (uOm2 > 0.0 && mu < 90.0) {
    float rr = length(p), pull = uOm2 * rr * 0.25;
    if (pull > mu) p += p / max(rr, 1e-4) * min((pull - mu) * uHop * 0.6, 0.01);
  }
  // a heap has an angle of repose : where more sand has gathered than can stand,
  // it slides off downhill, away from the crowd and along the line. This is what
  // makes the lines solid, even and thick where a lot of sand reached them.
  if (g.w >= uStray && uSlide > 0.0) {
    // (read a little off the grain, a new way each step : read at the grain itself
    // the sand settles into the coarse read's own grid, in stripes)
    vec2 jr = og_hash2(c * 0.413 + uSalt * 1.7) - 0.5;
    vec2 u = (p + jr * uPileD * 2.4) / uPlate + 0.5;
    // (past the frame's edge, on a turning plate, there is no sand to read)
    float d = max(abs(u.x - 0.5), abs(u.y - 0.5)) < 0.5 ? textureLod(uSand, u, uLod).a : 0.0;
    if (d > uCap) {
      float e = uPileD * (1.0 + 0.8 * fract(jr.x * 7.3));
      vec2 gd = vec2(textureLod(uSand, u + vec2(e / uPlate.x, 0.0), uLod).a - textureLod(uSand, u - vec2(e / uPlate.x, 0.0), uLod).a,
                     textureLod(uSand, u + vec2(0.0, e / uPlate.y), uLod).a - textureLod(uSand, u - vec2(0.0, e / uPlate.y), uLod).a);
      float gl2 = length(gd);
      vec2 j = og_hash2(c.yx * 0.611 + uSalt * 0.9) - 0.5;
      if (gl2 > 1e-4) p -= gd / gl2 * min(0.0012, (d - uCap) * 0.0004) * (0.5 + og_hash(c * 0.37 + uSalt)) * uSlide;
      p += j * 0.0009 * min(1.0, d - uCap) * uSlide;
    }
  }
  // a finger through the sand : it pushes the grains out of its way and along
  for (int i = 0; i < ${MAX_PRESS}; i++) {
    float R = uPress[i].z;
    if (R <= 0.0) continue;
    // (the whole way it moved this step, however far the last event threw it)
    vec2 ab = uDrag[i].xy, a0 = uPress[i].xy - ab;
    float ll = dot(ab, ab);
    vec2 cp = a0 + ab * (ll > 0.0 ? clamp(dot(p - a0, ab) / ll, 0.0, 1.0) : 1.0);
    vec2 d = p - cp;
    float l = length(d);
    if (l < R) p = cp + (l > 1e-4 ? d / l : vec2(cos(g.z * 6.283), sin(g.z * 6.283))) * mix(l, R * (1.0 + 0.5 * g.z), 0.7) + ab * (1.0 - l / R) * 0.25;
  }
  // fresh sand trickling on, anywhere on the plate
  if (uPour > 0.0 && og_hash(c.yx * 0.533 + uSalt * 1.3) < uPour) {
    vec2 h = og_hash2(c * 1.117 + uSalt * 0.31);
    p = (h - 0.5) * uPlate;
  }
  // a grain that bounces off the plate comes back from its edge; thrown off a
  // spinning plate, it lands again somewhere as fresh sand
  vec2 h3 = og_hash2(c * 0.877 + uSalt * 0.41);
  float R = uRound > 0.5 ? 0.5 : uDisc;
  if (R > 0.0) {
    float l = length(p);
    if (l > R) {
      float an = h3.x * 6.2831853;
      p = uOm2 > 0.1 ? R * sqrt(h3.y) * vec2(cos(an), sin(an)) : p * max(0.0, 2.0 * R - l) / l;
    }
  } else {
    vec2 b = uPlate * 0.5;
    if (uOm2 > 0.1 && max(abs(p.x) - b.x, abs(p.y) - b.y) > 0.0) p = (h3 - 0.5) * uPlate;
    p = sign(p) * (b - abs(abs(p) - b));
  }
  o = vec4(p, g.z, g.w);
}`

const SPLAT_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uG;
uniform vec2 uPlate;
uniform float uPt;
flat out float vB;
void main() {
  ivec2 c = ivec2(gl_VertexID % ${GRAIN_W}, gl_VertexID / ${GRAIN_W});
  vec4 g = texelFetch(uG, c, 0);
  gl_Position = vec4(g.xy / uPlate * 2.0, 0.0, 1.0);
  vB = fract(g.z * 91.7 + g.w * 53.3);
  gl_PointSize = max(1.0, uPt * (0.72 + 0.56 * fract(g.w * 37.1)));
}`
const SPLAT_FS = `#version 300 es
precision highp float;
flat in float vB;
out vec4 o;
// (each grain lies over the last on color, added on alpha : the channels read back
// as coverage, the tone of the grain on top, and how many are piled here)
void main() { o = vec4(1.0, vB, 0.0, 1.0); }`

// ── The picture ─────────────────────────────────────────────────────────────
const SHOW_FS = `${FS_HEAD}
uniform sampler2D uSand, uSide;
uniform vec2 uPlate;
uniform vec3 uSandCol, uPlateCol;
uniform float uSurface, uGround, uSheen, uAngle, uSparkle, uSideAmt, uHasSide, uRound, uPx, uTheta;
out vec4 fragColor;
uniform float uFill;
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
vec2 toDisc(vec2 s) { return vec2(s.x * sqrt(1.0 - 0.5 * s.y * s.y), s.y * sqrt(1.0 - 0.5 * s.x * s.x)); }
vec2 toSquare(vec2 d) {
  float u2 = d.x * d.x, v2 = d.y * d.y, t = 2.8284271;
  return vec2(0.5 * sqrt(max(0.0, 2.0 + u2 - v2 + t * d.x)) - 0.5 * sqrt(max(0.0, 2.0 + u2 - v2 - t * d.x)),
              0.5 * sqrt(max(0.0, 2.0 - u2 + v2 + t * d.y)) - 0.5 * sqrt(max(0.0, 2.0 - u2 + v2 - t * d.y)));
}
vec2 turn(vec2 p, float a) {
  if (uFill < 0.5) return rot2(p, a);
  return clamp(toSquare(rot2(toDisc(clamp(p * 2.0, -1.0, 1.0)), a)), -1.0, 1.0) * 0.5;
}

float streak(vec2 p, float k) { return og_vnoise(vec2(p.x * 7.0, p.y * k)); }
float pileAt(vec2 uv, float e) { return log(1.0 + textureLod(uSand, uv, e).a * 1.5); }

// The plate under the sand : its color, and how much it mirrors what lies on it.
// P : the point on the plate (its texture turns with it); F : in the frame (the
// lamp's light stays where the lamp is).
vec3 surface(vec2 P, vec2 F, vec2 L, out float mirror) {
  mirror = 0.0;
  float s = uSurface;
  // the finest detail follows the picture's own rows, never finer than it can show
  float fine = min(760.0, RENDERSIZE.y * 0.42);
  float big = og_fbm(P * 2.4 + 5.0, 3.0);
  if (s < 0.5) {
    // black steel : a near-black sheet, faintly brushed, one soft wash of light
    float br = streak(P, fine * 0.3);
    vec3 c = uPlateCol * (0.72 + 0.5 * big) * (0.97 + 0.06 * br);
    float wq = dot(F, vec2(-L.y, L.x)) * 1.5; // (squared by hand : pow() of a negative is undefined)
    float wash = exp(-wq * wq);
    return c + uSheen * wash * (0.018 + 0.012 * br) * (vec3(0.8, 0.86, 1.0) + uPlateCol * 4.0);
  }
  if (s < 1.5) {
    // spun metal : turned on a lathe, the light's bow-tie round its middle
    float r = length(P), t = atan(P.y, P.x);
    float n = og_vnoise(vec2(r * fine * 1.3, t * 2.0));
    float lobe = pow(abs(cos(atan(F.y, F.x) - atan(L.y, L.x))), 7.0);
    return uPlateCol * (0.55 + 0.35 * n) * (0.8 + 0.5 * big) + uSheen * lobe * (0.25 + 0.75 * n) * (uPlateCol * 2.4 + 0.04);
  }
  if (s < 2.5) {
    // rust : a pitted sheet, its scabs lifting the warm oxide
    float scab = smoothstep(0.42, 0.66, og_fbm(P * 5.5 + 9.0, 5.0));
    float pit = og_vnoise(P * fine * 0.4);
    vec3 ox = uPlateCol * vec3(2.1, 1.05, 0.55) + vec3(0.02, 0.008, 0.0);
    return mix(uPlateCol * 0.55, ox, scab) * (0.72 + 0.5 * pit) * (0.85 + uSheen * 0.4 * big);
  }
  if (s < 3.5) {
    // slate : a cleft matte stone, fine speckle, no shine to speak of
    float cleft = og_fbm(vec2(P.x * 3.0 + P.y * 1.2, P.y * 11.0), 4.0);
    float sp = og_vnoise(P * fine * 0.55);
    return uPlateCol * (0.55 + 0.9 * cleft) * (0.88 + 0.24 * sp);
  }
  if (s < 4.5) {
    // black glass : a mirror for the sand, and a window's glare across it
    mirror = 0.34;
    float glare = smoothstep(0.34, 0.0, abs(dot(F, vec2(-L.y, L.x)) - 0.12)) * smoothstep(0.7, 0.1, abs(dot(F, L)));
    return uPlateCol * (0.85 + 0.3 * big) + uSheen * 0.09 * glare;
  }
  if (s < 5.5) {
    // paper : a heavy sheet, its fibers laid every way
    float fib = og_vnoise(P * fine * 0.5) * 0.5 + og_vnoise(vec2(P.x * fine * 0.12, P.y * fine * 0.5) + 3.0) * 0.5;
    return uPlateCol * (0.93 + 0.1 * (fib - 0.5) + 0.07 * (big - 0.5));
  }
  // felt : soft matted wool, the light falling off into it
  float nap = og_vnoise(P * fine * 0.6) * 0.6 + og_vnoise(P * fine * 0.21 + 7.0) * 0.4;
  return uPlateCol * (0.62 + 0.8 * nap) * (0.8 + 0.4 * big);
}

void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  vec2 P = (uv - 0.5) * uPlate;
  vec2 L = vec2(cos(uAngle), sin(uAngle));
  vec2 ts = vec2(uPx) / RENDERSIZE;
  vec4 s0 = textureLod(uSand, uv, 0.0);
  float cov = clamp(s0.r, 0.0, 1.0);
  // the piles : a soft shape (log : a heap is no brighter than a thin line, only
  // rounder), light on the side that faces the lamp
  float e = 2.0;
  float sx = pileAt(uv + vec2(ts.x * 2.5, 0.0), e) - pileAt(uv - vec2(ts.x * 2.5, 0.0), e);
  float sy = pileAt(uv + vec2(0.0, ts.y * 2.5), e) - pileAt(uv - vec2(0.0, ts.y * 2.5), e);
  float lit = 1.0 + 0.14 * clamp(-(sx * L.x + sy * L.y), -0.5, 0.5);
  // each grain its own glint : the tone of whichever lies on top
  float g = s0.r > 1e-4 ? s0.g / s0.r : 0.5;
  float spark = 1.0 + uSparkle * (g - 0.5) * 0.9 + uSparkle * smoothstep(0.88, 0.99, g) * 0.8;
  vec3 tone = uSandCol;
  if (uHasSide > 0.5 && uSideAmt > 0.0) tone = mix(tone, textureLod(uSide, uv, 0.0).rgb * 1.15, uSideAmt);
  vec3 sand = tone * lit * spark;
  // the plate, darkened where the sand stands between it and the lamp
  float mirror;
  vec3 plate = surface(turn(P, -uTheta), P, L, mirror);
  float shade = 1.0 - exp(-textureLod(uSand, uv + L * ts * 3.0, 2.5).a * 0.7);
  plate *= 1.0 - 0.6 * shade;
  if (mirror > 0.0) plate += uSandCol * mirror * (1.0 - exp(-textureLod(uSand, uv - L * ts * 5.0, 0.8).a * 0.8));
  float rim = 0.0;
  if (uRound > 0.5) {
    // the round plate's edge : a thin lit bevel, then nothing
    float r = length(P);
    rim = smoothstep(0.492, 0.498, r) * (1.0 - smoothstep(0.498, 0.503, r));
    plate = plate * (1.0 - smoothstep(0.497, 0.503, r)) + vec3(0.32) * rim * (0.35 + 0.65 * max(0.0, dot(normalize(P + 1e-5), L)));
  }
  float a = mix(cov, 1.0, uGround);
  vec3 c = sand * cov + plate * (1.0 - cov) * mix(uGround, 1.0, step(0.999, a));
  // straight alpha : a plate faded out leaves the sand standing on what is below
  fragColor = vec4(a > 0.001 ? c / a : vec3(0.0), a);
}`

type Mode = [number, number, number, number]

export class SandPlateSource implements NativeGenerator {
  private g: EngineGL
  private fieldP: Prog
  private seedP: Prog
  private stepP: Prog
  private splatP: Prog
  private showP: Prog
  private grains: [Target, Target] | null = null
  private field: Target | null = null
  private sand: Target | null = null
  private besselTex: WebGLTexture | null = null
  private blankTex: WebGLTexture | null = null
  private gi = 0
  private clock = new SlotClock()
  private acc = 0
  private n = 0
  private inputs: Record<string, number | number[]> = {}
  private side: WebGLTexture | null = null
  private redrawE = new Edge()
  private reseedE = new Edge()
  private pendSeed = true
  private pendRedraw = true
  // the figure : what the sand is leaving (A) and where it is going (B)
  private modesA: Mode[] = []
  private modesB: Mode[] = []
  private mix = 1
  private sinceRedraw = 0
  private kick = 0
  private fieldDirty = true
  private fieldKey = ''
  private warpT = 0
  private seed = Math.random() * 40
  private rngS = Math.floor(Math.random() * 2147483646) + 1
  private peaks: number[] = []
  private peakKey = ''
  private prevT = 0
  private figKey = ''
  private lastRound = 0
  private lastPeakKey = ''
  private keyAge = 0
  private keyOwed = false
  // pointers : the mouse and the hands, each a finger on the plate
  private press = new Map<number, { x: number; y: number; dx: number; dy: number; gone?: boolean }>()
  private plate: [number, number] = [1, 1]
  // the turning plate : its angle, and whether the sand has spread past the frame
  private theta = 0
  private disc = false
  private pendPast = false
  private settle = 7

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    const g = (this.g = new EngineGL(gl, 'sandplate'))
    this.fieldP = g.prog(FIELD_FS)
    this.seedP = g.prog(SEED_FS)
    this.stepP = g.prog(STEP_FS)
    this.splatP = g.prog(SPLAT_FS, SPLAT_VS)
    this.showP = g.prog(SHOW_FS)
  }

  private rand(): number {
    // Park-Miller : a figure can be told again from its seed
    this.rngS = (this.rngS * 16807) % 2147483647
    return (this.rngS - 1) / 2147483646
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
    if (this.redrawE.fired(num(inputs, 'redraw', 0))) this.pendRedraw = true
    if (this.reseedE.fired(num(inputs, 'reseed', 0))) this.pendSeed = true
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
    if (typeof value !== 'number') return
    if (name === 'redraw' && this.redrawE.fired(value)) this.pendRedraw = true
    if (name === 'reseed' && this.reseedE.fired(value)) this.pendSeed = true
  }

  feed(_audio: WebGLTexture | null, side: WebGLTexture | null): void {
    this.side = side
  }

  pointer(ev: SourcePointer): void {
    const hw = this.plate[0], hh = this.plate[1]
    const x = (ev.u - 0.5) * hw, y = (ev.v - 0.5) * hh
    if (ev.phase === 'down') {
      this.press.set(ev.pid, { x, y, dx: 0, dy: 0 })
      // a tap on the plate : it rings, and the loose sand jumps
      this.kick = Math.max(this.kick, 0.7)
    }
    else if (ev.phase === 'move') {
      const p = this.press.get(ev.pid)
      if (p) this.press.set(ev.pid, { x, y, dx: p.dx + (x - p.x), dy: p.dy + (y - p.y) })
    } else {
      // (kept for one step : a click shorter than a frame still lands)
      const p = this.press.get(ev.pid)
      if (p) p.gone = true
    }
  }

  pointerHint(): string {
    return 'click : the plate rings · drag : a finger through the sand'
  }

  status(): string {
    const n = this.grainCount()
    return `${Math.round(n / 1000)}K grains`
  }

  event(name: string): void {
    if (name === 'redraw') this.pendRedraw = true
    else if (name === 'reseed') this.pendSeed = true
  }

  private grainCount(): number {
    return Math.max(1024, Math.min(GRAIN_W * GRAIN_W, Math.round(Math.max(0.02, num(this.inputs, 'grains', 0.8)) * 1e6)))
  }

  /** The radius of the disc the sand lies on once a flat rectangular plate has
   *  turned (0 : the frame itself, and the round plate has its own). */
  private discR(): number {
    return this.disc && !this.isRound() && domeFill() <= 0 ? Math.hypot(this.plate[0], this.plate[1]) / 2 : 0
  }

  private isRound(): boolean {
    return Math.round(num(this.inputs, 'shape', 0)) === 1
  }

  // ── Which modes ring : the figure ────────────────────────────────────────
  /** A figure around `order` (how many cells across) : `tones` modes close to it,
   *  or the modes nearest the frequencies in `orders` when the sound picks them. */
  private figure(orders: number[]): Mode[] {
    const round = this.isRound()
    const out: Mode[] = []
    const wanted = Math.max(1, Math.min(MAX_TONES, orders.length))
    for (let i = 0; i < wanted; i++) {
      const o = Math.max(2, orders[i])
      const wt = i === 0 ? 1 : 0.45 + 0.4 * this.rand()
      if (round) {
        // the plate's law : a mode with n diameters and s circles rings at (n + 2s)^2,
        // so n + 2s stands for the order; its wave number from the zero of J_n near
        // (s + n / 2 - 1 / 4) pi, on a plate of radius 0.5
        const sum = Math.max(2, Math.round(o * 0.7))
        // (few diameters : J_n stays near 0 out to r ~ n / k, a big still blob in the
        // plate's middle that all the sand would pile into)
        const n = i === 0 && wanted > 1 ? 0 : Math.max(0, Math.min(6, sum - 2, Math.round(this.rand() * 6)))
        const s = Math.max(1, Math.round((sum - n) / 2))
        const k = Math.min(BESSEL_X / 0.6, ((s + n / 2 - 0.25) * Math.PI) / 0.5)
        out.push([n, k, wt, this.rand() * 6.2832])
      } else {
        // m^2 + n^2 near the order^2 : the modes of the same pitch, a different shape
        const r = o * (1 + (this.rand() - 0.5) * (i === 0 ? 0.06 : 0.2))
        const th = (0.12 + 0.76 * this.rand()) * (Math.PI / 2)
        let m = Math.max(1, Math.round(r * Math.cos(th)))
        let n = Math.max(0, Math.round(r * Math.sin(th)))
        if (m === n) m++
        if (this.rand() < 0.5) [m, n] = [n, m]
        out.push([m, n, wt, this.rand() < 0.5 ? 1 : -1])
      }
    }
    // normalized by the sum's RMS, so |phi| reads the same for one tone or five
    let e = 0
    for (const m of out) e += m[2] * m[2]
    const scale = 1 / (Math.sqrt(e) * (round ? 0.5 : 0.707))
    for (const m of out) m[2] *= scale
    return out
  }

  private redraw(orders?: number[]): void {
    const tones = Math.max(1, Math.min(MAX_TONES, Math.round(num(this.inputs, 'tones', 3))))
    const order = Math.max(2, num(this.inputs, 'order', 12))
    const list = orders && orders.length ? orders.slice(0, MAX_TONES) : new Array<number>(tones).fill(order)
    // a figure caught mid-glide starts from where the plate is now, close enough
    this.modesA = this.mix >= 1 || !this.modesB.length ? this.modesB : this.modesA
    this.modesB = this.figure(list)
    this.mix = this.modesA.length ? 0 : 1
    this.sinceRedraw = 0
    this.kick = 1
    this.fieldDirty = true
  }

  /** The loudest frequencies, as figure orders : a plate rings at f ~ k^2, so the
   *  order goes as the root of the frequency, ORDER standing at A 440. */
  private listen(order: number): number[] {
    const spec = audioBus.spectrumBytes()
    if (!spec || !spec.length) return []
    const sr = audioBus.sampleRateHz() || 48000
    const hzPerBin = sr / 2 / spec.length
    const BANDS = 28
    const band = new Float32Array(BANDS)
    const lo = Math.log(70), hi = Math.log(9000)
    for (let i = 1; i < spec.length; i++) {
      const f = i * hzPerBin
      if (f < 70 || f > 9000) continue
      const b = Math.min(BANDS - 1, Math.floor(((Math.log(f) - lo) / (hi - lo)) * BANDS))
      if (spec[i] > band[b]) band[b] = spec[i]
    }
    const peaks: Array<{ b: number; v: number }> = []
    for (let b = 0; b < BANDS; b++) {
      const v = band[b]
      if (v < 110) continue
      if ((b === 0 || band[b - 1] <= v) && (b === BANDS - 1 || band[b + 1] <= v)) peaks.push({ b, v })
    }
    peaks.sort((x, y) => y.v - x.v)
    const tones = Math.max(1, Math.min(MAX_TONES, Math.round(num(this.inputs, 'tones', 3))))
    this.peakKey = peaks.slice(0, tones).map((p) => p.b).sort((a, b) => a - b).join(',')
    return peaks.slice(0, tones).map((p) => {
      const f = Math.exp(lo + ((p.b + 0.5) / BANDS) * (hi - lo))
      return Math.max(2, Math.min(40, order * Math.sqrt(f / 440)))
    })
  }

  private ensure(): void {
    const g = this.g, gl = g.gl
    if (!this.grains) {
      this.grains = [g.target(GRAIN_W, GRAIN_W), g.target(GRAIN_W, GRAIN_W)]
    }
    // the field : square, to hold the frame at any angle of the plate; its rows hold
    // the highest mode (40 half waves a height, 12 rows each at 16:9)
    if (!this.field) {
      this.field = g.target(1024, 1024, { half: 'rgba', linear: true })
      this.fieldDirty = true
    }
    if (!this.sand) {
      this.sand = g.target(this.w, this.h, { half: 'rgba', linear: true })
      gl.bindTexture(gl.TEXTURE_2D, this.sand.tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
  }

  private bessel(): WebGLTexture {
    const gl = this.g.gl
    if (this.besselTex) return this.besselTex
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, BESSEL_W, BESSEL_N, 0, gl.RED, gl.FLOAT, besselTable())
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.besselTex = t
    return t
  }

  private blank(): WebGLTexture {
    const gl = this.g.gl
    if (this.blankTex) return this.blankTex
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

  /** The side of the plate's field : the frame's diagonal, flat (it may turn to any
   *  angle); under full-dome fill the frame itself (the turn stays inside the disc). */
  private span(): number {
    return domeFill() > 0 ? 1 : Math.hypot(this.plate[0], this.plate[1])
  }

  private drawField(): void {
    const g = this.g, gl = g.gl, F = this.field!
    const p = this.fieldP
    const flat = (ms: Mode[]): Float32Array => {
      const a = new Float32Array(MAX_TONES * 4)
      ms.slice(0, MAX_TONES).forEach((m, i) => a.set(m, i * 4))
      return a
    }
    p.use().f2('RENDERSIZE', F.w, F.h).f1('uSpan', this.span())
      .f1('uMix', this.mix * this.mix * (3 - 2 * this.mix))
      .f1('uWarp', Math.max(0, Math.min(1, num(this.inputs, 'warp', 0.45))))
      .f1('uWarpT', this.warpT).f1('uSeed', this.seed)
      .f1('uUneven', Math.max(0, Math.min(1, num(this.inputs, 'uneven', 0.35))))
      .f1('uRound', this.isRound() ? 1 : 0)
      .i1('uNA', Math.min(MAX_TONES, this.modesA.length)).i1('uNB', Math.min(MAX_TONES, this.modesB.length))
      .i1('uJ', 0)
    gl.uniform4fv(p.u('uA'), flat(this.modesA))
    gl.uniform4fv(p.u('uB'), flat(this.modesB))
    g.bind(0, this.isRound() ? this.bessel() : this.blank())
    g.draw(F.fbo, F.w, F.h)
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
    // Under full-dome fill the frame is spread over one circle : the plate is kept
    // square there, so its cells and the round plate stay round on the dome.
    const asp = domeFill() > 0 ? 1 : this.w / Math.max(1, this.h)
    if (asp !== this.plate[0]) { this.plate = [asp, 1]; this.pendSeed = true; this.fieldDirty = true }
    this.ensure()
    const dt = this.clock.tick(clockSec)
    const round = this.isRound()
    const surfaceI = Math.max(0, Math.min(SURFACES.length - 1, Math.round(num(I, 'surface', 0))))
    const surf = SURFACES[surfaceI]
    const order = Math.max(2, num(I, 'order', 12))
    const amt = Math.max(0, Math.min(1, num(I, 'audio', 0)))
    const G = this.grains!

    // ── the figure : asked for, on its timer or beat, or on the sound's accent ──
    this.sinceRedraw += dt
    if (amt > 0) {
      const orders = this.listen(order)
      const t = audioBus.feature('transient')
      const accent = t > 0.5 && this.prevT <= 0.5
      this.prevT = t
      const keyNow = this.peakKey
      if (keyNow !== this.lastPeakKey) { this.lastPeakKey = keyNow; this.keyAge = 0; this.keyOwed = true }
      this.keyAge += dt
      // a new harmony redraws the figure on the next accent (a held pad, with no
      // accent to wait for, after a while)
      if (orders.length && this.keyOwed && ((accent && this.sinceRedraw > 0.25) || this.keyAge > 2.5)) {
        this.keyOwed = false
        this.pendRedraw = false
        this.redraw(orders)
      }
    }
    const sync = Math.round(num(I, 'sync', 0))
    const every = Math.max(0, num(I, 'every', 8))
    const gap = sync > 0 ? (60 / Math.max(20, tempoBpm())) * [0, 1, 2, 4, 8, 16][Math.min(5, sync)] : every
    if (gap > 0 && this.sinceRedraw >= gap && amt < 1) this.pendRedraw = true
    const figKey = `${Math.round(order * 2)}|${Math.round(num(I, 'tones', 3))}|${round ? 1 : 0}`
    if (figKey !== this.figKey && (!this.figKey || this.sinceRedraw > 0.12)) {
      // a new order, tone count or plate : the sand moves to it
      if (this.figKey && (round ? 1 : 0) !== this.lastRound) { this.modesA = []; this.modesB = []; this.mix = 1; this.pendSeed = true }
      this.figKey = figKey
      this.lastRound = round ? 1 : 0
      this.pendRedraw = true
    }
    if (this.pendRedraw || !this.modesB.length) { this.pendRedraw = false; this.redraw() }

    // ── the plate's field : rebuilt only when something in it moved ──
    const glide = Math.max(0.02, num(I, 'glide', 0.6))
    if (this.mix < 1) { this.mix = Math.min(1, this.mix + dt / glide); this.fieldDirty = true }
    const wander = Math.max(0, Math.min(1, num(I, 'wander', 0.1)))
    if (wander > 0 && dt > 0) { this.warpT = (this.warpT + dt * wander * 0.05) % 512; this.fieldDirty = true }
    const key = `${num(I, 'warp', 0.45)}|${num(I, 'uneven', 0.35)}|${this.plate[0]}`
    if (key !== this.fieldKey) { this.fieldKey = key; this.fieldDirty = true }
    if (this.fieldDirty) { this.fieldDirty = false; this.drawField() }

    // ── the sand ──
    if (this.pendSeed) {
      this.pendSeed = false
      this.settle = 7
      this.seedP.use().f2('uPlate', this.plate[0], this.plate[1]).f1('uRound', round ? 1 : 0).f1('uSalt', Math.random() * 100)
        .f1('uDisc', this.discR()).f1('uBase', this.grainCount())
      // (both buffers : a later, larger GRAINS finds its grains seeded either way)
      g.draw(G[0].fbo, GRAIN_W, GRAIN_W)
      g.draw(G[1].fbo, GRAIN_W, GRAIN_W)
    }
    const baseCount = this.grainCount()
    // the drive : the knob, the sound's level with AUDIO (a silent plate rests), and
    // a kick when a new figure sets the plate going
    let drive = Math.max(0, Math.min(1, num(I, 'drive', 0.5)))
    // (freshly poured sand settles into its first figure before the plate listens :
    // in silence it would rest as it fell, a noise instead of a picture)
    this.settle = Math.max(0, this.settle - dt)
    if (amt > 0 && this.settle <= 0) {
      // (a root : quiet music still moves the sand, and only silence rests it)
      const lv = Math.min(1, Math.sqrt(Math.max(0, audioBus.feature('level'))) * 1.5)
      drive *= 1 - amt + amt * lv
    }
    this.kick *= Math.exp(-dt / 0.7)
    const driveNow = drive * 2.2 * (1 + this.kick * 1.3) * (amt > 0 && this.settle > 0 ? 1.4 : 1)
    const width = Math.max(0, Math.min(1, num(I, 'width', 0.58)))
    const grip = surf.grip * (0.1 + 1.25 * width * width)
    const stray = Math.max(0, Math.min(1, num(I, 'scatter', 0.006) + surf.stray))
    const tiltAmt = Math.max(0, Math.min(1, num(I, 'tilt', 0.05))) * 0.55
    const ta = num(I, 'tiltAngle', 0)
    const pour = Math.pow(Math.max(0, Math.min(1, num(I, 'pour', 0.05))), 2) * 0.004
    // ROTATION : right of the middle clockwise, left counterclockwise, squared for
    // fine control near a standstill, half a turn a second at the end of its travel
    const spin = Math.max(-1, Math.min(1, num(I, 'rotate', 0)))
    const omega = -Math.sign(spin) * spin * spin * Math.PI
    if (spin !== 0 && !this.disc) {
      // the first turn : sand appears on the rest of the plate, past the frame's edges
      // (the frame's own stays as it lies, and no corner comes round bare)
      this.disc = true
      this.pendPast = !round && domeFill() <= 0
    }
    if (this.pendPast) {
      this.pendPast = false
      const from = Math.ceil(baseCount / GRAIN_W)
      this.seedP.use().f2('uPlate', this.plate[0], this.plate[1]).f1('uRound', 0).f1('uSalt', Math.random() * 100)
        .f1('uDisc', this.discR()).f1('uBase', 0)
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(0, from, GRAIN_W, GRAIN_W - from)
      g.draw(G[0].fbo, GRAIN_W, GRAIN_W)
      g.draw(G[1].fbo, GRAIN_W, GRAIN_W)
      gl.disable(gl.SCISSOR_TEST)
    }
    // (their number : the same sand per area on the whole disc as in the frame)
    const discR = this.discR()
    const count = discR > 0 ? Math.min(GRAIN_W * GRAIN_W, Math.round((baseCount * Math.PI * discR * discR) / (this.plate[0] * this.plate[1]))) : baseCount
    const rows = Math.ceil(count / GRAIN_W)
    this.acc = Math.min(this.acc + dt, STEP * 3)
    const press = [...this.press.values()].slice(0, MAX_PRESS)
    const pressA = new Float32Array(MAX_PRESS * 4), dragA = new Float32Array(MAX_PRESS * 4)
    const radius = 0.012 + 0.03 * Math.max(0, Math.min(1, num(I, 'finger', 0.4)))
    press.forEach((p, i) => { pressA.set([p.x, p.y, radius, 0], i * 4); dragA.set([p.dx, p.dy, 0, 0], i * 4) })
    let dragged = false
    const span = this.span()
    // how deep the sand may stand before it slides (grains a pixel, the same at any
    // resolution : a grain keeps its size in the frame), read a few pixels wide
    // (in step with how much sand there is and how big a grain : a line that never
    // reaches its limit beads up, one that does lies smooth and even)
    const gs = Math.max(0.3, num(I, 'grainSize', 0.85))
    const cap = (7.5 - 6.2 * width) * Math.max(0.15, baseCount / 1e6) * gs * gs
    const pileLod = Math.max(1, Math.log2(Math.max(1, (this.h / 1080) * 7)))
    while (this.acc >= STEP) {
      this.acc -= STEP
      this.n++
      this.theta = (this.theta + omega * STEP) % (Math.PI * 2)
      this.stepP.use().i1('uG', 0).i1('uF', 1).f2('uPlate', this.plate[0], this.plate[1])
        .f1('uDrive', driveNow).f1('uGrip', grip).f1('uHop', 0.0040 * surf.hop)
        .f1('uSettle', 0.62).f1('uStray', stray).f1('uSalt', (this.n % 997) * 0.137)
        .f1('uPour', pour).f1('uRound', round ? 1 : 0).f1('uRadial', domeFill() > 0 ? 1 : 0)
        .f2('uTilt', Math.cos(ta) * tiltAmt, Math.sin(ta) * tiltAmt)
        .i1('uSand', 2).f1('uCap', cap).f1('uLod', pileLod).f1('uPileD', Math.pow(2, pileLod) / this.h)
        .f1('uSpan', span).f1('uTheta', this.theta).f1('uCarry', omega * STEP).f1('uOm2', omega * omega)
        .f1('uDisc', this.discR()).f1('uFill', domeFill() > 0 ? 1 : 0)
        .f1('uSlide', Math.min(1, driveNow * 2))
      gl.uniform4fv(this.stepP.u('uPress'), pressA)
      gl.uniform4fv(this.stepP.u('uDrag'), dragged ? new Float32Array(MAX_PRESS * 4) : dragA)
      dragged = true
      g.bind(0, G[this.gi].tex)
      g.bind(1, this.field!.tex)
      g.bind(2, this.sand!.tex)
      // (only the rows in use : a grain past the count waits where it was seeded)
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(0, 0, GRAIN_W, rows)
      g.draw(G[1 - this.gi].fbo, GRAIN_W, GRAIN_W)
      gl.disable(gl.SCISSOR_TEST)
      this.gi = 1 - this.gi
    }
    if (dragged) {
      for (const p of press) { p.dx = 0; p.dy = 0 }
      for (const [id, p] of this.press) if (p.gone) this.press.delete(id)
    }

    // ── every grain a point added into the sand ──
    const S = this.sand!
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.fbo)
    gl.viewport(0, 0, S.w, S.h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    g.bind(1, null)
    g.bind(2, null)
    // (the grain keeps its size in the frame at any resolution)
    const pt = 1.55 * Math.max(0.3, num(I, 'grainSize', 0.85)) * (this.h / 1080)
    this.splatP.use().i1('uG', 0).f2('uPlate', this.plate[0], this.plate[1]).f1('uPt', pt)
    g.bind(0, G[this.gi].tex)
    gl.bindVertexArray(g.pointVao)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE)
    gl.drawArrays(gl.POINTS, 0, count)
    gl.disable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.bindVertexArray(null)
    g.bind(0, S.tex)
    gl.generateMipmap(gl.TEXTURE_2D)

    // ── the plate and the sand on it ──
    const [sr, sg, sb] = col(I, 'sand', [0.84, 0.86, 0.92])
    const [pr, pg, pb] = col(I, 'plate', [0.032, 0.038, 0.062])
    const sideAmt = Math.max(0, Math.min(1, num(I, 'side', 0)))
    this.showP.use().i1('uSand', 0).i1('uSide', 1).f2('RENDERSIZE', this.w, this.h).f2('uPlate', this.plate[0], this.plate[1])
      .f3('uSandCol', sr, sg, sb).f3('uPlateCol', pr, pg, pb)
      .f1('uSurface', surfaceI).f1('uGround', Math.max(0, Math.min(1, num(I, 'ground', 1))))
      .f1('uSheen', Math.max(0, Math.min(1, num(I, 'sheen', 0.35)))).f1('uAngle', num(I, 'lightAngle', 2.36))
      .f1('uSparkle', Math.max(0, Math.min(1, num(I, 'sparkle', 0.4))))
      .f1('uSideAmt', sideAmt).f1('uHasSide', this.side ? 1 : 0)
      .f1('uRound', round ? 1 : 0).f1('uPx', this.h / 1080).f1('uTheta', this.theta).f1('uFill', domeFill() > 0 ? 1 : 0)
    g.bind(0, S.tex)
    g.bind(1, this.side ?? this.blank())
    g.draw(targetFbo, this.w, this.h)
    g.done(3)
  }

  dispose(): void {
    const g = this.g, gl = g.gl
    for (const t of [...(this.grains ?? []), this.field, this.sand]) g.freeTarget(t)
    this.grains = null
    this.field = null
    this.sand = null
    if (this.besselTex) gl.deleteTexture(this.besselTex)
    if (this.blankTex) gl.deleteTexture(this.blankTex)
    this.besselTex = null
    this.blankTex = null
    g.dispose()
  }
}
