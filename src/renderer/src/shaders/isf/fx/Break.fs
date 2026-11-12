/*{
  "DESCRIPTION": "Break : the picture cracks like a pane hit by a stone. One hit (BREAK ▸, a click on the preview, a pinch, a beat or an onset bound to it, or by itself every few seconds with EVERY or SYNC) cracks it from the IMPACT point : the cracks run out from it (SHARDS of them) and round it (RINGS), wandering (WANDER) and broken off here and there (BROKEN), and the pieces tilt (TILT) and catch the light of the room on their faces and on the chamfered edges (BEVEL, from LIGHT), bending what they show (REFRACT). Then, over TIME : HOLD keeps them cracked, DRIFT floats them apart, FALL drops them (down the walls on the full dome), HEAL brings them back together. FORCE is how hard the hit is, SCATTER lands the automatic hits around the impact point. BEHIND : what shows in the gaps, from nothing (the layers below) to the picture itself in shadow.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glass", "Distortion"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "impact",  "TYPE": "event", "LABEL": "break ▸" },
    { "NAME": "every",   "TYPE": "float", "MIN": 0.0, "MAX": 20.0, "DEFAULT": 3.5, "LABEL": "every (s)" },
    { "NAME": "sync",    "TYPE": "long",  "VALUES": [0, 1, 2, 3, 4, 5], "LABELS": ["free (every)", "4 bars", "2 bars", "1 bar", "1/2", "1/4"], "DEFAULT": 0, "LABEL": "sync", "COMPACT": true },
    { "NAME": "after",   "TYPE": "long",  "VALUES": [0, 1, 2, 3], "LABELS": ["hold", "drift", "fall", "heal"], "DEFAULT": 3, "LABEL": "then", "COMPACT": true },
    { "NAME": "time",    "TYPE": "float", "MIN": 0.2, "MAX": 8.0, "DEFAULT": 1.8, "LABEL": "time (s)" },
    { "NAME": "force",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "force" },
    { "NAME": "shards",  "TYPE": "float", "MIN": 4.0, "MAX": 36.0, "DEFAULT": 13.0, "LABEL": "shards" },
    { "NAME": "rings",   "TYPE": "float", "MIN": 1.0, "MAX": 9.0, "DEFAULT": 4.0, "LABEL": "rings" },
    { "NAME": "wander",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "wander" },
    { "NAME": "broken",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35, "LABEL": "broken" },
    { "NAME": "tilt",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55, "LABEL": "tilt" },
    { "NAME": "refract", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "refract" },
    { "NAME": "bevel",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "bevel" },
    { "NAME": "light",   "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 2.3, "LABEL": "light" },
    { "NAME": "behind",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "behind" },
    { "NAME": "scatter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "scatter" },
    { "NAME": "amount",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" },
    { "NAME": "hitX",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "impact x" },
    { "NAME": "hitY",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "impact y" }
  ],
  "PASSES": [
    { "TARGET": "state", "PERSISTENT": true, "WIDTH": "4", "HEIGHT": "1" },
    { }
  ]
}*/

// The automatic hits (engine/phases.ts) : one per whole step, every EVERY seconds
// or on a division of the tempo (SYNC), at most four a second. Integrated, so
// moving the knob changes the pace from here on. Used as mod(floor(), 256.) :
// wrapped at that.
uniform float PH_breakAuto; // wrap 256

// @dome

const float TAU = 6.2831853;
const float R0 = 0.035;   // the crushed core round the impact (frame heights)
const float RMAX = 2.1;   // past the farthest corner from any impact

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // precise hash : whole-number inputs, kept small
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
// smooth 1-D value noise, period 256 (the inputs stay small)
float vnoise(float x) {
  float i = floor(x);
  float f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash12(vec2(mod(i, 256.0), 3.0)), hash12(vec2(mod(i + 1.0, 256.0), 3.0)), f);
}

