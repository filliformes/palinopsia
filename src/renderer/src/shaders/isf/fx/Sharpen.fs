/*{
  "DESCRIPTION": "Sharpen : 3×3 unsharp mask. The utility detail lift: makes dithers bite and posterized bands snap after soft passes. The kernel keeps its reach at 1080p, 4K and on the dome.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Utility"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 20.0, "DEFAULT": 0.8 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  // Taps one 1080p pixel apart at any output size (2 px at 4K), so upscaled
  // content still sharpens instead of the kernel shrinking below its detail.
  vec2 px = max(1.0, floor(RENDERSIZE.y / 1080.0 + 0.5)) / RENDERSIZE;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);

  vec2 cl = uv + vec2(-px.x, 0.0);
  vec2 cr = uv + vec2(px.x, 0.0);
  vec2 cu = uv + vec2(0.0, px.y);
  vec2 cd = uv + vec2(0.0, -px.y);
  vec3 blur =
    (IMG_NORM_PIXEL(inputImage, cl).rgb +
     IMG_NORM_PIXEL(inputImage, cr).rgb +
     IMG_NORM_PIXEL(inputImage, cu).rgb +
     IMG_NORM_PIXEL(inputImage, cd).rgb +
     src.rgb) / 5.0;

  vec3 sharp = src.rgb + (src.rgb - blur) * amount;
  gl_FragColor = vec4(clamp(sharp, 0.0, 1.0), src.a);
}
