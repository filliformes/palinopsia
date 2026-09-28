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
    { "NAME": "blackout", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0 },
    { "NAME": "trig", "TYPE": "event", "DEFAULT": false, "LABEL": "fire ▸" }
  ],
  "PASSES": [
    { "TARGET": "held", "PERSISTENT": true },
    { }
  ]
}*/

// Integrated phases (engine/phases.ts) : a knob change moves the picture on
// from where it is instead of jumping it.
uniform float PH_rate;
uniform float PH_rate_x_jitter;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // precise hash : no rows, no lattice over hours
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Per-band segment id: each band runs its own clock : jitter detunes the
// band clocks from each other so freezes stop lining up.
float segFor(float band) {
  // ∫ rate·(1 + d·jitter) = PH_rate + d·PH_rate_x_jitter : no jump when either moves.
  // Every phase starts at its own random offset, and at jitter 0 the detune
  // phase stops where it is : gated off at 0, so the bands line up again
  // (one re-roll as jitter crosses 0, harmless on a stepped clock).
  float d = (hash(vec2(band, 4.2)) - 0.5) * 1.6;
  float phase = hash(vec2(band, 8.8)) * 7.0 * jitter;
  float detune = d * PH_rate_x_jitter * step(0.001, jitter);
  return mod(floor(PH_rate + detune + phase), 32749.0);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float band = floor(uv.y * bands);
  float seg = segFor(band);

  // Both passes make the same freeze decision : the output pass reads `held` as
  // the runtime left it LAST frame (targets flip after all passes), which is
  // exactly what pass 0 reads as `prev`, so recomputing here shows this frame's
  // result with no frame of latency.
  float freeze = max(step(1.0 - chance, hash(vec2(seg, band * 31.7 + 7.0))), float(trig)); // trig = punch-in
  vec4 live = IMG_NORM_PIXEL(inputImage, uv);
  vec4 prev = IMG_NORM_PIXEL(held, uv);
  // An EMPTY buffer (alpha exactly 0 : first frame after insert or resize, or
  // PANIC) holds nothing yet : take the live frame instead of freezing black.
  // Written pixels keep alpha >= 1/255, so a transparent input still counts
  // as written (the output maps that floor back to 0).
  if (prev.a < 0.5 / 255.0) freeze = 0.0;
  vec4 o = mix(live, prev, freeze);

  if (PASSINDEX == 0) {
    gl_FragColor = vec4(o.rgb, max(o.a, 1.0 / 255.0));
  } else {
    // BLACKOUT: a blackout-sized share of segments blank their band :
    // the screen strobes off region by region.
    float blank = step(1.0 - blackout * 0.5, hash(vec2(seg, band * 17.3 + 41.0)));
    float a = o.a < 1.5 / 255.0 ? 0.0 : o.a; // undo the written-pixel floor
    gl_FragColor = vec4(o.rgb * (1.0 - blank), a);
  }
}
