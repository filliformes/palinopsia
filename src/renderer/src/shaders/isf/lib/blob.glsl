// lib/blob.glsl : organic outlines for the point sources (Ash, Particle Drift,
// Lattice : their IRREGULAR and EVOLVE controls). Plain math, the same text in
// GLSL ES 1.00 (the ISF shaders, at their "// @blob" line) and ES 3.00 (Lattice).
//
// A point is a round dot until IRREGULAR rises; then each one takes a shape of
// its own, dealt from its own three random numbers (stable : a point keeps its
// shape, no two alike). Four kinds, each point one of them or a cross of two :
//   drop  : an ink drop or a cell, its rim bent by a few low harmonics, egg-ish
//   petal : a seed or a pollen grain, 3 to 7 rounded lobes pinched between
//   torn  : torn paper confetti, a rough polygon with a ragged edge
//   shard : a sliver, a long thin triangle, quad or pentagon
// Up to IRREGULAR 0.45 every point first wobbles and stretches; from 0.2 up to 1
// it takes on its own kind. Each point is turned its own way; EVOLVE morphs the
// outlines and tumbles them slowly. Fine detail (lobes, the ragged edge) needs
// pixels to read, so it fades out on small points instead of shimmering.
//
// blobShape(p, seed, amt, ph, rpx) returns vec2(edge, soft) :
//   edge : the signed distance to the outline in point radii (negative inside),
//          first-order corrected for the outline's slope and stretch, so a one
//          pixel anti-aliasing band stays one pixel wide
//   soft : the radial field, 1 on the outline (a soft dot's falloff, reshaped)
// p    : the pixel's offset from the point's center, in point radii
// seed : three stable 0..1 numbers of the point's own
// amt  : IRREGULAR, 0..1 (callers keep their old round code at 0)
// ph   : the EVOLVE phase, wrapped at BLOB_WRAP (every rate below is a whole
//        number of turns per wrap, so the wrap never shows)
// rpx  : the point's radius in pixels
// The outline never leaves 1 + BLOB_REACH·amt radii : callers widen their
// search (or their quad) by that much.

#define BLOB_WRAP 100.5309649
#define BLOB_REACH 1.6

