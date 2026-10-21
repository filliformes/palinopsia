/*{
  "DESCRIPTION": "Cloud Study : a ray-traced cloudscape painted in thick oil. A volume of billowing cloud is marched through and lit by a low sun (soft self-shadows, a silver lining toward the light), then repainted in strokes : each stroke laid along the forms, carrying the color under it, mixed down to a painter's palette and raised into ridges of paint that catch the light, over a canvas weave where the paint runs thin. COVERAGE, SCALE and DETAIL shape the cloud, DRIFT and EVOLVE move it (wind, churning), HORIZON tilts the view from a wall of cloud to a cloud deck running to the horizon, SUN and SUN HEIGHT place the light, GLOW is the silver lining, SHADOW the cloud's own shade. BRUSH, MIX, IMPASTO and CANVAS are the painting. AUDIO swells the billows with the bass.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Painterly"],
  "INPUTS": [
    { "NAME": "coverage", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55, "LABEL": "coverage" },
    { "NAME": "scale", "TYPE": "float", "MIN": 0.3, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "scale" },
    { "NAME": "detail", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55, "LABEL": "detail" },
    { "NAME": "drift", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.12, "LABEL": "drift" },
    { "NAME": "evolve", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "evolve" },
    { "NAME": "horizon", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.65, "LABEL": "horizon" },
    { "NAME": "sun", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "sun" },
    { "NAME": "sunHeight", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "sun height" },
    { "NAME": "glow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "glow" },
    { "NAME": "shadow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.65, "LABEL": "shadow" },
    { "NAME": "brush", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55, "LABEL": "brush" },
    { "NAME": "mixing", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.45, "LABEL": "mix" },
    { "NAME": "impasto", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55, "LABEL": "impasto" },
    { "NAME": "canvas", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "canvas" },
    { "NAME": "audio", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio" },
    { "NAME": "sky", "TYPE": "color", "DEFAULT": [0.3, 0.42, 0.62, 1.0], "LABEL": "sky" },
    { "NAME": "light", "TYPE": "color", "DEFAULT": [1.0, 0.88, 0.7, 1.0], "LABEL": "light" },
    { "NAME": "shade", "TYPE": "color", "DEFAULT": [0.42, 0.38, 0.5, 1.0], "LABEL": "shade" },
    { "NAME": "audioTex", "TYPE": "image" }
  ],
  "PASSES": [
    { "TARGET": "cloud", "WIDTH": "floor($WIDTH / 2.0)", "HEIGHT": "floor($HEIGHT / 2.0)" },
    {}
  ]
}*/

// The wind and the churn run on integrated clocks (no jump when they move),
// wrapped where the noise repeats (256 noise cells : drift moves 0.5 a second,
// evolve 0.3), so a show of days never loses precision nor jumps. Each octave
// takes the wind times a whole number (1, 2, 4, 8 : density()), so the wrap's
// 256 stays a whole number of periods in every one of them.
uniform float PH_drift; // wrap 512
uniform float PH_evolve; // wrap 853.3333
// Under full-dome fill the view is kept square (the dome stretches the frame's
// width and height over one circle), else 0 (engine/domeSignal.ts).
uniform float DOME_FILL;

const float PI = 3.14159265;

