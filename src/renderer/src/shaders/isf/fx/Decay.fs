/*{
  "DESCRIPTION": "Decay : analogue generation loss. The picture wears like a tape dub or a worn print: VHS chroma bleed, block/quantization crush, horizontal head-switch jitter, a BOUNDED feedback ghost (capped so it can never run away into feedback fractals), tape noise and flickering dropout lines. It only ever DEGRADES the incoming image : it never invents its own pattern. No psychedelia.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.5,  "LABEL": "amount" },
    { "NAME": "smear",   "TYPE": "float", "MIN": 0.0, "MAX": 0.7,  "DEFAULT": 0.25, "LABEL": "smear" },
    { "NAME": "chroma",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.45, "LABEL": "chroma bleed" },
    { "NAME": "blocks",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.3,  "LABEL": "blocks" },
    { "NAME": "dropout", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.25, "LABEL": "dropout" },
    { "NAME": "jitter",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.3,  "LABEL": "jitter" }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

float dhash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

void main() {
  vec2 uv = isf_FragNormCoord;

  if (PASSINDEX == 0) {
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    // ── Head-switch jitter: a per-scanline horizontal offset that flickers,
    //    plus a slow whole-frame drift. Bounded : this DISPLACES the source
    //    lookup, it does not synthesize anything.
    float line = floor(uv.y * RENDERSIZE.y);
    float lj = (dhash(vec2(line, floor(TIME * 24.0))) - 0.5) * jitter * 0.018;
    float dft = sin(TIME * 0.8 + uv.y * 6.0) * jitter * 0.002;
    vec2 suv = vec2(uv.x + lj + dft, uv.y);

    // ── Luma from the sharp lookup; chroma from a lookup pulled sideways (the
    //    classic VHS chroma-luma lag / bleed).
    vec2 lsuv = suv;
    vec2 csuv = vec2(suv.x - chroma * 0.014, suv.y);
    vec3 sharp = IMG_NORM_PIXEL(inputImage, lsuv).rgb;
    vec3 bled  = IMG_NORM_PIXEL(inputImage, csuv).rgb;
    float y = dot(sharp, LUMA);
    vec3 chromaPart = bled - vec3(dot(bled, LUMA)); // colour minus its own luma
    vec3 col = vec3(y) + chromaPart;

    // ── Tape wash: repeated dubs lose saturation and a little contrast.
    float lum = dot(col, LUMA);
    col = mix(col, vec3(lum), amount * 0.35);
    col = (col - 0.5) * (1.0 - amount * 0.12) + 0.5;

    // ── Block / quantization crush: resample onto a coarse macro-grid and
    //    posterize the levels (compression breakup on a worn signal).
    if (blocks > 0.02) {
      float rows = mix(RENDERSIZE.y, 26.0, blocks);
      vec2 grid = vec2(rows * aspect, rows);
      vec2 quv = (floor(suv * grid) + 0.5) / grid;
      vec3 blk = IMG_NORM_PIXEL(inputImage, quv).rgb;
      col = mix(col, blk, blocks * 0.8);
      float levels = mix(255.0, 5.0, blocks);
      col = floor(col * levels + 0.5) / levels;
    }

    // ── Bounded feedback ghost: mix in the previous degraded frame, HARD
    //    capped (max ~0.49 weight) so loop gain stays < 1 : trails/smear, never
    //    a self-generating feedback pattern.
    vec2 buv = uv;
    vec3 prev = IMG_NORM_PIXEL(buf, buv).rgb;
    col = mix(col, prev, clamp(smear, 0.0, 0.7) * 0.7);

    // ── Tape noise (luma grain).
    vec2 nseed = floor(uv * RENDERSIZE) + floor(TIME * 30.0);
    col += (dhash(nseed) - 0.5) * jitter * 0.12;

    // ── Dropout lines: sparse whole-scanline drops to black or white that
    //    flicker frame to frame (worn oxide / print scratches).
    float d = dhash(vec2(line, floor(TIME * 10.0)));
    float drop = step(1.0 - dropout * 0.12, d);
    float polarity = step(0.5, dhash(vec2(line, 7.0)));
    col = mix(col, vec3(polarity), drop);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  } else {
    gl_FragColor = IMG_NORM_PIXEL(buf, uv);
  }
}
