/*{
  "DESCRIPTION": "Metamorph : birth-from-within. A solid organic silhouette lives on screen; each cycle a NEW form is born from a point inside the old one, grows, and replaces it : endless metamorphosis, every shape emerging from its predecessor's body rather than cutting to it. Blobby warped forms, matte white-on-black (recolor with the layer / Vibe). BOIL churns the outline; COMPLEXITY warps the body; WANDER sets how far each generation lands from its parent. BIRTH ▸ fires a new generation on a trigger (bind it to the beat); births / sec at 0 = births only on the trigger.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "rate",       "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.15, "LABEL": "births / sec" },
    { "NAME": "size",       "TYPE": "float", "MIN": 0.05, "MAX": 0.6,  "DEFAULT": 0.28, "LABEL": "size" },
    { "NAME": "wobble",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.45, "LABEL": "boil" },
    { "NAME": "complexity", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.5,  "LABEL": "complexity" },
    { "NAME": "drift",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.4,  "LABEL": "wander" },
    { "NAME": "inner",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.3,  "LABEL": "inner shading" },
    { "NAME": "birth",      "TYPE": "event", "LABEL": "birth ▸" }
  ],
  "PASSES": [
    { "TARGET": "genState", "PERSISTENT": true, "WIDTH": "2", "HEIGHT": "1" },
    { }
  ]
}*/

// ∫ rate dt (the generation clock) and ∫ wobble dt (the boil's own speed),
// so turning either knob changes the pace from here on, never the picture.
uniform float PH_rate;
uniform float PH_wobble;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// Value noise on a lattice that repeats every 256 cells, so a clock wrapped
// at 256 is seamless and the hash never sees a big number (long shows keep
// their fine detail). Octaves step by exactly 2 to keep that period.
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, 256.0), i1 = mod(i + 1.0, 256.0);
  float a = hash12(i0), b = hash12(vec2(i1.x, i0.y)), c = hash12(vec2(i0.x, i1.y)), d = hash12(i1);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.0 + vec2(17.0, 31.0); a *= 0.5; }
  return s;
}

