/*{
  "DESCRIPTION": "Context : the always-on DEPTH finalizer, pinned last in the master chain after Vibe. It gives an image the dimensionality that makes it feel lifelike: temporal TRAILS (colours bleeding into one another over time, drifting gently into the distance), a soft key LIGHT with volumetric BLOOM on the highlights, atmospheric HAZE for aerial perspective, spatial BLUR, and a DEPTH vignette that seats the picture in space. Every parameter at zero is a clean passthrough : turn them up to add air, glow and magic.",
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
    { "NAME": "lightOrder", "TYPE": "bool", "DEFAULT": true, "LABEL": "light order" },
    { "NAME": "pbrTexture", "TYPE": "long",
      "VALUES": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],
      "LABELS": ["off","paper crumpled","paper rough","paper fibers","cardboard","bark fine","bark deep","bark plates","dry ground","sand dunes","sand ripples","rock face","rock rough","fabric weave","fabric knit","carpet","plaster","painted plaster","concrete","concrete rough","bricks","wood planks","wood grain","metal worn","corrugated steel","crushed foil","foil wrinkles","snow","lava","leather","gravel"],
      "DEFAULT": 0, "LABEL": "texture" },
    { "NAME": "pbrAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "relief" },
    { "NAME": "pbrLight",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55, "LABEL": "raking" },
    { "NAME": "pbrScale",  "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0, "LABEL": "tex scale" },
    { "NAME": "pbrDepth",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "field depth" },
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
    // decays : a leaky integrator, never an infinite hold or a runaway.
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
  //    map along the surface normal, then : after blur/bloom, BEFORE the key
  //    light : shaded by the normals and occluded in the crevices, so the
  //    light plays over the material. pbrAmount 0 (or texture "off", which
  //    feeds flat neutral maps) is a clean passthrough. ──
  vec3 pnrm = vec3(0.0, 0.0, 1.0);
  float pao = 1.0;
  float pshadow = 1.0;
  if (pbrAmount > 0.001) {
    // PARALLAX OCCLUSION MAPPING : ray-march the height field so the projected
    // image is displaced by the true DEPTH of each feature (sinks into crevices,
    // rides over bumps) : the "projected onto a complex 3D surface" warp, not a
    // flat nudge. A gentle perspective throw from centre makes features near the
    // edges parallax more, as a real projector throw would.
    // FIELD DEPTH (pbrDepth) = viewing distance. Stepping BACK : you see MORE of
    // the surface (it tiles denser), the relief flattens, and the perspective
    // throw becomes less extreme (more orthographic) : the material reads from
    // afar rather than pressed against your eye.
    float pscl = pbrScale * (1.0 + pbrDepth * 2.5);
    vec2 vdir = (uv - 0.5) * vec2(aspect, 1.0) * (1.0 - pbrDepth * 0.6);
    // Displacement amplitude : the geometric throw of the projected image into
    // the relief. Much deeper than a flat nudge (features really sink / ride),
    // and it grows with the RAKING control so a hard-lit material also parallaxes
    // harder. 24 march steps keep the deeper throw artefact-free.
    float amp = pbrAmount * (0.24 + pbrLight * 0.14) * (1.0 - pbrDepth * 0.55);
    vec2 stepUV = vdir * amp / 24.0;
    float layer = 1.0 / 24.0;
    vec2 pp = uv;
    float curD = 0.0;
    float hd = 1.0 - IMG_NORM_PIXEL(pbrHeight, fract(vec2(pp.x * aspect, pp.y) * pscl)).r;
    for (int i = 0; i < 24; i++) {
      if (curD >= hd) break;
      pp += stepUV;
      hd = 1.0 - IMG_NORM_PIXEL(pbrHeight, fract(vec2(pp.x * aspect, pp.y) * pscl)).r;
      curD += layer;
    }
    // Refine : interpolate the exact crossing so the surface reads smooth.
    vec2 prev = pp - stepUV;
    float aft = hd - curD;
    float bef = (1.0 - IMG_NORM_PIXEL(pbrHeight, fract(vec2(prev.x * aspect, prev.y) * pscl)).r) - (curD - layer);
    pp = mix(pp, prev, clamp(aft / (aft - bef + 1e-4), 0.0, 1.0));
    // Reference to the mid-plane (height 0.5) so a FLAT/neutral map (texture off)
    // gives ZERO displacement; raised vs recessed features then shift oppositely.
    uv = pp - vdir * amp * 0.5;                        // parallax-corrected sample point

    vec2 tuv = fract(vec2(uv.x * aspect, uv.y) * pscl);
    pnrm = normalize(IMG_NORM_PIXEL(pbrNormal, tuv).rgb * 2.0 - 1.0);
    pao = IMG_NORM_PIXEL(pbrAO, tuv).r;

    // Soft self-shadow : march toward the light; where the relief rises above the
    // ray the point sits in shadow → cast shadows in the crevices (the strongest
    // depth cue, the thing that sells "lit 3D surface").
    // Graze the light lower across the surface as raking rises (Ls.z shrinks →
    // longer, deeper cast shadows), then march farther and darker. The shadow
    // floor drops toward near-black at full raking : real crevice darkness.
    vec3 Ls = normalize(vec3((light - uv) * vec2(aspect, 1.0), mix(0.6, 0.22, pbrLight)));
    if (Ls.z > 0.03) {
      float surfH = IMG_NORM_PIXEL(pbrHeight, tuv).r;
      float occ = 0.0;
      for (int j = 1; j <= 10; j++) {
        vec2 sp = uv + Ls.xy * amp * 1.6 * (float(j) / 10.0);
        float hs = IMG_NORM_PIXEL(pbrHeight, fract(vec2(sp.x * aspect, sp.y) * pscl)).r;
        occ = max(occ, hs - surfH - float(j) / 10.0 * 0.10);
      }
      pshadow = clamp(1.0 - occ * (5.0 + pbrLight * 11.0), 0.02, 1.0);
    }
  }

  // ── BLUR : 9-tap ring; at blur==0 every tap coincides, so it's identity. ──
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

  // ── BLOOM : wide ring, keep only the bright part, add it back as glow. ──
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

  // ── PBR shading : the relief responds to the key light's direction: facets
  //    toward the light lift, facets away fall into shadow, crevices occlude,
  //    and a restrained specular sheen rides the slopes. Normalized against
  //    the flat normal so a neutral map changes nothing. ──
  if (pbrAmount > 0.001) {
    float rk = pbrLight; // RAKING : how hard the light grazes the material.
    vec3 L = normalize(vec3((light - uv) * vec2(aspect, 1.0), mix(0.6, 0.28, rk)));
    float ndl = clamp(dot(pnrm, L), 0.0, 1.0);
    float flatNdl = clamp(L.z, 0.0, 1.0);
    // Diffuse relief lighting × the cast self-shadow × ambient occlusion. The
    // ambient floor DROPS as raking rises → deeper shadows, more chiaroscuro in
    // the material. FIELD DEPTH lifts it back up (a distant surface reads softer,
    // more ambient, less raking contrast).
    float amb = mix(mix(0.30, 0.03, rk), 0.5, pbrDepth);
    float diff = (amb + (1.0 - amb) * ndl) / (amb + (1.0 - amb) * flatNdl);
    // Expand the diffuse swing around the flat reference (1.0) so lit facets punch
    // brighter and shadowed facets fall darker : the extra material CONTRAST the
    // relief needs. A neutral map (diff==1) is untouched.
    diff = 1.0 + (diff - 1.0) * (1.0 + rk * 2.4);
    float shade = diff * mix(pshadow, 1.0, pbrDepth * 0.6) * mix(1.0, pao, 0.7 + rk * 0.3);
    col *= mix(1.0, max(shade, 0.0), pbrAmount);
    // Rim / fresnel : slopes turned away from the screen catch a thin edge light,
    // popping each bump off the surface (stronger with raking, softens with distance).
    float fres = pow(1.0 - clamp(pnrm.z, 0.0, 1.0), 3.0);
    col += lightColor.rgb * fres * pbrAmount * (0.12 + rk * 0.24) * (1.0 - pbrDepth * 0.5);
    // Specular sheen riding the slopes : tighter + hotter as raking rises, broader
    // and gentler from afar.
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(clamp(dot(pnrm, H), 0.0, 1.0), mix(mix(18.0, 48.0, rk), 12.0, pbrDepth));
    col += lightColor.rgb * spec * pbrAmount * (0.18 + lightGlow * 0.6 + rk * 0.5) * (1.0 - pbrDepth * 0.4);
    // Atmospheric recession : the stepped-back surface settles a touch toward the
    // atmosphere colour (the "context" shifts as you pull away).
    col = mix(col, atmosphere.rgb, pbrDepth * 0.14 * pbrAmount);
  }

  // ── KEY LIGHT : a soft radial glow from the light position in its own colour;
  //    lightSize sweeps it from a tight spot to a broad ambient wash. Computed
  //    once, then added either PRE (before haze + vignette, which wash / darken
  //    it : the old behaviour) or POST (after them, so it punches through haze,
  //    the vignette and any hard master FX below : always reads). The Light
  //    PRE/POST toggle in the Inspector picks which. ──
  float falloff = mix(11.0, 0.35, lightSize);
  vec2 dl = (uv - light) * vec2(aspect, 1.0);
  float lg = exp(-dot(dl, dl) * falloff);
  vec3 keyLight = lightColor.rgb * lg * lightGlow * 1.3;
  if (!lightOrder) col += keyLight; // PRE

  // ── HAZE : the whole frame settles toward the atmosphere colour, strongest
  //    in the shadows/distance (aerial perspective), with a lighter global veil
  //    over the midtones and highlights so the tint always reads. ──
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float atmoAmt = haze * (0.18 + 0.82 * (1.0 - smoothstep(0.0, 0.6, lum)));
  col = mix(col, atmosphere.rgb, atmoAmt);

  // ── DEPTH vignette : a lifted, luminous centre falling to a darker,
  //    receding rim, seating the frame in a volume. ──
  vec2 dv = (uv - 0.5) * vec2(aspect, 1.0);
  float vig = 1.0 - smoothstep(0.35, 0.95, length(dv));
  col *= mix(1.0, 0.35 + 0.65 * vig, depth);

  if (lightOrder) col += keyLight; // POST (default)

  gl_FragColor = vec4(col, 1.0);
}
