/*{
  "DESCRIPTION": "Databend : the byte-editing register (editing the stream, not the motion : distinct from datamosh's smear). Horizontal bands tear and jump sideways on a stepped clock, smearing the edge column into the gap (or wrapping around the frame, as a shifted byte run does, with `wrap`); some bands HOLD their top line and repeat it downward (the byte 'repeat' smear); per band the color channels rotate and drift out of registration; and a subset of bands go stroboscopic. `audio` raises each band's odds from its own band of the live spectrum; `fire` corrupts every band while held. Linear fragmentation, flicker, banded corruption : the databent-video look.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "bands",   "TYPE": "float", "MIN": 4.0, "MAX": 160.0, "DEFAULT": 40.0, "LABEL": "bands" },
    { "NAME": "shift",   "TYPE": "float", "MIN": 0.0, "MAX": 0.5,   "DEFAULT": 0.12, "LABEL": "tear" },
    { "NAME": "chance",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.35, "LABEL": "chance" },
    { "NAME": "hold",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.4,  "LABEL": "row hold" },
    { "NAME": "channel", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.4,  "LABEL": "channel rot" },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.5,  "LABEL": "rate" },
    { "NAME": "wrap",    "TYPE": "bool",  "DEFAULT": false, "LABEL": "wrap", "COMPACT": true },
    { "NAME": "audio",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.0,  "LABEL": "audio" },
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

// Tear edge handling : the default clamps (the edge column smears across the
// gap : a decoder repeating its last good pixel); `wrap` wraps it like a byte run.
float edgeX(float x) {
  return wrap ? fract(x) : clamp(x, 0.0, 1.0);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float t = mod(floor(TIME * 0.5 + PH_rate * 8.0), 32749.0);   // stepped clock : cuts, not flow
  float band = floor(uv.y * bands);
  float pick = hash(vec2(band, t));
  // Audio : each band rides its own spectrum bin (bass at the bottom).
  float au = audio > 0.0 ? audio * spec((band + 0.5) / bands) : 0.0;
  float on = max(step(1.0 - chance - au, pick), float(trig)); // trig = punch-in (every band)

  // Sideways byte tear.
  float dx = on * (hash(vec2(band, t + 7.3)) - 0.5) * 2.0 * shift;
  float x = uv.x + dx;

  // Row-hold "repeat" : a subset of corrupted bands sample their own TOP line
  // (v points up, so the band's top is (band + 1) / bands) and repeat it downward
  // (the byte head-smear).
  float holdOn = on * step(1.0 - hold, hash(vec2(band, t + 3.1)));
  float bandTopY = (band + 1.0) / bands - 0.5 / RENDERSIZE.y;
  float y = mix(uv.y, bandTopY, holdOn);

  vec2 c = vec2(edgeX(x), clamp(y, 0.0, 1.0));
  vec4 base = IMG_NORM_PIXEL(inputImage, c);
  vec3 col = base.rgb;
  float alpha = base.a;

  // Per-band channel rotate (R←G←B) + small per-channel x drift : color out of
  // registration, the byte-domain chroma tear. Coordinates hoisted into bare
  // identifiers : the ISF parser splits IMG_NORM_PIXEL's arguments on commas,
  // and the inline vec2(x + s, y) compiled as vec2(x + s) (the frame diagonal).
  float chOn = on * step(1.0 - channel, hash(vec2(band, t + 11.0)));
  float chShift = channel * 0.02 * (hash(vec2(band, t + 13.0)) - 0.5) * 2.0;
  vec2 cR = vec2(edgeX(x + chShift), c.y);
  vec2 cB = vec2(edgeX(x - chShift), c.y);
  vec4 sR = IMG_NORM_PIXEL(inputImage, cR);
  vec4 sB = IMG_NORM_PIXEL(inputImage, cB);
  vec3 rot = vec3(sR.g, col.b, sB.r);
  col = mix(col, rot, chOn);
  alpha = mix(alpha, max(alpha, max(sR.a, sB.a)), chOn); // the drifted fringe shows over transparency

  // Stroboscopic band flicker (whole-band on/off on the clock).
  float strobe = on * step(0.72, hash(vec2(band, t + 17.0)));
  col = mix(col, col * step(0.5, fract(t * 0.5 + band * 0.13)), strobe * 0.6);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
}
