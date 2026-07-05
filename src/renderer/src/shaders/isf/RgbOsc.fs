/*{
  "DESCRIPTION": "RGB Oscillators — Cathodemer-style video-synth colour: each channel is its own 2D oscillator (waveform × spatial frequency × phase), the three detuned against each other so colour separates into drifting interference. The analog-video register (brief §5, opt-in): kept matte (mid-tone scaled, no neon floor).",
  "CREDIT": "Palinopsia (after Cathodemer RGB oscillators)",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Scan"],
  "INPUTS": [
    { "NAME": "waveform", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["sine", "triangle", "square"], "DEFAULT": 0 },
    { "NAME": "freq",     "TYPE": "float", "MIN": 0.5, "MAX": 40.0, "DEFAULT": 6.0 },
    { "NAME": "spread",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.25 },
    { "NAME": "symmetry", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.5 },
    { "NAME": "angle",    "TYPE": "float", "MIN": 0.0, "MAX": 6.2832,"DEFAULT": 0.3 },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 5.0,  "DEFAULT": 0.3 },
    { "NAME": "level",    "TYPE": "float", "MIN": 0.2, "MAX": 1.0,  "DEFAULT": 0.8 }
  ]
}*/

float osc(float x, float wf) {
  float p = fract(x);
  if (wf < 0.5) return 0.5 + 0.5 * sin(p * 6.2832);
  if (wf < 1.5) return abs(p * 2.0 - 1.0);
  return step(0.5, p);
}

// One channel: mix of a horizontal and vertical oscillator (symmetry blends
// the axes), at frequency f with time/phase offset ph. `waveform` is an ISF
// 'long' → a GLSL `int` uniform, so cast it before the float-typed osc().
float chan(vec2 p, float f, float ph, float t) {
  float wf = float(waveform);
  float h = osc(p.x * f + t + ph, wf);
  float v = osc(p.y * f - t * 0.9 + ph * 1.3, wf);
  return mix(h, v, symmetry);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float cs = cos(angle), sn = sin(angle);
  vec2 p = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
  float t = TIME * rate;

  // Three detuned frequencies so R/G/B never lock — the colour crawls.
  float r = chan(p, freq, 0.0, t);
  float g = chan(p, freq * (1.0 + spread * 0.35), 2.1, t * 1.07);
  float b = chan(p, freq * (1.0 + spread * 0.7), 4.2, t * 0.93);

  vec3 col = vec3(r, g, b) * level;
  gl_FragColor = vec4(col, 1.0);
}
