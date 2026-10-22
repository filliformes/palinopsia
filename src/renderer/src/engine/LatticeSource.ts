// LatticeSource : the native Lattice generator (id 'gen-lattice'). A lattice of
// points in space seen through a moving camera : a PLANE of dots (a floor, a
// sheet, a field seen from above) or a VOLUME of them (a room of stars the camera
// flies through). The points can sink into a well, ring with ripples, swell like
// water, lift with the sound's spectrum or with the brightness of another layer.
//
// How it draws :
// - No vertex data at all. Each point is one instance of a 4-vertex strip, and the
//   vertex shader finds its lattice cell from gl_InstanceID, so a count change is
//   a uniform, never a reallocation (authoring rules §7).
// - Each point is a capsule from where it sits now back to where it sat STREAK
//   seconds ago (from the camera's own motion), anti-aliased over one pixel and
//   never thinner than 1.5 pixels across : a far point shrinks in brightness
//   instead of in size, so it never breaks into a shimmer.
// - Points are blended with MAX into a coverage map, then laid over the ground
//   in straight alpha. Overlaps never add up into a glow (the brief's line), and
//   a transparent ground lets the layers below through between the dots.
// - The lattice is infinite : the cells wrap around the camera, which can fly
//   forever (its position wraps at 4096 cells, where every per-point draw repeats,
//   so the wrap is seamless). The lattice's edge always fades out, so the wrap is
//   never seen; FOG fades it sooner.
// - IRREGULAR turns each point into an outline of its own (lib/blob.glsl : ink
//   drops, seeds, torn paper, slivers), dealt from its own random numbers and
//   held still on the screen while it streaks; EVOLVE morphs and tumbles them. At
//   0 the round capsule is drawn exactly as before.

