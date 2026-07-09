/*{
  "DESCRIPTION": "Pixelmask : stencil the image through a pattern (aperture grille / shadow mask / dot / line / bayer / noise): the picture only shows where the mask is lit, everything else darkens. The RGB-triad shadow-mask option splits the pattern into red/green/blue stripes for a real tube-phosphor read (Cathodemer pixelmask register).",
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
  vec2 px = gl_FragCoord.xy / max(scale, 1.0);

  vec3 mask = vec3(1.0);
  if (pattern == 0) {
    // Vertical aperture grille.
    mask = vec3(0.35 + 0.65 * abs(sin(px.x * 3.14159)));
  } else if (pattern == 1) {
    // RGB shadow mask : three phosphor stripes.
    float col3 = mod(floor(px.x), 3.0);
    mask = vec3(step(col3, 0.5), step(abs(col3 - 1.0), 0.5), step(2.5, col3 + 0.5));
    mask = mix(vec3(0.3), mask, 1.0);
    // vertical gaps between rows
    mask *= 0.4 + 0.6 * abs(sin(px.y * 3.14159));
  } else if (pattern == 2) {
    // Round dots.
    vec2 f = fract(px) - 0.5;
    mask = vec3(1.0 - smoothstep(0.25, 0.45, length(f)));
  } else if (pattern == 3) {
    // Thin grid lines.
    vec2 f = abs(fract(px) - 0.5);
    mask = vec3(smoothstep(0.35, 0.5, max(f.x, f.y)));
  } else {
    // Static noise stencil.
    mask = vec3(step(0.5, hash(floor(px))));
  }

  if (invert) mask = 1.0 - mask;
  vec3 col = src.rgb * mix(vec3(1.0), mask, amount);
  gl_FragColor = vec4(col, src.a);
}