// Hash without Sine (THIRD_PARTY_NOTICES), on cells already wrapped at 256 (vnoise3).
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// The cell wrapped once and its far corner wrapped on from it (exact on whole
// numbers) : the same values as wrapping each of the 8 corners, for 2 wraps.
float vnoise3(vec3 p) {
  vec3 i = mod(floor(p), 256.0);
  vec3 j = mod(i + 1.0, 256.0);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(vec3(j.x, i.y, i.z));
  float c = hash13(vec3(i.x, j.y, i.z)), d = hash13(vec3(j.x, j.y, i.z));
  float e = hash13(vec3(i.x, i.y, j.z)), g = hash13(vec3(j.x, i.y, j.z));
  float h = hash13(vec3(i.x, j.y, j.z)), k = hash13(j);
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

// The shared spectrum (row 1, log-spaced : 0 = bass), 0..1.
float spec(float x) {
  vec2 ac = vec2(clamp(x, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

// The cloud's density at q (noise space). Billows from the first octaves,
// DETAIL erodes their edges with the finer ones; COVER sets how much of the
// noise is cloud. The slab gives flat bases and tops thinning to rounded crowns.
// The wind rides each octave outside its 2.03 scaling, doubled per octave : a
// whole number of times the wrap's 256 cells (scaled by 2.03, the finer billows
// re-dealt in one frame when the clocks wrapped).
float density(vec3 q, vec3 wind, float slabY, float cover, int octaves) {
  float s = 0.0;
  float wsum = 0.0;
  float a = 0.55;
  vec3 p = q;
  vec3 wo = wind;
  for (int o = 0; o < 4; o++) {
    if (o >= octaves) break;
    float w = o < 2 ? a : a * (0.3 + detail * 1.5);
    s += w * vnoise3(p + wo);
    wsum += w;
    p = p * 2.03 + vec3(17.1, 9.2, 3.7);
    wo *= 2.0;
    a *= 0.5;
  }
  s /= wsum; // about 0.5, give or take 0.12
  float thr = 0.58 + (0.5 - cover) * 0.6 + slabY * 0.14; // a ray crosses much noise : above its middle
  float prof = smoothstep(0.0, 0.06, slabY) * (1.0 - smoothstep(0.6, 1.0, slabY));
  return clamp((s - thr) * 7.0 * prof, 0.0, 1.0);
}

vec4 cloudPass(vec2 uv) {
  float aspect = DOME_FILL > 0.0 ? 1.0 : RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  // HORIZON : from looking up into a wall of cloud to a deck running to the horizon
  float pitch = mix(0.8, 0.0, horizon);
  vec3 d = normalize(vec3(p.x, p.y, -1.25));
  float cp = cos(pitch), sp = sin(pitch);
  d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
  // the sun : SUN turns it round, SUN HEIGHT raises it
  float sa = sun * PI;
  float se = mix(0.03, 1.3, sunHeight);
  vec3 L = normalize(vec3(sin(sa) * cos(se), sin(se), -cos(sa) * cos(se)));
  float mu = dot(d, L);

  // the sky : deeper overhead, paler and warmer at the horizon and round the sun
  vec3 skyCol = mix(sky.rgb * 1.4 + light.rgb * 0.1, sky.rgb * 0.75, clamp(d.y * 1.6, 0.0, 1.0));
  skyCol += light.rgb * (0.15 * pow(max(mu, 0.0), 5.0) + 0.7 * pow(max(mu, 0.0), 220.0));
  // below the horizon : the land, in the cloud's shade
  if (d.y <= 0.004) return vec4(mix(skyCol, shade.rgb * 0.45, clamp(0.35 - d.y * 14.0, 0.0, 1.0)), 0.0);

  // the slab of cloud : between heights 1 and 3.5 above the eye
  float yb = 1.0, yt = 3.5;
  float t0 = yb / d.y;
  float t1 = min(yt / d.y, 34.0);
  if (t1 <= t0) return vec4(skyCol, 0.0);

  float sc = 0.42 * scale;
  vec3 wind = vec3(PH_drift * 0.5, 0.0, PH_evolve * 0.3);
  float cover = clamp(coverage + audio * spec(0.05) * 0.35, 0.0, 1.0);
  const int STEPS = 30;
  float dt = (t1 - t0) / float(STEPS);
  // a jittered start : the march's banding turns into grain, which the brush takes up
  float t = t0 + dt * hash12(uv * RENDERSIZE + 3.1);
  vec3 col = vec3(0.0);
  float T = 1.0;
  float silver = glow * 2.4 * pow(max(mu, 0.0), 6.0);
  for (int i = 0; i < STEPS; i++) {
    if (t > t1) break;
    vec3 pos = d * t;
    float sy = (pos.y - yb) / (yt - yb);
    vec3 q = pos * sc;
    float den = density(q, wind, sy, cover, 4);
    if (den > 0.004) {
      // the light reaching here : one look toward the sun through the cloud
      float denL = density(q + L * 0.3, wind, sy + L.y * 0.3 / (sc * (yt - yb)), cover, 2);
      // (and the light scattered on inside it : the thick core still glows,
      // never a dark hole ringed by its lit edge)
      float lit = max(exp(-shadow * 4.5 * denL), 0.4 * exp(-shadow * 1.1 * denL));
      // the shaded side : the shade color, a little of the sky's toward the tops
      // (not more : the sun's yellow over the sky's blue mixes to mud)
      vec3 amb = mix(shade.rgb * 0.72, shade.rgb * 0.85 + sky.rgb * 0.2, sy);
      vec3 c = mix(amb, light.rgb * (1.05 + silver * (1.0 - den)), lit);
      c = mix(c, skyCol, clamp(t / 34.0, 0.0, 1.0) * 0.7); // the far cloud hazes into the sky
      float a = 1.0 - exp(-den * dt * 4.0);
      col += T * a * c;
      T *= 1.0 - a;
      if (T < 0.03) break;
      t += dt;
    } else {
      t += dt * 1.5; // open sky : longer strides
    }
  }
  // a soft shoulder over the brightest light : the sun side keeps its color
  // instead of burning out to flat white
  col += T * skyCol;
  vec3 over = max(col - 0.8, 0.0);
  col = min(col, 0.8) + over / (1.0 + over * 4.0);
  // alpha : how much cloud there is (where the paint lies thick)
  return vec4(col, 1.0 - T);
}

vec4 cloudAt(vec2 uv) {
  vec2 cuv = clamp(uv, vec2(0.0), vec2(1.0)); // IMG_NORM_PIXEL wants a plain variable
  return IMG_NORM_PIXEL(cloud, cuv);
}
float lumaOf(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// The forms' direction at uv, in frame-height space : along the contours (across
// the slope of the light), the slope read r apart (in uv). Long gentle sweeps
// where the picture is flat (the open sky).
vec2 flowAt(vec2 uv, float aspect, vec2 r) {
  float lx = lumaOf(cloudAt(uv + vec2(r.x, 0.0)).rgb) - lumaOf(cloudAt(uv - vec2(r.x, 0.0)).rgb);
  float ly = lumaOf(cloudAt(uv + vec2(0.0, r.y)).rgb) - lumaOf(cloudAt(uv - vec2(0.0, r.y)).rgb);
  vec2 g = vec2(lx / (r.x * aspect), ly / r.y);
  vec2 flatDir = normalize(vec2(1.0, 0.3 * sin(uv.y * 7.0 + uv.x * 4.0)));
  float m = length(g);
  if (m < 1e-4) return flatDir;
  vec2 along = vec2(-g.y, g.x) / m;
  if (dot(along, flatDir) < 0.0) along = -along; // no flips : strokes keep one sense
  return normalize(mix(flatDir, along, smoothstep(0.05, 0.6, m)));
}

// MIX : a color mixed down to the painter's palette, in soft steps (a few
// tones at 0 : the palette knife; many at 1 : blended). Strokes take it whole,
// so the steps fall between strokes, not as contour lines across them.
vec3 palette(vec3 c, float levels) {
  float L0 = max(lumaOf(c), 1e-4);
  float Lq = (floor(L0 * levels) + smoothstep(0.3, 0.7, fract(L0 * levels))) / levels;
  return c * mix(1.0, Lq / L0, 0.85);
}

// A stroke's paint height at r (0 at its rim, 1 at its spine) : a soft rise
// from the rim to its body (no ring : a ring drew every stroke outlined).
float strokeHeight(float r) {
  return smoothstep(0.0, 0.45, r);
}

vec4 paintPass(vec2 uv) {
  // the strokes in frame-height space (square on the dome, as the view is)
  float aspect = DOME_FILL > 0.0 ? 1.0 : RENDERSIZE.x / RENDERSIZE.y;
  vec2 pp = vec2(uv.x * aspect, uv.y); // frame-height space
  // the cloud a little softened (the march's grain, taken up by the paint)
  vec2 ct = 1.0 / max(RENDERSIZE * 0.5, vec2(1.0));
  vec4 base = 0.25 * (cloudAt(uv + ct * vec2(0.6, 0.6)) + cloudAt(uv + ct * vec2(-0.6, 0.6))
    + cloudAt(uv + ct * vec2(0.6, -0.6)) + cloudAt(uv + ct * vec2(-0.6, -0.6)));
  vec3 c = base.rgb;
  float levels = mix(3.0, 14.0, mixing);
  float thin = 1.0;  // how thin the paint is (the canvas shows)
  vec2 slope = vec2(0.0);
  float gloss = 0.0;

  // BRUSH : a field of strokes, each laid along the forms, carrying the color
  // under its middle; the one on top wins. At 0 : the cloud as rendered.
  if (brush > 0.001) {
    float cell = mix(0.005, 0.034, brush);
    vec2 dir = flowAt(uv, aspect, vec2(cell * 0.5 / aspect, cell * 0.5));
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 gc = floor(pp / cell);
    float top = -1.0;
    vec2 win = vec2(0.0), sl = vec2(0.0), wh = vec2(1.0), wid = vec2(0.0);
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        vec2 id = gc + vec2(float(i), float(j));
        vec2 h = hash22(id);
        vec2 ctr = (id + h) * cell;
        vec2 o = pp - ctr;
        // a stroke : longer than wide, square-ended (x to the fourth)
        vec2 hs = vec2(0.95 + 0.85 * h.x, 0.3 + 0.18 * h.y); // half length, half width (cells)
        vec2 lo = vec2(dot(o, dir), dot(o, nrm)) / cell / hs;
        float e = lo.x * lo.x * lo.x * lo.x + lo.y * lo.y;
        float z = hash12(id * 1.37 + 2.1);
        if (e < 1.0 && z > top) {
          // dry brush : toward its tail the stroke runs out of paint, in streaks
          // along the bristles, and the stroke under it shows through
          float dry = smoothstep(0.0, 1.0, lo.x) * 0.8;
          if (dry > 0.0 && vnoise2(vec2(lo.x * 1.6, lo.y * 4.5 + z * 40.0)) < dry) continue;
          top = z;
          win = ctr;
          sl = lo;
          wh = hs;
          wid = id;
        }
      }
    }
    if (top >= 0.0) {
      // the stroke's color : what is under its middle, a little off (no two
      // loads of the brush alike), pulled toward the color under it (wet in wet)
      vec3 dc = palette(cloudAt(vec2(win.x / aspect, win.y)).rgb, levels);
      vec2 hv = hash22(wid + 11.3);
      dc *= 0.93 + 0.14 * hv.x;
      dc += (hv.y - 0.5) * 0.04 * vec3(1.0, 0.2, -0.8);
      // and dragged along its length : the tail runs out of paint into the next
      float drag = smoothstep(-0.2, 1.0, sl.x) * 0.35;
      c = mix(dc, base.rgb, clamp(mixing * 0.45 + drag * (1.0 - mixing), 0.0, 1.0));
      // its relief : the rim's ridge and the bristles' grooves along it
      float e = sl.x * sl.x * sl.x * sl.x + sl.y * sl.y;
      float r = 1.0 - e;
      float dr = (strokeHeight(r + 0.02) - strokeHeight(r)) / 0.02;
      vec2 ge = vec2(4.0 * sl.x * sl.x * sl.x / wh.x, 2.0 * sl.y / wh.y); // e's slope, per cell
      vec2 gpp = (ge.x * dir + ge.y * nrm) / max(length(ge), 1e-4);
      // the paint lies thicker in the cloud than in the thin sky
      float body = mix(0.55, 1.0, base.a);
      slope -= gpp * dr * 0.12 * body;
      float bw = sl.y * 3.5 + top * 50.0;
      float b0 = vnoise2(vec2(sl.x * 1.2 + top * 7.0, bw));
      float b1 = vnoise2(vec2(sl.x * 1.2 + top * 7.0, bw + 0.2));
      slope += nrm * (b1 - b0) * 0.8 * body;
      gloss = smoothstep(0.1, 0.5, r) * body; // the body of the paint, not its thin rim
      thin = 1.0 - smoothstep(0.0, 0.2, r);
    } else {
      c = palette(base.rgb, levels); // between strokes : the ground, thinly
    }
  } else {
    c = palette(c, levels);
  }
  c = mix(vec3(lumaOf(c)), c, 1.12); // oil's depth of color

  // CANVAS : the weave (threads over and under, a checker of crossings), under
  // the thin paint, and all over the picture at 1
  vec2 wv = pp * RENDERSIZE.y / 4.0;
  vec2 wf = fract(wv);
  float over = mod(floor(wv.x) + floor(wv.y), 2.0);
  vec2 thread = over > 0.5 ? vec2(0.0, cos(wf.y * PI)) : vec2(cos(wf.x * PI), 0.0);
  float cv = canvas * mix(0.3, 1.0, thin);
  slope += thread * cv * 0.6;

  // IMPASTO : the relief lit from the upper left, glints on the crests
  vec3 n = normalize(vec3(-slope * mix(0.25, 1.6, impasto), 1.0));
  vec3 Ld = normalize(vec3(-0.5, 0.6, 0.65));
  float diff = clamp(dot(n, Ld), 0.0, 1.0);
  float lambert0 = 0.65 / length(vec3(-0.5, 0.6, 0.65));
  float shadeK = clamp(impasto + cv * 0.6, 0.0, 1.0);
  vec3 outc = c * mix(1.0, 0.55 + 0.45 * diff / lambert0, shadeK);
  float glint = pow(clamp(dot(reflect(-Ld, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 18.0);
  outc += glint * impasto * 0.3 * gloss * (0.5 + 0.5 * lumaOf(c));
  return vec4(max(outc, 0.0), 1.0);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) gl_FragColor = cloudPass(uv);
  else gl_FragColor = paintPass(uv);
}
