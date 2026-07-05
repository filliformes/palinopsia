/*{
  "DESCRIPTION": "Membrane — one large soft mass slowly deforming in the dark: a domain-warped low-frequency field thresholded into a breathing silhouette, interior shaded by depth, edge softness adjustable. The organism register: near-black, one body, no symmetry.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0,  "MAX": 20.0, "DEFAULT": 0.15 },
    { "NAME": "mass",     "TYPE": "float", "MIN": 0.2,  "MAX": 0.8, "DEFAULT": 0.45 },
    { "NAME": "warp",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.5, "DEFAULT": 0.6 },
    { "NAME": "softness", "TYPE": "float", "MIN": 0.01, "MAX": 0.5, "DEFAULT": 0.12 },
    { "NAME": "veins",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.3 },
    { "NAME": "tint",     "TYPE": "color", "DEFAULT": [0.55, 0.5, 0.6, 1.0] }
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

float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * vnoise(p);
    p = p * 2.02 + 7.1;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = (uv - vec2(0.45, 0.52)) * vec2(aspect, 1.0); // off-centre body
  float t = TIME * rate;

  // The body field: low-frequency fbm, warped by itself — a breathing blob
  // that never resolves into a circle.
  vec2 flow = vec2(fbm(p * 1.2 + t * 0.3), fbm(p.yx * 1.2 - t * 0.25));
  float field = fbm(p * 1.4 + warp * flow + vec2(t * 0.2, -t * 0.15));
  // Radial falloff keeps ONE mass rather than a texture.
  field -= length(p) * 0.55;

  // Silhouette with a soft edge.
  float body = smoothstep(0.5 - mass * 0.5, 0.5 - mass * 0.5 + softness, field + 0.25);

  // Interior depth shading + faint vein structure inside.
  float depth = smoothstep(0.2, 0.8, field + 0.25);
  float vein = (1.0 - abs(2.0 * fbm(p * 4.0 + flow * 2.0 + t * 0.1) - 1.0));
  vein = pow(vein, 5.0) * veins;

  vec3 base = vec3(0.02, 0.02, 0.028);
  vec3 col = base + tint.rgb * body * (0.25 + depth * 0.45 + vein * 0.5);
  gl_FragColor = vec4(col, 1.0);
}
