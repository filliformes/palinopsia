/*{
  "DESCRIPTION": "Ramps : LZX-style voltage ramps: a single clean gradient signal (horizontal / vertical / diagonal / radial / diamond), optionally stepped into bands and slowly drifting. The raw material of analog video synthesis : feed it into Colorizer or key against it. Matte.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Scan"],
  "INPUTS": [
    { "NAME": "shape", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["horizontal", "vertical", "diagonal", "radial", "diamond"], "DEFAULT": 0 },
    { "NAME": "freq",  "TYPE": "float", "MIN": 0.5, "MAX": 12.0, "DEFAULT": 1.0 },
    { "NAME": "steps", "TYPE": "float", "MIN": 1.0, "MAX": 32.0, "DEFAULT": 1.0 },
    { "NAME": "rate",  "TYPE": "float", "MIN": 0.0, "MAX": 20.0,  "DEFAULT": 0.2 },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0 },
    { "NAME": "tint",  "TYPE": "color", "DEFAULT": [0.7, 0.72, 0.68, 1.0] }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 c = uv - 0.5;
  c.x *= aspect;
  // rotate the field
  float cs = cos(angle), sn = sin(angle);
  vec2 r = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;

  float v;
  if (shape == 0) v = r.x;
  else if (shape == 1) v = r.y;
  else if (shape == 2) v = (r.x + r.y) * 0.5;
  else if (shape == 3) v = length((r - 0.5) * vec2(1.0, 1.0)) * 1.6;
  else v = (abs(r.x - 0.5) + abs(r.y - 0.5)) * 1.6;

  v = fract(v * freq + TIME * rate * 0.2);
  // stepped ramp
  float n = max(steps, 1.0);
  if (n > 1.5) v = floor(v * n) / (n - 1.0);

  vec3 base = vec3(0.02, 0.02, 0.025);
  gl_FragColor = vec4(base + tint.rgb * clamp(v, 0.0, 1.0), 1.0);
}
