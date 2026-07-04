/*{
  "DESCRIPTION": "Mosh Blocks — macroblock corruption on a stepped clock: a minority of blocks grab displaced content, some with channel-swapped color. The datamosh/JPEG-corruption register (GODPUS lineage): cuts and holds, not flow.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "blocks", "TYPE": "float", "MIN": 4.0, "MAX": 96.0, "DEFAULT": 24.0 },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 0.5,  "DEFAULT": 0.12 },
    { "NAME": "chance", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.25 },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4 }
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
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 grid = vec2(blocks, blocks / aspect);
  vec2 cell = floor(uv * grid);

  float pick = hash(cell + t * 17.31);
  float on = step(1.0 - chance, pick);
  vec2 disp = on *
    (vec2(hash(cell + vec2(t, 3.7)), hash(cell + vec2(9.1, t))) - 0.5) * 2.0 * amount;

  vec2 c = clamp(uv + disp, 0.0, 1.0);
  vec4 s = IMG_NORM_PIXEL(inputImage, c);

  // A minority of corrupted blocks also swap channels — the color tear.
  float swap = on * step(0.75, hash(cell + vec2(t * 3.0, 27.0)));
  vec3 col = mix(s.rgb, s.gbr, swap);
  gl_FragColor = vec4(col, s.a);
}
