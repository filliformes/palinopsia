/*{
  "DESCRIPTION": "CRT Screen : a whole-tube finish (Cathodemer CRT surface): barrel curvature, edge-increasing chromatic aberration, scanline grille, corner vignette, and a rounded bezel that blacks out beyond the glass. The 'projected on a tube' master stage : pairs with Grain/Scanlines under it.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Stylize", "Master"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "curve",      "TYPE": "float", "MIN": 0.0, "MAX": 0.6, "DEFAULT": 0.15 },
    { "NAME": "aberration", "TYPE": "float", "MIN": 0.0, "MAX": 0.05,"DEFAULT": 0.008 },
    { "NAME": "scanline",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25 },
    { "NAME": "vignette",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4 },
    { "NAME": "corner",     "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.06 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);

  // Barrel warp: push the image out toward the edges (glass curvature).
  vec2 warped = uv + c * r2 * curve;

  // Chromatic aberration grows with radius, along the radial direction.
  float ab = aberration * r2 * 40.0;
  vec2 cr = warped + c * ab;
  vec2 cb = warped - c * ab;
  float rr = IMG_NORM_PIXEL(inputImage, cr).r;
  float gg = IMG_NORM_PIXEL(inputImage, warped).g;
  float bb = IMG_NORM_PIXEL(inputImage, cb).b;
  vec3 col = vec3(rr, gg, bb);

  // Scanline grille (darkening only : no glow).
  float line = 0.5 + 0.5 * sin(warped.y * RENDERSIZE.y * 3.14159);
  col *= 1.0 - scanline * line * 0.5;

  // Corner vignette.
  col *= 1.0 - vignette * smoothstep(0.15, 0.5, r2);

  // Rounded bezel : black outside the glass (on the warped coords).
  vec2 q = abs(warped - 0.5) - (0.5 - corner);
  float bezel = length(max(q, 0.0)) - corner;
  col *= 1.0 - smoothstep(0.0, 0.004, bezel);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
