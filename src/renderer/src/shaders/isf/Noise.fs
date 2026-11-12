/*{
  "DESCRIPTION": "Noise : a raw noise field, the raw material for the sidechain effects (Remap, Matte, Lookup, Luma Blur, Displace, Morphogen, Current) and for masks, like Ramps. KIND picks the basis : VALUE (soft blotches), GRADIENT (smooth rolling hills), CELLULAR (cells, nearest point), CRACKS (the borders between cells), RIDGED (sharp creased ridges), BILLOW (puffed, cloudy) or WARPED (a field folded through itself). SCALE is the cells across the frame height, OCTAVES adds finer copies on top (fractions fade the last one in), ROUGH how strong each finer copy is. CONTRAST, LEVEL and STEPS shape it into a matte : hard, flat or posterized into bands. FOCUS throws it out of focus with no blur pass : the fine detail fades by itself, and the field never aliases at 4K or on the dome. DRIFT moves it along ANGLE, EVOLVE morphs it in place; SYNC locks the morphing to the tempo (a new field each bar, half, quarter or eighth, GLIDE from a cut to a smooth melt). SEAMLESS makes it repeat exactly across the width, for the dome's wrap mode. MAP gives two separate fields in red and green, a map for Remap or Displace. KEY makes the dark parts see-through. Under the full dome it lies round on the disc and drifts round the zenith. Matte.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Analog", "Texture"],
  "INPUTS": [
    { "NAME": "kind", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4, 5, 6], "LABELS": ["value", "gradient", "cellular", "cracks", "ridged", "billow", "warped"], "DEFAULT": 1, "LABEL": "kind" },
    { "NAME": "scale", "TYPE": "float", "MIN": 0.5, "MAX": 64.0, "DEFAULT": 4.0, "LABEL": "scale (cells)" },
    { "NAME": "octaves", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 4.0, "LABEL": "octaves" },
    { "NAME": "rough", "TYPE": "float", "MIN": 0.2, "MAX": 0.85, "DEFAULT": 0.5, "LABEL": "rough" },
    { "NAME": "seed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "seed" },
    { "NAME": "seamless", "TYPE": "bool", "DEFAULT": false, "LABEL": "seamless (wrap)", "COMPACT": true },
    { "NAME": "contrast", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 1.6, "LABEL": "contrast" },
    { "NAME": "level", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "level" },
    { "NAME": "steps", "TYPE": "float", "MIN": 1.0, "MAX": 16.0, "DEFAULT": 1.0, "LABEL": "steps" },
    { "NAME": "focus", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "focus (soft)" },
    { "NAME": "invert", "TYPE": "bool", "DEFAULT": false, "LABEL": "invert", "COMPACT": true },
    { "NAME": "key", "TYPE": "bool", "DEFAULT": false, "LABEL": "key", "COMPACT": true },
    { "NAME": "drift", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.12, "LABEL": "drift" },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 1.2, "LABEL": "angle" },
    { "NAME": "evolve", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.1, "LABEL": "evolve" },
    { "NAME": "sync", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["free", "1 bar", "1/2", "1/4", "1/8"], "DEFAULT": 0, "LABEL": "sync", "COMPACT": true },
    { "NAME": "glide", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "glide" },
    { "NAME": "field", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["mono", "map"], "DEFAULT": 0, "LABEL": "field", "COMPACT": true },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [0.86, 0.86, 0.84, 1.0] }
  ]
}*/

// The drift is a vector integrated along its angle (turning the angle bends the
// path), wrapped at the lattice's 4096-cell period, so it stays exact for days and
// the wrap is invisible. The dome's turn round the zenith is its own phase. The
// evolve clock counts free time, or beats of the transport tempo with sync.
uniform float PH_noiseDX; // wrap 4096
uniform float PH_noiseDY; // wrap 4096
uniform float PH_noiseTurn; // wrap 6.2831853
uniform float PH_noiseEvolve; // wrap 4096

// @dome

