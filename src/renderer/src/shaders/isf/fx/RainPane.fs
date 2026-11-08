/*{
  "DESCRIPTION": "Rain on Glass : the picture behind a window in the rain. FOG mists the pane; DROPS bead on it in three sizes, each a little lens that shows the scene behind it upside down, a dark rim and a point of light; some grow heavy and SLIDE down in fits and starts, clearing a trail through the fog that mists over again (TRAILS). SIZE scales them, BEND is how far each drop bends what is behind it, SHINE the light on them. On the full dome they slide outward, down the walls.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glass", "Distortion", "Weather"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "drops", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55, "LABEL": "drops" },
    { "NAME": "size", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.45, "LABEL": "size" },
    { "NAME": "slide", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35, "LABEL": "slide" },
    { "NAME": "trails", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "trails" },
    { "NAME": "fog", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.45, "LABEL": "fog" },
    { "NAME": "bend", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "bend" },
    { "NAME": "shine", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "shine" },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [0.9, 0.94, 1.0, 1.0], "LABEL": "fog tint" }
  ]
}*/

// @dome

// The slide's clock (an integrated phase : SLIDE changes speed, never jumps).
uniform float PH_slide;

float rHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 rHash3(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

// One layer of beading drops on a grid of `cells` per frame height : the drop's
// offset from its middle (in its own radii, length < 1 inside), and how much it is there.
vec3 beads(vec2 p, float cells, float seed, float density) {
  vec2 q = p * cells;
  vec2 i = floor(q), f = fract(q);
  vec3 h = rHash3(i + seed);
  if (h.z > density) return vec3(0.0);
  float r = 0.18 + 0.22 * h.x;
  vec2 c = vec2(0.25, 0.25) + h.xy * 0.5;
  vec2 d = (f - c) / r;
  // a slightly flattened drop, wider at the bottom (it sits on the glass, heavy)
  d.y *= 1.0 + 0.18 * d.y;
  return vec3(d, 1.0);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  bool dome = DOME_FILL > 0.0;
  // the pane in frame heights; on the dome, "down" runs outward : the pattern's
  // own space is the azimuth round and the distance from the zenith
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  if (dome) {
    vec2 pol = domePolar(uv);
    p = vec2(pol.x * 6.2831853 * domeHorizon(), -pol.y);
  }
  float sz = mix(0.55, 1.8, size);
  vec3 col = vec3(0.0);
  // what a drop shows : the scene behind bent through it (a small lens, upside down)
  vec2 lens = vec2(0.0);
  float inDrop = 0.0;
  float rim = 0.0;
  float glint = 0.0;
  float clear = 0.0;
  // three sizes of beads
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float cells = (26.0 - fk * 8.0) / sz;
    vec3 b = beads(p, cells, fk * 31.7, drops * (0.75 - fk * 0.15));
    float r2 = dot(b.xy, b.xy);
    if (b.z > 0.0 && r2 < 1.0) {
      float zz = sqrt(1.0 - r2);
      float rr = (0.18 + 0.22 * 0.5) / cells;
      lens = -b.xy * rr * (0.6 + 1.6 * bend) * zz;
      inDrop = smoothstep(1.0, 0.86, sqrt(r2));
      rim = max(rim, smoothstep(0.62, 1.0, sqrt(r2)) * inDrop);
      glint = max(glint, smoothstep(0.25, 0.0, length(b.xy - vec2(-0.32, 0.38))) * inDrop);
    }
  }
  // the sliding drops : one column in four has one, falling in fits and starts
  float colW = 0.07 * sz;
  float cx = floor(p.x / colW);
  vec3 hc = rHash3(vec2(cx, 7.7));
  float speed = 0.25 + hc.x * 0.6;
  float tt = PH_slide * speed + hc.y * 10.0;
  // stick and slip : it creeps, then runs
  float fall = floor(tt) + smoothstep(0.55, 1.0, fract(tt));
  float span = 1.6;
  float yDrop = 0.8 - mod(fall * 0.23 + hc.z * span, span);
  if (dome) yDrop = -mod(fall * 0.23 + hc.z * span, span) * domeHorizon();
  float hasRunner = step(hc.x, mix(0.12, 0.45, drops));
  vec2 rp = vec2((p.x / colW - cx - 0.5) * colW + (hc.y - 0.5) * colW * 0.4, p.y - yDrop);
  float rr = colW * (0.22 + 0.12 * hc.z);
  vec2 rd = rp / rr;
  rd.y *= 0.85;
  float rr2 = dot(rd, rd);
  if (hasRunner > 0.5 && rr2 < 1.0) {
    float zz = sqrt(1.0 - rr2);
    lens = -rd * rr * (0.6 + 1.6 * bend) * zz;
    inDrop = smoothstep(1.0, 0.86, sqrt(rr2));
    rim = max(rim, smoothstep(0.6, 1.0, sqrt(rr2)) * inDrop);
    glint = max(glint, smoothstep(0.3, 0.0, length(rd - vec2(-0.3, 0.4))) * inDrop);
  }
  // its trail : clear glass above it (it wiped the fog), misting over with distance
  float above = p.y - yDrop;
  float trailW = rr * 0.55 * (0.7 + 0.3 * sin(p.y * 90.0 + hc.x * 20.0));
  if (hasRunner > 0.5 && above > 0.0 && abs(rp.x) < trailW) {
    clear = max(clear, trails * exp(-above * mix(9.0, 2.0, trails)));
  }
  // the bend, in the frame's own uv
  vec2 off = lens * vec2(1.0 / aspect, 1.0);
  if (dome) off = domeDir(uv, lens);
  vec2 cuv = clamp(uv + off, 0.0, 1.0);
  vec4 sharp = IMG_NORM_PIXEL(inputImage, cuv);
  // the fog : the picture scattered and paled behind the mist
  vec4 misty = vec4(0.0);
  float spread = 0.004 + fog * 0.018;
  for (int k = 0; k < 6; k++) {
    float fk = float(k);
    float an = fk * 2.39996 + rHash(uv * RENDERSIZE) * 6.2831;
    vec2 j = vec2(cos(an), sin(an)) * spread * sqrt((fk + 0.5) / 6.0) * vec2(1.0 / aspect, 1.0);
    vec2 fuv = clamp(uv + j, 0.0, 1.0);
    misty += IMG_NORM_PIXEL(inputImage, fuv);
  }
  misty /= 6.0;
  misty.rgb = mix(misty.rgb, tint.rgb * (0.35 + 0.65 * dot(misty.rgb, vec3(0.3, 0.59, 0.11))), fog * 0.55);
  // drops and trails see through the fog; the rest is mist, as much as FOG says
  float see = max(inDrop, clear);
  vec4 c4 = mix(mix(sharp, misty, fog), sharp, see);
  // a drop's dark rim and its point of light
  c4.rgb *= 1.0 - rim * 0.55;
  c4.rgb += vec3(glint) * shine * 0.9;
  gl_FragColor = vec4(c4.rgb, max(c4.a, glint * shine));
}
