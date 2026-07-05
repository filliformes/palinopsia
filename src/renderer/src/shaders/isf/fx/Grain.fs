/*{
  "DESCRIPTION": "Grain — four characters: DIGITAL (square-cell static), FILM (irregular clumped 35mm grain, 24fps cadence), CRT (row-correlated snow + dropouts), VHS (chroma phase noise, luma smear, streak dashes). PARASITES adds the medium's debris — organically scattered and clustered: film dust & hair scratches, digital dead-pixel clusters, CRT dropout bands, VHS streaks.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Texture"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "character", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["digital", "film", "crt", "vhs"], "DEFAULT": 1 },
    { "NAME": "amount",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15 },
    { "NAME": "size",      "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 1.5 },
    { "NAME": "parasites", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2 },
    { "NAME": "mono",      "TYPE": "bool",  "DEFAULT": true }
  ]
}*/

// Dave Hoskins hash13/hash22 — strong, low-pattern distribution (the old
// hash showed grid structure at the scales parasites use).
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

// Organic dust field. Points are placed CONTINUOUSLY (not snapped to cells)
// and their local probability is modulated by a low-frequency clump field,
// so debris gathers in patches instead of an even grid. `frameSeed` drives
// per-frame refresh; `coverage` is the base density; `hardness` biases
// specks toward hard (digital) vs soft (film) edges. Returns a signed
// value (>0 bright fleck, <0 dark speck), strongest speck wins per fragment.
float dustField(vec2 uv, vec2 cells, float frameSeed, float coverage, float hardness) {
  vec2 g = uv * cells;
  vec2 cell0 = floor(g);
  // Clump field scrolls with the frame so patches drift, never static.
  float clump = vnoise(uv * 3.4 + vec2(frameSeed * 0.11, frameSeed * 0.07));
  clump *= clump; // sharpen — most of the frame stays clean
  float local = coverage * mix(0.1, 1.0, clump);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = cell0 + vec2(float(i), float(j));
      vec2 h = hash22(cell + frameSeed);
      if (h.x > local) continue; // this cell carries no speck this frame
      vec2 pos = cell + hash22(cell + frameSeed + 19.7); // anywhere in cell
      float ang = h.y * 6.2832;
      vec2 ax = vec2(cos(ang), sin(ang));
      vec2 d = g - pos;
      float squash = 1.0 + hash21(cell + 5.3) * 3.0; // elliptical
      vec2 el = vec2(dot(d, ax), dot(d, vec2(-ax.y, ax.x)) * squash);
      float dd = length(el);
      float sz = 0.14 + hash21(cell + 8.1) * 0.5;
      float soft = mix(0.15 + hash21(cell + 11.2) * 0.7, 0.05, hardness);
      float v = 1.0 - smoothstep(sz * (1.0 - soft), sz, dd);
      // Mostly dark specks (dust blocks light); some bright flecks.
      float tone = hash21(cell + frameSeed + 2.2) < 0.35 ? 0.9 : -1.5;
      float c = v * tone;
      if (abs(c) > abs(acc)) acc = c;
    }
  }
  return acc;
}