import { EngineGL, SlotClock, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'
import { domeFill } from './domeSignal'
import BLOB_GLSL from '../shaders/isf/lib/blob.glsl?raw'

const VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform int uForm;            // 0 plane, 1 volume, 2 tunnel, 3 sphere, 4 torus, 5 galaxy
uniform int uN;               // cells per side (tunnel : rings along it; sphere, galaxy : points)
uniform int uNA, uNB;         // tunnel : points round a ring; torus : round the tube (A), round the ring (B)
uniform float uR0;            // tunnel : its radius; sphere, torus, galaxy : their radius
uniform float uDist, uExt;    // sphere, torus, galaxy : the camera's distance from the centre, their extent
uniform vec3 uCamW, uCamWP;   // and the camera there (world units), now and STREAK seconds ago
uniform float uRot, uRotP;    // their own turn (FLY), now and STREAK seconds ago
uniform float uStream, uStreamP; // the galaxy's stream along its arms (0..1), now and STREAK seconds ago
uniform vec3 uFace;           // the unit direction from their centre toward the camera
uniform float uReach01;       // REACH as set (0..1) : the new forms scale it their own way
uniform int uSquare;          // full-dome FILL : the view kept square, so round stays round on the dome
uniform float uS;             // cell size, world units
uniform vec3 uCam;            // camera position, in CELLS, wrapped at 4096
uniform vec3 uRight, uUp, uBack;          // camera basis now
uniform vec3 uRightP, uUpP, uBackP;       // and STREAK seconds ago
uniform vec3 uDelta;          // camera travel over the streak, world units
uniform float uF;             // focal length, frame heights
uniform vec2 uRes;            // target size, pixels
uniform float uDot;           // dot radius, world units
uniform float uVary, uJitter;
uniform vec3 uWell;           // the well / attractor, camera-relative world units
uniform float uWellAmt, uReach, uRipple, uRings, uRipplePh, uSwell, uSwellPh;
uniform float uAudio, uSide;
uniform float uFogStart, uEdge;
uniform int uHasAudio, uHasSide;
uniform sampler2D uAudioTex, uSideTex;
uniform float uBlobExt;       // IRREGULAR : how far an outline may reach, in radii (1 = round)
out vec2 vLocal;
out float vLen, vRad, vAmp;
flat out vec3 vSeed;          // the point's own three numbers, for its outline
flat out vec2 vDir;           // the streak's direction, to hold the outline still on screen
vec3 gSeed;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Value noise with a period of 512 of its own cells. It is read at the point's
// WRAPPED cell over 8, so one noise period is exactly the 4096-cell wrap : the
// swell runs on across the wrap in space and in time. §2 : floored, small inputs.
float vnoise(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, 512.0)), b = hash12(mod(i + vec2(1.0, 0.0), 512.0));
  float c = hash12(mod(i + vec2(0.0, 1.0), 512.0)), d = hash12(mod(i + vec2(1.0, 1.0), 512.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
// The cell nearest the camera among those congruent to k (one axis).
float cellNear(float k, float cam, float n) { return k - n * floor((k - cam) / n + 0.5); }

// Bands of the shared spectrum by distance from the well, bass at its heart.
float band(float x) {
  if (uHasAudio == 0 || uAudio < 0.001) return 0.0;
  int bi = int(clamp(x, 0.0, 1.0) * 127.0);
  return texelFetch(uAudioTex, ivec2(bi, 1), 0).r;
}

// Under full-dome FILL the dome spreads the frame's width and its height over the
// same circle, so a wide frame would draw a sphere as an oval : the view is kept
// square there (as wide as it is tall), and round stays round on the dome.
vec2 toPx(vec3 v) {
  float depth = max(-v.z, 1e-4);
  vec2 s = v.xy * uF / depth;                      // frame heights from the centre
  return (vec2(uSquare == 1 ? s.x : s.x * uRes.y / uRes.x, s.y) + 0.5) * uRes;
}

// PLANE and VOLUME : the infinite grid of cells wrapped round the camera.
void gridPoint(int k, out vec3 P, out vec3 Pp, out float amp, out float sizeK) {
  float n = float(uN);
  vec3 cell;
  if (uForm == 0) cell = vec3(float(k % uN), 0.0, float(k / uN));
  else cell = vec3(float(k % uN), float((k / uN) % uN), float(k / (uN * uN)));
  vec3 idx = vec3(cellNear(cell.x, uCam.x, n), uForm == 0 ? 0.0 : cellNear(cell.y, uCam.y, n), cellNear(cell.z, uCam.z, n));
  vec3 id = mod(idx, 4096.0);
  vec3 h = hash33(id + vec3(7.0, 13.0, 29.0));
  vec3 jit = (hash33(id.zxy + 101.0) - 0.5) * uJitter;
  if (uForm == 0) jit.y = 0.0;
  gSeed = hash33(id + vec3(53.0, 71.0, 97.0));

  // Camera-relative position, world units. The plane lies at the camera's height
  // below it (uCam.y holds that height for the plane).
  P = (idx - uCam + jit) * uS;
  if (uForm == 0) P.y = -uCam.y;
  vec3 flatP = P;

  // The point as it would sit undisplaced, for the sidechain's screen lookup :
  // the other layer is read where this point appears, so its picture is embossed
  // on the field as the camera sees it.
  float lum = 0.0;
  if (uHasSide == 1 && uSide > 0.001) {
    vec3 v0 = vec3(dot(P, uRight), dot(P, uUp), dot(P, uBack));
    if (-v0.z > 1e-3) {
      vec2 uv = clamp(toPx(v0) / uRes, 0.0, 1.0);
      vec4 s = textureLod(uSideTex, uv, 0.0);
      lum = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722)) * s.a;
    }
  }

  float R = uReach;
  sizeK = mix(1.0, 0.5 + 2.6 * pow(h.z, 4.0), uVary);
  amp = mix(1.0, 0.45 + 0.55 * h.y, uVary);
  if (uForm == 0) {
    float r = length(P.xz - uWell.xz);
    float y = -uWellAmt * 0.8 * R / (1.0 + (r * r) / (R * R));
    y += uRipple * 0.22 * R * sin(r * 6.2831853 * uRings / R - uRipplePh) * exp(-r / (R * 3.0));
    y += uSwell * 0.12 * R * vnoise(id.xz / 8.0 + vec2(uSwellPh, uSwellPh * 0.6));
    y += uAudio * 0.35 * R * band(r / (R * 4.0));
    y += uSide * 0.4 * R * lum;
    P.y += y;
  } else {
    vec3 d = P - uWell;
    float dl = max(length(d), 1e-4);
    vec3 dir = d / dl;
    float pull = uWellAmt * 1.6 * R * R * R / (dl * dl + R * R);
    P -= dir * min(pull, dl * 0.95);
    P += dir * uRipple * 0.3 * R * sin(dl * 6.2831853 * uRings / R - uRipplePh) * exp(-dl / (R * 3.0));
    P.y += uSwell * 0.25 * R * vnoise(id.xz / 8.0 + vec2(uSwellPh, uSwellPh * 0.6));
    P += dir * uAudio * 0.5 * R * band(dl / (R * 4.0));
    // In space there is no height to lift : the other layer lights the stars and
    // grows them where it is bright.
    amp *= mix(1.0, lum, uSide);
    sizeK *= mix(1.0, 0.4 + 1.2 * lum, uSide);
  }

  // The edge of the lattice always fades (the wrap must never show); FOG fades
  // it sooner. Measured on the flat lattice, so a deep well does not fade early.
  vec3 fq = abs(flatP - (uForm == 0 ? vec3(0.0, flatP.y, 0.0) : vec3(0.0)));
  float cheb = max(max(fq.x, fq.y), fq.z);
  float half_n = 0.5 * n * uS;
  amp *= 1.0 - smoothstep(uEdge * half_n, half_n, cheb);
  amp *= 1.0 - smoothstep(uFogStart * half_n, half_n, uForm == 0 ? length(flatP.xz) : length(flatP));
  Pp = P + uDelta;
}

