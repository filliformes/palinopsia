/*{
  "DESCRIPTION": "Streak : uniform directional blur (16 taps along an angle). The utility motion-smear: unlike Smear it is not luma-gated, so it reads as camera drag rather than pixel-sort.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Blur"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "reach", "TYPE": "float", "MIN": 0.0, "MAX": 0.3,    "DEFAULT": 0.05 },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 dir = vec2(cos(angle), sin(angle));
  const int TAPS = 16;
  vec3 acc = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float f = (float(i) / float(TAPS - 1)) - 0.5; // centered −0.5..+0.5
    vec2 c = uv + dir * f * reach;
    vec4 s = IMG_NORM_PIXEL(inputImage, c);
    acc += s.rgb;
    a += s.a;
  }
  gl_FragColor = vec4(acc / float(TAPS), a / float(TAPS));
}
