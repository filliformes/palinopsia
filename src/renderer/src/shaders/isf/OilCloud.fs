/*{
  "DESCRIPTION": "Oil Cloud : one billowing mass of cloud, ray-traced and painted in oil. A volume of turbulent puffs and folds is marched through and lit in two temperatures, the faces toward the light in warm gold, the folds turning away into cool blue, the crests catching white, then repainted in strokes laid along its forms, its palette mixed down and its paint raised so the ridges catch the light. GROW swells the puffs out from the core, DENSITY takes it from wisps of smoke to solid paint, DENSITY 2 breaks the big puffs into small ones, ROTATION spins it, ZOOM brings it close, LIGHT turns the light around it. EVOLVE churns the billows, SWIRL folds them like stirred paint. BRUSH, MIX and IMPASTO are the painting. AUDIO swells it with the bass. GROUND is what lies around it (transparent : the layers below).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Painterly"],
  "INPUTS": [
    { "NAME": "grow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55, "LABEL": "grow" },
    { "NAME": "density", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.65, "LABEL": "density" },
    { "NAME": "density2", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "density 2" },
    { "NAME": "rotation", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.12, "LABEL": "rotation" },
    { "NAME": "zoom", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "zoom" },
    { "NAME": "light", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "light" },
    { "NAME": "evolve", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "evolve" },
    { "NAME": "swirl", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "swirl" },
    { "NAME": "brush", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "brush" },
    { "NAME": "mixing", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "mix" },
    { "NAME": "impasto", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "impasto" },
    { "NAME": "audio", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio" },
    { "NAME": "lit", "TYPE": "color", "DEFAULT": [1.0, 0.78, 0.3, 1.0], "LABEL": "lit" },
    { "NAME": "warm", "TYPE": "color", "DEFAULT": [0.75, 0.3, 0.07, 1.0], "LABEL": "warm" },
    { "NAME": "cool", "TYPE": "color", "DEFAULT": [0.1, 0.3, 0.95, 1.0], "LABEL": "cool" },
    { "NAME": "ground", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0], "LABEL": "ground" },
    { "NAME": "audioTex", "TYPE": "image" }
  ],
  "PASSES": [
    { "TARGET": "cloud", "WIDTH": "floor(max((w = $WIDTH) * 0.5, min(w * min($DOME_FILL * 1000, 1), 2100)))", "HEIGHT": "floor(max((h = $HEIGHT) * 0.5, min(h * min($DOME_FILL * 1000, 1), 2100)))" },
    {}
  ]
}*/

// The spin and the churn run on integrated clocks (no jump when they move) :
// the spin wraps at a turn, the churn where the noise repeats (256 cells; each
// octave moves along a whole-cell direction, so the wrap is seamless).
uniform float PH_rotation; // wrap 6.2831853
uniform float PH_evolve; // wrap 256
// Under full-dome fill the view is kept square (the dome stretches the frame's
// width and height over one circle), else 0 (engine/domeSignal.ts). There the
// cloud is traced at full size up to 2100 pixels a side, never under half size
// (the PASSES above) : the dome enlarges a 1080p frame's height about twice, and
// a half-size trace went soft. Flat, half size : the strokes are drawn full size.
// Each size caps its OWN side : the runtime replaces only the first $WIDTH /
// $HEIGHT of an expression, so the side is named once and kept in a variable
// (w = $WIDTH) for its second use (capped by the other side, a wide frame was
// traced nearly full width and cut to about half height).
uniform float DOME_FILL;

const float PI = 3.14159265;
const float R0 = 0.6; // the core's radius

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

// Set once per pixel (cloudPass), read by every look into the field : how far
// the puffs reach (GROW, swelled by the bass), the spin's turn.
float gReach;
float gCa;
float gSa;

// A turn of the octaves' axes between them (hides the noise's grid).
const mat3 M3 = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

