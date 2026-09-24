/*{
  "DESCRIPTION": "Colony : living matter that GROWS across a surface. Colonies start from seeds and spread cell by cell with the rough, wandering front measured on real growth (burning paper, bacterial colonies : the Kardar-Parisi-Zhang roughness), slowed by poor ground and stopping short of each other where two meet. KIND picks the matter : LICHEN on granite (grey-green, orange and pale crusts cracking into areolae as they age, a black rim where colonies meet), MOULD on agar (a white growing margin, a green sporulating centre, daily rings), BURNING PAPER (a dim ember front, scorch ahead of it, char and ash behind), RUST on steel (spreading from scratches : orange, then red-brown, pitted and flaking; PALETTE toward copper turns it to verdigris). Lit as a relief under one low raking light. REGROW ▸ starts again; REGROW EVERY cycles on its own.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "kind",       "TYPE": "long",  "VALUES": [0, 1, 2, 3], "LABELS": ["lichen", "mould", "burning paper", "rust"], "DEFAULT": 0 },
    { "NAME": "growth",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.35, "LABEL": "growth" },
    { "NAME": "colonies",   "TYPE": "float", "MIN": 0.05, "MAX": 1.0,   "DEFAULT": 0.4,  "LABEL": "colonies" },
    { "NAME": "grain",      "TYPE": "float", "MIN": 120.0,"MAX": 720.0, "DEFAULT": 360.0,"LABEL": "grain" },
    { "NAME": "bare",       "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.45, "LABEL": "bare ground" },
    { "NAME": "maturing",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.5,  "LABEL": "maturing" },
    { "NAME": "palette",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.0,  "LABEL": "palette" },
    { "NAME": "relief",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.55, "LABEL": "relief" },
    { "NAME": "lightAngle", "TYPE": "float", "MIN": 0.0,  "MAX": 6.2832,"DEFAULT": 2.36, "LABEL": "light angle" },
    { "NAME": "cycle",      "TYPE": "float", "MIN": 0.0,  "MAX": 180.0, "DEFAULT": 0.0,  "LABEL": "regrow every (s)" },
    { "NAME": "regrow",     "TYPE": "event", "LABEL": "regrow ▸" }
  ],
  "PASSES": [
    { "TARGET": "latch", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { "TARGET": "state", "PERSISTENT": true, "WIDTH": "floor($WIDTH / $HEIGHT * $grain)", "HEIGHT": "floor($grain)" },
    { }
  ]
}*/

// The growth runs on its own grid, GRAIN cells tall whatever the output size, so
// a colony keeps its look from 1080p to a 4096² dome. Cell state (8-bit is enough
// for a monotone process) : r = occupied, g = colony id, b = age (dithered up),
// a = the seed it grew from (a new seed in the latch = regrow).

vec2 stateSize() { return vec2(floor(RENDERSIZE.x / RENDERSIZE.y * grain), floor(grain)); }

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}

// Seeds for this regrow : a jittered point per coarse cell (rust : a scratch).
vec2 plant(vec2 c, float sd) {
  float G = kind == 1 ? 95.0 : kind == 2 ? 170.0 : kind == 3 ? 80.0 : 58.0;
  float dens = colonies * (kind == 1 ? 0.5 : kind == 2 ? 0.35 : kind == 3 ? 0.6 : 0.75);
  vec2 gc = floor(c / G);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = gc + vec2(float(i), float(j));
      if (og_hash(g + sd * 71.3) > dens) continue;
      vec2 pt = (g + 0.15 + 0.7 * og_hash2(g + sd * 13.1)) * G;
      float idv = (1.0 + floor(og_hash(g + sd * 5.7) * 250.0)) / 255.0;
      if (kind == 3) {
        float a = og_hash(g + sd * 3.3) * 6.2832;
        vec2 d = vec2(cos(a), sin(a)) * G * (0.15 + 0.3 * og_hash(g + sd * 9.1));
        if (segDist(c, pt - d, pt + d) < 0.9) return vec2(1.0, idv);
      } else if (length(c - pt) < 1.6) {
        return vec2(1.0, kind == 2 ? 1.0 / 255.0 : idv);
      }
    }
  }
  return vec2(0.0);
}

