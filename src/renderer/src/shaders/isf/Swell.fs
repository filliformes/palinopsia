/*{
  "DESCRIPTION": "Swell — an open water surface seen as pure luminance: several directional wave trains beating plus fbm chop, no horizon, no sky. Chop sharpens crests toward foam; matte greys with a single tint.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic", "Noise"],
  "INPUTS": [
    { "NAME": "rate",      "TYPE": "float", "MIN": 0.0, "MAX": 5.0,    "DEFAULT": 0.4 },
    { "NAME": "scale",     "TYPE": "float", "MIN": 1.0, "MAX": 12.0,   "DEFAULT": 4.0 },
    { "NAME": "chop",      "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.4 },
    { "NAME": "direction", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.6 },
    { "NAME": "spread",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.35 },
    { "NAME": "tint",      "TYPE": "color", "DEFAULT": [0.5, 0.62, 0.65, 1.0] }
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
  vec2 p = uv * vec2(aspect, 1.0) * scale;
  float t = TIME * rate;

  // Four wave trains fanned around the main direction, incommensurate
  // frequencies so the surface never loops.
  float h = 0.0;
  float amp = 0.5;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    float a = direction + (hash(vec2(fk, 3.0)) - 0.5) * spread * 2.5;
    vec2 dir = vec2(cos(a), sin(a));
    float freq = 1.0 + fk * 0.83;
    float sp = (0.5 + hash(vec2(fk, 9.0)) * 0.8) * 1.4;
    h += amp * sin(dot(p, dir) * freq + t * sp + hash(vec2(fk, 5.0)) * 6.28);
    amp *= 0.62;
  }
  h = h * 0.5 + 0.5;

  // Chop: fbm detail + crest sharpening (pow) toward foam.
  float detail = vnoise(p * 2.5 + t * 0.6) * 0.5 + vnoise(p * 5.3 - t * 0.4) * 0.25;
  h = mix(h, h * 0.7 + detail * 0.45, 0.5);
  float lum = pow(clamp(h, 0.0, 1.0), 1.0 + chop * 3.0);
  // Foam flecks on the sharpest crests.
  float foam = smoothstep(0.75, 0.95, lum) * chop;

  vec3 base = vec3(0.02, 0.024, 0.028);
  vec3 col = base + tint.rgb * lum * 0.6 + vec3(0.85, 0.88, 0.88) * foam * 0.35;
  gl_FragColor = vec4(col, 1.0);
}
