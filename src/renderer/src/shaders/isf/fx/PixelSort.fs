/*{
  "DESCRIPTION": "Pixel Sort : the signature glitch pixel-sort. Along a chosen axis, contiguous RUNS of pixels whose brightness falls inside a threshold band are pulled toward their brightest value : darks and lights separate into clean monotone streaks that stop dead at the band edges. Threshold (low/high) sets which pixels sort and breaks the image into sorted runs; run length is a share of the frame along the axis (long runs step over a few pixels at a time, so a stray pixel inside a run can be skipped); vertical picks the axis, angle tilts it, reverse flips the pull direction. Matte, structural : the light-leak streaks read as a real sort, not a blur.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "low",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.25, "LABEL": "low" },
    { "NAME": "high",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.8,  "LABEL": "high" },
    { "NAME": "length", "TYPE": "float", "MIN": 0.0, "MAX": 0.6,  "DEFAULT": 0.2,  "LABEL": "run length" },
    { "NAME": "vertical", "TYPE": "bool", "DEFAULT": false, "LABEL": "vertical", "COMPACT": true },
    { "NAME": "reverse",  "TYPE": "bool", "DEFAULT": false, "LABEL": "reverse",  "COMPACT": true },
    { "NAME": "angle",  "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0, "LABEL": "angle" }
  ]
}*/

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 res = RENDERSIZE;
  // Axis in PIXEL space (so a tilted run stays straight at any aspect), tilted by
  // `angle` from the vertical / horizontal choice.
  vec2 axis = vertical ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  float ca = cos(angle), sa = sin(angle);
  vec2 dir = vec2(axis.x * ca - axis.y * sa, axis.x * sa + axis.y * ca) * (reverse ? -1.0 : 1.0);

  vec4 meS = IMG_NORM_PIXEL(inputImage, uv);
  vec3 me = meS.rgb;
  float myL = luma(me);
  // Pixels outside the band don't sort : clean passthrough (the run boundaries).
  if (myL < low || myL > high) {
    gl_FragColor = meS;
    return;
  }

  // Run length in pixels along the axis. The walk is capped at 96 taps, so a
  // long run strides over several pixels per tap (it used to stop at 96 px,
  // which left `length` dead above 0.05).
  float spanPx = length * (abs(dir.x) * res.x + abs(dir.y) * res.y);
  float stride = max(1.0, ceil(spanPx / 96.0)); // whole pixels : taps stay on texel centers
  int taps = int(min(spanPx / stride, 96.0));
  vec2 stp = dir * stride / res;

  vec3 best = me;
  float bestL = myL;
  float bestA = meS.a;
  // Walk back along the axis inside the contiguous in-band run, holding the
  // brightest color seen : each pixel shows the max of its run up to here →
  // monotone bright streaks that terminate at the band edge (the sort look).
  for (int i = 1; i <= 96; i++) {
    if (i > taps) break;
    vec2 sp = uv - stp * float(i);
    vec4 cs = IMG_NORM_PIXEL(inputImage, sp);
    float l = luma(cs.rgb);
    if (l < low || l > high) break;      // run ends at a band edge
    if (l > bestL) { bestL = l; best = cs.rgb; bestA = cs.a; }
  }

  gl_FragColor = vec4(best, max(meS.a, bestA));
}
