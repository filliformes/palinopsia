/*{
  "DESCRIPTION": "Light Trails : a max()-blend trails effect: keeps max(current, previous·decay) per channel, so the BRIGHTEST pixels persist and streak : long-exposure light-painting, distinct from the decay-mix feedback (which converges back to the fresh frame). decay 1 = permanent trails; below 1 they fade. Optional drift smears the trail as it fades.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Feedback"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "decay", "TYPE": "float", "MIN": 0.8,  "MAX": 1.0,  "DEFAULT": 0.97 },
    { "NAME": "drift", "TYPE": "float", "MIN": 0.0,  "MAX": 0.02, "DEFAULT": 0.0 },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0,  "MAX": 6.2832,"DEFAULT": 1.5708 }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    // The persistent buffer fades by decay and can drift along `angle`;
    // the fresh frame is kept where it's brighter (max, per channel).
    vec2 d = vec2(cos(angle), sin(angle)) * drift;
    vec2 sc = uv - d;
    vec3 prev = IMG_NORM_PIXEL(buf, sc).rgb * decay;
    vec3 live = IMG_NORM_PIXEL(inputImage, uv).rgb;
    gl_FragColor = vec4(max(prev, live), 1.0);
  } else {
    gl_FragColor = IMG_NORM_PIXEL(buf, uv);
  }
}
