/*{
  "DESCRIPTION": "Stutter : probabilistic frame holds, now chaotic: BANDS split the screen into horizontal regions that freeze independently, JITTER gives each band its own irregular clock, and BLACKOUT makes segments blank the region entirely (the chaotic on/off of the screen).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.5, "MAX": 20.0, "DEFAULT": 6.0 },
    { "NAME": "chance",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4 },
    { "NAME": "bands",    "TYPE": "float", "MIN": 1.0, "MAX": 24.0, "DEFAULT": 1.0 },
    { "NAME": "jitter",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0 },
    { "NAME": "blackout", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0 }
  ],
  "PASSES": [
    { "TARGET": "held", "PERSISTENT": true },
    { }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

// Per-band segment id: each band runs its own clock : jitter detunes the
// band clocks from each other so freezes stop lining up.
float segFor(float band) {
  float ownRate = rate * (1.0 + (hash(vec2(band, 4.2)) - 0.5) * jitter * 1.6);
  float phase = hash(vec2(band, 8.8)) * 7.0 * jitter;
  return floor(TIME * ownRate + phase);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float band = floor(uv.y * bands);
  float seg = segFor(band);

  if (PASSINDEX == 0) {
    float freeze = step(1.0 - chance, hash(vec2(seg, band * 31.7 + 7.0)));
    vec4 live = IMG_NORM_PIXEL(inputImage, uv);
    vec4 prev = IMG_NORM_PIXEL(held, uv);
    gl_FragColor = mix(live, prev, freeze);
  } else {
    // BLACKOUT: a blackout-sized share of segments blank their band —
    // the screen strobes off region by region.
    float blank = step(1.0 - blackout * 0.5, hash(vec2(seg, band * 17.3 + 41.0)));
    vec4 s = IMG_NORM_PIXEL(held, uv);
    gl_FragColor = vec4(s.rgb * (1.0 - blank), s.a);
  }
}
