/*{
  "DESCRIPTION": "Organic : living elemental matter, driven by a real flow field instead of scrolling noise. A divergence-free CURL-NOISE velocity field advects each element so it billows, flows and grows (not just slides), a SWIRL control sets the turbulence, DEPTH stacks parallax layers for volume, and EMBERS seeds a drifting particle layer (rising sparks · sediment/bubbles · pollen/leaves). FIRE: buoyant flames that accelerate and stretch as they rise, tongues puffing out of phase (the real flicker rhythm), coloured by temperature along the blackbody curve (dull red → orange → yellow), with rising sparks. WATER: sunlight focused by real waves onto the bed (caustics computed from the refraction of a wave surface that obeys the deep-water dispersion law), over a darker parallax deep, with drifting sediment. NATURE: a slowly growing canopy with vein/branch networks, a far foliage layer, and floating pollen. `season` blends each toward its alternate (gas-blue flame · lagoon green · patchy autumn). Matte by design : no plasma, no glow blowouts.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "mode",     "TYPE": "long",  "VALUES": [0,1,2], "LABELS": ["fire","water","nature"], "DEFAULT": 0, "LABEL": "element" },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5,  "LABEL": "rate" },
    { "NAME": "scale",    "TYPE": "float", "MIN": 0.5, "MAX": 8.0, "DEFAULT": 2.5,  "LABEL": "scale" },
    { "NAME": "detail",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6,  "LABEL": "detail" },
    { "NAME": "flow",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5,  "LABEL": "flow" },
    { "NAME": "swirl",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.45, "LABEL": "swirl" },
    { "NAME": "depth",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4,  "LABEL": "depth" },
    { "NAME": "embers",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4,  "LABEL": "particles" },
    { "NAME": "vary",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "season" },
    { "NAME": "contrast", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0,  "LABEL": "contrast" }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
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

const mat2 R = mat2(0.8, 0.6, -0.6, 0.8);
// 5-octave fbm (main density) and a cheap 3-octave (for the flow field).
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = R * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = R * p * 2.05 + 7.3; a *= 0.5; }
  return s;
}

// Divergence-free curl of the noise field : a swirling, incompressible velocity
// (real turbulence, not a plain domain warp). This is the engine that makes the
// elements billow / eddy / grow rather than merely scroll.
vec2 curl(vec2 p) {
  float e = 0.09;
  float x1 = fbm3(p + vec2(0.0, e));
  float x2 = fbm3(p - vec2(0.0, e));
  float y1 = fbm3(p + vec2(e, 0.0));
  float y2 = fbm3(p - vec2(e, 0.0));
  return vec2(x1 - x2, -(y1 - y2)) / (2.0 * e);
}

// Aspect-correct drifting particle field. A persistent lattice of soft ROUND dots
// scrolls coherently along `dir` (the bulk drift : rise / settle / float) so
// particles enter and leave only at the screen edges (no mid-screen popping),
// while each one wanders independently and breathes in brightness so the field
// never reads as a moving grid. A 3×3 neighbourhood is accumulated so a dot near a
// cell edge still lights adjacent fragments (no clipping into squares/half-dots).
float particles(vec2 uv, float t, vec2 dir, float density, float baseSize) {
  if (density < 0.001) return 0.0;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float grid = mix(7.0, 20.0, density);
  vec2 sp = vec2(uv.x * aspect, uv.y) * grid - dir * t * grid; // square cells, drifting
  vec2 cell = floor(sp);
  float emit = mix(0.18, 0.55, density);                       // fraction of cells that spawn
  float acc = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cid = cell + vec2(float(x), float(y));
      if (hash(cid + 0.5) > emit) continue;
      vec2 r = hash2(cid);
      vec2 wob = vec2(sin(t * (0.6 + r.x) + r.y * 6.28),
                      cos(t * (0.5 + r.y) + r.x * 6.28)) * 0.16; // independent wander
      vec2 pos = cid + 0.15 + r * 0.7 + wob;                    // rest spot in the cell
      float d = length(sp - pos);
      float sz = baseSize * (0.55 + r.x * 0.9);                 // varied radii
      float br = 0.35 + 0.65 * (0.5 + 0.5 * sin(t * (1.1 + r.y * 2.0) + r.x * 6.28));
      acc += smoothstep(sz, 0.0, d) * br;
    }
  }
  return clamp(acc, 0.0, 1.0);
}

// ── FIRE: buoyant curl-advected flames, hot column base, licking tops, sparks ──
vec3 fire(vec2 uv, vec2 p, float t) {
  // Buoyancy accelerates the gas : the vertical axis is compressed with height,
  // so a steady scroll in q runs faster (and stretches taller) up the screen.
  vec2 ps = vec2(p.x, p.y * (1.0 - 0.38 * uv.y));
  vec2 rise = vec2(0.0, -t * (1.4 + rate) * (0.5 + flow));
  vec2 q = ps + rise;
  for (int i = 0; i < 2; i++) {
    vec2 v = curl(q * 0.8 + vec2(0.0, t * 0.3));
    v.y -= 0.8; // buoyancy : the flame wants up
    q += v * (0.05 + swirl * 0.28);
  }
  float n = fbm(q * vec2(1.0, 0.6));
  n += (fbm(q * 2.4) - 0.5) * detail * 0.8;
  // Puffing : a flame's height pulses at ~1-3 Hz (Cetegen & Ahmed), neighbouring
  // tongues out of phase, so the fire breathes instead of streaming.
  float puffPh = og_vnoise(vec2(p.x * 0.6, 3.7)) * 6.2832;
  float puff = 0.84 + 0.16 * sin(t * 7.5 / sqrt(max(scale, 0.5)) + puffPh);
  float col = 1.5 - uv.y * 1.25 / puff;        // hot at the base, sparse up top
  float body = clamp(pow(max(n * col, 0.0) * 1.5, 0.75 + contrast), 0.0, 1.0);
  // Rising sparks are hot bits of the SAME fire : raise the local HEAT before the
  // ramp colours it, so a spark is an ember-coloured hot spot IN-FAMILY (not a
  // separate brighter dot a palette/finish would tint differently — which is why
  // they were reading green). Capped into the orange band so they stay warm.
  float sp = particles(uv, t, vec2(0.04, 0.55), embers, 0.14);
  body = max(body, sp * (1.2 - uv.y) * embers * 0.72);
  // A dim wide back-glow layer for depth (kept matte, never additive white).
  float back = fbm(p * 0.6 + rise * 0.5) * (1.3 - uv.y) * depth * 0.4;
  vec3 c = vec3(0.02, 0.012, 0.01) + vec3(0.10, 0.03, 0.012) * back;
  // Colour from temperature on the blackbody curve (~900 K dull red to ~2300 K
  // yellow-white), brightness rising with it : true flame colours, matte cap.
  // Colour from temperature on the blackbody curve (~900 K dull red to ~2700 K
  // yellow), brightness rising with it : true flame colours, matte cap.
  float b = clamp(body, 0.0, 1.0);
  float kelvin = mix(900.0, 2700.0, pow(b, 1.1));
  float radiance = pow(smoothstep(0.05, 0.9, b), 1.2);
  c = mix(c, og_blackbody(kelvin) * (0.3 + 0.67 * radiance), clamp(radiance * 1.4, 0.0, 1.0));
  vec3 gas = vec3(0.10, 0.30, 0.62) * (0.25 + body * 1.1);
  return mix(c, gas, vary * 0.85);
}

// ── WATER: flowing caustic surface over a darker parallax deep + sediment ──
vec3 water(vec2 uv, vec2 p, float t) {
  vec2 dir = vec2(0.16, 0.06) * (0.4 + flow);
  // Caustics : the bed catches sunlight focused by the waves. A sum of wave
  // trains (speed from deep-water dispersion) gives the surface slope and its
  // curvature; where the refracted rays converge (the Jacobian of the mapping
  // surface → bed goes to 0) the light piles into bright lines.
  vec2 grad = vec2(0.0);
  vec3 hess = vec3(0.0);
  for (int k = 0; k < 16; k++) {
    float fk = float(k);
    float r1 = og_hash(vec2(fk, 2.9)), r2 = og_hash(vec2(fk, 6.1)), r3 = og_hash(vec2(fk, 8.3));
    float ang = 0.36 + (r1 - 0.5) * mix(2.0, 6.2832, swirl);
    vec2 d = vec2(cos(ang), sin(ang));
    float lam = exp(mix(-2.3, 0.0, r2));
    float kk = 6.2832 / lam;
    float w = sqrt(9.8 * kk) * 0.3 * (0.4 + flow);
    float a = lam * 0.012 * (0.6 + 0.8 * r3);
    float ph = dot(d, p) * kk - w * t + r3 * 6.2832;
    float s = sin(ph);
    grad += a * kk * cos(ph) * d;
    hess += -a * kk * kk * s * vec3(d.x * d.x, d.y * d.y, d.x * d.y);
  }
  float D = 0.06 + 0.3 * detail;                   // how deep the bed is (focus)
  float det = (1.0 + D * hess.x) * (1.0 + D * hess.y) - D * D * hess.z * hess.z;
  float focus = min(1.0 / max(abs(det), 0.05), 9.0);
  float caust = pow(clamp((focus - 0.8) / 5.0, 0.0, 1.0), 1.0 / max(contrast, 0.5));
  vec2 q = p + D * grad + dir * t * 0.3;           // the bed, seen through the refraction
  // Drifting sediment / bubbles : fold into the caustic brightness so they glow in
  // the water's own tint (in-family), never as separate foreign-coloured dots.
  float mote = particles(uv, t, vec2(0.05, -0.10), embers * 0.8, 0.09);
  caust = max(caust, mote * embers * 0.7);
  // Deep parallax layer : slower, offset, tinted down for recession.
  vec2 dp = q * (1.0 - depth * 0.4) + dir * t * 0.4 + 5.0;
  float deep = fbm(dp * 0.5);
  vec3 c = mix(vec3(0.010, 0.045, 0.070), vec3(0.05, 0.17, 0.21), deep);
  c *= mix(1.0, 0.65, depth * (1.0 - deep));
  c += caust * vec3(0.22, 0.40, 0.42) * (0.35 + detail * 0.65);
  vec3 lagoon = mix(vec3(0.02, 0.09, 0.05), vec3(0.10, 0.34, 0.22), deep)
    + caust * vec3(0.30, 0.44, 0.28) * (0.35 + detail * 0.65);
  return mix(c, lagoon, vary);
}

// ── NATURE: growing canopy + vein/branch net + far foliage + drifting pollen ──
vec3 nature(vec2 uv, vec2 p, float t) {
  vec2 q = p;
  for (int i = 0; i < 2; i++) q += curl(q * 0.6 + t * 0.03) * (0.06 + swirl * 0.32) * (0.5 + flow);
  float veins = pow(clamp(1.0 - abs(2.0 * fbm(q * 1.8) - 1.0), 0.0, 1.0), 3.5);
  float canopy = fbm(q + vec2(t * 0.05, t * 0.02));
  float cells = (fbm(q * 3.2) - 0.5) * detail;
  float g = pow(clamp(canopy * 0.85 + cells * 0.8 + 0.08, 0.0, 1.0), contrast);
  // Drifting pollen / slow-falling leaves : raise the canopy highlight so they read
  // as bright leaf specks in the foliage's OWN colour (in-family), not foreign dots.
  float mote = particles(uv, t, vec2(0.03, -0.06), embers * 0.7, 0.10);
  g = max(g, mote * embers * 0.85);
  vec3 moss = mix(vec3(0.045, 0.085, 0.038), vec3(0.16, 0.32, 0.11), g);
  vec3 c = mix(moss, vec3(0.40, 0.50, 0.19), smoothstep(0.62, 0.95, g) * 0.65);
  c = mix(c, vec3(0.23, 0.155, 0.075), veins * 0.6);
  // Far foliage : darkens the canopy gaps so the mass reads in depth.
  float far = fbm(p * (1.0 + depth * 0.6) * 1.2 + 5.0);
  c = mix(c, c * 0.45, depth * smoothstep(0.5, 0.0, g) * far);
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
  else if (mode == 1) c = water(uv, p, t);
  else c = nature(uv, p, t);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
