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
//
// The lit sphere (matcap) after Sloan, Martin, Gooch and Gooch, "The Lit Sphere"
// (Graphics Interface 2001) : a picture of a lit ball, read by the surface's normal.
// third-party: The Lit Sphere (matcap)

import { EngineGL, SlotClock, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator } from './nativeGenerators'
import { domeFill } from './domeSignal'
import { audioBus } from './audioIn'
import { acquireMsaa, msaaBuffer, releaseMsaa } from './sharedMsaa'
import { RELIEF_SHADE } from './reliefShade'
import { buildShape, prepareMesh, SHAPE_FILE, SHAPES, type MeshData } from './modelMesh'
import { modelLoader } from './modelLoad'

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
uniform float uSkin, uSkinMode, uHasSide, uTile, uScroll, uFog, uT, uFpx;
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
      vec2 w = uvM * uTile + vec2(uScroll * uT, 0.0);
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
    float nm = 160.0 + uFilmNm * 900.0 + (vn3(objP * 2.3 + vec3(uT * 0.05, 0.0, 0.0)) + 0.5 * vn3(objP * 5.1 - vec3(0.0, uT * 0.04, 0.0))) * 380.0;
    c = shadeSurface(M, alb, Nf, Lf, uAz, 0.3 + uGloss * 1.2, refl, reflAmt, uFilm, nm, P);
    c = c * uLight + alb * uAmb * 0.35;
  }
  if (pic && uSkinMode > 2.5) c = mix(c, picC, uSkin);
  // cavity : the creases (where the normals close in) get less light; the ridges a little more
  if (uCav > 0.0) c *= 1.0 - uCav * 0.85 * clamp(-curv * 0.35, 0.0, 1.0) + uCav * 0.12 * clamp(curv * 0.1, 0.0, 1.0);
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
function mul4(a: M4, b: M4): M4 {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
    o[c * 4 + r] = s
  }
  return o
}
function rotX(t: number): M4 { const m = m4(), c = Math.cos(t), s = Math.sin(t); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m }
function rotY(t: number): M4 { const m = m4(), c = Math.cos(t), s = Math.sin(t); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m }
function rotZ(t: number): M4 { const m = m4(), c = Math.cos(t), s = Math.sin(t); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m }

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
}

