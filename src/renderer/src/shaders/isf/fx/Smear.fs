/*{
  "DESCRIPTION": "Smear : pseudo pixel-sort: bright pixels streak along a direction with decaying taps. Threshold gates the effect to highlights so the smear reads as structure, not blur. SMOOTH sets the grain of the streak: 0 = a comb of discrete ghost copies (the stepped look), 1 = a continuous streak (the taps are jittered per pixel, trading the steps for a fine grain). For a true sort, see Pixel Sort.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "reach",    "TYPE": "float", "MIN": 0.0, "MAX": 0.3,    "DEFAULT": 0.08 },
    { "NAME": "threshold", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.45 },
    { "NAME": "angle",     "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 1.5708 },
    { "NAME": "smoothing", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.0, "LABEL": "smooth" }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);

  vec2 dir = vec2(cos(angle), sin(angle));
  const int TAPS = 24;
  // Interleaved gradient noise (Jimenez 2014) : a per-pixel offset that slides
  // every tap between its fixed steps, so SMOOTH fills the gaps between the
  // ghost copies with a fine, even grain.
  float jn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float jit = jn * smoothing;

  // Walk backwards along the smear direction, accumulating samples whose
  // luminance clears the threshold : bright material streaks, dark holds.
  vec3 acc = src.rgb;
  float wsum = 1.0;
  for (int i = 1; i <= TAPS; i++) {
    float f = (float(i) - jit) / float(TAPS);
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
