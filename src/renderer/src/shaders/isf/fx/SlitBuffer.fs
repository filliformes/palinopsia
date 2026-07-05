/*{
  "DESCRIPTION": "Slit Buffer — time-smear of the input: a write head sweeps across the frame, freezing the live image into the persistent buffer as it passes, so columns behind the head hold older moments. A real slit-scan of whatever feeds the layer (Signal Culture SSSScan / PXLMSH register). Direction flips the sweep; Jitter breaks the seam into a ragged edge; Jumps teleports the whole playhead to random spots before/after its swept position.",
  "CREDIT": "Palinopsia (after Signal Culture SSSScan)",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Scan"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "rate",      "TYPE": "float", "MIN": 0.02, "MAX": 3.0, "DEFAULT": 0.3 },
    { "NAME": "width",     "TYPE": "float", "MIN": 0.005,"MAX": 0.2, "DEFAULT": 0.03 },
    { "NAME": "jitter",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "jumps",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "vertical",  "TYPE": "bool",  "DEFAULT": false },
    { "NAME": "direction", "TYPE": "long",  "VALUES": [0, 1], "LABELS": ["normal", "inverted"], "DEFAULT": 0 }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    float t = TIME * rate;
    float sweep = fract(t);                       // 0→1, wraps
    float head = (direction == 1) ? 1.0 - sweep : sweep; // inverted flips it

    // Jumps: on a stepped clock the WHOLE playhead teleports to a random spot
    // before or after its swept position (uniform across the frame — a real
    // head jump, distinct from jitter's per-band raggedness).
    float jt = floor(t * 3.0);                     // jump clock (~3 per unit t)
    float fire = step(1.0 - jumps, hash21(vec2(jt, 7.7)));  // more jumps → fires more
    head += fire * (hash21(vec2(jt, 3.3)) - 0.5) * 2.0 * jumps;

    // Jitter: a stepped noise offsets the seam per band and per sweep-tick, so
    // the write head stops being a clean line and wanders unpredictably.
    float cross = vertical ? uv.x : uv.y;
    float j = hash21(vec2(floor(cross * 50.0), floor(t * 6.0)));
    head += (j - 0.5) * jitter * 0.6;

    float axis = vertical ? uv.y : uv.x;
    float band = 1.0 - smoothstep(0.0, width, abs(axis - head));
    vec4 live = IMG_NORM_PIXEL(inputImage, uv);
    vec4 prev = IMG_NORM_PIXEL(buf, uv);
    // Where the head is, write live; elsewhere hold the frozen history.
    gl_FragColor = mix(prev, live, band);
  } else {
    gl_FragColor = IMG_NORM_PIXEL(buf, uv);
  }
}
