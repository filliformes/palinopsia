/*{
  "DESCRIPTION": "Row Echo — a chance-selected set of row bands freeze onto their top line and repeat it downward (the Rutt-freeze / line-hold read). Held rows refresh on a stepped clock; fade softens the hold into a vertical smear.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "rows",   "TYPE": "float", "MIN": 8.0, "MAX": 200.0, "DEFAULT": 60.0 },
    { "NAME": "chance", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.3 },
    { "NAME": "fade",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.3 },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,   "DEFAULT": 0.3 }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float tStep = floor(TIME * (0.5 + rate * 7.5));

  float row = floor(uv.y * rows);
  float held = step(1.0 - chance, hash(vec2(row, tStep)));
  float inRow = fract(uv.y * rows); // 0 at the row's bottom edge, 1 at top

  // Held bands sample their TOP line; fade blends back toward live content
  // down the band (smear instead of hard repeat).
  float yHold = (row + 0.96) / rows;
  vec2 cHold = vec2(uv.x, yHold);
  vec4 live = IMG_NORM_PIXEL(inputImage, uv);
  vec4 holdS = IMG_NORM_PIXEL(inputImage, cHold);
  float k = held * (1.0 - inRow * fade);
  gl_FragColor = mix(live, holdS, k);
}
