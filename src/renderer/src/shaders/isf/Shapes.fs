/*{
  "DESCRIPTION": "Shapes : hard-edged primitive fields (circle / ring / bar / cross / triangle) on a grid centered on the frame, each cell dealt its own character by the seed : whether it is filled at all (density), when and how fast it breathes, which way its triangle turns, and (with spin) the angle and turn of its bar or cross. Reseed re-deals the whole field. Audio scatter lets each cell's size ride its own sample of the live waveform. Use it as a matte source, or on layer B keyed through A (the mixer's lumakey) as a mask or stencil. Single accent over near-black.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry"],
  "INPUTS": [
    { "NAME": "shape", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["circle", "ring", "bar", "cross", "triangle"], "DEFAULT": 0 },
    { "NAME": "count", "TYPE": "float", "MIN": 1.0, "MAX": 24.0, "DEFAULT": 4.0 },
    { "NAME": "size",  "TYPE": "float", "MIN": 0.05,"MAX": 0.9,  "DEFAULT": 0.5 },
    { "NAME": "soft",  "TYPE": "float", "MIN": 0.0, "MAX": 0.5,  "DEFAULT": 0.05 },
    { "NAME": "rate",  "TYPE": "float", "MIN": 0.0, "MAX": 20.0,  "DEFAULT": 0.2 },
    { "NAME": "density", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 },
    { "NAME": "spin",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0 },
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

// ∫ rate dt : breathing and turning follow a moving rate without jumping.
uniform float PH_rate;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Per-element audio : the shared waveform texture (row 0), ±1 around silence.
float aud(float idx01) {
  vec2 ac = vec2(fract(idx01), 0.25);
  return (IMG_NORM_PIXEL(audioTex, ac).r - 0.5) * 2.0;
}

vec2 rot2(vec2 q, float a) {
  float c = cos(a), s = sin(a);
  return vec2(q.x * c - q.y * s, q.x * s + q.y * c);
}

// Signed distance to the shape of radius r (q already turned into the cell's frame).
float shapeSDF(vec2 q, float r) {
  if (shape == 0) return length(q) - r;                       // circle
  if (shape == 1) return abs(length(q) - r) - r * 0.18;       // ring
  if (shape == 2) return max(abs(q.x) - r, abs(q.y) - r * 0.28); // bar
  if (shape == 3) return min(max(abs(q.x) - r, abs(q.y) - r * 0.2),
                             max(abs(q.y) - r, abs(q.x) - r * 0.2)); // cross
  // triangle
  const float k = 1.7320508;
  vec2 p = q;
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
  // A wrapped time base : every per-cell speed below is a multiple of 1/4, so
  // each one completes whole turns over 8π and the wrap is seamless.
  float tw = mod(PH_rate, 25.132741);

  // Rows fill the frame height exactly (count = rows, as the presets were tuned);
  // columns are centered on a middle cell, so the extra width at 16:9 splits
  // evenly between both sides instead of piling up on the right.
  vec2 g = vec2((uv.x - 0.5) * aspect * count + 0.5, uv.y * count);
  vec2 base0 = floor(g);
  vec2 f0 = fract(g);
  float cols = ceil(count * aspect);
  float s = max(soft, count / RENDERSIZE.y); // edge softness, floored at ~1 px

  // A shape (with its halo) can reach past its own cell, so each pixel takes
  // the strongest of the 3×3 neighbouring cells : nothing is cut at a border.
  float v = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 cid = base0 + o;
      vec2 id = cid + seedShift;  // reseed re-deals every cell's character
      vec2 q = f0 - 0.5 - o;      // this pixel, relative to that cell's center
      float h1 = hash12(id);
      float h2 = hash12(id + 17.0);
      float h3 = hash12(id + 41.0);
      float h4 = hash12(id + 7.0);
      if (h4 >= density) continue; // an empty cell
      // Breathing : its own phase and one of three speeds.
      float sp = 0.75 + 0.25 * floor(h2 * 3.0);
      float pulse = 0.5 + 0.5 * sin(tw * sp + h1 * 6.2832);
      // Its own live audio sample (adjacent cells read adjacent samples).
      float idx01 = (cid.y * cols + cid.x) / (cols * count);
      float r = size * 0.5 * mix(0.7, 1.0, pulse) * (1.0 + aud(idx01) * audioScatter * 0.6);
      // Turning : triangles always turn, each at its own speed and direction;
      // spin deals bars and crosses a fixed angle plus a slow turn of their own.
      float dir = h3 < 0.5 ? -1.0 : 1.0;
      float tsp = dir * (0.5 + 0.25 * floor(fract(h3 * 7.0) * 4.0));
      float a = spin * (h2 * 6.2832 + tw * dir * 0.25);
      if (shape == 4) a = tw * tsp + h1 * 6.2832;
      float d = shapeSDF(rot2(q, a), r);
      v = max(v, 1.0 - smoothstep(-s, s, d));
    }
  }
  if (invert) v = 1.0 - v;

  vec3 bg = vec3(0.02, 0.02, 0.025);
  gl_FragColor = vec4(bg + tint.rgb * v, 1.0);
}
