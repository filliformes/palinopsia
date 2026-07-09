/*{
  "DESCRIPTION": "Column Scan : horizontal scan lines vertically displaced by a drifting internal signal, brightness following the displacement slope. A taste of the analog scan-processor register hosted as a plain generator : matte line-work, no phosphor glow.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry", "Scan"],
  "INPUTS": [
    { "NAME": "lines", "TYPE": "float", "MIN": 10.0, "MAX": 100.0, "DEFAULT": 40.0 },
    { "NAME": "amp",   "TYPE": "float", "MIN": 0.0,  "MAX": 0.15,  "DEFAULT": 0.05 },
    { "NAME": "scale", "TYPE": "float", "MIN": 0.5,  "MAX": 8.0,   "DEFAULT": 2.0 },
    { "NAME": "rate",  "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,   "DEFAULT": 0.15 },
    { "NAME": "width", "TYPE": "float", "MIN": 0.02, "MAX": 0.5,   "DEFAULT": 0.12 },
    { "NAME": "tint",  "TYPE": "color", "DEFAULT": [0.7, 0.75, 0.7, 1.0] }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 3; k++) {
    s += a * vnoise(p);
    p = p * 2.02 + 7.1;
    a *= 0.5;
  }
  return s;
}

// Vertical displacement of scan line k at horizontal position x.
float disp(float x, float k, float t) {
  return (fbm3(vec2(x * scale, k * 0.37 + t)) - 0.5) * 2.0 * amp;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float t = TIME * rate;
  float px = 1.0 / lines;

  // A fragment can be lit by any nearby line whose displaced path passes
  // through it. amp is bounded, so scanning the ±3 neighbours suffices.
  float lum = 0.0;
  float k0 = floor(uv.y * lines);
  for (int i = -3; i <= 3; i++) {
    float k = k0 + float(i);
    if (k < 0.0 || k >= lines) continue;
    float baseY = (k + 0.5) * px;
    float y = baseY + disp(uv.x, k, t);
    float d = abs(uv.y - y);
    float line = 1.0 - smoothstep(0.0, width * px, d);
    // Brightness follows the local slope : the scan-processor read: lines
    // light up where the signal moves them hardest.
    float slope = abs(disp(uv.x + 0.004, k, t) - disp(uv.x - 0.004, k, t)) * 60.0;
    lum = max(lum, line * (0.45 + min(slope, 0.55)));
  }

  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 col = base + tint.rgb * lum * 0.9;
  gl_FragColor = vec4(col, 1.0);
}
