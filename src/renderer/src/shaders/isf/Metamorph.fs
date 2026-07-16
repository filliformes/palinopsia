/*{
  "DESCRIPTION": "Metamorph : birth-from-within (Blu's Muto register). A solid organic silhouette lives on screen; each cycle a NEW form is born from a point inside the old one, grows, and replaces it — endless metamorphosis, every shape emerging from its predecessor's body rather than cutting to it. Blobby warped forms, matte white-on-black (recolour with the layer / Vibe). WOBBLE boils the outline; COMPLEXITY warps the body; DRIFT lets the lineage wander around the frame (never centred).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "rate",       "TYPE": "float", "MIN": 0.02, "MAX": 1.0,  "DEFAULT": 0.15, "LABEL": "births / sec" },
    { "NAME": "size",       "TYPE": "float", "MIN": 0.05, "MAX": 0.6,  "DEFAULT": 0.28, "LABEL": "size" },
    { "NAME": "wobble",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.45, "LABEL": "boil" },
    { "NAME": "complexity", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.5,  "LABEL": "complexity" },
    { "NAME": "drift",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.4,  "LABEL": "wander" },
    { "NAME": "inner",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.3,  "LABEL": "inner shading" }
  ]
}*/

float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i), b = hash2(i + vec2(1.0, 0.0)), c = hash2(i + vec2(0.0, 1.0)), d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

// The lineage's centre for generation `seed` : deterministic per generation,
// scattered off-centre (anti-mandala), gently wandering with `drift`.
vec2 centreOf(float seed, float aspect) {
  vec2 c = vec2(0.5) + 0.24 * vec2(sin(seed * 12.9898 + 1.7), cos(seed * 7.7331 + 4.1));
  c += drift * 0.08 * vec2(sin(TIME * 0.11 + seed * 3.1), cos(TIME * 0.13 + seed * 5.7));
  return c;
}

// Signed distance to one blobby organism : a circle whose radius is carved by
// fbm around its rim (boiling with time) + a domain warp for body complexity.
float blob(vec2 p, vec2 c, float r, float seed, float aspect) {
  vec2 d = (p - c) * vec2(aspect, 1.0);
  float ang = atan(d.y, d.x);
  float rim = fbm(vec2(ang * (1.0 + complexity * 2.0), seed * 9.7 + TIME * (0.15 + wobble * 0.5)));
  float rr = r * (1.0 + (rim - 0.5) * (0.35 + wobble * 0.7));
  // Body warp : the form bulges asymmetrically (a figure, not a disc).
  float body = fbm(d * (2.0 + complexity * 4.0) + seed * 3.3);
  rr *= 1.0 + (body - 0.5) * complexity * 0.5;
  return length(d) - rr;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  // Generation clock : old form (idx) gives birth to new form (idx+1).
  float ph = TIME * rate;
  float idx = floor(ph);
  float f = fract(ph);
  float grow = f * f * (3.0 - 2.0 * f); // eased birth

  // Old form : full size, dissolving late in the cycle as the child claims it.
  vec2 cA = centreOf(idx, aspect);
  float rA = size * (1.0 - smoothstep(0.55, 1.0, f) * 0.85);
  float sdA = blob(uv, cA, rA, idx, aspect);

  // New form : born INSIDE the old one (a point within its body), grows to full.
  vec2 birthDir = vec2(sin(hash1(idx + 1.0) * 6.2831), cos(hash1(idx + 7.0) * 6.2831));
  vec2 cB = cA + birthDir * size * 0.35;
  cB = mix(cB, centreOf(idx + 1.0, aspect), grow); // then wanders to its own place
  float rB = size * grow;
  float sdB = blob(uv, cB, rB, idx + 1.0, aspect);

  // The lineage : union of parent + child (they share flesh while the birth runs).
  float sd = min(sdA, sdB);
  float fill = 1.0 - smoothstep(-0.004, 0.004, sd);

  // Matte body : near-white silhouette with a faint interior shading (so the form
  // reads as a body, not a flat sticker). Recolourable by the layer / Vibe.
  float shade = 1.0 - inner * 0.5 * fbm(uv * 5.0 * vec2(aspect, 1.0) + idx * 2.2 + TIME * 0.05);
  vec3 col = vec3(0.92) * shade * fill;

  gl_FragColor = vec4(col, fill);
}
