/*{
  "DESCRIPTION": "Context — the always-on DEPTH finalizer, pinned last in the master chain after Vibe. It gives an image the dimensionality that makes it feel lifelike: temporal TRAILS (colours bleeding into one another over time, drifting gently into the distance), a soft key LIGHT with volumetric BLOOM on the highlights, atmospheric HAZE for aerial perspective, spatial BLUR, and a DEPTH vignette that seats the picture in space. Every parameter at zero is a clean passthrough — turn them up to add air, glow and magic.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color", "Master"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "trails",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2,  "LABEL": "trails" },
    { "NAME": "blur",       "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.08, "LABEL": "blur" },
    { "NAME": "bloom",      "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3,  "LABEL": "bloom" },
    { "NAME": "depth",      "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35, "LABEL": "depth" },
    { "NAME": "haze",       "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "haze" },
    { "NAME": "atmosphere", "TYPE": "color", "DEFAULT": [0.5, 0.58, 0.72, 1.0], "LABEL": "atmosphere" },
    { "NAME": "lightGlow",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "light" },
    { "NAME": "lightColor", "TYPE": "color", "DEFAULT": [1.0, 0.92, 0.8, 1.0], "LABEL": "light color" },
    { "NAME": "light",      "TYPE": "point2D", "DEFAULT": [0.5, 0.55] }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;

  if (PASSINDEX == 0) {
    // TRAILS: blend the live frame with a slightly zoomed copy of the previous
    // trailed frame, so colours bleed together and drift gently into the
    // distance (the zoom scales with depth). Capped below 1 so it always
    // decays — a leaky integrator, never an infinite hold or a runaway.
    vec4 cur = IMG_NORM_PIXEL(inputImage, uv);
    vec2 tuv = (uv - 0.5) * (1.0 - depth * 0.012) + 0.5;
    vec4 prev = IMG_NORM_PIXEL(buf, tuv);
    gl_FragColor = mix(cur, prev, trails * 0.9);
    return;
  }

  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  // ── BLUR — 9-tap ring; at blur==0 every tap coincides, so it's identity. ──
  float rb = blur * 0.03;
  vec2 c0 = uv;
  vec2 c1 = uv + vec2( rb, 0.0);
  vec2 c2 = uv + vec2(-rb, 0.0);
  vec2 c3 = uv + vec2(0.0,  rb);
  vec2 c4 = uv + vec2(0.0, -rb);
  vec2 c5 = uv + vec2( rb,  rb) * 0.71;
  vec2 c6 = uv + vec2(-rb,  rb) * 0.71;
  vec2 c7 = uv + vec2( rb, -rb) * 0.71;
  vec2 c8 = uv + vec2(-rb, -rb) * 0.71;
  vec3 s0 = IMG_NORM_PIXEL(buf, c0).rgb;
  vec3 s1 = IMG_NORM_PIXEL(buf, c1).rgb;
  vec3 s2 = IMG_NORM_PIXEL(buf, c2).rgb;
  vec3 s3 = IMG_NORM_PIXEL(buf, c3).rgb;
  vec3 s4 = IMG_NORM_PIXEL(buf, c4).rgb;
  vec3 s5 = IMG_NORM_PIXEL(buf, c5).rgb;
  vec3 s6 = IMG_NORM_PIXEL(buf, c6).rgb;
  vec3 s7 = IMG_NORM_PIXEL(buf, c7).rgb;
  vec3 s8 = IMG_NORM_PIXEL(buf, c8).rgb;
  vec3 col = s0 * 0.28 + (s1 + s2 + s3 + s4) * 0.12 + (s5 + s6 + s7 + s8) * 0.06;

  // ── BLOOM — wide ring, keep only the bright part, add it back as glow. ──
  float rg = 0.012 + bloom * 0.05;
  vec2 g1 = uv + vec2( rg, 0.0);
  vec2 g2 = uv + vec2(-rg, 0.0);
  vec2 g3 = uv + vec2(0.0,  rg);
  vec2 g4 = uv + vec2(0.0, -rg);
  vec2 g5 = uv + vec2( rg,  rg) * 0.71;
  vec2 g6 = uv + vec2(-rg,  rg) * 0.71;
  vec2 g7 = uv + vec2( rg, -rg) * 0.71;
  vec2 g8 = uv + vec2(-rg, -rg) * 0.71;
  vec3 h1 = IMG_NORM_PIXEL(buf, g1).rgb;
  vec3 h2 = IMG_NORM_PIXEL(buf, g2).rgb;
  vec3 h3 = IMG_NORM_PIXEL(buf, g3).rgb;
  vec3 h4 = IMG_NORM_PIXEL(buf, g4).rgb;
  vec3 h5 = IMG_NORM_PIXEL(buf, g5).rgb;
  vec3 h6 = IMG_NORM_PIXEL(buf, g6).rgb;
  vec3 h7 = IMG_NORM_PIXEL(buf, g7).rgb;
  vec3 h8 = IMG_NORM_PIXEL(buf, g8).rgb;
  vec3 bsum = (h1 + h2 + h3 + h4 + h5 + h6 + h7 + h8) * 0.125;
  float bl = max(max(bsum.r, bsum.g), bsum.b);
  vec3 bright = bsum * smoothstep(0.5, 0.95, bl);
  col += bright * bloom * 1.4;

  // ── KEY LIGHT — a soft, round radial glow from the light position in its
  //    own colour: a sense of a 3D light source sitting in the space. ──
  vec2 dl = (uv - light) * vec2(aspect, 1.0);
  float lg = exp(-dot(dl, dl) * 5.0);
  col += lightColor.rgb * lg * lightGlow * 1.2;

  // ── HAZE — shadows and distance recede toward the atmosphere colour (aerial
  //    perspective), pushing the darker material back into space. ──
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, atmosphere.rgb, haze * (1.0 - smoothstep(0.0, 0.55, lum)) * 0.7);

  // ── DEPTH vignette — a lifted, luminous centre falling to a darker,
  //    receding rim, seating the frame in a volume. ──
  vec2 dv = (uv - 0.5) * vec2(aspect, 1.0);
  float vig = 1.0 - smoothstep(0.35, 0.95, length(dv));
  col *= mix(1.0, 0.35 + 0.65 * vig, depth);

  gl_FragColor = vec4(col, 1.0);
}
