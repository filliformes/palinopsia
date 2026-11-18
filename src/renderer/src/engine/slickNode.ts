// Slick (the native node 'node-slick') : crude oil spreading over the picture. Whatever
// plays (a forest film, a dancer, a sky) is slowly covered by a black, heavy, viscous
// slick that smothers what it touches, with the petrol rainbow only at its thin edges,
// where real slicks show it.
//
// The oil is a THICKNESS FIELD of its own (32-bit, ping-pong) on a grid tied to the
// frame's height (200 to 320 rows, so the slick keeps its size and pace at 1080p, 4K
// and on the 2048² dome composition), stepped on a fixed 60 Hz clock :
// - it SPREADS as a viscous film : the flux between two cells grows with the square of
//   the oil's depth there (the lubrication form of the thin-film equation : thick oil
//   runs, a thin film hardly moves), so the front stays steep, patches merge, and crude
//   thinner than its resting depth stops spreading (it settles into a slick);
// - a SHEEN runs out a little way ahead of the crude (a thin film of its own, spreading
//   plainly and thinning away beyond the crude) : the rainbow edge;
// - FINGERS : the oil's mobility varies from place to place by a slow noise, so lobes
//   and fingers run ahead at the front and it is never a perfect circle;
// - it is carried a little by a slow CURRENT (a curl noise) and, if asked, by the
//   picture's own MOTION (its optical flow, pictureFlow.ts);
// - DRIPS : thick oil runs downward in streaks (on the dome, outward toward the rim,
//   the radial-gravity convention), the thin stays;
// - COVERAGE and the TIDE draw the slick toward a share of the picture or in from an
//   edge : where they want oil, oil already there thickens and so creeps on (a front
//   that travels at its own pace), where they no longer want it, the oil they brought
//   ebbs (a third channel keeps the share they brought, so spills stay);
// - RECEDE evaporates it, the thin film first (the rainbow edge pulls back), and leaves
//   a STAIN behind; CLEAN wipes everything in a short fade.
//
// Where it comes from : a click on the preview (a spill; held : pouring; dragged : a
// trail), a Body pinch the same, `/opsia/touch` over OSC, the SPILL trigger (MIDI, OSC,
// Body rules), the beat (the shared beat clock, so Ableton Link's bars), the sound's
// onsets, and SEEP (it wells up by itself now and then).
//
// How it looks (drawn at the picture's full size) : by thickness, in the order the
// oil-appearance code used to survey slicks from the air describes : at the very edge a
// silvery sheen, then the rainbow (thin-film interference, the same maths as Thin Film,
// engine/reliefShade.ts), then a dark metallic film, brown patches of the true color,
// and the continuous crude : near-black, a deep wet specular gloss lit from the light
// you set, the picture under it reading only as relief (its brightness as bumps in the
// oil). The grid's field is read through a small wobble at full size, so the edge is
// organic at any size. On the dome the oil lies on the dome's disc (the zenith in the
// middle, round all the way down) and the rim is its wall.
//
// third-party: Thin-film lubrication equation (the method : a viscous film's flux grows
// with its depth, here squared, so its front stays steep)
// third-party: Oil slick spreading (the idea : a slick spreads, thins and stops, thick
// in the middle, a sheen at the edge)
// third-party: Oil appearance code (the thickness-to-look order : sheen, rainbow,
// metallic, true color)
// Written for Palinopsia from the published methods alone : no code taken.

import type { ConvNode, NodeContext } from './convNodes'
import type { SourcePointer } from './nativeGenerators'
import { EngineGL, FS_HEAD, Edge, num, col, type Prog, type Target } from './organicGL'
import { PictureFlow } from './pictureFlow'
import { glGeneration } from './glGeneration'
import { domeFill } from './domeSignal'
import { TouchPoints, Onset, touchBus, toField, firePlace, randomField } from './touchInput'
import { fieldSize } from './touchNode'
import { soniBar, soniBeats } from '../audio/soniClock'
import { RELIEF_SHADE } from './reliefShade'
import DOME_GLSL from '../shaders/isf/lib/dome.glsl?raw'

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)

const MAX_SPILLS = 16
const MAX_POURS = 8
const STEP = 1 / 60
const MAX_STEPS = 3
const MAX_SUB = 24
/** SPILL ON : off, every 1 or 2 beats, 1, 2 or 4 bars (negative : bars, Link's while it is on) */
const SPILL_BEATS = [0, 1, 2, -1, -2, -4]
/** The thickness the drive (coverage, tide) brings the oil to, and where the flux stops growing */
const H0 = 1.2
const CAP = 1.5
/** Crude thinner than this no longer spreads : it settles into a slick */
const REST = 0.42
/** The sheen's depth over the crude (it thins out from there ahead of it) */
const SHEEN = 0.12

