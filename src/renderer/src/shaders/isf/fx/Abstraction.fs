/*{
  "DESCRIPTION": "Abstraction : one knob from representation to abstraction (an 'abstraction du réel'). As `amount` rises, the image is displaced along a luma-driven flow, quantized (posterized) and desaturated toward its own light : a recognizable source dissolving into moving matter. The flow turns at RATE; COHERENCE reads the flow from a small neighborhood instead of single pixels, so textured areas move as currents rather than scattering grain by grain. amount 0 = clean passthrough. Made for video/capture sources, but works on anything.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Distortion"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "abstract" },
    { "NAME": "disperse",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "disperse" },
    { "NAME": "posterize", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "posterize" },
    { "NAME": "desat",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "desat" },
    { "NAME": "rate",      "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "flow rate" },
    { "NAME": "coherence", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "coherence" }
  ]
}*/

// Integrated phase (engine/phases.ts) : the flow turns by ∫rate dt, so a rate
// change alters how fast it turns from here on, never where it points.
uniform float PH_rate; // wrap 6.2831853

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

// Mirror a coordinate back into the frame (no clamp-to-edge smear at the border).
vec2 mirror(vec2 p) { return 1.0 - abs(1.0 - mod(p, 2.0)); }

void main() {
  vec2 uv = isf_FragNormCoord;
  float m = amount;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec4 base = IMG_NORM_PIXEL(inputImage, uv);

  // Luma-driven flow: brighter regions push along an angle that also turns with
  // luma + time, so the image smears into currents as `disperse` and `amount` rise.
  float l = dot(base.rgb, LUMA);
  if (coherence > 0.0) {
    // A small cross of luma taps : neighbors agree on a direction, so texture
    // flows as one current.
    vec2 n1 = uv + vec2(0.01 / aspect, 0.0); vec2 n2 = uv - vec2(0.01 / aspect, 0.0);
    vec2 n3 = uv + vec2(0.0, 0.01);          vec2 n4 = uv - vec2(0.0, 0.01);
    float la = (dot(IMG_NORM_PIXEL(inputImage, n1).rgb, LUMA) + dot(IMG_NORM_PIXEL(inputImage, n2).rgb, LUMA)
              + dot(IMG_NORM_PIXEL(inputImage, n3).rgb, LUMA) + dot(IMG_NORM_PIXEL(inputImage, n4).rgb, LUMA)) * 0.25;
    l = mix(l, la, coherence);
  }
  float ang = l * 6.2832 + PH_rate;
  // Reach in frame-height units (round at any aspect), mirrored at the border.
  vec2 sc = mirror(uv + vec2(cos(ang) / aspect, sin(ang)) * disperse * m * 0.11);
  vec4 flowed = IMG_NORM_PIXEL(inputImage, sc);

  // Mix as premultiplied color : content that flows over a transparent area
  // keeps its color and brings its coverage with it.
  vec3 P = mix(base.rgb * base.a, flowed.rgb * flowed.a, m);
  float a = mix(base.a, flowed.a, m);
  vec3 o = a > 0.0 ? P / a : base.rgb;

  // Quantize toward fewer levels (recognition falls away). Faded in over the
  // first 5% of posterize×amount, so amount 0 is a true passthrough.
  float pm = posterize * m;
  float steps = mix(64.0, 3.0, pm);
  o = mix(o, floor(o * steps + 0.5) / steps, smoothstep(0.0, 0.05, pm));

  // Desaturate toward the image's own light.
  float lo = dot(o, LUMA);
  o = mix(o, vec3(lo), desat * m * 0.7);

  gl_FragColor = vec4(o, a);
}