// The sidechain's brightness where an undisplaced point (camera-relative)
// appears : the other layer is read where the camera sees the point.
float sideAt(vec3 P) {
  if (uHasSide == 0 || uSide < 0.001) return 0.0;
  vec3 v0 = vec3(dot(P, uRight), dot(P, uUp), dot(P, uBack));
  if (-v0.z <= 1e-3) return 0.0;
  vec2 uv = clamp(toPx(v0) / uRes, 0.0, 1.0);
  vec4 sd = textureLod(uSideTex, uv, 0.0);
  return dot(sd.rgb, vec3(0.2126, 0.7152, 0.0722)) * sd.a;
}
float wrapPi(float a) { return a - 6.2831853 * floor(a / 6.2831853 + 0.5); }
vec3 rotY(vec3 v, float a) { float c = cos(a), sn = sin(a); return vec3(c * v.x - sn * v.z, v.y, sn * v.x + c * v.z); }

// A galaxy's point at turn rot : two arms of a log spiral, crowding toward the
// core. The spiral turns as one (FLY) while every point streams out along its
// arm and comes back in at the core, faded at both ends (fade) : the arms stay
// arms however long it turns (a disc that sheared would wind them into rings).
// The stream is its own phase (wrapped at 1) : read off the turn, it jumped
// along the arms each time the turn wrapped.
vec3 galaxyPt(vec3 h3, vec3 h2, float rot, float along, out float r, out float fade) {
  float q0 = fract(h3.y + along);
  fade = smoothstep(0.0, 0.08, q0) * (1.0 - smoothstep(0.82, 1.0, q0));
  float q = 1.4 * (0.03 + 0.97 * pow(q0, 1.6));
  r = uR0 * q * (1.0 + (h2.z - 0.5) * 0.12);
  float arm = floor(h3.x * 2.0) * 3.14159265;
  float spread = (h2.x - 0.5) * (0.35 + uJitter * 1.4);
  float th = arm + 2.8 * log(1.0 + 4.0 * q) + spread + rot;
  return vec3(r * cos(th), (h2.y - 0.5) * uR0 * 0.04, r * sin(th));
}