// ── Shared GLSL : the field (flat : the frame in frame heights; dome : the disc) ──
const HEAD = `${FS_HEAD}
${DOME_GLSL}
in vec2 vUV;
uniform float uDome, uAsp;
uniform ivec2 uSize;
vec2 fOfTex(vec2 q) { return uDome > 0.5 ? q - 0.5 : vec2((q.x - 0.5) * uAsp, q.y - 0.5); }
vec2 texOfF(vec2 f) { return uDome > 0.5 ? f + 0.5 : vec2(f.x / uAsp + 0.5, f.y + 0.5); }
vec2 toF(vec2 uv) { return uDome > 0.5 ? domeDisc(uv) * 0.5 : vec2((uv.x - 0.5) * uAsp, uv.y - 0.5); }
vec2 fromF(vec2 f) { return uDome > 0.5 ? domeFrame(f * 2.0) : vec2(f.x / uAsp + 0.5, f.y + 0.5); }
// a cell of the field (on the dome : inside the disc)
bool wet(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= uSize.x || c.y >= uSize.y) return false;
  if (uDome < 0.5) return true;
  vec2 q = (vec2(c) + 0.5) / vec2(uSize);
  return length(q - 0.5) <= 0.5;
}
vec2 fOfCell(ivec2 c) { return fOfTex((vec2(c) + 0.5) / vec2(uSize)); }
`

// Once a frame : what the field asks of each cell. R : how freely the oil runs here
// (the fingers), GB : where the current and the picture's motion carry it (cells a
// step), A : how much the drive wants oil here (0..1), plus 2 where it may start from
// nothing (a seed).
const FIELD_FS = `${HEAD}
uniform sampler2D uFlow;
uniform float uFing, uT, uCur, uMotion, uCov, uTide, uMotionK;
uniform int uTideFrom, uHasFlow;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (!wet(c)) { o = vec4(1.0, 0.0, 0.0, 0.0); return; }
  vec2 f = fOfCell(c);
  // the fingers : the oil's mobility, high and low in patches a few cells across,
  // drifting slowly so the front keeps finding new ways
  // (a warped noise : the patches come out as swirls and tongues, not round blots)
  vec2 wq = f * 9.0 + vec2(uT * 0.015, -uT * 0.011);
  vec2 warp = vec2(og_vnoise(wq + 1.7), og_vnoise(wq + 8.3)) - 0.5;
  float nf = og_vnoise(f * 16.0 + warp * 3.0 + vec2(uT * 0.021, -uT * 0.017)) * 0.65 + og_vnoise(f * 41.0 + warp * 2.0 + vec2(-uT * 0.031, 7.3)) * 0.35;
  nf = clamp((nf - 0.5) * 1.6 + 0.5, 0.0, 1.0);
  float F = mix(1.0, 0.12 + 1.76 * nf, uFing);
  // the current : a slow curl noise
  vec3 n = og_noised(f * 1.7 + vec2(uT * 0.013, -uT * 0.009) + 4.0);
  vec2 v = vec2(n.z, -n.y) * 1.7 * uCur;
  // the picture's own motion (256-field texels a frame -> cells a step)
  if (uHasFlow == 1) {
    vec2 fl = texture(uFlow, fromF(f)).rg / 256.0;
    if (uDome < 0.5) fl.x *= uAsp;
    v += fl * float(uSize.y) * uMotionK * uMotion;
  }
  // the drive : coverage (a share of the picture, by a slow noise's rank) and the tide
  float want = 0.0, seed = 0.0;
  if (uCov > 0.0) {
    float r = (og_fbm(f * 2.2 + vec2(uT * 0.004, uT * 0.003) + 9.1, 4.0) - 0.5) / 0.32 + 0.5;
    float cv = uCov * 1.22 - 0.14;
    want = smoothstep(r - 0.05, r + 0.05, cv);
    if (r < cv * 0.1 - 0.02) seed = 1.0;
  }
  if (uTide > 0.0) {
    // how far in from the chosen edge, 0 at the edge to 1 at the far side (all round : the middle)
    float d;
    if (uDome > 0.5) {
      if (uTideFrom == 0) d = f.y + 0.5;
      else if (uTideFrom == 1) d = 0.5 - f.y;
      else if (uTideFrom == 2) d = f.x + 0.5;
      else if (uTideFrom == 3) d = 0.5 - f.x;
      else d = (0.5 - length(f)) * 2.0;
    } else {
      float hw = 0.5 * uAsp;
      if (uTideFrom == 0) d = f.y + 0.5;
      else if (uTideFrom == 1) d = 0.5 - f.y;
      else if (uTideFrom == 2) d = (f.x + hw) / uAsp;
      else if (uTideFrom == 3) d = (hw - f.x) / uAsp;
      else d = min(hw - abs(f.x), 0.5 - abs(f.y)) * 2.0;
    }
    // (the tide line itself wavers, so it comes in as lobes, never a ruled edge)
    float reach = uTide * 1.04 + (og_vnoise(f * 6.0 + vec2(uT * 0.01, 3.7)) - 0.5) * (0.06 + 0.12 * uFing);
    want = max(want, smoothstep(d - 0.025, d + 0.025, reach));
    if (d < 0.012) seed = 1.0;
  }
  o = vec4(F, v, want + 2.0 * seed);
}`

