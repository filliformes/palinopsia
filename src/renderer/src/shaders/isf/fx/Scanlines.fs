/*{
  "DESCRIPTION": "Scanlines : line darkening as controlled texture (obs-shaderfilter register), with optional slow roll. Signature element, kept matte: darkening only, no glow.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "count",    "TYPE": "float", "MIN": 50.0, "MAX": 1200.0, "DEFAULT": 400.0 },
    { "NAME": "darkness", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.25 },
    { "NAME": "roll",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 c = IMG_NORM_PIXEL(inputImage, uv);
  float phase = uv.y * count + TIME * roll * 8.0;
  float line = 0.5 + 0.5 * sin(phase * 3.14159 * 2.0);
  float dim = 1.0 - darkness * line;
  gl_FragColor = vec4(c.rgb * dim, c.a);
}
