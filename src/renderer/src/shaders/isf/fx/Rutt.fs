/*{
  "DESCRIPTION": "Rutt : the classic Rutt/Etra-style scan processor. The input is redrawn as horizontal scan lines each displaced vertically by the image's own luminance, so bright areas push the lines into relief (a wireframe topography of the picture). RELIEF picks the push : DOWN hangs the bright areas below their line like a relief seen from underneath, UP lifts them as the classic scan processor did. Brightness follows the local slope. Matte line-work on a near-black ground that keeps the layer's transparency.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Scan", "Stylize"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "lines", "TYPE": "float", "MIN": 20.0, "MAX": 200.0, "DEFAULT": 80.0 },
    { "NAME": "amp",   "TYPE": "float", "MIN": 0.0,  "MAX": 0.3,   "DEFAULT": 0.08, "LABEL": "displace" },
    { "NAME": "width", "TYPE": "float", "MIN": 0.05, "MAX": 0.6,   "DEFAULT": 0.2 },
    { "NAME": "color", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.6 },
    { "NAME": "relief", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["down", "up"], "DEFAULT": 0, "LABEL": "relief" }
  ]
}*/

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

float lumaAt(vec2 c) {
  return dot(IMG_NORM_PIXEL(inputImage, c).rgb, LUMA);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float sp = 1.0 / lines;                           // line spacing (uv)
  float w = max(width * sp, 1.0 / RENDERSIZE.y);    // line half-width, floored at 1 px
  // uv.y = 0 is the BOTTOM : +1 lifts bright lines up the frame, -1 hangs them down.
  float dir = relief == 1 ? 1.0 : -1.0;
  // How many line spacings a line can travel : the search covers all of it
  // (a ±4-line search let bright lines vanish once they moved farther).
  float reach = amp * lines + 1.0;

  float lum = 0.0;
  vec3 lineCol = vec3(0.0);
  float lineA = 0.0;
  float k0 = floor(uv.y * lines);
  // A fragment is lit by any scan line whose displaced path crosses it. Lines
  // only move one way, so candidates come from the side they are pushed from,
  // plus one neighbour on the other side for the line's own width.
  for (int j = -1; j < 64; j++) {
    float fj = float(j);
    if (fj > reach) break;
    float k = k0 - dir * fj;
    if (k < 0.0 || k >= lines) continue;
    float baseY = (k + 0.5) * sp;
    vec2 samp = vec2(uv.x, baseY);
    vec4 sv = IMG_NORM_PIXEL(inputImage, samp);
    float lv = dot(sv.rgb, LUMA);
    float y = baseY + dir * lv * amp;
    float d = abs(uv.y - y);
    if (d >= w) continue;                           // slope taps only on a hit
    float line = 1.0 - smoothstep(0.0, w, d);
    // slope → brightness (edges of relief glow a touch brighter)
    vec2 sR = samp + vec2(0.004, 0.0);
    vec2 sL = samp - vec2(0.004, 0.0);
    float slope = abs(lumaAt(sR) - lumaAt(sL)) * 40.0;
    float b = line * (0.4 + min(slope, 0.6));
    if (b > lum) { lum = b; lineCol = sv.rgb; lineA = sv.a; }
  }

  // Line-work over a near-black ground. Straight alpha : the ground is as opaque
  // as the input is here (opaque input : exactly the old picture), and a line
  // carries the coverage of the spot it was sampled from, so a transparent layer
  // stays transparent between its lines.
  vec3 base = vec3(0.02, 0.02, 0.025);
  vec3 lineRGB = mix(vec3(lum), lineCol * (0.5 + lum), color);
  float srcA = IMG_NORM_PIXEL(inputImage, uv).a;
  float aL = lum * lineA;
  float a = clamp(srcA + aL * (1.0 - srcA), 0.0, 1.0);
  vec3 prem = base * srcA + lineRGB * aL;
  vec3 col = a > 0.0 ? prem / a : vec3(0.0);
  gl_FragColor = vec4(col, a);
}
