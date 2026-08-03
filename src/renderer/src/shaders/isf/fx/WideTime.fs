/*{
  "DESCRIPTION": "Wide Time : a temporal average across the last N frames. The image continuously crossfades with its own recent past, so motion smears into clean, evolving visual-music scapes. WIDTH is how many frames wide the window is; MIX is dry/wet; MODE is how each new frame accumulates (mean / brightest / add / screen / difference / darkest); SOFTEN blurs the trails; DRIFT slowly zooms the memory for breathing scapes; HUE evolves the colour of the fading past. MOTION BLUR simulates a shutter (blurs moving areas); FRAME BLEND runs a second weighted temporal pass for a smoother, more symmetric blend : both on for best results. PRESERVE anchors the output's exposure to the live image (the brightening/darkening modes otherwise push it away) : 0 = the raw accumulated look, 1 = fully re-anchored, so the base image's colours stay readable under the trails. Real-time, so the window reaches into the PAST only.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Time", "Feedback", "Blur"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "width",  "TYPE": "float", "MIN": 1.0, "MAX": 500.0, "DEFAULT": 20.0, "LABEL": "width" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 1.0,  "LABEL": "mix" },
    { "NAME": "mode",   "TYPE": "long",  "VALUES": [0,1,2,3,4,5],
      "LABELS": ["mean","brightest","add","screen","difference","darkest"], "DEFAULT": 0, "LABEL": "mode" },
    { "NAME": "soften", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.0,  "LABEL": "soften" },
    { "NAME": "drift",  "TYPE": "float", "MIN": -0.02, "MAX": 0.02, "DEFAULT": 0.0, "LABEL": "drift" },
    { "NAME": "hue",    "TYPE": "float", "MIN": -0.1, "MAX": 0.1,  "DEFAULT": 0.0,  "LABEL": "hue" },
    { "NAME": "motionBlur", "TYPE": "bool", "DEFAULT": true, "LABEL": "motion blur" },
    { "NAME": "frameBlend", "TYPE": "bool", "DEFAULT": true, "LABEL": "frame blend" },
    { "NAME": "preserve", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "preserve" }
  ],
  "PASSES": [
    { "TARGET": "buf",   "PERSISTENT": true },
    { "TARGET": "buf2",  "PERSISTENT": true },
    { "TARGET": "stats", "PERSISTENT": true, "WIDTH": 1, "HEIGHT": 1 },
    { }
  ]
}*/

