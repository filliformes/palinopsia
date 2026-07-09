/*{
  "DESCRIPTION": "Tracking : VHS tracking error, rebuilt on the VIDVOX 'VHS Glitch' model (Staffan Widegarn Åhlvik). The classic noisy band (head-switch tear, per-line wobble, dropout dashes) placed by POSITION and crept by ROLL : plus an auto-wandering FREEZE line that smears one row across the frame, per-pixel analog x-distortion, and the tape's tinted chroma BLEED (red channel dragged sideways through magenta↔cyan, warbling with the scan).",
  "CREDIT": "Palinopsia, after David Lublin / Staffan Widegarn Åhlvik",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "band",     "TYPE": "float", "MIN": 0.0, "MAX": 0.4, "DEFAULT": 0.12 },
    { "NAME": "position", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.06 },
    { "NAME": "roll",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "wobble",   "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.05 },
    { "NAME": "noise",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4 },
    { "NAME": "freeze",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "freeze line" },
    { "NAME": "distort",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "analog distort" },
    { "NAME": "bleed",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "chroma bleed" },
    { "NAME": "bleedRange","TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "bleed range" }
  ]
}*/

const float TAU = 6.28318530718;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float rand3(vec3 co) {
  return abs(mod(sin(dot(co, vec3(12.9898, 78.233, 45.5432))) * 43758.5453, 1.0));
}

// Vertical distance on a wrapped screen (so a rolling band crosses the top
// and reappears at the bottom seamlessly).
float wd(float a, float b) {
  float d = abs(a - b);
  return min(d, 1.0 - d);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float t = floor(TIME * (6.0 + rate * 44.0)); // field-rate flutter
  float line = floor(uv.y * 300.0);

  // ── The tracking band: `position` places it, `roll` creeps it upward. ──
  float center = fract(position + roll * TIME * 0.06);
  float half = band * 0.5 * (0.8 + 0.2 * hash(vec2(t, 1.0)));
  float d = wd(uv.y, center);
  float inBand = smoothstep(half, half * 0.4, d);

  // ── Auto-wandering FREEZE line (VHS Glitch's actualXLine): a narrow row
  // that drifts on stacked incommensurate sines; inside its width the sampled
  // row snaps to the line : one row smeared across a stripe of the frame. ──
  float fLine = mod(0.5 + ((1.0 + sin(0.34 * TIME)) / 2.0 + (1.0 + sin(TIME)) / 3.0 +
    (1.0 + cos(2.1 * TIME)) / 3.0 + (1.0 + cos(0.027 * TIME)) / 2.0) / 3.5, 1.0);
  float fWidth = freeze * 0.06 * ((1.0 + sin(1.2 * TIME)) / 2.0 +
    (1.0 + cos(3.91 * TIME)) / 3.0 + (1.0 + cos(0.014 * TIME)) / 2.0) / 3.5;

  // Per-line wobble: strong inside the band, a whisper elsewhere.
  float wob = (hash(vec2(line, t)) - 0.5) * 2.0;
  float shift = wob * wobble * (inBand + 0.06);

  // Analog distortion: random per-line x displacement, everywhere (the tape's
  // never-still jitter), scaled like the reference's analogDistort/RENDERSIZE.
  float rX = rand3(vec3(uv.y, fLine, 1.0 + distort * 9.0));
  shift += distort * 9.0 * rX / (RENDERSIZE.x / 2.0);

  vec2 c = vec2(fract(uv.x + shift), uv.y);
  if (freeze > 0.001 && wd(uv.y, fLine) < fWidth) c.y = fLine; // the frozen row
  vec4 s = IMG_NORM_PIXEL(inputImage, c);

  // Inside the band: luminance flutter + white dropout dashes.
  float flutter = 1.0 - inBand * noise * 0.4 * hash(vec2(line, t + 7.0));
  float dash = inBand * step(0.94 - noise * 0.08, hash(vec2(line, t + 13.0))) *
    step(hash(vec2(floor(uv.x * 24.0), line + t)), 0.4);
  vec3 col = s.rgb * flutter + vec3(0.9) * dash;

  // ── Tinted chroma bleed (the reference's signature): the red channel
  // dragged through offset taps, tinted magenta at the edges / cyan centre,
  // warbling with the scan. Coords hoisted to bare vec2s (runtime rule). ──
  if (bleed > 0.001) {
    vec2 b1 = c + bleedRange * vec2(0.02, 0.0);
    vec2 b2 = c + bleedRange * vec2(0.01, 0.01);
    vec2 b3 = c + bleedRange * vec2(-0.02, 0.02);
    vec2 b4 = c + bleedRange * vec2(0.0, -0.03);
    float bl = (IMG_NORM_PIXEL(inputImage, b1).r + IMG_NORM_PIXEL(inputImage, b2).r +
                IMG_NORM_PIXEL(inputImage, b3).r + IMG_NORM_PIXEL(inputImage, b4).r) / 6.0;
    bl *= bleed * 3.0;
    if (bl > 0.1) {
      float bx = c.x + (0.05 + (1.5 + cos(TIME / 13.0 + TAU * (0.5 + (1.0 - c.y)))) / 2.0) *
        sin((TIME / 9.0 + 0.5) * TAU + c.y * c.y * TAU) / 8.0;
      vec3 tintL = vec3(0.8, 0.0, 0.4);
      vec3 tintC = vec3(0.0, 0.5, 0.9);
      vec3 tint = (bx < 0.5) ? mix(tintL, tintC, 2.0 * bx) : mix(tintL, tintC, 2.0 - 2.0 * bx);
      col += bl * max(inBand, 0.35) * tint;
    }
  }

  // Head-switch flash rides the band's lower edge (wraps with the roll).
  float headSwitch = smoothstep(0.012, 0.0, wd(uv.y, fract(center - half))) * 0.5;
  col += vec3(headSwitch);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), s.a);
}
