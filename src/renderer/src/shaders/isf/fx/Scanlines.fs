/*{
  "DESCRIPTION": "Scanlines : line darkening as controlled texture (obs-shaderfilter register), with optional slow roll. Signature element, kept matte: darkening only, no glow. COUNT is lines per frame height. RASTER MOIRÉ keeps the beat a fine count makes against a 1080-row raster (the soft interference bands of high counts), the same at every output resolution; at 0 the lines are drawn cleanly and fade to an even dim where they get too fine to draw.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "count",    "TYPE": "float", "MIN": 50.0, "MAX": 1200.0, "DEFAULT": 400.0 },
    { "NAME": "darkness", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.25 },
    { "NAME": "roll",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.0 },
    { "NAME": "moire",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 1.0, "LABEL": "raster moiré" }
  ]
}*/

// Integrated phase (engine/phases.ts) : a roll-speed change moves the lines on
// from where they are instead of jumping them.
uniform float PH_roll; // wrap 0.125

const float TAU = 6.2831853;

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 c = IMG_NORM_PIXEL(inputImage, uv);
  float rollPh = fract(PH_roll * 8.0);
  // RASTER : the lines sampled on a fixed 1080-row raster (at 1080p exactly the
  // output rows), so a count finer than the raster beats into the same soft
  // moiré bands at 1080p, 4K or on the dome.
  float yr = (floor(uv.y * 1080.0) + 0.5) / 1080.0;
  float lineR = 0.5 + 0.5 * sin((yr * count + rollPh) * TAU);
  // CLEAN : drawn at the output's own rows, fading to the mean dim as the lines
  // approach the pixel pitch (no aliasing).
  float lineC = 0.5 + 0.5 * sin((uv.y * count + rollPh) * TAU);
  lineC = mix(0.5, lineC, 1.0 - smoothstep(0.3, 0.5, count / RENDERSIZE.y));
  float line = mix(lineC, lineR, moire);
  float dim = 1.0 - darkness * line;
  gl_FragColor = vec4(c.rgb * dim, c.a);
}
