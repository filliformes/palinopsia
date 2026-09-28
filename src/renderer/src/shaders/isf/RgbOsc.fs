/*{
  "DESCRIPTION": "RGB Oscillators : video-synth color: each channel is its own 2D oscillator (one shared waveform, its own spatial frequency and phase, a third of a cycle apart), the three detuned against each other so color separates into drifting interference. Level is a plain gain and chroma pulls the color toward gray, so it can sit matte. Audio FM bends the stripes into the live waveform.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Scan"],
  "INPUTS": [
    { "NAME": "waveform", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["sine", "triangle", "square"], "DEFAULT": 0 },
    { "NAME": "freq",     "TYPE": "float", "MIN": 0.5, "MAX": 40.0, "DEFAULT": 6.0 },
    { "NAME": "spread",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.25 },
    { "NAME": "symmetry", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.5 },
    { "NAME": "angle",    "TYPE": "float", "MIN": 0.0, "MAX": 6.2832,"DEFAULT": 0.3 },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 20.0,  "DEFAULT": 0.3 },
    { "NAME": "level",    "TYPE": "float", "MIN": 0.2, "MAX": 1.0,  "DEFAULT": 0.8 },
    { "NAME": "chroma",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 1.0 },
    { "NAME": "audioFM",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0, "LABEL": "audio FM" },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// ∫ rate dt : the drift follows a moving rate without jumping (engine-integrated).
uniform float PH_rate;

// One cycle of the shared waveform at x (cycles). `aa` = half the width, in
// cycles, of one pixel : the square's edges are smoothed over it.
float osc(float x, float wf, float aa) {
  float p = fract(x);
  if (wf < 0.5) return 0.5 + 0.5 * sin(p * 6.2832);
  if (wf < 1.5) return abs(p * 2.0 - 1.0);
  // Anti-aliased square : high on [0.5, 1), same phase as step(0.5, p).
  float d = abs(fract(x - 0.25) - 0.5);
  return 1.0 - smoothstep(0.25 - aa, 0.25 + aa, d);
}

// One channel : a mix of a horizontal and a vertical oscillator (symmetry
// blends the axes) at frequency f. th / tv = this channel's time phase for each
// axis (already wrapped to 0..1), ph = its fixed phase offset (cycles), and
// fh / fv = the audio FM bend for each axis. `waveform` is an ISF 'long' → a
// GLSL int uniform, so cast it before the float-typed osc().
float chan(vec2 p, float f, float ph, float th, float tv, float fh, float fv) {
  float wf = float(waveform);
  float aa = 0.5 * f / RENDERSIZE.y;
  float h = osc(p.x * f + th + ph + fh, wf, aa);
  float v = osc(p.y * f + tv + ph + fv, wf, aa);
  return mix(h, v, symmetry);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float cs = cos(angle), sn = sin(angle);
  vec2 cr = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  vec2 p = cr + 0.5;

  // Time phases per channel and axis, wrapped (uniform-only) so a long show
  // keeps full spatial precision. Each channel runs at its own speed so R/G/B
  // never lock : the color crawls.
  float t = PH_rate;
  float thR = fract(t),        tvR = fract(-t * 0.9);
  float thG = fract(t * 1.07), tvG = fract(-t * 1.07 * 0.9);
  float thB = fract(t * 0.93), tvB = fract(-t * 0.93 * 0.9);

  // Audio FM : the live waveform, read along the OTHER axis, displaces each
  // oscillator's phase, so vertical stripes bend along y and horizontal ones
  // along x : the stripes trace the wave. Silence reads 0.5 → no bend.
  float ext = length(vec2(aspect, 1.0));
  vec2 ax = vec2(cr.x / ext + 0.5, 0.25);
  vec2 ay = vec2(cr.y / ext + 0.5, 0.25);
  float fv = (IMG_NORM_PIXEL(audioTex, ax).r - 0.5) * 2.0 * audioFM;
  float fh = (IMG_NORM_PIXEL(audioTex, ay).r - 0.5) * 2.0 * audioFM;

  // Three detuned frequencies, phases a third of a cycle apart (0°, 120°, 240°).
  float r = chan(p, freq, 0.0, thR, tvR, fh, fv);
  float g = chan(p, freq * (1.0 + spread * 0.35), 0.3333, thG, tvG, fh, fv);
  float b = chan(p, freq * (1.0 + spread * 0.7), 0.6667, thB, tvB, fh, fv);

  vec3 col = vec3(r, g, b);
  // Chroma : 0 = the gray the three channels average to, 1 = full color.
  col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, chroma);
  gl_FragColor = vec4(col * level, 1.0);
}
