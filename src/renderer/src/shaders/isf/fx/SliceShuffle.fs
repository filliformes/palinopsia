/*{
  "DESCRIPTION": "Slice Shuffle : horizontal band displacement on a stepped clock; a minority of slices jump each step, wrapping around the frame edge. `audio` raises each slice's odds from its own band of the live spectrum. The datamosh / slice-glitch register: cuts, not flow.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "slices",  "TYPE": "float", "MIN": 4.0, "MAX": 96.0, "DEFAULT": 24.0 },
    { "NAME": "amount",  "TYPE": "float", "MIN": 0.0, "MAX": 0.5,  "DEFAULT": 0.08 },
    { "NAME": "chance",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.25 },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "audio",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0, "LABEL": "audio" },
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
  float t = mod(floor(TIME * 0.5 + PH_rate * 7.5), 32749.0);
  float slice = floor(uv.y * slices);
  float pick = hash(vec2(slice, t));
  // Audio : each slice rides its own spectrum bin (bass at the bottom).
  float au = audio > 0.0 ? audio * spec((slice + 0.5) / slices) : 0.0;
  float on = max(step(1.0 - chance - au, pick), float(trig)); // trig = punch-in (all slices)
  float offset = on * (hash(vec2(slice, t + 41.7)) - 0.5) * 2.0 * amount;
  vec2 c = vec2(fract(uv.x + offset), uv.y);
  gl_FragColor = IMG_NORM_PIXEL(inputImage, c);
}
