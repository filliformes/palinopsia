/*{
  "DESCRIPTION": "Murmuration : a flock of points steered by one shared wind. HEADING points the wind (VEER lets it swing around that heading on its own, slowly); cohesion is how tightly the birds share it. Every bird surges back and forth along its heading on a phase that varies smoothly across the flock, so density waves travel through the crowd while individuals still wander. Audio scatter startles each bird on its own frequency band. Matte dots over near-black, organic by construction.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Particles", "Organic"],
  "INPUTS": [
    { "NAME": "count",    "TYPE": "float", "MIN": 8.0,  "MAX": 60.0, "DEFAULT": 28.0 },
    { "NAME": "speed",    "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,  "DEFAULT": 0.6 },
    { "NAME": "cohesion", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.7 },
    { "NAME": "size",     "TYPE": "float", "MIN": 0.02, "MAX": 0.3,  "DEFAULT": 0.07 },
    { "NAME": "stretch",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.5,  "DEFAULT": 0.5 },
    { "NAME": "heading",  "TYPE": "float", "MIN": 0.0,  "MAX": 6.2832, "DEFAULT": 0.6 },
    { "NAME": "veer",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.5 },
    { "NAME": "audioScatter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio scatter" },
    { "NAME": "tint",     "TYPE": "color", "DEFAULT": [0.82, 0.8, 0.75, 1.0] },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// Integrated speed (engine-driven : a speed change alters how fast the birds
// move from now on, never where they are). speed 0 holds the flock still.
uniform float PH_speed;

// Noise lattices repeat every WRAP units, so every drifting coordinate can
// wrap seamlessly and hash inputs stay small forever.
#define WRAP 1024.0

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 i1 = mod(i + 1.0, WRAP);
  i = mod(i, WRAP);
  float a = hash12(i);
  float b = hash12(vec2(i1.x, i.y));
  float c = hash12(vec2(i.x, i1.y));
  float d = hash12(i1);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Spectrum (row 1, log-spaced : 0 bass .. 1 treble), 0..1. Bare-identifier coord.
float spec(float u) {
  vec2 ac = vec2(clamp(u, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  vec2 q = vec2(uv.x * aspect, uv.y) * count;
  vec2 cell0 = floor(q);

  // The shared wind. VEER swings it around HEADING on a slow, bounded path
  // (two incommensurate sines : never a regular sweep, never a full spin).
  float T = TIME;
  float veerA = veer * 3.1416 * (0.62 * sin(T * 0.089 + 1.3) + 0.38 * sin(T * 0.053 + 4.1));
  float wind0 = heading + veerA;
  // Local deviation : high cohesion = every bird reads nearly the same wind,
  // low = each region turns its own way (and on a finer spatial scale).
  float spread = mix(2.6, 0.3, cohesion);
  float cf = mix(0.45, 0.08, cohesion);
  vec2 drift = vec2(mod(T * 0.043, WRAP), mod(T * 0.031, WRAP));
  vec2 drift2 = vec2(mod(T * 0.03, WRAP), mod(T * 0.022, WRAP));
  // Bird motion clock (integrated speed; it only feeds sin, so no wrap).
  float sp = PH_speed;
  // One pixel in cell units : dots never shrink below ~1.3 px (no shimmer).
  float pxc = count / RENDERSIZE.y;
  float sz = max(size, 1.3 * pxc);
  float dim = size / sz;

  float lum = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = cell0 + vec2(float(i), float(j));
      if (hash12(cell * 1.7) < 0.35) continue; // sparse flock
      float h1 = hash12(cell + 9.1);
      float h2 = hash12(cell + 3.7);
      // This bird's wind.
      float a = wind0 + (vnoise(cell * cf + drift) - 0.5) * 2.0 * spread;
      vec2 w = vec2(cos(a), sin(a));
      vec2 perp = vec2(-w.y, w.x);
      // Travelling density waves : each bird surges along its heading on a
      // phase that varies smoothly across the flock (a noise field turning
      // ~1.5 times over), so compressions and gaps run through the crowd.
      float phi = sp * 1.5 + vnoise(cell * 0.13 + drift2 + 17.0) * 9.42 + h1 * 0.8;
      float surge = sin(phi);
      // Individual wander (smooth, per bird) + a fixed per-bird jitter so the
      // flock never reads as a grid.
      float h3 = hash12(cell + 61.0);
      vec2 wander = vec2(sin(sp * (0.55 + h3 * 0.5) + h2 * 6.2832),
                         sin(sp * (0.5 + h2 * 0.55) + h3 * 6.2832)) * 0.17;
      vec2 off = (vec2(h1, h2) - 0.5) * 0.3 + w * 0.42 * surge + wander;
      // Audio scatter : a startle along a per-bird direction, driven by the
      // (smoothed) loudness of this bird's own frequency band.
      if (audioScatter > 0.0) {
        float ang = hash12(cell + 41.0) * 6.2832;
        float lvl = spec(0.03 + hash12(cell + 53.0) * 0.72);
        off += vec2(cos(ang), sin(ang)) * lvl * lvl * audioScatter * 0.6;
      }
      // Keep the whole bird inside the 3×3 search : offset first, then the
      // capsule half-length, so nothing is ever clipped at a cell edge.
      float room = 1.45 - sz;
      float lo = length(off);
      off *= min(1.0, room / max(lo, 0.0001));
      float half_ = min(sz * (0.5 + stretch * 2.0), max(room - min(lo, room), 0.0));
      vec2 delta = q - (cell + 0.5 + off);
      // Stretch each dot along its wind (centred capsule) : reads as heading.
      float along = clamp(dot(delta, w), -half_, half_);
      float d = length(delta - w * along);
      float dot_ = 1.0 - smoothstep(sz * 0.5, sz, d);
      // Banking shade rides the same wave : birds at one phase of the surge
      // turn their wings to the light together, so the waves read as bands.
      float bank = 0.55 + 0.45 * (0.5 + 0.5 * cos(phi - 0.6));
      lum = max(lum, dot_ * bank * dim);
    }
  }

  vec3 base = vec3(0.025, 0.025, 0.03);
  vec3 col = base + tint.rgb * lum * 0.85;
  gl_FragColor = vec4(col, 1.0);
}
