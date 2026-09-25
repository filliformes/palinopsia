
// ── Analog parasites : what a worn tape and a tired set actually do ─────────
// Inserted by the registry at the shader's "// @parasites" line (Finalizer,
// Grain), after the shader's own hash21 / vnoise. GLSL ES 1.00.
//
// Everything is counted in TAPE / BROADCAST LINES (480 visible, NTSC-like) and
// fields (59.94 Hz), not pixels, so a dropout is one scanline tall whether the
// output is 1080p or a 4K dome master (edges box-filtered to the pixel).
//
// VHS :
//   time-base jitter  each line lands a little off (no time-base corrector), plus
//                     a slow skew : edges wobble
//   head switching    the last lines of the frame, where the drum's two heads
//                     hand over : torn sideways, noisy
//   tracking band     (high settings) a band of torn, snowy lines drifting
//                     through the picture, coming and going
//   dropouts          the head loses the tape for an instant (shed oxide, dust, a
//                     crease) : ONE scanline turns white from that point and
//                     fades over a tail as the FM demodulator recovers; a few go
//                     dark; they come in bursts, a new set every field
// CRT (broadcast reception) :
//   hum bar           a broad soft band rolling slowly up the screen (mains hum
//                     beating against the field rate)
//   RF interference   a faint herringbone beat pattern, coming and going
//   impulse noise     short bright / dark specks on single lines (ignition,
//                     switch clicks), in bursts

const float PAR_LINES = 480.0;

// Box-filtered coverage of the current line's middle (1 line tall, soft to the pixel).
float parLineProfile(float fy) {
  float lpx = RENDERSIZE.y / PAR_LINES;              // pixels per line
  return clamp(min(fy, 1.0 - fy) * lpx + 0.5, 0.0, 1.0);
}

// Where the picture is read from this line : jitter + head switching + tracking.
// `band` returns how deep this pixel sits in the tracking band (0..1).
vec2 vhsWarp(vec2 uv, float par, float t, out float band) {
  float fseed = floor(t * 59.94);
  float line = floor(uv.y * PAR_LINES);
  float dx = (hash21(vec2(line, fseed)) - 0.5) * 0.0008 * par;
  dx += sin(uv.y * 7.0 + t * 1.1) * 0.0005 * par;
  // Head switching : the last few lines, pulled sideways, more toward the bottom.
  float hsH = (4.0 + 6.0 * par) / PAR_LINES;
  if (uv.y < hsH) {
    float k = 1.0 - uv.y / hsH;
    dx += k * k * (0.01 + 0.035 * par) * (0.6 + 0.4 * hash21(vec2(line, fseed + 3.0)));
  }
  // Tracking band : only at high settings, and not all the time.
  float on = smoothstep(0.45, 1.0, par) * smoothstep(0.3, 0.6, vnoise(vec2(t * 0.22, 7.0)));
  float by = fract(0.35 - t * 0.045);
  float d = abs(uv.y - by);
  d = min(d, 1.0 - d);
  float bh = 0.025 + 0.05 * par;
  band = on * (1.0 - smoothstep(bh * 0.4, bh, d));
  dx += (hash21(vec2(line, fseed + 9.0)) - 0.5) * 0.08 * band;
  return uv + vec2(dx, 0.0);
}

// One family of single-line streaks (dropouts / impulse noise) on this line and
// the one above (some span two lines). p = chance per line per field.
// Returns (amount, polarity 1 = white / 0 = dark).
vec2 parStreaks(vec2 uv, float p, float fseed, float salt, float lenMax, float darkShare) {
  float lineY = uv.y * PAR_LINES;
  float line = floor(lineY);
  float prof = parLineProfile(fract(lineY));
  vec2 best = vec2(0.0, 1.0);
  for (int k = 0; k < 2; k++) {
    float ln = line - float(k);
    vec2 hk = vec2(ln, fseed + salt);
    if (hash21(hk) > p) continue;
    if (k == 1 && hash21(hk + 5.0) > 0.3) continue;    // only some reach the next line
    float x0 = hash21(hk + 1.0);
    float len = 0.003 + pow(hash21(hk + 2.0), 2.5) * lenMax; // mostly short, a few long
    float dx = uv.x - x0;
    if (dx < 0.0 || dx > len * 1.8) continue;
    float env = smoothstep(0.0, 0.0012, dx) * exp(-dx / (len * 0.55)); // sharp start, recovery tail
    float grit = 0.55 + 0.45 * hash21(vec2(floor(uv.x * 720.0), ln + fseed));
    float a = env * grit * prof * (k == 1 ? 0.7 : 1.0);
    if (a > best.x) best = vec2(a, hash21(hk + 4.0) > darkShare ? 1.0 : 0.0);
  }
  return best;
}

vec3 vhsParasites(vec3 col, vec2 uv, float par, float t, float band) {
  float fseed = floor(t * 59.94);
  // Dropouts, clustered in bursts (a damaged stretch of tape passing the head).
  float burst = 0.3 + 1.4 * smoothstep(0.5, 0.85, vnoise(vec2(t * 0.6, 3.1)));
  vec2 s = parStreaks(uv, par * 0.012 * burst + band * 0.3, fseed, 31.0, 0.4, 0.85);
  col = s.y > 0.5 ? mix(col, vec3(0.96, 0.96, 0.94), s.x) : mix(col, vec3(0.02), s.x * 0.9);
  // Snow in the tracking band and the head-switch lines : noise that flows ALONG
  // each line (the FM signal breaking up), a new pattern on every line and field.
  float line = floor(uv.y * PAR_LINES);
  float along = vnoise(vec2(uv.x * (120.0 + 260.0 * hash21(vec2(line, fseed + 2.0))), line * 1.37 + fseed * 7.1));
  float snow = smoothstep(0.35, 0.95, along) * (0.6 + 0.4 * hash21(vec2(floor(uv.x * 900.0), line + fseed)));
  float hsH = (4.0 + 6.0 * par) / PAR_LINES;
  float hsZone = uv.y < hsH ? (1.0 - uv.y / hsH) * (0.3 + 0.4 * par) : 0.0;
  float z = clamp(band * 0.8 + hsZone, 0.0, 1.0);
  col = mix(col, col * 0.75 + vec3(snow) * 0.55, z);
  return col;
}

vec3 crtParasites(vec3 col, vec2 uv, float par, float t) {
  float fseed = floor(t * 59.94);
  // Hum bar : one broad soft band of lower level rolling slowly upward.
  float hum = 0.5 + 0.5 * sin((uv.y - t * 0.08) * 6.2832);
  col *= 1.0 - par * 0.22 * hum * hum;
  // RF interference : a faint herringbone beat, drifting, coming and going.
  float rfAmp = par * 0.07 * mix(0.3, 1.0, smoothstep(0.35, 0.8, vnoise(vec2(t * 0.25, 11.0))));
  float lineY = uv.y * PAR_LINES;
  float rf = sin(6.2832 * (uv.x * 230.0 + floor(lineY) * 0.37) + t * 11.0 + 2.5 * sin(uv.y * 30.0 + t * 0.7));
  col += rf * rfAmp;
  // Impulse noise : short specks on single lines, both polarities, in bursts.
  float burst = 0.2 + 1.6 * smoothstep(0.55, 0.9, vnoise(vec2(t * 0.9, 5.3)));
  vec2 s = parStreaks(uv, par * 0.05 * burst, fseed, 57.0, 0.035, 0.5);
  col = s.y > 0.5 ? mix(col, vec3(0.95), s.x) : mix(col, vec3(0.03), s.x * 0.85);
  return col;
}
