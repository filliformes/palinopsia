/*{
  "DESCRIPTION": "Feedback Zoom : the deepest palinopsia move: the image feeds back into itself through a zoom and twist, echoes marching inward or outward. Persistent-buffer recursion with a mix()-based decay, so trails converge instead of blooming. The tunnel turns about CENTER, and DRIFT lets that point wander slowly so the vortex is never nailed to the middle of the frame (0 = locked on CENTER). EDGE sets what fills in where the zoomed frame leaves the picture : the live image, black (a nested frame), or the clamped border smear. CLEAR wipes the echoes. Zoom, twist and decay follow the layer clock, so the tunnel runs the same at any frame rate and holds still when the layer is frozen.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Feedback"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "zoom",   "TYPE": "float", "MIN": 0.85, "MAX": 1.15, "DEFAULT": 1.03 },
    { "NAME": "twist",  "TYPE": "float", "MIN": -0.2, "MAX": 0.2,  "DEFAULT": 0.02 },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0,  "MAX": 0.95, "DEFAULT": 0.65 },
    { "NAME": "center", "TYPE": "point2D", "MIN": [0.0, 0.0], "MAX": [1.0, 1.0], "DEFAULT": [0.5, 0.5], "LABEL": "center" },
    { "NAME": "drift",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.3, "LABEL": "center drift" },
    { "NAME": "edge",   "TYPE": "long",  "VALUES": [0, 1, 2], "LABELS": ["live", "black", "smear"], "DEFAULT": 0, "LABEL": "edge" },
    { "NAME": "clear",  "TYPE": "event", "LABEL": "clear ▸" }
  ],
  "PASSES": [
    { "TARGET": "clk", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { "TARGET": "fbz", "PERSISTENT": true },
    { }
  ]
}*/

// Integrated phase (engine/phases.ts) : the center's wander is paced by
// ∫drift dt, so a drift change alters the pace from here on, never the place.
uniform float PH_drift;

// Layer clock : a 1×1 latch keeps fract(TIME) in 16 bits, so each frame can
// read the previous frame's clock and step the feedback by the LAYER's time
// (Speed, freeze and the background's slow clock carry through).
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
// The wander's reach eases toward DRIFT (the latch's blue channel), so turning
// the knob, or an LFO on it, glides the center instead of shifting every echo
// at once.
float easedDrift(float dts) {
  vec2 c0 = vec2(0.5);
  vec4 s = IMG_NORM_PIXEL(clk, c0);
  if (s.a < 0.5) return drift;
  float d = drift - s.b;
  float k = 1.0 - pow(0.92, dts);
  return s.b + sign(d) * min(abs(d), max(abs(d) * k, dts > 0.0 ? 1.0 / 255.0 : 0.0));
}

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    gl_FragColor = vec4(enc16(fract(TIME)), easedDrift(layerDt() * 60.0), 1.0);
    return;
  }
  // The buffer pass and the output pass run the same step on the same inputs
  // (both read last frame's buffer), so the output is this frame's feedback,
  // not last frame's.
  // The very first draw samples a black input (the runtime binds the input
  // on a unit its pass buffers then take) : store EMPTY, never that black.
  if (PASSINDEX == 1 && FRAMEINDEX == 0) { gl_FragColor = vec4(0.0); return; }
  float dts = layerDt() * 60.0; // this frame's step, in 60 fps frames
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  // The tunnel's center wanders about CENTER : two incommensurate slow sines
  // per axis, so the path never closes into a loop.
  float ph = PH_drift * 0.35;
  vec2 wander = vec2(sin(ph + 1.3) + 0.6 * sin(ph * 2.37 + 4.1),
                     sin(ph * 0.83 + 0.2) + 0.6 * sin(ph * 1.91 + 2.6)) / 1.6;
  vec2 ctr = center + wander * easedDrift(dts) * 0.18 * vec2(1.0 / aspect, 1.0);

  // Sample the previous feedback frame through the inverse zoom/twist.
  vec2 p = uv - ctr;
  p.x *= aspect;
  float tw = twist * dts;
  float cs = cos(-tw);
  float sn = sin(-tw);
  p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
  p /= pow(zoom, dts);
  p.x /= aspect;
  vec2 sc = p + ctr;
  vec2 c = clamp(sc, 0.0, 1.0);
  vec4 prev = IMG_NORM_PIXEL(fbz, c);
  vec4 live = IMG_NORM_PIXEL(inputImage, uv);

  // An empty buffer (first frame, after a resize or a panic) starts from live.
  if (clear || prev.a < 0.5 / 255.0) prev = live;
  // Where the zoomed frame leaves the picture : live (no echo there), black (a
  // nested frame), or the clamped edge texel (the border smears inward).
  bool inside = sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0;
  if (!inside) {
    if (edge == 0) prev = live;
    else if (edge == 1) prev = vec4(0.0, 0.0, 0.0, live.a);
  }

  // Decay register : step toward the live frame, so echoes always converge.
  // Frame-rate independent, and never less than one 8-bit step, or a faint
  // ghost stalls at 0.5/(1-amount) LSB (10 LSB at 0.95) and sits there.
  float k = pow(max(amount, 1e-6), dts);
  vec4 d = live - prev;
  float minStep = dts > 0.0 ? 1.0 / 255.0 : 0.0;
  gl_FragColor = prev + sign(d) * min(abs(d), max(abs(d) * (1.0 - k), minStep));
}
