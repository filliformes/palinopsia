/*{
  "DESCRIPTION": "Row Echo : a chance-selected set of row bands freeze onto their top line and repeat it downward (the line-freeze / line-hold read). Held rows refresh on a stepped clock; fade lets each held band melt back into the live picture toward its bottom, a vertical smear instead of a hard repeat. `audio` raises each band's odds from its own band of the live spectrum; `fire` holds every row while held.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "rows",   "TYPE": "float", "MIN": 8.0, "MAX": 200.0, "DEFAULT": 60.0 },
    { "NAME": "chance", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.3 },
    { "NAME": "fade",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.3 },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.3 },
    { "NAME": "audio",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.0, "LABEL": "audio" },
    { "NAME": "trig", "TYPE": "event", "DEFAULT": false, "LABEL": "fire ▸" },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// Integrated phases (engine/phases.ts) : a knob change moves the picture on
// from where it is instead of jumping it.
uniform float PH_rate;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // precise hash : no rows, no lattice over hours
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Spectrum (row 1, log-spaced : 0 bass .. 1 treble), 0..1. Bare-identifier coord.
float spec(float u) {
  vec2 ac = vec2(clamp(u, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float tStep = mod(floor(TIME * 0.5 + PH_rate * 7.5), 32749.0);

  float row = floor(uv.y * rows);
  // Audio : each band rides its own spectrum bin (bass at the bottom).
  float au = audio > 0.0 ? audio * spec((row + 0.5) / rows) : 0.0;
  float held = max(step(1.0 - chance - au, hash(vec2(row, tStep))), float(trig)); // trig = punch-in (every row)
  float inRow = fract(uv.y * rows); // 0 at the row's bottom edge, 1 at top

  // Held bands sample their TOP line (the band's last pixel row; v points up);
  // fade blends back toward live content down the band (smear instead of hard
  // repeat), so the seam against the band below softens.
  float yHold = (row + 1.0) / rows - 0.5 / RENDERSIZE.y;
  vec2 cHold = vec2(uv.x, yHold);
  vec4 live = IMG_NORM_PIXEL(inputImage, uv);
  vec4 holdS = IMG_NORM_PIXEL(inputImage, cHold);
  float k = held * (1.0 - (1.0 - inRow) * fade);
  gl_FragColor = mix(live, holdS, k);
}