// One substep of the oil. R : the crude's thickness, G : the stain it leaves, B : the
// share the drive brought (spills keep theirs when the drive lets go), A : the thin
// film that runs out ahead of the crude (the sheen : it rises to its own small depth
// where there is crude, creeps out a little way and thins away beyond).
const SIM_FS = `${HEAD}
uniform sampler2D uS, uF;
uniform float uK, uKs, uFirst, uDtS, uDrip, uT, uGrow, uEbb, uDrive, uRec, uStainUp, uKeep;
uniform int uNS, uNP;
uniform vec4 uSpill[${MAX_SPILLS}]; // x y, radius, peak
uniform vec4 uPour[${MAX_POURS}];   // x y, radius, peak a second
out vec4 o;
float bump(float t) { return t < 1.0 ? 0.5 + 0.5 * cos(3.14159265 * t) : 0.0; }
vec4 at(ivec2 c) { return wet(c) ? texelFetch(uS, c, 0) : vec4(0.0); }
// the state between cells (by hand : 32-bit floats are read whole)
vec4 bilin(vec2 p) {
  vec2 q = p - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 w = q - vec2(i);
  return mix(mix(at(i), at(i + ivec2(1, 0)), w.x), mix(at(i + ivec2(0, 1)), at(i + ivec2(1, 1)), w.x), w.y);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (!wet(c)) { o = vec4(0.0); return; }
  vec4 s0 = texelFetch(uS, c, 0);
  vec4 fd = texelFetch(uF, c, 0);
  vec2 f = fOfCell(c);
  float h0 = s0.r, q0 = s0.b, sh0 = s0.a;
  float h = h0, q = q0, g = s0.g, sh = sh0;
  if (uFirst > 0.5) {
    // carried : the current, the picture's motion, and the thick oil running down in
    // streaks (on the dome, outward toward the rim)
    vec2 v = fd.gb;
    if (uDrip > 0.0) {
      vec2 dn = uDome > 0.5 ? (length(f) > 1e-4 ? f / length(f) : vec2(0.0)) : vec2(0.0, -1.0);
      vec2 across = uDome > 0.5 ? dn * 30.0 : vec2(f.x * 46.0, 0.0);
      float streak = smoothstep(0.45, 0.8, og_vnoise(across + vec2(0.0, f.y * 1.3 * (1.0 - uDome) + uT * 0.04)));
      v += dn * uDrip * smoothstep(${REST.toFixed(2)}, 1.1, h0) * (0.06 + 1.9 * streak);
    }
    if (dot(v, v) > 1e-10) {
      vec4 a = bilin(vec2(c) + 0.5 - v);
      h = a.r;
      q = a.b;
      sh = a.a;
    }
    // the spills of this step
    for (int i = 0; i < ${MAX_SPILLS}; i++) {
      if (i >= uNS) break;
      vec4 D = uSpill[i];
      h += D.w * bump(length(f - D.xy) / D.z);
    }
  }
  // it spreads : the flux to each neighbor grows with the square of the depth between
  // them, times how freely it runs there; crude thinner than its resting depth holds
  // still (it settles into a slick, it never runs out to nothing). The sheen spreads
  // on its own, plainly.
  float dh = 0.0, dq = 0.0, ds = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 nc = c + (k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : ivec2(0, -1));
    if (!wet(nc)) continue;
    vec4 sn = texelFetch(uS, nc, 0);
    float hm = min(0.5 * (h0 + sn.r), ${CAP.toFixed(2)});
    float fa = 0.5 * (fd.r + texelFetch(uF, nc, 0).r);
    // (where it runs freely it also rests thinner, so it reaches further there : lobes)
    float rest = ${REST.toFixed(3)} * clamp(1.0 - 0.7 * (fa - 1.0), 0.2, 1.7);
    float mob = hm * hm * fa * smoothstep(rest * 0.55, rest, max(h0, sn.r));
    dh += mob * (sn.r - h0);
    dq += mob * (sn.b - q0);
    ds += fa * (sn.a - sh0);
  }
  h += uK * dh;
  q += uK * dq;
  sh += uKs * ds;
  // pouring : a hand held down, the point pressed
  for (int i = 0; i < ${MAX_POURS}; i++) {
    if (i >= uNP) break;
    vec4 P = uPour[i];
    h += P.w * bump(length(f - P.xy) / P.z) * uDtS;
  }
  // the drive : where it wants oil, oil already there thickens (and so creeps on);
  // where it no longer does, what it brought ebbs
  if (uDrive > 0.5) {
    float seed = step(1.5, fd.a);
    float want = fd.a - 2.0 * seed;
    float gr = uGrow * want * (smoothstep(0.02, 0.15, h + sh) + 0.25 * seed) * max(0.0, ${H0.toFixed(2)} - h) * uDtS;
    h += gr;
    q += gr;
    float eb = min(q, uEbb * (1.0 - want) * (q + 0.05) * uDtS);
    h -= eb;
    q -= eb;
  }
  // receding : evaporating, the thin first; the stain stays longer
  if (uRec > 0.0) {
    float hn = max(0.0, h - uRec * (0.15 + h) * uDtS);
    q *= h > 1e-6 ? hn / h : 0.0;
    h = hn;
  }
  // the sheen : up to its own depth over the crude, thinning away beyond it
  float under = smoothstep(0.03, ${(REST * 0.6).toFixed(3)}, h);
  sh = max(sh, ${SHEEN.toFixed(3)} * under);
  sh -= sh * (1.0 - under) * (0.4 * clamp(2.1 - fd.r, 0.3, 2.0) + 3.0 * uRec) * uDtS;
  g = clamp(g + max(0.0, smoothstep(0.05, 0.4, h) - g) * uStainUp * uDtS - uRec * 0.02 * uDtS, 0.0, 1.0);
  // cleaning
  h *= uKeep;
  q *= uKeep;
  g *= uKeep;
  sh *= uKeep;
  h = max(h, 0.0);
  o = vec4(h, g, clamp(q, 0.0, h), clamp(sh, 0.0, ${SHEEN.toFixed(3)}));
}`

