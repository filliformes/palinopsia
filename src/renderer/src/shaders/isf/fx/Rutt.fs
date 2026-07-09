/*{
  "DESCRIPTION": "Rutt : the classic Rutt/Etra-style scan processor. The input is redrawn as horizontal scan lines each displaced vertically by the image's own luminance, so bright areas push the lines into relief (a wireframe topography of the picture). Brightness follows the local slope. Matte line-work.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Scan", "Stylize"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "lines", "TYPE": "float", "MIN": 20.0, "MAX": 200.0, "DEFAULT": 80.0 },
    { "NAME": "amp",   "TYPE": "float", "MIN": 0.0,  "MAX": 0.3,   "DEFAULT": 0.08 },
    { "NAME": "width", "TYPE": "float", "MIN": 0.05, "MAX": 0.6,   "DEFAULT": 0.2 },
    { "NAME": "color", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.6 }
  ]
}*/

float lumaAt(vec2 c) {
  return dot(IMG_NORM_PIXEL(inputImage, c).rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float px = 1.0 / lines;

  float lum = 0.0;
  vec3 lineCol = vec3(0.0);
  float k0 = floor(uv.y * lines);
  // A fragment can be lit by any nearby scan line whose displaced path
  // crosses it. amp is bounded, so ±4 neighbours suffice.
  for (int i = -4; i <= 4; i++) {
    float k = k0 + float(i);
    if (k < 0.0 || k >= lines) continue;
    float baseY = (k + 0.5) * px;
    vec2 samp = vec2(uv.x, baseY);
    float lv = lumaAt(samp);
    float y = baseY - lv * amp;                 // bright pushes the line up
    float d = abs(uv.y - y);
    float line = 1.0 - smoothstep(0.0, width * px, d);
    // slope → brightness (edges of relief glow a touch brighter)
    float slope = abs(lumaAt(samp + vec2(0.004, 0.0)) - lumaAt(samp - vec2(0.004, 0.0))) * 40.0;
    float b = line * (0.4 + min(slope, 0.6));
    if (b > lum) { lum = b; lineCol = IMG_NORM_PIXEL(inputImage, samp).rgb; }
  }

  vec3 base = vec3(0.02, 0.02, 0.025);
  vec3 mono = vec3(lum);
  vec3 col = base + mix(mono, lineCol * (0.5 + lum), color) * lum;
  gl_FragColor = vec4(col, 1.0);
}
