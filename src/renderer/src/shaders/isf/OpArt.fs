/*{
  "DESCRIPTION": "Op-Art — hard-edged optical-illusion fields (homage to the Riley / Vasarely / Soto lineage that shaped Corbeil-Perron's Imaginary Optics). Black-and-white waves, grids, moiré and herringbone with illusory motion; a matte geometric generator that sits at home under the Finalizer's anaglyph 3D. Curated and minimal — never a radial kaleidoscope or plasma.",
  "CREDIT": "Palinopsia (after Bridget Riley / Victor Vasarely / Jesús Rafael Soto)",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry"],
  "INPUTS": [
    { "NAME": "mode",     "TYPE": "long",  "VALUES": [0, 1, 2, 3], "LABELS": ["waves", "grid", "moiré", "herringbone"], "DEFAULT": 0 },
    { "NAME": "scale",    "TYPE": "float", "MIN": 4.0, "MAX": 80.0, "DEFAULT": 24.0 },
    { "NAME": "warp",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4 },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0, "MAX": 4.0,  "DEFAULT": 0.3 },
    { "NAME": "angle",    "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": 0.0 },
    { "NAME": "contrast", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.9 },
    { "NAME": "tint",     "TYPE": "color", "DEFAULT": [0.9, 0.9, 0.88, 1.0] }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
  float ca = cos(angle), sa = sin(angle);
  p = mat2(ca, -sa, sa, ca) * p;
  float t = TIME * rate;
  float v;

  if (mode == 0) {
    // Riley "Fall" — vertical bands whose phase is bent by a slow travelling field.
    float w = sin(p.y * 3.0 + t) * warp * 0.6;
    v = 0.5 + 0.5 * sin(p.x * scale + w * scale + t);
  } else if (mode == 1) {
    // Vasarely — a square grid deformed by a slowly drifting off-centre bulge.
    vec2 ctr = vec2(sin(t * 0.6) * 0.3, cos(t * 0.5) * 0.3);
    float bulge = sin(length(p - ctr) * 4.0 - t) * warp;
    vec2 c = fract(p * scale * 0.25) - 0.5;
    float sq = max(abs(c.x), abs(c.y));
    float edge = 0.35 + bulge * 0.1;
    v = 1.0 - smoothstep(edge, edge + 0.02, sq);
  } else if (mode == 2) {
    // Soto — two line gratings at a slight relative angle beat into moiré.
    float a2 = 0.08 + warp * 0.2;
    float g1 = sin(p.x * scale + t);
    vec2 q = mat2(cos(a2), -sin(a2), sin(a2), cos(a2)) * p;
    float g2 = sin(q.x * scale - t * 0.7);
    v = 0.5 + 0.5 * g1 * g2;
  } else {
    // Herringbone — offset zig-zag rows.
    vec2 g = p * scale * 0.5;
    float zig = abs(fract(g.y * 0.5) - 0.5);
    v = 0.5 + 0.5 * sin((g.x + zig * mix(1.0, 4.0, warp)) * 3.1416 + t);
  }

  v = clamp((v - 0.5) * mix(1.0, 6.0, contrast) + 0.5, 0.0, 1.0);
  v = smoothstep(0.45, 0.55, v);
  vec3 bg = vec3(0.02, 0.02, 0.025);
  gl_FragColor = vec4(mix(bg, tint.rgb, v), 1.0);
}