// For the eye, at the grid's size : the crude a little smoothed, the sheen, the stain
const LOOK_FS = `${HEAD}
uniform sampler2D uS;
out vec4 o;
vec4 S0;
vec4 sf(ivec2 c) { return wet(c) ? texelFetch(uS, c, 0) : S0; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (!wet(c)) { o = vec4(0.0); return; }
  S0 = texelFetch(uS, c, 0);
  vec4 a = sf(c + ivec2(-1, -1)) + sf(c + ivec2(1, -1)) + sf(c + ivec2(-1, 1)) + sf(c + ivec2(1, 1));
  vec4 b = sf(c + ivec2(0, -1)) + sf(c + ivec2(-1, 0)) + sf(c + ivec2(1, 0)) + sf(c + ivec2(0, 1));
  vec4 m = (4.0 * S0 + 2.0 * b + a) / 16.0;
  o = vec4(m.r, m.a, S0.g, 0.0);
}`

// The picture with the oil on it, at full size
const SHOW_FS = `${HEAD}
${RELIEF_SHADE}
uniform sampler2D uHost, uLook;
uniform float uThick, uOpac, uSheen, uGloss, uRelief, uStain, uMix, uT, uCellF, uAz;
uniform vec3 uCol, uL;
uniform vec2 uPx, uCellT;
out vec4 fragColor;
float lumA(vec2 uv) { vec4 c = texture(uHost, uv); return dot(c.rgb, vec3(0.299, 0.587, 0.114)) * c.a; }
void main() {
  vec4 dry = texture(uHost, vUV);
  vec2 f = toF(vUV);
  if (uDome > 0.5 && length(f) > 0.5) { fragColor = dry; return; }
  // the grid read through a small wobble : the edge stays organic at any size
  vec2 wob = vec2(og_vnoise(f * 90.0 + 3.1), og_vnoise(f * 90.0 + 17.7)) - 0.5;
  wob += 0.5 * (vec2(og_vnoise(f * 210.0 + 5.3), og_vnoise(f * 210.0 + 1.9)) - 0.5);
  vec2 tc = texOfF(f + wob * uCellF * 2.2);
  vec4 L = texture(uLook, tc);
  float h = max(L.r, 0.0);
  vec3 pic = dry.rgb;
  float lum = dot(pic, vec3(0.299, 0.587, 0.114));
  // the stain where oil was
  float st = uStain * L.b;
  if (st > 0.0) {
    vec3 soiled = mix(vec3(lum), pic, 0.55) * vec3(0.8, 0.71, 0.55) * 0.82 + vec3(0.012, 0.009, 0.004);
    pic = mix(pic, soiled, clamp(st, 0.0, 1.0) * 0.8);
  }
  // the crude, by how thick it reads : brown patches, then continuous near-black
  float hv = h * uThick;
  float mottle = (og_vnoise(f * 34.0 + 2.2) - 0.5) * 0.25 * smoothstep(0.2, 0.5, hv) * (1.0 - smoothstep(0.6, 1.0, hv));
  float crude = smoothstep(0.22, 0.5, hv + mottle);
  float metal = crude * (1.0 - smoothstep(0.35, 0.85, hv));
  // the film : the sheen ahead of the crude, and the oil itself where it does not read
  // as crude; its depth gives the color, in the order every slick shows from its edge
  // in : silvery, then the rainbow's orders, then a dark metallic film
  // (marbled : the film's depth swirls, so the orders run in streaks and eddies, never
  // in rings round the crude)
  vec2 mq = f * 11.0 + vec2(uT * 0.02, -uT * 0.015);
  vec2 mw = vec2(og_vnoise(mq + 3.3), og_vnoise(mq + 9.1)) - 0.5;
  float marb = og_vnoise(f * 26.0 + mw * 4.0 + vec2(-uT * 0.03, uT * 0.02));
  float film = max(L.g, (1.0 - crude) * min(h, 1.2) * 0.11) * (0.35 + 1.1 * marb);
  float silver = smoothstep(0.002, 0.012, film) * (1.0 - smoothstep(0.012, 0.03, film));
  float rainbow = smoothstep(0.01, 0.028, film);
  float dark = smoothstep(0.075, 0.13, film);
  float nm = 70.0 + 5200.0 * film;
  vec2 P = (vUV - 0.5) * vec2(uAsp, 1.0);
  float lean = 1.0 - 0.25 * min(1.0, dot(P, P) * 2.0);
  vec3 fc = filmColor(nm, lean, 1.45);
  // (the orders pale as the film thickens : lift their color back out of the grey)
  vec3 fv = clamp(mix(vec3(dot(fc, vec3(0.333))), fc, 1.0 + 0.6 * smoothstep(0.03, 0.1, film)), 0.0, 1.2);
  pic = mix(pic, pic * 0.82 + vec3(0.12, 0.125, 0.13), silver * uSheen * 0.7);
  vec3 sheen = pic * (0.32 + 1.05 * fv) + fv * fv * 0.14;
  sheen = mix(sheen, sheen * 0.35 + fv * 0.05, dark * 0.75);
  pic = mix(pic, sheen, rainbow * uSheen);
  vec4 res = vec4(pic * dry.a, dry.a);
  // a film over the empty part of a layer : the colors alone
  res += vec4(fv * fv * 0.3, 0.3) * rainbow * uSheen * (1.0 - dry.a);
  if (crude > 0.001) {
    // its surface : the oil's own rims, the picture beneath as bumps, a slow swell
    vec2 sl = vec2(texture(uLook, tc + vec2(uCellT.x, 0.0)).r - texture(uLook, tc - vec2(uCellT.x, 0.0)).r,
                   texture(uLook, tc + vec2(0.0, uCellT.y)).r - texture(uLook, tc - vec2(0.0, uCellT.y)).r) * uThick * 0.22;
    // (wide taps, as heavy oil smooths what it covers : no glitter on fine detail)
    float lx = lumA(vUV + vec2(uPx.x * 3.0, 0.0)) - lumA(vUV - vec2(uPx.x * 3.0, 0.0));
    float ly = lumA(vUV + vec2(0.0, uPx.y * 3.0)) - lumA(vUV - vec2(0.0, uPx.y * 3.0));
    float lx2 = lumA(vUV + vec2(uPx.x * 9.0, 0.0)) - lumA(vUV - vec2(uPx.x * 9.0, 0.0));
    float ly2 = lumA(vUV + vec2(0.0, uPx.y * 9.0)) - lumA(vUV - vec2(0.0, uPx.y * 9.0));
    sl += (vec2(lx, ly) * 0.5 + vec2(lx2, ly2) * 0.5) * uRelief * smoothstep(0.3, 0.8, hv);
    // a slow heavy swell, so the highlights glide over it
    vec3 sw = og_noised(f * 7.0 + vec2(uT * 0.05, uT * 0.035));
    vec3 sw2 = og_noised(f * 19.0 - vec2(uT * 0.04, uT * 0.06));
    sl += sw.yz * 0.055 + sw2.yz * 0.012;
    vec3 N = normalize(vec3(-sl, 1.0));
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 Hh = normalize(uL + V);
    float nl = max(0.0, dot(N, uL));
    float nh = max(0.0, dot(N, Hh));
    float nv = max(0.0, N.z);
    float fres = pow(1.0 - nv, 5.0);
    // thin crude is browner, thick is the crude's own near-black
    vec3 alb = mix(uCol * 2.8 + vec3(0.03, 0.017, 0.004), uCol, smoothstep(0.4, 0.95, hv));
    float g2 = uGloss * uGloss;
    float spec = pow(nh, 24.0 + 640.0 * g2) * (0.12 + 1.5 * uGloss);
    float broad = pow(nh, 5.0 + 26.0 * uGloss) * 0.06 * uGloss;
    // (what it reflects : the room the shared materials reflect, a little over oil's 4 %
    // at its face, so the wet reads)
    vec3 env = roomAt(reflect(-V, N), uAz, P, nv, 0.03) * (0.07 + 0.6 * fres + 0.22 * metal) * (0.25 + 0.95 * uGloss);
    // a dull rainbow in what it reflects, strongest where it is still a metallic film
    float nmI = 480.0 + 420.0 * og_vnoise(f * 5.0 + vec2(uT * 0.02, 1.0)) + hv * 260.0;
    vec3 iri = mix(vec3(1.0), 0.3 + 1.35 * filmColor(nmI, nv, 1.5), uSheen * (0.2 + 0.65 * metal));
    vec3 glo = (vec3(1.0, 0.98, 0.95) * (spec + broad) + env) * iri;
    vec3 body = alb * (0.06 + 0.7 * nl);
    // opaque : the picture only as relief; less : seen through the oil, browned
    vec3 through = pic * normalize(alb + 1e-4) * 0.75;
    vec4 cr = vec4(body * uOpac + glo, uOpac) + vec4(through * dry.a, dry.a) * (1.0 - uOpac);
    res = mix(res, cr, crude);
  }
  vec4 dpm = vec4(dry.rgb * dry.a, dry.a);
  vec4 mx = mix(dpm, res, uMix);
  mx.a = clamp(mx.a, 0.0, 1.0);
  fragColor = vec4(mx.a > 1e-5 ? clamp(mx.rgb / mx.a, 0.0, 1.0) : dry.rgb, mx.a);
}`