// Hoskins hashes, fed whole lattice coordinates (each under ~1e4 : the lattice
// wraps at 4096 cells an octave, or at the seamless period).
float h12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 h22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// EVOLVE : every lattice point turns at one of two speeds, either way round, so the
// field morphs in place, never scrolling (and repeating only after hours). The turn
// table `cs` (the cos / sin of the two speeds) is computed once an octave, not per
// lattice point : each point only rotates its own random direction by it.
vec2 turned(vec2 h, vec4 cs) {
  vec2 g = h * 2.0 - 1.0;
  g *= inversesqrt(max(dot(g, g), 1e-4));
  float fast = step(0.5, fract(h.x * 7.0));
  float c = mix(cs.x, cs.z, fast);
  float s = mix(cs.y, cs.w, fast) * (fract(h.y * 13.0) > 0.5 ? 1.0 : -1.0);
  return vec2(c * g.x - s * g.y, s * g.x + c * g.y);
}

// Value noise, 0..1.
float vnoise(vec2 q, vec2 per, vec4 cs) {
  vec2 i = floor(q);
  vec2 f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, per);
  vec2 i1 = mod(i + 1.0, per);
  float a = 0.5 + 0.5 * turned(h22(i0), cs).y;
  float b = 0.5 + 0.5 * turned(h22(vec2(i1.x, i0.y)), cs).y;
  float c = 0.5 + 0.5 * turned(h22(vec2(i0.x, i1.y)), cs).y;
  float d = 0.5 + 0.5 * turned(h22(i1), cs).y;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Gradient noise, about -0.7..0.7 (turning gradients : a flow noise).
