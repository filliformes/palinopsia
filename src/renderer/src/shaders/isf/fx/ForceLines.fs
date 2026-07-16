/*{
  "DESCRIPTION": "Force Lines : incrustation along the image's own lines of force. The picture is banded by its luminance contours and each band SLIDES along the local gradient's tangent (alternating directions), so the image is cut and inlaid along its own structure : ribbons following the forms, not a grid. EDGE darkens the contour boundaries into engraved incrust lines; GATE confines the cutting to where there is real structure (gradient energy), leaving flat areas untouched. Distinct from Autocutter (cells) : these cuts FOLLOW the image.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Distort"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "lines",  "TYPE": "float", "MIN": 2.0,  "MAX": 24.0, "DEFAULT": 8.0,  "LABEL": "contour bands" },
    { "NAME": "shift",  "TYPE": "float", "MIN": 0.0,  "MAX": 0.08, "DEFAULT": 0.02, "LABEL": "slide" },
    { "NAME": "edge",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.5,  "LABEL": "incrust lines" },
    { "NAME": "gate",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.5,  "LABEL": "structure gate" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 1.0,  "LABEL": "mix" }
  ]
}*/

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 px = 1.0 / RENDERSIZE;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);

  // Local luminance gradient (central differences, 2px reach for stability).
  float ll = luma(IMG_NORM_PIXEL(inputImage, uv - vec2(px.x * 2.0, 0.0)).rgb);
  float lr = luma(IMG_NORM_PIXEL(inputImage, uv + vec2(px.x * 2.0, 0.0)).rgb);
  float ld = luma(IMG_NORM_PIXEL(inputImage, uv - vec2(0.0, px.y * 2.0)).rgb);
  float lu = luma(IMG_NORM_PIXEL(inputImage, uv + vec2(0.0, px.y * 2.0)).rgb);
  vec2 grad = vec2(lr - ll, lu - ld);
  float gm = length(grad);
  vec2 dir = grad / max(gm, 1e-4);
  vec2 tang = vec2(-dir.y, dir.x); // along the iso-contour : the line of force

  // Contour bands of the local luminance : each band slides along the tangent,
  // alternating direction, so adjacent ribbons shear against each other.
  float l0 = luma(src.rgb);
  float band = fract(l0 * lines);
  float side = step(0.5, fract(floor(l0 * lines) * 0.5)) * 2.0 - 1.0;

  // Structure gate : flat areas (no gradient) keep still; edges cut hard.
  float g = mix(1.0, smoothstep(0.008, 0.05, gm), gate);

  vec2 suv = clamp(uv + tang * side * shift * g, 0.0, 1.0);
  vec3 col = IMG_NORM_PIXEL(inputImage, suv).rgb;

  // Incrust lines : engrave the band boundaries dark (only where gated in).
  float lineMask = smoothstep(0.0, 0.07, band) * (1.0 - smoothstep(0.93, 1.0, band));
  col *= mix(1.0, mix(1.0, lineMask, g), edge);

  gl_FragColor = vec4(mix(src.rgb, col, amount), src.a);
}
