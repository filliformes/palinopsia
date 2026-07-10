/*{
  "DESCRIPTION": "Pixel Sort : the signature glitch pixel-sort. Along a chosen axis, contiguous RUNS of pixels whose brightness falls inside a threshold band are pulled toward their brightest value : darks and lights separate into clean monotone streaks that stop dead at the band edges. Threshold (low/high) sets which pixels sort and breaks the image into sorted runs; angle picks the axis; reverse flips the pull direction. Matte, structural : the light-leak streaks read as a real sort, not a blur.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "low",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.25, "LABEL": "low" },
    { "NAME": "high",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.8,  "LABEL": "high" },
    { "NAME": "length", "TYPE": "float", "MIN": 0.0, "MAX": 0.6,  "DEFAULT": 0.2,  "LABEL": "run length" },
    { "NAME": "vertical", "TYPE": "bool", "DEFAULT": false, "LABEL": "vertical", "COMPACT": true },
    { "NAME": "reverse",  "TYPE": "bool", "DEFAULT": false, "LABEL": "reverse",  "COMPACT": true }
  ]
}*/

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 res = RENDERSIZE;
  vec2 dir = (vertical ? vec2(0.0, 1.0) : vec2(1.0, 0.0)) * (reverse ? -1.0 : 1.0);
  vec2 stp = dir / res;

  vec3 me = IMG_NORM_PIXEL(inputImage, uv).rgb;
  float myL = luma(me);
  // Pixels outside the band don't sort : clean passthrough (the run boundaries).
  if (myL < low || myL > high) {
    gl_FragColor = vec4(me, 1.0);
    return;
  }

  int span = int(length * (vertical ? res.y : res.x));
  vec3 best = me;
  float bestL = myL;
  // Walk back along the axis inside the contiguous in-band run, holding the
  // brightest colour seen : each pixel shows the max of its run up to here →
  // monotone bright streaks that terminate at the band edge (the sort look).
  for (int i = 1; i <= 96; i++) {
    if (i > span) break;
    vec3 c = IMG_NORM_PIXEL(inputImage, uv - stp * float(i)).rgb;
    float l = luma(c);
    if (l < low || l > high) break;      // run ends at a band edge
    if (l > bestL) { bestL = l; best = c; }
  }

  gl_FragColor = vec4(best, 1.0);
}
