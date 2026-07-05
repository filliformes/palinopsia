/*{
  "DESCRIPTION": "Wavefold — analog wavefolder on the video signal: drive the value up and repeatedly reflect it back inside [0,1], carving hard contour bands out of smooth gradients (West-coast/LZX signal folding). Luma-fold recolours by the source hue; per-channel folds tear the colour apart. Matte contour, not neon.",
  "CREDIT": "Palinopsia (after analog wavefolders / LZX)",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color", "Scan"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "fold",       "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4 },
    { "NAME": "bias",       "TYPE": "float", "MIN": -0.5,"MAX": 0.5, "DEFAULT": 0.0 },
    { "NAME": "symmetry",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
    { "NAME": "perChannel", "TYPE": "bool",  "DEFAULT": false },
    { "NAME": "wet",        "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 }
  ]
}*/

float foldv(float v) {
  v = v * (1.0 + fold * 5.0) + bias;
  // asymmetric pre-shape then triangle fold to [0,1]
  v = mix(v, v * v * sign(v), symmetry * 0.5);
  return abs(fract(v * 0.5) * 2.0 - 1.0);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  vec3 outc;
  if (perChannel) {
    outc = vec3(foldv(src.r), foldv(src.g), foldv(src.b));
  } else {
    float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));
    float fl = foldv(l);
    // Re-apply the folded luma while keeping the source's chroma direction.
    outc = src.rgb * (fl / max(l, 1e-3));
  }
  gl_FragColor = vec4(clamp(mix(src.rgb, outc, wet), 0.0, 1.0), src.a);
}
