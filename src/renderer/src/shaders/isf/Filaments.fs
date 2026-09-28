/*{
  "DESCRIPTION": "Filaments : vertical strands swaying like kelp: each filament is a curve whose lateral sway deepens toward the free end, with its own rate and phase. Matte line-work over near-black; lean tilts the whole bed. Audio scatter pushes each strand on its own live waveform sample; audio sway instead lets each strand swing wider when its own frequency band is loud (smooth, follows the music's energy).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "strands", "TYPE": "float", "MIN": 3.0,  "MAX": 40.0, "DEFAULT": 14.0 },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,  "DEFAULT": 0.4 },
    { "NAME": "sway",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.45 },
    { "NAME": "width",   "TYPE": "float", "MIN": 0.05, "MAX": 0.6,  "DEFAULT": 0.18 },
    { "NAME": "lean",    "TYPE": "float", "MIN": -1.0, "MAX": 1.0,  "DEFAULT": 0.15 },
    { "NAME": "audioScatter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio scatter" },
    { "NAME": "audioSway", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio sway" },
    { "NAME": "tint",    "TYPE": "color", "DEFAULT": [0.5, 0.68, 0.55, 1.0] },
    { "NAME": "audioTex","TYPE": "image" }
  ]
}*/

// Integrated rate (engine-driven : a rate change alters how fast the strands
// sway from now on, never where they are).
uniform float PH_rate;

// The noise lattice repeats every WRAP units in its time axis, so the phase
// can wrap seamlessly and hash inputs stay small forever.
#define WRAP 1024.0

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise (periodic over WRAP in y) + its analytic y-derivative.
vec2 vnoiseDy(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float du = 6.0 * f.y * (1.0 - f.y);
  float y0 = mod(i.y, WRAP), y1 = mod(i.y + 1.0, WRAP);
  float a = hash12(vec2(i.x, y0));
  float b = hash12(vec2(i.x + 1.0, y0));
  float c = hash12(vec2(i.x, y1));
  float d = hash12(vec2(i.x + 1.0, y1));
  float v = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  return vec2(v, du * (mix(c, d, u.x) - mix(a, b, u.x)));
}

// Per-element audio : waveform (row 0, ±1 around silence) and spectrum (row 1,
// log-spaced, 0..1, smoothed by the analyser). Bare-identifier coordinates.
float aud(float idx01) {
  vec2 ac = vec2(fract(idx01), 0.25);
  return (IMG_NORM_PIXEL(audioTex, ac).r - 0.5) * 2.0;
}
float spec(float u) {
  vec2 ac = vec2(clamp(u, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float t = PH_rate * 2.0;
  float tn = mod(PH_rate * 0.6, WRAP);
  float px = 1.0 / strands;
  float y = uv.y;
  float y2 = y * y;

  // Search centred on where the lean carries the strands at this height, and
  // only as wide as the sway can reach here (sway grows as y², so the roots
  // cost almost nothing). Strands exist off-screen too : leaning brings them in.
  float leanX = lean * y2 * 0.25;
  float swayMax = sway * (1.0 + 2.0 * audioSway) * 0.35 + audioScatter * 0.18;
  float reach = min(ceil(swayMax * y2 * strands + 0.6) + 1.0, 10.0);
  // Only the extreme corner (dense strands swinging a whole screen) outgrows
  // the ±10 search : there the swing is compressed to fit, never clipped.
  float fit = min(1.0, 9.0 / max(swayMax * strands, 0.0001));
  float k0 = floor((uv.x - leanX) * strands);

  float lum = 0.0;
  for (int i = -10; i <= 10; i++) {
    float fi = float(i);
    if (abs(fi) > reach) continue;
    float k = k0 + fi;
    float rootX = (k + 0.5) * px + (hash12(vec2(k, 1.0)) - 0.5) * px * 0.8;
    float own = 0.6 + hash12(vec2(k, 3.3)) * 0.8;           // per-strand rate
    float phase = hash12(vec2(k, 7.7)) * 6.2832;
    float fy = 2.0 + hash12(vec2(k, 11.0)) * 3.0;           // bends along the strand
    // Audio sway : this strand's band loudness widens its swing (smooth : the
    // spectrum is analyser-smoothed, and it scales the sway, not the position).
    float amp = sway * 0.35 * fit;
    if (audioSway > 0.0) amp *= 1.0 + 2.0 * audioSway * spec(0.03 + hash12(vec2(k, 13.0)) * 0.7);
    // Lateral offset x(y) and its slope dx/dy (analytic : used to measure the
    // true perpendicular distance, so slanted segments keep their width).
    float arg = t * own + phase + y * fy;
    float s = sin(arg);
    vec2 n = vnoiseDy(vec2(k * 3.1, y * 2.0 + tn));
    float g = s * 0.6 + (n.x - 0.5) * 0.8;
    float gd = cos(arg) * fy * 0.6 + n.y * 2.0 * 0.8;
    float lat = amp * g + lean * 0.25;
    float latD = amp * gd;
    // Audio scatter : each strand leans on its OWN live sample, anchored at the
    // root (y²) like the sway : the bed ripples with the waveform.
    if (audioScatter > 0.0) lat += aud(k / strands) * audioScatter * 0.18 * fit;
    float x = rootX + lat * y2;
    float dxdy = lat * 2.0 * y + latD * y2;
    float gp = dxdy * aspect;                                  // slope in pixels
    float d = abs(uv.x - x) / sqrt(1.0 + gp * gp);
    // Strands taper toward the free end; never thinner than ~1.5 px.
    float w = max(width * px * (1.0 - y * 0.6), 1.5 / RENDERSIZE.x);
    float line = 1.0 - smoothstep(w * 0.4, w, d);
    // Root darker, tip brighter : the light is above.
    lum = max(lum, line * (0.35 + 0.65 * y) * (0.6 + 0.4 * hash12(vec2(k, 5.0))));
  }

  vec3 base = vec3(0.02, 0.025, 0.025);
  vec3 col = base + tint.rgb * lum * 0.85;
  gl_FragColor = vec4(col, 1.0);
}
