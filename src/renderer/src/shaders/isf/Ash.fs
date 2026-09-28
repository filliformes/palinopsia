/*{
  "DESCRIPTION": "Ash : sparse particulate falling at per-column rates with lateral wander and flicker; rare flecks carry the accent. Near-black particulate weather : settling, not snowing: matte, slow, asymmetric. Physics sets the mass: low = heavy flecks dropping fast and straight, high = light ash drifting down softly with more sway and float. Audio scatter gusts each column sideways on its own live sample.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Particles"],
  "INPUTS": [
    { "NAME": "count",   "TYPE": "float", "MIN": 6.0,  "MAX": 60.0, "DEFAULT": 24.0 },
    { "NAME": "speed",   "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,  "DEFAULT": 0.25 },
    { "NAME": "physics", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "size",    "TYPE": "float", "MIN": 0.02, "MAX": 0.35, "DEFAULT": 0.08 },
    { "NAME": "wander",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.4 },
    { "NAME": "flicker", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.3 },
    { "NAME": "accent",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.25 },
    { "NAME": "audioScatter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio scatter" },
    { "NAME": "tint",    "TYPE": "color", "DEFAULT": [0.9, 0.55, 0.25, 1.0] },
    { "NAME": "audioTex","TYPE": "image" }
  ]
}*/

// Integrated fall (engine-driven : a speed / count / physics change alters how
// fast the ash falls from now on, never where it is). The fall law is
// speed·count·mix(1, 0.32, physics) = speed·count − 0.68·speed·count·physics.
uniform float PH_speed_x_count;
uniform float PH_speed_x_count_x_physics;

// Rows repeat seamlessly every WRAP cells, so the scroll can wrap forever and
// every hash input stays small (no lattice after hours).
#define WRAP 1024.0

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise, periodic over WRAP in x (its time axis here).
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, WRAP), x1 = mod(i.x + 1.0, WRAP);
  float a = hash12(vec2(x0, i.y));
  float b = hash12(vec2(x1, i.y));
  float c = hash12(vec2(x0, i.y + 1.0));
  float d = hash12(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Per-element audio : the shared waveform texture (row 0), ±1 around silence.
float aud(float idx01) {
  vec2 ac = vec2(fract(idx01), 0.25);
  return (IMG_NORM_PIXEL(audioTex, ac).r - 0.5) * 2.0;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float cols = count * aspect;

  // Physics = inverse mass. Light ash (high physics) falls slowly and sways
  // more; heavy flecks (low physics) drop fast and nearly straight.
  float sway = mix(1.0, 2.2, physics);
  float fallPh = PH_speed_x_count - 0.68 * PH_speed_x_count_x_physics;
  float tw = mod(TIME * 0.3, WRAP);

  // Column-space grid; every column falls at its own rate (ash, not snow :
  // no uniform sheet of motion). Each CANDIDATE column is evaluated with its
  // own scroll, so a fleck overlapping its column edge is drawn whole.
  float qx = uv.x * cols;
  float c0 = floor(qx);
  // Fleck radius, floored at ~1.2 px (tiny flecks fade instead of shimmering).
  float rad = max(size, 1.2 * count / RENDERSIZE.y);
  float dim = size / rad;
  // Wide in x so a fleck scattered off its own column is still found : ±2
  // columns, one more only when these settings (strong wander, loud audio
  // scatter) can carry a fleck that far. The clamp below is a safety net.
  float maxSx = 0.425 + 0.5 * wander * sway + 0.22 * physics + 1.5 * audioScatter;
  float R = maxSx > 2.5 - rad ? 3.0 : 2.0;
  float reachX = R + 0.5 - rad;

  float lum = 0.0;
  float acc = 0.0;
  for (int i = -3; i <= 3; i++) {
    float fi = float(i);
    if (abs(fi) > R) continue;
    float cx = c0 + fi;
    float colRate = 0.35 + hash12(vec2(cx, 1.7)) * 0.65;
    float scroll = mod(fallPh * 0.2 * colRate, WRAP);
    float qy = uv.y * count + scroll;
    float cy0 = floor(qy);
    // Audio scatter : the whole column gusts sideways on its OWN live sample
    // (adjacent columns read adjacent samples : a gust travels across the bed).
    float gust = audioScatter > 0.0 ? aud(cx / cols) * audioScatter * 1.5 : 0.0;
    for (int j = -1; j <= 1; j++) {
      float cy = cy0 + float(j);
      // Hash on the wrapped row : identical flecks before and after a wrap.
      vec2 cell = vec2(cx, mod(cy, WRAP));
      // Not every cell holds a fleck : sparseness is the register.
      if (hash12(cell * 1.13) < 0.45) continue;
      // Per-fleck RANDOM horizontal scatter (breaks the columnar lines the old
      // smooth-only wander produced), plus a gentle sway and a physics-scaled
      // lateral float; a little vertical jitter too.
      float sx = (hash12(cell + 5.0) - 0.5) * 0.85
        + (vnoise(cell * 0.8 + vec2(tw, 0.0)) - 0.5) * wander * sway
        + physics * 0.22 * sin(TIME * (0.5 + hash12(cell + 2.0)) + hash12(cell) * 6.28)
        + gust;
      sx = clamp(sx, -reachX, reachX);
      vec2 pos = vec2(cx, cy) + 0.5 + vec2(sx, (hash12(cell + 7.0) - 0.5) * 0.6);
      float d = length(vec2(qx, qy) - pos);
      // Flicker: slow per-fleck brightness breathing.
      float fl = 1.0 - flicker * (0.5 + 0.5 * sin(TIME * (1.0 + hash12(cell) * 3.0) + hash12(cell + 3.0) * 6.28));
      float dot_ = (1.0 - smoothstep(rad * 0.5, rad, d)) * fl * dim;
      lum = max(lum, dot_ * (0.4 + 0.6 * hash12(cell + 11.0)));
      // Rare accent flecks.
      acc = max(acc, dot_ * step(1.0 - accent * 0.35, hash12(cell + 23.0)));
    }
  }

  vec3 base = vec3(0.025, 0.025, 0.03);
  vec3 grey = vec3(0.75, 0.74, 0.7);
  vec3 col = base + grey * lum * 0.7;
  col = mix(col, base + tint.rgb * lum, acc);
  gl_FragColor = vec4(col, 1.0);
}
