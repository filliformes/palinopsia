/*{
  "DESCRIPTION": "Differential — visual polyrhythm (after Whitney's differential dynamics, via Collopy): several wave trains layered at INTEGER speed ratios (ratio^k), so their phases drift against each other and beat like nested rhythms. Rendered as the contour lines of the summed field — matte topographic bands that pulse in and out of alignment. Per-layer angle skew keeps it asymmetric (never radial/kaleidoscopic).",
  "CREDIT": "Palinopsia (after J. Whitney / D. Collopy)",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry"],
  "INPUTS": [
    { "NAME": "count",     "TYPE": "float", "MIN": 2.0, "MAX": 8.0,  "DEFAULT": 4.0 },
    { "NAME": "ratio",     "TYPE": "float", "MIN": 1.0, "MAX": 3.0,  "DEFAULT": 2.0 },
    { "NAME": "rate",      "TYPE": "float", "MIN": 0.0, "MAX": 20.0, "DEFAULT": 0.4 },
    { "NAME": "freq",      "TYPE": "float", "MIN": 0.5, "MAX": 12.0, "DEFAULT": 3.0 },
    { "NAME": "thickness", "TYPE": "float", "MIN": 0.02,"MAX": 0.5,  "DEFAULT": 0.12 },
    { "NAME": "lines",     "TYPE": "float", "MIN": 2.0, "MAX": 16.0, "DEFAULT": 6.0 },
    { "NAME": "skew",      "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "angle",     "TYPE": "float", "MIN": 0.0, "MAX": 6.2832,"DEFAULT": 0.4 },
    { "NAME": "tint",      "TYPE": "color", "DEFAULT": [0.82, 0.84, 0.8, 1.0] }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  int cn = int(count);
  float field = 0.0;
  float amp = 1.0;
  float norm = 0.0;
  for (int k = 0; k < 8; k++) {
    if (k >= cn) break;
    float fk = float(k);
    // Each layer runs at rate·ratio^k — the differential that makes the
    // phases drift against one another (the polyrhythm).
    float sp = rate * pow(ratio, fk);
    float a = angle + fk * skew * 1.15; // per-layer skew → asymmetric, non-radial
    vec2 dir = vec2(cos(a), sin(a));
    field += amp * sin(dot(p, dir) * freq * 6.2832 + TIME * sp);
    norm += amp;
    amp *= 0.82;
  }
  field /= max(norm, 0.001); // -1..1

  // Contour lines of the summed field — a topographic read of the rhythm.
  float t = abs(fract(field * lines * 0.5 + 0.5) - 0.5) * 2.0; // 0 on a contour
  float m = 1.0 - smoothstep(thickness, thickness + 0.05, t);

  vec3 base = vec3(0.02, 0.02, 0.025);
  gl_FragColor = vec4(base + tint.rgb * m, 1.0);
}
