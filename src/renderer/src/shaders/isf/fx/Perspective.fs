/*{
  "DESCRIPTION": "Perspective : lays the layer on a plane in space and looks at it through a lens. TILT leans the plane back (the top recedes), TURN swings it sideways, ROLL spins it in its own plane; LENS runs from a long, flat telephoto to a wide angle whose lines converge hard, ZOOM brings the plane closer and SHIFT moves it in the frame. BEND curls it like a screen or a page, WAVE ripples it into a ribbon (WAVES across it, travelling at WAVE RATE), along BEND AXIS. REPEAT keeps one card or tiles it to the horizon, TRAVEL and DRIFT slide the picture along the plane, FOG fades the far side into the layers below, SHADE darkens what turns away from you, SOFTEN filters the far side so fine lines crawl less. Outside the plane is transparent.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Distortion"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "tilt",     "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.45, "LABEL": "tilt" },
    { "NAME": "turn",     "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0,  "LABEL": "turn" },
    { "NAME": "roll",     "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0,  "LABEL": "roll" },
    { "NAME": "lens",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.6,  "LABEL": "lens" },
    { "NAME": "zoom",     "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0,  "LABEL": "zoom" },
    { "NAME": "posX",     "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0,  "LABEL": "shift x" },
    { "NAME": "posY",     "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0,  "LABEL": "shift y" },
    { "NAME": "axis",     "TYPE": "long",  "VALUES": [0, 1], "LABELS": ["across", "down"], "DEFAULT": 0, "LABEL": "axis" },
    { "NAME": "bend",     "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0,  "LABEL": "bend" },
    { "NAME": "wave",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0,  "LABEL": "wave" },
    { "NAME": "waves",    "TYPE": "float", "MIN": 0.25, "MAX": 8.0, "DEFAULT": 1.5,  "LABEL": "wave count" },
    { "NAME": "waveRate", "TYPE": "float", "MIN": -2.0, "MAX": 2.0, "DEFAULT": 0.0,  "LABEL": "wave rate" },
    { "NAME": "repeat",   "TYPE": "long",  "VALUES": [0, 1, 2], "LABELS": ["once", "tile", "mirror"], "DEFAULT": 1, "LABEL": "repeat" },
    { "NAME": "travel",   "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0,  "LABEL": "travel" },
    { "NAME": "drift",    "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0,  "LABEL": "drift" },
    { "NAME": "fog",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.3,  "LABEL": "fog" },
    { "NAME": "shade",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0,  "LABEL": "shade" },
    { "NAME": "soften",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.6,  "LABEL": "soften" }
  ]
}*/

// The picture slides along the plane on integrated clocks (authoring rules §1) :
// moving TRAVEL mid-show changes the pace from here on, it never flings the
// picture. Wrapped at 2, the mirror's period, which the tile's 1 divides.
uniform float PH_travel; // wrap 2
uniform float PH_drift; // wrap 2
uniform float PH_waveRate; // wrap 1

const float PI = 3.14159265;
// 80 degrees at the end of tilt and turn : at 90 the plane is seen edge on and
// vanishes into one line.
const float MAX_LEAN = 1.3963;

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

// Half the card's length along the bend axis, in frame heights.
float halfLen(float aspect) { return axis == 0 ? 0.5 * aspect : 0.5; }

// The bend stops curling 2.5 half lengths out and runs on flat from there, so a
// tiled, bent plane stays a halfpipe instead of climbing without end (and the
// band the surface can occupy stays finite, which the search below needs).
const float BEND_REACH = 2.5;

// How far the surface stands off the flat plane at (a, b), toward the viewer.
// BEND is a parabola along the axis (the edges come forward at +1, fall back at
// -1, by up to the card's half length); WAVE is a sine across it, all the way
// to the horizon on a tiled plane.
float heightAt(vec2 ab, float aspect) {
  float hl = halfLen(aspect);
  float q = (axis == 0 ? ab.x : ab.y) / hl;
  float qb = clamp(q, -BEND_REACH, BEND_REACH);
  float ph = waves * (q * 0.5 + 0.5) + PH_waveRate;
  return bend * 0.5 * qb * qb * hl + wave * 0.25 * sin(2.0 * PI * ph);
}

