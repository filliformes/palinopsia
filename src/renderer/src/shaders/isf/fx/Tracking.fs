/*{
  "DESCRIPTION": "Tracking — VHS tracking error: a noisy band at the bottom with per-line horizontal wobble, dropout dashes, and the head-switch flash; above it, faint line jitter and a slight skew. The worn-tape register.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "band",   "TYPE": "float", "MIN": 0.0, "MAX": 0.4, "DEFAULT": 0.12 },
    { "NAME": "wobble", "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.05 },
    { "NAME": "noise",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4 }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float t = floor(TIME * (6.0 + rate * 44.0)); // field-rate flutter
  float line = floor(uv.y * 300.0);

  // The damaged band hugs the bottom; its edge breathes.
  float edge = band * (0.8 + 0.2 * hash(vec2(t, 1.0)));
  float inBand = smoothstep(edge, edge * 0.4, uv.y);

  // Per-line wobble: strong inside the band, a whisper above it.
  float wob = (hash(vec2(line, t)) - 0.5) * 2.0;
  float shift = wob * wobble * (inBand + 0.06);
  vec2 c = vec2(fract(uv.x + shift), uv.y);
  vec4 s = IMG_NORM_PIXEL(inputImage, c);

  // Inside the band: luminance flutter + white dropout dashes.
  float flutter = 1.0 - inBand * noise * 0.4 * hash(vec2(line, t + 7.0));
  float dash = inBand * step(0.94 - noise * 0.08, hash(vec2(line, t + 13.0))) *
    step(hash(vec2(floor(uv.x * 24.0), line + t)), 0.4);
  vec3 col = s.rgb * flutter + vec3(0.9) * dash;

  // Head-switch flash: the very bottom line pair blows out bright.
  float headSwitch = smoothstep(0.012, 0.0, uv.y) * 0.5;
  col += vec3(headSwitch);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), s.a);
}
