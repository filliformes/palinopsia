/*{
  "DESCRIPTION": "Difference Bloom : frame-difference motion key (a video-feedback lineage): only what MOVED between frames survives, spread softly outward. Still areas fall to near-black; motion reads as matte contour light. `keep` fades the source back in behind the motion.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "gain",   "TYPE": "float", "MIN": 0.5, "MAX": 8.0, "DEFAULT": 3.0 },
    { "NAME": "spread", "TYPE": "float", "MIN": 0.0, "MAX": 0.05,"DEFAULT": 0.012 },
    { "NAME": "keep",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "tint",   "TYPE": "color", "DEFAULT": [0.8, 0.85, 0.9, 1.0] }
  ],
  "PASSES": [
    { "TARGET": "hist", "PERSISTENT": true },
    { }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    // Store the current frame for the next frame's difference.
    gl_FragColor = IMG_NORM_PIXEL(inputImage, uv);
  } else {
    // hist here reads the PREVIOUS frame (buffer flips at end of frame).
    // Soft spatial spread: 8 offsets, keep the strongest motion.
    float m = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) / 8.0 * 6.2832;
      vec2 o = uv + vec2(cos(a), sin(a)) * spread;
      vec3 cur = IMG_NORM_PIXEL(inputImage, o).rgb;
      vec3 old = IMG_NORM_PIXEL(hist, o).rgb;
      m = max(m, length(cur - old));
    }
    m = clamp(m * gain, 0.0, 1.0);
    vec4 src = IMG_NORM_PIXEL(inputImage, uv);
    vec3 base = vec3(0.02, 0.02, 0.025);
    vec3 motion = base + tint.rgb * m;
    gl_FragColor = vec4(mix(motion, src.rgb, keep * (1.0 - m)), src.a);
  }
}
