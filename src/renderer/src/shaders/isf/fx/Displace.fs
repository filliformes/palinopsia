/*{
  "DESCRIPTION": "Displace : drifting value-noise domain warp of the sampling coordinates. Asymmetric displacement (brief §1's preferred feedback discipline), never radial.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Distortion"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.03 },
    { "NAME": "scale",  "TYPE": "float", "MIN": 0.5, "MAX": 12.0, "DEFAULT": 3.0 },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.15 }
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

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float t = PH_rate;
  vec2 p = uv * scale;
  vec2 disp = vec2(
    vnoise(p + vec2(t, 7.3)) - 0.5,
    vnoise(p.yx + vec2(13.1, -t)) - 0.5
  );
  vec2 c = uv + disp * amount * 2.0;
  gl_FragColor = IMG_NORM_PIXEL(inputImage, c);
}