vec4 blob_h44(vec4 p4) {
  p4 = fract(p4 * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

vec2 blobShape(vec2 p, vec3 seed, float amt, float ph, float rpx) {
  vec3 s = seed * vec3(97.0, 89.0, 83.0);
  vec4 ha = blob_h44(vec4(s, 1.0));
  vec4 hb = blob_h44(vec4(s.yzx, 2.0));
  vec4 hc = blob_h44(vec4(s.zxy, 3.0));
  vec4 hd = blob_h44(vec4(s.xzy, 4.0) + 17.0);
  vec4 he = blob_h44(vec4(s.zyx, 5.0) + 29.0);

  float g1 = smoothstep(0.0, 0.45, amt); // every point wobbles first
  float g2 = smoothstep(0.2, 1.0, amt);  // then takes on its own kind, all the way up
  // The kind : drop, petal, torn, shard round a circle of four, each point mostly
  // one of them, a few crossed with their neighbor.
  vec4 kd = abs(mod(vec4(ha.x * 4.0) - vec4(0.0, 1.0, 2.0, 3.0) + 2.0, 4.0) - 2.0);
  vec4 w = smoothstep(0.25, 0.75, max(vec4(0.0), 1.0 - kd));
  float fine = smoothstep(2.0, 8.0, rpx);
  float fine3 = smoothstep(5.0, 14.0, rpx);

  // Its own turn (EVOLVE tumbles it, -4..4 half turns per wrap) and stretch (a
  // sliver needs a few pixels across, or it breaks into a shimmer).
  float th = 6.2831853 * ha.y + ph * (floor(ha.z * 9.0) - 4.0) * 0.125;
  float e = 1.0 + g1 * 0.3 * hb.x + g2 * (w.z * 0.2 * hb.y + w.w * (0.3 + 0.4 * hb.y));
  e = min(e, max(1.0, 0.6 * rpx));
  float cs = cos(th), sn = sin(th);
  vec2 q = vec2(cs * p.x + sn * p.y, cs * p.y - sn * p.x);
  q = vec2(q.x / e, q.y * e);
  float rho = length(q);
  if (rho < 1e-5) return vec2(-1.0, 0.0);
  float a = atan(q.y, q.x);

  // The rim as harmonics of the angle : H and its slope dH.
  float H = 0.0, dH = 0.0;
  // drop : the 1st (egg), 2nd and 3rd harmonics; everyone wobbles a little
  float wob = g1 * (1.0 - 0.6 * w.w);
  float A1 = g2 * w.x * 0.12;
  float A2 = wob * (0.08 + 0.1 * hb.z) + g2 * w.x * 0.05;
  float A3 = wob * (0.04 + 0.08 * hb.w) + g2 * w.x * 0.04;
  float p1 = 6.2831853 * he.w + ph * 0.25;
  float p2 = 6.2831853 * hc.x + ph * (1.0 + floor(hc.y * 6.0)) * 0.25;
  float p3 = 6.2831853 * hc.z - ph * (1.0 + floor(hc.w * 6.0)) * 0.25;
  H += A1 * cos(a + p1); dH -= A1 * sin(a + p1);
  H += A2 * cos(2.0 * a + p2); dH -= 2.0 * A2 * sin(2.0 * a + p2);
  H += A3 * cos(3.0 * a + p3); dH -= 3.0 * A3 * sin(3.0 * a + p3);
  // petal : 3 to 7 lobes, rounded, pinched between (2|cos| less its mean)
  float nL = 3.0 + floor(hd.x * 5.0);
  float AL = g2 * w.y * mix(0.3, 0.17, (nL - 3.0) * 0.25) * mix(0.35, 1.0, fine);
  AL *= 0.8 + 0.2 * sin(ph * 0.5 + 6.2831853 * hd.y); // the lobes breathe
  float uL = 0.5 * (nL * a + 6.2831853 * hd.y + ph * 0.5);
  float cL = cos(uL);
  H += AL * (2.0 * abs(cL) - 1.2732395); dH -= AL * nL * sign(cL) * sin(uL);
  // torn : a ragged edge, three higher harmonics falling off like a rough fbm
  float AT = g2 * (w.z * 0.13 + w.w * 0.05 + w.x * 0.02) * fine;
  float k1 = 6.0 + floor(hd.z * 3.0), k2 = 11.0 + floor(hd.w * 3.0), k3 = 17.0 + floor(ha.w * 4.0);
  float t1 = k1 * a + 6.2831853 * he.y + ph * 0.25;
  float t2 = k2 * a + 6.2831853 * he.z - ph * 0.5;
  float t3 = k3 * a + 6.2831853 * fract(he.z * 7.13) + ph * 0.75;
  H += AT * (0.55 * cos(t1) + 0.33 * cos(t2) + 0.22 * fine3 * cos(t3));
  dH -= AT * (0.55 * k1 * sin(t1) + 0.33 * k2 * sin(t2) + 0.22 * fine3 * k3 * sin(t3));

  // torn and shard : on a polygon (triangle, quad or pentagon) of about the
  // round dot's own mass
  float nP = 3.0 + floor(he.x * 3.0);
  float sec = 6.2831853 / nP;
  float uP = mod(a, sec) - 0.5 * sec;
  float Rp = cos(0.5 * sec) / cos(uP);
  float Kp = 2.0 / (1.0 + cos(0.5 * sec));
  float wP = g2 * (w.w * 0.9 + w.z * 0.6);
  float base = mix(1.0, Kp * Rp, wP);
  float dbase = wP * Kp * Rp * tan(uP);

  float R = base * (1.0 + H);
  float dR = dbase * (1.0 + H) + base * dH;
  // about the same mass whatever the shape, so a field neither brightens nor dims
  float nrm = inversesqrt(1.0 + 0.5 * (A1 * A1 + A2 * A2 + A3 * A3 + 0.5 * AL * AL + 0.4 * AT * AT));
  R *= nrm; dR *= nrm;
  // kept inside its reach (stretched : the long axis reaches R·e)
  float cap = (1.0 + BLOB_REACH * amt) / e;
  if (R > cap) { R = cap; dR = 0.0; }
  if (R < 0.15) { R = 0.15; dR = 0.0; }

  // The distance to the rim, through the slope (the angular term, near the rim)
  // and back out of the stretch.
  vec2 ur = q / rho;
  vec2 gq = ur - vec2(-ur.y, ur.x) * (dR / R);
  float gl = length(vec2(gq.x / e, gq.y * e));
  return vec2((rho - R) / max(gl, 0.05), rho / R);
}
