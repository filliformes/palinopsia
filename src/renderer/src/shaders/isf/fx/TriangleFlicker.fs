/*{
  "DESCRIPTION": "Triangle Flicker : triangle-wave rhythmic flicker: brightness pulses on a triangle LFO, with an optional hard on/off strobe and a channel-shuffle on the beat. Clock it against the tempo for a rhythmic strobe/transition. Multiplicative : matte, never additive.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "rate",  "TYPE": "float", "MIN": 0.1, "MAX": 20.0, "DEFAULT": 4.0 },
    { "NAME": "depth", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.6 },
    { "NAME": "hard",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0 },
    { "NAME": "swap",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);

  float tri = abs(fract(TIME * rate) * 2.0 - 1.0);   // 0..1 triangle
  float sq = step(0.5, tri);                          // hard on/off
  float env = mix(tri, sq, hard);
  float f = 1.0 - depth * (1.0 - env);                // brightness flicker

  vec3 col = src.rgb * f;
  // Channel shuffle on the bright half of the beat.
  col = mix(col, col.gbr, swap * sq);

  gl_FragColor = vec4(col, src.a);
}
