/*{
  "DESCRIPTION": "Sync Loss : vertical hold rolling away plus horizontal tear bands on a stepped clock: the picture climbs, catches, tears. The broken-monitor register.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "roll",   "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.25 },
    { "NAME": "tear",   "TYPE": "float", "MIN": 0.0, "MAX": 0.4, "DEFAULT": 0.1 },
    { "NAME": "bands",  "TYPE": "float", "MIN": 1.0, "MAX": 12.0, "DEFAULT": 4.0 },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4 }
  ]
}*/

// Integrated phases (engine/phases.ts) : a knob change moves the picture on
// from where it is instead of jumping it.
uniform float PH_rate;
uniform float PH_roll;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // precise hash : no rows, no lattice over hours
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float tStep = mod(floor(TIME * 0.5 + PH_rate * 7.5), 32749.0);

  // Vertical hold: the frame climbs; catch moments (hash) pin it briefly.
  float caught = step(0.6, hash(vec2(tStep, 3.0)));
  float y = fract(uv.y + fract(PH_roll) * (1.0 - caught * 0.85));

  // Tear bands: a few horizontal zones shear sideways this step.
  float band = floor(y * bands);
  float on = step(0.55, hash(vec2(band, tStep)));
  float shear = on * (hash(vec2(band, tStep + 17.0)) - 0.5) * 2.0 * tear;
  // Inside a tearing band, shear grows toward its lower edge : a real tear,
  // not a clean slice.
  float inBand = fract(y * bands);
  vec2 c = vec2(fract(uv.x + shear * inBand), y);

  vec4 s = IMG_NORM_PIXEL(inputImage, c);
  // The wrap seam flashes darker : the blanking interval.
  float seam = smoothstep(0.03, 0.0, min(y, 1.0 - y)) * 0.5;
  gl_FragColor = vec4(s.rgb * (1.0 - seam), s.a);
}
