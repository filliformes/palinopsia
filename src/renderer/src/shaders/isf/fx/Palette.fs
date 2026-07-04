/*{
  "DESCRIPTION": "Palette — re-color by mapping luminance through a 2–5 stop gradient, with band/blend morph and ordered-dither breakup. The complex-coloring tool: build duotones, tritones, and full matte palettes; MIX returns some of the source color.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "stops",  "TYPE": "float", "MIN": 2.0, "MAX": 5.0, "DEFAULT": 3.0 },
    { "NAME": "blend",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 },
    { "NAME": "dither", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "mixSrc", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "colorA", "TYPE": "color", "DEFAULT": [0.02, 0.02, 0.03, 1.0] },
    { "NAME": "colorB", "TYPE": "color", "DEFAULT": [0.35, 0.12, 0.45, 1.0] },
    { "NAME": "colorC", "TYPE": "color", "DEFAULT": [0.16, 0.82, 0.74, 1.0] },
    { "NAME": "colorD", "TYPE": "color", "DEFAULT": [0.92, 0.85, 0.72, 1.0] },
    { "NAME": "colorE", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0] }
  ]
}*/

float bayer4(vec2 p) {
  vec2 q = floor(mod(p, 4.0));
  float i = q.x + q.y * 4.0;
  float v = 0.0;
  if (i < 0.5) v = 0.0;  else if (i < 1.5) v = 8.0;  else if (i < 2.5) v = 2.0;  else if (i < 3.5) v = 10.0;
  else if (i < 4.5) v = 12.0; else if (i < 5.5) v = 4.0;  else if (i < 6.5) v = 14.0; else if (i < 7.5) v = 6.0;
  else if (i < 8.5) v = 3.0;  else if (i < 9.5) v = 11.0; else if (i < 10.5) v = 1.0; else if (i < 11.5) v = 9.0;
  else if (i < 12.5) v = 15.0; else if (i < 13.5) v = 7.0; else if (i < 14.5) v = 13.0; else v = 5.0;
  return (v + 0.5) / 16.0;
}

vec3 stopColor(float idx) {
  if (idx < 0.5) return colorA.rgb;
  if (idx < 1.5) return colorB.rgb;
  if (idx < 2.5) return colorC.rgb;
  if (idx < 3.5) return colorD.rgb;
  return colorE.rgb;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = clamp(dot(src.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);

  // Ordered-dither breakup of the luminance before it hits the palette —
  // the classic way to keep few stops from banding flatly.
  float n = floor(stops + 0.5);
  l += (bayer4(gl_FragCoord.xy) - 0.5) * dither / max(n - 1.0, 1.0);
  l = clamp(l, 0.0, 1.0);

  // Position within the gradient.
  float t = l * (n - 1.0);
  float i = floor(min(t, n - 1.001));
  float f = fract(t);
  // blend 0 → hard bands (posterized palette) · 1 → smooth gradient map.
  float k = mix(step(0.5, f), f, blend);
  vec3 mapped = mix(stopColor(i), stopColor(i + 1.0), k);

  gl_FragColor = vec4(mix(mapped, src.rgb, mixSrc), src.a);
}
