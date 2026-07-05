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
    // PARASITES: dead/hot pixel clusters that hold for several frames.
    vec2 pcell = floor(gl_FragCoord.xy / (max(size, 1.0) * 3.0));
    float pseed = floor(TIME * 3.0);
    float dead = step(1.0 - parasites * 0.02, hash(pcell + pseed * 7.1));
    debris = vec3(dead * (step(0.5, hash(pcell + 3.0)) * 2.0 - 1.0)); // hot or dead
  } else if (character == 1) {
    // FILM — irregular clumps, 24fps crawl, mid-tone weighted.
    float seed = floor(TIME * 24.0);
    vec2 jitter = vec2(hash(vec2(seed, 1.0)), hash(vec2(seed, 7.0))) * 100.0;
    vec2 p = gl_FragCoord.xy / (max(size, 1.0) * 2.2) + jitter;
    float n = vnoise(p) * 0.65 + vnoise(p * 2.7 + 31.0) * 0.35 - 0.5;
    n = sign(n) * pow(abs(n) * 2.0, 1.4) * 0.5;
    noise = vec3(n);
    w = smoothstep(0.02, 0.3, l) * (1.0 - smoothstep(0.65, 1.0, l) * 0.75);
    // PARASITES: dust specks + hair scratches, fresh every frame like a
    // dirty print. Specks: rare bright/dark blobs. Hairs: short thin
    // near-vertical strokes at a random x that live one frame.
    float fseed = floor(TIME * 24.0);
    vec2 duv = uv * vec2(24.0, 14.0);
    vec2 dcell = floor(duv);
    float has = step(1.0 - parasites * 0.06, hash(dcell + fseed * 11.3));
    vec2 dpos = dcell + 0.5 + (vec2(hash(dcell + 5.0), hash(dcell + 9.0)) - 0.5) * 0.8;
    float dd = length((duv - dpos) * vec2(1.0, 1.6));
    float speck = has * (1.0 - smoothstep(0.04, 0.12 + hash(dcell + 13.0) * 0.1, dd));
    float dark = step(0.4, hash(dcell + fseed));
    debris += vec3(speck * (dark * -1.6 + 0.8));
    // Hair: one candidate per frame.
    float hairX = hash(vec2(fseed, 77.0));
    float hairOn = step(1.0 - parasites * 0.35, hash(vec2(fseed, 33.0)));
    float hairY0 = hash(vec2(fseed, 41.0)) * 0.7;
    float hairLen = 0.1 + hash(vec2(fseed, 51.0)) * 0.25;
    float wob = (vnoise(vec2(uv.y * 30.0, fseed)) - 0.5) * 0.004;
    float hair = hairOn *
      (1.0 - smoothstep(0.0008, 0.002, abs(uv.x - hairX + wob))) *
      step(hairY0, uv.y) * step(uv.y, hairY0 + hairLen);
    debris += vec3(-hair * 0.9);
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
    // PARASITES: full-row dropouts going loud for one field.
    float dropout = step(1.0 - parasites * 0.03, rowSeed);
    debris = vec3(dropout * (hash(cell + 77.0) - 0.3) * 1.8);
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
    // PARASITES: white streak dashes — short bright horizontal scratches.
    float scell = floor(uv.y * 90.0);
    float son = step(1.0 - parasites * 0.05, hash(vec2(scell, seed)));
    float sx = hash(vec2(scell, seed + 5.0));
    float slen = 0.02 + hash(vec2(scell, seed + 9.0)) * 0.12;
    float dash = son * step(sx, uv.x) * step(uv.x, sx + slen) *
      (1.0 - smoothstep(0.0, 0.006, abs(fract(uv.y * 90.0) - 0.5) / 90.0 * 90.0 * 0.012));
    debris = vec3(dash * 1.2);
  }

  vec3 col = src.rgb + noise * amount * w + debris;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
}