// The cloud as a field : positive inside, its surface at 0. The core, plus
// turbulence : |noise| is round on its crests and folds sharply at its zeros,
// so the puffs bulge and the creases between them cut deep. SWIRL twists the
// space first, like stirred paint; DENSITY 2 weighs the small puffs. Clearly
// outside after the first two octaves, it answers with the most the rest could
// add (still outside) : the march strides on without the fine ones. And once
// the march only gathers how much cloud it meets (solidK > 0 : the light's
// point found), deep inside it answers with the least the rest could add when
// that is already solid (f * K >= 1) : the same density, without the fine ones.
float field(vec3 p, int octaves, float solidK) {
  // the cloud's own frame : the spin, then a slight tilt
  p = vec3(gCa * p.x + gSa * p.z, p.y, -gSa * p.x + gCa * p.z);
  p = vec3(p.x, p.y * 0.95 - p.z * 0.31, p.y * 0.31 + p.z * 0.95);
  float r = length(p);
  float ev = PH_evolve;
  vec3 q = p * 1.9 + vec3(31.0, 17.0, 5.0);
  // the stir : a push whose direction turns smoothly through the cloud (one
  // look into the noise sets its heading), so the puffs curl every way
  if (swirl > 0.0) {
    float hd = vnoise3(q * 0.45 + vec3(0.0, 0.0, ev)) * 12.566;
    q += vec3(cos(hd), sin(hd) * 0.8, sin(hd * 1.7 + 1.0)) * swirl * 0.7;
  }
  float wAll = 0.55 + 0.275 + (0.1375 + 0.06875) * 1.1;
  float s = 0.0, a = 0.55;
  for (int o = 0; o < 4; o++) {
    if (o >= octaves) break;
    if (o == 2) {
      float most = (R0 - r) + gReach * ((s + (0.1375 + 0.06875) * density2 * 2.2) / wAll - 0.2);
      if (most < -0.05) return most;
      float least = (R0 - r) + gReach * (s / wAll - 0.2);
      if (solidK > 0.0 && least * solidK >= 1.0) return least;
    }
    vec3 dir = o == 0 ? vec3(1.0, 0.0, 0.0) : o == 1 ? vec3(0.0, -1.0, 0.0) : o == 2 ? vec3(0.0, 0.0, 1.0) : vec3(-1.0, 1.0, 0.0);
    float t = abs(2.0 * vnoise3(q + dir * ev) - 1.0);
    s += (o < 2 ? a : a * density2 * 2.2) * t;
    q = M3 * q * 2.03;
    a *= 0.5;
  }
  float wsum = octaves >= 4 ? wAll : octaves == 3 ? 0.55 + 0.275 + 0.1375 * 1.1 : octaves == 2 ? 0.825 : 0.55;
  return (R0 - r) + gReach * (s / wsum - 0.2);
}

// The two temperatures of the light : cool in the shade, warm at the turn,
// gold toward the light, white on the crests.
vec3 ramp(float x) {
  vec3 c = mix(cool.rgb * 0.22, cool.rgb, smoothstep(0.0, 0.38, x));
  c = mix(c, warm.rgb, smoothstep(0.36, 0.56, x));
  c = mix(c, lit.rgb, smoothstep(0.54, 0.8, x));
  return mix(c, mix(lit.rgb, vec3(1.0), 0.65), smoothstep(0.9, 1.0, x));
}

vec4 cloudPass(vec2 uv) {
  float aspect = DOME_FILL > 0.0 ? 1.0 : RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec3 ro = vec3(0.0, 0.0, mix(5.0, 1.7, zoom));
  vec3 rd = normalize(vec3(p, -1.6));
  // LIGHT turns round the cloud (0 : from the front, above)
  float la = light * PI;
  vec3 L = normalize(vec3(-sin(la), 0.55, cos(la)));
  // and a cool light from behind, opposite : the shaded side's own sheen
  vec3 Lb = normalize(vec3(sin(la), -0.25, -cos(la)));
  gReach = mix(0.25, 0.95, grow) * (1.0 + audio * spec(0.05) * 0.45);
  gCa = cos(PH_rotation);
  gSa = sin(PH_rotation);
  float Rb = R0 + gReach * 0.82 + 0.05; // nothing reaches past here
  float b = dot(ro, rd);
  float h = b * b - (dot(ro, ro) - Rb * Rb);
  if (h <= 0.0) return vec4(0.0);
  h = sqrt(h);
  float t = max(-b - h, 0.0);
  float t1 = -b + h;
  float K = mix(2.5, 16.0, density);      // how sharply the cloud turns solid
  float absorb = mix(7.0, 42.0, density); // and how quickly it hides what is behind
  t += 0.02 * hash12(uv * RENDERSIZE + 7.3);
  // The march only gathers how much cloud the ray meets; the light is read
  // once, where the ray is half hidden (its skin, for a solid cloud; the
  // densest place it met, for smoke).
  float T = 1.0;
  vec3 skin = vec3(0.0);
  float skinF = 0.0;
  bool found = false;
  float best = 0.0;
  for (int i = 0; i < 72; i++) {
    if (t > t1 || T < 0.03) break;
    vec3 pos = ro + rd * t;
    float f = field(pos, 4, found ? K : 0.0);
    if (f > 0.0) {
      if (!found && f > best) {
        best = f;
        skin = pos;
        skinF = f;
      }
      float den = clamp(f * K, 0.0, 1.0);
      float dt = 0.024;
      T *= exp(-den * dt * absorb);
      if (!found && T < 0.5) {
        found = true;
        skin = pos;
        skinF = f;
      }
      t += dt;
    } else {
      t += max(0.018, -f * 0.42); // outside : a stride as long as it is safe
    }
  }
  float alpha = 1.0 - T;
  if (alpha < 0.003) return vec4(0.0);
  // lit or turned away : the field's slope toward the light (one look)
  float e = 0.07;
  float fl = field(skin + L * e, 4, 0.0);
  float x = clamp(0.46 + (skinF - fl) / e * 0.26, 0.0, 1.0);
  // its own shade : more cloud between here and the light
  float fs = field(skin + L * 0.32, 2, 0.0);
  x *= mix(1.0, 0.42, smoothstep(0.0, 0.12, fs));
  // the folds sit deep in the shade : more cloud straight out from here (a
  // crease between two puffs), and nearer the core
  float occ = smoothstep(R0 * 0.4, Rb * 0.85, length(skin));
  float crease = smoothstep(-0.02, 0.16, field(skin + normalize(skin) * 0.22, 2, 0.0));
  float ao = (1.0 - crease) * 0.75 + occ * 0.25;
  vec3 c = ramp(x) * mix(0.2, 1.08, ao);
  // the back light : open toward it (little cloud that way), the shade turns
  // cyan and pale on its edges
  float back = 1.0 - smoothstep(0.0, 0.1, field(skin + Lb * 0.3, 2, 0.0));
  c += mix(cool.rgb, vec3(1.0), 0.55) * back * (1.0 - x) * 0.55 * ao;
  return vec4(c * alpha, alpha); // premultiplied
}

