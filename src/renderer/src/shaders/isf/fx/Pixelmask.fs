/*{
  "DESCRIPTION": "Pixelmask : stencil the image through a pattern (aperture grille / shadow mask / dots / grid / noise): the picture only shows where the mask is lit, everything else darkens. The RGB-triad shadow-mask option splits the pattern into red/green/blue stripes for a real tube-phosphor read. Scale is in 1080p pixels and snaps to whole pixels, so the pattern holds its size at 4K and stays crisp at the smallest scales.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Texture", "Scan"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "pattern", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["grille", "shadowmask", "dots", "grid", "noise"], "DEFAULT": 0 },
    { "NAME": "scale",  "TYPE": "float", "MIN": 1.0, "MAX": 12.0, "DEFAULT": 3.0 },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.6 },
    { "NAME": "invert", "TYPE": "bool",  "DEFAULT": false }
  ]
}*/

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  // Cell size in WHOLE pixels, scaled by the frame height (`scale` is in 1080p
  // pixels : the pattern keeps its size at 4K and on the dome). Patterns are
  // evaluated per integer pixel : sampled at pixel centers, the old sine grille
  // was flat at scale 1-2 and the grid never lit below scale 4.
  float s = max(floor(scale * RENDERSIZE.y / 1080.0 + 0.5), 1.0);
  float P = max(s, 2.0);                  // periodic patterns need 2 px at least
  vec2 k = floor(gl_FragCoord.xy);        // integer pixel
  vec2 m = mod(k, P);                     // pixel inside its period

  vec3 mask = vec3(1.0);
  if (pattern == 0) {
    // Vertical aperture grille (the sine taken at the pixel's edge, so even a
    // 2-px period alternates dark / lit).
    mask = vec3(0.35 + 0.65 * abs(sin(m.x / P * 3.14159)));
  } else if (pattern == 1) {
    // RGB shadow mask : three phosphor stripes, pure (a pixel lights one channel).
    float col3 = mod(floor(k.x / s), 3.0);
    mask = vec3(step(col3, 0.5), step(abs(col3 - 1.0), 0.5), step(2.5, col3 + 0.5));
    // vertical gaps between rows
    mask *= 0.4 + 0.6 * abs(sin(m.y / P * 3.14159));
  } else if (pattern == 2) {
    // Round dots, centered on a pixel (a 2-px period gives one lit pixel in four).
    vec2 f = (m - floor(P * 0.5)) / P;
    mask = vec3(1.0 - smoothstep(0.25, 0.45, length(f)));
  } else if (pattern == 3) {
    // Thin grid lines : whole pixels along each cell's border, a quarter of the
    // cell wide (at least one pixel).
    vec2 g = mod(k, s);
    float lw = max(1.0, floor(0.25 * s + 0.5));
    mask = vec3(1.0 - step(lw, min(g.x, g.y)));
  } else {
    // Static noise stencil.
    mask = vec3(step(0.5, hash(floor(k / s))));
  }

  if (invert) mask = 1.0 - mask;
  vec3 col = src.rgb * mix(vec3(1.0), mask, amount);
  gl_FragColor = vec4(col, src.a);
}
