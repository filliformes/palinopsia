/*{
  "DESCRIPTION": "Ground : the surfaces under the living things, built the way the real ones form and lit as a relief under one low raking light. KIND : CRACKED MUD drying (plates shrink apart, cracks widen, their edges curl up; DRYING runs it, 0 = wet, 1 = baked hard, or let TIME dry it on a cycle), SAND RIPPLES migrating across a slowly turning wind (gentle upwind slopes, steep lee faces, dark heavy minerals in the troughs), ROCK STRATA (layers of power-law thickness, hard ones standing proud, soft ones eroded back, joints that don't line up from bed to bed), WOOD end grain (tree rings with pale early wood and dark late wood, rays and drying cracks), BARK (plates pulled apart along the trunk, deep fissures, fibre). SCALE sets how big, WANDER the slow drift, PALETTE shifts each toward an alternate material (red clay, black sand, pale limestone, dark walnut, birch-grey).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "kind",       "TYPE": "long",  "VALUES": [0, 1, 2, 3, 4], "LABELS": ["cracked mud", "sand ripples", "rock strata", "wood", "bark"], "DEFAULT": 0 },
    { "NAME": "scale",      "TYPE": "float", "MIN": 0.3, "MAX": 3.0,    "DEFAULT": 1.0,  "LABEL": "scale" },
    { "NAME": "drying",     "TYPE": "float", "MIN": -1.0,"MAX": 1.0,    "DEFAULT": -1.0, "LABEL": "drying (-1 = on a cycle)" },
    { "NAME": "wander",     "TYPE": "float", "MIN": 0.0, "MAX": 2.0,    "DEFAULT": 0.3,  "LABEL": "wander" },
    { "NAME": "roughness",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.5,  "LABEL": "roughness" },
    { "NAME": "palette",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.0,  "LABEL": "palette" },
    { "NAME": "relief",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.6,  "LABEL": "relief" },
    { "NAME": "lightAngle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 2.36, "LABEL": "light angle" }
  ]
}*/

float ASP() { return RENDERSIZE.x / RENDERSIZE.y; }
float T() { return TIME * wander; }

// How dry the mud is now : fixed, or a slow loop (wet → cracked → a rain resets it).
float dryness() {
  if (drying >= 0.0) return drying;
  float ph = fract(TIME / 45.0);
  return smoothstep(0.0, 0.8, ph) * (1.0 - smoothstep(0.96, 1.0, ph));
}

// ── Cracked mud : Voronoi plates with EXACT border distance (cracks keep one
//    width and meet cleanly), a second generation splitting the big plates late
//    in the drying, plate rims curling up. ──
float mudH(vec2 P, out float crackDepth) {
  float dry = dryness();
  vec2 Q = P * 3.2 / scale;
  vec3 b = og_voronoi(Q);
  float wid = 0.004 + 0.05 * dry;
  float big = smoothstep(wid, wid + 0.025, b.x);
  float curl = 0.32 * (1.0 - smoothstep(wid, wid + 0.16, b.x)) * dry;
  crackDepth = 1.0 - big;
  return big * (0.55 + curl + 0.07 * roughness * (0.5 + og_noised(Q * 9.0).x));
}

// ── Sand ripples : a travelling wave across a slowly veering wind, asymmetric
//    (gentle stoss slope, steep lee), wavelength wandering ±20 %, defects where
//    crests fork. ──
float sandH(vec2 P) {
  vec2 Q = P * 7.0 / scale;
  float ang = 0.5 + 0.35 * og_noised(Q * 0.08 + T() * 0.01).x;
  vec2 w = vec2(cos(ang), sin(ang));
  float warp = og_fbm(Q * 0.35, 2.0) * 2.2;
  float ph = dot(Q, w) + warp - T() * 0.05;
  float f = fract(ph);
  float saw = f < 0.72 ? f / 0.72 : (1.0 - f) / 0.28;   // gentle up, steep down
  float ripple = smoothstep(0.0, 1.0, saw);
  return 0.35 + 0.45 * ripple + 0.08 * roughness * og_noised(Q * 6.0).x;
}

