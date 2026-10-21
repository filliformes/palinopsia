
// ── The dome, for shaders that turn or move things ────────────────────────
// Inserted by the registry at the shader's "// @dome" line (and into the native
// Feedback node, engine/convNodes.ts). GLSL ES 1.00 and 3.00 alike : math only.
//
// Under full-dome FILL (DOME_FILL > 0, engine/domeSignal.ts) the whole frame is
// spread over the dome's disc : the frame's center is the zenith, its edges run
// round the rim, its bottom is the front. A flat rotation then swings the
// frame's corners across the dome, and a flat "down" is one way across the
// zenith. These helpers work on the disc instead (Fong's square <-> disc, the
// dome stage's own map, engine/dome.ts) : a rotation turns about the zenith with
// no corner in sight, and down falls outward toward the rim, down the walls, all
// round. The flat frame never changes : with DOME_FILL at 0 every shader keeps
// its flat path.
uniform float DOME_FILL;

// A frame point (uv 0..1) -> its place on the dome's disc (length 1 at the
// frame's own rim; the horizon is at DOME_FILL).
vec2 domeDisc(vec2 uv) {
  vec2 s = clamp(uv * 2.0 - 1.0, -1.0, 1.0);
  return vec2(s.x * sqrt(1.0 - 0.5 * s.y * s.y), s.y * sqrt(1.0 - 0.5 * s.x * s.x));
}

// ... and back : a disc point -> frame uv (a point past the rim lands on the
// frame's edge).
vec2 domeFrame(vec2 d) {
  float u2 = d.x * d.x;
  float v2 = d.y * d.y;
  float t = 2.0 * sqrt(2.0);
  float x = 0.5 * sqrt(max(0.0, 2.0 + u2 - v2 + t * d.x)) - 0.5 * sqrt(max(0.0, 2.0 + u2 - v2 - t * d.x));
  float y = 0.5 * sqrt(max(0.0, 2.0 - u2 + v2 + t * d.y)) - 0.5 * sqrt(max(0.0, 2.0 - u2 + v2 - t * d.y));
  return clamp(vec2(x, y), -1.0, 1.0) * 0.5 + 0.5;
}

// A disc point turned by `ang` radians about the zenith (counter-clockwise, the
// flat rotation's own sense).
vec2 domeRot(vec2 d, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return vec2(c * d.x - s * d.y, s * d.x + c * d.y);
}

// A disc automorphism, z -> (z - a) / (1 - conj(a) z) : it carries a to the
// middle and keeps the rim on the rim (domeShift(z, -a) carries it back). A turn
// or a zoom about an off-center point stays round with it.
vec2 domeShift(vec2 z, vec2 a) {
  vec2 n = z - a;
  vec2 d = vec2(1.0 - (a.x * z.x + a.y * z.y), -(a.x * z.y - a.y * z.x));
  return vec2(n.x * d.x + n.y * d.y, n.y * d.x - n.x * d.y) / max(dot(d, d), 1e-6);
}

// The point's polar place on the dome : x = its azimuth in turns (0 at the
// front, +0.25 at the audience's right, +-0.5 at the back), y = its distance
// from the zenith (DOME_FILL at the horizon, 1 at the frame's rim).
vec2 domePolar(vec2 uv) {
  vec2 d = domeDisc(uv);
  float r = length(d);
  return vec2(r > 1e-6 ? atan(d.x, -d.y) / 6.2831853 : 0.0, r);
}

// A flat direction turned to the point's place on the dome : at the front it is
// unchanged, elsewhere it turns with the azimuth, so DOWN points outward to the
// rim (down the walls) and UP to the zenith, all round, and sideways runs round
// the dome. Off the dome, or at the zenith itself : unchanged.
vec2 domeDir(vec2 uv, vec2 v) {
  if (DOME_FILL <= 0.0) return v;
  vec2 d = domeDisc(uv);
  float r = length(d);
  if (r < 1e-5) return v;
  vec2 w = d / r; // outward = (sin az, -cos az) : the turn by az takes (0, -1) to it
  return vec2(-w.y * v.x - w.x * v.y, w.x * v.x - w.y * v.y);
}

// The horizon's radius on the disc, for sizing a pattern round the dome (the
// frame's own rim when the frame sits scaled down inside the horizon).
float domeHorizon() {
  return clamp(DOME_FILL, 0.3, 1.0);
}
