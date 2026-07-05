/*{
  "DESCRIPTION": "Grain — four characters: DIGITAL (square-cell static), FILM (irregular clumped 35mm grain, 24fps cadence), CRT (row-correlated snow + dropouts), VHS (chroma phase noise, luma smear, streak dashes). PARASITES adds the medium's debris: film dust & hair scratches, digital dead-pixel clusters, CRT dropout rows, VHS white streaks.",
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

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));

  vec3 noise = vec3(0.0);
  vec3 debris = vec3(0.0);
  float w = 1.0;

  if (character == 0) {
    // DIGITAL — per-cell static at ~24fps.
    vec2 cell = floor(gl_FragCoord.xy / max(size, 1.0));
    float seed = floor(TIME * 24.0);
    float n = hash(cell + seed * 13.7) - 0.5;
    noise = vec3(n);
    if (!mono) {
      noise = vec3(n, hash(cell + seed * 13.7 + 101.0) - 0.5, hash(cell + seed * 13.7 + 202.0) - 0.5);
    }
    w = smoothstep(0.0, 0.25, l) * (1.0 - smoothstep(0.7, 1.0, l) * 0.6);
    // PARASITES: dead/hot pixel clusters — VARIED: cluster size 1–4 cells
    // (coarser gate × finer detail), hold times differ per cluster, and a
    // rare cluster flickers instead of holding.
    float pseed = floor(TIME * (1.5 + hash(vec2(floor(TIME * 0.3), 5.0)) * 4.0));
    vec2 pcellA = floor(gl_FragCoord.xy / (max(size, 1.0) * 3.0));
    vec2 pcellB = floor(gl_FragCoord.xy / (max(size, 1.0) * 8.0));
    float small = step(1.0 - parasites * 0.015, hash(pcellA + pseed * 7.1));
    float big = step(1.0 - parasites * 0.008, hash(pcellB + floor(pseed * 0.5) * 3.3)) *
      step(0.4, hash(pcellA + 17.0)); // big clusters are ragged, not square
    float on = max(small, big);
    float flick = mix(1.0, step(0.5, hash(pcellA + floor(TIME * 20.0))), step(0.85, hash(pcellA + 29.0)));
    debris = vec3(on * flick * (step(0.5, hash(pcellA + 3.0)) * 2.0 - 1.0)); // hot or dead
  } else if (character == 1) {
    // FILM — irregular clumps, 24fps crawl, mid-tone weighted.
    float seed = floor(TIME * 24.0);
    vec2 jitter = vec2(hash(vec2(seed, 1.0)), hash(vec2(seed, 7.0))) * 100.0;
    vec2 p = gl_FragCoord.xy / (max(size, 1.0) * 2.2) + jitter;
    float n = vnoise(p) * 0.65 + vnoise(p * 2.7 + 31.0) * 0.35 - 0.5;
    n = sign(n) * pow(abs(n) * 2.0, 1.4) * 0.5;
    noise = vec3(n);
    w = smoothstep(0.02, 0.3, l) * (1.0 - smoothstep(0.65, 1.0, l) * 0.75);
    // PARASITES: dust + hairs, fresh every frame like a dirty print — and
    // VARIED: two speck scales, elliptical specks with random orientation
    // and per-speck softness, frames with dust "bursts", and up to two
    // hairs with real curvature and differing thickness.
    float fseed = floor(TIME * 24.0);
    // Burst factor: some frames carry far more debris than others.
    float burst = 0.4 + pow(hash(vec2(fseed, 3.0)), 3.0) * 3.0;
    for (int sc = 0; sc < 2; sc++) {
      float s = sc == 0 ? 1.0 : 2.6; // fine + coarse dust fields
      vec2 duv = uv * vec2(24.0, 14.0) * s;
      vec2 dcell = floor(duv);
      float has = step(1.0 - parasites * 0.05 * burst / s, hash(dcell + fseed * 11.3 + float(sc) * 71.0));
      vec2 dpos = dcell + 0.5 + (vec2(hash(dcell + 5.0), hash(dcell + 9.0)) - 0.5) * 0.8;
      // Elliptical: squash along a random per-speck axis.
      float ang = hash(dcell + 21.0) * 6.2832;
      vec2 ax = vec2(cos(ang), sin(ang));
      vec2 delta = duv - dpos;
      vec2 el = vec2(dot(delta, ax), dot(delta, vec2(-ax.y, ax.x)) * (1.2 + hash(dcell + 23.0) * 2.5));
      float dd = length(el);
      float sz = 0.05 + hash(dcell + 13.0) * 0.16;
      float soft = 0.3 + hash(dcell + 15.0) * 0.7;
      float speck = has * (1.0 - smoothstep(sz * (1.0 - soft), sz, dd));
      float dark = step(0.35, hash(dcell + fseed));
      debris += vec3(speck * (dark * -1.6 + 0.8) * (0.5 + hash(dcell + 31.0) * 0.5));
    }
    // Hairs: up to two per frame, each with curvature (quadratic arc),
    // its own thickness, wobble, and occasional light (dust-thread) tone.
    for (int hidx = 0; hidx < 2; hidx++) {
      float hs = fseed + float(hidx) * 397.0;
      float hairOn = step(1.0 - parasites * (hidx == 0 ? 0.35 : 0.15), hash(vec2(hs, 33.0)));
      float hairX = hash(vec2(hs, 77.0));
      float hairY0 = hash(vec2(hs, 41.0)) * 0.7;
      float hairLen = 0.08 + hash(vec2(hs, 51.0)) * 0.35;
      float curve = (hash(vec2(hs, 61.0)) - 0.5) * 0.15;
      float thick = 0.0008 + hash(vec2(hs, 67.0)) * 0.002;
      float yRel = (uv.y - hairY0) / max(hairLen, 0.001);
      float xC = hairX + curve * yRel * yRel + (vnoise(vec2(uv.y * 25.0, hs)) - 0.5) * 0.005;
      float hair = hairOn *
        (1.0 - smoothstep(thick * 0.4, thick * 2.0, abs(uv.x - xC))) *
        step(0.0, yRel) * step(yRel, 1.0);
      float lightHair = step(0.8, hash(vec2(hs, 71.0)));
      debris += vec3(hair * mix(-0.9, 0.7, lightHair));
    }
  } else if (character == 2) {
    // CRT — row-correlated snow at field rate.
    float row = floor(gl_FragCoord.y / max(size, 1.0));
    float seed = floor(TIME * 50.0);
    float rowSeed = hash(vec2(row, seed));
    vec2 cell = vec2(floor(gl_FragCoord.x / max(size, 1.0)), row);
    float n = (hash(cell + seed * 17.3) - 0.5) * (0.5 + rowSeed);
    noise = vec3(n);
    if (!mono) {
      noise += vec3((hash(cell + 301.0) - 0.5) * 0.35, 0.0, (hash(cell + 502.0) - 0.5) * 0.35);
    }
    w = 0.35 + 0.65 * smoothstep(0.0, 0.4, l);
    // PARASITES: row dropouts — VARIED: partial-width segments (random
    // start/length), varying intensity, occasionally a 2–3 row band.
    float band = 1.0 + floor(hash(vec2(row, seed + 3.0)) * 3.0);
    float rowQ = floor(row / band);
    float dSeed = hash(vec2(rowQ, seed));
    float dropout = step(1.0 - parasites * 0.03, dSeed);
    float segX0 = hash(vec2(rowQ, seed + 7.0)) * 0.8;
    float segLen = 0.1 + hash(vec2(rowQ, seed + 11.0)) * 0.9;
    float inSeg = step(segX0, uv.x) * step(uv.x, segX0 + segLen);
    debris = vec3(dropout * inSeg * (hash(cell + 77.0) - 0.3) * (0.8 + hash(vec2(rowQ, 91.0)) * 1.6));
  } else {
    // VHS — luma smear noise (horizontally correlated), chroma phase error
    // (red/blue rails drifting oppositely), soft and dirty.
    float row = floor(gl_FragCoord.y / max(size, 1.0));
    float seed = floor(TIME * 30.0);
    float smear = vnoise(vec2(gl_FragCoord.x / (max(size, 1.0) * 14.0), row * 0.7 + seed * 3.0)) - 0.5;
    float fine = (hash(vec2(floor(gl_FragCoord.x / max(size, 1.0)), row) + seed * 13.1) - 0.5) * 0.5;
    noise = vec3(smear * 0.7 + fine);
    float chromaErr = vnoise(vec2(row * 0.4, seed * 2.0)) - 0.5;
    noise += vec3(chromaErr * 0.6, 0.0, -chromaErr * 0.6);
    w = 0.4 + 0.6 * smoothstep(0.0, 0.35, l);
    // PARASITES: streak dashes — VARIED: two populations (short bright
    // ticks + long faint smears), random thickness, some drifting
    // horizontally over their lifetime, occasional dark dropout dash.
    for (int dp = 0; dp < 2; dp++) {
      float rows_ = dp == 0 ? 90.0 : 40.0;
      float scell = floor(uv.y * rows_);
      float ds = seed + float(dp) * 213.0;
      float son = step(1.0 - parasites * (dp == 0 ? 0.05 : 0.025), hash(vec2(scell, ds)));
      float drift = (hash(vec2(scell, ds + 3.0)) - 0.5) * 0.2 * fract(TIME * 7.7);
      float sx = hash(vec2(scell, ds + 5.0)) + drift;
      float slen = dp == 0 ? 0.02 + hash(vec2(scell, ds + 9.0)) * 0.1
                           : 0.15 + hash(vec2(scell, ds + 9.0)) * 0.45;
      float thick = 0.3 + hash(vec2(scell, ds + 13.0)) * 0.7;
      float yIn = abs(fract(uv.y * rows_) - 0.5) * 2.0;
      float dash = son * step(sx, uv.x) * step(uv.x, sx + slen) * (1.0 - smoothstep(thick * 0.4, thick, yIn));
      float darkDash = step(0.88, hash(vec2(scell, ds + 17.0)));
      debris += vec3(dash * mix(1.2, -0.7, darkDash) * (dp == 0 ? 1.0 : 0.45));
    }
  }

  vec3 col = src.rgb + noise * amount * w + debris;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
}
