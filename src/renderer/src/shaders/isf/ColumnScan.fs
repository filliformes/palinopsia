/*{
  "DESCRIPTION": "Column Scan : horizontal scan lines vertically displaced by a drifting internal signal, brightness following the displacement slope. A taste of the analog scan-processor register hosted as a plain generator : matte line-work, no phosphor glow. AUDIO writes the live waveform into the raster: each line traces its own stretch of the signal, oscilloscope-style.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry", "Scan"],
  "INPUTS": [
    { "NAME": "lines", "TYPE": "float", "MIN": 10.0, "MAX": 100.0, "DEFAULT": 40.0 },
    { "NAME": "amp",   "TYPE": "float", "MIN": 0.0,  "MAX": 0.15,  "DEFAULT": 0.05 },
    { "NAME": "scale", "TYPE": "float", "MIN": 0.5,  "MAX": 8.0,   "DEFAULT": 2.0 },
    { "NAME": "rate",  "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,   "DEFAULT": 0.15 },
    { "NAME": "width", "TYPE": "float", "MIN": 0.02, "MAX": 0.5,   "DEFAULT": 0.12 },
    { "NAME": "audio", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.0, "LABEL": "audio trace" },
    { "NAME": "tint",  "TYPE": "color", "DEFAULT": [0.7, 0.75, 0.7, 1.0] },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// Integrated rate (engine-driven : a rate change alters the drift speed, never
// the position, so modulating rate can't make the lines jump).
uniform float PH_rate;

// The signal is periodic over WRAP lattice units in its time axis, so the
// integrated phase can wrap seamlessly (hash inputs stay small forever).
#define WRAP 1024.0

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise + its analytic x-derivative : (value, d/dx). Periodic in y.
vec2 vnoiseDx(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float du = 6.0 * f.x * (1.0 - f.x);
  float y0 = mod(i.y, WRAP), y1 = mod(i.y + 1.0, WRAP);
  float a = hash12(vec2(i.x, y0));
  float b = hash12(vec2(i.x + 1.0, y0));
  float c = hash12(vec2(i.x, y1));
  float d = hash12(vec2(i.x + 1.0, y1));
  float v = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  float dx = du * ((b - a) + (a - b - c + d) * u.y);
  return vec2(v, dx);
}

// 3-octave fbm with its x-derivative. Octaves scale by exactly 2, so the sum
// stays periodic over WRAP in y; the odd offsets keep the lattices unaligned.
vec2 fbm3(vec2 p) {
  vec2 s = vec2(0.0);
  float a = 0.5, fr = 1.0;
  for (int k = 0; k < 3; k++) {
    vec2 n = vnoiseDx(p);
    s += a * vec2(n.x, n.y * fr);
    p = p * 2.0 + vec2(7.37, 3.61);
    a *= 0.5;
    fr *= 2.0;
  }
  return s;
}

// Live waveform (row 0), ±1 around silence. Bare-identifier coordinate.
float aud(float u) {
  vec2 ac = vec2(clamp(u, 0.0, 1.0), 0.25);
  return (IMG_NORM_PIXEL(audioTex, ac).r - 0.5) * 2.0;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float t = mod(PH_rate, WRAP);
  float px = 1.0 / lines;
  // Horizontal position in frame-height units, so the signal's wavelength is
  // the same on a 16:9 screen and a square dome (0.5625 keeps the 16:9 look).
  float xh = uv.x * aspect;
  float nx = xh * scale * 0.5625;
  // Audio : each line traces its own 60% window of the waveform across the width.
  float audAmp = audio * 0.08;
  float a = amp;

  // A fragment can be lit by any nearby line whose displaced path passes
  // through it. Search as far as the displacement can reach (fbm is centred,
  // so |disp| <= 0.875·amp), in line spacings, plus a margin for the width.
  // Only the extreme corner (max amp, max lines, loud audio) outgrows the
  // ±16 search : there the swing is compressed to fit, never clipped.
  float span = (0.875 * a + audAmp) * lines;
  float fit = min(1.0, 14.5 / max(span, 0.0001));
  a *= fit;
  audAmp *= fit;
  float reach = ceil(span * fit + 0.5) + 1.0;
  float lum = 0.0;
  float k0 = floor(uv.y * lines);
  for (int i = -16; i <= 16; i++) {
    float fi = float(i);
    if (abs(fi) > reach) continue;
    // Lines beyond the frame edges exist too (they can swing in).
    float k = k0 + fi;
    vec2 n = fbm3(vec2(nx, k * 0.37 + t));
    // Centred signal (fbm spans 0..0.875) and its slope in frame-height units.
    float y = (k + 0.5) * px + (n.x - 0.4375) * 2.0 * a;
    float g = n.y * 2.0 * a * scale * 0.5625;
    if (audAmp > 0.0) {
      float u = uv.x * 0.6 + hash12(vec2(mod(k, WRAP), 4.7)) * 0.4;
      y += aud(u) * audAmp;
      g += (aud(u + 0.004) - aud(u - 0.004)) / 0.008 * 0.6 * audAmp / aspect;
    }
    // Perpendicular distance (vertical distance thins the steep segments) and
    // a one-pixel floor on the width so thin lines never break into dashes.
    float d = abs(uv.y - y) / sqrt(1.0 + g * g);
    float wd = width * px;
    float w = max(wd, 1.0 / RENDERSIZE.y);
    float line = (1.0 - smoothstep(0.0, w, d)) * mix(1.0, wd / w, 0.5);
    // Brightness follows the local slope : the scan-processor read: lines
    // light up where the signal moves them hardest.
    float slope = abs(g) * 0.48 * 1.7778;
    lum = max(lum, line * (0.45 + min(slope, 0.55)));
  }

  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 col = base + tint.rgb * lum * 0.9;
  gl_FragColor = vec4(col, 1.0);
}
