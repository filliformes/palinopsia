/*{
  "DESCRIPTION": "Scan : a real surface, photographed. 30 CC0 material scans (ambientCG : bark, rock, sand, paper, plaster, rust, lava, snow…) with their colour, height, normal and ambient-occlusion maps, laid across the frame with HEX TILING (every tile randomly shifted and blended, so the scan never visibly repeats however far you zoom out) and relit by the organic relief light at LIGHT ANGLE. SCALE sets how many scan widths fill the frame height, DRIFT slides it slowly, WEATHER darkens and wets the hollows (AO), COLOUR fades to the scan's own greys. Put Colony on a layer above with its ground set to transparent and lichen or rust grows over the real rock or steel.",
  "CREDIT": "Palinopsia (scans : ambientCG, CC0)",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic"],
  "INPUTS": [
    { "NAME": "material", "TYPE": "long",
      "VALUES": [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],
      "LABELS": ["paper crumpled","paper rough","paper fibers","cardboard","bark fine","bark deep","bark plates","dry ground","sand dunes","sand ripples","rock face","rock rough","fabric weave","fabric knit","carpet","plaster","painted plaster","concrete","concrete rough","bricks","wood planks","wood grain","metal worn","corrugated steel","crushed foil","foil wrinkles","snow","lava","leather","gravel"],
      "DEFAULT": 11, "LABEL": "material" },
    { "NAME": "scale",      "TYPE": "float", "MIN": 0.3, "MAX": 6.0,    "DEFAULT": 1.6,  "LABEL": "scale" },
    { "NAME": "tiling",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 1.0,  "LABEL": "hex tiling" },
    { "NAME": "drift",      "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.05, "LABEL": "drift" },
    { "NAME": "driftAngle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.4,  "LABEL": "drift angle" },
    { "NAME": "rotate",     "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": 0.0, "LABEL": "rotate" },
    { "NAME": "weather",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.3,  "LABEL": "weather" },
    { "NAME": "colour",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 1.0,  "LABEL": "colour" },
    { "NAME": "relief",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.6,  "LABEL": "relief" },
    { "NAME": "lightAngle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 2.36, "LABEL": "light angle" },
    { "NAME": "scanColor",  "TYPE": "image" },
    { "NAME": "scanHeight", "TYPE": "image" },
    { "NAME": "scanNormal", "TYPE": "image" },
    { "NAME": "scanAO",     "TYPE": "image" }
  ]
}*/

// The maps are pushed by the compositor (engine/Compositor.ts pushScanMaps) :
// 1K, REPEAT, mipmapped. Hex tiling after Mikkelsen, JCGT 2022 ("Practical
// Real-Time Hex-Tiling") : the plane is cut into a hex lattice; each pixel blends
// three samples, one per surrounding lattice vertex, each vertex with its own
// random offset, weights sharpened so the blend keeps the scan's contrast
// instead of averaging it to mush.

float ASP() { return RENDERSIZE.x / RENDERSIZE.y; }

vec2 scanUV(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(ASP(), 1.0);
  float c = cos(rotate), s = sin(rotate);
  p = mat2(c, -s, s, c) * p;
  return p * scale + vec2(cos(driftAngle), sin(driftAngle)) * TIME * drift * 0.05;
}

// Barycentric weights + the three vertex ids of the hex-lattice triangle holding st.
void hexTri(vec2 st, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3) {
  vec2 skewed = mat2(1.0, 0.0, -0.57735027, 1.15470054) * (st * 3.4641016);
  vec2 base = floor(skewed);
  vec3 tmp = vec3(fract(skewed), 0.0);
  tmp.z = 1.0 - tmp.x - tmp.y;
  float s = step(0.0, -tmp.z);
  float s2 = 2.0 * s - 1.0;
  w = vec3(-tmp.z * s2, s - tmp.y * s2, s - tmp.x * s2);
  v1 = base + vec2(s, s);
  v2 = base + vec2(s, 1.0 - s);
  v3 = base + vec2(1.0 - s, s);
}

vec2 hexOffset(vec2 v) { return og_hash2(v * 1.37 + 3.1) * 7.0; }

