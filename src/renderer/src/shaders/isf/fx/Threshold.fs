/*{
  "DESCRIPTION": "Threshold : luma key to hard two-tone with a soft knee and optional invert. The matte high-contrast reduction; chain Palette after it for colored keys, or use on a source before blending to carve shapes.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Stylize"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "level",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
    { "NAME": "soft",   "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.08 },
    { "NAME": "invert", "TYPE": "bool",  "DEFAULT": false }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  float v = smoothstep(level - soft, level + soft, l);
  if (invert) v = 1.0 - v;
  gl_FragColor = vec4(vec3(v), src.a);
}
