/*{
  "DESCRIPTION": "Optical Rain — stereoscopic texture (homage to Maxime Corbeil-Perron, thèse §3.12/§3.7). Shatters the image's edges into vertical streaks that drift downward — his 'pluie optique' — each fragment carrying a horizontal red/cyan disparity, so under the Finalizer's anaglyph 3D a floating tactile texture emerges off the stereoscopic membrane, 'beyond form'. Only ever fragments the incoming image; it invents no pattern of its own. No psychedelia.",
  "CREDIT": "Palinopsia (after Maxime Corbeil-Perron)",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Stereo"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.6,   "LABEL": "fragment" },
    { "NAME": "rain",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.4,   "LABEL": "rain speed" },
    { "NAME": "streak",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.5,   "LABEL": "streak length" },
    { "NAME": "columns",   "TYPE": "float", "MIN": 40.0, "MAX": 600.0, "DEFAULT": 220.0, "LABEL": "density" },
    { "NAME": "disparity", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.5,   "LABEL": "3D float" },
    { "NAME": "edges",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.5,   "LABEL": "edges only" }
  ]
}*/

float h11(float x) { return fract(sin(x * 127.1) * 43758.5453); }
const vec3 LUMA = vec3(0.299, 0.587, 0.114);

// Cheap Sobel-ish edge magnitude on luma — the "form" whose fragments will rain.
float edgeMag(vec2 uv, vec2 px) {
  float l = dot(IMG_NORM_PIXEL(inputImage, uv).rgb, LUMA);
  float r = dot(IMG_NORM_PIXEL(inputImage, uv + vec2(px.x, 0.0)).rgb, LUMA);
  float d = dot(IMG_NORM_PIXEL(inputImage, uv + vec2(0.0, px.y)).rgb, LUMA);
  return clamp((abs(l - r) + abs(l - d)) * 3.0, 0.0, 1.0);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 px = 1.0 / RENDERSIZE;
  vec3 orig = IMG_NORM_PIXEL(inputImage, uv).rgb;

  // Per-column phase + speed → a vertical drift that pulls the sample upward, so
  // the content appears to fall (rain). Columns individuate the fragmentation.
  float col = floor(uv.x * columns);
  float spd = 0.3 + h11(col) * 1.4;
  float off = fract(TIME * rain * spd + h11(col + 7.0));
  float len = mix(0.02, 0.5, streak);
  vec2 ruv = vec2(uv.x, fract(uv.y + off * len));

  // Where it rains: gated by edges (fragmentation "beyond form") × amount, with
  // a per-column flicker so streaks break rather than smear uniformly.
  float e = mix(1.0, edgeMag(uv, px * 1.5), edges);
  float gate = clamp(amount * e * (0.4 + 0.6 * h11(col + floor(off * 3.0))), 0.0, 1.0);

  // The stereoscopic texture: each rained fragment gets a horizontal red/cyan
  // disparity from its own luma (depth), so it floats off the membrane in 3D.
  vec3 rained = IMG_NORM_PIXEL(inputImage, ruv).rgb;
  float depth = dot(rained, LUMA);
  float d = (depth - 0.5) * disparity * 0.02;
  float red = IMG_NORM_PIXEL(inputImage, ruv - vec2(d, 0.0)).r;
  vec3 cyan = IMG_NORM_PIXEL(inputImage, ruv + vec2(d, 0.0)).rgb;
  vec3 frag = vec3(red, cyan.g, cyan.b);

  vec3 outc = mix(orig, frag, gate);
  gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
