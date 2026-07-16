/*{
  "DESCRIPTION": "Shapes : hard-edged primitive fields (circle / ring / bar / cross / triangle), tiled and animatable. A hard-edged shape generator: use it as a matte source, or on layer B keyed through A (the mixer's lumakey) as a mask/stencil. Single accent over near-black.",
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
    { "NAME": "audioScatter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio scatter" },
    { "NAME": "tint",  "TYPE": "color", "DEFAULT": [0.85, 0.86, 0.82, 1.0] },
    { "NAME": "reseed","TYPE": "event", "LABEL": "reseed ▸" },
    { "NAME": "audioTex", "TYPE": "image" }
  ],
  "PASSES": [
    { "TARGET": "seedState", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { }
  ]
}*/

float hash2(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

// Per-element audio : the shared waveform texture (row 0), ±1 around silence.
float aud(float idx01) {
  return (IMG_NORM_PIXEL(audioTex, vec2(fract(idx01), 0.25)).r - 0.5) * 2.0;
}

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
  // Pass 0 : the 1×1 reseed latch (rising-edge → golden-ratio seed step).
  if (PASSINDEX == 0) {
    vec4 prev = IMG_NORM_PIXEL(seedState, vec2(0.5));
    float fire = (reseed && prev.y < 0.5) ? 1.0 : 0.0;
    float s = fract(prev.x + fire * (0.61803399 + fract(TIME * 0.7317)));
    gl_FragColor = vec4(s, reseed ? 1.0 : 0.0, 0.0, 1.0);
    return;
  }
  float seedShift = floor(IMG_NORM_PIXEL(seedState, vec2(0.5)).x * 89.0);

  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float t = TIME * rate;

  vec2 g = vec2(uv.x * aspect, uv.y) * count;
  vec2 cell = fract(g) - 0.5;
  vec2 id = floor(g) + seedShift; // reseed re-deals every cell's character
  // Each cell pulses on its own phase, and rides its OWN live audio sample
  // (adjacent cells read adjacent samples → the field breathes with the wave).
  float pulse = 0.5 + 0.5 * sin(t + dot(id, vec2(1.3, 2.1)) + hash2(id) * 6.2832);
  float idx01 = (id.y * ceil(count * aspect) + id.x) / (ceil(count * aspect) * count);
  float r = size * 0.5 * mix(0.7, 1.0, pulse) * (1.0 + aud(idx01) * audioScatter * 0.6);

  float d = shapeSDF(cell, r, t);
  float v = 1.0 - smoothstep(-soft, soft, d);
  if (invert) v = 1.0 - v;

  vec3 base = vec3(0.02, 0.02, 0.025);
  gl_FragColor = vec4(base + tint.rgb * v, 1.0);
}
