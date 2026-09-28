/*{
  "DESCRIPTION": "Difference Bloom : frame-difference motion key (a video-feedback lineage): only what MOVED between frames survives, echoed around a ring of offsets (an octagonal halo of contour light; SOFT turns the ring into a smooth falloff with a center). Still areas fall to near-black; motion reads as matte contour light. HOLD is a short afterglow: the glow halves every HOLD seconds after the motion stops, which also bridges the repeated frames of a slower video so the key does not blink (0 = the raw frame-to-frame key). `keep` fades the source back in behind the motion.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "gain",   "TYPE": "float", "MIN": 0.5, "MAX": 8.0, "DEFAULT": 3.0 },
    { "NAME": "spread", "TYPE": "float", "MIN": 0.0, "MAX": 0.05,"DEFAULT": 0.012 },
    { "NAME": "keep",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "tint",   "TYPE": "color", "DEFAULT": [0.8, 0.85, 0.9, 1.0] },
    { "NAME": "hold",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1, "LABEL": "hold" },
    { "NAME": "soft",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "soft spread" }
  ],
  "PASSES": [
    { "TARGET": "clk",  "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { "TARGET": "hist", "PERSISTENT": true },
    { }
  ]
}*/

// Layer clock : a 1×1 latch keeps fract(TIME) in 16 bits, so the afterglow
// releases on the LAYER's time (a frozen layer holds its glow).
vec2 enc16(float x) {
  float v = floor(clamp(x, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  return vec2(hi, v - hi * 256.0) / 255.0;
}
float dec16(vec2 c) {
  vec2 b = floor(c * 255.0 + 0.5);
  return (b.x * 256.0 + b.y) / 65535.0;
}
float layerDt() {
  vec2 c0 = vec2(0.5);
  vec4 s = IMG_NORM_PIXEL(clk, c0);
  if (s.a < 0.5) return 1.0 / 60.0; // first frame, or just flushed
  return min(abs(fract(TIME - dec16(s.rg) + 0.5) - 0.5), 0.1);
}

// hist holds last frame's picture (premultiplied rgb) and, in alpha, the held
// motion H in 1/255 .. 1 : alpha 0 means EMPTY (first frame, resize, panic).
float decH(float a) { return max(a * 255.0 - 1.0, 0.0) / 254.0; }
float encH(float h) { return (1.0 + 254.0 * clamp(h, 0.0, 1.0)) / 255.0; }

// This frame's held motion at one point. hist reads the PREVIOUS frame (every
// pass target flips at the end of the frame) : that one-frame lag IS the key.
float heldAt(vec2 p, float rel, float relStep) {
  vec4 c = IMG_NORM_PIXEL(inputImage, p);
  vec4 h = IMG_NORM_PIXEL(hist, p);
  if (h.a < 0.5 / 255.0) return 0.0;
  float now = clamp(length(c.rgb * c.a - h.rgb) * gain, 0.0, 1.0);
  return max(now, max(decH(h.a) * rel - relStep, 0.0));
}

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    gl_FragColor = vec4(enc16(fract(TIME)), 0.0, 1.0);
    return;
  }
  float dt = layerDt();
  // Afterglow release : the glow halves every `hold` seconds, plus one 8-bit
  // step per frame so it always reaches zero (0 = no hold : the raw key).
  float rel = hold > 0.001 ? exp2(-dt / hold) : 0.0;
  float relStep = dt > 0.0 ? 1.0 / 255.0 : 0.0;

  if (PASSINDEX == 1) {
    // The very first draw samples a black input (the runtime binds the input
    // on a unit its pass buffers then take) : store EMPTY, never that black.
    if (FRAMEINDEX == 0) { gl_FragColor = vec4(0.0); return; }
    vec4 cur = IMG_NORM_PIXEL(inputImage, uv);
    gl_FragColor = vec4(cur.rgb * cur.a, encH(heldAt(uv, rel, relStep)));
    return;
  }

  // Spread : 8 taps on a ring of radius `spread` (frame-height units, so it is
  // round at any aspect), keeping the strongest motion : each moving contour
  // echoes as an octagonal halo. SOFT slides the taps onto a golden-angle
  // spiral from the center out, weighted down with distance : a smooth falloff.
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float m = soft > 0.0 ? heldAt(uv, rel, relStep) * soft : 0.0; // the center tap (soft only)
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float a = mix(fi / 8.0 * 6.2832, fi * 2.39996, soft);
    float r = spread * mix(1.0, (fi + 0.5) / 8.0, soft);
    float w = mix(1.0, 1.0 - (fi + 0.5) / 8.0 * 0.6, soft);
    vec2 o = uv + vec2(cos(a) / aspect, sin(a)) * r;
    m = max(m, heldAt(o, rel, relStep) * w);
  }
  m = clamp(m, 0.0, 1.0);
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  vec3 base = vec3(0.02, 0.02, 0.025);
  vec3 motion = base + tint.rgb * m;
  // Motion over a transparent area still shows (max alpha); still transparent
  // areas stay transparent.
  gl_FragColor = vec4(mix(motion, src.rgb, keep * (1.0 - m)), max(src.a, m));
}
