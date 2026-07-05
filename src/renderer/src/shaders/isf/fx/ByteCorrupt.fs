/*{
  "DESCRIPTION": "Byte Corrupt — bit-depth quantization with channel entanglement: values crushed to few levels, then per-block arithmetic scrambling folds channels into each other on a stepped clock. Data damage, not noise.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "depth",    "TYPE": "float", "MIN": 2.0, "MAX": 16.0, "DEFAULT": 6.0 },
    { "NAME": "scramble", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4 },
    { "NAME": "blocks",   "TYPE": "float", "MIN": 2.0, "MAX": 64.0, "DEFAULT": 12.0 },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.3 }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float t = floor(TIME * (0.5 + rate * 7.5));

  // Bit-crush.
  float levels = max(depth - 1.0, 1.0);
  vec3 q = floor(src.rgb * levels + 0.5) / levels;

  // Per-block entanglement: only some blocks corrupt this step; corrupted
  // blocks get channel arithmetic that folds values (fract = overflow wrap).
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 cell = floor(uv * vec2(blocks * aspect, blocks));
  float on = step(1.0 - scramble * 0.6, hash(cell + t * 13.1));
  float mode = hash(cell + vec2(t, 27.0));

  vec3 c = q;
  if (on > 0.5) {
    if (mode < 0.33) {
      c = fract(q + q.gbr * (0.5 + mode));            // channel bleed + wrap
    } else if (mode < 0.66) {
      c = abs(q - q.brg);                              // channel difference
    } else {
      c = fract(q * (1.0 + hash(cell + 7.0) * 2.0));   // gain overflow
    }
  }
  gl_FragColor = vec4(c, src.a);
}
