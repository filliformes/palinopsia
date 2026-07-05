/*{
  "DESCRIPTION": "Erosion — sediment washing down a slope: strongly anisotropic ridged noise advected downward, carving streaks that gather and split. The geological register: slow, directional, matte.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Noise", "Organic"],
  "INPUTS": [
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 5.0,  "DEFAULT": 0.3 },
    { "NAME": "scale",    "TYPE": "float", "MIN": 0.5, "MAX": 8.0,  "DEFAULT": 2.5 },
    { "NAME": "streaks",  "TYPE": "float", "MIN": 1.0, "MAX": 12.0, "DEFAULT": 5.0 },
    { "NAME": "carve",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.6 },
    { "NAME": "sediment", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "tint",     "TYPE": "color", "DEFAULT": [0.72, 0.6, 0.45, 1.0] }
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
  float t = TIME * rate * 0.3;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  // Anisotropic domain: x compressed by `streaks`, y flowing downward.
  vec2 p = vec2(uv.x * aspect * scale * streaks, uv.y * scale - t);

  // Two-octave ridged noise = the channels; a slow lateral wander makes
  // streams gather and split as they descend.
  float wanderX = (vnoise(vec2(uv.y * 2.0 - t * 0.5, 7.3)) - 0.5) * 1.5;
  float n1 = vnoise(p + vec2(wanderX, 0.0));
  float n2 = vnoise(p * 2.3 + vec2(wanderX * 2.0, 11.0));
  float ridge = 1.0 - abs(2.0 * (n1 * 0.7 + n2 * 0.3) - 1.0);

  // Carve: channels darken sharply where the ridge peaks.
  float channel = pow(ridge, 2.0 + carve * 6.0);

  // Sediment banks: broad mid-tone mass between channels.
  float banks = vnoise(vec2(p.x * 0.3, uv.y * scale * 0.6 - t * 0.4)) * sediment;

  vec3 base = vec3(0.03, 0.028, 0.026);
  vec3 col = base + tint.rgb * (banks * 0.5 + channel * 0.75);
  gl_FragColor = vec4(col, 1.0);
}
