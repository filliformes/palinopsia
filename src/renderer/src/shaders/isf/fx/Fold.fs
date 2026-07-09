/*{
  "DESCRIPTION": "Fold : a SINGLE-axis mirror at a movable seam, with a slide offset on the reflected half. One deliberate fold is composition; radial/kaleidoscope symmetry is exactly what the seed library refuses (brief §1) : this stays asymmetric by keeping the seam off-centre and the offset non-zero.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Distortion"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "vertical", "TYPE": "bool",  "DEFAULT": false },
    { "NAME": "seam",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.62 },
    { "NAME": "offset",   "TYPE": "float", "MIN": -0.5, "MAX": 0.5, "DEFAULT": 0.08 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 c = uv;
  if (vertical) {
    if (uv.y > seam) {
      c.y = seam * 2.0 - uv.y;
      c.x = fract(uv.x + offset);
    }
  } else {
    if (uv.x > seam) {
      c.x = seam * 2.0 - uv.x;
      c.y = fract(uv.y + offset);
    }
  }
  c = clamp(c, 0.0, 1.0);
  gl_FragColor = IMG_NORM_PIXEL(inputImage, c);
}
