
// ── Organic relief lighting ─────────────────────────────────────────────────
// Inserted by the registry at the shader's "// @og-relief" line, AFTER the shader
// defines   float og_height(vec2 uv)   (0..1, in the same uv as the picture).
// What makes a flat colour ramp read as a physical surface : a normal from the
// height, one low raking light (azimuth `angle`, ~22° up), a short soft shadow
// march, and a cavity term; matte (wrap diffuse, no specular) and normalised so
// a flat patch keeps its albedo. `relief` 0 = off (the albedo untouched).
// A shader can #define before the marker : OG_SHADOW_STEPS (default 5, 0 = no
// shadow), OG_RELIEF_E (the difference step in pixels, default 1.5 : wider for
// 8-bit buffers) and OG_SHADOW_HEIGHT (a cheaper height for the shadow march,
// default og_height : shadows only need the big forms).
#ifndef OG_SHADOW_HEIGHT
#define OG_SHADOW_HEIGHT og_height
#endif
#ifndef OG_SHADOW_STEPS
#define OG_SHADOW_STEPS 5
#endif
#ifndef OG_RELIEF_E
#define OG_RELIEF_E 1.5
#endif

vec3 og_relief(vec2 uv, vec3 albedo, float h, float angle, float relief) {
  if (relief < 0.001) return albedo;
  float asp = RENDERSIZE.x / RENDERSIZE.y;
  float e = OG_RELIEF_E / RENDERSIZE.y;
  float hx = og_height(uv + vec2(e / asp, 0.0));
  float hy = og_height(uv + vec2(0.0, e));
  float depth = 0.024 * relief;                // the height of h = 1, in frame heights
  vec2 g = vec2(hx - h, hy - h) / e * depth;
  vec3 n = normalize(vec3(-g, 1.0));
  vec3 L = normalize(vec3(cos(angle) * 0.9287, sin(angle) * 0.9287, 0.3709)); // 22° up
  float nl = dot(n, L);
  float diff = mix(max(nl, 0.0), clamp((nl + 0.35) / 1.35, 0.0, 1.0), 0.35);
  float sh = 1.0;
  vec2 dir = normalize(L.xy) * vec2(1.0 / asp, 1.0);
  for (int i = 1; i <= OG_SHADOW_STEPS; i++) {
    float d = float(i) * 0.005;
    float rayH = h * depth + d * 0.4;           // tan(22°)
    sh = min(sh, clamp(1.0 - (OG_SHADOW_HEIGHT(uv + dir * d) * depth - rayH) / (0.25 * depth), 0.0, 1.0));
  }
  float cav = mix(0.6, 1.0, clamp(h, 0.0, 1.0));
  float lum = clamp(diff / L.z, 0.0, 1.7) * mix(0.3, 1.0, sh);
  return albedo * (0.12 + 0.88 * lum) * mix(0.75, 1.0, cav);
}
