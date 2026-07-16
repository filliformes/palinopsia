/*{
  "DESCRIPTION": "Aperture : a projector's gate over the image — iris, vertical/horizontal slit, or a film-gate rectangle — with the two couplings a real gate has. FLICKER re-rolls the gate's opening on a drawn cadence (RATE), like a shutter breathing; DEFOCUS ties the lens to the gate, so as the aperture closes the image softens (the focus pull a contracting iris forces). Outside the gate is leader-black. SOFT feathers the gate edge.",
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

float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 px = 1.0 / RENDERSIZE;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  // Gate flicker : the opening re-rolls once per drawn frame (a held random,
  // not per-render noise), so the gate breathes on the cadence.
  float tick = floor(TIME * rate);
  float fl = hash1(tick);
  float open = size * (1.0 - flicker * fl * 0.65);

  // Gate distance by shape : 0 at centre → 1 at the gate edge.
  vec2 dv = (uv - 0.5) * vec2(aspect, 1.0);
  float d;
  if      (shape == 1) d = abs(dv.x) / (0.5 * aspect); // vertical slit
  else if (shape == 2) d = abs(dv.y) / 0.5;            // horizontal slit
  else if (shape == 3) d = max(abs(dv.x) / (0.5 * aspect), abs(dv.y) / 0.5); // film gate
  else                 d = length(dv) / 0.7;           // iris

  float gate = 1.0 - smoothstep(open, open + soft, d);

  // Defocus↔gate coupling : as the aperture closes, the lens softens. Closure is
  // measured against the RESTING opening, so a static small gate also defocuses.
  float closure = clamp(1.0 - open / max(size, 0.05), 0.0, 1.0) + (1.0 - size) * 0.5;
  float blurAmt = couple * clamp(closure, 0.0, 1.0);
  vec3 col = src.rgb;
  if (blurAmt > 0.003) {
    vec2 r = px * (1.0 + blurAmt * 10.0);
    col = (src.rgb * 2.0 +
      IMG_NORM_PIXEL(inputImage, uv + vec2(r.x, 0.0)).rgb +
      IMG_NORM_PIXEL(inputImage, uv - vec2(r.x, 0.0)).rgb +
      IMG_NORM_PIXEL(inputImage, uv + vec2(0.0, r.y)).rgb +
      IMG_NORM_PIXEL(inputImage, uv - vec2(0.0, r.y)).rgb +
      IMG_NORM_PIXEL(inputImage, uv + r).rgb +
      IMG_NORM_PIXEL(inputImage, uv - r).rgb) / 8.0;
  }

  col *= gate; // outside the gate : leader-black
  gl_FragColor = vec4(mix(src.rgb, col, amount), src.a);
}
