/*{
  "DESCRIPTION": "Mycelium — a thin branching network revealed by a growth front expanding from an off-centre seed, then dissolving and regrowing elsewhere. Ridged-noise hyphae, hair-thin and matte; the cycle is the organism's life.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0,  "MAX": 5.0,  "DEFAULT": 0.25 },
    { "NAME": "scale",   "TYPE": "float", "MIN": 1.0,  "MAX": 10.0, "DEFAULT": 4.0 },
    { "NAME": "width",   "TYPE": "float", "MIN": 0.02, "MAX": 0.5,  "DEFAULT": 0.12 },
    { "NAME": "density", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.5 },
    { "NAME": "front",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "tint",    "TYPE": "color", "DEFAULT": [0.85, 0.82, 0.7, 1.0] }
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
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = uv * vec2(aspect, 1.0);
  float t = TIME * rate;

  // Life cycle: each cycle re-seeds the colony somewhere else.
  float cycle = floor(t * 0.15);
  float phase = fract(t * 0.15); // 0 → growing, →1 fully grown then reset
  vec2 seed = vec2(0.2 + hash(vec2(cycle, 1.0)) * 0.6 * aspect,
                   0.2 + hash(vec2(cycle, 7.0)) * 0.6);

  // Hyphae: two ridged-noise webs at different scales — thin where the ridge
  // peaks. The web itself crawls very slowly (growth is the visible motion).
  vec2 q = p * scale + cycle * 13.7;
  float r1 = 1.0 - abs(2.0 * vnoise(q + t * 0.05) - 1.0);
  float r2 = 1.0 - abs(2.0 * vnoise(q * 2.7 + 31.0 - t * 0.03) - 1.0);
  float web = max(pow(r1, 8.0 - width * 12.0), pow(r2, 10.0 - width * 12.0) * 0.7);
  // Density gates which filaments exist at all.
  web *= step(1.0 - density, vnoise(q * 0.5 + 51.0));

  // Growth front: an irregular expanding disc from the seed; hyphae fade in
  // just behind the front and are strongest at the frontier.
  float dist = length(p - seed);
  float radius = phase * 1.6;
  float edgeNoise = (vnoise(p * 6.0 + cycle * 3.0) - 0.5) * front * 0.5;
  float grown = smoothstep(radius, radius - 0.25, dist + edgeNoise);
  float frontier = smoothstep(0.12, 0.0, abs(dist + edgeNoise - radius)) * 0.6;

  float lum = web * grown + frontier * web;

  vec3 base = vec3(0.022, 0.022, 0.02);
  vec3 col = base + tint.rgb * lum * 0.85;
  gl_FragColor = vec4(col, 1.0);
}