// ── Display ──────────────────────────────────────────────────────────────
float ASP() { return RENDERSIZE.x / RENDERSIZE.y; }
vec2 warpUV(vec2 uv) {
  // Roughen the front below the grid size (a cell is several pixels at 4K).
  vec2 P = uv * vec2(ASP(), 1.0) * grain * 0.42;
  return uv + (vec2(og_vnoise(P), og_vnoise(P + 7.7)) - 0.5) * 1.8 / stateSize();
}
float occAt(vec2 wv) { return smoothstep(0.3, 0.7, IMG_NORM_PIXEL(state, wv).r); }
vec4 cellAt(vec2 wv) {
  vec2 ss = stateSize();
  vec2 cc = (floor(wv * ss) + 0.5) / ss;
  return IMG_NORM_PIXEL(state, cc);
}
float fbm4(vec2 p) { return og_fbm(p, 4.0); }

float og_height(vec2 uv) {
  vec2 P = uv * vec2(ASP(), 1.0);
  vec2 wv = warpUV(uv);
  float occ = occAt(wv);
  float age = cellAt(wv).b;
  if (kind == 0) {
    float stone = 0.22 * og_fbm(P * 18.0, 3.0);
    float mature = smoothstep(0.06, 0.4, age);
    vec3 w = og_worley(P * 55.0 + 0.9 * vec2(og_vnoise(P * 9.0), og_vnoise(P * 9.0 + 3.3)));
    float dome = 1.0 - smoothstep(0.0, 0.6, w.x);
    float crack = smoothstep(0.0, 0.1, w.y - w.x);
    return stone + occ * (0.3 + 0.12 * dome * mature) * mix(1.0, mix(0.45, 1.0, crack), mature);
  }
  if (kind == 1) return occ * (0.32 + 0.1 * og_vnoise(P * 240.0) + 0.18 * og_vnoise(P * 40.0));
  if (kind == 2) return 0.03 * og_vnoise(P * vec2(320.0, 70.0)) + occ * (0.1 + 0.12 * og_vnoise(P * 30.0));
  // rust : a thin crust on steel, flakes lifting at their edges as it ages
  float steel = 0.04 * og_vnoise(P * vec2(600.0, 30.0));
  vec3 fl = og_worley(P * 38.0);
  float flake = (1.0 - smoothstep(0.0, 0.07, fl.y - fl.x)) * smoothstep(0.4, 0.8, age);
  return steel + occ * (0.18 + 0.14 * og_vnoise(P * 80.0) + 0.2 * flake);
}

// Shadows only need the big forms : one texture read instead of the full crust.
float colonyShadowH(vec2 uv) {
  float occ = smoothstep(0.3, 0.7, IMG_NORM_PIXEL(state, uv).r);
  if (kind == 0) return 0.11 + occ * 0.36;
  if (kind == 1) return occ * 0.42;
  if (kind == 2) return 0.015 + occ * 0.16;
  return 0.02 + occ * 0.3;
}
#define OG_SHADOW_HEIGHT colonyShadowH
// @og-relief

