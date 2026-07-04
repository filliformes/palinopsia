/*{
  "DESCRIPTION": "Transform — zoom / pan / rotate the sampling frame, wrap or clamp at the edges. The compositional utility: place and scale a source inside the layer before FX and blending.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Utility"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "zoom",   "TYPE": "float", "MIN": 0.25, "MAX": 4.0,   "DEFAULT": 1.0 },
    { "NAME": "posX",   "TYPE": "float", "MIN": -1.0, "MAX": 1.0,   "DEFAULT": 0.0 },
    { "NAME": "posY",   "TYPE": "float", "MIN": -1.0, "MAX": 1.0,   "DEFAULT": 0.0 },
    { "NAME": "rotate", "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": 0.0 },
    { "NAME": "wrap",   "TYPE": "bool",  "DEFAULT": true }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  // Inverse transform: centre, un-rotate, un-zoom, un-pan.
  vec2 p = uv - 0.5;
  p.x *= aspect;
  float cs = cos(-rotate);
  float sn = sin(-rotate);
  p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
  p /= max(zoom, 0.001);
  p.x /= aspect;
  vec2 c = p + 0.5 - vec2(posX, posY) * 0.5;

  if (wrap) {
    c = fract(c);
  } else {
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  }
  gl_FragColor = IMG_NORM_PIXEL(inputImage, c);
}