// One hair scratch: a curved near-vertical stroke; index staggers seeds.
float hairScratch(vec2 uv, float seed, float coverage) {
  float on = step(1.0 - coverage, hash21(vec2(seed, 33.0)));
  float x0 = hash21(vec2(seed, 77.0));
  float y0 = (hash21(vec2(seed, 41.0)) - 0.25) * 1.2; // can start off-frame
  float len = 0.1 + hash21(vec2(seed, 51.0)) * 0.6;
  float curve = (hash21(vec2(seed, 61.0)) - 0.5) * 0.25;
  float thick = 0.0007 + hash21(vec2(seed, 67.0)) * 0.0022;
  float yRel = (uv.y - y0) / max(len, 0.001);
  float xC = x0 + curve * yRel * yRel + (vnoise(vec2(uv.y * 22.0, seed)) - 0.5) * 0.006;
  float hair = on *
    (1.0 - smoothstep(thick * 0.4, thick * 2.0, abs(uv.x - xC))) *
    step(0.0, yRel) * step(yRel, 1.0);
  float light = step(0.8, hash21(vec2(seed, 71.0)));
  return hair * mix(-0.9, 0.7, light);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  vec3 noise = vec3(0.0);
  float debris = 0.0;
  float w = 1.0;

  if (character == 0) {
    // DIGITAL — per-cell static at ~24fps.
    vec2 cell = floor(gl_FragCoord.xy / max(size, 1.0));
    float seed = floor(TIME * 24.0);
    float n = hash21(cell + seed * 13.7) - 0.5;
    noise = vec3(n);
    if (!mono) {
      noise = vec3(n, hash21(cell + seed * 13.7 + 101.0) - 0.5, hash21(cell + seed * 13.7 + 202.0) - 0.5);
    }
    w = smoothstep(0.0, 0.25, l) * (1.0 - smoothstep(0.7, 1.0, l) * 0.6);
    // PARASITES: dead/hot pixels — hard-edged, HOLD for a while (slow seed),
    // clustered. Two scales so clusters vary in extent.
    float dseed = floor(TIME * 2.5);
    debris += dustField(uv, vec2(90.0 * aspect, 90.0), dseed, parasites * 0.05, 1.0);
    debris += dustField(uv, vec2(36.0 * aspect, 36.0), floor(dseed * 0.5) + 4.0, parasites * 0.02, 0.85);
  } else if (character == 1) {
    // FILM — irregular clumps, 24fps crawl, mid-tone weighted.
    float seed = floor(TIME * 24.0);
    vec2 jitter = vec2(hash21(vec2(seed, 1.0)), hash21(vec2(seed, 7.0))) * 100.0;
    vec2 p = gl_FragCoord.xy / (max(size, 1.0) * 2.2) + jitter;
    float n = vnoise(p) * 0.65 + vnoise(p * 2.7 + 31.0) * 0.35 - 0.5;
    n = sign(n) * pow(abs(n) * 2.0, 1.4) * 0.5;
    noise = vec3(n);
    w = smoothstep(0.02, 0.3, l) * (1.0 - smoothstep(0.65, 1.0, l) * 0.75);
    // PARASITES: dust (two scales, soft, clustered) + up to three hairs.
    float burst = 0.4 + pow(hash21(vec2(seed, 3.0)), 3.0) * 3.0; // dirty vs clean frames
    debris += dustField(uv, vec2(44.0 * aspect, 44.0), seed, parasites * 0.06 * burst, 0.0);
    debris += dustField(uv, vec2(15.0 * aspect, 15.0), seed + 137.0, parasites * 0.03 * burst, 0.15);
    debris += hairScratch(uv, seed, parasites * 0.4);
    debris += hairScratch(uv, seed + 411.0, parasites * 0.2);
    debris += hairScratch(uv, seed + 823.0, parasites * 0.1);
  } else if (character == 2) {
    // CRT — row-correlated snow at field rate.
    float row = floor(gl_FragCoord.y / max(size, 1.0));
    float seed = floor(TIME * 50.0);
    float rowSeed = hash21(vec2(row, seed));
    vec2 cell = vec2(floor(gl_FragCoord.x / max(size, 1.0)), row);
    float n = (hash21(cell + seed * 17.3) - 0.5) * (0.5 + rowSeed);
    noise = vec3(n);
    if (!mono) {
      noise += vec3((hash21(cell + 301.0) - 0.5) * 0.35, 0.0, (hash21(cell + 502.0) - 0.5) * 0.35);
    }
    w = 0.35 + 0.65 * smoothstep(0.0, 0.4, l);
    // PARASITES: horizontal dropout BANDS placed by CENTER + half-width, so
    // they appear anywhere (no right bias) and can span full width. Band
    // thickness varies (1–3 rows); ragged edges from a little x-noise.
    float bandH = 1.0 + floor(hash21(vec2(row, seed + 3.0)) * 3.0);
    float bandQ = floor(row / bandH);
    float on = step(1.0 - parasites * 0.04, hash21(vec2(bandQ, seed)));
    float center = hash21(vec2(bandQ, seed + 7.0));
    float halfW = 0.03 + hash21(vec2(bandQ, seed + 11.0)) * 0.6;
    float edge = (vnoise(vec2(uv.x * 40.0, bandQ)) - 0.5) * 0.06; // ragged ends
    float inSeg = 1.0 - smoothstep(halfW - 0.02, halfW + 0.02, abs(uv.x - center) + edge);
    debris += on * inSeg * (hash21(cell + 77.0) - 0.3) * (0.9 + hash21(vec2(bandQ, 91.0)) * 1.5);
  } else {
    // VHS — luma smear noise (horizontally correlated), chroma phase error.
    float row = floor(gl_FragCoord.y / max(size, 1.0));
    float seed = floor(TIME * 30.0);
    float smear = vnoise(vec2(gl_FragCoord.x / (max(size, 1.0) * 14.0), row * 0.7 + seed * 3.0)) - 0.5;
    float fine = (hash21(vec2(floor(gl_FragCoord.x / max(size, 1.0)), row) + seed * 13.1) - 0.5) * 0.5;
    noise = vec3(smear * 0.7 + fine);
    float chromaErr = vnoise(vec2(row * 0.4, seed * 2.0)) - 0.5;
    noise += vec3(chromaErr * 0.6, 0.0, -chromaErr * 0.6);
    w = 0.4 + 0.6 * smoothstep(0.0, 0.35, l);
    // PARASITES: streak dashes — CENTER-based (symmetric), two populations
    // (short bright ticks + long faint smears), drifting, some dark.
    for (int dp = 0; dp < 2; dp++) {
      float rows_ = dp == 0 ? 90.0 : 40.0;
      float scell = floor(uv.y * rows_);
      float ds = seed + float(dp) * 213.0;
      float son = step(1.0 - parasites * (dp == 0 ? 0.05 : 0.025), hash21(vec2(scell, ds)));
      float drift = (hash21(vec2(scell, ds + 3.0)) - 0.5) * 0.25 * fract(TIME * 7.7);
      float center = hash21(vec2(scell, ds + 5.0)) + drift;
      float halfLen = (dp == 0 ? 0.01 + hash21(vec2(scell, ds + 9.0)) * 0.05
                               : 0.08 + hash21(vec2(scell, ds + 9.0)) * 0.22);
      float thick = 0.3 + hash21(vec2(scell, ds + 13.0)) * 0.7;
      float yIn = abs(fract(uv.y * rows_) - 0.5) * 2.0;
      float dash = son * (1.0 - step(halfLen, abs(uv.x - center))) * (1.0 - smoothstep(thick * 0.4, thick, yIn));
      float darkDash = step(0.88, hash21(vec2(scell, ds + 17.0)));
      debris += dash * mix(1.2, -0.7, darkDash) * (dp == 0 ? 1.0 : 0.45);
    }
  }

  vec3 col = src.rgb + noise * amount * w + vec3(debris);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
}
