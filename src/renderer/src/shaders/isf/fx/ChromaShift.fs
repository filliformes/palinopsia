/*{
  "DESCRIPTION": "Chroma Shift : RGB split along a chosen axis. The restrained chromatic-aberration signature (brief §1): subtle at default, never spectacle.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 0.05,  "DEFAULT": 0.006 },
    { "NAME": "angle",  "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 dir = vec2(cos(angle), sin(angle)) * amount;
  vec2 cr = uv + dir;
  vec2 cb = uv - dir;
  vec4 c = IMG_NORM_PIXEL(inputImage, uv);
  vec4 r = IMG_NORM_PIXEL(inputImage, cr);
  vec4 b = IMG_NORM_PIXEL(inputImage, cb);
  gl_FragColor = vec4(r.r, c.g, b.b, c.a);
}
