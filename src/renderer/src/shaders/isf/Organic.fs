/*{
  "DESCRIPTION": "Organic — living elemental textures, always in motion. FIRE: turbulent flames advecting upward through an ember→orange→pale ramp, swaying and licking. WATER: domain-warped depth with drifting thin caustic ridges, deep and cold. NATURE: slowly growing canopy — leaf masses, fine cell texture and brown vein/branch networks, breathing on a very slow clock. `vary` blends each element toward its alternate season (gas-blue flame · lagoon green · autumn). Matte by design — no plasma, no glow blowouts.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "mode",     "TYPE": "long",  "VALUES": [0,1,2], "LABELS": ["fire","water","nature"], "DEFAULT": 0, "LABEL": "element" },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5,  "LABEL": "rate" },
    { "NAME": "scale",    "TYPE": "float", "MIN": 0.5, "MAX": 8.0, "DEFAULT": 2.5,  "LABEL": "scale" },
    { "NAME": "detail",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6,  "LABEL": "detail" },
    { "NAME": "flow",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5,  "LABEL": "flow" },
    { "NAME": "vary",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "season" },
    { "NAME": "contrast", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0,  "LABEL": "contrast" }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// 5-octave fbm with rotation between octaves (kills axis-aligned artifacts).
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  mat2 R = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = R * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}

// ── FIRE: upward-advected turbulence, hotter at the base, licking tops ──
vec3 fire(vec2 uv, vec2 p, float t) {
  // Side sway (whole flame leaning) + local turbulence.
  float sway = fbm(p * 0.7 + vec2(0.0, -t * 0.6)) - 0.5;
  p.x += sway * flow * 1.4;
  float n = fbm(p * vec2(1.0, 0.62) + vec2(0.0, -t * 2.1));
  n += (fbm(p * 2.3 + vec2(0.0, -t * 3.3)) - 0.5) * detail * 0.7;
  // Flame body: strongest near the bottom, noise carves the licking tops.
  float body = n * (1.45 - uv.y * 1.25);
  body = clamp(pow(max(body, 0.0) * 1.5, 0.8 + contrast), 0.0, 1.0);
  // Matte ember ramp — near-black floor, never additive white.
  vec3 c = vec3(0.02, 0.012, 0.01);
  c = mix(c, vec3(0.42, 0.06, 0.02), smoothstep(0.06, 0.34, body));
  c = mix(c, vec3(0.85, 0.36, 0.07), smoothstep(0.34, 0.66, body));
  c = mix(c, vec3(0.97, 0.78, 0.38), smoothstep(0.68, 0.96, body));
  // Season: toward a cold gas flame (kept matte via the body mask).
  vec3 gas = vec3(0.10, 0.30, 0.62) * (0.25 + body * 1.1);
  return mix(c, gas, vary * 0.85);
}

// ── WATER: domain-warped depth + drifting thin caustic ridges ───────────
vec3 water(vec2 p, float t) {
  vec2 drift1 = vec2(t * 0.16, t * 0.09);
  vec2 drift2 = vec2(-t * 0.12, t * 0.13);
  // Domain warp = the water's slow internal churn.
  float warp = fbm(p * 0.8 + drift2);
  float n1 = fbm(p + drift1 + (warp - 0.5) * flow * 2.2);
  float n2 = fbm(p * 1.7 + drift2);
  // Caustics: thin ridges where the two fields agree.
  float caust = 1.0 - abs(n1 - n2) * 2.6;
  caust = pow(clamp(caust, 0.0, 1.0), 9.0 / max(contrast, 0.5));
  float depth = fbm(p * 0.5 + drift1 * 0.35);
  vec3 c = mix(vec3(0.012, 0.05, 0.075), vec3(0.05, 0.17, 0.21), depth);
  c += caust * vec3(0.22, 0.40, 0.42) * (0.35 + detail * 0.65);
  // Season: warm lagoon green.
  vec3 lagoon = mix(vec3(0.02, 0.09, 0.05), vec3(0.10, 0.34, 0.22), depth) +
    caust * vec3(0.30, 0.44, 0.28) * (0.35 + detail * 0.65);
  return mix(c, lagoon, vary);
}

// ── NATURE: canopy masses + fine leaf cells + brown vein/branch network ──
vec3 nature(vec2 p, float t) {
  // Growth: a very slow domain warp so the structure re-organizes over minutes.
  vec2 w = vec2(fbm(p * 0.9 + t * 0.05), fbm(p * 0.9 + 7.3 - t * 0.04));
  p += (w - 0.5) * flow * 2.2;
  // Veins/branches: ridged fbm (bright creases inverted to lines).
  float veins = 1.0 - abs(2.0 * fbm(p * 1.8 + t * 0.06) - 1.0);
  veins = pow(clamp(veins, 0.0, 1.0), 3.5);
  // Leaf masses breathing + fine cellular texture.
  float canopy = fbm(p + vec2(t * 0.07, t * 0.03));
  float cells = (fbm(p * 3.2 - t * 0.05) - 0.5) * detail;
  float g = pow(clamp(canopy * 0.85 + cells * 0.8 + 0.08, 0.0, 1.0), contrast);
  vec3 moss = mix(vec3(0.045, 0.085, 0.038), vec3(0.16, 0.32, 0.11), g);
  vec3 c = mix(moss, vec3(0.40, 0.50, 0.19), smoothstep(0.62, 0.95, g) * 0.65);
  c = mix(c, vec3(0.23, 0.155, 0.075), veins * 0.6);
  // Season: patchy autumn — the swap arrives in drifting patches, not globally.
  float patch = fbm(p * 0.6 + t * 0.02);
  vec3 autumn = mix(vec3(0.16, 0.07, 0.02), vec3(0.62, 0.32, 0.09), g);
  autumn = mix(autumn, vec3(0.23, 0.14, 0.06), veins * 0.6);
  return mix(c, autumn, vary * smoothstep(0.35, 0.75, patch));
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = uv * vec2(aspect, 1.0) * scale;
  float t = TIME * rate;

  vec3 c;
  if (mode == 0) c = fire(uv, p, t);
  else if (mode == 1) c = water(p, t);
  else c = nature(p, t);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
