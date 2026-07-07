/*{
  "DESCRIPTION": "Abstraction — one knob from representation to abstraction (Boucher's 'abstraction du réel'). As `amount` rises, the image is displaced along a luma-driven flow, quantised (posterised) and desaturated toward its own light — a recognisable source dissolving into moving matter. amount 0 = clean passthrough. Made for video/capture sources, but works on anything.",
  "CREDIT": "Palinopsia (after Boucher, videomusic)",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Distortion"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "abstract" },
    { "NAME": "disperse",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "disperse" },
    { "NAME": "posterize", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "posterize" },
    { "NAME": "desat",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "desat" }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float m = amount;
  vec3 base = IMG_NORM_PIXEL(inputImage, uv).rgb;

  // Luma-driven flow: brighter regions push along an angle that also turns with
  // luma + time, so the image smears into currents as `disperse` and `amount` rise.
  float l = dot(base, vec3(0.299, 0.587, 0.114));
  float ang = l * 6.2832 + TIME * 0.15;
  vec2 sc = uv + vec2(cos(ang), sin(ang)) * disperse * m * 0.08;
  vec3 flowed = IMG_NORM_PIXEL(inputImage, sc).rgb;

  vec3 o = mix(base, flowed, m);

  // Quantise toward fewer levels (recognition falls away).
  float steps = mix(64.0, 3.0, posterize * m);
  o = floor(o * steps + 0.5) / steps;

  // Desaturate toward the image's own light.
  float lo = dot(o, vec3(0.299, 0.587, 0.114));
  o = mix(o, vec3(lo), desat * m * 0.7);

  gl_FragColor = vec4(o, 1.0);
}