// ── Rock strata : layer index from a folded height, power-law thicknesses,
//    hardness per layer (hard beds stand proud), joints offset bed to bed. ──
float strataH(vec2 P, out float layerId) {
  vec2 Q = P / scale;
  float fold = 0.25 * og_fbm(vec2(Q.x * 0.6, 0.3) + T() * 0.004, 3.0) + Q.x * 0.08;
  // Beds of very different thickness : a slowly varying rate squeezes the
  // layer coordinate (many thin beds, now and then a thick one).
  float y = (Q.y + fold) * 6.0;
  float rate = 0.45 + 1.6 * pow(og_vnoise(vec2(y * 0.35, 3.1)), 2.0);
  float yl = y * rate + 3.0 * og_vnoise(vec2(y * 0.5, 9.7));
  float cell = floor(yl);
  float r = og_hash(vec2(cell, 7.7));
  layerId = og_hash(vec2(cell, 1.3));
  float hard = 0.3 + 0.7 * og_hash(vec2(cell, 4.1));
  float inLayer = fract(yl);
  float edge = smoothstep(0.0, 0.12, inLayer) * smoothstep(0.0, 0.12, 1.0 - inLayer);
  // laminae inside the thicker beds
  float lam = 0.06 * step(0.5, r) * (1.0 - abs(2.0 * fract(inLayer * (2.0 + floor(r * 4.0))) - 1.0));
  // joints : only some beds, irregular spacing, slightly tilted, never lined up
  float jx = Q.x * (1.5 + 2.5 * r) + layerId * 7.0 + 0.4 * og_noised(vec2(Q.y * 3.0, cell)).x;
  float jcell = floor(jx);
  float jOn = step(0.45, og_hash(vec2(jcell, cell))) * step(0.35, r);
  float joint = 1.0 - (1.0 - smoothstep(0.0, 0.025, abs(fract(jx) - 0.5 + 0.3 * (og_hash(vec2(jcell, cell + 3.0)) - 0.5)) - 0.0)) * 0.55 * jOn;
  return (0.25 + 0.6 * hard * mix(0.55, 1.0, edge) + lam) * joint + 0.06 * roughness * og_noised(Q * 30.0).x;
}

// ── Wood end grain : rings around an off-centre pith, widths wandering like a
//    real tree's years, pale early wood / dark late wood, rays, drying checks. ──
float woodH(vec2 P, out float ringTone) {
  vec2 Q = P / scale;
  vec2 pith = vec2(0.35 * ASP(), 0.42);
  vec2 d = Q - pith;
  float rad0 = length(d);
  vec2 dir = d / max(rad0, 1e-4);                      // periodic in the angle : no seam
  float rad = rad0 * (1.0 + 0.07 * og_noised(dir * 2.3).x);
  // (ring wobble fades in away from the pith, or the first rings pinch into a star)
  float years = rad * 28.0 + 1.6 * og_fbm(dir * 3.0 + rad * 2.0, 2.0) * smoothstep(0.02, 0.2, rad0);
  float f = fract(years);
  // Early wood pale, darkening through the year into late wood, then a sharp
  // boundary to the next spring.
  ringTone = smoothstep(0.25, 0.92, f) * (1.0 - smoothstep(0.94, 1.0, f));
  float ray = smoothstep(0.93, 1.0, og_noised(dir * 70.0 + rad * 0.5).x * 0.5 + 0.5);
  float sector = atan(d.y, d.x) / 6.2832 * 3.0;
  float check = (1.0 - smoothstep(0.0, 0.01, abs(fract(sector + 0.08 * og_noised(vec2(rad * 4.0, 1.0)).x) - 0.5)))
              * smoothstep(0.12, 0.4, rad0) * step(0.8, og_hash(vec2(floor(sector + 0.5), 2.0)));
  return 0.55 - 0.018 * ringTone + 0.015 * ray - 0.4 * check + 0.025 * roughness * og_noised(Q * 180.0).x;
}

// ── Bark : Voronoi plates stretched along the trunk, fissures between them,
//    fine fibre on the plates. ──
// ── Bark : what a trunk does as it widens, the outer bark splitting along its
//    length into ridges that fork and rejoin (a stretched, warped cellular net),
//    rough ridge tops with fibre, deep dark furrows. ──
float barkH(vec2 P, out float fissure) {
  vec2 Q = P / scale;
  // (a moderate stretch : a strong one widens the cross-furrows on screen)
  vec2 S = vec2(Q.x * 5.0, Q.y * 1.7) + vec2(0.0, T() * 0.01);
  S += vec2(0.45 * og_noised(S * vec2(0.5, 1.2)).x, 0.0);
  vec3 w = og_worley(S);
  // F2 - F1, corrected for the stretch along the border's normal so every
  // furrow keeps about the same width on screen.
  float edge = (w.y - w.x) * mix(1.0, 0.34, 0.5);
  fissure = 1.0 - smoothstep(0.015, 0.09, edge);
  float ridge = smoothstep(0.015, 0.22, edge);         // rounded ridge tops
  float fibre = og_noised(vec2(Q.x * 160.0, Q.y * 10.0)).x;
  float scale2 = og_noised(vec2(Q.x * 30.0, Q.y * 6.0)).x;
  return ridge * (0.45 + 0.25 * w.z) + 0.05 * roughness * (fibre + scale2);
}

