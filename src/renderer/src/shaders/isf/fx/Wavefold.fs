/*{
  "DESCRIPTION": "Wavefold : analog wavefolder on the video signal: drive the value up and repeatedly reflect it back inside [0,1], carving hard contour bands out of smooth gradients (West-coast signal folding). Luma-fold recolors by the source hue; per-channel folds tear the color apart; invert folds into the negative. Matte contour, not neon.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color", "Scan"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "fold",       "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4 },
    { "NAME": "bias",       "TYPE": "float", "MIN": -0.5,"MAX": 0.5, "DEFAULT": 0.0 },
    { "NAME": "symmetry",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "asymmetry" },
    { "NAME": "perChannel", "TYPE": "bool",  "DEFAULT": false },
    { "NAME": "wet",        "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 },
    { "NAME": "invert",     "TYPE": "bool",  "DEFAULT": false, "LABEL": "negative" }
  ]
}*/

float foldv(float v) {
  v = v * (1.0 + fold * 5.0) + bias;
  // asymmetric pre-shape (0 = a plain linear drive) then triangle fold to [0,1]
  v = mix(v, v * v * sign(v), symmetry * 0.5);
  // The triangle is the identity inside [0,1] and reflects at each end, so
  // black stays black. Without the leading `1. -` it mapped 0 to 1 : dark
  // grounds went pale and the luma ratio below blew shadow noise into white
  // speckle. That negative look is now the `invert` switch.
  float f = 1.0 - abs(fract(v * 0.5) * 2.0 - 1.0);
  return invert ? 1.0 - f : f;
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
    // Re-apply the folded luma while keeping the source's chroma. The ratio
    // keeps hue AND saturation, but on near-black pixels it multiplies 8-bit
    // noise by up to 1/l (bias 0.3 at l 0.01 = 30×) : the darkest pixels carry
    // their chroma additively instead, a smooth handover below l ≈ 0.1.
    vec3 ratio = src.rgb * (fl / max(l, 1e-3));
    vec3 add = src.rgb + (fl - l);
    outc = mix(add, ratio, smoothstep(0.02, 0.1, l));
  }
  gl_FragColor = vec4(clamp(mix(src.rgb, outc, wet), 0.0, 1.0), src.a);
}
