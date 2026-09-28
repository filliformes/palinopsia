/*{
  "DESCRIPTION": "Aperture : a projector's gate over the image (iris, vertical/horizontal slit, or a film-gate rectangle) with the two couplings a real gate has. FLICKER re-rolls the gate's opening on a drawn cadence (RATE), like a shutter breathing; DEFOCUS ties the lens to the gate, so as the aperture closes the image softens (the focus pull a contracting iris forces). Outside the gate is leader-black. SOFT feathers the gate edge.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Cameraless", "Utility"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "shape",   "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["iris", "slit v", "slit h", "gate"], "DEFAULT": 0, "LABEL": "gate shape" },
    { "NAME": "size",    "TYPE": "float", "MIN": 0.05, "MAX": 1.0, "DEFAULT": 0.6,  "LABEL": "opening" },
    { "NAME": "soft",    "TYPE": "float", "MIN": 0.005, "MAX": 0.5, "DEFAULT": 0.12, "LABEL": "feather" },
    { "NAME": "flicker", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.0,  "LABEL": "gate flicker" },
    { "NAME": "rate",    "TYPE": "float", "MIN": 1.0,  "MAX": 24.0, "DEFAULT": 8.0,  "LABEL": "cadence (fps)" },
    { "NAME": "couple",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.5,  "LABEL": "defocus couple" },
    { "NAME": "amount",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 1.0,  "LABEL": "mix" }
  ]
}*/

// Integrated phases (engine/phases.ts) : a knob change moves the picture on
// from where it is instead of jumping it.
uniform float PH_rate;

float hash1(float n) { n = fract(n * 0.1031); n *= n + 33.33; n *= n + n; return fract(n); }

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  // Gate flicker : the opening re-rolls once per drawn frame (a held random,
  // not per-render noise), so the gate breathes on the cadence.
  float tick = mod(floor(PH_rate), 32749.0);
  float fl = hash1(tick);
  float open = size * (1.0 - flicker * fl * 0.65);

  // Gate distance by shape : 0 at center → 1 at the gate edge.
  vec2 dv = (uv - 0.5) * vec2(aspect, 1.0);
  float d;
  if      (shape == 1) d = abs(dv.x) / (0.5 * aspect); // vertical slit
  else if (shape == 2) d = abs(dv.y) / 0.5;            // horizontal slit
  else if (shape == 3) d = max(abs(dv.x) / (0.5 * aspect), abs(dv.y) / 0.5); // film gate
  else {
    // Iris : radius 0.7 of the frame height, widening over the top of the
    // OPENING range so that fully open it clears the frame corners at any aspect.
    float rIris = mix(0.7, max(0.5 * length(vec2(aspect, 1.0)), 0.7), smoothstep(0.8, 1.0, size));
    d = length(dv) / rIris;
  }

  float gate = 1.0 - smoothstep(open, open + soft, d);

  // Defocus↔gate coupling : as the aperture closes, the lens softens. Closure is
  // measured against the RESTING opening, so a static small gate also defocuses.
  float closure = clamp(1.0 - open / max(size, 0.05), 0.0, 1.0) + (1.0 - size) * 0.5;
  float blurAmt = couple * clamp(closure, 0.0, 1.0);
  vec3 col = src.rgb;
  if (blurAmt > 0.003) {
    // Radius in 1080p pixels (1 to 11) taken relative to the frame HEIGHT, so it
    // is the same share of the frame at 4K or on the dome. Sparse 8-tap ring :
    // opened wide, the taps read as the stepped, octagonal defocus of a cheap
    // projection lens (kept on purpose). Tap coordinates are hoisted to bare
    // vec2s : the ISF parser keeps only one comma-piece of an IMG_NORM_PIXEL
    // argument, so `uv + vec2(a, b)` inside the call would compile as vec2(a).
    vec2 r = vec2(1.0 / aspect, 1.0) * (1.0 + blurAmt * 10.0) / 1080.0;
    vec2 rd = r * 0.7071;
    vec2 t0 = uv + vec2(r.x, 0.0);
    vec2 t1 = uv - vec2(r.x, 0.0);
    vec2 t2 = uv + vec2(0.0, r.y);
    vec2 t3 = uv - vec2(0.0, r.y);
    vec2 t4 = uv + rd;
    vec2 t5 = uv - rd;
    vec2 t6 = uv + vec2(rd.x, -rd.y);
    vec2 t7 = uv + vec2(-rd.x, rd.y);
    col = (src.rgb * 2.0 +
      IMG_NORM_PIXEL(inputImage, t0).rgb + IMG_NORM_PIXEL(inputImage, t1).rgb +
      IMG_NORM_PIXEL(inputImage, t2).rgb + IMG_NORM_PIXEL(inputImage, t3).rgb +
      IMG_NORM_PIXEL(inputImage, t4).rgb + IMG_NORM_PIXEL(inputImage, t5).rgb +
      IMG_NORM_PIXEL(inputImage, t6).rgb + IMG_NORM_PIXEL(inputImage, t7).rgb) / 10.0;
  }

  col *= gate; // outside the gate : leader-black
  gl_FragColor = vec4(mix(src.rgb, col, amount), src.a);
}
