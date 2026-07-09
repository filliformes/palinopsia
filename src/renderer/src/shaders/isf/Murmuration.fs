/*{
  "DESCRIPTION": "Murmuration : a flock of points steered by one shared, slowly turning wind field: coherent waves of motion pass through the crowd (density waves), individuals still wander. Matte dots over near-black, organic by construction.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Particles", "Organic"],
  "INPUTS": [
    { "NAME": "count",    "TYPE": "float", "MIN": 8.0,  "MAX": 60.0, "DEFAULT": 28.0 },
    { "NAME": "speed",    "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,  "DEFAULT": 0.6 },
    { "NAME": "cohesion", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.7 },
    { "NAME": "size",     "TYPE": "float", "MIN": 0.02, "MAX": 0.3,  "DEFAULT": 0.07 },
    { "NAME": "stretch",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.5,  "DEFAULT": 0.5 },
    { "NAME": "tint",     "TYPE": "color", "DEFAULT": [0.82, 0.8, 0.75, 1.0] }
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

// The shared wind: a slowly rotating direction field. High cohesion → every
// bird reads nearly the same wind; low → each cell reads its own local wind.
vec2 wind(vec2 cell, float t) {
  float coh = mix(0.9, 0.06, cohesion); // spatial frequency of the field
  float a = vnoise(cell * coh + t * 0.15) * 6.2832 + t * 0.1;
  return vec2(cos(a), sin(a));
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float t = TIME;

  vec2 q = vec2(uv.x * aspect, uv.y) * count;
  vec2 cell0 = floor(q);

  float lum = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = cell0 + vec2(float(i), float(j));
      if (hash(cell * 1.7) < 0.35) continue; // sparse flock
      vec2 w = wind(cell, t);
      // Bird position: anchor + travel along the wind + individual wiggle.
      float phase = hash(cell + 9.1) * 37.0;
      vec2 travel = w * (t * speed * 0.8 + phase);
      // Wrap travel inside the cell neighbourhood so birds never leave home
      // : the WIND translates the pattern, the flock breathes in place.
      vec2 pos = cell + 0.5 +
        vec2(fract(travel.x * 0.13) - 0.5, fract(travel.y * 0.13) - 0.5) * 1.6 +
        (vec2(vnoise(cell + t * 0.5), vnoise(cell.yx - t * 0.45)) - 0.5) * 0.4;
      vec2 delta = q - pos;
      // Stretch each dot along its wind : reads as heading, not smear.
      float along = clamp(dot(delta, w), 0.0, size * (1.0 + stretch * 4.0));
      float d = length(delta - w * along);
      float dot_ = 1.0 - smoothstep(size * 0.5, size, d);
      // Density-wave shading: birds aligned with the local wind read brighter.
      float align = 0.55 + 0.45 * vnoise(cell * 0.3 + t * 0.4);
      lum = max(lum, dot_ * align);
    }
  }

  vec3 base = vec3(0.025, 0.025, 0.03);
  vec3 col = base + tint.rgb * lum * 0.85;
  gl_FragColor = vec4(col, 1.0);
}
