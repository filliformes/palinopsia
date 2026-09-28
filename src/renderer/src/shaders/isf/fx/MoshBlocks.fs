/*{
  "DESCRIPTION": "Mosh Blocks : macroblock corruption on a stepped clock: a minority of blocks grab displaced content (smearing the frame edge where they reach past it), some with channel-swapped color. `freak` blocks break the family : content grabbed from anywhere in the frame, zoomed, mirrored or inverted, held on a slower clock. `audio` raises the odds per block column from its own band of the live spectrum. The datamosh / JPEG-corruption register: cuts and holds, not flow.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "blocks", "TYPE": "float", "MIN": 4.0, "MAX": 96.0, "DEFAULT": 24.0 },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 0.5,  "DEFAULT": 0.12 },
    { "NAME": "chance", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.25 },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4 },
    { "NAME": "freak",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0 },
    { "NAME": "audio",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0, "LABEL": "audio" },
    { "NAME": "trig", "TYPE": "event", "DEFAULT": false, "LABEL": "fire ▸" },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// Integrated phases (engine/phases.ts) : a knob change moves the picture on
// from where it is instead of jumping it.
uniform float PH_rate;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // precise hash : no rows, no lattice over hours
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Spectrum (row 1, log-spaced : 0 bass .. 1 treble), 0..1. Bare-identifier coord.
float spec(float u) {
  vec2 ac = vec2(clamp(u, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float t = mod(floor(TIME * 0.5 + PH_rate * 7.5), 32749.0);
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 grid = vec2(blocks, blocks / aspect);
  vec2 cell = floor(uv * grid);

  float pick = hash(cell + t * 17.31);
  // Audio : each block column rides its own spectrum bin (bass on the left).
  float au = audio > 0.0 ? audio * spec((cell.x + 0.5) / grid.x) : 0.0;
  float on = max(step(1.0 - chance - au, pick), float(trig)); // trig = punch-in (all blocks)
  vec2 disp = on *
    (vec2(hash(cell + vec2(t, 3.7)), hash(cell + vec2(9.1, t))) - 0.5) * 2.0 * amount;

  // FREAK blocks : a freak-sized minority breaks the family entirely: content
  // grabbed from ANYWHERE in the frame, zoomed or mirrored inside the block,
  // sometimes inverted, held on a slower clock (which blocks are freaks too, so
  // a freak holds its window instead of flickering to a new block every step).
  float tSlow = mod(floor(TIME * 0.5 + PH_rate * 2.0), 32749.0); // freaks hold longer
  float fPick = hash(cell + vec2(77.7, tSlow));
  float isFreak = step(1.0 - freak * 0.35, fPick);
  vec2 inCell = fract(uv * grid);
  // Random zoom (0.3–3×) + mirror of the block's own window…
  float zoomF = mix(0.3, 3.0, hash(cell + vec2(tSlow, 41.0)));
  vec2 mir = mix(inCell, 1.0 - inCell, step(0.5, hash(cell + vec2(tSlow, 43.0))));
  // …anchored at a random spot in the WHOLE frame. Reads past the frame clamp :
  // the smeared edge row inside a block is part of the corrupted-data look.
  vec2 anchor = vec2(hash(cell + vec2(tSlow, 51.0)), hash(cell + vec2(tSlow, 53.0)));
  vec2 freakCoord = clamp(anchor + (mir - 0.5) * zoomF / grid * blocks * 0.15, 0.0, 1.0);

  vec2 c = clamp(uv + disp, 0.0, 1.0);
  c = mix(c, freakCoord, isFreak);
  vec4 s = IMG_NORM_PIXEL(inputImage, c);

  // A minority of corrupted blocks also swap channels : the color tear.
  float swap = on * step(0.75, hash(cell + vec2(t * 3.0, 27.0)));
  vec3 col = mix(s.rgb, s.gbr, swap);
  // Some freaks invert outright.
  col = mix(col, 1.0 - col, isFreak * step(0.7, hash(cell + vec2(tSlow, 61.0))));
  gl_FragColor = vec4(col, s.a);
}
