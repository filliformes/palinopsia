/*{
  "DESCRIPTION": "Sync Osc — Lumen's signature oscillator: one waveform that MORPHS continuously (saw→triangle→sine on the shape knob), and a SYNC control that morphs the lines from freely scrolling → frozen-horizontal → frozen-vertical. Colorized between two tints by level. The most playable video-synth source — matte.",
  "CREDIT": "Palinopsia (after Lumen oscillators)",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Scan"],
  "INPUTS": [
    { "NAME": "freq",  "TYPE": "float", "MIN": 1.0,  "MAX": 60.0,  "DEFAULT": 12.0 },
    { "NAME": "shape", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.5, "LABEL": "saw↔tri↔sine" },
    { "NAME": "sync",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.3, "LABEL": "scroll↔H↔V" },
    { "NAME": "rate",  "TYPE": "float", "MIN": 0.0,  "MAX": 5.0,   "DEFAULT": 0.4 },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0,  "MAX": 6.2832,"DEFAULT": 0.0 },
    { "NAME": "loA",   "TYPE": "color", "DEFAULT": [0.04, 0.05, 0.08, 1.0] },
    { "NAME": "hiA",   "TYPE": "color", "DEFAULT": [0.85, 0.82, 0.7, 1.0] }
  ]
}*/

// Continuous waveform morph: saw (0) → triangle (0.5) → sine (1).
float wave(float p, float sh) {
  p = fract(p);
  float saw = p;
  float tri = abs(p * 2.0 - 1.0);
  float sine = 0.5 + 0.5 * sin((p - 0.25) * 6.2832);
  return sh < 0.5 ? mix(saw, tri, sh * 2.0) : mix(tri, sine, (sh - 0.5) * 2.0);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float cs = cos(angle), sn = sin(angle);
  vec2 p = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
  float t = TIME * rate;

  // Sync morphs the scan axis: 0 = horizontal lines scrolling in time,
  // 0.5 = frozen horizontal (no time term), 1 = frozen vertical.
  float axisH = p.y;
  float axisV = p.x;
  float axis = mix(axisH, axisV, smoothstep(0.5, 1.0, sync));
  // Time scroll fades out as sync approaches the frozen middle.
  float scroll = t * (1.0 - smoothstep(0.0, 0.5, sync)) * (1.0 - smoothstep(0.5, 1.0, sync) * 0.0);

  float v = wave(axis * freq + scroll, shape);

  vec3 col = mix(loA.rgb, hiA.rgb, v);
  gl_FragColor = vec4(col, 1.0);
}
