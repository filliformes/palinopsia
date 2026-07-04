/*{
  "DESCRIPTION": "Smear — pseudo pixel-sort: bright pixels streak along a direction with decaying taps (haxademic/ciphrd approximation; true compute pixel-sort arrives with WebGPU, brief §15.1). Threshold gates the effect to highlights so the smear reads as structure, not blur.",
  "CREDIT": "Palinopsia (after cacheflowe/haxademic pseudo pixel-sort)",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "reach",    "TYPE": "float", "MIN": 0.0, "MAX": 0.3,    "DEFAULT": 0.08 },
    { "NAME": "threshold", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.45 },
    { "NAME": "angle",     "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 1.5708 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);

  vec2 dir = vec2(cos(angle), sin(angle));
  const int TAPS = 24;

  // Walk backwards along the smear direction, accumulating samples whose
  // luminance clears the threshold — bright material streaks, dark holds.
  vec3 acc = src.rgb;
  float wsum = 1.0;
  for (int i = 1; i <= TAPS; i++) {
    float f = float(i) / float(TAPS);
    vec2 c = uv - dir * f * reach;
    vec4 s = IMG_NORM_PIXEL(inputImage, c);
    float l = dot(s.rgb, vec3(0.299, 0.587, 0.114));
    float gate = smoothstep(threshold, threshold + 0.15, l);
    float w = gate * (1.0 - f);
    acc += s.rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, src.a);
}
