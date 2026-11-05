/*{
  "DESCRIPTION": "Thin Film : the picture as the thickness of a soap film or an oil slick. Light reflected off a film's two faces interferes, so each thickness gives back its own color, in the orders every bubble shows : straw, magenta, blue, green, on and on, paling as it thickens. THICKNESS sets the film; FOLLOWS is how much the picture's brightness thickens it; SWIRL lets the film run in slow currents of its own. KEEP multiplies the colors by the picture's own light (an oil slick on the picture), 0 is the film alone.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "thickness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "thickness" },
    { "NAME": "follow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "follows picture" },
    { "NAME": "swirl", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35, "LABEL": "swirl" },
    { "NAME": "scale", "TYPE": "float", "MIN": 0.3, "MAX": 12.0, "DEFAULT": 2.5, "LABEL": "swirl size" },
    { "NAME": "rate", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.15, "LABEL": "flow" },
    { "NAME": "lean", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "viewing angle" },
    { "NAME": "ior", "TYPE": "float", "MIN": 1.1, "MAX": 2.2, "DEFAULT": 1.33, "LABEL": "refraction" },
    { "NAME": "keep", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "keep picture" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "amount" }
  ]
}*/

uniform float PH_rate;

float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}

// A film of nm nanometers, seen at cosI : two beams, half a wave shifted at the first
// face, summed over nine wavelengths against a rough tristimulus response.
vec3 filmColor(float nm, float cosI, float n) {
  float sinT2 = (1.0 - cosI * cosI) / (n * n);
  float cosT = sqrt(max(0.0, 1.0 - sinT2));
  vec3 sum = vec3(0.0), norm = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    float l = 400.0 + 35.0 * float(i);
    float I = 0.5 - 0.5 * cos(12.5663706 * n * nm * cosT / l);
    float a = (l - 605.0) / 52.0, b = (l - 445.0) / 24.0, c = (l - 545.0) / 48.0, d = (l - 455.0) / 34.0;
    vec3 w = vec3(exp(-a * a) + 0.18 * exp(-b * b), exp(-c * c), exp(-d * d));
    sum += I * w;
    norm += w;
  }
  return sum / norm;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  vec2 P = (uv - 0.5) * vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0);
  // the film's own currents : a slow domain warp, on an integrated clock (a wrapped drift)
  float t = mod(PH_rate, 512.0);
  vec2 q = P * scale;
  vec2 warp = vec2(fbm(q + vec2(t * 0.31, -t * 0.17)), fbm(q + vec2(5.2 - t * 0.23, 1.3 + t * 0.19))) - 0.5;
  float cur = fbm(q + warp * 2.6) - 0.5;
  // thickness in nanometers : what a bubble runs through, up to a pale washed-out order
  float nm = 60.0 + 1250.0 * (thickness + follow * (l - 0.5) * 0.7 + swirl * cur * 0.75);
  nm = max(0.0, nm);
  // the view falls off away from the middle, the orders shifting at the edges
  float cosI = 1.0 - lean * 0.55 * min(1.0, dot(P, P) * 2.2);
  vec3 f = filmColor(nm, cosI, ior);
  // pure colors or the picture's own light through them
  vec3 wet = mix(f, f * (0.15 + 1.6 * l) * 1.15, keep);
  gl_FragColor = vec4(mix(src.rgb, wet, amount), src.a);
}
