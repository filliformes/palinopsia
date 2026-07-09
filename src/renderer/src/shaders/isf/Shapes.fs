/*{
  "DESCRIPTION": "Shapes : hard-edged primitive fields (circle / ring / bar / cross / triangle), tiled and animatable. A Lumen-style shape generator: use it as a matte source, or on layer B keyed through A (the mixer's lumakey) as a mask/stencil. Single accent over near-black.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry"],
  "INPUTS": [
    { "NAME": "shape", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["circle", "ring", "bar", "cross", "triangle"], "DEFAULT": 0 },
    { "NAME": "count", "TYPE": "float", "MIN": 1.0, "MAX": 24.0, "DEFAULT": 4.0 },
    { "NAME": "size",  "TYPE": "float", "MIN": 0.05,"MAX": 0.9,  "DEFAULT": 0.5 },
    { "NAME": "soft",  "TYPE": "float", "MIN": 0.0, "MAX": 0.5,  "DEFAULT": 0.05 },
    { "NAME": "rate",  "TYPE": "float", "MIN": 0.0, "MAX": 20.0,  "DEFAULT": 0.2 },
    { "NAME": "invert","TYPE": "bool",  "DEFAULT": false },
    { "NAME": "tint",  "TYPE": "color", "DEFAULT": [0.85, 0.86, 0.82, 1.0] }
  ]
}*/

float shapeSDF(vec2 q, float r, float t) {
  if (shape == 0) return length(q) - r;                       // circle
  if (shape == 1) return abs(length(q) - r) - r * 0.18;       // ring
  if (shape == 2) return max(abs(q.x) - r, abs(q.y) - r * 0.28); // bar
  if (shape == 3) return min(max(abs(q.x) - r, abs(q.y) - r * 0.2),
                             max(abs(q.y) - r, abs(q.x) - r * 0.2)); // cross
  // triangle (rotating)
  float a = t;
  vec2 p = vec2(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a));
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float t = TIME * rate;

  vec2 g = vec2(uv.x * aspect, uv.y) * count;
  vec2 cell = fract(g) - 0.5;
  float pulse = 0.5 + 0.5 * sin(t + dot(floor(g), vec2(1.3, 2.1)));
  float r = size * 0.5 * mix(0.7, 1.0, pulse);

  float d = shapeSDF(cell, r, t);
  float v = 1.0 - smoothstep(-soft, soft, d);
  if (invert) v = 1.0 - v;

  vec3 base = vec3(0.02, 0.02, 0.025);
  gl_FragColor = vec4(base + tint.rgb * v, 1.0);
}