// Hue rotation around the grey axis (Rodrigues); h in turns.
vec3 hueRot(vec3 c, float h) {
  const vec3 k = vec3(0.57735026);
  float a = h * 6.2831853;
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float decay = width / (width + 1.0);

  if (PASSINDEX == 0) {
    // ── Memory sample: DRIFT zooms it about centre; SOFTEN cross-blurs it
    //    (compounds over frames → soft trails); HUE evolves its colour. ──
    vec2 c = (uv - 0.5) * (1.0 - drift) + 0.5;
    vec2 e  = vec2(soften * 0.004, 0.0);
    vec2 g  = vec2(0.0, soften * 0.004);
    vec2 cl = c - e; vec2 cr = c + e; vec2 cu = c + g; vec2 cd = c - g;
    vec3 hist = IMG_NORM_PIXEL(buf, c).rgb  * 0.4
              + IMG_NORM_PIXEL(buf, cl).rgb * 0.15
              + IMG_NORM_PIXEL(buf, cr).rgb * 0.15
              + IMG_NORM_PIXEL(buf, cu).rgb * 0.15
              + IMG_NORM_PIXEL(buf, cd).rgb * 0.15;
    hist = hueRot(hist, hue);

    // ── Current frame, with MOTION BLUR (shutter): blur the input where it
    //    differs from the running average (i.e. where there's motion). ──
    vec3 curSharp = IMG_NORM_PIXEL(inputImage, uv).rgb;
    vec3 cur = curSharp;
    if (motionBlur) {
      vec2 mb = vec2(0.003, 0.0);
      vec2 mg = vec2(0.0, 0.003);
      vec2 il = uv - mb; vec2 ir = uv + mb; vec2 iu = uv + mg; vec2 id = uv - mg;
      vec3 curBlur = (curSharp
        + IMG_NORM_PIXEL(inputImage, il).rgb
        + IMG_NORM_PIXEL(inputImage, ir).rgb
        + IMG_NORM_PIXEL(inputImage, iu).rgb
        + IMG_NORM_PIXEL(inputImage, id).rgb) * 0.2;
      vec3 mem = IMG_NORM_PIXEL(buf, uv).rgb;
      float motion = clamp(length(curSharp - mem) * 3.0, 0.0, 1.0);
      cur = mix(curSharp, curBlur, motion);
    }

    // ── Accumulate per MODE. ──
    vec3 hd = hist * decay;
    vec3 acc;
    if (mode == 1) acc = max(cur, hd);                          // brightest
    else if (mode == 2) acc = min(cur + hd, vec3(1.0));         // add
    else if (mode == 3) acc = 1.0 - (1.0 - cur) * (1.0 - hd);   // screen
    else if (mode == 4) acc = mix(cur, abs(cur - hist), decay); // difference
    else if (mode == 5) acc = min(cur, mix(vec3(1.0), hist, decay)); // darkest
    else acc = mix(cur, hist, decay);                           // mean average
    gl_FragColor = vec4(clamp(acc, 0.0, 1.0), 1.0);
    return;
  }

  if (PASSINDEX == 1) {
    // FRAME BLEND: a second weighted temporal pass (an EMA over the accumulator)
    // → a smoother, more symmetric time kernel. Always computed; the present
    // pass only reads it when frame blending is on.
    vec3 s1 = IMG_NORM_PIXEL(buf, uv).rgb;
    vec3 s2 = IMG_NORM_PIXEL(buf2, uv).rgb;
    gl_FragColor = vec4(mix(s1, s2, decay), 1.0);
    return;
  }

  if (PASSINDEX == 2) {
    // PRESERVE statistics : running mean luminance of the LIVE image vs the
    // WIDE buffer, from a sparse 3x3 probe, EMA-smoothed so the compensation
    // rides like a slow fader instead of flickering with the content. 1x1
    // persistent target; the present pass turns the ratio into a gain.
    vec2 h = vec2(0.5);
    float mIn = 0.0;
    float mWide = 0.0;
    for (int i = 0; i < 3; i++) {
      for (int j = 0; j < 3; j++) {
        vec2 p = vec2(0.17 + 0.33 * float(i), 0.17 + 0.33 * float(j));
        vec3 ci = IMG_NORM_PIXEL(inputImage, p).rgb;
        // Sample the same buffer the present pass shows (frameBlend picks buf2).
        vec3 cw = frameBlend ? IMG_NORM_PIXEL(buf2, p).rgb : IMG_NORM_PIXEL(buf, p).rgb;
        mIn   += dot(ci, vec3(0.299, 0.587, 0.114));
        mWide += dot(cw, vec3(0.299, 0.587, 0.114));
      }
    }
    vec2 mean = vec2(mIn, mWide) / 9.0;
    vec2 prev = IMG_NORM_PIXEL(stats, h).xy;
    gl_FragColor = vec4(mix(mean, prev, 0.9), 0.0, 1.0);
    return;
  }

  // Present: pick the (optionally frame-blended) memory, dry/wet against live.
  vec3 a = IMG_NORM_PIXEL(buf, uv).rgb;
  vec3 b = IMG_NORM_PIXEL(buf2, uv).rgb;
  vec3 wide = frameBlend ? b : a;
  // PRESERVE : re-anchor the wide buffer's exposure to the live image. The
  // accumulating modes drift structurally (brightest/add/screen only ever
  // brighten, darkest only darkens); this scales them back by the ratio of the
  // two running means, so the trails keep their shape but the base image's
  // colours stay readable. Gain clamped so a black scene can't explode it.
  vec2 statC = vec2(0.5);
  vec2 m = IMG_NORM_PIXEL(stats, statC).xy;
  float gain = clamp((m.x + 0.02) / (m.y + 0.02), 0.25, 4.0);
  wide *= mix(1.0, gain, preserve);
  vec4 cur = IMG_NORM_PIXEL(inputImage, uv);
  gl_FragColor = mix(cur, vec4(clamp(wide, 0.0, 1.0), 1.0), amount);
}
