/*{
  "DESCRIPTION": "Congeal — a self-referential feedback field (Signal Culture Maelstrom/Frame-Buffer lineage): sparse bright seeds are injected, then the persistent buffer resamples a domain-warped, decayed copy of itself each frame, so material congeals into slow drifting masses and dissolves. Matte, near-black, disciplined decay (brief §1).",
  "CREDIT": "Palinopsia (after Signal Culture feedback apps)",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Feedback"],
  "INPUTS": [
    { "NAME": "rate",  "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,  "DEFAULT": 0.4 },
    { "NAME": "decay", "TYPE": "float", "MIN": 0.8,  "MAX": 0.995,"DEFAULT": 0.96 },
    { "NAME": "warp",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.4 },
    { "NAME": "seed",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "scale", "TYPE": "float", "MIN": 0.5,  "MAX": 8.0,  "DEFAULT": 2.5 },
    { "NAME": "tint",  "TYPE": "color", "DEFAULT": [0.55, 0.72, 0.7, 1.0] }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;

  if (PASSINDEX == 0) {
    float t = TIME * rate;
    // Domain-warp the lookup into the previous frame — this is what makes it
    // congeal and drift rather than just fade.
    vec2 flow = vec2(
      vnoise(uv * scale + vec2(t * 0.3, 0.0)),
      vnoise(uv * scale + vec2(0.0, -t * 0.27) + 11.0)
    ) - 0.5;
    vec2 sc = uv + flow * warp * 0.03;
    vec3 prev = IMG_NORM_PIXEL(buf, sc).rgb * decay;
    // Inject sparse bright seeds on a stepped clock.
    float step_ = floor(TIME * (2.0 + rate * 8.0));
    vec2 cell = floor(uv * vec2(140.0, 84.0));
    float spark = step(1.0 - seed * 0.03, hash(cell + step_ * 3.1));
    gl_FragColor = vec4(clamp(prev + vec3(spark), 0.0, 1.0), 1.0);
  } else {
    float v = IMG_NORM_PIXEL(buf, uv).r;
    vec3 base = vec3(0.02, 0.02, 0.025);
    vec3 col = base + tint.rgb * v;
    col *= 0.95 + 0.05 * sin(uv.y * RENDERSIZE.y * 3.14159);
    gl_FragColor = vec4(col, 1.0);
  }
}