export class SlickNode implements ConvNode {
  private gen = glGeneration()
  private g: EngineGL | null = null
  private fieldP: Prog | null = null
  private simP: Prog | null = null
  private lookP: Prog | null = null
  private showP: Prog | null = null
  private flow: PictureFlow | null = null
  private S: [Target, Target] | null = null
  private F: Target | null = null
  private look: Target | null = null
  private cur = 0
  private key = ''
  private acc = 0
  private t = Math.random() * 400
  private seepAcc = 0
  private firstSeep = 0.8
  private cleaning = 0
  private lastFrame = -1
  private disposed = false
  // where the oil comes from
  private pts = new TouchPoints()
  private onset = new Onset()
  private spills: number[][] = []
  private spillE = new Edge()
  private cleanE = new Edge()
  private lastBeat = NaN
  private lastOn = -1
  private busSeq = -1
  private aS = new Float32Array(MAX_SPILLS * 4)
  private aP = new Float32Array(MAX_POURS * 4)
  /** the field's size and how much of it is oiled, for the test hook (stats()) */
  gw = 0
  gh = 0

  constructor(private gl: WebGL2RenderingContext) {}

  pointerHint(): string {
    return 'click : a spill · hold : pour · drag : a trail of oil'
  }

  pointer(ev: SourcePointer): void {
    this.pts.pointer(ev)
  }

