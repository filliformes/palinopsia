/*{
  "DESCRIPTION": "Solarize : invert everything whose LUMINANCE clears the level, with a soft knee (Sabattier register). Luma-keyed rather than per-channel so it reads clearly even on dark, matte compositions.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "level",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
    { "NAME": "strength", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.85 },
    { "NAME": "soft",     "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.12 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  float k = smoothstep(level - soft, level + soft, l);
  vec3 sol = mix(src.rgb, 1.0 - src.rgb, k * strength);
  gl_FragColor = vec4(sol, src.a);
}
