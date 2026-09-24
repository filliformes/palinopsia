
// ── Organic toolkit ─────────────────────────────────────────────────────────
// Shared by the Organic family, inserted after the ISF header by the registry
// (index.ts, withOrganic). GLSL ES 1.00 (the ISF runtime's dialect) : no uint, no
// bit ops, constant loop bounds. Everything is prefixed og_ because the shaders
// keep their own hash / vnoise.
//   hashes : sine-free (Dave Hoskins, MIT) : no banding on large grids
//   og_noised : gradient noise with analytic derivatives (Inigo Quilez, MIT)
//   og_voronoi : distance to the cell border (Quilez's two-pass method, second
//     pass 3x3 : near-exact, a third of the cost), so cracks and walls keep one
//     width and meet in clean junctions (F2 - F1 swells at the vertices)
//   og_blackbody : Planck-locus colour for a temperature (Tanner Helland's fit)

float og_hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 og_hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float og_vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(og_hash(i), og_hash(i + vec2(1.0, 0.0)), f.x),
             mix(og_hash(i + vec2(0.0, 1.0)), og_hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Gradient noise, ~[-0.7, 0.7], with its derivative in .yz.
vec3 og_noised(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = og_hash2(i) * 2.0 - 1.0;
  vec2 gb = og_hash2(i + vec2(1.0, 0.0)) * 2.0 - 1.0;
  vec2 gc = og_hash2(i + vec2(0.0, 1.0)) * 2.0 - 1.0;
  vec2 gd = og_hash2(i + vec2(1.0, 1.0)) * 2.0 - 1.0;
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  return vec3(va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k,
              ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
                 + du * (u.yx * k + vec2(vb, vc) - va));
}

// fbm of gradient noise, 0..1-ish, up to 8 octaves (rotated, non-integer lacunarity).
float og_fbm(vec2 p, float octaves) {
  float s = 0.0, a = 0.5;
  mat2 m = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= octaves) break;
    s += a * og_noised(p).x;
    p = m * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return 0.5 + s;
}

// Voronoi : x = distance to the nearest border, y = cell id (0..1), z = F1.
vec3 og_voronoi(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  vec2 mg = vec2(0.0), mr = vec2(0.0);
  float md = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + og_hash2(n + g) - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; id = og_hash(n + g + 41.7); }
    }
  }
  float f1 = sqrt(md);
  md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + og_hash2(n + g) - f;
      if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
    }
  }
  return vec3(md, id, f1);
}

// Cheap Worley F1 / F2 / id (3x3) : cell interiors, grains, areolae.
vec3 og_worley(vec2 p) {
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + og_hash2(ip + g) - fp;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = og_hash(ip + g + 41.7); } else if (d < d2) { d2 = d; }
    }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}

// Blackbody colour (normalised so the brightest channel is 1) for a temperature
// in kelvin. Flames sit between ~900 K (dull red) and ~2200 K (yellow-white).
vec3 og_blackbody(float kelvin) {
  float t = kelvin / 100.0;
  float r = t <= 66.0 ? 1.0 : clamp(1.2929 * pow(t - 60.0, -0.1332), 0.0, 1.0);
  float g = t <= 66.0 ? clamp(0.3901 * log(t) - 0.6318, 0.0, 1.0) : clamp(1.1298 * pow(t - 60.0, -0.0755), 0.0, 1.0);
  float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432 * log(t - 10.0) - 1.1963, 0.0, 1.0));
  return vec3(r, g, b);
}
