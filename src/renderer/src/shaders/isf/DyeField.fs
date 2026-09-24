/*{
  "DESCRIPTION": "Dye Field : painted-on-film dye. Domain-warped SUBTRACTIVE pigment pooling over a near-black emulsion, disciplined toward decay and crystallisation, never additive glow-on-black (brief §1, §5.3). An internal feedback pass pools and crystallises the dye. Matte, near-black, no symmetry, no bloom. RELIEF lights the pooled dye as a thin skin of paint (it gathers into slightly raised pools) at LIGHT ANGLE; 0 = flat.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0, "MAX": 8.0,  "DEFAULT": 0.4 },
    { "NAME": "scale",   "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 4.0 },
    { "NAME": "warp",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.5 },
    { "NAME": "pool",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4, "LABEL": "pool / crystallize" },
    { "NAME": "density", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.5 },
    { "NAME": "grain",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.3, "LABEL": "granulation" },
    { "NAME": "pigment", "TYPE": "color", "DEFAULT": [0.44, 0.1, 0.11, 1.0] },
    { "NAME": "base",    "TYPE": "color", "DEFAULT": [0.03, 0.03, 0.04, 1.0] },
    { "NAME": "relief",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.3,  "LABEL": "relief" },
    { "NAME": "lightAngle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 2.36, "LABEL": "light angle" }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

float hash(vec2 p) { p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.35); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float og_height(vec2 uv) { return IMG_NORM_PIXEL(buf, uv).r; }

#define OG_RELIEF_E 2.5
#define OG_SHADOW_STEPS 3
// @og-relief

void main() {
  vec2 uv = isf_FragNormCoord;
  // Noise runs in aspect-corrected space : pools are round, not stretched sideways.
  vec2 an = uv * vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0);

  if (PASSINDEX == 0) {
    float t = TIME * rate;
    // Two-tap domain warp : the field folds into itself (pooling, not tiling).
    vec2 q = an + 0.15 * warp * vec2(vnoise(an * scale + t), vnoise(an * scale + 7.0));
    vec2 w = an + 0.35 * warp * vec2(vnoise(q * scale * 1.4 + 1.7), vnoise(q * scale * 1.4 + 9.2));
    float d = pow(vnoise(w * scale * 1.6 + t * 0.1), mix(1.1, 2.4, density)); // pooling curve

    // Crystallise: leak the dye into a warped, decayed copy of itself. Loop gain
    // < 1 (0.96) so it pools and holds like ice, then slowly releases : bounded.
    vec2 sc = uv + (vec2(vnoise(an * scale - t), vnoise(an * scale + 3.0)) - 0.5) * warp * 0.02;
    float prev = IMG_NORM_PIXEL(buf, sc).r;
    d = mix(d, prev * 0.96 + d * 0.2, pool);
    gl_FragColor = vec4(vec3(clamp(d, 0.0, 1.0)), 1.0);
  } else {
    float d = IMG_NORM_PIXEL(buf, uv).r;
    // SUBTRACTIVE dye over near-black emulsion : pigment density, never glow.
    vec3 col = mix(base.rgb, pigment.rgb, d);
    // Dye granulation: clumped coloured mottle, subtractive density.
    float clump = vnoise(an * 23.0);
    vec3 g = vec3(vnoise(an * 90.0), vnoise(an * 88.0 + 3.1), vnoise(an * 92.0 + 7.7)) * clump;
    col *= 1.0 - grain * 0.4 * (g - 0.5);
    col = mix(col, og_relief(uv, col, d, lightAngle, relief), smoothstep(0.0, 0.25, relief));
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
}
