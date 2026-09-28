/*{
  "DESCRIPTION": "Pixelate : mosaic quantization of the sampling grid, aspect-correct. Each cell takes the color of its center pixel (crisp, and it sparkles as detail moves through the cell : the digital read); `average` blends toward the mean of four taps inside the cell for a calmer mosaic. Digital texture, not retro-game nostalgia: pair with Posterize/Dither for the synthify register.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "cells", "TYPE": "float", "MIN": 8.0, "MAX": 400.0, "DEFAULT": 120.0 },
    { "NAME": "average", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "average" }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 grid = vec2(cells, cells / aspect);
  vec2 q = (floor(uv * grid) + 0.5) / grid;
  vec4 c = IMG_NORM_PIXEL(inputImage, q);
  if (average > 0.0) {
    // Four taps at ±1/4 cell (bare-identifier coordinates : the parser splits
    // IMG_NORM_PIXEL's arguments on commas).
    vec2 h = 0.25 / grid;
    vec2 q0 = q + vec2(-h.x, -h.y);
    vec2 q1 = q + vec2( h.x, -h.y);
    vec2 q2 = q + vec2(-h.x,  h.y);
    vec2 q3 = q + vec2( h.x,  h.y);
    vec4 s0 = IMG_NORM_PIXEL(inputImage, q0);
    vec4 s1 = IMG_NORM_PIXEL(inputImage, q1);
    vec4 s2 = IMG_NORM_PIXEL(inputImage, q2);
    vec4 s3 = IMG_NORM_PIXEL(inputImage, q3);
    // Alpha-weighted mean (straight alpha : transparent taps don't darken it).
    float aSum = s0.a + s1.a + s2.a + s3.a;
    vec3 rgb = (s0.rgb * s0.a + s1.rgb * s1.a + s2.rgb * s2.a + s3.rgb * s3.a) / max(aSum, 1e-4);
    vec4 m = vec4(aSum > 1e-4 ? rgb : c.rgb, aSum * 0.25);
    c = mix(c, m, average);
  }
  gl_FragColor = c;
}
