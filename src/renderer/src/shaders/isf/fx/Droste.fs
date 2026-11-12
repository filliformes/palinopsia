/*{
  "DESCRIPTION": "Droste : the picture inside itself, forever, wound into a spiral (the Droste effect, one pass of complex log and exp). Each turn of the spiral goes one LEVEL deeper : a copy of the whole frame SCALE times smaller. STRANDS is how many arms the spiral winds in (0 = plain nested frames, negative winds the other way), ARMS how many copies go round. ZOOM flies into it for ever (levels a second, negative flies out), SPIN turns it, TWIST is a fixed turn. CENTER (x, y) is where it winds to : a click on the preview puts it there. SHAPE nests the whole frame (FRAMES) or a round window of it (CIRCLE). EDGE draws a thin dark line where each level meets the next.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Distortion", "Space"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "scale",   "TYPE": "float", "MIN": 1.5, "MAX": 24.0, "DEFAULT": 5.0, "LABEL": "level scale" },
    { "NAME": "strands", "TYPE": "float", "MIN": -4.0, "MAX": 4.0, "DEFAULT": 1.0, "LABEL": "strands" },
    { "NAME": "arms",    "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 1.0, "LABEL": "arms" },
    { "NAME": "zoom",    "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.12, "LABEL": "zoom (levels/s)" },
    { "NAME": "spin",    "TYPE": "float", "MIN": -0.5, "MAX": 0.5, "DEFAULT": 0.0, "LABEL": "spin (turns/s)" },
    { "NAME": "twist",   "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": 0.0, "LABEL": "twist" },
    { "NAME": "depth",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "level offset" },
    { "NAME": "shape",   "TYPE": "long",  "VALUES": [0, 1], "LABELS": ["frames", "circle"], "DEFAULT": 0, "LABEL": "shape", "COMPACT": true },
    { "NAME": "edge",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "edge" },
    { "NAME": "cx",      "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "center x" },
    { "NAME": "cy",      "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "center y" },
    { "NAME": "amount",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" }
  ]
}*/

// Integrated phases (engine/phases.ts) : the flight in levels and the turn in
// turns, so moving ZOOM or SPIN changes the pace from here on, never jumps the
// spiral. Both are used periodically (one level, one turn) : wrapped.
uniform float PH_zoom; // wrap 1
uniform float PH_spin; // wrap 1

const float TAU = 6.2831853;

// complex helpers (x + iy)
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

// The picture's own extent seen from its center, in height units : the frame's
// half box (FRAMES) or the inscribed circle (CIRCLE), along the direction `d`.
float logReach(vec2 d, float aspect) {
  if (shape == 1) return log(0.5);
  // the box : the larger of |x| / (aspect / 2) and |y| / (1 / 2), as a log
  return -log(max(abs(d.x) / (0.5 * aspect), abs(d.y) / 0.5));
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 live = IMG_NORM_PIXEL(inputImage, uv);
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 ctr = vec2(cx, cy);
  vec2 z = (uv - ctr) * vec2(aspect, 1.0);
  float r = max(length(z), 1e-6);

  // log space : (log r, angle). One level deeper = log(scale) further in.
  float L = log(max(scale, 1.01));
  float p1 = max(floor(arms + 0.5), 1.0);
  float p2 = floor(strands + 0.5);
  vec2 zeta = vec2(log(r), atan(z.y, z.x));
  // Once round the screen goes p2 levels deeper and p1 turns round the picture :
  // eta = gamma * zeta with gamma = p1 - i p2 L / 2pi. A whole number of each
  // keeps the map seamless all the way round.
  vec2 gam = vec2(p1, -p2 * L / TAU);
  vec2 eta = cmul(zeta, gam);
  eta.x -= (fract(PH_zoom) + depth) * L;
  eta.y += fract(PH_spin) * TAU + twist;

  // Fold the depth into ONE level : between the picture's own reach and that
  // divided by the scale, along this direction, so every point lands inside
  // the frame (a whole frame nested in a whole frame, or a round window).
  vec2 dir = vec2(cos(eta.y), sin(eta.y));
  float reach = logReach(dir, aspect);
  float k = ceil((eta.x - reach) / L);
  float lx = eta.x - k * L; // in (reach - L, reach]
  vec2 w = exp(lx) * dir;
  vec2 suv = vec2(0.5) + w / vec2(aspect, 1.0);
  vec4 c = IMG_NORM_PIXEL(inputImage, suv);

  // EDGE : a thin dark line where a level meets the next (the fold), about one
  // and a half pixels wide whatever the depth : the fold's distance in log space
  // times the screen's own scale there.
  if (edge > 0.0) {
    float g = length(gam);
    float dl = min(reach - lx, lx - (reach - L)); // log distance to the fold
    float dpx = dl / g * r * RENDERSIZE.y;
    float line = 1.0 - smoothstep(0.5, 1.8, dpx);
    c.rgb *= 1.0 - line * edge * 0.85;
  }

  // The vanishing point : where a whole level shrinks under about two pixels the
  // spiral is finer than the screen. It settles to the picture's own mean
  // (four fixed reads) instead of crawling with aliasing.
  float levelPx = L / length(gam) * r * RENDERSIZE.y;
  float fine = 1.0 - smoothstep(1.5, 5.0, levelPx);
  vec2 q0 = vec2(0.3, 0.35); vec2 q1 = vec2(0.7, 0.35); vec2 q2 = vec2(0.3, 0.65); vec2 q3 = vec2(0.7, 0.65);
  vec4 mean = (IMG_NORM_PIXEL(inputImage, q0) + IMG_NORM_PIXEL(inputImage, q1)
             + IMG_NORM_PIXEL(inputImage, q2) + IMG_NORM_PIXEL(inputImage, q3)) * 0.25;
  c = mix(c, mean, fine);

  gl_FragColor = mix(live, c, amount);
}