// Its slope along the axis, per frame height, for SHADE's normal.
float slopeAt(vec2 ab, float aspect) {
  float hl = halfLen(aspect);
  float q = (axis == 0 ? ab.x : ab.y) / hl;
  float qb = abs(q) < BEND_REACH ? q : 0.0;
  float ph = waves * (q * 0.5 + 0.5) + PH_waveRate;
  float dq = bend * qb * hl + wave * 0.25 * cos(2.0 * PI * ph) * 2.0 * PI * waves * 0.5;
  return dq / hl;
}

// The ray's height above the surface at t : positive in front of it.
float aboveAt(float t, vec3 d, vec3 C, vec3 R, vec3 U, float den, float c0, float aspect) {
  vec3 P = t * d - C;
  return (t * den - c0) - heightAt(vec2(dot(P, R), dot(P, U)), aspect);
}

// Where the ray through screen point p meets the surface : (a, b) on the card
// in frame heights, and t along the ray (negative : no hit). A flat plane is one
// division. A bent or waved one lies inside a band HMAX thick on either side of
// the plane : the ray is marched across that band in 24 steps and the FIRST
// crossing kept, the one nearest the lens, so a fold hides what lies behind it;
// then six halvings pin it to well under a pixel. (A plain fixed-point solve
// was tried first : it never settles where the surface turns steeply toward a
// grazing ray, which left holes in a ribbon and slivers beside it.)
vec3 hitSurface(vec2 p, float f, vec3 C, vec3 R, vec3 U, vec3 N, float aspect, float hmax) {
  vec3 d = vec3(p, -f);
  float den = dot(d, N);
  if (abs(den) < 1e-6) return vec3(0.0, 0.0, -1.0);
  float c0 = dot(C, N);
  float t = c0 / den;
  if (hmax > 1e-5) {
    float ta = (c0 - hmax) / den;
    float tb = (c0 + hmax) / den;
    float t0 = max(min(ta, tb), 0.0);
    float t1 = max(ta, tb);
    if (t1 <= 0.0) return vec3(0.0, 0.0, -1.0);
    float lo = t0;
    float flo = aboveAt(t0, d, C, R, U, den, c0, aspect);
    float hi = -1.0;
    for (int i = 1; i <= 24; i++) {
      float ti = mix(t0, t1, float(i) / 24.0);
      float fi = aboveAt(ti, d, C, R, U, den, c0, aspect);
      if (flo * fi <= 0.0) { hi = ti; break; }
      lo = ti;
      flo = fi;
    }
    if (hi < 0.0) return vec3(0.0, 0.0, -1.0);
    for (int k = 0; k < 6; k++) {
      float mid = 0.5 * (lo + hi);
      float fm = aboveAt(mid, d, C, R, U, den, c0, aspect);
      if (flo * fm <= 0.0) { hi = mid; } else { lo = mid; flo = fm; }
    }
    t = 0.5 * (lo + hi);
  }
  vec3 P = t * d - C;
  return vec3(dot(P, R), dot(P, U), t);
}

// Card position in frame heights -> the layer's own uv.
vec2 cardUv(vec2 ab, float aspect) { return vec2(ab.x / aspect + 0.5, ab.y + 0.5); }

