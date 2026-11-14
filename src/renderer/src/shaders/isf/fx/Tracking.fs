/*{
  "DESCRIPTION": "Tracking : VHS tracking error. The classic noisy band (head-switch tear, per-line wobble, dropout dashes) placed by POSITION and crept by ROLL : plus an auto-wandering FREEZE line that holds one row across a stripe of the frame, per-pixel analog x-distortion, and the tape's tinted chroma BLEED (the red channel trailing to the right, as a tape's narrow chroma band smears it, tinted between magenta and cyan, drifting with the scan).",
  "CREDIT": "Palinopsia; the set of features follows VIDVOX's MIT 'VHS Glitch' (ISF-Files), see THIRD_PARTY_NOTICES.md",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Analog", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "band",     "TYPE": "float", "MIN": 0.0, "MAX": 0.4, "DEFAULT": 0.12, "LABEL": "band height" },
    { "NAME": "position", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.06 },
    { "NAME": "roll",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "wobble",   "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.05 },
    { "NAME": "noise",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "flutter rate" },
    { "NAME": "freeze",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "freeze line" },
    { "NAME": "distort",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "analog distort" },
    { "NAME": "bleed",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "chroma bleed" },
    { "NAME": "bleedRange","TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "bleed range" }
  ]
}*/

// Integrated phases (engine/phases.ts) : a knob change moves the picture on
// from where it is instead of jumping it.
uniform float PH_rate;
uniform float PH_roll; // wrap 16.666666666666668

// @dome

// third-party: VIDVOX VHS Glitch (the feature set; the code is Palinopsia's own)
const float TAU = 6.28318530718;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // precise hash : no rows, no lattice over hours
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Smooth 1D value noise over time, in 0..1 (for the freeze line's wander).
float tnoise(float x) {
  float i = floor(x), f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash(vec2(i, 5.0)), hash(vec2(i + 1.0, 5.0)), u);
}
float rand3(vec3 co) {
  vec3 p3 = fract(co * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// Vertical distance on a wrapped screen (so a rolling band crosses the top
// and reappears at the bottom seamlessly).
float wd(float a, float b) {
  float d = abs(a - b);
  return min(d, 1.0 - d);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  // On the full dome (lib/dome.glsl) the tape's lines are RINGS round the
  // zenith : the band sits low on the walls (the frame's bottom) and creeps up
  // them to the zenith, and the wobble twists the rings round the dome instead
  // of shifting rows sideways. Across the lines (yy) : up the frame, or up the
  // dome from the frame's rim (0) to the zenith (1), half a frame height (lk :
  // units of yy in a frame height).
  bool dome = DOME_FILL > 0.0;
  vec2 pol = dome ? domePolar(uv) : vec2(0.0);
  float yy = dome ? 1.0 - pol.y : uv.y;
  float xx = dome ? pol.x + 0.5 : uv.x;
  float lk = dome ? 2.0 : 1.0;
  float t = mod(floor(TIME * 6.0 + PH_rate * 44.0), 32749.0); // field-rate flutter
  float line = floor(yy * 300.0 / lk);

  // ── The tracking band: `position` places it, `roll` creeps it upward. ──
  float center = fract(position + PH_roll * 0.06);
  float bandHalf = band * 0.5 * lk * (0.8 + 0.2 * hash(vec2(t, 1.0)));
  float d = wd(yy, center);
  float inBand = 1.0 - smoothstep(bandHalf * 0.4, bandHalf, d);

  // ── Auto-wandering FREEZE line : a narrow stripe that drifts on two octaves
  // of smooth value noise (a slow wander and a quicker nervous one); inside it
  // every pixel reads the stripe's upper edge : one row held across it. ──
  float fLine = fract(0.5 + 0.8 * (tnoise(TIME * 0.07) - 0.5) + 0.25 * (tnoise(TIME * 0.41 + 31.0) - 0.5));
  float fWidth = freeze * 0.03 * lk * (0.3 + 0.7 * tnoise(TIME * 0.6 + 77.0));

  // Per-line wobble: strong inside the band, a whisper elsewhere.
  float wob = (hash(vec2(line, t)) - 0.5) * 2.0;
  float shift = wob * wobble * (inBand + 0.06);

  // Analog distortion: random per-line x displacement, everywhere (the tape's
  // never-still jitter), a few pixels of the frame per line.
  // The hash needs whole-number inputs (a continuous uv.y makes it a sawtooth) :
  // one draw per tape line (480, like the parasites) and per field, wrapped.
  float rX = rand3(vec3(floor(yy * 480.0 / lk), floor(fLine * 4096.0), mod(floor(TIME * 59.94), 4096.0)));
  // 9 px of a 1080p frame's half-width, taken relative to the frame height so
  // the jitter is the same share of the frame at 4K or on the dome.
  shift += distort * 18.0 * rX / (1080.0 * RENDERSIZE.x / RENDERSIZE.y);

  vec2 c = vec2(fract(uv.x + shift), uv.y);
  bool frozen = freeze > 0.001 && wd(yy, fLine) < fWidth;
  float fRow = fract(fLine + fWidth); // the stripe's upper edge : the held row
  if (frozen) c.y = fRow;
  if (dome) {
    // the ring turned as far round as a flat line shifts across at the horizon;
    // the frozen line is a ring, read at its own radius
    c = domeFrame(domeRot(domeDisc(uv) * ((1.0 - (frozen ? fRow : yy)) / max(pol.y, 1e-5)), 2.0 * shift / domeHorizon()));
  }
  vec4 s = IMG_NORM_PIXEL(inputImage, c);

  // Inside the band: luminance flutter + white dropout dashes.
  float flutter = 1.0 - inBand * noise * 0.4 * hash(vec2(line, t + 7.0));
  float dash = inBand * step(0.94 - noise * 0.08, hash(vec2(line, t + 13.0))) *
    step(hash(vec2(floor(xx * (dome ? 64.0 : 24.0)), line + t)), 0.4);
  vec3 col = s.rgb * flutter + vec3(0.9) * dash;

  // ── Tinted chroma bleed : a tape's chroma has a fraction of the luma's
  // bandwidth and lags it, so colour trails to the RIGHT of what made it. The
  // red channel is read through a one-sided tail of taps to the left, weighted
  // by an exponential decay, then tinted between magenta and cyan by a phase
  // that drifts down the frame. Coords hoisted to bare vec2s (runtime rule). ──
  if (bleed > 0.001) {
    float stp = 0.008 * bleedRange;
    float acc = 0.0, wsum = 0.0;
    for (int i = 1; i <= 5; i++) {
      float w = exp(-0.45 * float(i));
      vec2 bc = c - vec2(stp * float(i), 0.0);
      acc += w * IMG_NORM_PIXEL(inputImage, bc).r;
      wsum += w;
    }
    float bl = acc / wsum * bleed * 2.0;
    // Soft gate (a hard cut left a contour line across red gradients).
    bl *= smoothstep(0.05, 0.15, bl);
    if (bl > 0.0) {
      float ph = 0.5 + 0.5 * sin(TAU * (c.y * 1.3 + TIME * 0.05) + 1.7 * sin(TIME * 0.13 + c.y * 4.0));
      vec3 tint = mix(vec3(0.85, 0.08, 0.55), vec3(0.08, 0.6, 0.85), ph);
      col += bl * max(inBand, 0.35) * tint;
    }
  }

  // Head-switch flash rides the band's lower edge (wraps with the roll).
  float headSwitch = (1.0 - smoothstep(0.0, 0.012 * lk, wd(yy, fract(center - bandHalf)))) * 0.5;
  col += vec3(headSwitch);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), s.a);
}
