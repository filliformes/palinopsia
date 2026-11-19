// ModelSource : the native Model generator (id 'gen-model'). A 3D object on a layer :
// one of fifteen built-in shapes made in code (engine/modelMesh.ts), or a model file
// (glTF / GLB, OBJ, STL, PLY : engine/modelParse.ts, read on its own thread). It turns
// in front of a camera, drawn solid, as a wireframe, as its feature edges, as points
// or solid with its edges, in the materials Relief and Inflate share
// (engine/reliefShade.ts : clay, plastic, metal, brushed metal, chrome, soap film,
// foil) plus glass, a lit sphere (matcap), flat color and its normals; another layer
// can be its skin; its real depth can feed the depth readers (Parallax, Pulfrich,
// Luma Blur's depth focus) in place of the depth AI.
//
// How it draws :
// - Its own lean renderer in the compositor's GL context : each mesh has its OWN
//   vertex arrays (never the default one, which the ISF runtime owns : the shared
//   default-VAO trap froze the whole app once), its buffers are deleted with its own
//   vertex array bound, and the GL state is left as the ISF runtime expects it.
// - Into the shared multisampled buffer (sharedMsaa.ts, with its depth) in
//   premultiplied alpha, resolved, then back to straight alpha in the layer, over a
//   GROUND whose alpha lets the layers below show through.
// - Lines and points are quads made in the vertex shader (no attribute but the
//   instance's own), as wide in pixels as asked at 1080 rows and kept so at any size,
//   never thinner than a pixel and a half, anti-aliased over one.
// - The materials take the view direction into account : each pixel's normal and
//   lamp are turned into a frame whose depth axis looks back at the camera, where the
//   shared shading (written for a picture seen straight on) is exact.
// - Under full-dome fill the view is kept square and the object stands back, so it
//   stays round and framed in the middle (the dome stretches the frame like any
//   picture; it is never re-projected to true dome directions).
// - Its depth : drawn again, smaller, into its own target, nearest white, the back of
//   its bounding sphere black (engine/Compositor.ts hands it to the depth readers).
// - CRUDE COAT : over any material, the object coated in crude oil. The coat's depth on
//   the surface is a slow lumpy noise of the model's own place, raised by COAT; where it
//   is thick it is near-black with a deep wet shine (the shared gloss plastic), where it
//   thins (lumps, and its edges turning away from the camera) the material beneath
//   shows under the petrol rainbow (the thin-film colors), and DRIPS run down it in
//   streaks : columns across the world's down (in the model's own frame, so down stays
//   down on the screen however it turns) whose oil slides down slowly.
//   third-party: Oil appearance code (the order from the thin edge in : rainbow, then crude)
// - SHATTER (fragments and dust) : on the sound's onsets, the beat (the shared beat
//   clock, so Ableton Link's bars), the trigger, or held by hand (BROKEN), every
//   triangle flies out as a shard of its own along its face, scattered, turned round
//   its center, falling or rising and drifting, then gathers back to its place; past
//   DUST AT a share of them shrink into points that hang and drift. All of it in the
//   vertex shader from the triangle's corners, pulled from data textures by
//   gl_VertexID (no copy of the mesh per corner); the lines follow the faces they
//   border, the points look's beads each fly on their own, and the true depth is
//   drawn from the moving shards. While nothing is broken the mesh draws by its
//   usual path, untouched.
//
// The lit sphere (matcap) after Sloan, Martin, Gooch and Gooch, "The Lit Sphere"
// (Graphics Interface 2001) : a picture of a lit ball, read by the surface's normal.
// third-party: The Lit Sphere (matcap)
// third-party: Exploding objects (the idea : each triangle moved along its own face
// normal in a shader; this one is written for Palinopsia, no code taken)

