/*{
  "DESCRIPTION": "Slice Shuffle — horizontal band displacement on a stepped clock; a minority of slices jump each step. The datamosh/slice register (GODPUS/glitch lineage): cuts, not flow.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "slices",  "TYPE": "float", "MIN": 4.0, "MAX": 96.0, "DEFAULT": 24.0 },
    { "NAME": "amount",  "TYPE": "float", "MIN": 0.0, "MAX": 0.5,  "DEFAULT": 0.08 },
    { "NAME": "chance",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.25 },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35 }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float t = floor(TIME * (0.5 + rate * 7.5));
  float slice = floor(uv.y * slices);
  float pick = hash(vec2(slice, t));
  float on = step(1.0 - chance, pick);
  float offset = on * (hash(vec2(slice, t + 41.7)) - 0.5) * 2.0 * amount;
  vec2 c = vec2(fract(uv.x + offset), uv.y);
  gl_FragColor = IMG_NORM_PIXEL(inputImage, c);
}
