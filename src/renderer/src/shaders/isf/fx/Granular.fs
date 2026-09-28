/*{
  "DESCRIPTION": "Granular : video granular synthesis (after the video granular synthesis of Villegas and Forbes): the frame is shattered into a grid of Hann-windowed grains, each rotated and scattered on its own (SIZE SPREAD also scales each one), then resynthesized. On every tick of the grain clock the field re-rolls which grains are lit and how each one turns and lands; STAGGER lets every grain re-roll on its own beat instead of all at once. A persistent buffer lets grains bleed from the previous frame (temporal smear): each echo re-applies its grain's turn and offset, so the echoes compound into spiraling copies. Density thins the grain field so the smear shows through the gaps. AUDIO lets each grain's scatter ride its own band of the spectrum. Matte, glitch-native : the granular texture is the point.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Texture"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "grain",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.45, "LABEL": "grain size" },
    { "NAME": "density", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.85 },
    { "NAME": "scatter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25 },
    { "NAME": "rotate",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2 },
    { "NAME": "smear",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3,  "LABEL": "temporal smear" },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0, "MAX": 20.0,"DEFAULT": 0.6 },
    { "NAME": "stagger", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "stagger" },
    { "NAME": "sizeVar", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "size spread" },
    { "NAME": "edges",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "soft edges" },
    { "NAME": "audio",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio scatter" },
    { "NAME": "audioTex", "TYPE": "image" }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

// Integrated phases (engine/phases.ts) : a knob change moves the picture on
// from where it is instead of jumping it. Wrapped at 4096 : the grain clock is
// floor(... + 3·PH) mod 4096, which a 4096 wrap leaves unchanged.
uniform float PH_rate; // wrap 4096

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // precise hash : no rows, no lattice over hours
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Spectrum (row 1 : log-spaced, bass at u = 0), 0..1. Bare-identifier coord.
float spec(float u) {
  vec2 ac = vec2(clamp(u, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

// The previous frame at p, or the live frame where the buffer is empty (first
// frame, resize, panic) : no black flash while the smear fills in.
vec4 prevAt(vec2 p, vec4 live) {
  vec4 b = IMG_NORM_PIXEL(buf, p);
  return b.a < 0.5 / 255.0 ? live : b;
}

// The smear : step from the previous frame toward the live one. Smear is capped
// below 1 (at 1 the live frame never entered : a frozen picture for good), and
// every step moves at least one 8-bit level, or the echo stalls as a faint fog.
vec4 smeared(vec4 live, vec4 prev) {
  float k = min(smear, 0.95);
  vec4 d = live - prev;
  return prev + sign(d) * min(abs(d), max(abs(d) * (1.0 - k), 1.0 / 255.0));
}

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 1) {
    // Output : the buffer as written (one frame behind; recomputing the grains
    // here would double the cost).
    gl_FragColor = IMG_NORM_PIXEL(buf, uv);
    return;
  }
  // The very first draw samples a black input (the runtime binds the input
  // on a unit its pass buffers then take) : store EMPTY, never that black.
  if (FRAMEINDEX == 0) { gl_FragColor = vec4(0.0); return; }
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  // Grain cell size in normalized units : big grains → fine grains.
  float cell = mix(0.22, 0.03, grain);
  // Stepped grain clock : on each tick the grain field re-rolls which grains
  // are lit AND each grain's turn and landing. At stagger 0 every grain ticks
  // together (the field re-cuts at once); stagger offsets each grain's beat.
  float clockT = TIME * 0.5 + PH_rate * 3.0;

  vec2 g = vec2(uv.x * aspect, uv.y) / cell;
  vec2 baseCell = floor(g);

  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = baseCell + vec2(float(i), float(j));
      float tk = mod(floor(clockT + hash(c + 11.0) * stagger), 4096.0) * 0.13;
      // Sparse field: a density-sized fraction of grains are active.
      if (hash(c * 1.7 + tk) > density) continue;
      float ang = (hash(c + 3.1 + tk) - 0.5) * rotate * 6.2832;
      float sc = scatter + audio * 0.8 * spec(hash(c + 17.0));
      vec2 off = (vec2(hash(c + 5.0 + tk), hash(c + 9.0 + tk)) - 0.5) * sc;
      // Grain center in uv space; window weight by distance to it.
      vec2 gc = (c + 0.5) * cell;
      gc.x /= aspect;
      vec2 d = (uv - gc) * vec2(aspect, 1.0) / cell;
      float dist = length(d);
      if (dist > 1.0) continue;
      float w = 0.5 + 0.5 * cos(dist * 3.14159); // Hann window
      // Sample the source, rotated about the grain center, scaled and offset.
      float cs = cos(ang), sn = sin(ang);
      vec2 rel = (uv - gc) * vec2(aspect, 1.0);
      rel = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs);
      rel /= mix(1.0, 0.5 + hash(c + 13.0 + tk), sizeVar);
      rel.x /= aspect;
      vec2 sp = gc + rel + vec2(off.x / aspect, off.y) * cell;
      vec4 live = IMG_NORM_PIXEL(inputImage, sp);
      vec4 s = smeared(live, prevAt(sp, live));
      acc += vec4(s.rgb * s.a, s.a) * w;
      wsum += w;
    }
  }

  // Gaps in the grain field show the smeared background.
  vec4 lv = IMG_NORM_PIXEL(inputImage, uv);
  vec4 gap = smeared(lv, prevAt(uv, lv));
  vec4 gapP = vec4(gap.rgb * gap.a, gap.a);
  // Hard edges (0) : any grain that touches a pixel owns it outright, so grains
  // end in crisp circles. Soft (1) : the Hann window fades each grain into the
  // gap, so sparse grains dissolve at their rims.
  vec4 hard = wsum > 0.001 ? acc / wsum : gapP;
  vec4 soft = (acc + gapP * max(1.0 - wsum, 0.0)) / max(wsum, 1.0);
  vec4 o = mix(hard, soft, edges);
  gl_FragColor = vec4(o.a > 0.0 ? clamp(o.rgb / o.a, 0.0, 1.0) : vec3(0.0), clamp(o.a, 0.0, 1.0));
}