vec4 cloudAt(vec2 uv) {
  vec2 cuv = clamp(uv, vec2(0.0), vec2(1.0)); // IMG_NORM_PIXEL wants a plain variable
  return IMG_NORM_PIXEL(cloud, cuv);
}
float lumaOf(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// The forms' direction at uv, in frame-height space : along the contours (across
// the slope of the light), the slope read r apart (in uv).
vec2 flowAt(vec2 uv, float aspect, vec2 r) {
  float lx = lumaOf(cloudAt(uv + vec2(r.x, 0.0)).rgb) - lumaOf(cloudAt(uv - vec2(r.x, 0.0)).rgb);
  float ly = lumaOf(cloudAt(uv + vec2(0.0, r.y)).rgb) - lumaOf(cloudAt(uv - vec2(0.0, r.y)).rgb);
  vec2 g = vec2(lx / (r.x * aspect), ly / r.y);
  vec2 flatDir = normalize(vec2(1.0, 0.4 * sin(uv.y * 9.0 + uv.x * 5.0)));
  float m = length(g);
  if (m < 1e-4) return flatDir;
  vec2 along = vec2(-g.y, g.x) / m;
  if (dot(along, flatDir) < 0.0) along = -along; // no flips : strokes keep one sense
  return normalize(mix(flatDir, along, smoothstep(0.05, 0.6, m)));
}

// MIX : a color mixed down to the painter's palette, in soft steps (a few
// tones at 0 : the palette knife; many at 1 : blended). Strokes take it whole.
vec3 palette(vec3 c, float levels) {
  float L0 = max(lumaOf(c), 1e-4);
  float Lq = (floor(L0 * levels) + smoothstep(0.3, 0.7, fract(L0 * levels))) / levels;
  return c * mix(1.0, Lq / L0, 0.85);
}

// A stroke's paint height at r (0 at its rim, 1 at its spine) : a soft rise.
float strokeHeight(float r) {
  return smoothstep(0.0, 0.45, r);
}

vec4 paintPass(vec2 uv) {
  // the strokes in frame-height space (square on the dome, as the view is)
  float aspect = DOME_FILL > 0.0 ? 1.0 : RENDERSIZE.x / RENDERSIZE.y;
  vec2 pp = vec2(uv.x * aspect, uv.y);
  // the cloud a little softened (the march's grain, taken up by the paint)
  vec2 ct = 1.0 / max(IMG_SIZE(cloud), vec2(1.0));
  vec4 base = 0.25 * (cloudAt(uv + ct * vec2(0.6, 0.6)) + cloudAt(uv + ct * vec2(-0.6, 0.6))
    + cloudAt(uv + ct * vec2(0.6, -0.6)) + cloudAt(uv + ct * vec2(-0.6, -0.6)));
  float levels = mix(3.0, 14.0, mixing);
  vec4 c = base; // premultiplied
  vec2 slope = vec2(0.0);
  float gloss = 0.0;

  // BRUSH : a field of strokes, each laid along the forms, carrying the color
  // under its middle; the one on top wins. Strokes that start on the cloud run
  // past its edge, so its silhouette is painted too. At 0 : the cloud as traced.
  if (brush > 0.001) {
    float cell = mix(0.004, 0.03, brush);
    vec2 dir = flowAt(uv, aspect, vec2(cell * 0.5 / aspect, cell * 0.5));
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 gc = floor(pp / cell);
    float top = -1.0;
    vec2 win = vec2(0.0), sl = vec2(0.0), wh = vec2(1.0), wid = vec2(0.0);
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        vec2 id = gc + vec2(float(i), float(j));
        vec2 hc = hash22(id);
        vec2 ctr = (id + hc) * cell;
        vec2 o = pp - ctr;
        vec2 hs = vec2(0.95 + 0.85 * hc.x, 0.3 + 0.18 * hc.y); // half length, half width (cells)
        vec2 lo = vec2(dot(o, dir), dot(o, nrm)) / cell / hs;
        float e = lo.x * lo.x * lo.x * lo.x + lo.y * lo.y;
        float z = hash12(id * 1.37 + 2.1);
        if (e < 1.0 && z > top) {
          // dry brush : toward its tail the stroke runs out of paint in streaks
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
      // the stroke's load : the color under its middle, on the palette, a little
      // off (no two loads alike), pulled toward the paint under it (wet in wet)
      vec4 dc = cloudAt(vec2(win.x / aspect, win.y));
      vec2 hv = hash22(wid + 11.3);
      vec3 load = palette(dc.rgb / max(dc.a, 1e-3), levels) * (0.93 + 0.14 * hv.x);
      load += (hv.y - 0.5) * 0.05 * vec3(1.0, 0.2, -0.8);
      vec4 sc = vec4(max(load, 0.0) * dc.a, dc.a);
      float drag = smoothstep(-0.2, 1.0, sl.x) * 0.35;
      c = mix(sc, base, clamp(mixing * 0.4 + drag * (1.0 - mixing), 0.0, 1.0));
      // its relief : a soft rise from the rim, the bristles' grooves along it
      float e = sl.x * sl.x * sl.x * sl.x + sl.y * sl.y;
      float r = 1.0 - e;
      float dr = (strokeHeight(r + 0.02) - strokeHeight(r)) / 0.02;
      vec2 ge = vec2(4.0 * sl.x * sl.x * sl.x / wh.x, 2.0 * sl.y / wh.y);
      vec2 gpp = (ge.x * dir + ge.y * nrm) / max(length(ge), 1e-4);
      float body = dc.a;
      slope -= gpp * dr * 0.14 * body;
      float bw = sl.y * 3.5 + top * 50.0;
      float b0 = vnoise2(vec2(sl.x * 1.2 + top * 7.0, bw));
      float b1 = vnoise2(vec2(sl.x * 1.2 + top * 7.0, bw + 0.2));
      slope += nrm * (b1 - b0) * 0.9 * body;
      gloss = smoothstep(0.1, 0.5, r) * body;
    } else {
      c = vec4(palette(base.rgb / max(base.a, 1e-3), levels) * base.a, base.a);
    }
  } else {
    c = vec4(palette(base.rgb / max(base.a, 1e-3), levels) * base.a, base.a);
  }
  c.rgb = max(mix(vec3(lumaOf(c.rgb)), c.rgb, 1.15), 0.0); // oil's depth of color

  // IMPASTO : the relief lit from the upper left, glints on the crests
  vec3 n = normalize(vec3(-slope * mix(0.25, 1.6, impasto), 1.0));
  vec3 Ld = normalize(vec3(-0.5, 0.6, 0.65));
  float lambert0 = 0.65 / length(vec3(-0.5, 0.6, 0.65));
  float diff = clamp(dot(n, Ld), 0.0, 1.0);
  vec3 rgb = c.rgb * mix(1.0, 0.55 + 0.45 * diff / lambert0, impasto);
  float glint = pow(clamp(dot(reflect(-Ld, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 18.0);
  rgb += glint * impasto * 0.3 * gloss;

  // over the GROUND (straight alpha out : a transparent ground lets the layers
  // below through, with no dark fringe round the cloud)
  float ga = ground.a * (1.0 - c.a);
  float aOut = c.a + ga;
  vec3 outc = (rgb + ground.rgb * ga) / max(aOut, 1e-4);
  return vec4(outc, aOut);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) gl_FragColor = cloudPass(uv);
  else gl_FragColor = paintPass(uv);
}
