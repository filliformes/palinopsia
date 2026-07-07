/*{
  "DESCRIPTION": "Solid Color — a flat colour fill, or a smooth linear gradient across three stops at any angle. The quietest source: a wash to key against, tint under, or grade with. Gradient off = one solid colour; on = colA → colB (at the midpoint) → colC along the angle. A faint dither kills banding. Matte by design.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Color"],
  "INPUTS": [
    { "NAME": "color",    "TYPE": "color", "DEFAULT": [0.5, 0.55, 0.68, 1.0] },
    { "NAME": "colA",     "TYPE": "color", "DEFAULT": [0.05, 0.06, 0.12, 1.0] },
    { "NAME": "colB",     "TYPE": "color", "DEFAULT": [0.35, 0.2, 0.4, 1.0] },
    { "NAME": "colC",     "TYPE": "color", "DEFAULT": [0.95, 0.55, 0.35, 1.0] },
    { "NAME": "gradient", "TYPE": "bool",  "DEFAULT": false },
    { "NAME": "angle",    "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 1.5708 },
    { "NAME": "midpoint", "TYPE": "float", "MIN": 0.05, "MAX": 0.95, "DEFAULT": 0.5 },
    { "NAME": "dither",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;

  if (!gradient) {
    gl_FragColor = vec4(color.rgb, 1.0);
    return;
  }

  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 dir = vec2(cos(angle), sin(angle));
  float t = clamp(dot(p, dir) * 0.72 + 0.5, 0.0, 1.0);

  vec3 c = t < midpoint
    ? mix(colA.rgb, colB.rgb, t / max(midpoint, 0.001))
    : mix(colB.rgb, colC.rgb, (t - midpoint) / max(1.0 - midpoint, 0.001));

  // Faint ordered-ish dither so smooth ramps don't band on 8-bit output.
  c += (hash(gl_FragCoord.xy) - 0.5) * dither * (1.5 / 255.0);
  gl_FragColor = vec4(c, 1.0);
}
