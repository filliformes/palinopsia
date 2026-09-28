/*{
  "DESCRIPTION": "Decay : analog generation loss. The picture wears like a tape dub or a worn print: VHS chroma bleed, block/quantization crush, horizontal line jitter, a BOUNDED feedback ghost (capped so it can never run away into feedback fractals), tape noise and flickering dropout lines. HEAD SWITCH adds the torn band at the bottom of the frame where a VCR's heads hand over. It only ever DEGRADES the incoming image : it never invents its own pattern. No psychedelia.",
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
    { "NAME": "jitter",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.3,  "LABEL": "jitter" },
    { "NAME": "headSwitch", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "head switch" }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

float dhash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // precise hash : no rows, no lattice over hours
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

void main() {
  // The buffer pass and the output pass run the same wear on the same inputs
  // (both read last frame's buffer), so the output is this frame's wear, not
  // last frame's.
  vec2 uv = isf_FragNormCoord;
  // The very first draw samples a black input (the runtime binds the input
  // on a unit its pass buffers then take) : store EMPTY, never that black.
  if (PASSINDEX == 0 && FRAMEINDEX == 0) { gl_FragColor = vec4(0.0); return; }
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  // Line and grain patterns are counted in 1080p pixels : the same wear at
  // 1080p, 4K and on the dome (1-px rows at 4K fizz and alias under a warp).
  float pxs = max(1.0, floor(RENDERSIZE.y / 1080.0 + 0.5));

  // ── Line jitter: a per-scanline horizontal offset that flickers, plus a slow
  //    whole-frame drift. Bounded : this DISPLACES the source lookup, it does
  //    not synthesize anything.
  float line = floor(gl_FragCoord.y / pxs);
  float lj = (dhash(vec2(line, mod(floor(TIME * 24.0), 32749.0))) - 0.5) * jitter * 0.018;
  float dft = sin(TIME * 0.8 + uv.y * 6.0) * jitter * 0.002;
  // ── Head switch: the bottom few percent of the frame, where the heads hand
  //    over, tears sideways : a ramped offset, strongest at the bottom edge,
  //    that wavers every field.
  float hsBand = 0.035;
  float hsRamp = 1.0 - smoothstep(0.0, hsBand, uv.y);
  float hsWob = 0.6 + 0.4 * dhash(vec2(floor(uv.y * 240.0), mod(floor(TIME * 59.94), 32749.0)));
  float hs = headSwitch * hsRamp * hsRamp * hsWob * 0.06;
  vec2 suv = vec2(uv.x + lj + dft + hs, uv.y);

  // ── Luma from the sharp lookup; chroma from a lookup pulled sideways (the
  //    classic VHS chroma-luma lag / bleed).
  vec2 lsuv = suv;
  vec2 csuv = vec2(suv.x - chroma * 0.014, suv.y);
  vec4 sharpC = IMG_NORM_PIXEL(inputImage, lsuv);
  vec3 sharp = sharpC.rgb;
  vec3 bled  = IMG_NORM_PIXEL(inputImage, csuv).rgb;
  float y = dot(sharp, LUMA);
  vec3 chromaPart = bled - vec3(dot(bled, LUMA)); // color minus its own luma
  vec3 col = vec3(y) + chromaPart;

  // ── Tape wash: repeated dubs lose saturation and a little contrast.
  float lum = dot(col, LUMA);
  col = mix(col, vec3(lum), amount * 0.35);
  col = (col - 0.5) * (1.0 - amount * 0.12) + 0.5;

  // ── Block / quantization crush: resample onto a coarse macro-grid and
  //    posterize the levels (compression breakup on a worn signal). The grid is
  //    counted against a 1080-line frame, so it is the same crush at any size.
  if (blocks > 0.02) {
    float rows = mix(1080.0, 26.0, blocks);
    vec2 grid = vec2(rows * aspect, rows);
    vec2 quv = (floor(suv * grid) + 0.5) / grid;
    vec3 blk = IMG_NORM_PIXEL(inputImage, quv).rgb;
    col = mix(col, blk, blocks * 0.8);
    float levels = mix(255.0, 5.0, blocks);
    col = floor(col * levels + 0.5) / levels;
  }
  float a = sharpC.a;

  // ── Bounded feedback ghost: mix in the previous degraded frame, HARD
  //    capped (max ~0.49 weight) so loop gain stays < 1 : trails/smear, never
  //    a self-generating feedback pattern. An empty buffer (first frame,
  //    resize, panic) ghosts nothing. Mixed as premultiplied color, so a ghost
  //    over a transparent area keeps its color.
  vec2 buv = uv;
  vec4 prev = IMG_NORM_PIXEL(buf, buv);
  if (prev.a >= 0.5 / 255.0) {
    float gw = clamp(smear, 0.0, 0.7) * 0.7;
    vec3 P = mix(col * a, prev.rgb * prev.a, gw);
    a = mix(a, prev.a, gw);
    col = a > 0.0 ? P / a : col;
  }

  // ── Tape noise (luma grain), re-seeded at a random offset every frame so the
  //    grain boils instead of crawling diagonally.
  float fr = mod(floor(TIME * 30.0), 4096.0);
  vec2 nseed = floor(gl_FragCoord.xy / pxs) + floor(vec2(dhash(vec2(fr, 1.3)), dhash(vec2(fr, 7.9))) * 1024.0);
  col += (dhash(nseed) - 0.5) * jitter * 0.12;

  // ── Dropout lines: sparse whole-scanline drops to black or white that
  //    flicker frame to frame (worn oxide / print scratches); each drop picks
  //    its own polarity.
  float dclk = mod(floor(TIME * 10.0), 32749.0);
  float d = dhash(vec2(line, dclk));
  float drop = step(1.0 - dropout * 0.12, d);
  float polarity = step(0.5, dhash(vec2(line, dclk + 7.0)));
  col = mix(col, vec3(polarity), drop);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(a, 0.0, 1.0));
}
