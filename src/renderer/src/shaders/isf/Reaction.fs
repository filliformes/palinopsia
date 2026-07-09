/*{
  "DESCRIPTION": "Reaction : a Gray-Scott reaction-diffusion field. Two virtual chemicals react and diffuse in a persistent buffer, self-organising into drifting spots, stripes, labyrinths and splitting 'critters'. An organic, matte, near-black texture that lives at its own edge of chaos : feed and kill are the two exciters, continuous seeding keeps it alive and never a radial mandala.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "feed",  "TYPE": "float", "MIN": 0.008, "MAX": 0.09, "DEFAULT": 0.037, "LABEL": "feed" },
    { "NAME": "kill",  "TYPE": "float", "MIN": 0.03,  "MAX": 0.07, "DEFAULT": 0.06,  "LABEL": "kill" },
    { "NAME": "rate",  "TYPE": "float", "MIN": 0.3,   "MAX": 1.4,  "DEFAULT": 1.0,   "LABEL": "rate" },
    { "NAME": "scale", "TYPE": "float", "MIN": 0.0,   "MAX": 1.0,  "DEFAULT": 0.4,   "LABEL": "scale" },
    { "NAME": "seed",  "TYPE": "float", "MIN": 0.0,   "MAX": 1.0,  "DEFAULT": 0.3,   "LABEL": "seeding" },
    { "NAME": "sharp", "TYPE": "float", "MIN": 0.0,   "MAX": 1.0,  "DEFAULT": 0.5,   "LABEL": "sharpness" },
    { "NAME": "zoom",  "TYPE": "float", "MIN": 0.25,  "MAX": 4.0,  "DEFAULT": 1.0,   "LABEL": "zoom" },
    { "NAME": "panX",  "TYPE": "float", "MIN": -1.0,  "MAX": 1.0,  "DEFAULT": 0.0,   "LABEL": "pan x" },
    { "NAME": "panY",  "TYPE": "float", "MIN": -1.0,  "MAX": 1.0,  "DEFAULT": 0.0,   "LABEL": "pan y" },
    { "NAME": "rotate","TYPE": "float", "MIN": -1.0,  "MAX": 1.0,  "DEFAULT": 0.0,   "LABEL": "rotate" },
    { "NAME": "tint",  "TYPE": "color", "DEFAULT": [0.75, 0.78, 0.72, 1.0] }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

float h21(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.35); return fract(p.x * p.y); }

void main() {
  vec2 uv = isf_FragNormCoord;

  if (PASSINDEX == 0) {
    // ── Gray-Scott step (U in R, V in G). `scale` coarsens the sampling grid so
    //    the critters grow larger than a single pixel. ──
    vec2 texel = (1.0 / RENDERSIZE) * (1.0 + scale * 4.0);
    vec2 e = vec2(texel.x, 0.0), f2 = vec2(0.0, texel.y);
    vec2 c = IMG_NORM_PIXEL(buf, uv).rg;
    vec2 lap = c * -1.0
      + 0.2 * (IMG_NORM_PIXEL(buf, uv + e).rg + IMG_NORM_PIXEL(buf, uv - e).rg
             + IMG_NORM_PIXEL(buf, uv + f2).rg + IMG_NORM_PIXEL(buf, uv - f2).rg)
      + 0.05 * (IMG_NORM_PIXEL(buf, uv + e + f2).rg + IMG_NORM_PIXEL(buf, uv - e - f2).rg
             + IMG_NORM_PIXEL(buf, uv + e - f2).rg + IMG_NORM_PIXEL(buf, uv - e + f2).rg);

    float U = c.x, V = c.y;
    if (U < 0.001 && V < 0.001) U = 1.0; // bootstrap the empty buffer (+ heal dead zones) to the U=1 background
    float uvv = U * V * V;
    float dt = rate;
    U = clamp(U + (1.0 * lap.x - uvv + feed * (1.0 - U)) * dt, 0.0, 1.0);
    V = clamp(V + (0.5 * lap.y + uvv - (feed + kill) * V) * dt, 0.0, 1.0);

    // Sparse V seeding : nucleates new critters + keeps it off its frozen fixed
    // point (also the initial spark once U has filled to 1).
    float s = step(1.0 - seed * 0.006, h21(floor(uv * RENDERSIZE / 6.0) + floor(TIME * 1.5)));
    V = min(1.0, V + s * 0.5);
    gl_FragColor = vec4(U, V, 0.0, 1.0);
  } else {
    // ── Present : V drives a matte pattern over near-black. A zoom/pan/rotate
    //    transform (about centre) lets the field fill the frame at any framing;
    //    the sample wraps (fract) so it always covers the whole screen. ──
    vec2 p = uv - 0.5;
    float a = rotate * 3.14159265;
    p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
    p = p / max(0.05, zoom) + vec2(panX, panY) * 0.5 + 0.5;
    p = fract(p);
    float V = IMG_NORM_PIXEL(buf, p).g;
    float v = smoothstep(0.08, 0.35, pow(clamp(V, 0.0, 1.0), mix(1.0, 3.0, sharp)));
    vec3 base = vec3(0.02, 0.02, 0.025);
    gl_FragColor = vec4(mix(base, tint.rgb, v), 1.0);
  }
}
