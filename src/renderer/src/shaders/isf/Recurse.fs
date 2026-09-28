/*{
  "DESCRIPTION": "Recurse : recursive geometry: a square is drawn, then the space is shrunk, turned a little and shifted OFF-CENTER, and it is drawn again, cascading inward. The off-center drift (its direction set by drift angle) keeps it a spiral cascade converging on one side, never a centered tunnel or a mirror symmetry; a negative angle turns it the other way. Audio lets each level ride its own spectrum band : lows on the outer frames, highs on the deep ones. Matte line-work.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry"],
  "INPUTS": [
    { "NAME": "iterations", "TYPE": "float", "MIN": 2.0, "MAX": 10.0, "DEFAULT": 7.0 },
    { "NAME": "scale",  "TYPE": "float", "MIN": 0.6, "MAX": 0.95, "DEFAULT": 0.78 },
    { "NAME": "angle",  "TYPE": "float", "MIN": -1.2, "MAX": 1.2,  "DEFAULT": 0.4 },
    { "NAME": "drift",  "TYPE": "float", "MIN": 0.03, "MAX": 0.5,  "DEFAULT": 0.15 },
    { "NAME": "driftAngle", "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": 0.5404, "LABEL": "drift angle" },
    { "NAME": "width",  "TYPE": "float", "MIN": 0.002,"MAX": 0.2,  "DEFAULT": 0.035 },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0, "MAX": 20.0,  "DEFAULT": 0.15 },
    { "NAME": "audio",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0 },
    { "NAME": "tint",   "TYPE": "color", "DEFAULT": [0.72, 0.76, 0.7, 1.0] },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// ∫ rate dt : the breathing follows a moving rate without jumping (engine-integrated).
uniform float PH_rate;

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  // Breathing phases, wrapped (uniform-only) so a long show stays smooth.
  float b1 = mod(PH_rate, 6.2831853);
  float b2 = mod(PH_rate * 0.7, 6.2831853);
  float ang = angle + sin(b1) * 0.15;      // breathe the rotation
  // Drift offset : 1.166 = |(1, 0.6)|, the original fixed direction's length,
  // so the default drift angle (atan 0.6) keeps the original picture.
  vec2 dr = drift * 1.166 * vec2(cos(driftAngle), sin(driftAngle)) * (1.0 + 0.3 * sin(b2));
  float cs = cos(ang), sn = sin(ang);

  float px = 1.0 / RENDERSIZE.y; // one screen pixel, in level-0 units
  float zoom = 1.0;              // screen units per unit of the current level
  float acc = 0.0;
  float bright = 1.0;
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    if (fi >= iterations) break;
    // Square outline SDF at this recursion level.
    vec2 b = abs(p) - vec2(0.35);
    float d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0);
    // Per-level audio : level i rides spectrum band i (outer = lows, deep = highs).
    float s = 0.0;
    if (audio > 0.0) {
      vec2 ac = vec2((fi + 0.5) / 10.0, 0.75);
      s = IMG_NORM_PIXEL(audioTex, ac).r * audio;
    }
    // Line width in this level's units, floored at ~1.5 screen pixels so the
    // deep levels never thin into shimmering dashes.
    float w = max(width * (1.0 + s), 1.5 * px / zoom);
    float line = 1.0 - smoothstep(0.0, w, abs(d));
    // The last (fractional) level fades in with `iterations` : no popping.
    float lv = bright * clamp(iterations - fi, 0.0, 1.0) * (1.0 + 0.6 * s);
    acc = max(acc, line * lv);
    // Recurse: shift off-center, rotate, shrink.
    p -= dr;
    p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs) / scale;
    zoom *= scale;
    bright *= 0.88; // deeper levels fade
  }

  vec3 base = vec3(0.025, 0.025, 0.03);
  vec3 col = base + tint.rgb * min(acc, 1.0) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}
