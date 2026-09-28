/*{
  "DESCRIPTION": "Wide Time : a temporal average across the recent past. The image continuously crossfades with its own memory, so motion smears into clean, evolving visual-music scapes. WIDTH is how wide the window is, in frames at 60 fps (about WIDTH/60 seconds, the same at any frame rate); MIX is dry/wet. MODE is how each new frame accumulates: mean; brightest (a light-painting peak hold); add (a brighter exposure, capped at twice the input); screen (a soft lift toward light); difference (the live image against its own memory, so only change glows); darkest (dark marks linger); burn (the uncapped add, which runs to white). SOFTEN blurs the trails; DRIFT slowly zooms the memory for breathing scapes; HUE turns the color of the fading past. MOTION BLUR simulates a shutter (blurs moving areas); FRAME BLEND runs a second weighted temporal pass for a smoother, more symmetric blend : both on for best results. PRESERVE anchors the output's exposure to the live image : 0 = the raw accumulated look, 1 = fully re-anchored, so the base image's colors stay readable under the trails. CLEAR empties the memory. Real-time, so the window reaches into the PAST only.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Time", "Feedback", "Blur"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "width",  "TYPE": "float", "MIN": 1.0, "MAX": 500.0, "DEFAULT": 20.0, "LABEL": "width" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 1.0,  "LABEL": "mix" },
    { "NAME": "mode",   "TYPE": "long",  "VALUES": [0,1,2,3,4,5,6],
      "LABELS": ["mean","brightest","add","screen","difference","darkest","burn"], "DEFAULT": 0, "LABEL": "mode" },
    { "NAME": "soften", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.0,  "LABEL": "soften" },
    { "NAME": "drift",  "TYPE": "float", "MIN": -0.02, "MAX": 0.02, "DEFAULT": 0.0, "LABEL": "drift" },
    { "NAME": "hue",    "TYPE": "float", "MIN": -0.1, "MAX": 0.1,  "DEFAULT": 0.0,  "LABEL": "hue" },
    { "NAME": "motionBlur", "TYPE": "bool", "DEFAULT": true, "LABEL": "motion blur" },
    { "NAME": "frameBlend", "TYPE": "bool", "DEFAULT": true, "LABEL": "frame blend" },
    { "NAME": "preserve", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "preserve" },
    { "NAME": "clear",  "TYPE": "event", "LABEL": "clear ▸" }
  ],
  "PASSES": [
    { "TARGET": "clk",   "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { "TARGET": "buf",   "PERSISTENT": true },
    { "TARGET": "buf2",  "PERSISTENT": true },
    { "TARGET": "stats", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { }
  ]
}*/

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

