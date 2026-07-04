/*{
  "DESCRIPTION": "Solarize — fold tones above a threshold back down (Sabattier register). Matte tonal inversion, not neon: strength keeps the fold partial.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "level",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6 },
    { "NAME": "strength", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.85 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  vec3 c = src.rgb;
  // Per-channel fold: values above the level mirror around it.
  vec3 folded = mix(c, level * 2.0 - c, step(vec3(level), c));
  folded = clamp(folded, 0.0, 1.0);
  gl_FragColor = vec4(mix(c, folded, strength), src.a);
}