// TUNNEL, SPHERE, TORUS, GALAXY : the same points on other shapes. The well,
// the ripple, the swell, the sound and the sidechain push each point along its
// shape's own outward direction.
void shapePoint(int k, out vec3 P, out vec3 Pp, out float amp, out float sizeK) {
  float fk = float(k);
  vec3 h = hash33(vec3(fk, 3.0, 7.0) + 11.0);
  vec3 h2 = hash33(vec3(7.0, fk, 3.0) + 23.0);
  gSeed = hash33(vec3(fk * 0.37, 43.0, 19.0));
  sizeK = mix(1.0, 0.5 + 2.6 * pow(h.z, 4.0), uVary);
  amp = mix(1.0, 0.45 + 0.55 * h.y, uVary);
  if (uForm == 2) {
    // TUNNEL : rings of points along the flight, the camera on the axis. The
    // rings wrap round it like the plane's cells, so the tunnel never ends.
    int nA = uNA;
    float nR = float(uN);
    float ia = float(k % nA), ir = float(k / nA);
    float zc = cellNear(ir, uCam.z, nR);
    float idz = mod(zc, 4096.0);
    vec3 jt = (hash33(vec3(ia, idz, 5.0)) - 0.5) * uJitter;
    gSeed = hash33(vec3(ia, idz, 61.0));
    // every other ring half a step round : the wall is woven, not ruled
    float th = (ia + 0.5 * mod(idz, 2.0) + jt.x) * 6.2831853 / float(nA);
    vec3 rad = vec3(cos(th), sin(th), 0.0);
    float z = (zc - uCam.z + jt.z) * uS; // along the tunnel, ahead is negative
    float R = uR0;
    vec3 B = rad * R + vec3(0.0, 0.0, z);
    float L = 4.0 + uReach01 * 40.0; // the reach, along the tunnel
    // a throat ahead (squared by hand : pow() of the negative base beyond it is undefined)
    float zw = (z + L) / (L * 0.5);
    float disp = -uWellAmt * 0.7 * R * exp(-zw * zw);
    disp += uRipple * 0.25 * R * sin(z * 6.2831853 * uRings / L + uRipplePh); // rings running along
    disp += uSwell * 0.3 * R * vnoise(vec2(cos(th) * 2.0 + idz / 8.0, sin(th) * 2.0) + vec2(uSwellPh, uSwellPh * 0.6));
    // the spectrum round the wall : bass at the floor, treble overhead
    disp += uAudio * 0.5 * R * band(abs(wrapPi(th + 1.5707963)) / 3.14159265);
    disp -= uSide * 0.5 * R * sideAt(B); // the other layer stands in from the wall
    disp = max(disp, -0.95 * R);
    P = B + rad * disp;
    Pp = P + uDelta;
    // the far ends fade (the wrap must never show); FOG fades them sooner
    float hn = 0.5 * nR * uS;
    amp *= 1.0 - smoothstep(uEdge * hn, hn, abs(z));
    amp *= 1.0 - smoothstep(uFogStart * hn, hn, abs(z));
    return;
  }
  if (uForm == 3) {
    // SPHERE : points spread evenly over a globe (a Fibonacci lattice), FLY turning it.
    float N = float(uN);
    float y = 1.0 - 2.0 * (fk + 0.5) / N;
    float rr = sqrt(max(0.0, 1.0 - y * y));
    float th = mod(fk * 2.39996323, 6.2831853);
    vec3 l = normalize(vec3(rr * cos(th), y, rr * sin(th)) + (h2 - 0.5) * uJitter * 0.35);
    vec3 nrm = rotY(l, uRot);
    float ang = acos(clamp(dot(nrm, uFace), -1.0, 1.0)); // 0 facing the camera, pi behind
    float RA = 0.15 + uReach01 * 1.6; // the reach, an angle
    float R = uR0;
    float disp = -uWellAmt * 0.6 * R * exp(-(ang * ang) / (RA * RA)); // a dent where it faces you
    disp += uRipple * 0.12 * R * sin(ang * 6.2831853 * uRings / (RA * 2.0) - uRipplePh) * exp(-ang / (RA * 3.0));
    disp += uSwell * 0.15 * R * (vnoise(nrm.xy * 2.5 + uSwellPh) + 0.5 * vnoise(nrm.yz * 2.5 - uSwellPh * 0.7));
    disp += uAudio * 0.35 * R * band(ang / 3.14159265);
    disp += uSide * 0.35 * R * sideAt(nrm * R - uCamW);
    disp = max(disp, -0.9 * R);
    P = nrm * (R + disp) - uCamW;
    Pp = rotY(l, uRotP) * (R + disp) - uCamWP;
  } else if (uForm == 4) {
    // TORUS : a ring of points, FLY rolling them round the tube, through itself.
    int nV = uNA, nU = uNB;
    float iu = float(k % nU), iv = float(k / nU);
    float R = uR0, r = uR0 * 0.4;
    float u = (iu + (h2.x - 0.5) * uJitter) * 6.2831853 / float(nU);
    float vb = (iv + 0.5 * mod(iu, 2.0) + (h2.y - 0.5) * uJitter) * 6.2831853 / float(nV);
    vec3 c = vec3(cos(u), 0.0, sin(u));
    vec3 nrm = cos(vb + uRot) * c + vec3(0.0, sin(vb + uRot), 0.0);
    float du = wrapPi(u - atan(uFace.z, uFace.x)); // round the ring from the side facing you
    float RA = 0.2 + uReach01 * 2.6;
    float disp = -uWellAmt * 0.8 * r * exp(-(du * du) / (RA * RA)); // the tube pinches there
    disp += uRipple * 0.3 * r * sin(abs(du) * 6.2831853 * uRings / (RA * 2.0) - uRipplePh);
    disp += uSwell * 0.4 * r * vnoise(vec2(cos(u) * 3.0 + cos(vb), sin(u) * 3.0 + sin(vb)) + uSwellPh);
    disp += uAudio * 0.6 * r * band(abs(du) / 3.14159265);
    disp += uSide * 0.6 * r * sideAt(c * R + nrm * r - uCamW);
    disp = max(disp, -0.9 * r);
    P = c * R + nrm * (r + disp) - uCamW;
    vec3 nrmP = cos(vb + uRotP) * c + vec3(0.0, sin(vb + uRotP), 0.0);
    Pp = c * R + nrmP * (r + disp) - uCamWP;
  } else {
    // GALAXY : a spiral disc; the well is its bulge, the ripple a density wave.
    vec3 h3 = hash33(vec3(fk, 17.0, 5.0) + 41.0);
    float rr, fd;
    vec3 g = galaxyPt(h3, h2, uRot, uStream, rr, fd);
    float R = uR0;
    float RR = R * (0.15 + uReach01 * 1.2); // the reach, a radius
    vec3 gp = vec3(0.0);
    bool bulge = h3.z < uWellAmt * 0.3;
    if (bulge) {
      // the bulge : a share of the points (WELL) leave the arms for a soft,
      // flattened ball at the core, crowding toward its heart
      vec3 hb = hash33(vec3(fk, 29.0, 13.0) + 7.0);
      float cz = hb.x * 2.0 - 1.0, ph = hb.y * 6.2831853;
      vec3 dir = vec3(sqrt(max(0.0, 1.0 - cz * cz)) * cos(ph), cz * 0.55, sqrt(max(0.0, 1.0 - cz * cz)) * sin(ph));
      vec3 b = dir * RR * pow(hb.z, 1.4);
      g = rotY(b, uRot);
      gp = rotY(b, uRotP);
      rr = length(b.xz);
      fd = 1.0;
    }
    amp *= fd;
    float y = 0.0;
    y += uRipple * 0.12 * R * sin(rr * 6.2831853 * uRings / (RR * 2.0) - uRipplePh) * exp(-rr / (RR * 3.0));
    y += uSwell * 0.12 * R * vnoise(g.xz / R * 2.0 + uSwellPh);
    y += uAudio * 0.3 * R * band(rr / (R * 1.4));
    y += uSide * 0.3 * R * sideAt(g - uCamW);
    P = g + vec3(0.0, y, 0.0) - uCamW;
    float rp, fp;
    Pp = (bulge ? gp : galaxyPt(h3, h2, uRotP, uStreamP, rp, fp)) + vec3(0.0, y, 0.0) - uCamWP;
  }
  // FOG : the far side dims, toward the back of the shape
  float depth = -dot(P, uBack);
  amp *= 1.0 - (1.0 - uFogStart) * 0.95 * clamp((depth - (uDist - uExt)) / (2.0 * uExt), 0.0, 1.0);
}

