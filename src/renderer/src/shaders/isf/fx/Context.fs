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
    { "NAME": "lightGlow",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1,  "LABEL": "light" },
    { "NAME": "lightSize",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5,  "LABEL": "light size" },
    { "NAME": "lightColor", "TYPE": "color", "DEFAULT": [1.0, 0.92, 0.8, 1.0], "LABEL": "light color" },
    { "NAME": "light",      "TYPE": "point2D", "DEFAULT": [0.5, 0.55] },
    { "NAME": "pbrTexture", "TYPE": "long",
      "VALUES": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],
      "LABELS": ["off","paper crumpled","paper rough","paper fibers","cardboard","bark fine","bark deep","bark plates","dry ground","sand dunes","sand ripples","rock face","rock rough","fabric weave","fabric knit","carpet","plaster","painted plaster","concrete","concrete rough","bricks","wood planks","wood grain","metal worn","corrugated steel","crushed foil","foil wrinkles","snow","lava","leather","gravel"],
      "DEFAULT": 0, "LABEL": "texture" },
    { "NAME": "pbrAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "relief" },
    { "NAME": "pbrScale",  "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0, "LABEL": "tex scale" },
    { "NAME": "pbrNormal", "TYPE": "image" },
    { "NAME": "pbrHeight", "TYPE": "image" },
    { "NAME": "pbrAO",     "TYPE": "image" }
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

  // ── PBR SURFACE (maps fed natively by the compositor; pbrTexture picks the
  //    material, this shader only sees its normal/height/AO). The composition
  //    is "projected" onto a physical relief: parallax-displaced by the height
  //    map along the surface normal, then — after blur/bloom, BEFORE the key
  //    light — shaded by the normals and occluded in the crevices, so the
  //    light plays over the material. pbrAmount 0 (or texture "off", which
  //    feeds flat neutral maps) is a clean passthrough. ──
  vec3 pnrm = vec3(0.0, 0.0, 1.0);
  float pao = 1.0;
  if (pbrAmount > 0.001) {
    vec2 tuv = fract(vec2(uv.x * aspect, uv.y) * pbrScale);
    pnrm = normalize(IMG_NORM_PIXEL(pbrNormal, tuv).rgb * 2.0 - 1.0);
    float ph = IMG_NORM_PIXEL(pbrHeight, tuv).r;
    pao = IMG_NORM_PIXEL(pbrAO, tuv).r;
    // Parallax: the image slides along the surface slope, most where the
    // relief is far from mid-height — the projector-on-crumpled-paper warp.
    uv += pnrm.xy * (ph - 0.5) * pbrAmount * 0.06;
  }

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

  // ── PBR shading — the relief responds to the key light's direction: facets
  //    toward the light lift, facets away fall into shadow, crevices occlude,
  //    and a restrained specular sheen rides the slopes. Normalized against
  //    the flat normal so a neutral map changes nothing. ──
  if (pbrAmount > 0.001) {
    vec3 L = normalize(vec3((light - uv) * vec2(aspect, 1.0), 0.55));
    float ndl = clamp(dot(pnrm, L), 0.0, 1.0);
    float flatNdl = clamp(L.z, 0.0, 1.0);
    float shade = (0.25 + 0.75 * ndl) / (0.25 + 0.75 * flatNdl);
    col *= mix(1.0, shade * mix(1.0, pao, 0.85), pbrAmount);
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(clamp(dot(pnrm, H), 0.0, 1.0), 24.0);
    col += lightColor.rgb * spec * pbrAmount * (0.15 + lightGlow * 0.5);
  }

  // ── KEY LIGHT — a soft, round radial glow from the light position in its
  //    own colour. lightSize sweeps it from a tight spot to a broad ambient
  //    wash across the whole frame. ──
  float falloff = mix(11.0, 0.35, lightSize);
  vec2 dl = (uv - light) * vec2(aspect, 1.0);
  float lg = exp(-dot(dl, dl) * falloff);
  col += lightColor.rgb * lg * lightGlow * 1.3;

  // ── HAZE — the whole frame settles toward the atmosphere colour, strongest
  //    in the shadows/distance (aerial perspective), with a lighter global veil
  //    over the midtones and highlights so the tint always reads. ──
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float atmoAmt = haze * (0.18 + 0.82 * (1.0 - smoothstep(0.0, 0.6, lum)));
  col = mix(col, atmosphere.rgb, atmoAmt);

  // ── DEPTH vignette — a lifted, luminous centre falling to a darker,
  //    receding rim, seating the frame in a volume. ──
  vec2 dv = (uv - 0.5) * vec2(aspect, 1.0);
  float vig = 1.0 - smoothstep(0.35, 0.95, length(dv));
  col *= mix(1.0, 0.35 + 0.65 * vig, depth);

  gl_FragColor = vec4(col, 1.0);
}
