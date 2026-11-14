// The dense optical-flow pass : one fragment shader, written for Palinopsia from the
// published method only.
//
// Method : Lucas-Kanade. The brightness constancy constraint I_x u + I_y v + I_t = 0
// (Horn and Schunck) has two unknowns per texel; Lucas and Kanade assume the motion is
// the same over a small window and solve the constraint there in the least-squares
// sense, which is the 2x2 system  G (u v)^T = -b  with the structure tensor
// G = sum w [I_x^2, I_x I_y; I_x I_y, I_y^2]  and  b = sum w (I_x I_t, I_y I_t).
//
//   B. D. Lucas and T. Kanade, "An iterative image registration technique with an
//   application to stereo vision", Proc. IJCAI 1981, pp. 674-679.
//   B. K. P. Horn and B. G. Schunck, "Determining optical flow", Artificial
//   Intelligence 17 (1-3), 1981, pp. 185-203. doi:10.1016/0004-3702(81)90024-2
//
// This implementation :
// - reads 13 texels in each frame (26 reads) : a diamond whose texels are 3 apart, so
//   the pass sees 13 x 13 texels of the frame;
// - the spatial gradients are central differences of the MEAN of the two frames (over
//   6 texels, given per texel), the temporal one is cur - prev;
// - the window is the 5 texels of a plus (the centre twice the weight of its 4
//   neighbours : a tent), the largest whose central differences fit in the diamond;
// - uLambda is added to the tensor's diagonal (Tikhonov). On a flat area the answer
//   goes to zero; on a lone edge (the aperture problem : G has rank 1) it goes to the
//   normal flow, the motion across the edge.
//
// Why 3 apart : one pass, no pyramid, must still measure a motion of 3 texels. The
// linear constraint only holds for detail a few times larger than the motion, and a
// window smaller than that detail sees one edge at a time. The price : detail finer
// than about 6 texels is read wrongly (a fine regular pattern can answer the wrong
// way), so the luma given should be a reduced, smoothed picture. A caller that wants
// faster motion still runs the pass again on a smaller copy of the frames (uScale
// brings both answers to the same unit).
//
// The contract (the app's other flow effects run this pass too) :
//   uCur, uPrev : luma in .r, 0..1, both N x N        uRes   : (N, N)
//   uLambda     : the regularisation (about 0.001)     uClamp : clamp per component
//   uScale      : 256 / N
//   o = vec4(f, 0, 1) : the displacement of the picture's content from uPrev to uCur
//   at this texel, in texels of a 256-wide field. What is at p in uPrev is at about
//   p + f / 256 (uv) in uCur.

export const F_FLOW_LK = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uCur, uPrev;
uniform vec2 uRes;
uniform float uLambda, uClamp, uScale;
// the distance between the texels read
const int S = 3;

// x : the mean of the two frames (what the spatial gradients are taken on)
// y : the temporal difference
vec2 mt(ivec2 c, ivec2 hi) {
  c = clamp(c, ivec2(0), hi);
  float a = texelFetch(uCur, c, 0).r;
  float b = texelFetch(uPrev, c, 0).r;
  return vec2(0.5 * (a + b), a - b);
}

void main() {
  ivec2 hi = ivec2(uRes) - 1;
  ivec2 c = clamp(ivec2(vUV * uRes), ivec2(0), hi);

  // the 13 texels of the diamond, S texels apart
  vec2 pC  = mt(c, hi);
  vec2 pE  = mt(c + ivec2( S,  0), hi);
  vec2 pW  = mt(c + ivec2(-S,  0), hi);
  vec2 pN  = mt(c + ivec2( 0,  S), hi);
  vec2 pS  = mt(c + ivec2( 0, -S), hi);
  float mEE = mt(c + ivec2( 2 * S,  0), hi).x;
  float mWW = mt(c + ivec2(-2 * S,  0), hi).x;
  float mNN = mt(c + ivec2( 0,  2 * S), hi).x;
  float mSS = mt(c + ivec2( 0, -2 * S), hi).x;
  float mNE = mt(c + ivec2( S,  S), hi).x;
  float mNW = mt(c + ivec2(-S,  S), hi).x;
  float mSE = mt(c + ivec2( S, -S), hi).x;
  float mSW = mt(c + ivec2(-S, -S), hi).x;

  // (I_x, I_y, I_t) at the 5 texels of the window : central differences, per texel
  float k = 0.5 / float(S);
  vec3 gC = vec3(k * (pE.x - pW.x), k * (pN.x - pS.x), pC.y);
  vec3 gE = vec3(k * (mEE - pC.x),  k * (mNE - mSE),   pE.y);
  vec3 gW = vec3(k * (pC.x - mWW),  k * (mNW - mSW),   pW.y);
  vec3 gN = vec3(k * (mNE - mNW),   k * (mNN - pC.x),  pN.y);
  vec3 gS = vec3(k * (mSE - mSW),   k * (pC.x - mSS),  pS.y);

  // the structure tensor (xx, xy, yy) and the right-hand side. The weights (8 at the
  // centre, 4 around : a tent) add up to 24, about what a full 5 x 5 window sums to,
  // so that uLambda weighs what it does against such a window.
  vec3 G = 8.0 * vec3(gC.x * gC.x, gC.x * gC.y, gC.y * gC.y)
         + 4.0 * (vec3(gE.x * gE.x, gE.x * gE.y, gE.y * gE.y)
         + vec3(gW.x * gW.x, gW.x * gW.y, gW.y * gW.y)
         + vec3(gN.x * gN.x, gN.x * gN.y, gN.y * gN.y)
         + vec3(gS.x * gS.x, gS.x * gS.y, gS.y * gS.y));
  vec2 b = 8.0 * gC.xy * gC.z + 4.0 * (gE.xy * gE.z + gW.xy * gW.z + gN.xy * gN.z + gS.xy * gS.z);

  float lam = max(uLambda, 1e-7);
  float gxx = G.x + lam, gyy = G.z + lam, gxy = G.y;
  float det = max(gxx * gyy - gxy * gxy, 1e-12);
  vec2 f = -vec2(gyy * b.x - gxy * b.y, gxx * b.y - gxy * b.x) / det;

  f *= uScale;
  // (a comparison with itself is false for a NaN : nothing unfinite leaves this pass)
  if (!(f.x == f.x) || !(f.y == f.y)) f = vec2(0.0);
  f = clamp(f, vec2(-uClamp), vec2(uClamp));
  o = vec4(f, 0.0, 1.0);
}`
