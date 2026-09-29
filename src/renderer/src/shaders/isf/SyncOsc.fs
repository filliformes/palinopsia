/*{
  "DESCRIPTION": "Sync Osc : a morphing video-synth oscillator. One waveform drawn across the whole frame MORPHS continuously on the shape knob (saw → triangle → sine). SYNC works like an analog sync knob : from 0 to the middle the scrolling lines slow to a frozen horizontal hold, from the middle to the top the frozen lines turn to vertical. AUDIO FM bends every line with the live waveform (the classic video-synth audio input). Colorized between two tints by level : matte.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Analog", "Scan"],
  "INPUTS": [
    { "NAME": "freq",    "TYPE": "float", "MIN": 1.0, "MAX": 60.0,   "DEFAULT": 12.0 },
    { "NAME": "shape",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.5, "LABEL": "saw↔tri↔sine" },
    { "NAME": "sync",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.2, "LABEL": "scroll↔hold↔vertical" },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0, "MAX": 4.0,    "DEFAULT": 0.4 },
    { "NAME": "angle",   "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0 },
    { "NAME": "audioFM", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.0, "LABEL": "audio FM" },
    { "NAME": "loA",     "TYPE": "color", "DEFAULT": [0.04, 0.05, 0.08, 1.0] },
    { "NAME": "hiA",     "TYPE": "color", "DEFAULT": [0.85, 0.82, 0.7, 1.0] },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// ∫ rate·(1 − smoothstep(0, 0.5, sync)) dt : the scroll phase (engine/phases.ts),
// so turning rate or sync changes the speed from here on, never the position.
uniform float PH_syncScroll;

// Continuous waveform morph : saw (0) → triangle (0.5) → sine (1). The sine is
// in phase with the triangle (both peak at p = 0), so the crossfade never
// cancels to flat grey. w = one pixel in cycles : the saw's reset edge ramps
// down over it instead of jagging when the lines are rotated.
float wave(float p, float sh, float w) {
  p = fract(p);
  float saw = p * (1.0 - smoothstep(1.0 - w, 1.0, p));
  float tri = abs(p * 2.0 - 1.0);
  float sine = 0.5 + 0.5 * cos(p * 6.2832);
  return sh < 0.5 ? mix(saw, tri, sh * 2.0) : mix(tri, sine, (sh - 0.5) * 2.0);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  // Centred, so freq zooms about the middle of the frame.
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float cs = cos(angle), sn = sin(angle);
  vec2 p = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);

  // SYNC : 0 → 0.5 slows the scroll to a stop (lines stay horizontal, see
  // PH_syncScroll); 0.5 → 1 turns the frozen lines to vertical.
  float a = smoothstep(0.5, 1.0, sync) * 1.5708;
  vec2 across = vec2(sin(a), cos(a));
  float axis = dot(p, across);                       // the wave runs across the lines
  float along = dot(p, vec2(across.y, -across.x));   // position along one line
  float motion = 3.0 * fract(PH_syncScroll);         // 3·fract(x) ≡ 3x (mod 1)

  // AUDIO FM : the live waveform (row 0) shifts each point of every line by
  // its own sample, so the lines bend with the sound and settle in silence.
  float u = clamp(along / length(vec2(aspect, 1.0)) + 0.5, 0.0, 1.0);
  vec2 ac = vec2(u, 0.25);
  float wav = (IMG_NORM_PIXEL(audioTex, ac).r - 0.5) * 2.0;

  float w = clamp(1.5 * freq / RENDERSIZE.y, 0.0, 0.5);
  float v = wave(axis * freq + motion + audioFM * wav, shape, w);

  vec3 col = mix(loA.rgb, hiA.rgb, v);
  gl_FragColor = vec4(col, 1.0);
}
