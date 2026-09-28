/*{
  "DESCRIPTION": "RGB Shift : an RGB-splitter register: the channels are pulled apart GEOMETRICALLY : red and blue are offset in opposite directions along the axis and scaled in opposite ways about the center (green holds), so the planes drift and breathe out of registration. Beyond a flat chroma shift; the channel-separation look, with an animated wobble option.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "offset", "TYPE": "float", "MIN": 0.0, "MAX": 0.06,  "DEFAULT": 0.01 },
    { "NAME": "scale",  "TYPE": "float", "MIN": 0.0, "MAX": 0.1,   "DEFAULT": 0.02 },
    { "NAME": "angle",  "TYPE": "float", "MIN": 0.0, "MAX": 6.2832,"DEFAULT": 0.0 },
    { "NAME": "wobble", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.0 },
    { "NAME": "wobRate", "TYPE": "float", "MIN": 0.02, "MAX": 3.0, "DEFAULT": 0.3183, "LABEL": "wobble rate" }
  ]
}*/

// ∫ wobRate dt on the layer clock (engine/phases.ts) : the breathing speeds up
// or slows from where it is. The default 0.3183 Hz is the old sin(TIME * 2).
uniform float PH_wobRate;

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  // Offset in frame WIDTHS at every angle (a horizontal split keeps its
  // length; a vertical one now matches it in pixels).
  vec2 dir = vec2(cos(angle), sin(angle) * aspect);
  float wob = 1.0 + wobble * sin(PH_wobRate * 6.2832);

  // Red : pushed along +dir, its sampling spread by (1 + s) so the red image
  // SHRINKS toward the center. Blue : pushed along -dir and enlarged. Green holds.
  // Clamp-to-edge is kept on purpose : where the shrunken red plane runs out,
  // its edge row stretches into a band, the misconverged-tube look.
  vec2 cr = (uv - 0.5) * (1.0 + scale * wob) + 0.5 + dir * offset * wob;
  vec2 cb = (uv - 0.5) * (1.0 - scale * wob) + 0.5 - dir * offset * wob;
  vec4 R = IMG_NORM_PIXEL(inputImage, cr);
  vec4 G = IMG_NORM_PIXEL(inputImage, uv);
  vec4 B = IMG_NORM_PIXEL(inputImage, cb);
  // Each plane carries its own coverage : over a transparent layer the split
  // planes show outward too.
  gl_FragColor = vec4(R.r, G.g, B.b, max(G.a, max(R.a, B.a)));
}
