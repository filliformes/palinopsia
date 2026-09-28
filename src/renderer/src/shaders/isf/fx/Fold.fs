/*{
  "DESCRIPTION": "Fold : a SINGLE-axis mirror at a movable seam, with a slide offset on the reflected half. One deliberate fold is composition; radial/kaleidoscope symmetry is exactly what the seed library refuses (brief §1) : this stays asymmetric by keeping the seam off-center and the offset non-zero. A seam below the middle folds the picture again past the far edge, like folded paper.",
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
  // With the seam below the middle the reflection runs past the far edge.
  // Mirror it back in (a second fold) instead of clamping, which smeared the
  // edge row into streaks over the whole far side ("Floor fold").
  c = 1.0 - abs(1.0 - mod(c, 2.0));
  gl_FragColor = IMG_NORM_PIXEL(inputImage, c);
}
