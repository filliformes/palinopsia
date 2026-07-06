/*{
  "DESCRIPTION": "Wide Time — a temporal average across the last N frames (after Jean Piché's use of AE's Wide Time). The image continuously crossfades with its own recent past, so motion smears into clean, evolving visual-music scapes. WIDTH is how many frames wide the time window is; MIX is dry/wet; MODE is how each new frame accumulates (mean average, brightest, add, screen, difference, darkest); SMOOTH blurs the trails so movement lines soften; DRIFT slowly zooms the memory for breathing feedback scapes; HUE rotates the colour of the fading past so the trails evolve through the spectrum. Real-time, so the window reaches into the PAST only.",
  "CREDIT": "Palinopsia (after Jean Piché / CC Wide Time)",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Time", "Feedback", "Blur"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "width",  "TYPE": "float", "MIN": 1.0, "MAX": 500.0, "DEFAULT": 20.0, "LABEL": "width" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 1.0,  "LABEL": "mix" },
    { "NAME": "mode",   "TYPE": "long",  "VALUES": [0,1,2,3,4,5],
      "LABELS": ["mean","brightest","add","screen","difference","darkest"], "DEFAULT": 0, "LABEL": "mode" },
    { "NAME": "smooth", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.0,  "LABEL": "smooth" },
    { "NAME": "drift",  "TYPE": "float", "MIN": -0.02, "MAX": 0.02, "DEFAULT": 0.0, "LABEL": "drift" },
    { "NAME": "hue",    "TYPE": "float", "MIN": -0.1, "MAX": 0.1,  "DEFAULT": 0.0,  "LABEL": "hue" }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
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

  if (PASSINDEX == 0) {
    float decay = width / (width + 1.0);

    // Memory sample point: DRIFT zooms it about centre for breathing scapes.
    vec2 c = (uv - 0.5) * (1.0 - drift) + 0.5;
    // SMOOTH: a 5-tap cross blur of the memory (compounds over frames, so the
    // lines that motion draws soften). At 0 every tap coincides → no blur.
    vec2 e  = vec2(smooth * 0.004, 0.0);
    vec2 g  = vec2(0.0, smooth * 0.004);
    vec2 cl = c - e; vec2 cr = c + e; vec2 cu = c + g; vec2 cd = c - g;
    vec3 hist = IMG_NORM_PIXEL(buf, c).rgb  * 0.4
              + IMG_NORM_PIXEL(buf, cl).rgb * 0.15
              + IMG_NORM_PIXEL(buf, cr).rgb * 0.15
              + IMG_NORM_PIXEL(buf, cu).rgb * 0.15
              + IMG_NORM_PIXEL(buf, cd).rgb * 0.15;
    // Evolve the colour of the fading past.
    hist = hueRot(hist, hue);

    vec3 cur = IMG_NORM_PIXEL(inputImage, uv).rgb;
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

  vec4 cur = IMG_NORM_PIXEL(inputImage, uv);
  vec4 wide = IMG_NORM_PIXEL(buf, uv);
  gl_FragColor = mix(cur, wide, amount);
}
