/*{
  "DESCRIPTION": "Congeal : a self-referential feedback field (a video-feedback / frame-buffer lineage): sparse bright seeds are injected, then the persistent buffer resamples a domain-warped, decayed copy of itself each frame, so material congeals into slow drifting masses and dissolves back to black. Matte, near-black, disciplined decay. Audio sparks seed extra material wherever the spectrum is loud (bass on the left, treble on the right); CLEAR wipes the field.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Feedback"],
  "INPUTS": [
    { "NAME": "rate",  "TYPE": "float", "MIN": 0.0,  "MAX": 20.0,  "DEFAULT": 0.4 },
    { "NAME": "decay", "TYPE": "float", "MIN": 0.8,  "MAX": 0.995,"DEFAULT": 0.96 },
    { "NAME": "warp",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.4 },
    { "NAME": "seed",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.35, "LABEL": "seed density" },
    { "NAME": "scale", "TYPE": "float", "MIN": 0.5,  "MAX": 8.0,  "DEFAULT": 2.5 },
    { "NAME": "audioSeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio sparks" },
    { "NAME": "tint",  "TYPE": "color", "DEFAULT": [0.55, 0.72, 0.7, 1.0] },
    { "NAME": "clear", "TYPE": "event", "LABEL": "clear ▸" },
    { "NAME": "audioTex", "TYPE": "image" }
  ],
  "PASSES": [
    { "TARGET": "clearState", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

// Integrated rate (engine-driven : a rate change alters how fast the flow
// drifts and the seed clock ticks from now on, never where they are).
uniform float PH_rate;

// The flow noise repeats every WRAP lattice units, so its drift can wrap
// seamlessly and hash inputs stay small forever.
#define WRAP 1024.0

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 i1 = mod(i + 1.0, WRAP);
  i = mod(i, WRAP);
  return mix(mix(hash12(i), hash12(vec2(i1.x, i.y)), f.x),
             mix(hash12(vec2(i.x, i1.y)), hash12(i1), f.x), f.y);
}

// Spectrum (row 1, log-spaced : 0 bass .. 1 treble), 0..1. Bare-identifier coord.
float spec(float u) {
  vec2 ac = vec2(clamp(u, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

void main() {
  vec2 uv = isf_FragNormCoord;

  // Pass 0 : the 1×1 clear latch : it remembers last frame's trigger level
  // (.y), so the buffer pass fires on the RISING edge only : a held trigger
  // clears exactly once.
  if (PASSINDEX == 0) {
    gl_FragColor = vec4(0.0, clear ? 1.0 : 0.0, 0.0, 1.0);
    return;
  }

  if (PASSINDEX == 1) {
    // Every pass reads the latch as of the previous frame : the edge is
    // detected here, the same frame the trigger rises.
    vec2 c0 = vec2(0.5);
    if (clear && IMG_NORM_PIXEL(clearState, c0).y < 0.5) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    // Per-frame steps are normalised to 60 fps (TIMEDELTA is the frame time),
    // so trail length and drift speed hold at 30, 60 or 144 fps.
    float dts = clamp(TIMEDELTA * 60.0, 0.0, 3.0);
    // Domain-warp the lookup into the previous frame : this is what makes it
    // congeal and drift rather than just fade. Round noise features, isotropic
    // drift (both in frame-height units).
    vec2 pn = vec2(uv.x * aspect, uv.y) * scale;
    float fx = mod(PH_rate * 0.3, WRAP);
    float fy = mod(PH_rate * 0.27, WRAP);
    vec2 flow = vec2(
      vnoise(pn + vec2(fx, 0.0)),
      vnoise(pn + vec2(0.0, -fy) + 11.0)
    ) - 0.5;
    vec2 dh = flow * warp * 0.04 * dts;                       // this frame's pull, frame-height units
    vec2 sc = uv + dh * vec2(1.0 / aspect, 1.0);
    // Decay : multiplicative, frame-rate independent, plus at least one 8-bit
    // step per frame : an 8-bit buffer would otherwise stall as a flat fog
    // (small values round back to themselves) instead of dissolving to black.
    vec3 prev = IMG_NORM_PIXEL(buf, sc).rgb;
    prev = max(prev * pow(decay, dts) - 1.0 / 255.0, 0.0);
    // Inject sparse bright seeds on a stepped clock : soft round drops, each
    // with its own place and size (never a grid of squares). A drop may spill
    // past its cell, so the 3×3 neighborhood is scanned (cheap : ~1 in 30
    // cells is lit, and an unlit cell costs one hash).
    float step_ = mod(floor(TIME * 2.0 + PH_rate * 8.0), 997.0);
    vec2 g = vec2(uv.x * aspect, uv.y) * 84.0;
    vec2 cell0 = floor(g);
    // Each drop is stretched back along this frame's pull, so the copies the
    // warp drags away join into one smooth streak instead of a string of beads
    // (capped so a drop always fits the 3×3 scan).
    vec2 v = -dh * 84.0;
    float vl = length(v);
    v *= min(1.0, 0.7 / max(vl, 0.000001));
    float vv = max(dot(v, v), 0.000001);
    float spark = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 cell = cell0 + vec2(float(i), float(j));
        vec2 cs = cell + step_ * 3.1;
        // Seed density, plus audio sparks : the spectrum across the width
        // (bass left, treble right) adds drops where it is loud.
        float p = seed * 0.035;
        if (audioSeed > 0.0) {
          float lv = spec((cell.x + 0.5) / (84.0 * aspect));
          p += audioSeed * lv * lv * 0.06;
        }
        if (hash12(cs) < 1.0 - p) continue;
        vec2 ctr = cell + 0.5 + (vec2(hash12(cs + 17.0), hash12(cs + 29.0)) - 0.5) * 0.2;
        float rad = 0.45 + 0.2 * hash12(cs + 41.0);
        vec2 pa = g - ctr;
        float hs = clamp(dot(pa, v) / vv, 0.0, 1.0);
        spark = max(spark, 1.0 - smoothstep(rad * 0.3, rad, length(pa - v * hs)));
      }
    }
    // max, not add : a drop re-stamped over its own trail never piles up to a
    // hard saturated edge (which would alias into stair-steps), and material
    // never blows out where drops land on existing mass.
    gl_FragColor = vec4(max(prev, vec3(spark)), 1.0);
  } else {
    float v = IMG_NORM_PIXEL(buf, uv).r;
    vec3 base = vec3(0.02, 0.02, 0.025);
    vec3 col = base + tint.rgb * v;
    gl_FragColor = vec4(col, 1.0);
  }
}
