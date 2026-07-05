/*{
  "DESCRIPTION": "Recurse — recursive geometry (Cathodemer Arabesque register): a shape is drawn, then the space is shrunk, rotated a little and shifted OFF-CENTRE, and it's drawn again, cascading inward. The off-centre drift + small rotation keep it a spiral/cascade — deliberately NOT the radial kaleidoscope the seed library refuses (brief §1). Matte line-work.",
  "CREDIT": "Palinopsia (after Cathodemer Arabesque)",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry"],
  "INPUTS": [
    { "NAME": "iterations", "TYPE": "float", "MIN": 2.0, "MAX": 10.0, "DEFAULT": 7.0 },
    { "NAME": "scale",  "TYPE": "float", "MIN": 0.6, "MAX": 0.95, "DEFAULT": 0.78 },
    { "NAME": "angle",  "TYPE": "float", "MIN": 0.0, "MAX": 1.2,  "DEFAULT": 0.4 },
    { "NAME": "drift",  "TYPE": "float", "MIN": 0.0, "MAX": 0.5,  "DEFAULT": 0.15 },
    { "NAME": "width",  "TYPE": "float", "MIN": 0.002,"MAX": 0.2,  "DEFAULT": 0.035 },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0, "MAX": 20.0,  "DEFAULT": 0.15 },
    { "NAME": "tint",   "TYPE": "color", "DEFAULT": [0.72, 0.76, 0.7, 1.0] }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = TIME * rate;
  float ang = angle + sin(t) * 0.15;      // breathe the rotation
  vec2 dr = vec2(drift, drift * 0.6) * (1.0 + 0.3 * sin(t * 0.7));

  float acc = 0.0;
  float bright = 1.0;
  for (int i = 0; i < 10; i++) {
    if (float(i) >= iterations) break;
    // Square outline SDF at this recursion level.
    vec2 b = abs(p) - vec2(0.35);
    float d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0);
    float line = 1.0 - smoothstep(0.0, width, abs(d));
    acc = max(acc, line * bright);
    // Recurse: shift off-centre, rotate, shrink.
    p -= dr;
    float cs = cos(ang), sn = sin(ang);
    p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs) / scale;
    bright *= 0.88; // deeper levels fade
  }

  vec3 base = vec3(0.025, 0.025, 0.03);
  vec3 col = base + tint.rgb * acc * 0.9;
  col *= 0.95 + 0.05 * sin(uv.y * RENDERSIZE.y * 3.14159);
  gl_FragColor = vec4(col, 1.0);
}
