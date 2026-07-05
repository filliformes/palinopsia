/*{
  "DESCRIPTION": "Feedback Zoom — the deepest palinopsia move: the image feeds back into itself through a zoom and twist, echoes marching inward or outward. Persistent-buffer recursion; mix()-based decay so trails converge instead of blooming (brief §1).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Feedback"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "zoom",   "TYPE": "float", "MIN": 0.85, "MAX": 1.15, "DEFAULT": 1.03 },
    { "NAME": "twist",  "TYPE": "float", "MIN": -0.2, "MAX": 0.2,  "DEFAULT": 0.02 },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0,  "MAX": 0.95, "DEFAULT": 0.65 }
  ],
  "PASSES": [
    { "TARGET": "fbz", "PERSISTENT": true },
    { }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    // Sample the previous feedback frame through the inverse zoom/twist.
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = uv - 0.5;
    p.x *= aspect;
    float cs = cos(-twist);
    float sn = sin(-twist);
    p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
    p /= zoom;
    p.x /= aspect;
    vec2 c = clamp(p + 0.5, 0.0, 1.0);
    vec4 prev = IMG_NORM_PIXEL(fbz, c);
    vec4 live = IMG_NORM_PIXEL(inputImage, uv);
    // Decay register: mix toward the live frame — echoes always converge.
    gl_FragColor = mix(live, prev, amount);
  } else {
    gl_FragColor = IMG_NORM_PIXEL(fbz, uv);
  }
}
