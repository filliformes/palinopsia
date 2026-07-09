// blend.glsl : the six pairwise blend modes, kept here as the single source
// of truth. The string is currently inlined in Compositor.ts's BLEND_FS; when
// the FX-fusion pass lands (Phase 2/3, the Hydra lesson : fuse blend + simple
// FX into one fragment pass) this file becomes the shared include so blend
// math is defined once. Keep the `mode` integer mapping in sync with the
// BlendMode order in @shared/types and Compositor's modeIndex.
//
//   0 add · 1 screen · 2 multiply · 3 difference · 4 overlay · 5 normal
vec3 blend(vec3 b, vec3 t, int mode) {
  if (mode == 0) return b + t;                                        // add
  if (mode == 1) return 1.0 - (1.0 - b) * (1.0 - t);                  // screen
  if (mode == 2) return b * t;                                        // multiply
  if (mode == 3) return abs(b - t);                                   // difference
  if (mode == 4) return mix(2.0 * b * t, 1.0 - 2.0 * (1.0 - b) * (1.0 - t), step(0.5, b)); // overlay
  return t;                                                           // normal
}