  private build(): EngineGL {
    const g = new EngineGL(this.gl, 'slick')
    this.gl.getExtension('EXT_color_buffer_float')
    this.g = g
    this.fieldP = g.prog(FIELD_FS)
    this.simP = g.prog(SIM_FS)
    this.lookP = g.prog(LOOK_FS)
    this.showP = g.prog(SHOW_FS)
    this.flow = null
    this.S = null
    this.F = null
    this.look = null
    this.key = ''
    return g
  }

  private freeField(): void {
    const g = this.g
    if (!g) return
    if (this.S) for (const t of this.S) g.freeTarget(t)
    g.freeTarget(this.F)
    g.freeTarget(this.look)
    this.S = null
    this.F = null
    this.look = null
  }

  private clearState(): void {
    const gl = this.gl
    if (!this.S) return
    for (const t of this.S) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.spills = []
  }

  /** A spill at (x, y) (field units) : r its radius, a its depth in the middle. */
  private spill(x: number, y: number, r: number, a: number): void {
    this.spills.push([x, y, r, Math.min(4, a)])
    if (this.spills.length > MAX_SPILLS) this.spills.splice(0, this.spills.length - MAX_SPILLS)
  }

  private common(p: Prog, dome: boolean, asp: number, fill: number, gw: number, gh: number): Prog {
    return p.f1('uDome', dome ? 1 : 0).f1('uAsp', asp).f1('DOME_FILL', fill).i2('uSize', gw, gh)
  }

