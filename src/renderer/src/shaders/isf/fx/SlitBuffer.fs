/*{
  "DESCRIPTION": "Slit Buffer : time-smear of the input: a write head sweeps across the frame, freezing the live image into the persistent buffer as it passes, so the picture behind the head holds older moments. A real slit-scan of whatever feeds the layer (the slit-scan register). Direction sets the sweep (normal / inverted / pendulum ping-pong); VERTICAL sweeps top to bottom and ANGLE tilts the slit; Jitter breaks the seam into a ragged edge; Jumps teleports the whole playhead to random spots before/after its swept position. GRAB writes the whole live frame at once. Until the head first passes, the picture shows the live image.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Scan"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "rate",      "TYPE": "float", "MIN": 0.02, "MAX": 3.0, "DEFAULT": 0.3 },
    { "NAME": "width",     "TYPE": "float", "MIN": 0.005,"MAX": 0.2, "DEFAULT": 0.03 },
    { "NAME": "jitter",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "jumps",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "vertical",  "TYPE": "bool",  "DEFAULT": false },
    { "NAME": "direction", "TYPE": "long",  "VALUES": [0, 1, 2], "LABELS": ["normal", "inverted", "pendulum"], "DEFAULT": 0 },
    { "NAME": "angle",     "TYPE": "float", "MIN": -1.5708, "MAX": 1.5708, "DEFAULT": 0.0, "LABEL": "slit angle" },
    { "NAME": "grab",      "TYPE": "event", "LABEL": "grab ▸" }
  ],
  "PASSES": [
    { "TARGET": "clk", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

// Integrated phases (engine/phases.ts) : a knob change moves the picture on
// from where it is instead of jumping it. Wrapped at 4096 so the head stays
// precise over day-long shows : every use is periodic in 4096 (fract(t),
// fract(t/2), and the step clocks floor(t*3), floor(t*6) are taken mod 4096).
uniform float PH_rate; // wrap 4096

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // precise hash : no rows, no lattice over hours
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Layer clock : a 1×1 latch keeps fract(TIME) in 16 bits, so each frame knows
// how far the head travelled on the LAYER's time.
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

// This frame's picture (straight alpha). The buffer pass stores it and the
// output pass shows it : both read the same previous buffer, so the output is
// this frame's sweep, not last frame's.
vec4 slit(vec2 uv) {
  float t = PH_rate;
  float sweep = fract(t);                       // 0→1, wraps
  // 0 normal · 1 inverted · 2 pendulum (ping-pongs 0→1→0, no wrap seam).
  float head = sweep;
  if (direction == 1) head = 1.0 - sweep;
  else if (direction == 2) head = abs(fract(t * 0.5) * 2.0 - 1.0);

  // Jumps: on a stepped clock the WHOLE playhead teleports to a random spot
  // before or after its swept position (uniform across the frame : a real
  // head jump, distinct from jitter's per-band raggedness).
  float jt = mod(floor(t * 3.0), 4096.0);         // jump clock (~3 per unit t)
  float fire = step(1.0 - jumps, hash21(vec2(jt, 7.7)));  // more jumps → fires more
  head += fire * (hash21(vec2(jt, 3.3)) - 0.5) * 2.0 * jumps;

  // Slit geometry : the head sweeps along DIR (left to right, or bottom to top
  // when VERTICAL is on, tilted by ANGLE). AXIS runs 0 → 1 corner to corner,
  // so a tilted slit still covers the whole frame; ACROSS runs along the slit.
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float base = vertical ? 1.5707963 : 0.0;
  vec2 dir = vec2(cos(base + angle), sin(base + angle));
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float axis = dot(p, dir) / (abs(dir.x) * aspect + abs(dir.y)) + 0.5;
  float across = dot(p, perp) / (abs(perp.x) * aspect + abs(perp.y)) + 0.5;

  // Jitter: a stepped noise offsets the seam per band and per sweep-tick, so
  // the write head stops being a clean line and wanders unpredictably.
  float j = hash21(vec2(floor(across * 50.0), mod(floor(t * 6.0), 4096.0)));
  head += (j - 0.5) * jitter * 0.6;

  // The band is at least as wide as this frame's head travel : a fast head
  // (or a slow frame) would otherwise skip stripes and leave a comb of stale
  // columns behind.
  float w = max(width, rate * layerDt());
  float band = grab ? 1.0 : 1.0 - smoothstep(0.0, w, abs(axis - head));
  vec4 live = IMG_NORM_PIXEL(inputImage, uv);
  vec4 s = IMG_NORM_PIXEL(buf, uv);
  // The buffer keeps alpha offset by one step, so 0 means EMPTY (first frame,
  // resize, panic) : an unswept picture shows the live image, not a hole.
  vec4 prev = s.a < 0.5 / 255.0 ? live : vec4(s.rgb, max(s.a * 255.0 - 1.0, 0.0) / 254.0);
  // Where the head is, write live; elsewhere hold the frozen history.
  return mix(prev, live, band);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    gl_FragColor = vec4(enc16(fract(TIME)), 0.0, 1.0);
    return;
  }
  // The very first draw samples a black input (the runtime binds the input
  // on a unit its pass buffers then take) : store EMPTY, never that black.
  if (PASSINDEX == 1 && FRAMEINDEX == 0) { gl_FragColor = vec4(0.0); return; }
  vec4 o = slit(uv);
  if (PASSINDEX == 1) gl_FragColor = vec4(o.rgb, (1.0 + 254.0 * clamp(o.a, 0.0, 1.0)) / 255.0);
  else gl_FragColor = o;
}