vec3 albedo(vec2 uv) {
  vec2 P = uv * vec2(ASP(), 1.0);
  vec2 wv = warpUV(uv);
  float occ = occAt(wv);
  vec4 s = cellAt(wv);
  float age = s.b;
  float idh = og_hash(vec2(s.g * 255.0, 3.1));
  vec2 e = 2.5 / stateSize();
  vec2 q1 = wv + vec2(e.x, 0.0), q2 = wv - vec2(e.x, 0.0), q3 = wv + vec2(0.0, e.y), q4 = wv - vec2(0.0, e.y);
  float nb = 0.25 * (IMG_NORM_PIXEL(state, q1).r + IMG_NORM_PIXEL(state, q2).r + IMG_NORM_PIXEL(state, q3).r + IMG_NORM_PIXEL(state, q4).r);
  float near = clamp(nb - occ, 0.0, 1.0);             // just outside a colony
  if (kind == 0) {
    vec3 stone = mix(vec3(0.47, 0.46, 0.44), vec3(0.52, 0.44, 0.38), palette) * (0.8 + 0.32 * fbm4(P * 40.0));
    stone *= 0.86 + 0.28 * og_worley(P * 150.0).z;
    vec3 sp = idh < 0.55 ? vec3(0.55, 0.6, 0.5) : idh < 0.8 ? vec3(0.8, 0.56, 0.22) : vec3(0.72, 0.74, 0.66);
    sp = mix(sp, sp.gbr * vec3(0.95, 1.0, 0.9), palette * 0.6);
    vec3 wa = og_worley(P * 55.0 + 0.9 * vec2(og_vnoise(P * 9.0), og_vnoise(P * 9.0 + 3.3)));
    float crack = mix(1.0, smoothstep(0.0, 0.1, wa.y - wa.x), smoothstep(0.06, 0.4, age));
    vec3 crust = sp * (0.84 + 0.18 * wa.z) * mix(0.4, 1.0, crack) * mix(1.15, 0.9, smoothstep(0.0, 0.45, age));
    return mix(mix(stone, crust, occ), vec3(0.06, 0.06, 0.055), near * 0.9); // the black rim
  }
  if (kind == 1) {
    vec3 agar = vec3(0.14, 0.13, 0.1) * (0.9 + 0.2 * fbm4(P * 6.0));
    float ring = 0.5 + 0.5 * sin(age * 70.0);        // daily growth rings
    vec3 old = mix(mix(vec3(0.2, 0.42, 0.34), vec3(0.34, 0.38, 0.2), idh), vec3(0.26, 0.32, 0.4), palette);
    vec3 cm = mix(vec3(0.9, 0.9, 0.86), old, smoothstep(0.04, 0.2, age)) * (0.86 + 0.14 * ring);
    return mix(agar, cm, occ);
  }
  if (kind == 2) {
    vec3 paper = mix(vec3(0.86, 0.82, 0.72), vec3(0.62, 0.48, 0.32), palette);
    paper *= (0.93 + 0.1 * og_vnoise(P * vec2(420.0, 90.0))) * (0.96 + 0.06 * fbm4(P * 12.0));
    vec3 scorch = mix(paper, vec3(0.42, 0.27, 0.12), near);
    float ember = occ * (1.0 - smoothstep(0.0, 3.0 / 255.0, age));
    float ash = smoothstep(0.74, 0.82, og_vnoise(P * 55.0 + idh * 10.0)) * (0.5 + 0.5 * og_vnoise(P * 300.0)) * smoothstep(0.2, 0.55, age);
    vec3 charc = vec3(0.07, 0.06, 0.05) + vec3(0.36) * ash;
    return mix(mix(scorch, charc, occ), vec3(0.8, 0.34, 0.08), ember * 0.75);
  }
  // rust (palette → copper and verdigris)
  vec3 metal = mix(vec3(0.5, 0.52, 0.55), vec3(0.72, 0.45, 0.3), palette) * (0.86 + 0.14 * og_vnoise(P * vec2(600.0, 30.0)));
  vec3 young = mix(vec3(0.75, 0.42, 0.16), vec3(0.42, 0.62, 0.52), palette);   // lepidocrocite / fresh verdigris
  vec3 old = mix(vec3(0.42, 0.2, 0.1), vec3(0.25, 0.46, 0.4), palette);        // hematite / old patina
  vec3 rust = mix(young, old, smoothstep(0.1, 0.6, age));
  rust = mix(rust, mix(vec3(0.7, 0.55, 0.2), vec3(0.5, 0.66, 0.55), palette), smoothstep(0.55, 0.8, og_vnoise(P * 20.0)) * 0.5); // goethite patches
  rust *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.08, og_worley(P * 120.0).x)) * smoothstep(0.15, 0.5, age); // pits
  vec3 c = mix(metal, rust * (0.85 + 0.25 * og_vnoise(P * 90.0)), occ);
  return mix(c, mix(c, rust, 0.35), near);                                      // a stain ahead of the front
}

