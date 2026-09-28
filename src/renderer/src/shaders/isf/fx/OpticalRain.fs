/*{
  "DESCRIPTION": "Optical Rain : stereoscopic texture. Shatters the image's edges into vertical streaks that drift downward (an 'optical rain'), each fragment carrying a horizontal red/cyan disparity, so under the Finalizer's anaglyph 3D a floating tactile texture emerges off the stereoscopic membrane, 'beyond form'. Only ever fragments the incoming image; it invents no pattern of its own. No psychedelia.",
  "CREDIT": "Palinopsia",
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

// Integrated phase (engine/phases.ts) : a rain-speed change moves the streaks
// on from where they are instead of reshuffling every column.
uniform float PH_rain;

float h11(float x) { x = fract(x * 0.1031); x *= x + 33.33; x *= x + x; return fract(x); }
const vec3 LUMA = vec3(0.299, 0.587, 0.114);

// Cheap Sobel-ish edge magnitude on luma : the "form" whose fragments will rain.
// Tap coordinates are hoisted to bare vec2s : the ISF parser keeps only one
// comma-piece of an IMG_NORM_PIXEL argument (`uv + vec2(a, b)` → vec2(a)).
float edgeMag(vec2 uv, vec2 px) {
  vec2 uR = uv + vec2(px.x, 0.0);
  vec2 uD = uv + vec2(0.0, px.y);
  float l = dot(IMG_NORM_PIXEL(inputImage, uv).rgb, LUMA);
  float r = dot(IMG_NORM_PIXEL(inputImage, uR).rgb, LUMA);
  float d = dot(IMG_NORM_PIXEL(inputImage, uD).rgb, LUMA);
  return clamp((abs(l - r) + abs(l - d)) * 3.0, 0.0, 1.0);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  // The edge detector's step : 1.5 pixels of a 1080p frame, relative to the
  // frame height (the same edges at 4K or on the dome).
  vec2 eo = vec2(1.0 / aspect, 1.0) * (1.5 / 1080.0);
  vec4 o4 = IMG_NORM_PIXEL(inputImage, uv);
  vec3 orig = o4.rgb;

  // Per-column phase + speed → a vertical drift that pulls the sample upward, so
  // the content appears to fall (rain). Columns individuate the fragmentation.
  float col = floor(uv.x * columns);
  float spd = 0.3 + h11(col) * 1.4;
  // Each column snaps back when its drop has fallen (a new drop starts), and
  // the top of the frame rains in from the bottom : both kept, they read as
  // rain, not as a flaw.
  float off = fract(PH_rain * spd + h11(col + 7.0));
  float len = mix(0.02, 0.5, streak);
  vec2 ruv = vec2(uv.x, fract(uv.y + off * len));

  // Where it rains: gated by edges (fragmentation "beyond form") × amount, with
  // a per-column flicker so streaks break rather than smear uniformly.
  // Edges both where the streak lands (the edge shatters in place) and where
  // its content comes from (edge fragments falling through flat areas).
  float e = mix(1.0, max(edgeMag(uv, eo), edgeMag(ruv, eo)), edges);
  float gate = clamp(amount * e * (0.4 + 0.6 * h11(col + floor(off * 3.0))), 0.0, 1.0);

  // The stereoscopic texture: each rained fragment gets a horizontal red/cyan
  // disparity from its own luma (depth), so it floats off the membrane in 3D.
  // Taps hoisted : the disparity is HORIZONTAL (it compiled diagonal before).
  vec3 rained = IMG_NORM_PIXEL(inputImage, ruv).rgb;
  float depth = dot(rained, LUMA);
  float d = (depth - 0.5) * disparity * 0.02;
  vec2 ruvL = ruv - vec2(d, 0.0);
  vec2 ruvR = ruv + vec2(d, 0.0);
  vec4 redT = IMG_NORM_PIXEL(inputImage, ruvL);
  vec4 cyanT = IMG_NORM_PIXEL(inputImage, ruvR);
  vec3 frag = vec3(redT.r, cyanT.g, cyanT.b);
  float fragA = max(redT.a, cyanT.a);

  // Straight alpha : fragments carry their own coverage, so rain falls into a
  // transparent layer without turning it into a black card.
  float a = mix(o4.a, fragA, gate);
  vec3 prem = mix(orig * o4.a, frag * fragA, gate);
  vec3 outc = a > 0.0 ? prem / a : vec3(0.0);
  gl_FragColor = vec4(clamp(outc, 0.0, 1.0), a);
}
