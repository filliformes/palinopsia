/*{
  "DESCRIPTION": "Drift Field : a slow directional value-noise flow, posterized into matte bands over near-black, carrying a single accent tint and a restrained chroma-split at band edges. Asymmetric and matte by design: the disciplined generative/procedural register (brief §1), NOT kaleidoscope, plasma, or neon-on-void. Palinopsia seed generator.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Noise", "Glitch"],
  "INPUTS": [
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 20.0,  "DEFAULT": 0.15 },
    { "NAME": "scale",    "TYPE": "float", "MIN": 0.5, "MAX": 8.0,  "DEFAULT": 2.6 },
    { "NAME": "warp",     "TYPE": "float", "MIN": 0.0, "MAX": 1.5,  "DEFAULT": 0.55 },
    { "NAME": "steps",    "TYPE": "float", "MIN": 2.0, "MAX": 16.0, "DEFAULT": 5.0 },
    { "NAME": "contrast", "TYPE": "float", "MIN": 0.5, "MAX": 2.0,  "DEFAULT": 1.15 },
    { "NAME": "split",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.25 },
    { "NAME": "tint",     "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0] }
  ]
}*/

// --- value noise + fbm (matte, band-friendly; no neon gradients) ----------
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

float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 5; k++) {
    s += a * vnoise(p);
    p = p * 2.02 + 7.1;
    a *= 0.5;
  }
  return s;
}

// The posterized scalar field. Sampled at slightly offset coords per channel
// to give the chroma-split without a separate blur pass.
float field(vec2 uv) {
  vec2 aspect = vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0);
  vec2 p = (uv - 0.5) * aspect * scale;
  float t = TIME * rate;
  // Asymmetric directional drift + domain warp (never radial symmetry).
  vec2 flow = vec2(fbm(p + t), fbm(p.yx - t * 0.6));
  float n = fbm(p + warp * flow + vec2(t * 0.8, -t * 0.3));
  n = pow(clamp(n, 0.0, 1.0), contrast);
  return floor(n * steps) / steps; // matte bands
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float off = split * 0.02;
  float r = field(uv + vec2(off, 0.0));
  float g = field(uv);
  float b = field(uv - vec2(off, 0.0));

  // Near-black base, one accent tint pushed only through the band values.
  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 col = base + tint.rgb * vec3(r, g, b) * 0.9;

  // Faint scanline signature : controlled texture, never spectacle.
  col *= 0.94 + 0.06 * sin(uv.y * RENDERSIZE.y * 3.14159);

  gl_FragColor = vec4(col, 1.0);
}