void main() {
  vec2 uv = isf_FragNormCoord;

  // Pass 0 : the latch. x = the seed (never 0 once running), y = the regrow
  // level (one fire per press), z = initialised + the kind (a new kind regrows),
  // w = the auto-cycle counter.
  if (PASSINDEX == 0) {
    vec2 lc = vec2(0.5);
    vec4 prev = IMG_NORM_PIXEL(latch, lc);
    float kz = 0.5 + float(kind) / 8.0;
    float cyc = cycle > 0.5 ? mod(floor(TIME / cycle), 250.0) / 255.0 : 0.0;
    bool fire = (regrow && prev.y < 0.5) || abs(prev.z - kz) > 0.02 || abs(prev.w - cyc) > 0.001;
    float s = fire ? fract(prev.x + 0.61803399 + fract(TIME * 0.7317)) : prev.x;
    if (s < 0.02) s += 0.1;
    gl_FragColor = vec4(s, regrow ? 1.0 : 0.0, kz, cyc);
    return;
  }

  // Pass 1 : one step of growth.
  if (PASSINDEX == 1) {
    vec2 lc = vec2(0.5);
    float sd = IMG_NORM_PIXEL(latch, lc).x;
    vec2 tx = 1.0 / RENDERSIZE;
    vec2 c = floor(uv * RENDERSIZE);
    vec4 s = IMG_NORM_PIXEL(state, uv);
    if (abs(s.a - sd) > 0.002) {                       // a new seed : clear and plant
      vec2 pl = plant(c, sd);
      gl_FragColor = vec4(pl.x, pl.y, 0.0, sd);
      return;
    }
    float dtScale = min(TIMEDELTA * 60.0, 3.0);         // steps are per frame : normalise to 60 fps
    float rnd = og_hash(c * 1.37 + vec2(fract(TIME * 13.7) * 311.0, sd * 97.0));
    if (s.r > 0.5) {                                   // occupied : age (dithered 8-bit steps)
      float ageRate = (0.03 + 0.3 * maturing) * dtScale;
      float ag = rnd < ageRate ? min(1.0, s.b + 1.0 / 255.0) : s.b;
      gl_FragColor = vec4(1.0, s.g, ag, sd);
      return;
    }
    float n = 0.0, id = 0.0;
    bool clash = false;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        if (i == 0 && j == 0) continue;
        vec2 q = uv + vec2(float(i), float(j)) * tx;
        vec4 nb = IMG_NORM_PIXEL(state, q);
        if (nb.r > 0.5) {
          n += (i != 0 && j != 0) ? 0.7 : 1.0;
          if (id < 0.001) id = nb.g; else if (abs(nb.g - id) > 0.002) clash = true;
        }
      }
    }
    // Colonies stop short of each other (inhibition); a fire front merges.
    if (n < 0.1 || (clash && kind != 2)) { gl_FragColor = s; return; }
    float fert = 0.15 + 0.85 * og_vnoise(c / 22.0 + sd * 37.0);
    float minF = kind == 0 ? bare * 0.62 : kind == 3 ? bare * 0.3 : bare * 0.12;
    if (fert < minF) { gl_FragColor = s; return; }
    // Exponential : 0 all but still, the default fills the frame in a couple of
    // minutes (real colonies creep), 1 races across it.
    float qg = clamp(0.004 * pow(40.0, growth) * fert * dtScale, 0.0, 0.95);
    float pr = 1.0 - pow(1.0 - qg, n);
    gl_FragColor = rnd < pr ? vec4(1.0, id, 0.0, sd) : s;
    return;
  }

  // Pass 2 : present, lit as a relief.
  float h = og_height(uv);
  vec3 alb = albedo(uv);
  gl_FragColor = vec4(clamp(og_relief(uv, alb, h, lightAngle, relief), 0.0, 1.0), 1.0);
}
