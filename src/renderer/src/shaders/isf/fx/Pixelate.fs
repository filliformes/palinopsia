/*{
  "DESCRIPTION": "Pixelate — mosaic quantization of the sampling grid, aspect-correct. Digital texture, not retro-game nostalgia: pair with Posterize/Dither for the synthify register.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "cells", "TYPE": "float", "MIN": 8.0, "MAX": 400.0, "DEFAULT": 120.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 grid = vec2(cells, cells / aspect);
  vec2 q = (floor(uv * grid) + 0.5) / grid;
  gl_FragColor = IMG_NORM_PIXEL(inputImage, q);
}
