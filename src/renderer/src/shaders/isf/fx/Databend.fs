/*{
  "DESCRIPTION": "Databend : the byte-editing register (editing the stream, not the motion : distinct from datamosh's smear). Horizontal bands tear and jump sideways on a stepped clock; some bands HOLD their top line and repeat it downward (the byte 'repeat' smear); per-band the colour channels rotate and drift out of registration; and a subset of bands go stroboscopic. Linear fragmentation, flicker, banded corruption : Betancourt's databent-H.264 look.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "bands",   "TYPE": "float", "MIN": 4.0, "MAX": 160.0, "DEFAULT": 40.0, "LABEL": "bands" },
    { "NAME": "shift",   "TYPE": "float", "MIN": 0.0, "MAX": 0.5,   "DEFAULT": 0.12, "LABEL": "tear" },
    { "NAME": "chance",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.35, "LABEL": "chance" },
    { "NAME": "hold",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.4,  "LABEL": "row hold" },
    { "NAME": "channel", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.4,  "LABEL": "channel rot" },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.5,  "LABEL": "rate" }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float t = floor(TIME * (0.5 + rate * 8.0));   // stepped clock : cuts, not flow
  float band = floor(uv.y * bands);
  float pick = hash(vec2(band, t));
  float on = step(1.0 - chance, pick);

  // Sideways byte tear.
  float dx = on * (hash(vec2(band, t + 7.3)) - 0.5) * 2.0 * shift;
  float x = uv.x + dx;

  // Row-hold "repeat" : a subset of corrupted bands sample their own top line
  // and repeat it downward (the byte head-smear).
  float holdOn = on * step(1.0 - hold, hash(vec2(band, t + 3.1)));
  float bandTopY = band / bands + 0.0015;
  float y = mix(uv.y, bandTopY, holdOn);

  vec2 c = clamp(vec2(x, y), 0.0, 1.0);
  vec3 col = IMG_NORM_PIXEL(inputImage, c).rgb;

  // Per-band channel rotate (R←G←B) + small per-channel x drift : colour out of
  // registration, the byte-domain chroma tear.
  float chOn = on * step(1.0 - channel, hash(vec2(band, t + 11.0)));
  float chShift = channel * 0.02 * (hash(vec2(band, t + 13.0)) - 0.5) * 2.0;
  vec3 rot = vec3(
    IMG_NORM_PIXEL(inputImage, clamp(vec2(x + chShift, y), 0.0, 1.0)).g,
    col.b,
    IMG_NORM_PIXEL(inputImage, clamp(vec2(x - chShift, y), 0.0, 1.0)).r);
  col = mix(col, rot, chOn);

  // Stroboscopic band flicker (whole-band on/off on the clock).
  float strobe = on * step(0.72, hash(vec2(band, t + 17.0)));
  col = mix(col, col * step(0.5, fract(t * 0.5 + band * 0.13)), strobe * 0.6);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