// 16-bit values across two 8-bit channels (the state buffer is RGBA8).
vec2 enc16(float x) {
  float v = floor(clamp(x, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  return vec2(hi, v - hi * 256.0) / 255.0;
}
float dec16(vec2 c) {
  vec2 b = floor(c * 255.0 + 0.5);
  return (b.x * 256.0 + b.y) / 65535.0;
}

// The lineage's centre for generation `seed` (0..255) : deterministic per
// generation, scattered around the frame by WANDER (the jump from parent to
// child), plus a slow sway.
vec2 centreOf(float seed) {
  float reach = mix(0.06, 0.3, drift);
  vec2 c = vec2(0.5) + reach * vec2(sin(seed * 12.9898 + 1.7), cos(seed * 7.7331 + 4.1));
  c += drift * 0.08 * vec2(sin(TIME * 0.11 + seed * 3.1), cos(TIME * 0.13 + seed * 5.7));
  return c;
}

// Signed distance to one blobby organism : a circle whose radius is carved by
// noise sampled on a CIRCLE around its rim (seamless all the way round,
// boiling with tc) + a domain warp for body complexity.
float blob(vec2 p, vec2 c, float r, float seed, float aspect, float tc) {
  if (r <= 1e-4) return 1e3;
  vec2 d = (p - c) * vec2(aspect, 1.0);
  float L = length(d);
  // Far outside the widest the rim can reach : a lower bound on the distance
  // is all the caller needs, so skip the noise (most of the frame).
  float rmax = r * (1.0 + 0.5 * (0.35 + wobble * 0.7)) * (1.0 + 0.25 * complexity);
  if (L > rmax + 0.01) return L - rmax;
  vec2 dir = d / max(L, 1e-6);
  vec2 so = vec2(hash12(vec2(seed, 1.7)), hash12(vec2(seed, 8.3))) * 64.0;
  float rim = fbm(dir * (1.0 + complexity * 2.0) + vec2(so.x, so.y + tc));
  float rr = r * (1.0 + (rim - 0.5) * (0.35 + wobble * 0.7));
  // Body warp : the form bulges asymmetrically (a figure, not a disc).
  float body = fbm(d * (2.0 + complexity * 4.0) + so.yx + 5.0);
  rr *= 1.0 + (body - 0.5) * complexity * 0.5;
  return L - rr;
}

void main() {
  // Pass 0 : the 2×1 generation state. Pixel 0 = the triggered extra phase E
  // (16-bit fraction, whole generations mod 256, trigger level); pixel 1 = the
  // ramp still to run (16-bit, 0..4 generations) and the last clock (16-bit
  // fraction of a second, for this frame's dt on the layer's own clock).
  // A BIRTH trigger queues enough phase to land on the next whole generation
  // (finishing a young birth, or running one more), which the ramp then plays
  // out fast and eased : births on the beat, and at rate 0 the lineage rests
  // on a complete form between triggers.
  if (PASSINDEX == 0) {
    vec4 s0 = IMG_NORM_PIXEL(genState, vec2(0.25, 0.5));
    vec4 s1 = IMG_NORM_PIXEL(genState, vec2(0.75, 0.5));
    float eFrac = dec16(s0.rg);
    float eInt = floor(s0.b * 255.0 + 0.5);
    float rem = dec16(s1.rg) * 4.0;
    float dt = clamp(fract(TIME - dec16(s1.ba) + 0.5) - 0.5, 0.0, 0.1);
    float dE = min(rem, dt * (1.2 + 1.5 * rem));
    rem -= dE;
    eFrac += dE;
    if (birth && s0.a < 0.5) {
      float fp = fract(fract(PH_rate) + eFrac + rem);
      rem = min(rem + (fp < 0.5 ? 1.0 - fp : 2.0 - fp), 3.99);
    }
    float carry = floor(eFrac);
    eFrac -= carry;
    eInt = mod(eInt + carry, 256.0);
    if (gl_FragCoord.x < 1.0) gl_FragColor = vec4(enc16(eFrac), eInt / 255.0, birth ? 1.0 : 0.0);
    else gl_FragColor = vec4(enc16(rem / 4.0), enc16(fract(TIME)));
    return;
  }

  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float px = 1.0 / RENDERSIZE.y;

  // Generation clock : old form (idx) gives birth to new form (idx + 1).
  vec4 s0 = IMG_NORM_PIXEL(genState, vec2(0.25, 0.5));
  float x = fract(PH_rate) + dec16(s0.rg);
  float f = fract(x);
  float idx = mod(floor(PH_rate) + floor(s0.b * 255.0 + 0.5) + floor(x), 256.0);
  float idx1 = mod(idx + 1.0, 256.0);
  float grow = f * f * (3.0 - 2.0 * f); // eased birth

  // The boil clock, wrapped at the noise period (seamless).
  float tc = mod(mod(TIME * 0.15, 256.0) + mod(PH_wobble * 0.5, 256.0), 256.0);

  // Old form : full size, shrinking away to nothing late in the cycle as the
  // child claims it (no remnant left to pop out when the cycle turns).
  vec2 cA = centreOf(idx);
  float rA = size * (1.0 - smoothstep(0.55, 0.97, f));
  float sdA = blob(uv, cA, rA, idx, aspect, tc);

  // New form : born INSIDE the old one (a point within its body, aspect
  // correct), grows to full, and moves off to its own place.
  float ba = hash12(vec2(idx, 3.3)) * 6.2832;
  vec2 cB = cA + vec2(cos(ba), sin(ba)) * size * 0.3 / vec2(aspect, 1.0);
  cB = mix(cB, centreOf(idx1), grow);
  float rB = size * grow;
  float sdB = blob(uv, cB, rB, idx1, aspect, tc);

  // The lineage : union of parent + child (they share flesh while the birth runs).
  float sd = min(sdA, sdB);
  float fill = 1.0 - smoothstep(-1.2 * px, 1.2 * px, sd);

  // Matte body : near-white silhouette with a faint interior shading (so the
  // form reads as a body, not a flat sticker), drifting on its own slow clock.
  // Straight alpha : the layer blend multiplies by alpha itself, so the color
  // stays full across the anti-aliased edge (no dark fringe over bright
  // layers). Well outside the form it falls to black, so anything that
  // ignores alpha still sees white-on-black.
  float near = 1.0 - smoothstep(2.0 * px, 4.0 * px, sd);
  float shade = 1.0;
  if (near > 0.0) shade -= inner * 0.5 * fbm(uv * 5.0 * vec2(aspect, 1.0) + vec2(3.7, 1.3) + mod(TIME * 0.05, 256.0));
  gl_FragColor = vec4(vec3(0.92) * shade * near, fill);
}