// Weights + offsets for the three samples, each lattice vertex bound to a FIXED
// slot by a three-colouring of the lattice ((i + 2j) mod 3 differs on the three
// corners of every triangle). Shared vertices then keep their slot across an
// edge, so the texture derivatives never jump (a jump picks the smallest mip :
// thin seams along every edge) except for the vertex that weighs 0 there.
void hexSetup(vec2 st, out vec3 w, out vec2 o0, out vec2 o1, out vec2 o2) {
  vec3 bw; vec2 v1, v2, v3;
  hexTri(st, bw, v1, v2, v3);
  bw = pow(max(bw, 0.0), vec3(6.0));
  bw /= max(bw.x + bw.y + bw.z, 1e-5);
  float c1 = mod(v1.x + 2.0 * v1.y, 3.0);
  float c2 = mod(v2.x + 2.0 * v2.y, 3.0);
  vec2 s0 = c1 < 0.5 ? v1 : (c2 < 0.5 ? v2 : v3);
  vec2 s1 = abs(c1 - 1.0) < 0.5 ? v1 : (abs(c2 - 1.0) < 0.5 ? v2 : v3);
  vec2 s2 = abs(c1 - 2.0) < 0.5 ? v1 : (abs(c2 - 2.0) < 0.5 ? v2 : v3);
  w.x = c1 < 0.5 ? bw.x : (c2 < 0.5 ? bw.y : bw.z);
  w.y = abs(c1 - 1.0) < 0.5 ? bw.x : (abs(c2 - 1.0) < 0.5 ? bw.y : bw.z);
  w.z = abs(c1 - 2.0) < 0.5 ? bw.x : (abs(c2 - 2.0) < 0.5 ? bw.y : bw.z);
  o0 = hexOffset(s0); o1 = hexOffset(s1); o2 = hexOffset(s2);
}

vec4 sampleColor(vec2 st) {
  if (tiling < 0.01) return IMG_NORM_PIXEL(scanColor, st);
  vec3 w; vec2 o0, o1, o2;
  hexSetup(st, w, o0, o1, o2);
  vec2 sa = st + o0, sb = st + o1, sc = st + o2;
  vec4 hx = IMG_NORM_PIXEL(scanColor, sa) * w.x + IMG_NORM_PIXEL(scanColor, sb) * w.y + IMG_NORM_PIXEL(scanColor, sc) * w.z;
  return mix(IMG_NORM_PIXEL(scanColor, st), hx, tiling);
}
float sampleHeight(vec2 st) {
  if (tiling < 0.01) return IMG_NORM_PIXEL(scanHeight, st).r;
  vec3 w; vec2 o0, o1, o2;
  hexSetup(st, w, o0, o1, o2);
  vec2 sa = st + o0, sb = st + o1, sc = st + o2;
  float hx = IMG_NORM_PIXEL(scanHeight, sa).r * w.x + IMG_NORM_PIXEL(scanHeight, sb).r * w.y + IMG_NORM_PIXEL(scanHeight, sc).r * w.z;
  return mix(IMG_NORM_PIXEL(scanHeight, st).r, hx, tiling);
}
float sampleAO(vec2 st) {
  if (tiling < 0.01) return IMG_NORM_PIXEL(scanAO, st).r;
  vec3 w; vec2 o0, o1, o2;
  hexSetup(st, w, o0, o1, o2);
  vec2 sa = st + o0, sb = st + o1, sc = st + o2;
  float hx = IMG_NORM_PIXEL(scanAO, sa).r * w.x + IMG_NORM_PIXEL(scanAO, sb).r * w.y + IMG_NORM_PIXEL(scanAO, sc).r * w.z;
  return mix(IMG_NORM_PIXEL(scanAO, st).r, hx, tiling);
}

float og_height(vec2 uv) { return sampleHeight(scanUV(uv)); }

#define OG_RELIEF_E 1.5
#define OG_SHADOW_STEPS 4
// @og-relief

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 st = scanUV(uv);
  vec3 alb = sampleColor(st).rgb;
  float h = sampleHeight(st);
  float ao = sampleAO(st);
  float grey = dot(alb, vec3(0.299, 0.587, 0.114));
  alb = mix(vec3(grey), alb, colour);
  // Weather : grime and damp settle in the hollows (darker, a touch cooler).
  alb *= mix(1.0, mix(0.35, 1.0, ao) * mix(0.8, 1.0, h), weather);
  gl_FragColor = vec4(clamp(og_relief(uv, alb, h, lightAngle, relief), 0.0, 1.0), 1.0);
}
