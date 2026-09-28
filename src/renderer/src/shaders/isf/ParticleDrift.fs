/*{
  "DESCRIPTION": "Particle Drift : sparse points carried through a flow direction with capsule trails, wandering inside their cells. The generative point-field register, matte over near-black; trails stretch out behind each point and can fade from a bright head, never bloom. DENSITY thins the field below one point per cell; AUDIO PULSE lets every point swell with its own frequency band.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Particles"],
  "INPUTS": [
    { "NAME": "count",  "TYPE": "float", "MIN": 4.0,  "MAX": 40.0,   "DEFAULT": 14.0 },
    { "NAME": "speed",  "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,   "DEFAULT": 0.4 },
    { "NAME": "flow",   "TYPE": "float", "MIN": 0.0,  "MAX": 6.2832, "DEFAULT": 0.5, "LABEL": "flow angle" },
    { "NAME": "size",   "TYPE": "float", "MIN": 0.02, "MAX": 0.4,    "DEFAULT": 0.09 },
    { "NAME": "trail",  "TYPE": "float", "MIN": 0.0,  "MAX": 2.0,    "DEFAULT": 0.7 },
    { "NAME": "fade",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.0, "LABEL": "trail fade" },
    { "NAME": "jitter", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.5 },
    { "NAME": "vary",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.6 },
    { "NAME": "density", "TYPE": "float", "MIN": 0.05, "MAX": 1.0,   "DEFAULT": 1.0 },
    { "NAME": "audioPulse", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio pulse" },
    { "NAME": "tint",   "TYPE": "color", "DEFAULT": [0.8, 0.82, 0.78, 1.0] },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// Integrated motion (set by the engine; see phases.ts) : the field's offset is
// ∫ speed·count·(cos flow, sin flow) dt, so turning speed, count or flow
// changes how the field moves from here on and never flings it. PH_vary drives
// each point's own wobble clock (its rate depends on `vary`).
uniform float PH_pdriftX;
uniform float PH_pdriftY;
uniform float PH_vary;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 hash44(vec4 p4) {
  p4 = fract(p4 * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

// The field is periodic : every per-point value hashes the cell index mod WRAP,
// so the (unbounded) drift offset is wrapped mod WRAP without a seam and the
// hash inputs stay small on the longest show.
#define WRAP 289.0

// One point's wobble along its own clock : a 2D value-noise path (one hash
// per lattice step gives both axes), tiling every 1024 steps (the clock is
// wrapped before it gets here, without a seam).
vec2 wob2(vec2 key, float x) {
  float i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float i1 = i + 1.0;
  i1 *= step(i1, 1023.5);
  return mix(hash44(vec4(key, i, 3.0)).xy, hash44(vec4(key, i1, 3.0)).xy, f);
}

// The shared spectrum (row 1, log-spaced : 0 = bass, 1 = treble), 0..1.
float spec(float idx01) {
  vec2 ac = vec2(clamp(idx01, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 dir = vec2(cos(flow), sin(flow));

  // Screen → field (cell) coordinates, centred so `count` zooms about the
  // middle of the frame; the whole field translates along the flow.
  vec2 off = mod(0.15 * vec2(PH_pdriftX, PH_pdriftY), WRAP);
  vec2 q = (vec2(uv.x * aspect, uv.y) - vec2(aspect * 0.5, 0.5)) * count - off;
  float px = count / RENDERSIZE.y;                   // one pixel in cell units

  // Which points can reach this pixel ? Each trail stretches BEHIND its point
  // (along -dir), so the candidates sit ahead of the pixel along the flow, up
  // to the longest trail away. Walk the cells along that segment (a grid
  // traversal) and test each one plus its two side neighbours : long trails
  // are no longer cut square at the edge of a 3×3 search.
  float reach = trail * (1.0 + 0.7 * vary) + 1.2;   // longest trail + head + wander
  vec2 q0 = q - dir;                                 // start a cell behind
  float ell = reach + 1.0;
  vec2 sd = vec2(dir.x >= 0.0 ? 1.0 : -1.0, dir.y >= 0.0 ? 1.0 : -1.0);
  vec2 ad = max(abs(dir), vec2(1e-4));
  vec2 cellD = floor(q0);
  vec2 cmD = mod(cellD, WRAP);                       // its wrapped twin, stepped alongside
  vec2 tDelta = 1.0 / ad;
  vec2 tMax = (sd * (cellD - q0) + max(sd, vec2(0.0))) / ad;
  vec2 side = abs(dir.x) >= abs(dir.y) ? vec2(0.0, 1.0) : vec2(1.0, 0.0);

  float lum = 0.0;
  for (int k = 0; k < 9; k++) {
    for (int s = -1; s <= 1; s++) {
      vec2 cell = cellD + side * float(s);
      vec2 cm = cmD + side * float(s);                 // = mod(cell, WRAP)
      cm += WRAP * (step(cm, vec2(-0.5)) - step(vec2(WRAP - 0.5), cm));
      vec4 h1 = hash44(vec4(cm, 1.0, 0.0));   // anchor x/y, own rate, phase
      vec4 h2 = hash44(vec4(cm, 2.0, 0.0));   // size, brightness, trail, occupancy
      // DENSITY : only a share of the cells hold a point (true sparseness).
      if (h2.w > density) continue;

      // One point per occupied cell, wandering around its anchor at its OWN
      // rate and phase (desynced : a crowd of individuals, not a lockstep grid).
      vec2 anchor = cell + 0.5 + (h1.xy - 0.5) * 0.7;
      float tt = TIME + (1.2 * h1.z - 0.6) * PH_vary + h1.w * 37.0;
      vec2 wob = wob2(cm, mod(tt * 0.33, 1024.0)) - 0.5;
      vec2 pp = anchor + wob * jitter;

      // Per-point character : size, brightness and trail length (scaled by vary).
      float szf = mix(1.0, 0.4 + 1.3 * h2.x, vary);
      float bf  = mix(1.0, 0.45 + 0.75 * h2.y, vary);
      float tlf = mix(1.0, 0.3 + 1.4 * h2.z, vary);
      // AUDIO PULSE : each point listens to its own frequency bin.
      if (audioPulse > 0.001) {
        float lv = spec(hash13(vec3(cm, 5.0))) * audioPulse;
        szf *= 1.0 + 1.5 * lv;
        bf = min(bf * (1.0 + 0.6 * lv), 1.25);
      }

      // The capsule : the head plus a trail collapsed onto the motion axis
      // BEHIND it; the trail can fade from a bright head to a dim tail.
      float L = trail * tlf;
      vec2 delta = q - pp;
      float along = clamp(dot(delta, -dir), 0.0, L);
      float dc = length(delta + dir * along);
      // Matte dot, anti-aliased over one pixel; never below ~1.5 px (dimmed
      // instead), so tiny points don't twinkle.
      float r0 = size * szf * 0.8;
      float r = max(r0, 0.75 * px);
      float dotv = 1.0 - smoothstep(r - 0.5 * px, r + 0.5 * px, dc);
      dotv *= 1.0 - 0.9 * fade * along / (L + 1e-3);
      lum = max(lum, dotv * bf * clamp(r0 / r, 0.35, 1.0));
    }
    if (min(tMax.x, tMax.y) > ell) break;
    vec2 stp = tMax.x < tMax.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    cellD += stp * sd;
    tMax += stp * tDelta;
    cmD += stp * sd;
    cmD += WRAP * (step(cmD, vec2(-0.5)) - step(vec2(WRAP - 0.5), cmD));
  }

  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 col = base + tint.rgb * lum * 0.85;
  gl_FragColor = vec4(col, 1.0);
}
