/*{
  "DESCRIPTION": "Slit Scan : a slit-scan of an internal oscillator: each column of the frame is the signal frozen at an earlier moment (time = position), so the image is a scrolling time-history : a seismograph of a moving interference profile. Matte bands over near-black, no buffer needed (time IS the x axis).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Scan"],
  "INPUTS": [
    { "NAME": "rate",  "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,  "DEFAULT": 0.6 },
    { "NAME": "span",  "TYPE": "float", "MIN": 1.0,  "MAX": 30.0, "DEFAULT": 8.0 },
    { "NAME": "freq",  "TYPE": "float", "MIN": 1.0,  "MAX": 40.0, "DEFAULT": 8.0 },
    { "NAME": "bands", "TYPE": "float", "MIN": 2.0,  "MAX": 24.0, "DEFAULT": 6.0 },
    { "NAME": "vertical", "TYPE": "bool", "DEFAULT": false },
    { "NAME": "tint",  "TYPE": "color", "DEFAULT": [0.7, 0.75, 0.72, 1.0] }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  // The scan axis carries TIME; the other axis carries the signal profile.
  float axis = vertical ? uv.y : uv.x;
  float prof = vertical ? uv.x : uv.y;
  float tc = TIME * rate - axis * span;

  // A small sum of incommensurate sines evolving in time : read across the
  // scan axis this becomes a flowing history.
  float v = sin(prof * freq * 6.2832 + tc * 1.7);
  v += 0.6 * sin(prof * freq * 2.3 * 6.2832 - tc * 1.1 + 3.0);
  v += 0.35 * sin(prof * freq * 0.5 * 6.2832 + tc * 0.6);
  v = 0.5 + 0.5 * v / 1.95;

  // Stepped into matte bands.
  v = floor(clamp(v, 0.0, 1.0) * bands) / (bands - 1.0);

  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 col = base + tint.rgb * v * 0.85;
  gl_FragColor = vec4(col, 1.0);
}
