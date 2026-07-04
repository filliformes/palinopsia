/*{
  "DESCRIPTION": "Particle Drift — sparse points carried through a flow direction with capsule trails, wandering inside their cells. The generative point-field register (nannou-sketch), matte over near-black; trails elongate along motion, never bloom.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Particles"],
  "INPUTS": [
    { "NAME": "count",  "TYPE": "float", "MIN": 4.0,  "MAX": 40.0,   "DEFAULT": 14.0 },
    { "NAME": "speed",  "TYPE": "float", "MIN": 0.0,  "MAX": 2.0,    "DEFAULT": 0.4 },
    { "NAME": "flow",   "TYPE": "float", "MIN": 0.0,  "MAX": 6.2832, "DEFAULT": 0.5 },
    { "NAME": "size",   "TYPE": "float", "MIN": 0.02, "MAX": 0.4,    "DEFAULT": 0.09 },
    { "NAME": "trail",  "TYPE": "float", "MIN": 0.0,  "MAX": 2.0,    "DEFAULT": 0.7 },
    { "NAME": "jitter", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.5 },
    { "NAME": "vary",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.6 },
    { "NAME": "tint",   "TYPE": "color", "DEFAULT": [0.8, 0.82, 0.78, 1.0] }
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

// One particle per grid cell, wandering around its anchor. Each particle
// wobbles at its OWN rate and phase (desynced — the organic read: a crowd
// of individuals, not a lockstep grid).
vec2 particle(vec2 cell, float t) {
  vec2 anchor = cell + 0.5 + (vec2(hash(cell), hash(cell + 13.1)) - 0.5) * 0.7;
  float ownRate = mix(1.0, 0.4 + 1.2 * hash(cell + 29.0), vary);
  float phase = hash(cell + 31.7) * 37.0;
  float tt = t * ownRate + phase;
  vec2 wob = vec2(
    vnoise(cell * 0.9 + vec2(tt * 0.35, 0.0)),
    vnoise(cell * 1.1 + vec2(0.0, tt * 0.3) + 51.0)
  ) - 0.5;
  return anchor + wob * jitter;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 dir = vec2(cos(flow), sin(flow));

  // The whole field translates along the flow; particles wander in cell space.
  vec2 q = vec2(uv.x * aspect, uv.y) * count - dir * TIME * speed * count * 0.15;
  vec2 cell0 = floor(q);

  float t = TIME;
  float lum = 0.0;
  // Per-particle character: individual size, brightness, and trail length
  // (all scaled by `vary`) — evaluated per neighbour, brightest wins. The
  // capsule metric along dir gives the trail (delta collapsed toward the
  // motion axis behind the dot).
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = cell0 + vec2(float(i), float(j));
      vec2 pp = particle(cell, t);
      float szf = mix(1.0, 0.4 + 1.3 * hash(cell + 41.0), vary);
      float bf  = mix(1.0, 0.45 + 0.75 * hash(cell + 53.0), vary);
      float tlf = mix(1.0, 0.3 + 1.4 * hash(cell + 67.0), vary);
      vec2 delta = q - pp;
      float along = clamp(dot(delta, dir), 0.0, trail * tlf);
      float dc = length(delta - dir * along);
      // Matte dot falloff — solid core, short soft edge, no glow tail.
      float dot_ = (1.0 - smoothstep(size * szf * 0.6, size * szf, dc)) * bf;
      lum = max(lum, dot_);
    }
  }

  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 col = base + tint.rgb * lum * 0.85;
  col *= 0.94 + 0.06 * sin(uv.y * RENDERSIZE.y * 3.14159);
  gl_FragColor = vec4(col, 1.0);
}
