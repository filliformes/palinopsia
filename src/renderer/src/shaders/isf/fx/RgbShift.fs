/*{
  "DESCRIPTION": "RGB Shift — Lumen's RGB-splitter register: the three channels are pulled apart GEOMETRICALLY — each offset along the axis and independently scaled about the centre — so red/green/blue drift and breathe out of registration. Beyond a flat chroma shift; the channel-separation look, with an animated wobble option.",
  "CREDIT": "Palinopsia (after Lumen RGB splitter)",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "offset", "TYPE": "float", "MIN": 0.0, "MAX": 0.06,  "DEFAULT": 0.01 },
    { "NAME": "scale",  "TYPE": "float", "MIN": 0.0, "MAX": 0.1,   "DEFAULT": 0.02 },
    { "NAME": "angle",  "TYPE": "float", "MIN": 0.0, "MAX": 6.2832,"DEFAULT": 0.0 },
    { "NAME": "wobble", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 dir = vec2(cos(angle), sin(angle));
  float wob = 1.0 + wobble * sin(TIME * 2.0);

  // Red pulled one way + scaled up, blue the other + scaled down, green fixed.
  vec2 cr = (uv - 0.5) * (1.0 + scale * wob) + 0.5 + dir * offset * wob;
  vec2 cb = (uv - 0.5) * (1.0 - scale * wob) + 0.5 - dir * offset * wob;
  float r = IMG_NORM_PIXEL(inputImage, cr).r;
  float g = IMG_NORM_PIXEL(inputImage, uv).g;
  float b = IMG_NORM_PIXEL(inputImage, cb).b;
  float a = IMG_NORM_PIXEL(inputImage, uv).a;
  gl_FragColor = vec4(r, g, b, a);
}