vec2 enc16(float x) {
  float v = floor(clamp(x, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  return vec2(hi, v - hi * 256.0) / 255.0;
}
float dec16(vec2 c) {
  vec2 b = floor(c * 255.0 + 0.5);
  return (b.x * 256.0 + b.y) / 65535.0;
}

// ── the cracks ──────────────────────────────────────────────────────────
// Polar cells round the impact : SHARDS sectors (the radial cracks) cut by RINGS
// concentric cracks spaced in a geometric run (fine near the hit, wide far out),
// both wandering on smooth noise; a BROKEN share of crack segments is missing,
// so neighbors merge into long spikes and odd pieces. q : height units from the
// impact. Returns the piece's id (sector, ring) in xy, its distance to the
// nearest crack in z; n2 = the direction from that crack into the piece.
float sectors() { return floor(shards + 0.5); }
float growth() { return pow(RMAX / R0, 1.0 / max(rings, 1.0)); }
float keepRadial(float i, float j, float sd) {
  float n = sectors();
  return step(broken * 0.75, hash13(vec3(mod(i + n, n), j + 8.0, sd)));
}
float keepRing(float i, float j, float sd) {
  return step(broken, hash13(vec3(i + 40.0, j + 8.0, sd + 17.0)));
}
vec3 cellOf(vec2 q, float sd, float spin, out vec2 n2) {
  float n = sectors();
  float lg = log(growth());
  float r = max(length(q), 1e-5);
  float a = fract(atan(q.y, q.x) / TAU + 0.5 + spin);
  float s = log(r / R0) / lg;
  float sw = s + (vnoise(a * n * 0.7 + sd * 3.1) - 0.5) * wander * 0.9;
  float aw = a + (vnoise(sw * 1.7 + sd * 1.3) - 0.5) * wander * 0.9 / n;
  float j = max(floor(sw), -3.0);
  float fa = fract(aw) * n;
  float i = floor(fa);
  float fi = fa - i;
  // a missing radial crack joins this sector to the one below it (twice at most)
  float im = i;
  float m1 = 1.0 - keepRadial(im, j, sd);
  im -= m1;
  im -= m1 * (1.0 - keepRadial(im, j, sd));
  im = mod(im + n, n);
  // a missing ring crack joins this ring to the one inside it
  float jm = j;
  if (j > -3.0) jm -= 1.0 - keepRing(im, j, sd);
  // distance to the nearest crack that is there
  float arc = TAU * r / n;
  float ring = r * lg;
  float fs = clamp(sw - j, 0.0, 1.0);
  vec2 tang = vec2(-q.y, q.x) / r;
  vec2 rad = q / r;
  float d = 1e3;
  n2 = rad;
  float dl = keepRadial(i, j, sd) > 0.5 ? fi * arc : 1e3;
  if (dl < d) { d = dl; n2 = tang; }
  float dh = keepRadial(i + 1.0, j, sd) > 0.5 ? (1.0 - fi) * arc : 1e3;
  if (dh < d) { d = dh; n2 = -tang; }
  float cl = (j > -3.0 && keepRing(im, j, sd) > 0.5) ? fs * ring : 1e3;
  if (cl < d) { d = cl; n2 = rad; }
  float ch = keepRing(im, j + 1.0, sd) > 0.5 ? (1.0 - fs) * ring : 1e3;
  if (ch < d) { d = ch; n2 = -rad; }
  return vec3(im, jm, d);
}
// a piece's middle (the pivot it turns about), from its id
vec2 centerOf(vec2 id, float spin) {
  float n = sectors();
  float th = ((id.x + 0.5) / n - 0.5 - spin) * TAU;
  float rc = id.y <= -3.0 ? 0.0 : R0 * pow(growth(), id.y + 0.5);
  return vec2(cos(th), sin(th)) * rc;
}

// ── how a piece moves after the hit ─────────────────────────────────────
// t : seconds since the hit. Out : the move (height units) in xy, the turn in z,
// the piece's fade (1 = there) in w; tlt = its tilt.
vec4 pieceMove(vec2 id, vec2 c, float t, float sd, vec2 P, float aspect, out vec2 tlt, out float healed) {
  float h1 = hash13(vec3(id + 61.0, sd));
  float h2 = hash13(vec3(id + 13.0, sd + 5.0));
  float h3 = hash13(vec3(id + 29.0, sd + 9.0));
  float h4 = hash13(vec3(id + 47.0, sd + 2.0));
  float h5 = hash13(vec3(id + 71.0, sd + 7.0));
  float rc = length(c);
  // the crack reaches it, racing out from the hit
  float tt = max(t - rc / 9.0 - 0.015, 0.0);
  float settle = smoothstep(0.0, 0.12, tt);
  vec2 u = rc > 1e-4 ? c / rc : vec2(cos(h1 * TAU), sin(h1 * TAU));
  vec2 perp = vec2(-u.y, u.x);
  float kick = force * (0.004 + 0.016 * h1);
  vec2 tl = (vec2(h3, h4) - 0.5) * 2.0;
  float T = max(time, 0.2);
  float core = step(id.y, -2.0); // the crushed core turns to powder
  healed = 0.0;
  vec2 mv = u * kick * settle;
  float turn = (h2 - 0.5) * 0.08 * force * settle;
  float fade = 1.0;
  tlt = tl * settle;
  if (after == 1) {
    // DRIFT : apart, slowly turning, for TIME; then the pane is whole again
    float v = force * (0.015 + 0.04 * h1);
    mv += u * v * tt + perp * (h5 - 0.5) * 0.025 * force * tt;
    turn += (h2 - 0.5) * force * 0.5 * tt;
    tlt = tl * (settle + 0.25 * tt);
    fade = 1.0 - core * smoothstep(0.05, 0.4, tt);
    healed = smoothstep(T, T + 0.5, t);
  } else if (after == 2) {
    // FALL : one after another (the middle first), under gravity : down, or out
    // to the rim on the full dome
    float tf = max(tt - (h5 * 0.4 + min(rc, 1.0) * 0.25) * T, 0.0);
    float g = 6.6 / (T * T);
    float drop = 0.5 * g * tf * tf;
    vec2 cu = P + c / vec2(aspect, 1.0);
    vec2 gdir = domeDir(cu, vec2(0.0, -1.0));
    mv += gdir * drop + u * force * 0.04 * tf;
    turn += (h2 - 0.5) * (1.0 + force) * 1.6 * tf;
    tlt = tl * (settle + 1.5 * tf);
    fade = (1.0 - smoothstep(0.7, 1.2, drop)) * (1.0 - core * smoothstep(0.05, 0.3, tt));
    healed = smoothstep(T * 1.15, T * 1.15 + 0.5, t);
  } else if (after == 3) {
    // HEAL : out, then back together over TIME
    float env = settle * (1.0 - smoothstep(0.15 * T, T, tt));
    mv = u * (kick + force * (0.02 + 0.05 * h1)) * env;
    turn = (h2 - 0.5) * force * 0.4 * env;
    tlt = tl * env;
    healed = smoothstep(0.6 * T, T, tt);
  }
  return vec4(mv, turn, fade);
}
vec2 rot(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  // (coordinates hoisted : the ISF parser miscompiles a vec2(a, b) inside the call)
  vec2 t0 = vec2(0.125, 0.5);
  vec2 t1 = vec2(0.375, 0.5);
  vec2 t2 = vec2(0.625, 0.5);
  vec2 t3 = vec2(0.875, 0.5);
  vec4 s0 = IMG_NORM_PIXEL(state, t0);
  vec4 s1 = IMG_NORM_PIXEL(state, t1);
  vec4 s2 = IMG_NORM_PIXEL(state, t2);
  vec4 s3 = IMG_NORM_PIXEL(state, t3);
  bool written = s0.a > 0.5;

  if (PASSINDEX == 0) {
    // The state : [0] seconds since the hit (16 bits, to 64 s) + the hit count,
    // [1] where it hit, [2] the layer clock + the automatic step, [3] the
    // trigger as it was (for its rising edge). The layer clock : Speed, freeze
    // and the background's slow clock carry through.
    float dt = written ? min(abs(fract(TIME - dec16(s2.rg) + 0.5) - 0.5), 0.1) : 0.0;
    float age = dec16(s0.rg) * 64.0;
    float sd = floor(s0.b * 255.0 + 0.5);
    float autoStep = mod(floor(PH_breakAuto), 256.0);
    bool autoOn = sync > 0 || every > 0.05;
    bool fireAuto = written && autoOn && abs(autoStep - floor(s2.b * 255.0 + 0.5)) > 0.5;
    bool fireHand = impact && s3.r < 0.5;
    bool fire = fireAuto || fireHand || !written;
    float nsd = fire ? mod(sd + 1.0, 256.0) : sd;
    float nage = fire ? 0.0 : min(age + dt, 63.9);
    vec2 pt = written ? vec2(dec16(s1.rg), dec16(s1.ba)) : vec2(hitX, hitY);
    if (fire) {
      pt = vec2(hitX, hitY);
      // the automatic hits (and the first) land round the point, by SCATTER
      if (!fireHand) pt += (vec2(hash12(vec2(nsd, 5.0)), hash12(vec2(nsd, 9.0))) - 0.5) * scatter * vec2(0.8, 0.7);
      pt = clamp(pt, 0.04, 0.96);
    }
    float ix = floor(gl_FragCoord.x);
    if (ix < 0.5) gl_FragColor = vec4(enc16(nage / 64.0), nsd / 255.0, 1.0);
    else if (ix < 1.5) gl_FragColor = vec4(enc16(pt.x), enc16(pt.y));
    else if (ix < 2.5) gl_FragColor = vec4(enc16(fract(TIME)), autoStep / 255.0, 1.0);
    else gl_FragColor = vec4(impact ? 1.0 : 0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec4 live = IMG_NORM_PIXEL(inputImage, uv);
  if (!written) { gl_FragColor = live; return; }
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float t = dec16(s0.rg) * 64.0;
  float sd = floor(s0.b * 255.0 + 0.5);
  vec2 P = vec2(dec16(s1.rg), dec16(s1.ba));
  float spin = hash12(vec2(sd, 31.0)); // every hit its own pattern, turned its own way
  float sdk = mod(sd, 64.0);
  vec2 p = (uv - P) * vec2(aspect, 1.0);
  float px = 1.0 / RENDERSIZE.y;
  float T = max(time, 0.2);

  // Which piece covers this pixel now : the pieces move along a known way (out
  // from the hit, or down), so the one here came from back along it. Walk back
  // in steps finer than a piece, and keep the first whose own move lands it
  // here (sized to the farthest any piece can have gone).
  vec2 back = after == 2 ? -domeDir(uv, vec2(0.0, -1.0)) : -p / max(length(p), 1e-5);
  float maxD = after == 2 ? 1.25 : after == 1 ? force * (0.02 + 0.04 * (T + 0.5)) + 0.03 : force * 0.075 + 0.02;
  float stepD = maxD / 13.0;
  bool hit = false;
  vec2 hq = p;
  vec2 hn = vec2(0.0);
  float hd = 1e3;
  vec4 hm = vec4(0.0, 0.0, 0.0, 1.0);
  vec2 htl = vec2(0.0);
  float hheal = 0.0;
  for (int k = 0; k < 14; k++) {
    vec2 qk = p + back * stepD * float(k);
    vec2 nA;
    vec3 ca = cellOf(qk, sdk, spin, nA);
    vec2 cc = centerOf(ca.xy, spin);
    vec2 tl;
    float hl;
    vec4 m = pieceMove(ca.xy, cc, t, sdk, P, aspect, tl, hl);
    vec2 q = rot(p - cc - m.xy, -m.z) + cc;
    vec2 nB;
    vec3 cb = cellOf(q, sdk, spin, nB);
    if (abs(cb.x - ca.x) + abs(cb.y - ca.y) < 0.5) {
      hit = true; hq = q; hn = rot(nB, m.z); hd = cb.z; hm = m; htl = tl; hheal = hl;
      break;
    }
  }

  // BEHIND : the gaps show nothing (the layers below), up to the picture in shadow
  vec4 back4 = vec4(live.rgb * 0.3, live.a * behind);
  vec4 o = back4;
  float r0 = length(hq);
  // the cracks only show once the crack front has passed (it races out in a
  // fifth of a second), and fade as a healing pane closes
  float cracked = (1.0 - smoothstep(t * 9.0, t * 9.0 + 0.02, r0)) * (1.0 - (after == 3 ? hheal : 0.0));
  if (hit && hm.w > 0.002) {
    // the piece's own face : tilted, lit from the room, bending what it shows
    vec2 tv = htl * (0.08 + 0.5 * tilt);
    tv *= min(1.0, 1.4 / max(length(tv), 1e-4)); // never past edge-on
    vec3 N = normalize(vec3(tv, 1.0));
    // the chamfer : the last few pixels before a crack slope away, outward
    float bw = (1.2 + 5.0 * bevel) * max(1.0, floor(RENDERSIZE.y / 1080.0 + 0.5)) * px;
    float b = (1.0 - smoothstep(0.0, bw, hd)) * cracked * step(0.001, bevel);
    vec2 nOut = -hn;
    N = normalize(N + vec3(nOut * b * 1.4, 0.0));
    vec2 bend = (N.xy * refract * 0.035 + nOut * b * refract * 0.008) / vec2(aspect, 1.0);
    vec2 src = P + hq / vec2(aspect, 1.0) + bend;
    src = 1.0 - abs(1.0 - mod(src, 2.0));
    vec4 c = IMG_NORM_PIXEL(inputImage, src);
    vec3 L = normalize(vec3(cos(light), sin(light), 0.9));
    float diff = clamp(dot(N, L) / L.z, 0.55, 1.2);
    // the room's light reflected : a mirror highlight where a face or an edge
    // turns it to the eye. A mix toward the room's pale light, never added.
    vec3 R = vec3(2.0 * N.z * N.x, 2.0 * N.z * N.y, 2.0 * N.z * N.z - 1.0);
    float sp = max(dot(R, L), 0.0);
    sp *= sp; sp *= sp; sp *= sp; sp *= sp; sp *= sp; sp *= sp; // ^64 : a mirror's tight highlight
    float lit = sp * (0.25 + 0.6 * max(bevel, b)) * (0.3 + 0.7 * max(b, length(htl) * tilt));
    vec3 col = c.rgb * diff * (1.0 - 0.18 * b);
    col = mix(col, vec3(0.9, 0.92, 0.95), clamp(lit, 0.0, 0.6));
    // edge coverage : a hair of crack between neighbors, smooth (no stair steps)
    float cov = mix(1.0, smoothstep(0.15 * px, 1.1 * px, hd), cracked);
    float sa = c.a * hm.w * cov;
    float oa = sa + back4.a * (1.0 - sa);
    o = vec4((clamp(col, 0.0, 1.0) * sa + back4.rgb * back4.a * (1.0 - sa)) / max(oa, 1e-5), oa);
  }
  // the pane whole again (drift and fall, after TIME)
  float whole = after == 3 ? 0.0 : hheal;
  if (!hit) whole = after == 1 || after == 2 ? smoothstep(after == 2 ? T * 1.15 : T, (after == 2 ? T * 1.15 : T) + 0.5, t) : 0.0;
  o = mix(o, live, whole);
  gl_FragColor = mix(live, o, amount);
}
