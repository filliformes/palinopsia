/*{
  "DESCRIPTION": "Tracking — VHS tracking error: a noisy band (head-switch tear, per-line wobble, dropout dashes) that by default sits at the BOTTOM where the video heads switch — but POSITION places it anywhere and ROLL makes it creep up the picture and wrap, like a tape that won't lock. Above the band, a faint line jitter.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "band",     "TYPE": "float", "MIN": 0.0, "MAX": 0.4, "DEFAULT": 0.12 },
    { "NAME": "position", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.06 },
    { "NAME": "roll",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "wobble",   "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.05 },
    { "NAME": "noise",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4 }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

// Vertical distance on a wrapped screen (so a rolling band crosses the top
// and reappears at the bottom seamlessly).
float wd(float a, float b) {
  float d = abs(a - b);
  return min(d, 1.0 - d);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float t = floor(TIME * (6.0 + rate * 44.0)); // field-rate flutter
  float line = floor(uv.y * 300.0);

  // The band's centre: `position` places it, `roll` creeps it upward.
  float center = fract(position + roll * TIME * 0.06);
  float half = band * 0.5 * (0.8 + 0.2 * hash(vec2(t, 1.0)));
  float d = wd(uv.y, center);
  float inBand = smoothstep(half, half * 0.4, d);

  // Per-line wobble: strong inside the band, a whisper elsewhere.
  float wob = (hash(vec2(line, t)) - 0.5) * 2.0;
  float shift = wob * wobble * (inBand + 0.06);
  vec2 c = vec2(fract(uv.x + shift), uv.y);
  vec4 s = IMG_NORM_PIXEL(inputImage, c);

  // Inside the band: luminance flutter + white dropout dashes.
  float flutter = 1.0 - inBand * noise * 0.4 * hash(vec2(line, t + 7.0));
  float dash = inBand * step(0.94 - noise * 0.08, hash(vec2(line, t + 13.0))) *
    step(hash(vec2(floor(uv.x * 24.0), line + t)), 0.4);
  vec3 col = s.rgb * flutter + vec3(0.9) * dash;

  // Head-switch flash rides the band's lower edge (wraps with the roll).
  float headSwitch = smoothstep(0.012, 0.0, wd(uv.y, fract(center - half))) * 0.5;
  col += vec3(headSwitch);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), s.a);
}
