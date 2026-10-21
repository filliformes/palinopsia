/*{
  "DESCRIPTION": "Erosion : sediment washing down a slope: strongly anisotropic ridged noise advected downward, carving streaks that gather and split. The geological register: slow, directional, matte. RELIEF lights it as a carved surface (banks raised, channels cut in) under one low raking light at LIGHT ANGLE; 0 = the flat print.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Noise", "Organic"],
  "INPUTS": [
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 20.0,  "DEFAULT": 0.3 },
    { "NAME": "scale",    "TYPE": "float", "MIN": 0.5, "MAX": 8.0,  "DEFAULT": 2.5 },
    { "NAME": "streaks",  "TYPE": "float", "MIN": 1.0, "MAX": 12.0, "DEFAULT": 5.0 },
    { "NAME": "carve",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.6 },
    { "NAME": "sediment", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "tint",     "TYPE": "color", "DEFAULT": [0.72, 0.6, 0.45, 1.0] },
    { "NAME": "relief",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.5,  "LABEL": "relief" },
    { "NAME": "lightAngle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 2.36, "LABEL": "light angle" }
  ]
}*/

// Integrated phases (engine/phases.ts) : a knob change moves the picture on
// from where it is instead of jumping it.
uniform float PH_rate;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // precise hash : no rows, no lattice over hours
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
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

// @dome

// Value noise repeating every P cells in x (P whole) : the field laid round the
// dome meets itself again at the back.
float vnoiseP(vec2 p, float P) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, P);
  float x1 = mod(i.x + 1.0, P);
  float a = hash(vec2(x0, i.y));
  float b = hash(vec2(x1, i.y));
  float c = hash(vec2(x0, i.y + 1.0));
  float d = hash(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// On the full dome (lib/dome.glsl) the sediment washes OUTWARD, from the zenith
// down the walls all round : the channels are spokes (as many as fit round the
// horizon, so they keep their flat width there), gathering in to the summit, and
// the flow runs to the rim. The same field as flat, laid round the dome.
vec2 erosionDome(vec2 uv) {
  float t = PH_rate * 0.3;
  vec2 pol = domePolar(uv);
  float down = 0.5 * pol.y; // out from the zenith, in frame heights (the disc's diameter is one)
  float P = max(1.0, floor(3.14159265 * domeHorizon() * scale * streaks + 0.5));
  float P2 = max(1.0, floor(P * 2.3 + 0.5));
  float P3 = max(1.0, floor(P * 0.3 + 0.5));
  vec2 p = vec2(pol.x * P, down * scale - t);
  float wanderX = (vnoise(vec2(down * 2.0 - t * 0.5, 7.3)) - 0.5) * 1.5;
  float n1 = vnoiseP(p + vec2(wanderX, 0.0), P);
  float n2 = vnoiseP(vec2(pol.x * P2 + wanderX * 2.0, p.y * 2.3 + 11.0), P2);
  float ridge = 1.0 - abs(2.0 * (n1 * 0.7 + n2 * 0.3) - 1.0);
  float channel = pow(ridge, 2.0 + carve * 6.0);
  float banks = vnoiseP(vec2(pol.x * P3, down * scale * 0.6 - t * 0.4), P3) * sediment;
  return vec2(channel, banks);
}

// The field : x = channels (0..1), y = sediment banks (0..1).
vec2 erosionField(vec2 uv) {
  if (DOME_FILL > 0.0) return erosionDome(uv);
  float t = PH_rate * 0.3;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  // Anisotropic domain: x compressed by `streaks`, y flowing downward.
  vec2 p = vec2(uv.x * aspect * scale * streaks, uv.y * scale - t);

  // Two-octave ridged noise = the channels; a slow lateral wander makes
  // streams gather and split as they descend.
  float wanderX = (vnoise(vec2(uv.y * 2.0 - t * 0.5, 7.3)) - 0.5) * 1.5;
  float n1 = vnoise(p + vec2(wanderX, 0.0));
  float n2 = vnoise(p * 2.3 + vec2(wanderX * 2.0, 11.0));
  float ridge = 1.0 - abs(2.0 * (n1 * 0.7 + n2 * 0.3) - 1.0);

  // Carve: channels where the ridge peaks.
  float channel = pow(ridge, 2.0 + carve * 6.0);

  // Sediment banks: broad mid-tone mass between channels.
  float banks = vnoise(vec2(p.x * 0.3, uv.y * scale * 0.6 - t * 0.4)) * sediment;
  return vec2(channel, banks);
}

// Lit, the channels are cut INTO the ground and the banks stand up between them.
float og_height(vec2 uv) {
  vec2 f = erosionField(uv);
  return clamp(0.55 + f.y * 0.5 - f.x * 0.45, 0.0, 1.0);
}

#define OG_SHADOW_STEPS 4
// @og-relief

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 f = erosionField(uv);
  vec3 base = vec3(0.03, 0.028, 0.026);
  vec3 flatc = base + tint.rgb * (f.y * 0.5 + f.x * 0.75);
  // Lit : one material (the tint), wet dark sediment in the channels.
  vec3 alb = tint.rgb * (0.26 + f.y * 0.3) * mix(1.0, 0.5, f.x) + base;
  float h = clamp(0.55 + f.y * 0.5 - f.x * 0.45, 0.0, 1.0);
  vec3 col = mix(flatc, og_relief(uv, alb, h, lightAngle, relief), smoothstep(0.0, 0.25, relief));
  gl_FragColor = vec4(col, 1.0);
}
