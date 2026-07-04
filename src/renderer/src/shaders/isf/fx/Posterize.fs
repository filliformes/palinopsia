/*{
  "DESCRIPTION": "Posterize — quantize tones into matte bands (gamma-aware). Core of the synthify chain (brief §4).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "levels", "TYPE": "float", "MIN": 2.0, "MAX": 32.0, "DEFAULT": 6.0 },
    { "NAME": "gamma",  "TYPE": "float", "MIN": 0.5, "MAX": 2.0,  "DEFAULT": 1.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 c = IMG_NORM_PIXEL(inputImage, uv);
  vec3 g = pow(max(c.rgb, 0.0), vec3(1.0 / gamma));
  g = floor(g * levels) / max(levels - 1.0, 1.0);
  g = pow(g, vec3(gamma));
  gl_FragColor = vec4(g, c.a);
}
