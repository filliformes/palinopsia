/*{
  "DESCRIPTION": "Ringing — compression ghost edges: alternating-sign high-pass echoes repeat at a fixed distance along a direction (DCT ringing / over-sharpened broadcast). Structure haunted by its own edges.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "gap",       "TYPE": "float", "MIN": 0.001, "MAX": 0.05,   "DEFAULT": 0.008 },
    { "NAME": "intensity", "TYPE": "float", "MIN": 0.0,   "MAX": 2.0,    "DEFAULT": 0.7 },
    { "NAME": "angle",     "TYPE": "float", "MIN": 0.0,   "MAX": 6.2832, "DEFAULT": 0.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  vec2 dir = vec2(cos(angle), sin(angle));

  // High-pass at each echo distance, added with alternating sign and decay.
  vec3 acc = src.rgb;
  float sign_ = 1.0;
  for (int i = 1; i <= 3; i++) {
    float f = float(i);
    vec2 cA = uv - dir * gap * f;
    vec2 cB = uv - dir * gap * (f + 0.5);
    vec3 hp = IMG_NORM_PIXEL(inputImage, cA).rgb - IMG_NORM_PIXEL(inputImage, cB).rgb;
    acc += hp * sign_ * intensity * (1.0 / f);
    sign_ = -sign_;
  }
  gl_FragColor = vec4(clamp(acc, 0.0, 1.0), src.a);
}