float gnoise(vec2 q, vec2 per, vec4 cs) {
  vec2 i = floor(q);
  vec2 f = fract(q);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 i0 = mod(i, per);
  vec2 i1 = mod(i + 1.0, per);
  float a = dot(turned(h22(i0), cs), f);
  float b = dot(turned(h22(vec2(i1.x, i0.y)), cs), f - vec2(1.0, 0.0));
  float c = dot(turned(h22(vec2(i0.x, i1.y)), cs), f - vec2(0.0, 1.0));
  float d = dot(turned(h22(i1), cs), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Cells : the nearest and second-nearest feature point. Each point sits anywhere in
// the middle 70 % of its own cell and circles a little about it (never past the
// cell), so the 3x3 search always holds it and the cells never line up in a grid.
vec2 cells(vec2 q, vec2 per, vec4 cs) {
  vec2 i = floor(q);
  vec2 f = fract(q);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 h = h22(mod(i + o, per));
      vec2 pt = o + 0.15 + 0.7 * fract(h * vec2(17.0, 29.0) + h.yx) + 0.13 * turned(h, cs);
      float d = length(pt - f);
      if (d < d1) { d2 = d1; d1 = d; }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec2(d1, d2);
}

// One octave of the chosen basis, centered on 0 (about -0.5..0.5).
float basis(vec2 q, vec2 per, vec4 cs) {
  if (kind == 0) return vnoise(q, per, cs) - 0.5;
  if (kind == 2) return cells(q, per, cs).x * 1.3 - 0.5;
  if (kind == 3) { vec2 c = cells(q, per, cs); return (c.y - c.x) * 2.2 - 0.45; }
  float g = gnoise(q, per, cs);
  if (kind == 4) { float r = 1.0 - abs(g) * 1.6; return r * r - 0.45; }
  if (kind == 5) return abs(g) * 1.6 - 0.4;
  return g * 0.75;
}

// The octaves, band-limited : each one's contrast is what a blur of FOOTPRINT
// (the pixel, in base cells) and SOFT (the focus radius, base cells) leaves of it,
// so a copy finer than a pixel fades out instead of aliasing, and focus throws the
// whole field out of focus with no blur pass. An octave left under 1 % is skipped.
float fbm(vec2 p, vec2 per0, bool tile, float t, float foot, float soft) {
  float sum = 0.0;
  float norm = 0.0;
  float amp = 1.0;
  float fr = 1.0;
  vec2 per = per0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    if (fi >= octaves) break;
    float last = clamp(octaves - fi, 0.0, 1.0);
    float sp = 0.6 * foot * fr;
    float sf = soft * fr;
    float att = exp(-4.9 * (sp * sp + sf * sf));
    norm += amp * last;
    if (att > 0.01) {
      // this octave's turn table : two speeds whose turns per 4096 units are whole
      // (the evolve phase wraps there without a jump)
      float tt = t + fi * 0.37;
      float a1 = 6.2831853 * fract(tt * 0.75);
      float a2 = 6.2831853 * fract(tt * 1.2001953125);
      sum += amp * last * att * basis(p * fr + fi * 37.0, per, vec4(cos(a1), sin(a1), cos(a2), sin(a2)));
    }
    amp *= rough;
    fr *= 2.0;
    if (tile) per.x *= 2.0;
  }
  return sum / max(norm, 1e-4);
}

// The field at frame point uv : warped, or straight.
float noiseAt(vec2 p, vec2 per, bool tile, float t, float foot, float soft) {
  if (kind == 6) {
    // (the fold is a field of the same period, so a seamless repeat holds)
    vec2 w = vec2(fbm(p + vec2(2.0, 9.0), per, tile, t, foot, soft), fbm(p + vec2(8.0, 3.0), per, tile, t + 5.1, foot, soft));
    return fbm(p + w * 2.2, per, tile, t, foot * 1.6, soft);
  }
  return fbm(p, per, tile, t, foot, soft);
}

// The frame point's place on the noise plane, in base cells. Flat : the frame's
// height is SCALE cells (seamless : a whole number of cells across the width, the
// lattice repeats there). Under the full dome : laid round on the disc (its
// diameter is SCALE cells), turning round the zenith.
vec2 place(vec2 uv, float nx, bool dome) {
  if (dome) {
    return domeRot(domeDisc(uv), PH_noiseTurn) * 0.5 * scale;
  }
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  if (seamless) return vec2(uv.x * nx + mod(PH_noiseDX, nx), uv.y * scale + PH_noiseDY);
  return vec2(uv.x * aspect * scale + PH_noiseDX, uv.y * scale + PH_noiseDY);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  bool dome = DOME_FILL > 0.0;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float nx = max(1.0, floor(scale * aspect + 0.5));
  bool tile = seamless && !dome;
  vec2 per = vec2(tile ? nx : 4096.0, 4096.0);
  vec2 p = place(uv, nx, dome);
  // the pixel's footprint in base cells (no derivatives in this GLSL : two more places)
  vec2 px = 1.0 / RENDERSIZE;
  float foot = max(length(place(uv + vec2(px.x, 0.0), nx, dome) - p), length(place(uv + vec2(0.0, px.y), nx, dome) - p));
  // focus : the blur radius in base cells, from nothing to about a cell
  float soft = focus * focus * 0.9;
  // a seed is a whole-lattice jump (a different field, same character)
  vec2 sd = floor(vec2(seed * 997.0, seed * 613.0));
  p += sd * vec2(tile ? 0.0 : 1.0, 1.0);

  // evolve : free time, or the tempo's beats with a glide from cut to melt
  float t = PH_noiseEvolve;
  if (sync > 0) {
    float g = max(glide, 0.02);
    // (each step is a golden-ratio stride : the beats never cycle back to a field)
    t = (floor(t) + smoothstep(1.0 - g, 1.0, fract(t))) * 0.6180339;
  }

  float v = 0.5 + noiseAt(p, per, tile, t, foot, soft);
  float v2 = 0.5;
  if (field == 1) v2 = 0.5 + noiseAt(p + vec2(tile ? 0.0 : 1531.0, 977.0), per, tile, t + 11.3, foot, soft);

  // shaping : contrast about the middle, level, then steps (soft at the pixel and
  // the focus, so the bands never stair-step), invert
  float n = floor(max(steps, 1.0));
  float slope = (foot * 1.5 + soft * 1.5) * max(contrast, 0.05);
  vec2 vv = vec2(v, v2);
  vv = clamp((vv - 0.5) * contrast + 0.5 + level * 0.5, 0.0, 1.0);
  if (n > 1.5) {
    vec2 y = vv * n - 0.5;
    vec2 k = floor(y);
    float w = clamp(0.5 * slope * n, 0.001, 0.5);
    vec2 q = k + smoothstep(0.5 - w, 0.5 + w, y - k);
    vv = clamp(q, 0.0, n - 1.0) / (n - 1.0);
  }
  if (invert) vv = 1.0 - vv;

  if (field == 1) {
    // a map : red = one field, green = another (Remap reads them as x and y)
    gl_FragColor = vec4(vv.x, vv.y, 0.5, key ? vv.x : 1.0);
    return;
  }
  vec3 base = vec3(0.02, 0.02, 0.025);
  vec3 c = base + tint.rgb * vv.x;
  gl_FragColor = key ? vec4(tint.rgb, vv.x) : vec4(c, 1.0);
}
