/*{
  "DESCRIPTION": "Wide Time — a temporal average across the last N frames (after Jean Piché's use of AE's Wide Time). The image continuously crossfades with its own recent past, so motion smears into clean, evolving visual-music scapes. WIDTH sets how many frames wide the time window is; MIX is dry/wet; BIAS slides from a smooth mean average (ghosting) toward a max-bright accumulation (light-painting streaks). Real-time, so the window reaches into the PAST only.",
  "CREDIT": "Palinopsia (after Jean Piché / CC Wide Time)",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Time", "Feedback", "Blur"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "width",  "TYPE": "float", "MIN": 1.0, "MAX": 120.0, "DEFAULT": 20.0, "LABEL": "width" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 1.0,  "LABEL": "mix" },
    { "NAME": "bias",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.0,  "LABEL": "bright" }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;

  if (PASSINDEX == 0) {
    // decay derived from the window width: a wider window remembers longer.
    // acc = mix(cur, prev, decay) is an exponential moving average whose
    // effective span is ~`width` frames — a continuous crossfade across time.
    float decay = width / (width + 1.0);
    vec4 cur = IMG_NORM_PIXEL(inputImage, uv);
    vec4 prev = IMG_NORM_PIXEL(buf, uv);
    // Smooth mean (clean ghosting) ↔ brightest-wins (light-painting streaks).
    vec3 mean = mix(cur.rgb, prev.rgb, decay);
    vec3 bright = max(cur.rgb, prev.rgb * decay);
    vec3 acc = mix(mean, bright, bias);
    gl_FragColor = vec4(acc, 1.0);
    return;
  }

  // Dry/wet against the live frame.
  vec4 cur = IMG_NORM_PIXEL(inputImage, uv);
  vec4 wide = IMG_NORM_PIXEL(buf, uv);
  gl_FragColor = mix(cur, wide, amount);
}
