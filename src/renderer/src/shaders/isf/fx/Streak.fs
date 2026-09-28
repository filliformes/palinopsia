/*{
  "DESCRIPTION": "Streak : uniform directional blur (16 taps along an angle). The utility motion-smear: unlike Smear it is not luma-gated, so it reads as camera drag rather than pixel-sort. SMOOTH sets the grain of the streak: 0 = discrete ghost copies (the stepped look), 1 = a continuous blur (the taps are jittered per pixel, trading the steps for a fine grain).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Blur"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "reach", "TYPE": "float", "MIN": 0.0, "MAX": 0.3,    "DEFAULT": 0.05 },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0 },
    { "NAME": "smoothing", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "smooth" }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 dir = vec2(cos(angle), sin(angle));
  const int TAPS = 16;
  // Interleaved gradient noise (Jimenez 2014) : a per-pixel offset that slides
  // every tap between its fixed steps, so SMOOTH fills the gaps between the
  // ghost copies with a fine, even grain.
  float jn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 acc = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float fi = float(i);
    // centered −0.5..+0.5 : fixed steps (0) or jittered between them (1)
    float f = mix(fi / float(TAPS - 1), (fi + jn) / float(TAPS), smoothing) - 0.5;
    vec2 c = uv + dir * f * reach;
    vec4 s = IMG_NORM_PIXEL(inputImage, c);
    // Weighted by coverage : a keyed layer's transparent (black) pixels do not
    // bleed in as dark fringes.
    acc += s.rgb * s.a;
    a += s.a;
  }
  gl_FragColor = vec4(acc / max(a, 1e-4), a / float(TAPS));
}
