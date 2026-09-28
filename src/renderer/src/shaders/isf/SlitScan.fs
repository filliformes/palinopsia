/*{
  "DESCRIPTION": "Slit Scan : the slit-scan look of an internal oscillator: each column shows the signal at a different moment (position = time), so the frame reads as a time-history of a moving interference profile, a seismograph trace. Matte bands over near-black. No buffer: the whole history is computed from the formula every frame, so turning a knob redraws every column at once rather than entering at the slit and scrolling across. Negative rate runs time the other way.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Scan"],
  "INPUTS": [
    { "NAME": "rate",  "TYPE": "float", "MIN": -20.0, "MAX": 20.0,  "DEFAULT": 0.6 },
    { "NAME": "span",  "TYPE": "float", "MIN": 1.0,  "MAX": 30.0, "DEFAULT": 8.0 },
    { "NAME": "freq",  "TYPE": "float", "MIN": 1.0,  "MAX": 40.0, "DEFAULT": 8.0 },
    { "NAME": "bands", "TYPE": "float", "MIN": 2.0,  "MAX": 24.0, "DEFAULT": 6.0 },
    { "NAME": "vertical", "TYPE": "bool", "DEFAULT": false },
    { "NAME": "tint",  "TYPE": "color", "DEFAULT": [0.7, 0.75, 0.72, 1.0] }
  ]
}*/

// ∫ rate dt : the scroll follows a moving rate without jumping (engine-integrated).
uniform float PH_rate;

void main() {
  vec2 uv = isf_FragNormCoord;
  // The scan axis carries time; the other axis carries the signal profile.
  float axis = vertical ? uv.y : uv.x;
  float prof = vertical ? uv.x : uv.y;
  float back = axis * span; // how far into the past this column looks

  // The phase grows without bound : wrap each term's time part on its own
  // (uniform-only, so the wrap is seamless) before adding the per-pixel part,
  // so a long show keeps full column precision.
  float w1 = mod(PH_rate * 1.7, 6.2831853);
  float w2 = mod(PH_rate * 1.1, 6.2831853);
  float w3 = mod(PH_rate * 0.6, 6.2831853);

  // A small sum of incommensurate sines evolving in time : read across the
  // scan axis this becomes a flowing history.
  float v = sin(prof * freq * 6.2832 + w1 - back * 1.7);
  v += 0.6 * sin(prof * freq * 2.3 * 6.2832 - w2 + back * 1.1 + 3.0);
  v += 0.35 * sin(prof * freq * 0.5 * 6.2832 + w3 - back * 0.6);
  v = 0.5 + 0.5 * v / 1.95;

  // Stepped into a whole number of evenly spaced matte bands (0 .. 1).
  float n = floor(bands);
  v = min(floor(clamp(v, 0.0, 1.0) * n), n - 1.0) / (n - 1.0);

  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 col = base + tint.rgb * v * 0.85;
  gl_FragColor = vec4(col, 1.0);
}
