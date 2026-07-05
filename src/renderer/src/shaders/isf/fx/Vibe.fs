/*{
  "DESCRIPTION": "Vibe — the always-on end-of-chain color-mastering stage: gamma-shaped luminance mapped through a 2–5 stop palette (with dither breakup and source-color mix-back), then finishing controls — contrast, saturation, and a luma-driven sharpen. One unit that decides the whole output's look.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color", "Master"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "stops",      "TYPE": "float", "MIN": 2.0,  "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "color stops" },
    { "NAME": "blend",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "bands↔smooth" },
    { "NAME": "dither",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "dither breakup" },
    { "NAME": "mixSrc",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "source mix" },
    { "NAME": "gamma",      "TYPE": "float", "MIN": 0.4,  "MAX": 2.5, "DEFAULT": 1.0, "LABEL": "tone gamma" },
    { "NAME": "contrast",   "TYPE": "float", "MIN": 0.25, "MAX": 2.5, "DEFAULT": 1.0 },
    { "NAME": "saturation", "TYPE": "float", "MIN": 0.0,  "MAX": 2.0, "DEFAULT": 1.0 },
    { "NAME": "sharpen",    "TYPE": "float", "MIN": 0.0,  "MAX": 2.0, "DEFAULT": 0.0 },
    { "NAME": "colorA", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0] },
    { "NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0] },
    { "NAME": "colorC", "TYPE": "color", "DEFAULT": [0.5, 0.5, 0.5, 1.0] },
    { "NAME": "colorD", "TYPE": "color", "DEFAULT": [0.75, 0.75, 0.75, 1.0] },
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

float lumaAt(vec2 c) {
  vec4 s = IMG_NORM_PIXEL(inputImage, c);
  return dot(s.rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = clamp(dot(src.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);

  // Luma sharpen BEFORE the map — detail survives even hard 2-stop palettes.
  if (sharpen > 0.001) {
    vec2 px = 1.0 / RENDERSIZE;
    vec2 cl = uv + vec2(-px.x, 0.0);
    vec2 cr = uv + vec2(px.x, 0.0);
    vec2 cu = uv + vec2(0.0, px.y);
    vec2 cd = uv + vec2(0.0, -px.y);
    float blur = (lumaAt(cl) + lumaAt(cr) + lumaAt(cu) + lumaAt(cd)) * 0.25;
    l = clamp(l + (l - blur) * sharpen, 0.0, 1.0);
  }

  // Tone gamma shapes WHERE the palette stops land on the image.
  l = pow(l, gamma);

  // Ordered-dither breakup before the map.
  float n = floor(stops + 0.5);
  l += (bayer4(gl_FragCoord.xy) - 0.5) * dither / max(n - 1.0, 1.0);
  l = clamp(l, 0.0, 1.0);

  // The palette map.
  float t = l * (n - 1.0);
  float i = floor(min(t, n - 1.001));
  float f = fract(t);
  float k = mix(step(0.5, f), f, blend);
  vec3 col = mix(stopColor(i), stopColor(i + 1.0), k);

  // Source color mix-back, then the finishing pair.
  col = mix(col, src.rgb, mixSrc);
  col = (col - 0.5) * contrast + 0.5;
  float l2 = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l2), col, saturation);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
}
