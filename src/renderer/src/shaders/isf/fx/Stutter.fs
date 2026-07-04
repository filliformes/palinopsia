/*{
  "DESCRIPTION": "Stutter — probabilistic frame hold on a stepped clock: segments freeze the image, then release. Temporal glitch (the datamosh hold), first seed use of ISF persistent buffers.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.5, "MAX": 20.0, "DEFAULT": 6.0 },
    { "NAME": "chance", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4 }
  ],
  "PASSES": [
    { "TARGET": "held", "PERSISTENT": true },
    { }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    // Segment clock: within a frozen segment, keep re-emitting the held
    // buffer (persistent — survives frames); otherwise track the live input.
    float seg = floor(TIME * rate);
    float freeze = step(1.0 - chance, hash(vec2(seg, 7.0)));
    vec4 live = IMG_NORM_PIXEL(inputImage, uv);
    vec4 prev = IMG_NORM_PIXEL(held, uv);
    gl_FragColor = mix(live, prev, freeze);
  } else {
    gl_FragColor = IMG_NORM_PIXEL(held, uv);
  }
}
