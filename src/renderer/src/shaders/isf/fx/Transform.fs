/*{
  "DESCRIPTION": "Transform : zoom / pan / rotate the sampling frame, wrap or clamp at the edges, and crop the four edges (up/down/left/right) to black. The compositional utility: place, scale and frame a source inside the layer before FX and blending. With Shape set, the layer is instead clipped into a chosen geometric silhouette (circle, polygon, star, heart…) that you move with Pos, size with Zoom, and spin with Rotate; the crop still applies on top.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Utility"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "zoom",   "TYPE": "float", "MIN": 0.25, "MAX": 4.0,   "DEFAULT": 1.0 },
    { "NAME": "posX",   "TYPE": "float", "MIN": -1.0, "MAX": 1.0,   "DEFAULT": 0.0 },
    { "NAME": "posY",   "TYPE": "float", "MIN": -1.0, "MAX": 1.0,   "DEFAULT": 0.0 },
    { "NAME": "rotate", "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": 0.0 },
    { "NAME": "wrap",   "TYPE": "bool",  "DEFAULT": true },
    { "NAME": "cropUp",    "LABEL": "crop ↑", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.0 },
    { "NAME": "cropDown",  "LABEL": "crop ↓", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.0 },
    { "NAME": "cropLeft",  "LABEL": "crop ←", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.0 },
    { "NAME": "cropRight", "LABEL": "crop →", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.0 },
    { "NAME": "shape",  "TYPE": "long",  "VALUES": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
      "LABELS": ["none","circle","square","rectangle","triangle","pentagon","hexagon","heptagon","octagon","diamond","star 5","star 6","ellipse","rounded","cross","ring","half-circle","heart","crescent","trapezoid","capsule"],
      "DEFAULT": 0 }
  ]
}*/

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float sdNgon(vec2 p, float r, float sides) {
  float ap = r * cos(3.14159265 / sides);
  float d = -1e6;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= sides) break;
    float a = float(i) * 6.2831853 / sides + 1.5707963;
    d = max(d, dot(p, vec2(cos(a), sin(a))) - ap);
  }
  return d;
}
float sdStar(vec2 p, float r, float pts) {
  float m = 6.2831853 / pts;
  float wed = mod(atan(p.x, p.y) + m * 0.5, m) / m; // 0..1 across a wedge
  float rad = mix(r * 0.42, r, abs(wed - 0.5) * 2.0);
  return length(p) - rad;
}

// Signed silhouette: < 0 inside. p is aspect-corrected & centred on the shape.
float shapeDist(int s, vec2 p, float r) {
  if (s == 1)  return length(p) - r;                                   // circle
  if (s == 2)  return sdBox(p, vec2(r));                               // square
  if (s == 3)  return sdBox(p, vec2(r * 1.4, r * 0.75));               // rectangle
  if (s == 4)  return sdNgon(p, r, 3.0);                               // triangle
  if (s == 5)  return sdNgon(p, r, 5.0);                               // pentagon
  if (s == 6)  return sdNgon(p, r, 6.0);                               // hexagon
  if (s == 7)  return sdNgon(p, r, 7.0);                               // heptagon
  if (s == 8)  return sdNgon(p, r, 8.0);                               // octagon
  if (s == 9)  return abs(p.x) + abs(p.y) - r;                         // diamond
  if (s == 10) return sdStar(p, r, 5.0);                               // star 5
  if (s == 11) return sdStar(p, r, 6.0);                               // star 6
  if (s == 12) return length(p * vec2(1.0, 1.7)) - r;                  // ellipse
  if (s == 13) return sdBox(p, vec2(r * 0.62)) - r * 0.3;              // rounded square
  if (s == 14) return min(sdBox(p, vec2(r, r * 0.33)), sdBox(p, vec2(r * 0.33, r))); // cross
  if (s == 15) return abs(length(p) - r * 0.72) - r * 0.22;            // ring
  if (s == 16) return max(length(p) - r, -p.y);                        // half-circle (top)
  if (s == 17) {                                                       // heart (up)
    vec2 hp = p / (r * 1.15); hp.y = -hp.y + 0.35;
    float hx = abs(hp.x);
    // b can be negative; pow(neg, 3.0) is undefined in GLSL (NaN on strict
    // drivers) : cube it directly instead.
    float b = hx * hx + hp.y * hp.y - 1.0;
    return b * b * b - hx * hx * hp.y * hp.y * hp.y;
  }
  if (s == 18) return max(length(p) - r, -(length(p - vec2(r * 0.5, 0.0)) - r * 0.95)); // crescent
  if (s == 19) {                                                       // trapezoid
    float w = mix(r * 1.2, r * 0.5, clamp((p.y + r) / (2.0 * r), 0.0, 1.0));
    return max(abs(p.x) - w, abs(p.y) - r);
  }
  // capsule (vertical pill)
  vec2 cp = p; cp.y -= clamp(cp.y, -r * 0.5, r * 0.5);
  return length(cp) - r * 0.5;
}

// Screen-space edge crop : 1 inside the kept window, 0 in the cropped margins.
// A fixed garbage matte — it does NOT move with zoom/pan, it frames the layer's
// final rectangle. uv.y = 0 is the BOTTOM of the displayed frame, so cropUp
// bites the HIGH-y (top) edge and cropDown the low-y (bottom) edge.
float cropMask(vec2 uv) {
  return step(cropLeft, uv.x) * step(uv.x, 1.0 - cropRight)
       * step(cropDown, uv.y) * step(uv.y, 1.0 - cropUp);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec4 outCol;

  if (shape == 0) {
    // Inverse transform: centre, un-rotate, un-zoom, un-pan.
    vec2 p = uv - 0.5;
    p.x *= aspect;
    float cs = cos(-rotate);
    float sn = sin(-rotate);
    p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
    p /= max(zoom, 0.001);
    p.x /= aspect;
    vec2 c = p + 0.5 - vec2(posX, posY) * 0.5;

    if (wrap) {
      outCol = IMG_NORM_PIXEL(inputImage, fract(c));
    } else if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) {
      outCol = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
      outCol = IMG_NORM_PIXEL(inputImage, c);
    }
  } else {
    // Shape mode: clip the layer into the chosen silhouette, moved by Pos, sized
    // by Zoom, spun by Rotate. Outside the shape is black.
    vec2 sp = (uv - 0.5) * vec2(aspect, 1.0);
    vec2 ctr = vec2(posX * aspect, posY) * 0.5;
    vec2 q = sp - ctr;
    float cs = cos(rotate), sn = sin(rotate);
    q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
    float r = clamp(zoom * 0.35, 0.05, 1.6);
    float d = shapeDist(shape, q, r);
    float m = smoothstep(0.004, -0.004, d); // 1 inside
    vec4 src = IMG_NORM_PIXEL(inputImage, uv);
    outCol = vec4(src.rgb * m, src.a);
  }

  // Crop the four edges to black (screen space, after any transform/shape).
  outCol.rgb *= cropMask(uv);
  gl_FragColor = outCol;
}
