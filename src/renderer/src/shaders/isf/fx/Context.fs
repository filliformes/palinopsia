/*{
  "DESCRIPTION": "Context : the always-on DEPTH finalizer, pinned last in the master chain after Vibe. It gives an image the dimensionality that makes it feel lifelike: temporal TRAILS (colors bleeding into one another over time, swelling gently outward toward you), a soft key LIGHT with volumetric BLOOM on the highlights, atmospheric HAZE for aerial perspective, spatial BLUR (a ring of ghost copies by default, a jittered soft blur as ghosts↔smooth goes up), and a DEPTH vignette that seats the picture in space. Every parameter at zero is a clean passthrough on the same frame (the output is always opaque) : turn them up to add air, glow and magic.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color", "Master"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "trails",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2,  "LABEL": "trails" },
    { "NAME": "blur",       "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0,  "LABEL": "blur" },
    { "NAME": "bloom",      "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3,  "LABEL": "bloom" },
    { "NAME": "smoothing",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0,  "LABEL": "ghosts↔smooth" },
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
      "LABELS": ["off","paper crumpled","paper rough","paper fibers","cardboard","bark fine","bark deep","bark plates","dry ground","sand dunes","sand ripples","rock face","stacked stone","fabric weave","fabric knit","carpet","plaster","painted plaster","concrete","concrete rough","bricks","wood planks","wood grain","metal worn","corrugated steel","crushed foil","foil wrinkles","snow","lava","leather","gravel"],
      "DEFAULT": 0, "LABEL": "texture" },
    { "NAME": "pbrAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "relief" },
    { "NAME": "pbrLight",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55, "LABEL": "raking" },
    { "NAME": "pbrScale",  "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0, "LABEL": "tex scale" },
    { "NAME": "pbrDepth",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "field depth" },
    { "NAME": "pbrEvolve", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "evolution" },
    { "NAME": "pbrNormal", "TYPE": "image" },
    { "NAME": "pbrHeight", "TYPE": "image" },
    { "NAME": "pbrAO",     "TYPE": "image" },
    { "NAME": "voidEdge",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "void" }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

// Void / edge-dissolve noise (a ragged erosion boundary, not a clean vignette).
float vHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vHash(i), vHash(i + vec2(1.0, 0.0)), f.x),
             mix(vHash(i + vec2(0.0, 1.0)), vHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float vFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vNoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

// Interleaved gradient noise : a per-pixel jitter that spreads sparse ring taps
// into a smooth disc (the `smoothing` control).
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

// TRAILS : the live frame blended with a slightly zoomed copy of the previous
// trailed frame, so colors bleed together and swell gently outward (the zoom
// scales with depth). Frame-rate independent (tuned at 60 fps) and stepping at
// least one 8-bit level toward the live frame, so even trails 1 clears instead
// of leaving a faint ghost for good. Capped below 1 : always a leaky
// integrator, never an infinite hold or a runaway. An empty buffer (first frame,
// PANIC, resize) starts from the live frame, not from black.
float gDt60;
float gK;
float gZoom;
vec4 trailAt(vec2 c) {
  vec4 cur = IMG_NORM_PIXEL(inputImage, c);
  if (gK < 0.0005) return cur;
  vec2 tc = (c - 0.5) * gZoom + 0.5;
  vec4 prev = IMG_NORM_PIXEL(buf, tc);
  if (prev.a < 0.5 / 255.0) return cur;
  vec4 d = prev - cur;
  return cur + sign(d) * max(abs(d) * gK - 1.0 / 255.0, 0.0);
}

// Surface coordinate of a frame point (the material's own space) : aspect space,
// the EVOLUTION sway (the surface drifting under the projection), the organic
// warp, the tile scale, and the scan's own proportions. Set per frame in main.
float gAspect;
vec2 gSway;
mat2 gSpin;
vec2 gCtr;
vec2 gTAsp;
vec2 gLightP;
vec2 surfAt(vec2 p, vec2 warp, float pscl) {
  vec2 q = gSpin * (vec2(p.x * gAspect, p.y) - gCtr) + gCtr + gSway;
  return (q + warp) * pscl * gTAsp;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  gDt60 = clamp(TIMEDELTA, 0.004, 0.25) * 60.0;
  gK = pow(clamp(trails, 0.0, 1.0) * 0.9, gDt60);
  gZoom = pow(1.0 - depth * 0.012, gDt60);

  if (PASSINDEX == 0) {
    gl_FragColor = trailAt(uv);
    return;
  }
  // Pass 1 rebuilds the trailed frame at every tap (live frame + last frame's
  // trail buffer) instead of reading this frame's pass 0, which the ISF runtime
  // only flips after the last pass : that read put the whole master output one
  // frame late.

  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  // The surface stage runs only with a material chosen : texture "off" is an exact
  // passthrough whatever relief holds (its flat maps are 8-bit, so "flat" is a
  // hair off 0.5 : the stage used to shift and shade the whole frame slightly, a
  // soft blur with every visible slider at 0, since relief hides with the texture).
  bool pbrOn = pbrAmount > 0.001 && pbrTexture > 0;

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
  if (pbrOn) {
    // PARALLAX OCCLUSION MAPPING : ray-march the height field so the projected
    // image is displaced by the true DEPTH of each feature (sinks into crevices,
    // rides over bumps) : the "projected onto a complex 3D surface" warp, not a
    // flat nudge. A gentle perspective throw from center makes features near the
    // edges parallax more, as a real projector throw would.
    // FIELD DEPTH (pbrDepth) = viewing distance. Stepping BACK : you see MORE of
    // the surface (it tiles denser), the relief flattens, and the perspective
    // throw becomes less extreme (more orthographic) : the material reads from
    // afar rather than pressed against your eye.
    float pscl = pbrScale * (1.0 + pbrDepth * 2.5);
    // EVOLUTION : a little wind on the projector, or on the camera filming the
    // surface. The material drifts under the image in a slow irregular sway with a
    // lighter flutter riding on it in gusts, turns and breathes very slightly; the
    // viewpoint and the raking light move with it and the organic warp slowly
    // morphs, so the relief never sits still. 0 = perfectly still, as before.
    float ev = clamp(pbrEvolve, 0.0, 1.0);
    float et = TIME;
    vec2 drift = vec2(sin(et * 0.23) + 0.55 * sin(et * 0.61 + 1.3), sin(et * 0.19 + 2.0) + 0.55 * sin(et * 0.53 + 0.4));
    vec2 flutter = vec2(sin(et * 1.7 + 0.8) + 0.6 * sin(et * 2.9 + 2.2), sin(et * 1.9 + 1.6) + 0.6 * sin(et * 3.3 + 0.2));
    float gust = 0.5 + 0.5 * sin(et * 0.37 + 0.9) * sin(et * 0.13 + 2.4);
    gAspect = aspect;
    gSway = (drift * 0.006 + flutter * 0.0012 * gust) * ev;
    float spin = (sin(et * 0.17 + 0.6) + 0.5 * sin(et * 0.43 + 2.1)) * 0.004 * ev;
    float breathe = 1.0 + (sin(et * 0.29 + 1.1) + 0.5 * sin(et * 0.71 + 0.3)) * 0.004 * ev;
    gSpin = mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * breathe;
    gCtr = vec2(aspect * 0.5, 0.5);
    gLightP = light + gSway / vec2(aspect, 1.0) * 2.0;
    float wph = et * 0.09 * ev;
    // The scans keep their own proportions : a 2:1 scan tiles 2:1. They used to be
    // squeezed into a square tile, stretching bricks, concrete, steel, plaster,
    // wood grain and rock face to twice their height.
    vec2 mapSize = IMG_SIZE(pbrHeight);
    gTAsp = vec2(mapSize.y / max(mapSize.x, 1.0), 1.0);
    vec2 vdir = (uv - 0.5 - gSway / vec2(aspect, 1.0) * 1.5) * vec2(aspect, 1.0) * (1.0 - pbrDepth * 0.6);
    // Displacement amplitude : the geometric throw of the projected image into
    // the relief. Much deeper than a flat nudge (features really sink / ride),
    // and it grows with the RAKING control so a hard-lit material also parallaxes
    // harder. 24 march steps keep the deeper throw artefact-free.
    float amp = pbrAmount * (0.24 + pbrLight * 0.14) * (1.0 - pbrDepth * 0.55);
    // ORGANIC TILING : the maps are REPEAT-wrapped in hardware, so we sample the
    // raw scaled coords WITHOUT fract(). fract() jumps 1→0 at every tile edge,
    // which spikes the screen-space derivative → the GPU drops to the coarsest
    // mip and draws a dark seam line along each boundary (the "lines" at high tex
    // scale). Hardware REPEAT tiles seamlessly with continuous derivatives, so
    // the seams vanish. On top of that we domain-warp the coords with a smooth,
    // incommensurate field so the repeat reads organic rather than as a rigid grid.
    vec2 wq = vec2(uv.x * aspect, uv.y);
    vec2 warp = vec2(
      sin(wq.x * 5.3 + wq.y * 2.1 + wph) + 0.5 * sin(wq.y * 9.7 - wq.x * 3.3 - wph * 1.3),
      cos(wq.y * 4.7 - wq.x * 2.7 + wph * 0.8) + 0.5 * cos(wq.x * 8.9 + wq.y * 3.1 + wph * 1.1)
    ) * 0.04;
    // vdir is in aspect space (x scaled by aspect); march in uv, so the throw
    // is the same length horizontally and vertically.
    vec2 vuv = vdir / vec2(aspect, 1.0);
    vec2 stepUV = vuv * amp / 24.0;
    float layer = 1.0 / 24.0;
    vec2 pp = uv;
    float curD = 0.0;
    // (Height-map coordinates are hoisted into bare vec2s : the ISF parser
    // splits IMG_NORM_PIXEL's argument on commas and silently drops the rest.)
    vec2 hc = surfAt(pp, warp, pscl);
    float hd = 1.0 - IMG_NORM_PIXEL(pbrHeight, hc).r;
    for (int i = 0; i < 24; i++) {
      if (curD >= hd) break;
      pp += stepUV;
      hc = surfAt(pp, warp, pscl);
      hd = 1.0 - IMG_NORM_PIXEL(pbrHeight, hc).r;
      curD += layer;
    }
    // Refine : interpolate the exact crossing so the surface reads smooth.
    vec2 prev = pp - stepUV;
    float aft = hd - curD;
    vec2 hp = surfAt(prev, warp, pscl);
    float bef = (1.0 - IMG_NORM_PIXEL(pbrHeight, hp).r) - (curD - layer);
    pp = mix(pp, prev, clamp(aft / (aft - bef + 1e-4), 0.0, 1.0));
    // Reference to the mid-plane (height 0.5) so a FLAT/neutral map (texture off)
    // gives ZERO displacement; raised vs recessed features then shift oppositely.
    uv = pp - vuv * amp * 0.5;                         // parallax-corrected sample point

    vec2 tuv = surfAt(uv, warp, pscl);
    pnrm = normalize(IMG_NORM_PIXEL(pbrNormal, tuv).rgb * 2.0 - 1.0);
    pao = IMG_NORM_PIXEL(pbrAO, tuv).r;

    // Soft self-shadow : march toward the light; where the relief rises above the
    // ray the point sits in shadow → cast shadows in the crevices (the strongest
    // depth cue, the thing that sells "lit 3D surface").
    // Graze the light lower across the surface as raking rises (Ls.z shrinks →
    // longer, deeper cast shadows), then march farther and darker. The shadow
    // floor drops toward near-black at full raking : real crevice darkness.
    vec3 Ls = normalize(vec3((gLightP - uv) * vec2(aspect, 1.0), mix(0.6, 0.22, pbrLight)));
    if (Ls.z > 0.03) {
      float surfH = IMG_NORM_PIXEL(pbrHeight, tuv).r;
      float occ = 0.0;
      vec2 Luv = Ls.xy / vec2(aspect, 1.0); // aspect space -> uv
      for (int j = 1; j <= 10; j++) {
        vec2 sp = uv + Luv * amp * 1.6 * (float(j) / 10.0);
        vec2 sc = surfAt(sp, warp, pscl);
        float hs = IMG_NORM_PIXEL(pbrHeight, sc).r;
        occ = max(occ, hs - surfH - float(j) / 10.0 * 0.10);
      }
      pshadow = clamp(1.0 - occ * (5.0 + pbrLight * 11.0), 0.02, 1.0);
    }
  }

  // ── BLUR : a 9-tap ring (center + 8). Its sparse taps read as a ring of
  //    ghost copies at larger radii : that double-vision IS the default look.
  //    `smoothing` jitters the ring per pixel (rotation + radius) into a soft,
  //    grainy-smooth disc. Radii are in frame heights, aspect-correct (sized so
  //    the area matches the old 16:9 ellipse). At blur 0 every tap coincides. ──
  vec2 toUv = vec2(1.0 / aspect, 1.0);
  float jr = ign(gl_FragCoord.xy);
  float jd = ign(gl_FragCoord.xy + vec2(47.0, 17.0));
  float ang = (jr - 0.5) * smoothing * 0.7853982;       // up to +-22.5 deg : fills between the 8 taps
  float rad = mix(1.0, 0.3 + 0.7 * jd, smoothing);       // and scatters the radius into the disc
  vec2 ex = vec2(cos(ang), sin(ang)) * rad;           // rotated unit axes
  vec2 ey = vec2(-ex.y, ex.x);
  float rb = blur * 0.04;
  vec2 ax = ex * rb * toUv;
  vec2 ay = ey * rb * toUv;
  vec2 c0 = uv;
  vec2 c1 = uv + ax;
  vec2 c2 = uv - ax;
  vec2 c3 = uv + ay;
  vec2 c4 = uv - ay;
  vec2 c5 = uv + (ax + ay) * 0.71;
  vec2 c6 = uv + (ay - ax) * 0.71;
  vec2 c7 = uv + (ax - ay) * 0.71;
  vec2 c8 = uv - (ax + ay) * 0.71;
  vec3 s0 = trailAt(c0).rgb;
  vec3 col = s0;
  if (blur > 0.0005) {
    vec3 s1 = trailAt(c1).rgb;
    vec3 s2 = trailAt(c2).rgb;
    vec3 s3 = trailAt(c3).rgb;
    vec3 s4 = trailAt(c4).rgb;
    vec3 s5 = trailAt(c5).rgb;
    vec3 s6 = trailAt(c6).rgb;
    vec3 s7 = trailAt(c7).rgb;
    vec3 s8 = trailAt(c8).rgb;
    col = s0 * 0.28 + (s1 + s2 + s3 + s4) * 0.12 + (s5 + s6 + s7 + s8) * 0.06;
  }

  // ── BLOOM : a wide ring, keep only the bright part, add it back as glow.
  //    Default (smoothing 0) thresholds the ring AVERAGE : only broad highlights
  //    glow, with a stepped, scalloped halo. Toward smoothing 1 each tap (and the
  //    center) is thresholded on its own and the ring is jittered, so small
  //    highlights bloom too, as a soft round glow. ──
  if (bloom > 0.0005) {
    float rg = (0.012 + bloom * 0.05) * 1.3333;
    vec2 gx = ex * rg * toUv;
    vec2 gy = ey * rg * toUv;
    vec2 g1 = uv + gx;
    vec2 g2 = uv - gx;
    vec2 g3 = uv + gy;
    vec2 g4 = uv - gy;
    vec2 g5 = uv + (gx + gy) * 0.71;
    vec2 g6 = uv + (gy - gx) * 0.71;
    vec2 g7 = uv + (gx - gy) * 0.71;
    vec2 g8 = uv - (gx + gy) * 0.71;
    vec3 h1 = trailAt(g1).rgb;
    vec3 h2 = trailAt(g2).rgb;
    vec3 h3 = trailAt(g3).rgb;
    vec3 h4 = trailAt(g4).rgb;
    vec3 h5 = trailAt(g5).rgb;
    vec3 h6 = trailAt(g6).rgb;
    vec3 h7 = trailAt(g7).rgb;
    vec3 h8 = trailAt(g8).rgb;
    vec3 bsum = (h1 + h2 + h3 + h4 + h5 + h6 + h7 + h8) * 0.125;
    float bl = max(max(bsum.r, bsum.g), bsum.b);
    vec3 bright = bsum * smoothstep(0.5, 0.95, bl);
    if (smoothing > 0.001) {
      vec3 pt = s0 * smoothstep(0.5, 0.95, max(max(s0.r, s0.g), s0.b));
      pt += h1 * smoothstep(0.5, 0.95, max(max(h1.r, h1.g), h1.b));
      pt += h2 * smoothstep(0.5, 0.95, max(max(h2.r, h2.g), h2.b));
      pt += h3 * smoothstep(0.5, 0.95, max(max(h3.r, h3.g), h3.b));
      pt += h4 * smoothstep(0.5, 0.95, max(max(h4.r, h4.g), h4.b));
      pt += h5 * smoothstep(0.5, 0.95, max(max(h5.r, h5.g), h5.b));
      pt += h6 * smoothstep(0.5, 0.95, max(max(h6.r, h6.g), h6.b));
      pt += h7 * smoothstep(0.5, 0.95, max(max(h7.r, h7.g), h7.b));
      pt += h8 * smoothstep(0.5, 0.95, max(max(h8.r, h8.g), h8.b));
      bright = mix(bright, pt / 9.0, smoothing);
    }
    col += bright * bloom * 1.4;
  }

  // ── PBR shading : the relief responds to the key light's direction: facets
  //    toward the light lift, facets away fall into shadow, crevices occlude,
  //    and a restrained specular sheen rides the slopes. Normalized against
  //    the flat normal so a neutral map changes nothing. ──
  if (pbrOn) {
    float rk = pbrLight; // RAKING : how hard the light grazes the material.
    vec3 L = normalize(vec3((gLightP - uv) * vec2(aspect, 1.0), mix(0.6, 0.28, rk)));
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
    // atmosphere color (the "context" shifts as you pull away).
    col = mix(col, atmosphere.rgb, pbrDepth * 0.14 * pbrAmount);
  }

  // ── KEY LIGHT : a soft radial glow from the light position in its own color;
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

  // ── HAZE : the whole frame settles toward the atmosphere color, strongest
  //    in the shadows/distance (aerial perspective), with a lighter global veil
  //    over the midtones and highlights so the tint always reads. ──
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float atmoAmt = haze * (0.18 + 0.82 * (1.0 - smoothstep(0.0, 0.6, lum)));
  col = mix(col, atmosphere.rgb, atmoAmt);

  // ── DEPTH vignette : a lifted, luminous center falling to a darker,
  //    receding rim, seating the frame in a volume. ──
  vec2 dv = (uv - 0.5) * vec2(aspect, 1.0);
  float vig = 1.0 - smoothstep(0.35, 0.95, length(dv));
  col *= mix(1.0, 0.35 + 0.65 * vig, depth);

  if (lightOrder) col += keyLight; // POST (default)

  // ── VOID : the frame's edges dissolve into the dark with a RAGGED, slowly
  //    breathing boundary (an erosion eating inward, not a clean vignette).
  //    0 = exact passthrough; up = the void reaches deeper into the frame. ──
  if (voidEdge > 0.001) {
    float vd = length(dv);
    float n = vFbm(vec2(uv.x * aspect, uv.y) * 6.0 + TIME * 0.03);
    float reach = mix(0.95, 0.2, voidEdge); // where the erosion begins
    float diss = smoothstep(reach, reach + 0.4, vd + (n - 0.5) * 0.45);
    col *= 1.0 - diss;
  }

  gl_FragColor = vec4(col, 1.0);
}
