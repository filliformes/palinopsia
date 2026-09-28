/*{
  "DESCRIPTION": "Light Trails : a max()-blend trails effect: keeps max(current, previous·decay) per channel, so the BRIGHTEST pixels persist and streak : long-exposure light-painting, distinct from the decay-mix feedback (which converges back to the fresh frame). decay 1 = permanent trails; below 1 they fade all the way back to the live image. KNEE lets only the highlights enter the trail. Optional drift smears the trail as it fades. CLEAR wipes the trails (hold it to keep them wiped). Decay and drift follow the layer clock, so a frozen layer holds its trails.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Feedback"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "decay", "TYPE": "float", "MIN": 0.8,  "MAX": 1.0,  "DEFAULT": 0.97 },
    { "NAME": "drift", "TYPE": "float", "MIN": 0.0,  "MAX": 0.02, "DEFAULT": 0.0 },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0,  "MAX": 6.2832,"DEFAULT": 1.5708 },
    { "NAME": "knee",  "TYPE": "float", "MIN": 0.0,  "MAX": 0.9,  "DEFAULT": 0.0, "LABEL": "highlight knee" },
    { "NAME": "clear", "TYPE": "event", "LABEL": "clear ▸" }
  ],
  "PASSES": [
    { "TARGET": "clk", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

// Layer clock : a 1×1 latch keeps fract(TIME) in 16 bits, so each frame can
// read the previous frame's clock and step the decay by the LAYER's time
// (Speed, freeze and the background's slow clock carry through; reverse
// counts forward).
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

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031); // precise hash : whole-number inputs, kept small
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// Last frame's trail (premultiplied rgb), decayed and drifted to this frame.
// The buffer pass and the output pass both compute it, so the output shows
// THIS frame's light (no one-frame lag).
vec3 decayedTrail(vec2 uv, float dts) {
  vec2 d = vec2(cos(angle), sin(angle)) * drift * dts;
  vec2 sc = uv - d;
  vec4 pv = IMG_NORM_PIXEL(buf, sc);
  // Nothing drifts in from outside the frame : clamp-to-edge would pull the
  // border row across the picture as a streak that never fades.
  float inside = step(0.0, sc.x) * step(sc.x, 1.0) * step(0.0, sc.y) * step(sc.y, 1.0);
  vec3 P = pv.rgb * pv.a * inside;
  if (decay < 0.9999 && dts > 0.0) {
    // Frame-rate independent fade, rounded to the 8-bit grid STOCHASTICALLY
    // (Hoskins hash per pixel and frame) : exact on average, so the trail fades
    // along the full decay curve and still reaches black. Round-to-nearest
    // stalls prev·decay at 0.5/(1-decay) LSB (a permanent fog), and a forced
    // one-step-per-frame floor cuts long exposures short.
    float k = pow(decay, dts);
    vec3 fc = vec3(floor(gl_FragCoord.xy), mod(float(FRAMEINDEX), 4096.0));
    P = floor(P * k * 255.0 + hash13(fc)) / 255.0;
  }
  return P;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    gl_FragColor = vec4(enc16(fract(TIME)), 0.0, 1.0);
    return;
  }
  float dts = layerDt() * 60.0;
  vec4 live = IMG_NORM_PIXEL(inputImage, uv);
  vec3 L = live.rgb * live.a;
  vec3 P = clear ? vec3(0.0) : decayedTrail(uv, dts);

  if (PASSINDEX == 1) {
    // The very first draw samples a black input (the runtime binds the input
    // on a unit its pass buffers then take) : store EMPTY, never that black.
    if (FRAMEINDEX == 0) { gl_FragColor = vec4(0.0); return; }
    // The trail keeps max(trail, fresh light); only light above the knee enters it.
    float gate = knee > 0.0 ? smoothstep(knee, knee + 0.1, dot(L, LUMA)) : 1.0;
    vec3 M = max(P, L * gate);
    float A = max(live.a * gate, max(M.r, max(M.g, M.b)));
    gl_FragColor = vec4(M / max(A, 1e-5), A);
    return;
  }

  // Output : the live frame over the trail. Where the input is transparent the
  // trail carries its own coverage (its brightest channel), so light painted
  // over a keyed layer stays light instead of turning into a black card.
  vec3 M = max(P, L);
  float A = max(live.a, max(M.r, max(M.g, M.b)));
  gl_FragColor = vec4(M / max(A, 1e-5), A);
}
