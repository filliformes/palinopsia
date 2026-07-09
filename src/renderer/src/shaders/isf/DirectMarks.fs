/*{
  "DESCRIPTION": "Direct Marks : hand-drawn direct-film marks. Ruled lines, dots, or scratches, flat ink on paper, appearing intermittently on a GATE you can drive from audio or coupling for marks-on-the-beat. Hard-edged and linear, never radial. Matte ink over near-black paper (brief §1).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry"],
  "INPUTS": [
    { "NAME": "markType", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["lines", "dots", "scratch"], "DEFAULT": 0 },
    { "NAME": "angle",   "TYPE": "float", "MIN": 0.0,  "MAX": 6.2832, "DEFAULT": 0.0 },
    { "NAME": "density", "TYPE": "float", "MIN": 2.0,  "MAX": 120.0,  "DEFAULT": 20.0 },
    { "NAME": "weight",  "TYPE": "float", "MIN": 0.02, "MAX": 0.6,    "DEFAULT": 0.28, "LABEL": "weight" },
    { "NAME": "gate",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 1.0,  "LABEL": "gate" },
    { "NAME": "jitter",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.3,  "LABEL": "hand jitter" },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0,  "MAX": 8.0,    "DEFAULT": 1.5,  "LABEL": "flicker" },
    { "NAME": "ink",     "TYPE": "color", "DEFAULT": [0.9, 0.89, 0.83, 1.0] },
    { "NAME": "paper",   "TYPE": "color", "DEFAULT": [0.04, 0.04, 0.05, 1.0] }
  ]
}*/

float h11(float x) { return fract(sin(x * 91.7) * 43758.5453); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 c = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
  float s = sin(angle), co = cos(angle);
  vec2 r = mat2(co, -s, s, co) * c + 0.5;

  int mt = int(markType);
  float m = 0.0;   // mark coverage
  float seed = 0.0; // per-mark id for the gate flicker

  if (mt == 0) {
    // ruled lines : a band around each line centre, hand-wobbled spacing.
    float idx = floor(r.x * density);
    float jx = (h11(idx) - 0.5) * jitter * 0.4 / density;
    float band = abs(fract((r.x + jx) * density) * 2.0 - 1.0);
    m = 1.0 - step(weight, band);
    seed = idx * 2.3;
  } else if (mt == 1) {
    // dots : a disc per grid cell, hand-nudged off centre.
    vec2 cell = floor(r * density);
    vec2 g = fract(r * density) - 0.5;
    g += (vec2(h21(cell), h21(cell + 7.0)) - 0.5) * jitter * 0.5;
    m = 1.0 - step(weight * 0.9, length(g));
    seed = dot(cell, vec2(1.3, 2.1));
  } else {
    // scratches : only some columns present, wobbling and broken vertically.
    float idx = floor(r.x * density);
    float present = step(0.62, h11(idx * 3.1));
    float wob = (h21(vec2(floor(r.y * 8.0), idx)) - 0.5) * jitter * 0.03;
    float band = abs(fract((r.x + wob) * density) * 2.0 - 1.0);
    m = present * (1.0 - step(weight * 0.5, band));
    m *= step(0.35, h21(vec2(idx, floor(r.y * 10.0)))); // broken up the frame
    seed = idx * 1.9;
  }

  // GATE : each mark blinks on a per-mark oscillator; `gate` sets how many are on
  // (1 = all). Drive it from audio/coupling for the marks-on-the-beat.
  float flick = 0.5 + 0.5 * sin(TIME * rate + seed);
  float on = step(1.0 - gate, flick);

  gl_FragColor = vec4(mix(paper.rgb, ink.rgb, clamp(m * on, 0.0, 1.0)), 1.0);
}