const STYLE_SOLID = 0, STYLE_WIRE = 1, STYLE_EDGES = 2, STYLE_POINTS = 3, STYLE_SOLID_EDGES = 4

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
  private wobT = Math.random() * 64
  private t = 0
  private bass = 0
  private mids = 0
  private lastShapeBuild = 0

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

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
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
    if (mesh.edges && mesh.edges.length) {
      edVao = gl.createVertexArray()!
      gl.bindVertexArray(edVao)
      const bE = buf(gl.ARRAY_BUFFER, mesh.edges)
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
      key, mesh, vao, ptVao, edVao, bufs, tex,
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
    gl.bindVertexArray(null)
    gl.deleteVertexArray(gp.vao)
    gl.deleteVertexArray(gp.ptVao)
    if (gp.edVao) gl.deleteVertexArray(gp.edVao)
    if (gp.tex) gl.deleteTexture(gp.tex)
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
    this.t = (this.t + dt) % 4096
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
    this.wobT = (this.wobT + dt * Math.max(0, num(I, 'wobbleSpeed', 0.3)) * 1.2) % 64
    const M = mul4(mul4(mul4(rotX(num(I, 'tilt', 0.1) * Math.PI + this.ax), rotY(num(I, 'turn', 0) * Math.PI + this.ay)), rotZ(num(I, 'roll', 0) * Math.PI + this.az)), (() => { const s = m4(); s[0] = s[5] = s[10] = scale; return s })())
    // under full-dome fill it stands back, framed in the middle, clear of the rim
    const dist = Math.max(0.5, num(I, 'distance', 4)) * (fill ? 1.7 : 1)
    const V = m4(); V[14] = -dist
    const MV = mul4(V, M)
    const reach = scale * (1 + wob * 0.6)
    const near = Math.max(0.02, dist - reach * 1.2), far = dist + reach * 1.2
    const fov = (Math.max(5, Math.min(150, num(I, 'lens', 35))) * Math.PI) / 180
    const f = 1 / Math.tan(fov / 2)
    const P = new Float32Array(16)
    P[0] = f / asp; P[5] = f; P[10] = (far + near) / (near - far); P[11] = -1; P[14] = (2 * far * near) / (near - far)
    const NM = new Float32Array([MV[0] / scale, MV[1] / scale, MV[2] / scale, MV[4] / scale, MV[5] / scale, MV[6] / scale, MV[8] / scale, MV[9] / scale, MV[10] / scale])
    const off: [number, number] = [num(I, 'posX', 0), num(I, 'posY', 0)]
    // the depth of the shape's own reach : its front white, its back black
    const near0 = dist - reach, far0 = dist + reach

    const common = (p: Prog): Prog => {
      gl.uniformMatrix4fv(p.u('uMV'), false, MV)
      gl.uniformMatrix4fv(p.u('uP'), false, P)
      gl.uniformMatrix3fv(p.u('uNM'), false, NM)
      return p.f2('uOff', off[0], off[1]).f1('uWob', wob).f1('uWobS', Math.max(0.1, num(I, 'wobbleSize', 1.5))).f1('uWobT', this.wobT)
        .f1('uNear0', near0).f1('uFar0', far0)
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
        .f1('uTile', Math.max(0.05, num(I, 'tile', 1))).f1('uScroll', num(I, 'scroll', 0)).f1('uFog', Math.max(0, Math.min(1, num(I, 'fog', 0))))
        .f1('uT', this.t).f1('uFpx', Math.tan(fov / 2) * 2 / this.h)
        // the shared materials' extras : flowing bands, the foil
        .f1('uFlow', Math.max(0, Math.min(1, num(I, 'flow', 0)))).f1('uFlowT', (this.t * num(I, 'flowSpeed', 0.3) * 0.25) % 1024)
        .f1('uBands', 3).f1('uSplit', 0.5).f1('uRipple', 0.3)
        .f1('uFoilSat', Math.max(0, Math.min(1, num(I, 'rainbow', 0.7)))).f1('uFoilScale', 40 + 260 * Math.max(0, Math.min(1, num(I, 'flakes', 0.5))))
        .f1('uFoilGlint', Math.max(0, Math.min(1, num(I, 'glint', 0.4))))
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
      gl.bindVertexArray(gp.vao)
      gl.drawElements(gl.TRIANGLES, gp.nIdx, gl.UNSIGNED_INT, 0)
    }
    if (style === STYLE_SOLID || style === STYLE_SOLID_EDGES) {
      // glass shows only its front (its back would double it); the rest both sides
      if (glass) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK) }
      if (style === STYLE_SOLID_EDGES) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1) }
      drawSolid(shade(common(this.solidP.use())))
      gl.disable(gl.CULL_FACE)
      gl.disable(gl.POLYGON_OFFSET_FILL)
    } else if (style !== STYLE_POINTS && hidden) {
      // the lines behind the model hidden : its depth first, no color
      gl.colorMask(false, false, false, false)
      gl.enable(gl.POLYGON_OFFSET_FILL)
      gl.polygonOffset(1, 1)
      drawSolid(common(this.depthP.use()))
      gl.disable(gl.POLYGON_OFFSET_FILL)
      gl.colorMask(true, true, true, true)
    }
    const px = this.h / 1080
    if (style === STYLE_WIRE || style === STYLE_EDGES || style === STYLE_SOLID_EDGES) {
      const [lr, lg, lb] = col(I, 'lineColor', [0.92, 0.94, 0.95])
      const wpx = Math.max(1, Math.max(0.3, num(I, 'lineWidth', 1.2)) * px)
      const crease = Math.cos((Math.max(1, Math.min(179, num(I, 'edgeAngle', 30))) * Math.PI) / 180)
      const see = style !== STYLE_SOLID_EDGES && !hidden
      if (see) gl.disable(gl.DEPTH_TEST)
      gl.depthMask(false)
      common(this.lineP.use()).f2('uRes', this.w, this.h).f1('uWidth', wpx).f1('uAll', style === STYLE_WIRE ? 1 : 0).f1('uCrease', crease)
        .f3('uLineC', lr, lg, lb).f3('uGround', gr, gg, gb).f1('uGroundA', ga).f1('uFog', Math.max(0, Math.min(1, num(I, 'fog', 0))))
      gl.bindVertexArray(gp.edVao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gp.nEdge)
      gl.depthMask(true)
      gl.enable(gl.DEPTH_TEST)
    } else if (style === STYLE_POINTS) {
      shade(common(this.pointP.use())).f1('uSize', Math.max(0.3, num(I, 'pointSize', 2.5)) * px).f1('uDist', dist)
      gl.bindVertexArray(gp.ptVao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gp.nVert)
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
      if (gp.nIdx) drawSolid(common(this.depthP.use()))
      else {
        common(this.ptDepthP.use()).f2('uRes', d.w, d.h).f1('uSize', Math.max(0.3, num(I, 'pointSize', 2.5)) * (d.h / 1080)).f1('uDist', dist)
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
    g.done(4)
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
