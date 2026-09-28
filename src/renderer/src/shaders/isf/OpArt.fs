/*{
  "DESCRIPTION": "Op-Art : optical-illusion fields. Black-and-white waves, a grid under a drifting lens bulge, moiré and herringbone with illusory motion; a matte geometric generator that sits at home under the Finalizer's anaglyph 3D. Contrast runs from soft sine grays (0) to hard, pixel-clean edges (1). A negative rate reverses the flow; audio bends the pattern with the live waveform. Curated and minimal, never a radial kaleidoscope or plasma.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry"],
  "INPUTS": [
    { "NAME": "mode",     "TYPE": "long",  "VALUES": [0, 1, 2, 3], "LABELS": ["waves", "grid", "moiré", "herringbone"], "DEFAULT": 0 },
    { "NAME": "scale",    "TYPE": "float", "MIN": 4.0, "MAX": 80.0, "DEFAULT": 24.0 },
    { "NAME": "warp",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4 },
    { "NAME": "rate",     "TYPE": "float", "MIN": -4.0, "MAX": 4.0,  "DEFAULT": 0.3 },
    { "NAME": "angle",    "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": 0.0 },
    { "NAME": "contrast", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.9 },
    { "NAME": "audio",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0, "LABEL": "audio bend" },
    { "NAME": "tint",     "TYPE": "color", "DEFAULT": [0.9, 0.9, 0.88, 1.0] },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// ∫ rate dt : the illusory flow follows a moving rate without jumping.
uniform float PH_rate;

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
  float ca = cos(angle), sa = sin(angle);
  p = mat2(ca, -sa, sa, ca) * p;

  // Audio bend : the live waveform (read down the pattern's y) displaces x, so
  // every mode's bands bend into the wave. Silence reads 0.5 → no bend.
  float ext = length(vec2(aspect, 1.0));
  vec2 ac = vec2(p.y / ext + 0.5, 0.25);
  p.x += (IMG_NORM_PIXEL(audioTex, ac).r - 0.5) * 2.0 * audio * 0.12;

  // Time phases, wrapped (uniform-only) so a long show keeps full precision.
  float t = mod(PH_rate, 6.2831853);
  float v;
  float dvdp; // |∇v| near the v = ½ edge, per unit of p : sizes the anti-aliasing

  if (mode == 0) {
    // Vertical bands whose phase is bent by a slow travelling field.
    float wy = p.y * 3.0 + t;
    float w = sin(wy) * warp * 0.6;
    v = 0.5 + 0.5 * sin(p.x * scale + w * scale + t);
    float bend = 1.8 * warp * cos(wy);
    dvdp = 0.5 * scale * sqrt(1.0 + bend * bend);
  } else if (mode == 1) {
    // A square grid seen through a drifting off-center lens bulge (the grid
    // itself swells under it), with a ripple of square size travelling outward.
    vec2 ctr = vec2(sin(mod(PH_rate * 0.6, 6.2831853)) * 0.3, cos(mod(PH_rate * 0.5, 6.2831853)) * 0.3);
    vec2 dp = p - ctr;
    float r2 = dot(dp, dp);
    float lens = warp * 0.8 * exp(-r2 * 5.0);
    vec2 pl = p - dp * lens; // sample nearer the lens center : magnified
    float bulge = sin(sqrt(r2) * 4.0 - t) * warp;
    vec2 c = fract(pl * scale * 0.25) - 0.5;
    float sq = max(abs(c.x), abs(c.y));
    float edge = 0.35 + bulge * 0.1;
    // Signed distance to the square's edge (cell units) → a ramp around ½.
    v = 0.5 + (edge - sq) * 2.0;
    // The lens map's local stretch (the larger of radial and tangential).
    float stretch = max(1.0 - lens * (1.0 - 10.0 * r2), 1.0 - lens);
    dvdp = 2.0 * scale * 0.25 * max(stretch, 0.2);
  } else if (mode == 2) {
    // Two line gratings at a slight relative angle beat into moiré.
    float a2 = 0.08 + warp * 0.2;
    float g1 = sin(p.x * scale + t);
    vec2 q = mat2(cos(a2), -sin(a2), sin(a2), cos(a2)) * p;
    float g2 = sin(q.x * scale - mod(PH_rate * 0.7, 6.2831853));
    v = 0.5 + 0.5 * g1 * g2;
    dvdp = 0.5 * scale * max(sqrt(g1 * g1 + g2 * g2), 0.3);
  } else {
    // Herringbone : offset zig-zag rows.
    vec2 g = p * scale * 0.5;
    float zig = abs(fract(g.y * 0.5) - 0.5);
    float m = mix(1.0, 4.0, warp);
    v = 0.5 + 0.5 * sin((g.x + zig * m) * 3.1416 + t);
    dvdp = 0.5 * scale * 1.5708 * sqrt(1.0 + 0.25 * m * m);
  }

  // Contrast : the edge half-width, from 0.5 (soft sine grays) down to one
  // pixel's worth of the pattern (hard but anti-aliased at any scale).
  float px = dvdp / RENDERSIZE.y;
  float cw = 1.0 - contrast;
  float w = max(px + (0.5 - px) * cw * cw * cw, 1e-4);
  v = smoothstep(0.5 - w, 0.5 + w, v);
  vec3 bg = vec3(0.02, 0.02, 0.025);
  gl_FragColor = vec4(mix(bg, tint.rgb, v), 1.0);
}
