/*{
  "DESCRIPTION": "Wide Time — a temporal average across the last N frames (after Jean Piché's use of AE's CC Wide Time). The image continuously crossfades with its own recent past, so motion smears into clean, evolving visual-music scapes. WIDTH is how many frames wide the window is; MIX is dry/wet; MODE is how each new frame accumulates (mean / brightest / add / screen / difference / darkest); SOFTEN blurs the trails; DRIFT slowly zooms the memory for breathing scapes; HUE evolves the colour of the fading past. MOTION BLUR simulates a shutter (blurs moving areas); FRAME BLEND runs a second weighted temporal pass for a smoother, more symmetric blend — both on for best results, like AE. Real-time, so the window reaches into the PAST only.",
  "CREDIT": "Palinopsia (after Jean Piché / CC Wide Time)",
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
    { "NAME": "frameBlend", "TYPE": "bool", "DEFAULT": true, "LABEL": "frame blend" }
  ],
  "PASSES": [
    { "TARGET": "buf",  "PERSISTENT": true },
    { "TARGET": "buf2", "PERSISTENT": true },
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

  // Present: pick the (optionally frame-blended) memory, dry/wet against live.
  vec3 a = IMG_NORM_PIXEL(buf, uv).rgb;
  vec3 b = IMG_NORM_PIXEL(buf2, uv).rgb;
  vec3 wide = frameBlend ? b : a;
  vec4 cur = IMG_NORM_PIXEL(inputImage, uv);
  gl_FragColor = mix(cur, vec4(wide, 1.0), amount);
}
