/*{
  "DESCRIPTION": "Byte Corrupt : bit-depth quantization with channel entanglement: values crushed to few levels, then per-block arithmetic scrambling folds channels into each other on a stepped clock. Data damage, not noise. `warp byte` bends the block grid and gives every block its own rotation / zoom / offset so the mosaic stops reading as clean squares : irregular warped fragments instead.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "depth",    "TYPE": "float", "MIN": 2.0, "MAX": 16.0, "DEFAULT": 6.0 },
    { "NAME": "scramble", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4 },
    { "NAME": "blocks",   "TYPE": "float", "MIN": 2.0, "MAX": 64.0, "DEFAULT": 12.0 },
    { "NAME": "warpByte", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0, "LABEL": "warp byte" },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.3 },
    { "NAME": "chaos",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0 },
    { "NAME": "trig", "TYPE": "event", "DEFAULT": false, "LABEL": "fire ▸" }
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

  // CHAOS: a minority of regions abandon the square grid entirely : their
  // cells stretch into slivers/bars (random aspect), and their CONTENT is
  // deformed: sheared, smeared, or melted sampling instead of clean squares.
  vec2 gridN = vec2(blocks * aspect, blocks);
  vec2 chaosCell = floor(uv * gridN * 0.5); // chaos decided on coarser cells
  float isChaos = step(1.0 - chaos * 0.4, hash(chaosCell + t * 3.7));
  // Deformed grid for chaos regions: wildly anisotropic cells.
  vec2 warpAspect = vec2(
    mix(1.0, mix(0.08, 6.0, hash(chaosCell + 41.0)), isChaos),
    mix(1.0, mix(0.08, 6.0, hash(chaosCell + 43.0)), isChaos)
  );
  vec2 grid = gridN * warpAspect;

  // WARP BYTE: a domain warp (re-rolled each byte-step) bends the whole grid so
  // block boundaries are no longer axis-aligned. Applied to BOTH the cell lookup
  // and the sampling so content follows its bent block.
  vec2 domUV = uv;
  if (warpByte > 0.001) {
    vec2 bend = vec2(
      sin(uv.y * 11.0 + t * 0.7) + sin(uv.x * 6.0 - t * 0.5),
      cos(uv.x * 13.0 + t * 0.6) + sin(uv.y * 8.0 + t * 0.4)
    ) * warpByte * 0.03;
    domUV = uv + bend;
  }

  vec2 cell = floor(domUV * grid);

  // Chaos content deformation: shear + sine melt of the sampling coord.
  vec2 suv = domUV;
  if (isChaos > 0.5) {
    float shear = (hash(chaosCell + vec2(t, 51.0)) - 0.5) * 0.6;
    float meltA = hash(chaosCell + vec2(t, 61.0)) * 0.08;
    suv.x = fract(suv.x + suv.y * shear + sin(suv.y * 40.0 * hash(chaosCell + 71.0)) * meltA);
    suv.y = fract(suv.y + sin(suv.x * 30.0 * hash(chaosCell + 73.0)) * meltA * 0.6);
  }

  // WARP BYTE per-block interior: each block rotates + zooms + offsets its own
  // content around its centre, so no two blocks warp the same way : the interiors
  // read as scattered warped fragments rather than clean square crops.
  if (warpByte > 0.001) {
    vec2 lc = fract(domUV * grid) - 0.5;                        // -0.5..0.5 in block
    float ang = (hash(cell + 91.0) - 0.5) * 3.1416 * warpByte;  // per-block rotation
    float sc = 1.0 + (hash(cell + 93.0) - 0.5) * 1.2 * warpByte; // per-block zoom
    float ca = cos(ang), sa = sin(ang);
    lc = mat2(ca, -sa, sa, ca) * lc / max(sc, 0.2);
    vec2 blockCentre = (cell + 0.5) / grid;
    vec2 off = (vec2(hash(cell + 95.0), hash(cell + 97.0)) - 0.5) * warpByte * 0.12;
    suv = blockCentre + lc / grid + off;
  }

  vec4 src = IMG_NORM_PIXEL(inputImage, suv);

  // Bit-crush.
  float levels = max(depth - 1.0, 1.0);
  vec3 q = floor(src.rgb * levels + 0.5) / levels;

  // Per-block entanglement: only some blocks corrupt this step; corrupted
  // blocks get channel arithmetic that folds values (fract = overflow wrap).
  float on = max(max(step(1.0 - scramble * 0.6, hash(cell + t * 13.1)), isChaos), trig); // trig = punch-in
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