vec2 wrapUv(vec2 s) {
  // ONCE wraps too : the card stays put and the picture slides through it.
  if (repeat == 2) return 1.0 - abs(1.0 - mod(s, 2.0));
  return fract(s);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float px = 1.0 / RENDERSIZE.y;

  // LENS is the focal length, from 6 frame heights (a 9 degree telephoto, almost
  // flat) to 0.6 (an 80 degree wide angle). The plane sits at that same
  // distance, so at zero tilt and turn it fills the frame exactly whatever the
  // lens : the lens changes how hard the lines converge, never the framing.
  float f = 0.6 * pow(10.0, 1.0 - clamp(lens, 0.0, 1.0));
  float D = f / max(zoom, 0.05);
  mat3 M = rotY(turn * MAX_LEAN) * rotX(-tilt * MAX_LEAN) * rotZ(roll * PI);
  vec3 R = M[0];
  vec3 U = M[1];
  vec3 N = M[2];
  vec3 C = vec3(0.0, 0.0, -D);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) - vec2(posX * aspect, posY) * 0.5;
  float hmax = abs(bend) * 0.5 * BEND_REACH * BEND_REACH * halfLen(aspect) + abs(wave) * 0.25;

  vec3 h0 = hitSurface(p, f, C, R, U, N, aspect, hmax);
  // Behind the lens, or the plane seen edge on : nothing here.
  if (h0.z <= 0.0) { gl_FragColor = vec4(0.0); return; }
  // The same for the next pixel over and the next one up : how much of the
  // picture one screen pixel covers here. Far away it is many texels, which is
  // what makes fine lines crawl, and what SOFTEN and the card's edge measure by.
  vec3 hX = hitSurface(p + vec2(px, 0.0), f, C, R, U, N, aspect, hmax);
  vec3 hY = hitSurface(p + vec2(0.0, px), f, C, R, U, N, aspect, hmax);
  vec2 c = cardUv(h0.xy, aspect);
  vec2 dU = hX.z > 0.0 ? cardUv(hX.xy, aspect) - c : vec2(0.5, 0.0);
  vec2 dV = hY.z > 0.0 ? cardUv(hY.xy, aspect) - c : vec2(0.0, 0.5);
  float fp = clamp(max(length(dU), length(dV)), 1e-6, 0.5);

  // ONCE : the card's edge, anti-aliased over one screen pixel however far it is.
  float mask = 1.0;
  if (repeat == 0) {
    float e = min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y));
    mask = smoothstep(-0.5 * fp, 0.5 * fp, e);
  }

  // SOFTEN : four taps across the pixel's footprint, along its longest side (the
  // direction the plane is squeezed in), premultiplied so a transparent tap
  // never darkens an opaque one. At 0 one raw tap : the far side crawls and
  // beats against the pixel grid, which is a look too.
  vec2 s = c + vec2(PH_drift, PH_travel);
  vec2 maj = length(dU) > length(dV) ? dU : dV;
  if (length(maj) > 0.5) maj *= 0.5 / length(maj);
  float spread = clamp(soften, 0.0, 1.0) * 1.5;
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 4; k++) {
    float o = (float(k) + 0.5) / 4.0 - 0.5;
    vec2 sk = wrapUv(s + maj * o * spread);
    vec4 tx = IMG_NORM_PIXEL(inputImage, sk);
    acc += vec4(tx.rgb * tx.a, tx.a);
  }
  float a = acc.a * 0.25;
  vec3 rgb = acc.rgb / max(acc.a, 1e-5);

  // FOG : fades with distance past the plane's own centre, into transparency,
  // so whatever lies under the layer shows through the far side.
  vec3 d0 = vec3(p, -f);
  float dist = h0.z * length(d0) / max(D, 1e-4);
  float fogF = 1.0 - exp(-max(dist - 0.8, 0.0) * fog * 3.0);

  // SHADE : the surface darkens as it turns away from the lens. The normal
  // follows the bend and the wave, so a ribbon reads as a ribbon.
  float sl = slopeAt(h0.xy, aspect);
  vec3 ns = normalize(N - sl * (axis == 0 ? R : U));
  float facing = abs(dot(ns, normalize(d0)));
  rgb *= mix(1.0, facing, clamp(shade, 0.0, 1.0));

  gl_FragColor = vec4(rgb, a * mask * (1.0 - fogF));
}
