/*{
  "DESCRIPTION": "Direct Marks : hand-drawn direct-on-film marks. Ruled lines, dots or scratches in flat ink on paper, blinking on a GATE : every mark keeps its own random flicker, so drive gate from audio or coupling for marks-on-the-beat. BOIL redraws each mark on every drawn frame (at BOIL FPS), the way a hand-made film never holds still; SEED deals a new hand. AUDIO GATE lets each mark follow the spectrum band at its own place across the frame (bass on the left). Hard-edged and linear, never radial. Matte ink over near-black paper.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry"],
  "INPUTS": [
    { "NAME": "markType", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["lines", "dots", "scratch"], "DEFAULT": 0 },
    { "NAME": "angle",   "TYPE": "float", "MIN": 0.0,  "MAX": 6.2832, "DEFAULT": 0.0 },
    { "NAME": "density", "TYPE": "float", "MIN": 2.0,  "MAX": 120.0,  "DEFAULT": 20.0 },
    { "NAME": "weight",  "TYPE": "float", "MIN": 0.02, "MAX": 0.6,    "DEFAULT": 0.28, "LABEL": "weight" },
    { "NAME": "gate",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 1.0,  "LABEL": "gate" },
    { "NAME": "jitter",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.3,  "LABEL": "hand jitter" },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0,  "MAX": 8.0,    "DEFAULT": 1.5,  "LABEL": "flicker" },
    { "NAME": "boil",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.0,  "LABEL": "boil" },
    { "NAME": "fps",     "TYPE": "float", "MIN": 1.0,  "MAX": 24.0,   "DEFAULT": 12.0, "LABEL": "boil fps" },
    { "NAME": "seed",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.0,  "LABEL": "seed (hand)" },
    { "NAME": "audio",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,    "DEFAULT": 0.0,  "LABEL": "audio gate" },
    { "NAME": "ink",     "TYPE": "color", "DEFAULT": [0.9, 0.89, 0.83, 1.0] },
    { "NAME": "paper",   "TYPE": "color", "DEFAULT": [0.04, 0.04, 0.05, 1.0] },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// ∫ rate dt (the flicker) and ∫ fps dt (the drawn-frame counter), so turning
// either knob changes the pace from here on and never jumps the marks.
uniform float PH_rate;
uniform float PH_fps;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 c = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
  float s = sin(angle), co = cos(angle);
  vec2 r = mat2(co, -s, s, co) * c;   // centred : density zooms about the middle
  vec2 q = r * density;               // in cells
  float pxc = density / RENDERSIZE.y; // one pixel, in cells

  // The hand (seed) and the drawn frame (boil). Both stay small for the hash.
  float hand = seed * 61.7;
  float fr = mod(floor(PH_fps), 4096.0) * 1.618 + 11.0;

  int mt = int(markType);
  float m = 0.0;      // mark coverage
  vec2 key = vec2(0.0); // this mark's id : its flicker and audio threshold
  float col = 0.0;    // this mark's column across the frame : its audio band

  if (mt == 0) {
    // Ruled lines : a band around each line centre, hand-nudged sideways and
    // (with boil) re-ruled on every drawn frame. The nudge never pushes the
    // line out of its own cell, so it is never clipped.
    float idx = floor(q.x);
    float hs = hash12(vec2(idx, hand + 3.1));
    float hf = hash12(vec2(idx + hand, fr));
    float hp = hash12(vec2(idx + hand, fr + 0.5));
    float hw = max(weight * 0.5 * (1.0 + (hp - 0.5) * boil * 0.5), 0.6 * pxc);
    hw = min(hw, 0.5 - pxc);
    float slack = max(0.5 - hw - pxc, 0.0);
    float off = clamp((hs - 0.5) * 0.55 * jitter + (hf - 0.5) * boil * 0.6, -0.5, 0.5) * 2.0 * slack;
    float d = abs(fract(q.x) - 0.5 - off);
    m = 1.0 - smoothstep(hw - 0.5 * pxc, hw + 0.5 * pxc, d);
    key = vec2(idx, 0.0);
    col = (idx + 0.5) / density;
  } else if (mt == 1) {
    // Dots : a disc per cell, hand-nudged off centre. The nudge shrinks as the
    // disc grows, so a dot never runs into its cell edge (no flat sides).
    vec2 cell = floor(q);
    vec2 g = fract(q) - 0.5;
    vec2 hs = vec2(hash12(cell + hand), hash12(cell + hand + 7.0));
    vec2 hf = vec2(hash12(cell + vec2(hand, fr)), hash12(cell + vec2(fr, hand + 5.0)));
    float hp = hash12(cell + vec2(fr + 3.0, hand));
    float rad = weight * 0.9 * (1.0 + (hp - 0.5) * boil * 0.4);
    rad = clamp(rad, 0.6 * pxc, 0.5 - pxc);
    float slack = max(0.5 - rad - pxc, 0.0);
    vec2 off = clamp((hs - 0.5) * 2.0 * jitter + (hf - 0.5) * boil, -1.0, 1.0) * slack;
    m = 1.0 - smoothstep(rad - 0.5 * pxc, rad + 0.5 * pxc, length(g - off));
    key = cell;
    col = (cell.x + 0.5) / density;
  } else {
    // Scratches : only some columns carry one. Each wobbles along its length
    // (a smooth wander, in cells, that never leaves its column) and breaks
    // into segments of its own length. Boil re-scratches every drawn frame.
    float idx = floor(q.x);
    float hs = hash12(vec2(idx, hand + 5.3));
    float hf = hash12(vec2(idx + hand, fr + 0.25));
    float present = step(0.62, mix(hs, hf, boil * 0.35));
    float hw = max(weight * 0.25, 0.6 * pxc);
    float slack = max(0.5 - hw - pxc, 0.0);
    float yy = r.y * 8.0 + hash12(vec2(idx, hand + 1.9)) * 8.0;
    float k = floor(yy);
    float t = smoothstep(0.0, 1.0, fract(yy));
    float wS = mix(hash12(vec2(idx + hand, k)), hash12(vec2(idx + hand, k + 1.0)), t) - 0.5;
    float wF = mix(hash12(vec2(idx + hand, k + fr)), hash12(vec2(idx + hand, k + 1.0 + fr)), t) - 0.5;
    float wob = clamp(wS * 2.0 * jitter + wF * 2.0 * boil, -1.0, 1.0) * slack;
    float d = abs(fract(q.x) - 0.5 - wob);
    m = present * (1.0 - smoothstep(hw - 0.5 * pxc, hw + 0.5 * pxc, d));
    float segs = 6.0 + 8.0 * hash12(vec2(idx, hand + 9.1));
    float yb = floor(r.y * segs + hash12(vec2(idx, hand + 2.7)) * 10.0);
    float brk = mix(hash12(vec2(idx + hand, yb + 20.0)), hash12(vec2(idx + hand, yb + fr + 40.0)), boil);
    m *= step(0.35, brk); // broken up the frame
    key = vec2(idx, 1.0);
    col = (idx + 0.5) / density;
  }

  // GATE : every mark blinks on its own oscillator (random phase and a little
  // rate spread, so no wave ever sweeps the marks); `gate` sets how many are
  // on (1 = all). AUDIO GATE mixes each mark's own gate toward the loudness
  // of the spectrum band at its column : marks on the beat, per mark.
  float ph = hash12(key + vec2(hand + 41.0, 13.0));
  float spread = hash12(key + vec2(19.0, hand + 23.0));
  float flick = 0.5 + 0.5 * sin(PH_rate * (0.7 + 0.6 * spread) + ph * 6.2832);
  vec2 ac = vec2(clamp(col / aspect + 0.5, 0.0, 1.0), 0.75);
  float band = IMG_NORM_PIXEL(audioTex, ac).r;
  float g = mix(gate, band, audio);
  float on = step(1.0 - g, flick);

  gl_FragColor = vec4(mix(paper.rgb, ink.rgb, clamp(m * on, 0.0, 1.0)), 1.0);
}
