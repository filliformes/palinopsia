/*{
  "DESCRIPTION": "Contour : slow marching contour lines over a drifting, domain-warped noise basin. The topographic register: matte line-work of even weight over near-black, optional faint band fill. INDEX LINES draws every Nth level heavier, as on a survey map; AUDIO SWELL thickens each level with its own frequency band (low ground on the bass, high ground on the treble). Asymmetric by construction.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Noise", "Geometry"],
  "INPUTS": [
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,  "DEFAULT": 0.1 },
    { "NAME": "scale",  "TYPE": "float", "MIN": 0.5,  "MAX": 8.0,  "DEFAULT": 2.2 },
    { "NAME": "levels", "TYPE": "float", "MIN": 3.0,  "MAX": 30.0, "DEFAULT": 12.0 },
    { "NAME": "width",  "TYPE": "float", "MIN": 0.02, "MAX": 0.5,  "DEFAULT": 0.12, "LABEL": "line weight" },
    { "NAME": "warp",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.5,  "DEFAULT": 0.5 },
    { "NAME": "fill",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.15 },
    { "NAME": "major",  "TYPE": "long",  "VALUES": [0, 2, 3, 4, 5, 10], "LABELS": ["off", "every 2nd", "every 3rd", "every 4th", "every 5th", "every 10th"], "DEFAULT": 0, "LABEL": "index lines" },
    { "NAME": "audioSwell", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio swell" },
    { "NAME": "tint",   "TYPE": "color", "DEFAULT": [0.75, 0.78, 0.72, 1.0] },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// Integrated drift phase (∫ rate dt, set by the engine) : a rate change alters
// the speed from here on, never the position.
uniform float PH_rate;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise with its analytic gradient : (value, d/dx, d/dy). Tiles every
// `per` lattice cells, so the drift offsets (the phase grows without bound)
// are wrapped mod PER without a seam.
vec3 vnoised(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  vec2 i0 = mod(i, per), i1 = i0 + 1.0;
  i1 *= step(i1, vec2(per - 0.5));
  float a = hash(i0);
  float b = hash(vec2(i1.x, i0.y));
  float c = hash(vec2(i0.x, i1.y));
  float d = hash(i1);
  float k1 = b - a, k2 = c - a, k3 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k3 * u.x * u.y,
              du * vec2(k1 + k3 * u.y, k2 + k3 * u.x));
}

#define PER 256.0
// fbm with its gradient. Octave k runs at 2^k with a period of 2^k·PER, so the
// whole sum tiles every PER.
vec3 fbmd(vec2 p) {
  float s = 0.0, a = 0.5, m = 1.0, per = PER;
  vec2 g = vec2(0.0);
  for (int k = 0; k < 5; k++) {
    vec3 n = vnoised(p, per);
    s += a * n.x;
    g += a * m * n.yz;
    p = p * 2.0 + vec2(7.37, 3.61);
    per *= 2.0;
    m *= 2.0;
    a *= 0.5;
  }
  return vec3(s, g);
}

// The shared spectrum (row 1, log-spaced : 0 = bass, 1 = treble), 0..1.
float spec(float idx01) {
  vec2 ac = vec2(clamp(idx01, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 aspect = vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0);
  vec2 p = (uv - 0.5) * aspect * scale;
  float t = PH_rate;

  // The basin: fbm with directional drift + a warp of itself. The drift speeds
  // are incommensurate, so the wrapped offsets never line up into a loop.
  vec2 dA = mod(vec2(t * 0.4), PER);
  vec2 dB = mod(vec2(t * 0.3183), PER);
  vec2 dM = mod(vec2(t * 0.5, -t * 0.2071), PER);
  vec3 F1 = fbmd(p * 0.6 + dA);
  vec3 F2 = fbmd(p.yx * 0.6 - dB);
  vec3 N = fbmd(p + warp * vec2(F1.x, F2.x) + dM);
  float n = N.x;

  // The basin's gradient on screen (chain rule through the warp), so every
  // line is drawn at a constant PIXEL weight : no fat smears in flat basins,
  // no beading or sub-pixel shimmer on steep slopes.
  vec2 gF1 = 0.6 * F1.yz;   // ∂flow.x/∂p
  vec2 gF2 = 0.6 * F2.zy;   // ∂flow.y/∂p (its argument swaps x and y)
  vec2 grad = vec2(N.y * (1.0 + warp * gF1.x) + N.z * warp * gF2.x,
                   N.y * warp * gF1.y + N.z * (1.0 + warp * gF2.y));
  float gPx = length(grad) * scale / RENDERSIZE.y;           // value change per pixel

  // Elevation bands. A line lives wherever the banded value crosses a level;
  // its distance in pixels is the value distance over the slope.
  float lvl = floor(n * levels + 0.5);                        // nearest level
  float dv = abs(fract(n * levels + 0.5) - 0.5) / levels;
  float dPx = dv / max(gPx, 1e-6);

  // Line weight relative to frame height (the same look at 1080p, 4K or on a
  // dome), never thinner than ~1.2 px so fine lines don't break into dashes.
  float hw = max(width * 0.01 * RENDERSIZE.y, 0.6);
  // INDEX LINES : every Nth level drawn heavier (a survey map's index contour).
  float isMajor = 0.0;
  if (major > 0) isMajor = step(mod(lvl, float(major)), 0.5);
  hw *= 1.0 + 0.9 * isMajor;
  // AUDIO SWELL : each level thickens with its own frequency band.
  if (audioSwell > 0.001) hw *= 1.0 + audioSwell * 2.5 * spec(lvl / levels);
  float line = 1.0 - smoothstep(hw - 0.5, hw + 0.5, dPx);

  // Faint band fill (staircase shading) under the line-work.
  float band = floor(n * levels) / levels;
  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 col = base + tint.rgb * (band * fill * 0.35);
  col += tint.rgb * line * (0.85 + 0.15 * isMajor);

  gl_FragColor = vec4(col, 1.0);
}