void main() {
  vec3 P, Pp;
  float amp, sizeK;
  if (uForm >= 2) shapePoint(gl_InstanceID, P, Pp, amp, sizeK);
  else gridPoint(gl_InstanceID, P, Pp, amp, sizeK);

  vec3 v = vec3(dot(P, uRight), dot(P, uUp), dot(P, uBack));
  float depth = -v.z;
  if (depth < 0.05 || amp < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 vp = vec3(dot(Pp, uRightP), dot(Pp, uUpP), dot(Pp, uBackP));
  vec2 pc = toPx(v);
  vec2 pp = -vp.z > 0.05 ? toPx(vp) : pc;

  // Radius in pixels, floored at 0.75 (1.5 across) : below that the dot keeps
  // its size and loses brightness by the area it lost.
  float rPx = uDot * sizeK * uF / depth * uRes.y;
  // ...and capped near the lens : a point passing the camera swelled into a soft
  // ball filling a sixth of the frame (seen in the starfield). Points stay points.
  rPx = min(rPx, uRes.y * 0.018 * sizeK);
  if (rPx < 0.75) { amp *= (rPx / 0.75) * (rPx / 0.75); rPx = 0.75; }
  // A streak longer than a sixth of the frame is cut there : a point sweeping
  // past the lens would otherwise draw one quad across the whole screen.
  vec2 seg = pc - pp;
  float L = length(seg);
  float Lmax = uRes.y / 6.0;
  if (L > Lmax) { pp = pc - seg / L * Lmax; L = Lmax; }
  vec2 dir2 = L > 0.01 ? (pc - pp) / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir2.y, dir2.x);
  int vid = gl_VertexID;
  // the quad holds the outline's whole reach (exactly the round dot's at 1)
  float ex = rPx * uBlobExt;
  float a = (vid & 1) == 0 ? -ex - 1.0 : L + ex + 1.0;
  float b = (vid & 2) == 0 ? -ex - 1.0 : ex + 1.0;
  vSeed = gSeed;
  vDir = dir2;
  vec2 px = pp + dir2 * a + nrm * b;
  vLocal = vec2(a, b);
  vLen = L;
  vRad = rPx;
  vAmp = amp;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
}`

const DOT_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vLen, vRad, vAmp;
flat in vec3 vSeed;
flat in vec2 vDir;
uniform float uIrr, uEvolve;  // IRREGULAR, and the EVOLVE phase (wrapped at BLOB_WRAP)
uniform float uBlobExt;       // how far an outline may reach, in radii
out vec4 o;
${BLOB_GLSL}
void main() {
  float ca = clamp(vLocal.x, 0.0, vLen);
  vec2 lv = vec2(vLocal.x - ca, vLocal.y);
  float cov;
  if (uIrr > 0.0) {
    // its own outline, swept along the streak and turned back to the screen's
    // frame, so the shape holds still whichever way the point streaks. Past its
    // reach (the quad's corners) nothing to draw : most outlines stay well
    // inside it (half within 1.44 radii at irregular 1, the reach is 2.6).
    cov = 0.0;
    if (dot(lv, lv) < vRad * vRad * uBlobExt * uBlobExt + 2.0 * vRad * uBlobExt + 1.0) {
      vec2 scr = lv.x * vDir + lv.y * vec2(-vDir.y, vDir.x);
      vec2 bs = blobShape(scr / vRad, vSeed, uIrr, uEvolve, vRad);
      cov = clamp(0.5 - bs.x * vRad, 0.0, 1.0);
    }
  } else {
    float d = length(lv);
    cov = clamp(vRad - d + 0.5, 0.0, 1.0);
  }
  // A streak fades toward its tail, the way a long exposure does.
  float tail = vLen > vRad ? mix(0.25, 1.0, ca / max(vLen, 1e-4)) : 1.0;
  float v = cov * vAmp * tail;
  o = vec4(v);
}`

