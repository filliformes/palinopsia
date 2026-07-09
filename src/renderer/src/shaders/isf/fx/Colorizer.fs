/*{
  "DESCRIPTION": "Colorizer : LZX-style CV colorizer: luminance is run through gain + bias (the analog 'contrast/brightness' of the mapping), optionally soft-clipped, then mapped across a smooth 3-colour gradient. Leaner and more voltage-like than the Palette map : the classic scan-processor colouring stage.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color", "Scan"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "gain",  "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0 },
    { "NAME": "bias",  "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "fold",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "mixSrc","TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "source mix" },
    { "NAME": "low",  "TYPE": "color", "DEFAULT": [0.05, 0.06, 0.12, 1.0] },
    { "NAME": "mid",  "TYPE": "color", "DEFAULT": [0.7, 0.3, 0.35, 1.0] },
    { "NAME": "high", "TYPE": "color", "DEFAULT": [0.95, 0.9, 0.7, 1.0] }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));

  // CV shaping: gain about mid-grey + bias.
  l = (l - 0.5) * gain + 0.5 + bias;
  // Optional soft fold of the over/under-range (analog wrap of the signal).
  float folded = abs(fract(l * 0.5) * 2.0 - 1.0);
  l = mix(clamp(l, 0.0, 1.0), folded, fold);

  // Smooth 3-stop gradient.
  vec3 col = l < 0.5 ? mix(low.rgb, mid.rgb, l * 2.0)
                     : mix(mid.rgb, high.rgb, (l - 0.5) * 2.0);
  gl_FragColor = vec4(mix(col, src.rgb, mixSrc), src.a);
}