  /** Test hook : how much of the field is oiled (a readback : tests only). */
  stats(): { cover: number; crude: number; mean: number; max: number; stain: number } | null {
    const g = this.g
    if (!g || !this.S) return null
    const gl = this.gl
    const t = this.S[this.cur]
    const buf = new Float32Array(t.w * t.h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, buf)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    let n = 0, cover = 0, crude = 0, sum = 0, max = 0, stain = 0
    for (let i = 0; i < buf.length; i += 4) {
      n++
      const h = buf[i]
      if (h > 0.02) cover++
      if (h > 0.4) crude++
      sum += h
      if (h > max) max = h
      stain += buf[i + 1]
    }
    return { cover: cover / n, crude: crude / n, mean: sum / n, max, stain: stain / n }
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const gl = this.gl
    if (gl.isContextLost()) return ctx.host
    if (this.gen !== glGeneration()) {
      this.g = null
      this.gen = glGeneration()
    }
    const g = this.g ?? this.build()
    if (!g.ok) return ctx.host
    const I = ctx.inputs
    const W = ctx.chain.w, H = ctx.chain.h
    const fill = domeFill()
    const dome = fill > 0
    const asp = W / Math.max(1, H)
    const dt = clamp(ctx.dt, 0, 0.1)
    // the grid : a little under a third of the height, 200 to 320 rows; square on the dome
    const [gw, gh] = fieldSize(W, H, clamp(H * 0.28, 200, 320), dome)
    const key = `${gw}x${gh}|${dome ? 1 : 0}`
    if (key !== this.key || !this.S) {
      this.freeField()
      this.S = [g.target(gw, gh), g.target(gw, gh)]
      this.F = g.target(gw, gh, { half: 'rgba' })
      this.look = g.target(gw, gh, { half: 'rgba', linear: true })
      this.cur = 0
      this.key = key
      this.gw = gw
      this.gh = gh
    }
    const cell = 1 / gh
    const restart = this.lastFrame < 0 || (ctx.frame !== undefined && ctx.frame !== this.lastFrame + 1)
    this.lastFrame = ctx.frame ?? 0

    // ── where the oil comes from ──
    const size = clamp(num(I, 'size', 0.45), 0, 1)
    const spillR = Math.max(3 * cell, 0.02 + 0.1 * size)
    const spillA = 2 + 3 * size
    const at = num(I, 'spillAt', 2)
    const pointIn = Array.isArray(I.point) ? (I.point as number[]) : undefined
    const fired = (s: number): void => {
      const [x, y] = firePlace(at, pointIn, dome, asp, fill)
      this.spill(x, y, spillR * (0.8 + 0.3 * s), spillA * s)
    }
    if (this.spillE.fired(num(I, 'spill', 0))) fired(1)
    if (this.cleanE.fired(num(I, 'clean', 0))) this.cleaning = 0.6
    // the beat, on the shared clock (Ableton Link's while it is on)
    const on = clamp(Math.round(num(I, 'beat', 0)), 0, SPILL_BEATS.length - 1)
    if (on !== this.lastOn) { this.lastOn = on; this.lastBeat = NaN }
    if (SPILL_BEATS[on] !== 0) {
      const b = SPILL_BEATS[on]
      const per = b > 0 ? b : -b * soniBar()
      const n = Math.floor(soniBeats() / per + 1e-6)
      if (Number.isFinite(n)) {
        if (Number.isFinite(this.lastBeat) && n !== this.lastBeat) fired(1)
        this.lastBeat = n
      }
    }
    const au = clamp(num(I, 'audio', 0), 0, 1)
    const hit = this.onset.hit() // (read every frame : its edge must not go stale)
    if (au > 0 && hit > 0) fired(au * hit)
    // it wells up by itself (the first one soon after it is put in)
    const seep = clamp(num(I, 'seep', 0.35), 0, 1)
    if (seep > 0 && dt > 0) {
      if (this.firstSeep > 0) {
        this.firstSeep -= dt
        if (this.firstSeep <= 0) this.seepAcc = 1
      }
      this.seepAcc += dt * 0.6 * seep * seep
      while (this.seepAcc >= 1) {
        this.seepAcc -= 1
        const [x, y] = randomField(dome, asp, fill)
        const k = 0.55 + 0.6 * Math.random()
        this.spill(x, y, spillR * (0.6 + 0.5 * Math.random()), spillA * k)
      }
    }
    // OSC taps
    const bus = touchBus.since(this.busSeq)
    this.busSeq = bus.seq
    for (const tp of bus.taps) {
      const [x, y] = toField(tp.u, tp.v, dome, asp)
      this.spill(x, y, spillR, spillA * tp.s)
    }
    // the hands, the OSC finger, the point : a spill where one goes down, then pouring
    // while it stays (a drag leaves a trail)
    const pts = this.pts.step(dt, 0.85, dome, asp, {
      people: 0,
      point: pointIn,
      press: num(I, 'press', 0) >= 0.5
    })
    const pourR = Math.max(2.5 * cell, spillR * 0.55)
    const np = Math.min(MAX_POURS, pts.length)
    this.aP.fill(0)
    for (let i = 0; i < np; i++) {
      const p = pts[i]
      if (p.fresh) this.spill(p.x, p.y, spillR * 0.85, spillA * 0.8 * p.w)
      this.aP.set([p.x, p.y, pourR, (1.6 + 2.4 * size) * p.w], i * 4)
    }

    // ── the oil ──
    gl.disable(gl.BLEND)
    this.t = (this.t + dt) % 4000
    const motion = clamp(num(I, 'motion', 0), 0, 1)
    if (motion > 0) {
      this.flow ??= new PictureFlow(g)
      this.flow.update(ctx.host, restart)
    }
    const spread = clamp(num(I, 'spread', 0.4), 0, 1)
    const fing = clamp(num(I, 'fingers', 0.55), 0, 1)
    const cov = clamp(num(I, 'coverage', 0), 0, 1)
    const tide = clamp(num(I, 'tide', 0), 0, 1)
    const drive = cov > 0 || tide > 0
    // what the field asks of each cell, this frame
    {
      const p = this.common(this.fieldP!.use(), dome, asp, fill, gw, gh)
      // (current : up to 0.03 frame heights a second; the motion as cells a 60 Hz step)
      p.i1('uFlow', 0).f1('uFing', fing).f1('uT', this.t)
        .f1('uCur', clamp(num(I, 'current', 0.2), 0, 1) * 0.03 * gh * STEP)
        .f1('uMotion', motion).f1('uMotionK', 0.8 * STEP / Math.max(dt, 1 / 240)).i1('uHasFlow', motion > 0 && this.flow ? 1 : 0)
        .f1('uCov', cov).f1('uTide', tide).i1('uTideFrom', clamp(Math.round(num(I, 'tideFrom', 0)), 0, 4))
      g.bind(0, motion > 0 && this.flow ? this.flow.tex : null)
      g.draw(this.F!.fbo, gw, gh)
    }
    // a fixed step (the same oil at any frame rate), split so the spreading stays stable
    this.acc = Math.min(this.acc + dt, STEP * MAX_STEPS)
    // spreading : frame heights² a second at a depth of 1
    const D = 4e-5 + 1.2e-3 * spread * spread
    const kStep = D * gh * gh * STEP
    const worst = kStep * CAP * CAP * 1.88
    // the sheen's own spreading (it runs out about 0.03 frame heights ahead of the crude)
    const ksStep = 3.5e-4 * gh * gh * STEP
    const sub = clamp(Math.max(Math.ceil(worst / 0.2), Math.ceil(ksStep / 0.2)), 1, MAX_SUB)
    const kSub = Math.min(kStep / sub, 0.2 / (CAP * CAP * 1.88))
    const dtS = STEP / sub
    const ns = Math.min(MAX_SPILLS, this.spills.length)
    this.aS.fill(0)
    for (let i = 0; i < ns; i++) this.aS.set(this.spills[i], i * 4)
    const drips = clamp(num(I, 'drips', 0.2), 0, 1)
    const recede = clamp(num(I, 'recede', 0), 0, 1)
    let keep = 1
    if (this.cleaning > 0) {
      keep = Math.exp(-9 * dtS)
      this.cleaning -= dt
      if (this.cleaning <= 0) { this.clearState(); keep = 1; this.cleaning = 0 }
    }
    let first = true
    const sp = this.common(this.simP!.use(), dome, asp, fill, gw, gh)
    sp.i1('uS', 0).i1('uF', 1).f1('uK', kSub).f1('uKs', Math.min(0.2, ksStep / sub)).f1('uDtS', dtS).f1('uT', this.t)
      // (drips : up to 0.06 frame heights a second, as cells a 60 Hz step)
      .f1('uDrip', drips * drips * 0.06 * gh * STEP)
      .f1('uGrow', 0.15 + 1.3 * spread).f1('uEbb', 0.4 + 1.2 * spread).f1('uDrive', drive ? 1 : 0)
      .f1('uRec', recede * recede * 0.3).f1('uStainUp', 0.3).f1('uKeep', keep)
      .i1('uNS', ns).i1('uNP', np)
    gl.uniform4fv(sp.u('uSpill'), this.aS)
    gl.uniform4fv(sp.u('uPour'), this.aP)
    g.bind(1, this.F!.tex)
    const S = this.S!
    while (this.acc >= STEP) {
      this.acc -= STEP
      for (let k = 0; k < sub; k++) {
        sp.f1('uFirst', k === 0 ? 1 : 0)
        g.bind(0, S[this.cur].tex)
        g.draw(S[1 - this.cur].fbo, gw, gh)
        this.cur = 1 - this.cur
      }
      if (first) { first = false; sp.i1('uNS', 0) }
    }
    // (spills wait for the next step when this frame had none : a frozen rack keeps them)
    if (!first) this.spills = []
    // for the eye
    {
      const p = this.common(this.lookP!.use(), dome, asp, fill, gw, gh)
      p.i1('uS', 0)
      g.bind(0, S[this.cur].tex)
      g.draw(this.look!.fbo, gw, gh)
    }
    // the picture with the oil on it
    const out = ctx.chain.next()
    const la = num(I, 'lightAngle', 2.36)
    const el = 0.12 + 1.25 * clamp(num(I, 'lightHeight', 0.5), 0, 1)
    const L = [Math.cos(la) * Math.cos(el), Math.sin(la) * Math.cos(el), Math.sin(el)]
    const c = col(I, 'color', [0.035, 0.026, 0.02])
    const p = this.common(this.showP!.use(), dome, asp, fill, gw, gh)
    p.i1('uHost', 0).i1('uLook', 1)
      .f2('RENDERSIZE', W, H).f2('uPx', 1 / W, 1 / H)
      .f1('uThick', 0.08 + 1.9 * clamp(num(I, 'thickness', 0.6), 0, 1))
      .f1('uOpac', clamp(num(I, 'opacity', 1), 0, 1))
      .f1('uSheen', clamp(num(I, 'sheen', 0.7), 0, 1))
      .f1('uGloss', clamp(num(I, 'gloss', 0.75), 0, 1))
      .f1('uRelief', 4 * clamp(num(I, 'relief', 0.4), 0, 1))
      .f1('uStain', clamp(num(I, 'stain', 0.3), 0, 1))
      .f1('uMix', clamp(num(I, 'mix', 1), 0, 1))
      .f1('uT', this.t).f1('uCellF', cell).f1('uAz', la).f2('uCellT', 1 / gw, 1 / gh)
      .f3('uCol', c[0], c[1], c[2]).f3('uL', L[0], L[1], L[2])
    g.bind(0, ctx.host)
    g.bind(1, this.look!.tex)
    g.draw(out.fbo, W, H)
    g.done(2)
    return out.tex
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (!this.g) return
    if (this.gen === glGeneration()) {
      this.freeField()
      this.flow?.dispose()
      this.g.dispose()
    }
    this.g = null
    this.flow = null
  }
}