import { EngineGL, SlotClock, Edge, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'
import { domeFill } from './domeSignal'
import { audioBus } from './audioIn'
import { acquireMsaa, msaaBuffer, releaseMsaa } from './sharedMsaa'
import { RELIEF_SHADE } from './reliefShade'
import { buildShape, prepareMesh, SHAPE_FILE, SHAPES, type MeshData } from './modelMesh'
import { modelLoader } from './modelLoad'
import { Onset } from './touchInput'
import { soniBar, soniBeats } from '../audio/soniClock'
import { HitCover, isNoTurn, quatIn, quatMat4 } from './heldObject'

// ── Shared GLSL : the noise the wobble and the soap film read ───────────────────
const NOISE = `
// third-party: Hash without Sine
float h3(vec3 q) { q = mod(q, 64.0); vec3 p3 = fract(q * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vn3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 0.0)), h3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(h3(i + vec3(0.0, 0.0, 1.0)), h3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 1.0)), h3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}`

const VS_HEAD = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 uMV, uP;
uniform mat3 uNM;
uniform vec2 uOff;
uniform float uWob, uWobS, uWobT, uNear0, uFar0;
${NOISE}
// WOBBLE : the surface pushed in and out along its normal by a slow noise of its own
// place (a split vertex, at a hard edge, opens a little : a crack, kept), the normal
// leaned by the noise's slope so the light follows the bumps.
float wobAt(vec3 q) { return (vn3(q * uWobS + vec3(0.0, 0.0, uWobT)) + 0.5 * vn3(q * uWobS * 2.1 + vec3(17.0, 5.0, uWobT * 1.3)) - 0.75) * uWob * 0.5; }
void deform(inout vec3 q, inout vec3 n) {
  if (uWob <= 0.0 || dot(n, n) < 1e-8) return;
  float d = wobAt(q);
  const float e = 0.01;
  vec3 g = vec3(wobAt(q + vec3(e, 0.0, 0.0)) - d, wobAt(q + vec3(0.0, e, 0.0)) - d, wobAt(q + vec3(0.0, 0.0, e)) - d) / e;
  q += n * d;
  n = normalize(n - (g - n * dot(g, n)));
}
float depth01(float ez) { return clamp((uFar0 + ez) / max(1e-4, uFar0 - uNear0), 0.0, 1.0); }
`

// ── The solid : every material ───────────────────────────────────────────────
const SOLID_VS = `${VS_HEAD}
layout(location = 0) in vec3 p;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec4 aC;
out vec3 vPos;
out vec3 vN;
out vec3 vObjN;
out vec3 vObjP;
out vec2 vUV;
out vec4 vC;
out float vD;
void main() {
  vec3 q = p, n = aN;
  deform(q, n);
  vec4 e = uMV * vec4(q, 1.0);
  vPos = e.xyz;
  vN = uNM * n;
  vObjN = n;
  vObjP = p;
  vUV = aUV;
  vC = aC;
  vD = depth01(e.z);
  gl_Position = uP * e;
  gl_Position.xy += uOff * gl_Position.w;
}`

const SHADE_HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uTex, uSide;
uniform vec2 uRes, uAspect;
uniform vec3 uColor, uGround, uL;
uniform float uGroundA, uMat, uMatcap, uFileColor, uHasFile, uHasTex, uGloss, uCav, uFacets, uFilm, uFilmNm, uLight, uAmb, uAz;
uniform float uSkin, uSkinMode, uHasSide, uTile, uScrollT, uFog, uFpx;
uniform vec2 uFilmT;
uniform float uCrude, uCrDrip, uCrSheen;
uniform vec3 uCrDown, uCrCol, uCrRun;
${NOISE}
${RELIEF_SHADE}
// The frame whose depth axis looks back along the view ray : the shading written for a
// picture seen straight on is exact there.
mat3 viewFrame(vec3 posV) {
  vec3 z = normalize(-posV);
  vec3 x = cross(vec3(0.0, 1.0, 0.0), z);
  x = dot(x, x) < 1e-8 ? vec3(1.0, 0.0, 0.0) : normalize(x);
  return mat3(x, cross(z, x), z);
}
// The built-in lit spheres : a picture of a lit ball, read at the normal. The lamp's
// angle turns them.
vec3 litSphere(vec3 n, vec3 alb) {
  float a = uAz - 2.36;
  vec2 m = mat2(cos(a), sin(a), -sin(a), cos(a)) * n.xy;
  float z = sqrt(max(0.0, 1.0 - dot(m, m)));
  vec3 q = vec3(m, z);
  if (uMatcap < 0.5) {
    // pearl : a soft white body, a pink and blue sheen round its edge
    vec3 c = mix(vec3(0.5, 0.48, 0.56), vec3(0.98, 0.96, 0.95), smoothstep(-0.7, 0.9, m.y * 0.55 + z * 0.75));
    c += foilHue(fract(0.62 + z * 0.8 + m.x * 0.15)) * pow(1.0 - z, 2.0) * 0.4;
    return c + vec3(1.0) * pow(max(0.0, dot(q, normalize(vec3(-0.35, 0.45, 0.82)))), 60.0) * 0.6;
  }
  if (uMatcap < 1.5) {
    // red wax : a deep body, the light caught inside near the rim
    float l = dot(q, normalize(vec3(-0.4, 0.5, 0.75)));
    vec3 c = mix(vec3(0.16, 0.008, 0.015), vec3(0.86, 0.17, 0.12), smoothstep(-0.25, 1.0, l));
    c += vec3(0.95, 0.3, 0.22) * pow(1.0 - z, 3.0) * 0.45;
    return c + vec3(1.0, 0.85, 0.8) * pow(max(0.0, l), 36.0) * 0.55;
  }
  if (uMatcap < 2.5) {
    // jade : green stone, lit from within, a hard glint
    vec3 c = mix(vec3(0.03, 0.15, 0.1), vec3(0.48, 0.82, 0.62), z * z);
    c += vec3(0.25, 0.55, 0.4) * smoothstep(0.2, 0.9, -m.y * 0.5 + z * 0.5) * 0.35;
    return c + vec3(0.95, 1.0, 0.95) * pow(max(0.0, dot(q, normalize(vec3(0.3, 0.55, 0.78)))), 120.0) * 0.9;
  }
  if (uMatcap < 3.5) {
    // bronze : a warm metal reflecting a horizon, a dark band under it
    float f = m.y * 1.5 + z * 0.35;
    vec3 c = vec3(0.32, 0.18, 0.07) * (0.35 + 0.65 * smoothstep(-0.4, 0.5, f));
    c = mix(c, vec3(0.04, 0.025, 0.015), smoothstep(0.42, 0.5, f) * (1.0 - smoothstep(0.5, 0.62, f)));
    return c + vec3(1.0, 0.78, 0.45) * smoothstep(0.6, 0.85, f) + vec3(0.6, 0.4, 0.2) * pow(1.0 - z, 2.0) * 0.4;
  }
  // toon : the color in three flat steps, a dark outline where it turns away
  float l = dot(q, normalize(vec3(-0.4, 0.55, 0.73)));
  float s = l > 0.62 ? 1.0 : l > 0.18 ? 0.62 : 0.28;
  vec3 c = alb * s + vec3(1.0) * step(0.965, l) * 0.35;
  return z < 0.24 ? alb * 0.06 : c;
}
// One point of the surface lit. Nf, Lf : the normal and lamp in the view frame; alb
// its own color; uvS its place on the screen; uvM its texture coordinates; objN, objP
// its normal and place on the model itself; d01 how near (1) or far (0). Out :
// premultiplied (the color times its cover).
vec4 shadeAll(vec3 Nf, vec3 Lf, vec3 alb, vec2 uvS, vec2 uvM, vec3 objN, vec3 objP, float d01, float curv) {
  vec2 P = (uvS - 0.5) * uAspect;
  bool pic = uHasSide > 0.5 && uSkin > 0.0;
  vec3 picC = vec3(0.0);
  vec3 refl = vec3(0.0);
  float reflAmt = 0.0;
  if (pic) {
    if (uSkinMode < 0.5) {
      vec2 w = uvM * uTile + vec2(uScrollT, 0.0);
      picC = texture(uSide, vec2(fract(w.x), 1.0 - fract(w.y))).rgb;
    } else if (uSkinMode < 1.5) picC = texture(uSide, uvS).rgb;
    else if (uSkinMode < 2.5) { vec3 r = reflect(vec3(0.0, 0.0, -1.0), Nf); picC = texture(uSide, clamp(uvS + r.xy * 0.34, 0.0, 1.0)).rgb; }
    else picC = texture(uSide, Nf.xy * 0.5 + 0.5).rgb;
    if (uSkinMode < 1.5) alb = mix(alb, picC, uSkin);
    else if (uSkinMode < 2.5) { refl = picC * 1.2; reflAmt = uSkin; }
  }
  vec3 c;
  float a = 1.0;
  float m = uMat;
  if (m > 7.5 && m < 8.5) c = litSphere(Nf, alb);
  else if (m > 8.5 && m < 9.5) c = alb;
  else if (m > 9.5) c = normalize(objN + 1e-6) * 0.5 + 0.5;
  else if (m > 4.5 && m < 5.5) {
    // glass : the skin bent through it (red least, blue most), else clear in the middle
    // with the room on its shoulders, and a bright rim where it turns away
    float fr = pow(max(0.0, 1.0 - Nf.z), 3.0);
    vec3 room = roomAt(reflect(vec3(0.0, 0.0, -1.0), Nf), uAz, P, Nf.z, 0.05);
    if (pic) {
      vec2 bo = Nf.xy * 0.14;
      vec3 bent = vec3(texture(uSide, clamp(uvS + bo * 0.75, 0.0, 1.0)).r, texture(uSide, clamp(uvS + bo, 0.0, 1.0)).g, texture(uSide, clamp(uvS + bo * 1.3, 0.0, 1.0)).b);
      c = mix(alb * (0.2 + 0.8 * max(0.0, Nf.z)), bent * (0.86 + 0.2 * Nf.z), uSkin) + room * (0.08 + 0.75 * fr);
    } else {
      // (the lamp's glint and a faint body of its color, so it reads over black too)
      vec3 H = normalize(Lf + vec3(0.0, 0.0, 1.0));
      c = room * (0.16 + 0.8 * fr) + alb * 0.07 + vec3(1.0) * pow(max(0.0, dot(Nf, H)), 120.0 * (0.3 + uGloss * 1.2)) * 1.4;
      a = mix(0.36, 1.0, min(1.0, fr * 2.4));
    }
    c += vec3(0.92, 0.96, 1.0) * pow(max(0.0, 1.0 - Nf.z), 4.0) * 0.9;
  } else {
    // the shared materials : clay, plastic, metal, brushed metal, chrome, soap film, foil
    float M = m < 0.5 ? 0.0 : m < 1.5 ? 3.0 : m < 2.5 ? 1.0 : m < 3.5 ? 2.0 : m < 4.5 ? 4.0 : m < 6.5 ? 6.0 : 7.0;
    float nm = 160.0 + uFilmNm * 900.0 + (vn3(objP * 2.3 + vec3(uFilmT.x, 0.0, 0.0)) + 0.5 * vn3(objP * 5.1 - vec3(0.0, uFilmT.y, 0.0))) * 380.0;
    c = shadeSurface(M, alb, Nf, Lf, uAz, 0.3 + uGloss * 1.2, refl, reflAmt, uFilm, nm, P);
    c = c * uLight + alb * uAmb * 0.35;
  }
  if (pic && uSkinMode > 2.5) c = mix(c, picC, uSkin);
  // cavity : the creases (where the normals close in) get less light; the ridges a little more
  if (uCav > 0.0) c *= 1.0 - uCav * 0.85 * clamp(-curv * 0.35, 0.0, 1.0) + uCav * 0.12 * clamp(curv * 0.1, 0.0, 1.0);
  // crude coat : black wet oil over whatever it is, the rainbow where it thins, drips
  // running down it
  if (uCrude > 0.0) {
    vec3 dn = normalize(uCrDown + vec3(0.0, 1e-5, 0.0));
    float along = dot(objP, dn);
    vec3 acr = objP - dn * along;
    float lump = vn3(objP * 2.6 + 11.0) + 0.5 * vn3(objP * 6.1 + 3.0) - 0.75;
    float drip = 0.0;
    if (uCrDrip > 0.0) {
      // the streaks : columns across the down, the oil in them sliding down slowly
      float colm = smoothstep(0.52, 0.78, vn3(acr * 7.5 + 2.0));
      float run = smoothstep(0.35, 0.75, vn3(acr * 7.5 + dn * (along * 1.6) + uCrRun + 5.0));
      drip = colm * (0.45 + 0.55 * run) * uCrDrip;
    }
    float k = uCrude * 1.35 - 0.35 + lump * 0.4 + drip * 0.7;
    // (thinner where the surface turns away from the camera : the rainbow at its edges)
    float kv = k * mix(0.3, 1.0, smoothstep(0.0, 0.65, Nf.z));
    float cover = smoothstep(0.0, 0.05, kv);
    float thick = smoothstep(0.16, 0.5, kv);
    // (the slope of the coat, taken outside the branch : a derivative inside one is undefined)
    vec2 dk = vec2(dFdx(k), dFdy(k));
    if (cover > 0.0) {
      // its own lumps and runs catch the light
      vec3 Nc = normalize(Nf - vec3(dk, 0.0) * 22.0 * thick);
      vec3 crude = shadeSurface(3.0, uCrCol, Nc, Lf, uAz, 1.65, vec3(0.0), 0.0, 0.0, 0.0, P);
      vec3 Hc = normalize(Lf + vec3(0.0, 0.0, 1.0));
      // a sharp wet highlight, a broad sheen, and the wet rim where it turns away
      crude += vec3(1.0, 0.98, 0.95) * (pow(max(0.0, dot(Nc, Hc)), 380.0) * 0.9 + pow(max(0.0, dot(Nc, Hc)), 28.0) * 0.12);
      crude += roomAt(reflect(vec3(0.0, 0.0, -1.0), Nc), uAz, P, Nc.z, 0.05) * pow(1.0 - max(Nc.z, 0.0), 3.0) * 0.35;
      vec3 film = filmColor(110.0 + 2400.0 * kv, max(Nc.z, 0.05), 1.45);
      vec3 thin = c * (0.35 + 0.9 * film) + film * film * 0.14;
      crude *= mix(vec3(1.0), 0.45 + 1.1 * filmColor(520.0 + 380.0 * lump, max(Nc.z, 0.05), 1.5), 0.3 * uCrSheen);
      vec3 coated = mix(mix(c, thin, uCrSheen), crude, thick);
      c = mix(c, coated, cover);
      a = mix(a, 1.0, thick);
    }
  }
  // fog : the far side fades toward the ground
  float f = uFog * pow(1.0 - d01, 1.4);
  return vec4(mix(c * a, uGround * uGroundA, f), mix(a, uGroundA, f));
}`

const SOLID_FS = `${SHADE_HEAD}
in vec3 vPos;
in vec3 vN;
in vec3 vObjN;
in vec3 vObjP;
in vec2 vUV;
in vec4 vC;
in float vD;
out vec4 o;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  if (uFacets > 0.5) N = normalize(cross(dFdx(vPos), dFdy(vPos)));
  // the curvature on the screen, brought back to the model's own size
  vec3 dx = dFdx(N), dy = dFdy(N);
  float curv = (dx.x + dy.y) / max(1e-6, -vPos.z * uFpx);
  mat3 F = viewFrame(vPos);
  vec3 Nf = N * F, Lf = normalize(uL * F);
  vec3 fileAlb = vC.rgb * (vC.a > 0.5 && uHasTex > 0.5 ? texture(uTex, vUV).rgb : vec3(1.0));
  vec3 alb = mix(uColor, fileAlb, uFileColor * uHasFile);
  o = shadeAll(Nf, Lf, alb, gl_FragCoord.xy / uRes, vUV, vObjN, vObjP, vD, curv);
}`

// ── The depth : nearest white, the far side of the bounding sphere black ───────
const DEPTH_FS = `#version 300 es
precision highp float;
in float vD;
out vec4 o;
void main() { o = vec4(vD, vD, vD, 1.0); }`

// ── Lines : wireframe, feature edges ────────────────────────────────────────────
const LINE_VS = `${VS_HEAD}
layout(location = 0) in vec3 p;    // one end
layout(location = 1) in vec3 aB;   // the other
layout(location = 2) in vec3 aF0;  // the normals of the two faces that meet there
layout(location = 3) in vec3 aF1;  // (0 : an open boundary)
uniform vec2 uRes;
uniform float uWidth, uAll, uCrease;
out float vX;
out float vD;
void main() {
  vec3 a = p, b = aB;
  vec3 nA = normalize(aF0 + aF1 + 1e-6), nB = nA;
  deform(a, nA);
  deform(b, nB);
  vec4 ea = uMV * vec4(a, 1.0), eb = uMV * vec4(b, 1.0);
  // which edges show : all of them (wireframe), else an open boundary, a crease sharper
  // than the crease angle, or the silhouette (one face toward the camera, one away)
  bool boundary = dot(aF1, aF1) < 1e-8;
  vec3 mid = (ea.xyz + eb.xyz) * 0.5;
  float s0 = dot(uNM * aF0, -mid), s1 = dot(uNM * aF1, -mid);
  bool show = uAll > 0.5 || boundary || dot(aF0, aF1) < uCrease || s0 * s1 < 0.0;
  vec4 ca = uP * ea, cb = uP * eb;
  ca.xy += uOff * ca.w;
  cb.xy += uOff * cb.w;
  vX = 0.0;
  vD = 0.0;
  if (!show || ca.w < 1e-3 || cb.w < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sa = (ca.xy / ca.w * 0.5 + 0.5) * uRes, sb = (cb.xy / cb.w * 0.5 + 0.5) * uRes;
  vec2 d = sb - sa;
  float l = length(d);
  d = l > 1e-3 ? d / l : vec2(1.0, 0.0);
  vec2 nrm = vec2(-d.y, d.x);
  float hw = uWidth * 0.5 + 1.0;
  int k = gl_VertexID;
  bool atB = k >= 2;
  float side = (k == 0 || k == 2) ? -1.0 : 1.0;
  vec4 c = atB ? cb : ca;
  vec2 s = (atB ? sb + d * hw * 0.5 : sa - d * hw * 0.5) + nrm * side * hw;
  vX = side * hw;
  vD = depth01(atB ? eb.z : ea.z);
  gl_Position = vec4((s / uRes * 2.0 - 1.0) * c.w, c.z, c.w);
}`

const LINE_FS = `#version 300 es
precision highp float;
uniform vec3 uLineC, uGround;
uniform float uWidth, uFog, uGroundA;
in float vX;
in float vD;
out vec4 o;
void main() {
  float cov = clamp(uWidth * 0.5 + 0.5 - abs(vX), 0.0, 1.0);
  if (cov <= 0.0) discard;
  float f = uFog * pow(1.0 - vD, 1.4);
  vec3 c = mix(uLineC, uGround, f);
  float a = cov * mix(1.0, uGroundA, f);
  o = vec4(c * a, a);
}`

// ── Points : each vertex a small lit bead ───────────────────────────────────────
const POINT_VS = `${VS_HEAD}
layout(location = 0) in vec3 p;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec4 aC;
uniform vec2 uRes;
uniform float uSize, uDist;
out vec2 vQ;
out vec3 vPos;
out vec3 vObjN;
out vec3 vObjP;
out vec2 vUV;
out vec4 vC;
out float vD;
out float vR;
void main() {
  vec3 q = p, n = aN;
  deform(q, n);
  vec4 e = uMV * vec4(q, 1.0);
  int k = gl_VertexID;
  vec2 corner = vec2((k == 1 || k == 3) ? 1.0 : -1.0, k >= 2 ? 1.0 : -1.0);
  vec4 c = uP * e;
  c.xy += uOff * c.w;
  // its size in pixels : as asked at the model's distance, larger nearer, never under 1.5
  float r = max(0.75, uSize * 0.5 * uDist / max(0.05, -e.z));
  vR = r;
  vQ = corner * (r + 1.0) / r;
  vPos = e.xyz;
  vObjN = n;
  vObjP = p;
  vUV = aUV;
  vC = aC;
  vD = depth01(e.z);
  if (c.w < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  c.xy += corner * (r + 1.0) / uRes * 2.0 * c.w;
  gl_Position = c;
}`

const POINT_FS = `${SHADE_HEAD}
in vec2 vQ;
in vec3 vPos;
in vec3 vObjN;
in vec3 vObjP;
in vec2 vUV;
in vec4 vC;
in float vD;
in float vR;
out vec4 o;
void main() {
  float rr = length(vQ);
  float cov = clamp((1.0 - rr) * vR + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  // a bead : its own little sphere, already facing the camera
  vec2 q = vQ / max(rr, 1.0);
  vec3 Nf = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
  mat3 F = viewFrame(vPos);
  vec3 Lf = normalize(uL * F);
  vec3 fileAlb = vC.rgb * (vC.a > 0.5 && uHasTex > 0.5 ? texture(uTex, vUV).rgb : vec3(1.0));
  vec3 alb = mix(uColor, fileAlb, uFileColor * uHasFile);
  vec4 c = shadeAll(Nf, Lf, alb, gl_FragCoord.xy / uRes, vUV, vObjN, vObjP, vD, 0.0);
  o = c * cov;
}`

const POINT_DEPTH_FS = `#version 300 es
precision highp float;
in vec2 vQ;
in float vD;
out vec4 o;
void main() { if (dot(vQ, vQ) > 1.0) discard; o = vec4(vD, vD, vD, 1.0); }`

// ── SHATTER : the shards ───────────────────────────────────────────────────────
// Every triangle a shard of its own (in the points look : every bead a grain),
// thrown out along its face, scattered, turned round its own center, falling or
// rising, drifting on a slow air, then gathered back to its place. Past DUST AT the
// dusting share of them shrink into a point. All from the shard's number and its
// rest place : nothing is simulated, so nothing drifts away for good, and at uShE 0
// every shard is home.
const SHARD = `
uniform float uShE, uShThrow, uShScat, uShSpin, uShCrumble, uShGrav, uShDrift, uShDust, uShDustAt, uShT, uShTumble;
uniform vec3 uShDown;
// third-party: Hash without Sine
vec4 h43(vec3 p) {
  vec4 p4 = fract(vec4(p.xyzx) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
// a turn of t radians round the unit axis a
mat3 turn3(vec3 a, float t) {
  float c = cos(t), s = sin(t), C = 1.0 - c;
  return mat3(c + a.x * a.x * C, a.y * a.x * C + a.z * s, a.z * a.x * C - a.y * s,
              a.x * a.y * C - a.z * s, c + a.y * a.y * C, a.z * a.y * C + a.x * s,
              a.x * a.z * C + a.y * s, a.y * a.z * C - a.x * s, c + a.z * a.z * C);
}
// Where shard id (its rest center c, its face's normal n) is : moved by off, turned
// by R round c, shrunk by k; dust : how far it has turned to dust (0..1).
void shard(int id, vec3 c, vec3 n, out vec3 off, out mat3 R, out float k, out float dust) {
  off = vec3(0.0); R = mat3(1.0); k = 1.0; dust = 0.0;
  vec3 key = vec3(float(id & 1023), float(id >> 10), 0.0);
  vec4 r = h43(key + vec3(0.0, 0.0, 3.7)), r2 = h43(key.yxz + vec3(0.0, 0.0, 11.3)), r3 = h43(key + vec3(0.0, 0.0, 23.9));
  // CRUMBLE : the shards leave one after another (and come back in the same order)
  float e = clamp(uShE * (1.0 + uShCrumble) - uShCrumble * r.w, 0.0, 1.0);
  if (e <= 0.0) return;
  // out along its face, a little away from the middle too (a flat sheet bursts), scattered
  vec3 d = n + normalize(c + vec3(1e-5, 0.0, 0.0)) * 0.45 + (r2.xyz - 0.5) * 2.4 * uShScat;
  d = dot(d, d) > 1e-10 ? normalize(d) : vec3(0.0, 0.0, 1.0);
  // most a little, a few far
  float fly = uShThrow * (0.35 + 0.8 * r.x + 1.4 * pow(r.y, 6.0));
  off = d * fly * e;
  // GRAVITY : falls (or rises) the further it is broken
  off += uShDown * (uShGrav * e * e * (0.6 + 0.8 * r3.z) * 1.2);
  // DRIFT : a slow air of its own, waves crossing at odd angles (uShT : a phase that
  // wraps at 2 pi, read only at whole multiples so the wrap never shows)
  if (uShDrift > 0.0) {
    vec3 q = c * 2.0 + r3.xyz * 6.2832;
    off += vec3(sin(q.y * 2.1 + uShT), sin(q.z * 1.7 + q.x * 1.3 + 2.0 * uShT), sin(q.x * 2.3 - uShT)) * (uShDrift * e * 0.7);
  }
  // SHARD SPIN : a turn round an axis of its own, more the further broken, and a slow
  // tumble while it is out (uShTumble eases to a stop : a long hold hangs still)
  float ang = e * uShSpin * ((1.2 + 3.6 * r.z) + uShTumble * (0.4 + 0.9 * r3.y)) * (r3.w < 0.5 ? -1.0 : 1.0);
  vec3 ax = r2.zxy - 0.5;
  R = turn3(dot(ax, ax) > 1e-6 ? normalize(ax) : vec3(0.0, 1.0, 0.0), ang);
  // DUST : past DUST AT, the dusting share of the shards shrinks into a point
  if (uShDust > 0.0 && r3.x < uShDust) {
    dust = smoothstep(uShDustAt, min(1.0, uShDustAt + 0.3) + 1e-3, e);
    k = 1.0 - dust;
  }
}`

// The mesh read back in the vertex shader : its triangles (three corners a texel) and
// its vertices (two texels each : place + u, normal + v), 2048 texels a row.
const PULL = `
precision highp usampler2D;
precision highp sampler2D;
uniform usampler2D uIdx;
uniform sampler2D uVtx;
ivec2 at(int i) { return ivec2(i & 2047, i >> 11); }
vec3 vpos(int v) { return texelFetch(uVtx, at(v * 2), 0).xyz; }
// a triangle's center and its face's normal (the same in all three corners, so the
// shard stays whole)
void faceOf(uvec4 t, out vec3 c, out vec3 fn) {
  vec3 p0 = vpos(int(t.x)), p1 = vpos(int(t.y)), p2 = vpos(int(t.z));
  c = (p0 + p1 + p2) / 3.0;
  fn = cross(p1 - p0, p2 - p0);
  fn = dot(fn, fn) > 1e-30 ? normalize(fn) : vec3(0.0, 0.0, 1.0);
}`

// the solid, every triangle its own shard (drawn without vertex data : 3 a triangle)
const SOLID_SHARD_VS = `${VS_HEAD}
${SHARD}
${PULL}
uniform sampler2D uVcol;
out vec3 vPos;
out vec3 vN;
out vec3 vObjN;
out vec3 vObjP;
out vec2 vUV;
out vec4 vC;
out float vD;
void main() {
  int f = gl_VertexID / 3, k = gl_VertexID - f * 3;
  uvec4 t = texelFetch(uIdx, at(f), 0);
  int me = int(k == 0 ? t.x : k == 1 ? t.y : t.z);
  vec4 A = texelFetch(uVtx, at(me * 2), 0), B = texelFetch(uVtx, at(me * 2 + 1), 0);
  vec3 c, fn, off;
  mat3 R;
  float sk, dust;
  faceOf(t, c, fn);
  shard(f, c, fn, off, R, sk, dust);
  vec3 q = A.xyz, n = B.xyz;
  deform(q, n);
  q = c + off + R * ((q - c) * sk);
  n = R * n;
  vec4 e = uMV * vec4(q, 1.0);
  vPos = e.xyz;
  vN = uNM * n;
  vObjN = n;
  vObjP = A.xyz;
  vUV = vec2(A.w, B.w);
  vC = texelFetch(uVcol, at(me), 0);
  vD = depth01(e.z);
  gl_Position = uP * e;
  gl_Position.xy += uOff * gl_Position.w;
}`

// the lines : each edge twice, once with each face it borders (the second shows only
// once the two have come apart, so a whole mesh never draws it doubled)
const LINE_SHARD_VS = `${VS_HEAD}
${SHARD}
${PULL}
layout(location = 0) in vec3 p;
layout(location = 1) in vec3 aB;
layout(location = 2) in vec3 aF0;
layout(location = 3) in vec3 aF1;
layout(location = 4) in uvec2 aFace;
uniform vec2 uRes;
uniform float uWidth, uAll, uCrease;
out float vX;
out float vD;
out float vA;
vec3 moved(vec3 q, vec3 c, vec3 off, mat3 R, float k) { return c + off + R * ((q - c) * k); }
void main() {
  vX = 0.0;
  vD = 0.0;
  vA = 0.0;
  bool second = (gl_InstanceID & 1) == 1;
  if (second && aFace.y == 0xffffffffu) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  int f = int(second ? aFace.y : aFace.x);
  vec3 a = p, b = aB;
  vec3 nA = normalize(aF0 + aF1 + 1e-6), nB = nA;
  deform(a, nA);
  deform(b, nB);
  vec3 c, fn, off;
  mat3 R;
  float sk, dust;
  faceOf(texelFetch(uIdx, at(f), 0), c, fn);
  shard(f, c, fn, off, R, sk, dust);
  vec3 a1 = moved(a, c, off, R, sk), b1 = moved(b, c, off, R, sk);
  float fade = 1.0;
  if (second) {
    int f0 = int(aFace.x);
    vec3 c0, fn0, off0;
    mat3 R0;
    float sk0, dust0;
    faceOf(texelFetch(uIdx, at(f0), 0), c0, fn0);
    shard(f0, c0, fn0, off0, R0, sk0, dust0);
    vec3 m = (a + b) * 0.5;
    vec4 pa = uP * (uMV * vec4(moved(m, c0, off0, R0, sk0), 1.0)), pb = uP * (uMV * vec4(moved(m, c, off, R, sk), 1.0));
    vec2 sep = (pb.xy / max(pb.w, 1e-3) - pa.xy / max(pa.w, 1e-3)) * 0.5 * uRes;
    fade = clamp(length(sep) - 0.5, 0.0, 1.0);
    if (fade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  }
  vec4 ea = uMV * vec4(a1, 1.0), eb = uMV * vec4(b1, 1.0);
  bool boundary = dot(aF1, aF1) < 1e-8;
  vec3 mid = (ea.xyz + eb.xyz) * 0.5;
  float s0 = dot(uNM * aF0, -mid), s1 = dot(uNM * aF1, -mid);
  bool show = uAll > 0.5 || boundary || dot(aF0, aF1) < uCrease || s0 * s1 < 0.0;
  vec4 ca = uP * ea, cb = uP * eb;
  ca.xy += uOff * ca.w;
  cb.xy += uOff * cb.w;
  if (!show || ca.w < 1e-3 || cb.w < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sa = (ca.xy / ca.w * 0.5 + 0.5) * uRes, sb = (cb.xy / cb.w * 0.5 + 0.5) * uRes;
  vec2 d = sb - sa;
  float l = length(d);
  d = l > 1e-3 ? d / l : vec2(1.0, 0.0);
  vec2 nrm = vec2(-d.y, d.x);
  float hw = uWidth * 0.5 + 1.0;
  int k = gl_VertexID;
  bool atB = k >= 2;
  float side = (k == 0 || k == 2) ? -1.0 : 1.0;
  vec4 cc = atB ? cb : ca;
  vec2 s = (atB ? sb + d * hw * 0.5 : sa - d * hw * 0.5) + nrm * side * hw;
  vX = side * hw;
  vD = depth01(atB ? eb.z : ea.z);
  vA = fade * sk;
  gl_Position = vec4((s / uRes * 2.0 - 1.0) * cc.w, cc.z, cc.w);
}`

const LINE_SHARD_FS = `#version 300 es
precision highp float;
uniform vec3 uLineC, uGround;
uniform float uWidth, uFog, uGroundA;
in float vX;
in float vD;
in float vA;
out vec4 o;
void main() {
  float cov = clamp(uWidth * 0.5 + 0.5 - abs(vX), 0.0, 1.0) * vA;
  if (cov <= 0.0) discard;
  float f = uFog * pow(1.0 - vD, 1.4);
  vec3 c = mix(uLineC, uGround, f);
  float a = cov * mix(1.0, uGroundA, f);
  o = vec4(c * a, a);
}`

// the dust : one point a shard, where the shard has shrunk to, fading in as it goes
const DUST_VS = `${VS_HEAD}
${SHARD}
${PULL}
uniform sampler2D uVcol;
uniform vec2 uRes;
uniform float uDustPx, uDist;
out vec2 vQ;
out vec3 vPos;
out vec3 vObjN;
out vec3 vObjP;
out vec2 vUV;
out vec4 vC;
out float vD;
out float vR;
out float vA;
void main() {
  int f = gl_InstanceID;
  uvec4 t = texelFetch(uIdx, at(f), 0);
  vec3 c, fn, off;
  mat3 R;
  float sk, dust;
  faceOf(t, c, fn);
  shard(f, c, fn, off, R, sk, dust);
  vQ = vec2(0.0);
  vR = 1.0;
  vA = dust;
  vPos = vec3(0.0);
  vObjN = fn;
  vObjP = c;
  vUV = vec2(0.0);
  vC = vec4(1.0);
  vD = 0.0;
  if (dust < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 e = uMV * vec4(c + off, 1.0);
  int k = gl_VertexID;
  vec2 corner = vec2((k == 1 || k == 3) ? 1.0 : -1.0, k >= 2 ? 1.0 : -1.0);
  vec4 cp = uP * e;
  cp.xy += uOff * cp.w;
  float r = max(0.6, uDustPx * 0.5 * uDist / max(0.05, -e.z));
  vR = r;
  vQ = corner * (r + 1.0) / r;
  vPos = e.xyz;
  vObjN = R * fn;
  int v0 = int(t.x);
  vUV = vec2(texelFetch(uVtx, at(v0 * 2), 0).w, texelFetch(uVtx, at(v0 * 2 + 1), 0).w);
  vC = texelFetch(uVcol, at(v0), 0);
  vD = depth01(e.z);
  if (cp.w < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  cp.xy += corner * (r + 1.0) / uRes * 2.0 * cp.w;
  gl_Position = cp;
}`

// (the dust in the line looks : points of the line color)
const DUST_LINE_FS = `#version 300 es
precision highp float;
uniform vec3 uLineC, uGround;
uniform float uFog, uGroundA;
in vec2 vQ;
in float vD;
in float vR;
in float vA;
out vec4 o;
void main() {
  float cov = clamp((1.0 - length(vQ)) * vR + 0.5, 0.0, 1.0) * vA;
  if (cov <= 0.0) discard;
  float f = uFog * pow(1.0 - vD, 1.4);
  vec3 c = mix(uLineC, uGround, f);
  float a = cov * mix(1.0, uGroundA, f);
  o = vec4(c * a, a);
}`

/** `src` with `a` swapped for `b`, which must be there (a shard variant of a program). */
function swap(src: string, a: string, b: string): string {
  if (!src.includes(a)) throw new Error('ModelSource : a shard variant lost its anchor')
  return src.replace(a, b)
}
// the points look : every bead a grain of its own, shrinking to dust
const POINT_SHARD_VS = swap(swap(swap(POINT_VS, 'uniform float uSize, uDist;', `uniform float uSize, uDist, uDustPx;
${SHARD}`), `  deform(q, n);
  vec4 e = uMV * vec4(q, 1.0);`, `  deform(q, n);
  vec3 sOff;
  mat3 sR;
  float sK, sDust;
  shard(gl_InstanceID, p, dot(aN, aN) > 1e-8 ? aN : normalize(p + vec3(1e-5, 0.0, 0.0)), sOff, sR, sK, sDust);
  q += sOff;
  vec4 e = uMV * vec4(q, 1.0);`), 'float r = max(0.75, uSize * 0.5 * uDist / max(0.05, -e.z));', 'float r = mix(max(0.75, uSize * 0.5 * uDist / max(0.05, -e.z)), max(0.6, uDustPx * 0.5 * uDist / max(0.05, -e.z)), sDust);')
// the solid looks' dust : lit beads, faded in
// (a grain lit dark by a mirror material would vanish : it keeps at least most of its
// own color, so the dust reads as fine bright specks)
const DUST_FS = swap(swap(POINT_FS, 'in float vR;', `in float vR;
in float vA;`), 'o = c * cov;', `c.rgb = max(c.rgb, alb * c.a * 0.85);
  o = c * (cov * vA);`)

// (the picture : the resolved model, straight alpha again)
const SHOW_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPic;
out vec4 o;
void main() {
  vec4 c = texelFetch(uPic, ivec2(gl_FragCoord.xy), 0);
  o = c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
}`

// ── Matrices (column-major, as GL reads them) ───────────────────────────────────
type M4 = Float32Array
const m4 = (): M4 => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m }
/** a times b, into o (a fresh one when none : o must be neither a nor b). */
function mul4(a: M4, b: M4, o: M4 = new Float32Array(16)): M4 {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
    o[c * 4 + r] = s
  }
  return o
}
/** The identity, into m. */
function ident(m: M4): M4 { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m }
function rotX(t: number, m: M4 = m4()): M4 { ident(m); const c = Math.cos(t), s = Math.sin(t); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m }
function rotY(t: number, m: M4 = m4()): M4 { ident(m); const c = Math.cos(t), s = Math.sin(t); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m }
function rotZ(t: number, m: M4 = m4()): M4 { ident(m); const c = Math.cos(t), s = Math.sin(t); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m }

interface GpuMesh {
  key: string
  mesh: MeshData
  vao: WebGLVertexArrayObject
  ptVao: WebGLVertexArrayObject
  edVao: WebGLVertexArrayObject | null
  bufs: WebGLBuffer[]
  nIdx: number
  nVert: number
  nEdge: number
  tex: WebGLTexture | null
  /** the edges' buffer (the shards' line copies read it too) */
  bE: WebGLBuffer | null
  /** what the shards read, made ahead of the first hit or on it (null : not yet;
   *  ok false : too big for the data textures, it never breaks) */
  sh: Shards | null
  /** when it was put on the GPU (performance.now) */
  born: number
}

/** The mesh as the shards read it : its triangles and vertices in data textures, and
 *  the lines' vertex array with the two faces of each edge. */
interface Shards {
  ok: boolean
  idx: WebGLTexture | null
  vtx: WebGLTexture | null
  vcol: WebGLTexture | null
  edVao: WebGLVertexArrayObject | null
  bFace: WebGLBuffer | null
  /** still being made (ensureShards' steps), else null */
  job: ShardJob | null
}

/** The shards' data on its way : the stage, how far into it, the arrays being filled. */
interface ShardJob {
  stage: number
  i: number
  nV: number
  nT: number
  rowsV: number
  rowsC: number
  rowsT: number
  vd: Float32Array | null
  cd: Uint8Array | null
  id: Uint32Array | null
}

const STYLE_SOLID = 0, STYLE_WIRE = 1, STYLE_EDGES = 2, STYLE_POINTS = 3, STYLE_SOLID_EDGES = 4

/** BREAK ON : by hand (BROKEN and the trigger only), the sound's onsets, then the beat
 *  every 1 or 2 beats, 1 or 2 bars (0 : not a beat rate). */
const BREAK_BEATS = [0, 0, 1, 2, -1, -2] // (negative : bars, Link's bar while it is on)
const MAX_HITS = 4
const PULL_W = 2048 // texels a row of the shards' data textures
interface Hit { age: number; s: number; gather: number }
const smoother = (t: number): number => { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (t * 6 - 15) + 10) }

export class ModelSource implements NativeGenerator {
  private g: EngineGL
  private solidP: Prog
  private depthP: Prog
  private showP: Prog
  private lineP_: Prog | null = null
  private pointP_: Prog | null = null
  private ptDepthP_: Prog | null = null
  private pic: Target | null = null
  private depth: { tex: WebGLTexture; fbo: WebGLFramebuffer; rb: WebGLRenderbuffer; w: number; h: number } | null = null
  private depthReady = false
  private blankTex: WebGLTexture | null = null
  private gpu: GpuMesh | null = null
  private inputs: Record<string, number | number[]> = {}
  private clock = new SlotClock()
  private side: WebGLTexture | null = null
  private path: string | null = null
  private files: readonly string[] = []
  private ax = 0 // the spin's own turn on each axis, radians
  private ay = 0
  private az = 0
  // (the slow motions' phases, each integrated from its own speed and wrapped where
  // its noise repeats (64, or 1 for the skin's scroll) : a knob turned never jumps
  // one, and none of them pops after hours in an installation)
  private wobT = Math.random() * 64
  private scrollT = 0
  private flowT = 0
  private filmT: [number, number] = [0, 0]
  private dripT: [number, number, number] = [0, 0, 0]
  private bass = 0
  private mids = 0
  private lastShapeBuild = 0
  // SHATTER : the hits under way, the beat they last fell on, how long it has been
  // broken (its tumble), the drift's clock
  private hits: Hit[] = []
  private onset = new Onset()
  private trig = new Edge()
  private lastBeat = NaN
  private lastOn = -1
  private brokenFor = 0
  private shT = Math.random() * Math.PI * 2
  /** how broken it is this frame (a test hook reads it) */
  shatterNow = 0
  private solidShP_: Prog | null = null
  private depthShP_: Prog | null = null
  private lineShP_: Prog | null = null
  private pointShP_: Prog | null = null
  private ptDepthShP_: Prog | null = null
  private dustP_: Prog | null = null
  private dustLineP_: Prog | null = null
  // what it covers, for the hand (pointerInput.ts) : the last frame's projection
  private cover = new HitCover()
  private seen: { mvp: Float32Array; off: [number, number]; ptR: number } | null = null
  private cpx = new Float32Array(0)
  private cpy = new Float32Array(0)
  private cok = new Uint8Array(0)
  // (which vertices this cover's triangles projected already : one stamp a fill)
  private cstamp = new Uint32Array(0)
  private cserial = 0
  // the frame's matrices, reused (never a new array a frame)
  private mx = { rx: m4(), ry: m4(), rz: m4(), sc: m4(), t1: m4(), t2: m4(), m0: m4(), held: m4(), v: m4(), mv: m4(), p: new Float32Array(16), nm: new Float32Array(9), mvp: m4() }

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    const g = (this.g = new EngineGL(gl, 'model'))
    this.solidP = g.prog(SOLID_FS, SOLID_VS)
    this.depthP = g.prog(DEPTH_FS, SOLID_VS)
    this.showP = g.prog(SHOW_FS)
    acquireMsaa()
  }

  // (line and point programs only once a look needs them : less to compile up front)
  private get lineP(): Prog { return (this.lineP_ ??= this.g.prog(LINE_FS, LINE_VS)) }
  private get pointP(): Prog { return (this.pointP_ ??= this.g.prog(POINT_FS, POINT_VS)) }
  private get ptDepthP(): Prog { return (this.ptDepthP_ ??= this.g.prog(POINT_DEPTH_FS, POINT_VS)) }
  // (the shards' programs once something breaks, or ahead of it : warmShards)
  private get solidShP(): Prog { return (this.solidShP_ ??= this.g.prog(SOLID_FS, SOLID_SHARD_VS)) }
  private get depthShP(): Prog { return (this.depthShP_ ??= this.g.prog(DEPTH_FS, SOLID_SHARD_VS)) }
  private get lineShP(): Prog { return (this.lineShP_ ??= this.g.prog(LINE_SHARD_FS, LINE_SHARD_VS)) }
  private get pointShP(): Prog { return (this.pointShP_ ??= this.g.prog(POINT_FS, POINT_SHARD_VS)) }
  private get ptDepthShP(): Prog { return (this.ptDepthShP_ ??= this.g.prog(POINT_DEPTH_FS, POINT_SHARD_VS)) }
  private get dustP(): Prog { return (this.dustP_ ??= this.g.prog(DUST_FS, DUST_VS)) }
  private get dustLineP(): Prog { return (this.dustLineP_ ??= this.g.prog(DUST_LINE_FS, DUST_VS)) }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
    if (this.trig.fired(num(inputs, 'shatterNow', 0))) this.fire(1, true)
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
    if (name === 'shatterNow' && typeof value === 'number' && this.trig.fired(value)) this.fire(1, true)
  }

  /** A remote event : SHATTER (or its trigger's own name) breaks it now. */
  event(name: string): void {
    if (name === 'shatter' || name === 'shatterNow') this.fire(1, true)
  }

  /** A hit : every shard thrown out, gathered back over GATHER seconds. */
  private fire(strength: number, byHand = false): void {
    const I = this.inputs
    const amt = Math.max(0, Math.min(1, num(I, 'shatter', 0.7)))
    // the trigger always breaks it (at least half way), the sound and the beat by SHATTER
    const s = Math.min(1, byHand ? Math.max(strength * amt, 0.5) : strength * amt)
    if (s <= 0.001) return
    if (this.hits.length >= MAX_HITS) this.hits.shift()
    this.hits.push({ age: 0, s, gather: Math.max(0.2, Math.min(8, num(I, 'gather', 1.5))) })
  }

  /** How broken it is this frame, 0..1 : BROKEN, or the hits under way (thrown out
   *  quickly, hanging a quarter of GATHER, then eased home), whichever is more. */
  private shatterStep(dt: number): number {
    const I = this.inputs
    const on = Math.max(0, Math.min(BREAK_BEATS.length - 1, Math.round(num(I, 'breakOn', 0))))
    const amt = Math.max(0, Math.min(1, num(I, 'shatter', 0.7)))
    const hit = this.onset.hit() // (read every frame : its edge must not go stale)
    if (on !== this.lastOn) { this.lastOn = on; this.lastBeat = NaN }
    if (amt > 0.001) {
      if (on === 1 && hit > 0) this.fire(hit)
      else if (BREAK_BEATS[on] !== 0) {
        // on the shared beat clock (Ableton Link's while it is on) : every linked app's beats
        const b = BREAK_BEATS[on]
        const per = b > 0 ? b : -b * soniBar()
        const n = Math.floor(soniBeats() / per + 1e-6)
        if (Number.isFinite(n)) {
          if (Number.isFinite(this.lastBeat) && n !== this.lastBeat) this.fire(1)
          this.lastBeat = n
        }
      }
    }
    let e = Math.max(0, Math.min(1, num(I, 'broken', 0)))
    for (const h of this.hits) {
      h.age += dt
      const out = 1 - Math.exp(-h.age / 0.06)
      const home = smoother((h.age - h.gather * 0.25) / (h.gather * 0.75))
      e = Math.max(e, h.s * out * (1 - home))
    }
    this.hits = this.hits.filter((h) => h.age < h.gather + 0.05)
    // its tumble : the time it has been broken, easing to a stop past a few seconds
    this.brokenFor = e > 1e-4 ? this.brokenFor + dt : 0
    this.shT = (this.shT + dt * 0.6) % (Math.PI * 2)
    return e
  }

  /** The data textures and the lines' vertex array the shards read, made once a mesh.
   *  In steps, so it can be made ahead of the first hit a little each frame (warmShards,
   *  `budgetMs`) instead of all at once on the frame it breaks : the arrays filled in
   *  slices, the textures uploaded a band of rows at a time. A hit before it is ready
   *  finishes what is left at once (Infinity). True once the shards can draw. */
  private ensureShards(gp: GpuMesh, budgetMs = Infinity): boolean {
    if (gp.sh && !gp.sh.job) return gp.sh.ok
    const gl = this.g.gl
    const m = gp.mesh
    if (!gp.sh) {
      const sh0: Shards = { ok: false, idx: null, vtx: null, vcol: null, edVao: null, bFace: null, job: null }
      gp.sh = sh0
      if (!m.idx) return false
      const nV = m.pos.length / 3, nT = m.idx.length / 3
      const rowsV = Math.ceil((nV * 2) / PULL_W), rowsC = Math.ceil(nV / PULL_W), rowsT = Math.ceil(nT / PULL_W)
      if (Math.max(rowsV, rowsT) > (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number)) return false
      sh0.job = { stage: 0, i: 0, nV, nT, rowsV, rowsC, rowsT, vd: new Float32Array(rowsV * PULL_W * 4), cd: null, id: new Uint32Array(rowsT * PULL_W * 4) }
    }
    const sh = gp.sh
    const J = sh.job!
    const t0 = performance.now()
    const SLICE = 65536
    const tex = (rows: number, ifmt: number, fmt: number, type: number): WebGLTexture => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, PULL_W, rows, 0, fmt, type, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindTexture(gl.TEXTURE_2D, null)
      return t
    }
    // a band of rows into its texture (about 4 MB a band while warming, all at once on a hit)
    const band = (t: WebGLTexture, rows: number, fmt: number, type: number, data: Float32Array | Uint32Array | Uint8Array): boolean => {
      const w = data.length / rows // numbers a row
      const per = budgetMs === Infinity ? rows : Math.max(1, Math.floor((4 << 20) / (w * data.BYTES_PER_ELEMENT)))
      const y0 = J.i, y1 = Math.min(rows, y0 + per)
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, PULL_W, y1 - y0, fmt, type, data.subarray(y0 * w, y1 * w))
      gl.bindTexture(gl.TEXTURE_2D, null)
      J.i = y1
      if (y1 < rows) return false
      J.i = 0
      J.stage++
      return true
    }
    while (J.stage < 7) {
      if (J.stage === 0) {
        // the vertices : place and u, then normal and v
        const vd = J.vd!
        const end = Math.min(J.nV, J.i + SLICE)
        for (let v = J.i; v < end; v++) {
          const o = v * 8
          vd[o] = m.pos[v * 3]; vd[o + 1] = m.pos[v * 3 + 1]; vd[o + 2] = m.pos[v * 3 + 2]; vd[o + 3] = m.uv[v * 2]
          vd[o + 4] = m.nrm[v * 3]; vd[o + 5] = m.nrm[v * 3 + 1]; vd[o + 6] = m.nrm[v * 3 + 2]; vd[o + 7] = m.uv[v * 2 + 1]
        }
        J.i = end
        if (end >= J.nV) { J.i = 0; J.stage++ }
      } else if (J.stage === 1) {
        // the triangles, then the colors (as they are, padded to whole rows)
        const id = J.id!, ix = m.idx!
        const end = Math.min(J.nT, J.i + SLICE)
        for (let t = J.i; t < end; t++) { id[t * 4] = ix[t * 3]; id[t * 4 + 1] = ix[t * 3 + 1]; id[t * 4 + 2] = ix[t * 3 + 2] }
        J.i = end
        if (end >= J.nT) {
          J.cd = new Uint8Array(J.rowsC * PULL_W * 4)
          J.cd.set(m.col.subarray(0, J.nV * 4))
          J.i = 0
          J.stage++
        }
      } else if (J.stage === 2) {
        sh.vtx = tex(J.rowsV, gl.RGBA32F, gl.RGBA, gl.FLOAT)
        sh.vcol = tex(J.rowsC, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)
        sh.idx = tex(J.rowsT, gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT)
        J.stage++
      } else if (J.stage === 3) {
        if (band(sh.vtx!, J.rowsV, gl.RGBA, gl.FLOAT, J.vd!)) J.vd = null
      } else if (J.stage === 4) {
        if (band(sh.vcol!, J.rowsC, gl.RGBA, gl.UNSIGNED_BYTE, J.cd!)) J.cd = null
      } else if (J.stage === 5) {
        if (band(sh.idx!, J.rowsT, gl.RGBA_INTEGER, gl.UNSIGNED_INT, J.id!)) J.id = null
      } else {
        // the lines : every edge twice (its attributes step every second instance), with
        // the two faces it borders
        if (gp.bE && m.edgeFaces && gp.nEdge) {
          const vao = gl.createVertexArray()!
          gl.bindVertexArray(vao)
          gl.bindBuffer(gl.ARRAY_BUFFER, gp.bE)
          for (let k = 0; k < 4; k++) {
            gl.enableVertexAttribArray(k)
            gl.vertexAttribPointer(k, 3, gl.FLOAT, false, 48, k * 12)
            gl.vertexAttribDivisor(k, 2)
          }
          const bF = gl.createBuffer()!
          gl.bindBuffer(gl.ARRAY_BUFFER, bF)
          gl.bufferData(gl.ARRAY_BUFFER, m.edgeFaces, gl.STATIC_DRAW)
          gl.enableVertexAttribArray(4)
          gl.vertexAttribIPointer(4, 2, gl.UNSIGNED_INT, 0, 0)
          gl.vertexAttribDivisor(4, 2)
          gl.bindVertexArray(null)
          gl.bindBuffer(gl.ARRAY_BUFFER, null)
          sh.edVao = vao
          sh.bFace = bF
        }
        J.stage++
      }
      if (J.stage < 7 && performance.now() - t0 > budgetMs) return false
    }
    sh.job = null
    sh.ok = true
    return true
  }

  /** The shards made ahead of the first hit, a little a frame, then the programs this
   *  look draws them with, one a frame (else all of it is made on the frame of the
   *  first hit, and the picture stalls there) : at once while a hit is likely (it
   *  breaks on the sound or the beat, or is held broken), else once the mesh has been
   *  on screen a few seconds (never with its loading), a dense mesh's data then left
   *  for the hit itself (hundreds of megabytes kept for a hit that may never come). */
  private warmShards(gp: GpuMesh, style: number): void {
    const I = this.inputs
    const broken = num(I, 'broken', 0) > 0.001
    if (num(I, 'shatter', 0.7) <= 0.001 && !broken) return
    const likely = broken || Math.round(num(I, 'breakOn', 0)) !== 0
    if (!likely && performance.now() - gp.born < 3000) return
    if (gp.nIdx) {
      if (gp.sh && !gp.sh.job && !gp.sh.ok) return // too big to break
      if ((!gp.sh || gp.sh.job) && (likely || gp.nIdx / 3 <= 250_000)) { this.ensureShards(gp, 3); return }
    }

    // [made already, make it]
    const progs: Array<[Prog | null, () => Prog]> = []
    const solid = style === STYLE_SOLID || style === STYLE_SOLID_EDGES
    if (!gp.nIdx) progs.push([this.pointShP_, () => this.pointShP], [this.ptDepthShP_, () => this.ptDepthShP])
    else if (style === STYLE_POINTS) progs.push([this.pointShP_, () => this.pointShP], [this.depthShP_, () => this.depthShP])
    else {
      if (solid) progs.push([this.solidShP_, () => this.solidShP])
      progs.push([this.depthShP_, () => this.depthShP])
      if (style !== STYLE_SOLID && gp.edVao) progs.push([this.lineShP_, () => this.lineShP])
      if (num(I, 'dust', 0) > 0) progs.push(solid ? [this.dustP_, () => this.dustP] : [this.dustLineP_, () => this.dustLineP])
    }
    for (const [have, make] of progs) if (!have) { make(); return }
  }

  feed(_audio: WebGLTexture | null, side: WebGLTexture | null): void {
    this.side = side
  }

  file(path: string | null, files: readonly string[] = []): void {
    this.path = path || null
    this.files = files
  }

  status(): string {
    const I = this.inputs
    const shape = Math.round(num(I, 'shape', 14))
    if (shape === SHAPE_FILE) {
      if (!this.path) return 'no file : open one in the Inspector, or drop it on the layer'
      const st = modelLoader.peek(this.path)
      if (!st || st.state === 'loading') return 'reading the model…'
      if (st.state === 'error') return st.message
    }
    const m = this.gpu?.mesh.info
    if (!m) return ''
    const k = (n: number): string => (n < 1000 ? String(n) : n < 1e5 ? `${Math.round(n / 100) / 10}K` : `${Math.round(n / 1000)}K`)
    return m.points ? `${k(m.verts)} points` : `${k(m.tris)} triangles`
  }

  /** The model's real depth (nearest white), while TRUE DEPTH is on and it has drawn
   *  one; the compositor hands it to the depth readers in place of the depth AI. */
  depthTexture(): WebGLTexture | null {
    return this.depthReady && num(this.inputs, 'depthOut', 1) > 0.5 ? this.depth?.tex ?? null : null
  }

  private blank(): WebGLTexture {
    const gl = this.g.gl
    if (this.blankTex) return this.blankTex
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.blankTex = t
    return t
  }

  // ── The mesh on the GPU ─────────────────────────────────────────────────────
  private upload(key: string, mesh: MeshData): void {
    const gl = this.g.gl
    this.freeGpu()
    const buf = (target: number, data: ArrayBufferView): WebGLBuffer => {
      const b = gl.createBuffer()!
      gl.bindBuffer(target, b)
      gl.bufferData(target, data, gl.STATIC_DRAW)
      return b
    }
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const bPos = buf(gl.ARRAY_BUFFER, mesh.pos)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
    const bN = buf(gl.ARRAY_BUFFER, mesh.nrm)
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0)
    const bUV = buf(gl.ARRAY_BUFFER, mesh.uv)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0)
    const bC = buf(gl.ARRAY_BUFFER, mesh.col)
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 0, 0)
    const bufs = [bPos, bN, bUV, bC]
    if (mesh.idx) bufs.push(buf(gl.ELEMENT_ARRAY_BUFFER, mesh.idx)) // (bound while this vertex array is : it keeps it)
    // the points : the same vertices, one quad each
    const ptVao = gl.createVertexArray()!
    gl.bindVertexArray(ptVao)
    const inst = (loc: number, b: WebGLBuffer, n: number, type: number, normalized: boolean): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, b)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, n, type, normalized, 0, 0)
      gl.vertexAttribDivisor(loc, 1)
    }
    inst(0, bPos, 3, gl.FLOAT, false); inst(1, bN, 3, gl.FLOAT, false); inst(2, bUV, 2, gl.FLOAT, false); inst(3, bC, 4, gl.UNSIGNED_BYTE, true)
    // the edges : one quad each, from its two ends and its two faces
    let edVao: WebGLVertexArrayObject | null = null
    let bE: WebGLBuffer | null = null
    if (mesh.edges && mesh.edges.length) {
      edVao = gl.createVertexArray()!
      gl.bindVertexArray(edVao)
      bE = buf(gl.ARRAY_BUFFER, mesh.edges)
      bufs.push(bE)
      for (let k = 0; k < 4; k++) {
        gl.enableVertexAttribArray(k)
        gl.vertexAttribPointer(k, 3, gl.FLOAT, false, 48, k * 12)
        gl.vertexAttribDivisor(k, 1)
      }
    }
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    let tex: WebGLTexture | null = null
    if (mesh.texture) {
      tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false) // glTF's v runs down, as the image's rows
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, mesh.texture)
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
      } catch {
        gl.deleteTexture(tex)
        tex = null
      }
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    this.gpu = {
      key, mesh, vao, ptVao, edVao, bufs, tex, bE, sh: null, born: performance.now(),
      nIdx: mesh.idx ? mesh.idx.length : 0, nVert: mesh.pos.length / 3, nEdge: mesh.edges ? mesh.edges.length / 12 : 0
    }
  }

  private freeGpu(): void {
    const gp = this.gpu
    if (!gp) return
    const gl = this.g.gl
    // (deleted with its own vertex array bound : never the default one's binding)
    gl.bindVertexArray(gp.vao)
    for (const b of gp.bufs) gl.deleteBuffer(b)
    if (gp.sh?.bFace) gl.deleteBuffer(gp.sh.bFace)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(gp.vao)
    gl.deleteVertexArray(gp.ptVao)
    if (gp.edVao) gl.deleteVertexArray(gp.edVao)
    if (gp.tex) gl.deleteTexture(gp.tex)
    if (gp.sh) {
      if (gp.sh.edVao) gl.deleteVertexArray(gp.sh.edVao)
      for (const t of [gp.sh.idx, gp.sh.vtx, gp.sh.vcol]) if (t) gl.deleteTexture(t)
    }
    this.gpu = null
  }

  /** The mesh this frame : the file when the shape says so and it is read, else the
   *  built-in shape (rebuilt at most every 60 ms while its segments or tube move). */
  private pickMesh(needEdges: boolean): void {
    const I = this.inputs
    const shape = Math.max(0, Math.min(SHAPE_FILE, Math.round(num(I, 'shape', 14))))
    if (shape === SHAPE_FILE && this.path) {
      const st = modelLoader.get(this.path, this.files)
      const key = 'file:' + this.path
      if (st.state === 'ready') {
        if (this.gpu?.key !== key || this.gpu.mesh !== st.mesh) this.upload(key, st.mesh)
        return
      }
      // still reading (keep what is shown) or failed (a sphere stands in)
      if (st.state === 'loading' && this.gpu) return
    }
    const s = shape === SHAPE_FILE ? 0 : shape
    const seg = Math.round(num(I, 'segments', 48))
    const tk = Math.round(num(I, 'thickness', 0.35) * 100) / 100
    const key = `shape:${s}:${seg}:${SHAPES[s] === 'torus' || SHAPES[s] === 'knot' ? tk : 0}:${needEdges ? 1 : 0}`
    if (this.gpu?.key === key) return
    const now = performance.now()
    // (under modulation the segments step a little behind : never a rebuild every frame)
    if (this.gpu && this.gpu.key.startsWith('shape:') && now - this.lastShapeBuild < 60) return
    this.lastShapeBuild = now
    // a shape built with its edges keeps them, so turning a line look off and on costs nothing
    if (!needEdges && this.gpu?.key === key.slice(0, -1) + '1') return
    this.upload(key, prepareMesh(buildShape(s, seg, tk), needEdges))
  }

  private ensureTargets(wantDepth: boolean): void {
    const g = this.g, gl = g.gl
    if (!this.pic) this.pic = g.target(this.w, this.h, { float: false })
    if (wantDepth && !this.depth) {
      // the depth readers read it filtered and coarse : half size, at most 1024 a side
      const k = Math.min(0.5, 1024 / Math.max(this.w, this.h))
      const dw = Math.max(16, Math.round(this.w * k)), dh = Math.max(16, Math.round(this.h * k))
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, dw, dh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindTexture(gl.TEXTURE_2D, null)
      const rb = gl.createRenderbuffer()!
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb)
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, dw, dh)
      gl.bindRenderbuffer(gl.RENDERBUFFER, null)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      this.depth = { tex, fbo, rb, w: dw, h: dh }
    }
  }

  render(targetFbo: WebGLFramebuffer, clockSec: number): void {
    const g = this.g
    const gl = g.gl
    if (!g.ok) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return
    }
    const I = this.inputs
    const dt = this.clock.tick(clockSec)
    let style = Math.max(0, Math.min(4, Math.round(num(I, 'style', 0))))
    const lines = style === STYLE_WIRE || style === STYLE_EDGES || style === STYLE_SOLID_EDGES
    this.pickMesh(lines)
    const gp = this.gpu
    if (!gp) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return
    }
    // a point cloud has only its points; a mesh too dense for edges draws solid
    if (!gp.nIdx) style = STYLE_POINTS
    else if (lines && !gp.edVao) style = STYLE_SOLID
    const wantDepth = num(I, 'depthOut', 1) > 0.5
    this.ensureTargets(wantDepth)

    // ── SHATTER : how broken; the shards' path only while anything is (else the mesh
    // draws as it always has) ──
    const shE = this.shatterStep(dt)
    this.shatterNow = shE
    const sh = shE > 1e-4 && (!gp.nIdx || this.ensureShards(gp))
    if (!sh) this.warmShards(gp, style)
    const shThrow = Math.max(0, num(I, 'throw', 0.8))
    const shGrav = Math.max(-1, Math.min(1, num(I, 'gravity', 0.2)))
    const shDrift = Math.max(0, Math.min(1, num(I, 'drift', 0.2)))
    const shCrumble = Math.max(0, Math.min(1, num(I, 'crumble', 0.3)))
    const shDust = Math.max(0, Math.min(1, num(I, 'dust', 0)))

    // ── the sound : the bass swells it, the mids roughen it ──
    const amt = Math.max(0, Math.min(1, num(I, 'audio', 0)))
    let bassT = 0, midsT = 0
    if (amt > 0) {
      bassT = Math.min(1, (audioBus.feature('band', 0) + audioBus.feature('band', 1)) * 0.8)
      midsT = Math.min(1, (audioBus.feature('band', 2) + audioBus.feature('band', 3)) * 0.8)
    }
    const env = (cur: number, to: number): number => cur + (to - cur) * (1 - Math.exp(-dt / (to > cur ? 0.04 : 0.25)))
    this.bass = env(this.bass, bassT * amt)
    this.mids = env(this.mids, midsT * amt)

    // ── the object and the camera ──
    const fill = domeFill() > 0
    const asp = fill ? 1 : this.w / Math.max(1, this.h)
    const spin = num(I, 'spin', 0.15) * 2 // radians a second
    const axis = Math.round(num(I, 'spinAxis', 0))
    const TWO = Math.PI * 2
    if (axis === 0) this.ay = (this.ay + spin * dt) % TWO
    else if (axis === 1) this.ax = (this.ax + spin * dt) % TWO
    else if (axis === 2) this.az = (this.az + spin * dt) % TWO
    else { this.ay = (this.ay + spin * dt) % TWO; this.ax = (this.ax + spin * 0.63 * dt) % TWO; this.az = (this.az + spin * 0.37 * dt) % TWO }
    const scale = Math.max(0.05, num(I, 'scale', 1)) * (1 + 0.3 * this.bass)
    const wob = Math.max(0, num(I, 'wobble', 0)) + this.mids * 0.6
    // (wrapped at 640 : the noise repeats every 64, and its second octave runs 1.3 times
    // as fast, 640 and 832 both whole repeats)
    this.wobT = (this.wobT + dt * Math.max(0, num(I, 'wobbleSpeed', 0.3)) * 1.2) % 640
    const X = this.mx
    ident(X.sc); X.sc[0] = X.sc[5] = X.sc[10] = scale
    mul4(rotX(num(I, 'tilt', 0.1) * Math.PI + this.ax, X.rx), rotY(num(I, 'turn', 0) * Math.PI + this.ay, X.ry), X.t1)
    mul4(X.t1, rotZ(num(I, 'roll', 0) * Math.PI + this.az, X.rz), X.t2)
    const M0 = mul4(X.t2, X.sc, X.m0)
    // how the hand holds it (dragged on the preview) : the outermost turn, in the
    // camera's own axes, so its spin, turn, tilt and roll all happen in the hand
    const held = quatIn(I['orient'])
    const M = isNoTurn(held) ? M0 : mul4(quatMat4(held), M0, X.held)
    // under full-dome fill it stands back, framed in the middle, clear of the rim
    const dist = Math.max(0.5, num(I, 'distance', 4)) * (fill ? 1.7 : 1)
    const V = ident(X.v); V[14] = -dist
    const MV = mul4(V, M, X.mv)
    const reach = scale * (1 + wob * 0.6)
    // (the shards fly past the object's own reach : the clip planes open to take them,
    // its depth's range stays the object's)
    const shReach = sh ? scale * Math.min(1, shE * (1 + shCrumble)) * (shThrow * 2.6 + Math.abs(shGrav) * 1.8 + shDrift * 1.4 + 0.2) : 0
    const near = Math.max(0.02, dist - (reach + shReach) * 1.2), far = dist + (reach + shReach) * 1.2
    const fov = (Math.max(5, Math.min(150, num(I, 'lens', 35))) * Math.PI) / 180
    const f = 1 / Math.tan(fov / 2)
    const P = X.p
    P.fill(0)
    P[0] = f / asp; P[5] = f; P[10] = (far + near) / (near - far); P[11] = -1; P[14] = (2 * far * near) / (near - far)
    const NM = X.nm
    NM[0] = MV[0] / scale; NM[1] = MV[1] / scale; NM[2] = MV[2] / scale
    NM[3] = MV[4] / scale; NM[4] = MV[5] / scale; NM[5] = MV[6] / scale
    NM[6] = MV[8] / scale; NM[7] = MV[9] / scale; NM[8] = MV[10] / scale
    const off: [number, number] = [num(I, 'posX', 0), num(I, 'posY', 0)]
    const ptR = (Math.max(0.3, num(I, 'pointSize', 2.5)) / 1080) * 0.5
    mul4(P, MV, X.mvp)
    if (this.seen) { this.seen.off = off; this.seen.ptR = ptR } else this.seen = { mvp: X.mvp, off, ptR }
    // the slow motions : the skin's scroll (its picture repeats every 1), the soap
    // film's swirl and the crude's drips (the noise repeats every 64 on each axis; the
    // drips slide along the world's down as it is now, in the model's own frame)
    const wrap = (x: number, w: number): number => ((x % w) + w) % w
    this.scrollT = wrap(this.scrollT + dt * num(I, 'scroll', 0), 1)
    this.flowT = wrap(this.flowT + dt * num(I, 'flowSpeed', 0.3) * 0.25, 8192)
    this.filmT[0] = wrap(this.filmT[0] + dt * 0.05, 64)
    this.filmT[1] = wrap(this.filmT[1] + dt * 0.04, 64)
    {
      const dx = -NM[1], dy = -NM[4] + 1e-5, dz = -NM[7]
      const dl = Math.hypot(dx, dy, dz) || 1
      const k = (dt * 0.14) / dl
      this.dripT[0] = wrap(this.dripT[0] + dx * k, 64)
      this.dripT[1] = wrap(this.dripT[1] + dy * k, 64)
      this.dripT[2] = wrap(this.dripT[2] + dz * k, 64)
    }
    // the depth of the shape's own reach : its front white, its back black
    const near0 = dist - reach, far0 = dist + reach

    const common = (p: Prog): Prog => {
      gl.uniformMatrix4fv(p.u('uMV'), false, MV)
      gl.uniformMatrix4fv(p.u('uP'), false, P)
      gl.uniformMatrix3fv(p.u('uNM'), false, NM)
      return p.f2('uOff', off[0], off[1]).f1('uWob', wob).f1('uWobS', Math.max(0.1, num(I, 'wobbleSize', 1.5))).f1('uWobT', this.wobT)
        .f1('uNear0', near0).f1('uFar0', far0)
    }
    const px = this.h / 1080
    // the shards : in use (and its uniforms set) when anything is broken, else the usual program
    const shardU = (p: Prog): Prog =>
      p.f1('uShE', shE).f1('uShThrow', shThrow).f1('uShScat', Math.max(0, Math.min(1, num(I, 'scatter', 0.35))))
        .f1('uShSpin', Math.max(0, Math.min(1, num(I, 'shardSpin', 0.4)))).f1('uShCrumble', shCrumble)
        .f1('uShGrav', shGrav).f1('uShDrift', shDrift).f1('uShDust', shDust)
        .f1('uShDustAt', Math.max(0, Math.min(1, num(I, 'dustAt', 0.6)))).f1('uShT', this.shT)
        .f1('uShTumble', 4 * (1 - Math.exp(-this.brokenFor / 4)))
        // the world's down in the model's own frame (the rows of its turn)
        .f3('uShDown', -NM[1], -NM[4], -NM[7])
        .f1('uDustPx', Math.max(0.3, num(I, 'dustSize', 1.5)) * px)
        .i1('uIdx', 5).i1('uVtx', 6).i1('uVcol', 7)
    const pick = (normal: Prog, shard: () => Prog): Prog => (sh ? shardU(shard().use()) : normal.use())
    if (sh && gp.sh?.ok) {
      g.bind(5, gp.sh.idx)
      g.bind(6, gp.sh.vtx)
      g.bind(7, gp.sh.vcol)
    }
    // the light and the looks
    const la = num(I, 'lightAngle', 2.36)
    const lh = Math.max(0, Math.min(1, num(I, 'lightHeight', 0.55)))
    const lz = 0.2 + 0.9 * lh
    const ln = Math.hypot(1, lz)
    const [cr, cg, cb] = col(I, 'color', [0.78, 0.74, 0.7])
    const [gr, gg, gb] = col(I, 'ground', [0.02, 0.02, 0.025])
    const ga = Math.max(0, Math.min(1, num(I, 'groundOp', 0)))
    const info = gp.mesh.info
    const hasFile = gp.key.startsWith('file:') && (info.hasColor || info.hasTex) ? 1 : 0
    const hasSide = this.side ? 1 : 0
    const shade = (p: Prog): Prog => {
      p.f2('uRes', this.w, this.h).f2('uAspect', asp, 1)
        .f3('uColor', cr, cg, cb).f3('uGround', gr, gg, gb).f1('uGroundA', ga)
        .f3('uL', Math.cos(la) / ln, Math.sin(la) / ln, lz / ln).f1('uAz', la)
        .f1('uMat', Math.round(num(I, 'material', 4))).f1('uMatcap', Math.round(num(I, 'matcap', 0)))
        .f1('uFileColor', Math.max(0, Math.min(1, num(I, 'fileColor', 1)))).f1('uHasFile', hasFile).f1('uHasTex', gp.tex ? 1 : 0)
        .f1('uGloss', Math.max(0, Math.min(1, num(I, 'gloss', 0.5)))).f1('uCav', Math.max(0, Math.min(1, num(I, 'cavity', 0.3))))
        .f1('uFacets', num(I, 'facets', 0) > 0.5 ? 1 : 0).f1('uFilm', Math.max(0, Math.min(1, num(I, 'film', 0))))
        .f1('uFilmNm', Math.max(0, Math.min(1, num(I, 'filmThick', 0.4)))).f1('uLight', Math.max(0, num(I, 'light', 1)))
        .f1('uAmb', Math.max(0, Math.min(1, num(I, 'ambient', 0.2))))
        .f1('uSkin', Math.max(0, Math.min(1, num(I, 'skin', 0)))).f1('uSkinMode', Math.round(num(I, 'skinMode', 0))).f1('uHasSide', hasSide)
        .f1('uTile', Math.max(0.05, num(I, 'tile', 1))).f1('uScrollT', this.scrollT).f1('uFog', Math.max(0, Math.min(1, num(I, 'fog', 0))))
        .f2('uFilmT', this.filmT[0], this.filmT[1]).f3('uCrRun', this.dripT[0], this.dripT[1], this.dripT[2]).f1('uFpx', Math.tan(fov / 2) * 2 / this.h)
        // the shared materials' extras : flowing bands, the foil
        .f1('uFlow', Math.max(0, Math.min(1, num(I, 'flow', 0)))).f1('uFlowT', this.flowT)
        .f1('uBands', 3).f1('uSplit', 0.5).f1('uRipple', 0.3)
        .f1('uFoilSat', Math.max(0, Math.min(1, num(I, 'rainbow', 0.7)))).f1('uFoilScale', 40 + 260 * Math.max(0, Math.min(1, num(I, 'flakes', 0.5))))
        .f1('uFoilGlint', Math.max(0, Math.min(1, num(I, 'glint', 0.4))))
        // the crude coat (the world's down in the model's own frame, as the shards read it)
        .f1('uCrude', Math.max(0, Math.min(1, num(I, 'crude', 0)))).f1('uCrDrip', Math.max(0, Math.min(1, num(I, 'crudeDrips', 0.4))))
        .f1('uCrSheen', Math.max(0, Math.min(1, num(I, 'crudeSheen', 0.7))))
        .f3('uCrDown', -NM[1], -NM[4], -NM[7]).f3('uCrCol', 0.035, 0.026, 0.02)
        .i1('uTex', 2).i1('uSide', 3)
      return p
    }
    g.bind(2, gp.tex ?? this.blank())
    g.bind(3, this.side ?? this.blank())

    // ── the picture, multisampled ──
    const ms = msaaBuffer(gl, this.w, this.h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, ms.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.colorMask(true, true, true, true)
    gl.depthMask(true)
    gl.clearColor(gr * ga, gg * ga, gb * ga, ga)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    // premultiplied over : lines and points cover what is under them at their edges
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const glass = Math.round(num(I, 'material', 4)) === 5
    const hidden = num(I, 'hidden', 0) > 0.5
    const drawSolid = (_p: Prog): void => {
      if (sh) {
        // the shards : three corners a triangle, everything read from the data textures
        gl.bindVertexArray(g.pointVao)
        gl.drawArrays(gl.TRIANGLES, 0, gp.nIdx)
        return
      }
      gl.bindVertexArray(gp.vao)
      gl.drawElements(gl.TRIANGLES, gp.nIdx, gl.UNSIGNED_INT, 0)
    }
    if (style === STYLE_SOLID || style === STYLE_SOLID_EDGES) {
      // glass shows only its front (its back would double it); the rest both sides
      if (glass) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK) }
      if (style === STYLE_SOLID_EDGES) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1) }
      drawSolid(shade(common(pick(this.solidP, () => this.solidShP))))
      gl.disable(gl.CULL_FACE)
      gl.disable(gl.POLYGON_OFFSET_FILL)
    } else if (style !== STYLE_POINTS && hidden) {
      // the lines behind the model hidden : its depth first, no color
      gl.colorMask(false, false, false, false)
      gl.enable(gl.POLYGON_OFFSET_FILL)
      gl.polygonOffset(1, 1)
      drawSolid(common(pick(this.depthP, () => this.depthShP)))
      gl.disable(gl.POLYGON_OFFSET_FILL)
      gl.colorMask(true, true, true, true)
    }
    if (style === STYLE_WIRE || style === STYLE_EDGES || style === STYLE_SOLID_EDGES) {
      const [lr, lg, lb] = col(I, 'lineColor', [0.92, 0.94, 0.95])
      const wpx = Math.max(1, Math.max(0.3, num(I, 'lineWidth', 1.2)) * px)
      const crease = Math.cos((Math.max(1, Math.min(179, num(I, 'edgeAngle', 30))) * Math.PI) / 180)
      const see = style !== STYLE_SOLID_EDGES && !hidden
      if (see) gl.disable(gl.DEPTH_TEST)
      gl.depthMask(false)
      const shLines = sh && !!gp.sh?.edVao
      common(shLines ? shardU(this.lineShP.use()) : this.lineP.use()).f2('uRes', this.w, this.h).f1('uWidth', wpx).f1('uAll', style === STYLE_WIRE ? 1 : 0).f1('uCrease', crease)
        .f3('uLineC', lr, lg, lb).f3('uGround', gr, gg, gb).f1('uGroundA', ga).f1('uFog', Math.max(0, Math.min(1, num(I, 'fog', 0))))
      if (shLines) {
        gl.bindVertexArray(gp.sh!.edVao)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gp.nEdge * 2)
      } else {
        gl.bindVertexArray(gp.edVao)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gp.nEdge)
      }
      gl.depthMask(true)
      gl.enable(gl.DEPTH_TEST)
    } else if (style === STYLE_POINTS) {
      shade(common(pick(this.pointP, () => this.pointShP))).f1('uSize', Math.max(0.3, num(I, 'pointSize', 2.5)) * px).f1('uDist', dist)
      gl.bindVertexArray(gp.ptVao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gp.nVert)
    }
    // DUST : the shards shrunk to points, one a triangle (the points look's beads shrink
    // on their own)
    if (sh && gp.nIdx && shDust > 0 && style !== STYLE_POINTS && shE * (1 + shCrumble) > Math.max(0, Math.min(1, num(I, 'dustAt', 0.6)))) {
      gl.depthMask(false)
      const [lr, lg, lb] = col(I, 'lineColor', [0.92, 0.94, 0.95])
      const dp = style === STYLE_SOLID || style === STYLE_SOLID_EDGES
        ? shade(common(shardU(this.dustP.use())))
        : common(shardU(this.dustLineP.use())).f3('uLineC', lr, lg, lb).f3('uGround', gr, gg, gb).f1('uGroundA', ga).f1('uFog', Math.max(0, Math.min(1, num(I, 'fog', 0))))
      dp.f2('uRes', this.w, this.h).f1('uDist', dist)
      gl.bindVertexArray(g.pointVao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gp.nIdx / 3)
      gl.depthMask(true)
    }
    gl.disable(gl.BLEND)

    // ── its real depth, for the depth readers ──
    this.depthReady = false
    if (wantDepth && this.depth) {
      const d = this.depth
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo)
      gl.viewport(0, 0, d.w, d.h)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.depthFunc(gl.LESS)
      if (gp.nIdx) drawSolid(common(pick(this.depthP, () => this.depthShP)))
      else {
        common(pick(this.ptDepthP, () => this.ptDepthShP)).f2('uRes', d.w, d.h).f1('uSize', Math.max(0.3, num(I, 'pointSize', 2.5)) * (d.h / 1080)).f1('uDist', dist)
        gl.bindVertexArray(gp.ptVao)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gp.nVert)
      }
      this.depthReady = true
    }
    gl.bindVertexArray(null)
    gl.disable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)

    // ── resolved, then straight alpha into the layer ──
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms.fbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.pic!.fbo)
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    this.showP.use().i1('uPic', 0)
    g.bind(0, this.pic!.tex)
    g.draw(targetFbo, this.w, this.h)
    g.done(sh ? 8 : 4)
  }

  /** Is the frame point (u, v : 0..1, v up) on the object as it drew its last frame
   *  (pointerInput.ts : the hand grabs what is under it, the wheel zooms it). The
   *  cover is filled from the mesh's own vertices through that frame's projection,
   *  at most every 120 ms, a dense mesh read one triangle in a few (its triangles
   *  are far smaller than a cell). Its wobble and flying shards are left out. */
  hitTest(u: number, v: number): boolean {
    const gp = this.gpu, s = this.seen
    if (!gp || !s) return false
    if (this.cover.stale()) this.fillCover(gp, s)
    return this.cover.hit(u, v)
  }

  private fillCover(gp: GpuMesh, s: { mvp: Float32Array; off: [number, number]; ptR: number }): void {
    const c = this.cover
    c.begin(this.w / Math.max(1, this.h))
    const pos = gp.mesh.pos, n = pos.length / 3, m = s.mvp
    const ox = s.off[0], oy = s.off[1]
    const idx = gp.mesh.idx
    const BUDGET = 150000
    if (idx && idx.length) {
      // only the corners of the triangles read (at most BUDGET of them), each once :
      // a dense mesh is never projected whole while the pointer moves
      if (this.cpx.length < n) { this.cpx = new Float32Array(n); this.cpy = new Float32Array(n); this.cok = new Uint8Array(n); this.cstamp = new Uint32Array(n) }
      if (++this.cserial >= 0xffffffff) { this.cstamp.fill(0); this.cserial = 1 }
      const px = this.cpx, py = this.cpy, ok = this.cok, st = this.cstamp, ser = this.cserial
      const at = (k: number): boolean => {
        if (st[k] !== ser) {
          st[k] = ser
          const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2]
          const w = m[3] * x + m[7] * y + m[11] * z + m[15]
          if (w < 1e-3) ok[k] = 0
          else {
            ok[k] = 1
            px[k] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w + ox
            py[k] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w + oy
          }
        }
        return ok[k] === 1
      }
      const nT = idx.length / 3
      const step = Math.max(1, Math.ceil(nT / BUDGET))
      for (let t = 0; t < nT; t += step) {
        const a = idx[t * 3], b = idx[t * 3 + 1], d = idx[t * 3 + 2]
        if (at(a) && at(b) && at(d)) c.tri(px[a], py[a], px[b], py[b], px[d], py[d])
      }
    } else {
      // the points read : each projected as it is laid
      const step = Math.max(1, Math.ceil(n / BUDGET))
      for (let k = 0; k < n; k += step) {
        const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2]
        const w = m[3] * x + m[7] * y + m[11] * z + m[15]
        if (w < 1e-3) continue
        c.dot((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + ox, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w + oy, s.ptR)
      }
    }
  }

  dispose(): void {
    const g = this.g, gl = g.gl
    this.freeGpu()
    g.freeTarget(this.pic)
    this.pic = null
    if (this.depth) {
      gl.deleteFramebuffer(this.depth.fbo)
      gl.deleteRenderbuffer(this.depth.rb)
      gl.deleteTexture(this.depth.tex)
      this.depth = null
    }
    if (this.blankTex) gl.deleteTexture(this.blankTex)
    this.blankTex = null
    g.dispose()
    releaseMsaa(gl)
  }
}