float og_height(vec2 uv) {
  vec2 P = uv * vec2(ASP(), 1.0);
  float a;
  if (kind == 0) return mudH(P, a);
  if (kind == 1) return sandH(P);
  if (kind == 2) return strataH(P, a);
  if (kind == 3) return woodH(P, a);
  return barkH(P, a);
}

// Shadows only need the big forms (the exact-border Voronoi is the costly part).
float groundShadowH(vec2 uv) {
  vec2 P = uv * vec2(ASP(), 1.0);
  float a;
  if (kind == 0) { vec3 w = og_worley(P * 3.2 / scale); return 0.6 * smoothstep(0.0, 0.01 + 0.1 * dryness(), w.y - w.x); }
  if (kind == 3 || kind == 4) return 0.0;           // end grain is flat, bark reads by its normals : no cast shadows
  if (kind == 1) return sandH(P) - 0.08 * roughness;  // (the ripples carry the shadow)
  return strataH(P, a);
}
#define OG_SHADOW_HEIGHT groundShadowH
#define OG_SHADOW_STEPS 4
// @og-relief

vec3 albedo(vec2 uv, float h, float aux) {
  vec2 P = uv * vec2(ASP(), 1.0);
  float a = aux;
  if (kind == 0) {
    float dry = dryness();
    float cd = aux;
    vec3 wet = mix(vec3(0.3, 0.24, 0.19), vec3(0.34, 0.17, 0.11), palette);
    vec3 baked = mix(vec3(0.66, 0.58, 0.47), vec3(0.72, 0.42, 0.28), palette);
    vec3 base = mix(wet, baked, dry) * (0.9 + 0.16 * og_fbm(P * 12.0 / scale, 2.0));
    // Late in the drying a second, thinner generation splits the big plates.
    if (dry > 0.45) {
      vec2 Q = P * 3.2 / scale;
      float b2 = og_voronoi(Q * 2.6 + og_hash(floor(Q)) * 31.0).x;
      float hair = 1.0 - smoothstep(0.0, 0.012 + 0.02 * dry, b2);
      base *= 1.0 - 0.55 * hair * smoothstep(0.45, 0.9, dry);
    }
    return mix(base, base * 0.3, cd);
  }
  if (kind == 1) {
    vec3 sand = mix(vec3(0.76, 0.66, 0.5), vec3(0.3, 0.28, 0.27), palette);
    float trough = 1.0 - smoothstep(0.3, 0.55, h);
    return sand * (0.92 + 0.12 * og_noised(P * 160.0).x) * mix(1.0, 0.72, trough);   // heavy minerals settle in the troughs
  }
  if (kind == 2) {
    vec3 c1 = mix(vec3(0.6, 0.5, 0.4), vec3(0.78, 0.76, 0.7), palette);
    vec3 c2 = mix(vec3(0.42, 0.33, 0.27), vec3(0.62, 0.6, 0.56), palette);
    vec3 c3 = mix(vec3(0.7, 0.58, 0.42), vec3(0.7, 0.68, 0.6), palette);
    vec3 col = a < 0.4 ? c1 : a < 0.75 ? c2 : c3;
    return col * (0.88 + 0.16 * og_fbm(P * 40.0 / scale, 2.0));
  }
  if (kind == 3) {
    float ring = aux;
    vec3 early = mix(vec3(0.76, 0.6, 0.41), vec3(0.44, 0.3, 0.2), palette);
    vec3 late = mix(vec3(0.44, 0.28, 0.15), vec3(0.2, 0.12, 0.08), palette);
    return mix(early, late, ring) * (0.92 + 0.1 * og_noised(P * 90.0 / scale).x);
  }
  float fis = aux;
  vec3 plate = mix(vec3(0.42, 0.36, 0.3), vec3(0.72, 0.7, 0.66), palette);
  vec3 deep = mix(vec3(0.16, 0.12, 0.1), vec3(0.2, 0.19, 0.18), palette);
  return mix(plate * (0.85 + 0.2 * og_fbm(P * 20.0 / scale, 2.0)), deep, fis);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 P = uv * vec2(ASP(), 1.0);
  // One full evaluation here; its by-product (crack depth, layer, ring tone,
  // fissure) goes to the colouring instead of being recomputed there.
  float aux = 0.0;
  float h;
  if (kind == 0) h = mudH(P, aux);
  else if (kind == 1) h = sandH(P);
  else if (kind == 2) h = strataH(P, aux);
  else if (kind == 3) h = woodH(P, aux);
  else h = barkH(P, aux);
  gl_FragColor = vec4(clamp(og_relief(uv, albedo(uv, h, aux), h, lightAngle, relief), 0.0, 1.0), 1.0);
}
