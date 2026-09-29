/*{
  "DESCRIPTION": "Interference : two near-frequency line fields beating against each other. Moiré handled as MATTE TEXTURE, not op-art: asymmetric angles, posterized product, mid-tone grays with one accent. Detune and skew set the spacing and slant of the beat bands; rate makes both fields slide, so the bands crawl (slower the wider they are).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Analog", "Geometry"],
  "INPUTS": [
    { "NAME": "freq",     "TYPE": "float", "MIN": 5.0,  "MAX": 120.0,  "DEFAULT": 40.0 },
    { "NAME": "detune",   "TYPE": "float", "MIN": 0.0,  "MAX": 0.2,    "DEFAULT": 0.03 },
    { "NAME": "angle",    "TYPE": "float", "MIN": 0.0,  "MAX": 6.2832, "DEFAULT": 0.35 },
    { "NAME": "skew",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.12 },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,    "DEFAULT": 0.15 },
    { "NAME": "contrast", "TYPE": "float", "MIN": 0.5,  "MAX": 3.0,    "DEFAULT": 1.4 },
    { "NAME": "tint",     "TYPE": "color", "DEFAULT": [0.6, 0.62, 0.58, 1.0] }
  ]
}*/

// Integrated rate (engine-driven : a rate change alters the speed, never the
// position, so modulating rate can't make the fields jump).
uniform float PH_rate;

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  // Each field's own phase, wrapped to one turn (seamless: it only feeds sin).
  float ph1 = mod(PH_rate * 2.0, 6.2831853);
  float ph2 = mod(PH_rate * 1.3, 6.2831853);

  // Field 1: lines at `angle`. Field 2: slightly detuned frequency AND a
  // slightly skewed angle : both misalignments feed the beat.
  float a2 = angle + skew * 0.5;
  float k1 = freq * 6.2831853;
  float k2 = freq * (1.0 + detune) * 6.2831853;
  float arg1 = rot(p, angle).y * k1 + ph1;
  float arg2 = rot(p, a2).y * k2 - ph2;
  float s1 = sin(arg1), c1 = cos(arg1);
  float s2 = sin(arg2), c2 = cos(arg2);

  // Product of the fields = the interference; fold to 0..1 and shape.
  float b = clamp(s1 * s2 * 0.5 + 0.5, 0.0, 1.0);
  float beat = pow(b, contrast);

  // Posterize gently so it reads as matte bands, not vibrating op-art. The
  // steps are anti-aliased over one pixel's footprint : the product carries a
  // fine 2×freq term, so hard steps would crawl as pixel staircases. The
  // gradient is analytic (rot(p,a).y = p·(sin a, cos a)), in levels per pixel.
  vec2 g = (c1 * s2 * k1) * vec2(sin(angle), cos(angle))
         + (s1 * c2 * k2) * vec2(sin(a2), cos(a2));
  float dq = 5.0 * contrast * pow(max(b, 0.001), contrast - 1.0) * 0.5 * length(g);
  float w = clamp(dq / RENDERSIZE.y, 0.0001, 1.0);
  float q = beat * 5.0;
  float n = floor(q + 0.5);
  float lvl = n - 1.0 + smoothstep(-0.5 * w, 0.5 * w, q - n);
  beat = clamp(lvl, 0.0, 4.0) / 4.0;

  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 col = base + tint.rgb * beat * 0.7;
  gl_FragColor = vec4(col, 1.0);
}
