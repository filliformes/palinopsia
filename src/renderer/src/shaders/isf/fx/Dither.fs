/*{
  "DESCRIPTION": "Ordered Dither : 4×4 Bayer-matrix dithering at a chosen dot scale (in 1080p pixels, so it holds at 4K), quantizing into few levels. The libretro/common-shaders dithering register: matte texture, not noise spectacle.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "levels", "TYPE": "float", "MIN": 2.0, "MAX": 8.0,  "DEFAULT": 3.0 },
    { "NAME": "scale",  "TYPE": "float", "MIN": 1.0, "MAX": 8.0,  "DEFAULT": 2.0 },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 1.0 }
  ]
}*/

float bayer4(vec2 p) {
  // 4×4 Bayer matrix via bit arithmetic-free lookup (ES 1.00 safe).
  vec2 q = floor(mod(p, 4.0));
  float i = q.x + q.y * 4.0;
  // Row-major 4×4 Bayer values 0..15.
  float v = 0.0;
  if (i < 0.5) v = 0.0;  else if (i < 1.5) v = 8.0;  else if (i < 2.5) v = 2.0;  else if (i < 3.5) v = 10.0;
  else if (i < 4.5) v = 12.0; else if (i < 5.5) v = 4.0;  else if (i < 6.5) v = 14.0; else if (i < 7.5) v = 6.0;
  else if (i < 8.5) v = 3.0;  else if (i < 9.5) v = 11.0; else if (i < 10.5) v = 1.0; else if (i < 11.5) v = 9.0;
  else if (i < 12.5) v = 15.0; else if (i < 13.5) v = 7.0; else if (i < 14.5) v = 13.0; else v = 5.0;
  return (v + 0.5) / 16.0;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 c = IMG_NORM_PIXEL(inputImage, uv);
  // Dot cell in WHOLE pixels, scaled by the frame height : `scale` is in 1080p
  // pixels, so the screen keeps its size at 4K and on the dome, and a fractional
  // scale (dice, modulation) no longer mixes 2- and 3-px cells.
  float s = max(floor(scale * RENDERSIZE.y / 1080.0 + 0.5), 1.0);
  float threshold = bayer4(floor(gl_FragCoord.xy / s));
  // Whole levels : a fractional count pushed white off the ramp (a gray checker).
  float steps = max(floor(levels + 0.5) - 1.0, 1.0);
  vec3 dithered = floor(c.rgb * steps + threshold) / steps;
  gl_FragColor = vec4(mix(c.rgb, dithered, amount), c.a);
}
