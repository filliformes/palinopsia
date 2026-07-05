/*{
  "DESCRIPTION": "Slit Buffer — time-smear of the input: a write head sweeps across the frame, freezing the live image into the persistent buffer as it passes, so columns behind the head hold older moments. A real slit-scan of whatever feeds the layer (Signal Culture SSSScan / PXLMSH register).",
  "CREDIT": "Palinopsia (after Signal Culture SSSScan)",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Scan"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.02, "MAX": 3.0, "DEFAULT": 0.3 },
    { "NAME": "width",    "TYPE": "float", "MIN": 0.005,"MAX": 0.2, "DEFAULT": 0.03 },
    { "NAME": "vertical", "TYPE": "bool",  "DEFAULT": false }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    float axis = vertical ? uv.y : uv.x;
    float head = fract(TIME * rate); // sweeps 0→1 and wraps
    float band = 1.0 - smoothstep(0.0, width, abs(axis - head));
    vec4 live = IMG_NORM_PIXEL(inputImage, uv);
    vec4 prev = IMG_NORM_PIXEL(buf, uv);
    // Where the head is, write live; elsewhere hold the frozen history.
    gl_FragColor = mix(prev, live, band);
  } else {
    gl_FragColor = IMG_NORM_PIXEL(buf, uv);
  }
}
