/*{
  "DESCRIPTION": "Chroma Shift : RGB split along a chosen axis. The restrained chromatic-aberration signature (brief §1): subtle at default, never spectacle. The split is measured in frame widths at every angle, and the fringe spills out into transparent areas.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 0.05,  "DEFAULT": 0.006 },
    { "NAME": "angle",  "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  // The split is `amount` frame WIDTHS long at every angle : a horizontal
  // split keeps its length, a vertical or diagonal one now matches it in
  // pixels instead of shrinking to 0.56× at 16:9.
  vec2 dir = vec2(cos(angle), sin(angle) * aspect) * amount;
  vec2 cr = uv + dir;
  vec2 cb = uv - dir;
  // Clamp-to-edge is kept on purpose : at the frame edge the displaced plane
  // stretches its edge row into a thin band, a plate-misregistration look.
  vec4 c = IMG_NORM_PIXEL(inputImage, uv);
  vec4 r = IMG_NORM_PIXEL(inputImage, cr);
  vec4 b = IMG_NORM_PIXEL(inputImage, cb);
  // The red and blue planes carry their own coverage, so over a transparent
  // layer the fringe shows outward too.
  gl_FragColor = vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
}