// Hue rotation around the gray axis (Rodrigues); h in turns. Linear, so it
// works on premultiplied color.
vec3 hueRot(vec3 c, float h) {
  const vec3 k = vec3(0.57735026);
  float a = h * 6.2831853;
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

// 16-bit values in two 8-bit channels (the layer-clock latch, the PRESERVE means).
vec2 enc16(float x) {
  float v = floor(clamp(x, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  return vec2(hi, v - hi * 256.0) / 255.0;
}
float dec16(vec2 c) {
  vec2 b = floor(c * 255.0 + 0.5);
  return (b.x * 256.0 + b.y) / 65535.0;
}
// Layer clock : the latch keeps fract(TIME), so every step below follows the
// LAYER's time (Speed, freeze and the background's slow clock carry through).
float layerDt() {
  vec2 c0 = vec2(0.5);
  vec4 s = IMG_NORM_PIXEL(clk, c0);
  if (s.a < 0.5) return 1.0 / 60.0; // first frame, or just flushed
  return min(abs(fract(TIME - dec16(s.rg) + 0.5) - 0.5), 0.1);
}

// The memories store straight rgb and a coverage offset by one step (1/255 .. 1),
// so alpha 0 means EMPTY (first frame, resize, panic, CLEAR) and a transparent
// memory is still a memory. The math runs on premultiplied color, so trails
// over a transparent input keep their color instead of fringing black.
//
// The stored values are rounded to the 8-bit grid STOCHASTICALLY (a Hoskins
// hash per pixel and frame) : exact on average, so an 8-bit memory neither
// stalls short of its target (round-to-nearest froze the mean at a quarter of
// the input and left fogs and a 30 Hz flicker) nor has its long trails cut
// short by a forced one-step-per-frame floor.
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031); // precise hash : whole-number inputs, kept small
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec4 packMem(vec4 p) {
  vec3 fc = vec3(floor(gl_FragCoord.xy), mod(float(FRAMEINDEX), 4096.0));
  float r = hash13(fc);
  float r2 = hash13(fc + vec3(0.0, 0.0, 4099.0));
  float a = clamp(p.a, 0.0, 1.0);
  vec3 rgb = a > 0.0 ? clamp(p.rgb / a, 0.0, 1.0) : vec3(0.0);
  return vec4(floor(rgb * 255.0 + r) / 255.0, floor(1.0 + 254.0 * a + r2) / 255.0);
}
vec4 unpack(vec4 s, vec4 fallback) {
  if (s.a < 0.5 / 255.0) return fallback;
  float a = max(s.a * 255.0 - 1.0, 0.0) / 254.0;
  return vec4(s.rgb * a, a);
}
vec4 memBuf(vec2 p, vec4 fallback) {
  vec4 s = IMG_NORM_PIXEL(buf, p);
  return unpack(s, fallback);
}
vec4 memBuf2(vec2 p, vec4 fallback) {
  vec4 s = IMG_NORM_PIXEL(buf2, p);
  return unpack(s, fallback);
}
vec4 premul(vec4 c) { return vec4(c.rgb * c.a, c.a); }

// One accumulate step of MODE : memory h, fresh frame c (both premultiplied),
// k = how much of the memory survives this step.
vec4 accumulate(vec4 h, vec4 c, float k) {
  if (mode == 1) return max(c, h * k);                                      // brightest : peak hold
  if (mode == 2) return mix(vec4(min(c.rgb * 2.0, vec3(c.a)), c.a), h, k);  // add : settles at 2× the input
  if (mode == 3) {                                                          // screen : settles at c screened on itself
    vec3 s = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
    return mix(vec4(s * (2.0 - s) * c.a, c.a), h, k);
  }
  if (mode == 5) return min(c, mix(vec4(1.0), h, k));                       // darkest : the memory fades up to white
  if (mode == 6) return min(c + h * k, vec4(1.0));                          // burn : the uncapped add
  return mix(c, h, k);                                                      // mean (and difference's memory)
}

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    gl_FragColor = vec4(enc16(fract(TIME)), 0.0, 1.0);
    return;
  }
  float dts = layerDt() * 60.0;              // this frame's step, in 60 fps frames
  float k = pow(width / (width + 1.0), dts); // memory weight for this step
  vec4 live = IMG_NORM_PIXEL(inputImage, uv);
  vec4 liveP = premul(live);

  if (PASSINDEX == 1) {
    // The very first draw samples a black input (the runtime binds the input
    // on a unit its pass buffers then take) : store EMPTY, never that black.
    if (FRAMEINDEX == 0) { gl_FragColor = vec4(0.0); return; }
    if (clear) { gl_FragColor = packMem(liveP); return; }
    // ── Memory sample: DRIFT zooms it about the center; SOFTEN cross-blurs it
    //    (compounds over frames → soft trails); HUE evolves its color. ──
    vec2 c = (uv - 0.5) * (1.0 - drift * dts) + 0.5;
    vec4 hist;
    vec4 hc = memBuf(uv, liveP); // the memory right here (motion blur reads it too)
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) {
      // Negative drift reads past the frame : no memory there (clamp-to-edge
      // would feed the border row in and grow streaks).
      hist = liveP;
    } else {
      vec4 h0 = drift == 0.0 ? hc : memBuf(c, liveP);
      hist = h0;
      if (soften > 0.0) {
        vec2 e  = vec2(soften * 0.004, 0.0);
        vec2 g  = vec2(0.0, soften * 0.004);
        vec2 cl = c - e; vec2 cr = c + e; vec2 cu = c + g; vec2 cd = c - g;
        hist = h0 * 0.4
             + (memBuf(cl, h0) + memBuf(cr, h0) + memBuf(cu, h0) + memBuf(cd, h0)) * 0.15;
      }
      if (hue != 0.0) hist.rgb = hueRot(hist.rgb, hue * dts);
    }

    // ── Current frame, with MOTION BLUR (shutter): blur the input where it
    //    differs from the running average (i.e. where there's motion). ──
    vec4 cur = liveP;
    if (motionBlur) {
      vec2 mb = vec2(0.003, 0.0);
      vec2 mg = vec2(0.0, 0.003);
      vec2 il = uv - mb; vec2 ir = uv + mb; vec2 iu = uv + mg; vec2 id = uv - mg;
      vec4 curBlur = (liveP
        + premul(IMG_NORM_PIXEL(inputImage, il))
        + premul(IMG_NORM_PIXEL(inputImage, ir))
        + premul(IMG_NORM_PIXEL(inputImage, iu))
        + premul(IMG_NORM_PIXEL(inputImage, id))) * 0.2;
      float motion = clamp(length(liveP.rgb - hc.rgb) * 3.0, 0.0, 1.0);
      cur = mix(liveP, curBlur, motion);
    }
    gl_FragColor = packMem(clamp(accumulate(hist, cur, k), 0.0, 1.0));
    return;
  }

  if (PASSINDEX == 2) {
    // FRAME BLEND: a second weighted temporal pass (an EMA over the accumulator)
    // → a smoother, more symmetric time kernel. Off, it keeps nothing (a cheap
    // clear) and re-seeds from the accumulator when it comes back on.
    if (!frameBlend || FRAMEINDEX == 0) { gl_FragColor = vec4(0.0); return; }
    vec4 s1 = memBuf(uv, liveP);
    if (clear) { gl_FragColor = packMem(s1); return; }
    vec4 s2 = memBuf2(uv, s1);
    gl_FragColor = packMem(mix(s1, s2, k));
    return;
  }

  if (PASSINDEX == 3) {
    // PRESERVE statistics : running mean luminance of the LIVE image vs what the
    // present pass SHOWS, from a sparse 3x3 probe, eased like a slow fader
    // instead of flickering with the content. 16-bit per mean : an 8-bit mean
    // stepped the gain ~10% per LSB on dark material.
    float mIn = 0.0;
    float mWide = 0.0;
    for (int i = 0; i < 3; i++) {
      for (int j = 0; j < 3; j++) {
        vec2 p = vec2(0.17 + 0.33 * float(i), 0.17 + 0.33 * float(j));
        vec4 ci = premul(IMG_NORM_PIXEL(inputImage, p));
        vec4 cw = frameBlend ? memBuf2(p, memBuf(p, ci)) : memBuf(p, ci);
        if (mode == 4) cw.rgb = abs(ci.rgb - cw.rgb);
        mIn   += dot(ci.rgb, LUMA);
        mWide += dot(cw.rgb, LUMA);
      }
    }
    vec2 mean = vec2(mIn, mWide) / 9.0;
    vec2 h = vec2(0.5);
    vec4 st = IMG_NORM_PIXEL(stats, h);
    vec2 prev = vec2(dec16(st.rg), dec16(st.ba));
    vec2 eased = mix(mean, prev, pow(0.9, dts));
    gl_FragColor = vec4(enc16(eased.x), enc16(eased.y));
    return;
  }

  // Present. The memories are one frame behind (every pass target flips at the
  // end of the frame), so fold THIS frame in once more here : the newest light
  // shows now, not a frame late.
  vec4 m1 = memBuf(uv, liveP);
  vec4 wideP = accumulate(m1, liveP, k);
  if (frameBlend) {
    vec4 m2 = memBuf2(uv, m1);
    wideP = mix(wideP, m2, k);
  }
  // Difference : the live image against its own memory (only change glows). The
  // memory is a plain mean, so a still picture settles to black instead of
  // flickering.
  if (mode == 4) wideP = vec4(abs(liveP.rgb - wideP.rgb), max(liveP.a, wideP.a));
  float wa = clamp(wideP.a, 0.0, 1.0);
  vec3 wide = wa > 0.0 ? wideP.rgb / wa : vec3(0.0);
  // PRESERVE : re-anchor the shown memory's exposure to the live image (the
  // brightening and darkening modes push it away) by the ratio of the two
  // running means, so the trails keep their shape but the base image's colors
  // stay readable. Gain clamped so a black scene can't explode it.
  vec2 statC = vec2(0.5);
  vec4 st = IMG_NORM_PIXEL(stats, statC);
  float gain = clamp((dec16(st.rg) + 0.02) / (dec16(st.ba) + 0.02), 0.25, 4.0);
  wide *= mix(1.0, gain, preserve);
  gl_FragColor = mix(live, vec4(clamp(wide, 0.0, 1.0), wa), amount);
}
