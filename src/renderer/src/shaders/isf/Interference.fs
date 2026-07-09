/*{
  "DESCRIPTION": "Interference : two near-frequency line fields beating against each other. Moiré handled as MATTE TEXTURE, not op-art: asymmetric angles, posterized product, mid-tone greys with one accent. The beat pattern crawls at the detune rate.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry"],
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

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = TIME * rate;

  // Field 1: lines at `angle`. Field 2: slightly detuned frequency AND a
  // slightly skewed angle : both misalignments feed the beat.
  vec2 p1 = rot(p, angle);
  vec2 p2 = rot(p, angle + skew * 0.5);
  float s1 = sin(p1.y * freq * 6.2832 + t * 2.0);
  float s2 = sin(p2.y * freq * (1.0 + detune) * 6.2832 - t * 1.3);

  // Product of the fields = the interference; fold to 0..1 and shape.
  float beat = s1 * s2 * 0.5 + 0.5;
  beat = pow(clamp(beat, 0.0, 1.0), contrast);

  // Posterize gently so it reads as matte bands, not vibrating op-art.
  beat = floor(beat * 5.0) / 4.0;

  vec3 base = vec3(0.03, 0.03, 0.035);
  vec3 col = base + tint.rgb * beat * 0.7;
  col *= 0.94 + 0.06 * sin(uv.y * RENDERSIZE.y * 3.14159);
  gl_FragColor = vec4(col, 1.0);
}