const SHOW_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uCov;
uniform vec3 uInk;
uniform vec4 uGround;
out vec4 o;
void main() {
  float c = texelFetch(uCov, ivec2(gl_FragCoord.xy), 0).r;
  // Straight alpha : the dots over the ground, divided back out by the alpha so a
  // transparent ground gets no dark fringe around each dot.
  float a = c + uGround.a * (1.0 - c);
  vec3 rgb = (uInk * c + uGround.rgb * uGround.a * (1.0 - c)) / max(a, 1e-4);
  o = vec4(rgb, a);
}`

const WRAP = 4096
const MAX_LEAN = 1.3963 // 80 degrees : straight down or up the basis degenerates
const EXTENT = 64 // the lattice's side in world units, whatever the count
const SHAPE_R = 12 // the sphere's, the torus's and the galaxy's radius, world units
// lib/blob.glsl's BLOB_WRAP (32 pi) and BLOB_REACH : the EVOLVE phase wraps there,
// and an outline reaches 1 + BLOB_REACH x IRREGULAR radii at most.
const BLOB_WRAP = 32 * Math.PI
const BLOB_REACH = 1.6

type V3 = [number, number, number]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const wrapC = (x: number): number => ((x % WRAP) + WRAP) % WRAP

/** The camera basis for a heading and a downward lean : right, up, back. */
function basis(yaw: number, down: number): { f: V3; r: V3; u: V3; b: V3 } {
  const f: V3 = [Math.cos(down) * Math.sin(yaw), -Math.sin(down), -Math.cos(down) * Math.cos(yaw)]
  const r = norm(cross(f, [0, 1, 0]))
  const u = cross(r, f)
  return { f, r, u, b: [-f[0], -f[1], -f[2]] }
}

export class LatticeSource implements NativeGenerator {
  private g: EngineGL
  private dots: Prog
  private show: Prog
  private cov: Target | null = null
  private clock = new SlotClock()
  private inputs: Record<string, number | number[]> = {}
  // The camera, in CELLS (so a wrap at 4096 cells is seamless), the heading it
  // has turned through, and the travelling phases of the ripples and the swell.
  private cam: V3 = [Math.random() * WRAP, 0, Math.random() * WRAP]
  private yaw = 0
  private ripplePh = Math.random() * Math.PI * 2
  private rot = 0 // the sphere's, torus's, galaxy's own turn (FLY), radians
  private stream = 0 // the galaxy's points streaming along their arms, 0..1
  // The swell's phase wraps at 5120 : a whole number of noise periods (512) for
  // every rate it is read at (x 0.6 : 3072, x 0.7 : 3584), so no wrap re-deals it.
  private swellPh = Math.random() * 5120
  // EVOLVE's phase : the outlines morph and tumble on it (wraps seamlessly).
  private evolvePh = Math.random() * BLOB_WRAP
  private cellS = 0
  private audioTex: WebGLTexture | null = null
  private sideTex: WebGLTexture | null = null
  private blankTex: WebGLTexture | null = null

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    this.g = new EngineGL(gl, 'lattice')
    this.dots = this.g.prog(DOT_FS, VS)
    this.show = this.g.prog(SHOW_FS)
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
  }

  private blank(): WebGLTexture {
    if (this.blankTex) return this.blankTex
    const gl = this.g.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false) // §7 : set on every upload
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.blankTex = t
    return t
  }

  feed(audio: WebGLTexture | null, side: WebGLTexture | null): void {
    this.audioTex = audio
    this.sideTex = side
  }

  render(targetFbo: WebGLFramebuffer, clockSec: number): void {
    const g = this.g
    const gl = g.gl
    if (!g.ok) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return
    }
    if (!this.cov) this.cov = g.target(this.w, this.h, { float: false })
    const I = this.inputs
    const dt = this.clock.tick(clockSec)
    const form = Math.max(0, Math.min(5, Math.round(num(I, 'form', 0))))
    const shape = form >= 3 // sphere, torus, galaxy : a thing the camera circles
    const count = Math.max(16, Math.min(256, num(I, 'count', 200)))
    // How many points, per form (each a uniform, never a reallocation) :
    // plane count², volume (count/5)³ (200 -> 64 000), tunnel count rings of
    // count/2, sphere and galaxy about count²/4, torus (count/2) x (count/5).
    const n =
      form === 0 || form === 2 ? Math.round(count)
        : form === 1 ? Math.max(6, Math.min(56, Math.round(count / 5)))
          : Math.max(64, Math.min(16384, Math.round((count * count) / (form === 5 ? 3.3 : 4))))
    const nA = form === 2 ? Math.max(12, Math.min(128, Math.round(count / 2))) : Math.max(8, Math.min(64, Math.round(count / 5)))
    const nB = Math.max(16, Math.min(128, Math.round(count / 2)))
    const instances = form === 0 ? n * n : form === 1 ? n * n * n : form === 2 ? n * nA : form === 4 ? nA * nB : n
    // a tunnel is two and a half lattices long : its far end is a small hole
    const s = form === 2 ? (EXTENT * 2.5) / n : EXTENT / (form === 1 || form === 0 ? n : 200)
    // A count change keeps the camera where it is in the world : the cells are
    // re-dealt, the scene does not jump.
    if (this.cellS > 0 && Math.abs(this.cellS - s) > 1e-9) {
      this.cam = [wrapC((this.cam[0] * this.cellS) / s), wrapC((this.cam[1] * this.cellS) / s), wrapC((this.cam[2] * this.cellS) / s)]
    }
    this.cellS = s

    const down = Math.max(-1, Math.min(1, num(I, 'tilt', 0.45))) * MAX_LEAN
    const spin = num(I, 'spin', 0) * 0.5 // radians per second
    this.yaw = (this.yaw + spin * dt) % (Math.PI * 2)
    const yaw = num(I, 'turn', 0) * Math.PI + this.yaw
    const B = basis(yaw, down)
    // FLY : forward along the heading (level, over a plane) or along the view (in
    // a volume), in world units per second.
    const fly = num(I, 'fly', 0.15) * 6
    // a tunnel is flown along its axis whatever the view; a shape turns instead
    const vel: V3 =
      form === 0 ? (norm([B.f[0], 0, B.f[2]]).map((x) => x * fly) as V3)
        : form === 2 ? [0, 0, -fly]
          : shape ? [0, 0, 0]
            : (B.f.map((x) => x * fly) as V3)
    this.cam[0] = wrapC(this.cam[0] + (vel[0] * dt) / s)
    this.cam[2] = wrapC(this.cam[2] + (vel[2] * dt) / s)
    if (form === 1) this.cam[1] = wrapC(this.cam[1] + (vel[1] * dt) / s)
    const height = Math.max(0.3, num(I, 'height', 10))
    // The shapes' own turn : FLY spins the globe, rolls the torus, wheels the galaxy.
    const turnRate = num(I, 'fly', 0.15) * 1.2 // radians per second at full
    if (shape) {
      this.rot = (this.rot + turnRate * dt) % (Math.PI * 200)
      this.stream = (this.stream + turnRate * 0.04 * dt) % 1
    }

    const irr = Math.max(0, Math.min(1, num(I, 'irregular', 0)))
    const evolve = Math.max(0, Math.min(1, num(I, 'evolve', 0.25)))
    this.evolvePh = (this.evolvePh + evolve * dt) % BLOB_WRAP

    const pace = num(I, 'pace', 0.3)
    this.ripplePh = (this.ripplePh + pace * 2 * Math.PI * dt) % (Math.PI * 2)
    this.swellPh = (this.swellPh + pace * 0.6 * dt) % 5120

    const lens = Math.max(0, Math.min(1, num(I, 'lens', 0.6)))
    const f = 0.6 * Math.pow(10, 1 - lens)
    const reach = 1 + 19 * Math.max(0, Math.min(1, num(I, 'reach', 0.3)))
    // The well sits where the camera looks : on the plane, the point the view
    // meets (capped inside the lattice); in a volume, ahead along the view.
    let well: V3
    if (form === 0) {
      const d = Math.min(EXTENT * 0.3, height / Math.tan(Math.max(0.08, down)))
      const fh = norm([B.f[0], 0, B.f[2]])
      well = [fh[0] * d, 0, fh[2] * d]
    } else {
      const d = reach * 2.5 + 2
      well = [B.f[0] * d, B.f[1] * d, B.f[2] * d]
    }
    // STREAK : the camera STREAK seconds ago, from its present motion.
    const streakSec = Math.max(0, Math.min(1, num(I, 'streak', 0))) * 0.5
    const Bp = basis(yaw - spin * streakSec, down)
    const delta: V3 = [vel[0] * streakSec, vel[1] * streakSec, vel[2] * streakSec]
    // A shape sits at the world's centre and the camera circles it : TILT and
    // TURN place it round the shape, HEIGHT is its distance (low : inside),
    // SPIN carries it round. A tunnel's radius is HEIGHT.
    // On the full dome (fill) the frame is stretched over the whole dome, its
    // edges bent down to the rim : a shape that filled the frame wrapped the
    // dome. There it stands back, to sit in the middle, overhead, kept round.
    const fill = domeFill() > 0
    const dist = SHAPE_R * (0.6 + height * 0.27) * (fill && shape ? 1.8 : 1)
    const camW: V3 = [-B.f[0] * dist, -B.f[1] * dist, -B.f[2] * dist]
    const camWP: V3 = [-Bp.f[0] * dist, -Bp.f[1] * dist, -Bp.f[2] * dist]
    // each shape about the sphere's size in the frame
    const r0 = form === 4 ? SHAPE_R * 0.75 : form === 5 ? SHAPE_R * 0.8 : SHAPE_R
    const ext = form === 4 ? r0 * 1.4 : form === 5 ? r0 * 1.4 : r0

    const fog = Math.max(0, Math.min(1, num(I, 'fog', 0.35)))
    const size = Math.max(0, num(I, 'size', 0.35))
    // Dot radius in world units : on the plane a share of the cell (size 1, the
    // dots touch), in a volume a much smaller one (stars, not balls); on a shape,
    // a share of the spacing between its points.
    const spacing =
      form === 3 ? SHAPE_R * Math.sqrt((4 * Math.PI) / n)
        : form === 4 ? (2 * Math.PI * SHAPE_R * 0.75 * 0.4) / nA
          : form === 5 ? SHAPE_R * 0.8 * 1.4 * Math.sqrt(Math.PI / n) * 1.6
            : s
    const dotR = size * (form === 1 ? 0.08 : 0.5) * spacing

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cov.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const hasAudio = this.audioTex && num(I, 'audio', 0) > 0.001 ? 1 : 0
    const hasSide = this.sideTex && num(I, 'side', 0) > 0.001 ? 1 : 0
    this.dots.use()
      .i1('uForm', form).i1('uN', n).f1('uS', s)
      .i1('uNA', nA).i1('uNB', nB)
      .f1('uR0', form === 2 ? height : r0).f1('uDist', dist).f1('uExt', ext)
      .f3('uCamW', ...camW).f3('uCamWP', ...camWP)
      .f1('uRot', this.rot).f1('uRotP', this.rot - turnRate * streakSec)
      .f1('uStream', this.stream).f1('uStreamP', this.stream - turnRate * 0.04 * streakSec)
      .f3('uFace', -B.f[0], -B.f[1], -B.f[2])
      .f3('uCam', this.cam[0], form === 0 ? height : this.cam[1], this.cam[2])
      .f3('uRight', ...B.r).f3('uUp', ...B.u).f3('uBack', ...B.b)
      .f3('uRightP', ...Bp.r).f3('uUpP', ...Bp.u).f3('uBackP', ...Bp.b)
      .f3('uDelta', ...delta)
      .f1('uF', f).f2('uRes', this.w, this.h)
      .f1('uDot', dotR)
      .f1('uVary', Math.max(0, Math.min(1, num(I, 'vary', 0.2))))
      .f1('uJitter', Math.max(0, Math.min(1, num(I, 'jitter', 0))))
      .f3('uWell', ...well)
      .f1('uWellAmt', Math.max(0, num(I, 'well', 0.5))).f1('uReach', reach)
      .f1('uReach01', Math.max(0, Math.min(1, num(I, 'reach', 0.3))))
      .i1('uSquare', fill ? 1 : 0)
      .f1('uRipple', Math.max(0, num(I, 'ripple', 0.3))).f1('uRings', Math.max(0.25, num(I, 'rings', 3)))
      .f1('uRipplePh', this.ripplePh)
      .f1('uSwell', Math.max(0, num(I, 'swell', 0))).f1('uSwellPh', this.swellPh)
      .f1('uAudio', Math.max(0, num(I, 'audio', 0))).f1('uSide', Math.max(0, Math.min(1, num(I, 'side', 0))))
      // never 1 : smoothstep with equal edges is undefined (§3)
      .f1('uFogStart', 0.98 - 0.9 * fog).f1('uEdge', 0.8)
      .i1('uHasAudio', hasAudio).i1('uHasSide', hasSide)
      .f1('uBlobExt', 1 + BLOB_REACH * irr).f1('uIrr', irr).f1('uEvolve', this.evolvePh)
      .i1('uAudioTex', 0).i1('uSideTex', 1)
    // A unit the program samples must hold a texture even when the branch that
    // reads it is off, or WebGL warns on every draw : the 1x1 blank stands in.
    g.bind(0, hasAudio ? this.audioTex : this.blank())
    g.bind(1, hasSide ? this.sideTex : this.blank())
    gl.bindVertexArray(g.pointVao)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.MAX)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances)
    gl.disable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.bindVertexArray(null)

    const [ir, ig, ib] = col(I, 'ink', [0.92, 0.94, 0.95])
    const gv = I.ground
    const ground = Array.isArray(gv) && gv.length >= 4 ? gv : [0.02, 0.02, 0.025, 1]
    this.show.use().i1('uCov', 0).f3('uInk', ir, ig, ib).f4('uGround', ground[0], ground[1], ground[2], ground[3])
    g.bind(0, this.cov.tex)
    g.bind(1, null)
    g.draw(targetFbo, this.w, this.h)
    g.done(2)
  }

  dispose(): void {
    this.g.freeTarget(this.cov)
    this.cov = null
    if (this.blankTex) this.g.gl.deleteTexture(this.blankTex)
    this.blankTex = null
    this.g.dispose()
  }
}
