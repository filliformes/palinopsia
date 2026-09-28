/*{
  "DESCRIPTION": "CRT Screen : a whole-tube finish (a CRT glass surface): barrel curvature, edge-increasing chromatic aberration, scanline grille, corner vignette, and a rounded bezel that blacks out beyond the glass (the bezel follows the layer's own alpha, so a transparent layer stays transparent). GRILLE LINES counts the grille per frame height; RASTER MOIRÉ keeps the curved moiré bands the glass beats against a fine grille, at any output resolution. The 'projected on a tube' master stage : pairs with Grain/Scanlines under it.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Stylize", "Master"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "curve",      "TYPE": "float", "MIN": 0.0, "MAX": 0.6, "DEFAULT": 0.15, "LABEL": "glass curve" },
    { "NAME": "aberration", "TYPE": "float", "MIN": 0.0, "MAX": 0.05,"DEFAULT": 0.008, "LABEL": "edge fringe" },
    { "NAME": "scanline",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "grille depth" },
    { "NAME": "vignette",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4 },
    { "NAME": "corner",     "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.06, "LABEL": "bezel corner" },
    { "NAME": "lines",      "TYPE": "float", "MIN": 120.0, "MAX": 1080.0, "DEFAULT": 540.0, "LABEL": "grille lines" },
    { "NAME": "moire",      "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "raster moiré" }
  ]
}*/

const float TAU = 6.2831853;

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  float aspect = RENDERSIZE.x / RENDERSIZE.y;

  // Barrel warp: push the image out toward the edges (glass curvature).
  vec2 warped = uv + c * r2 * curve;

  // Chromatic aberration grows with radius, along the radial direction.
  // Past the glass edge the red tap smears the edge column : kept, it reads
  // as the tube's convergence error.
  float ab = aberration * r2 * 40.0;
  vec2 cr = warped + c * ab;
  vec2 cb = warped - c * ab;
  vec4 sR = IMG_NORM_PIXEL(inputImage, cr);
  vec4 sG = IMG_NORM_PIXEL(inputImage, warped);
  vec4 sB = IMG_NORM_PIXEL(inputImage, cb);
  vec3 col = vec3(sR.r, sG.g, sB.b);
  // Content the fringe moves keeps its own coverage.
  float aIn = max(sG.a, max(sR.a, sB.a));

  // Scanline grille (darkening only : no glow), counted in LINES per frame
  // height, so it is the same share of the frame at 1080p, 4K or on the dome.
  // 540 = one dark row every other row at 1080p, the finest a 1080 raster draws.
  // RASTER MOIRÉ (1, the default look) samples the grille on a fixed 1080-row
  // raster : the curved moiré bands the barrel warp beats against a fine grille
  // come out the same at every output resolution. 0 draws it smoothly at the
  // output's own resolution, fading whatever is too fine to draw to its mean.
  vec2 vres = vec2(1080.0 * aspect, 1080.0);
  vec2 uvr = (floor(uv * vres) + 0.5) / vres;
  vec2 cq = uvr - 0.5;
  float wyR = uvr.y + cq.y * dot(cq, cq) * curve;
  float lineR = 0.5 + 0.5 * sin(wyR * lines * TAU);
  float lineC = 0.5 + 0.5 * sin(warped.y * lines * TAU);
  // Local grille frequency in cycles per output pixel (d warped.y / d uv).
  float gy = 1.0 + curve * (c.x * c.x + 3.0 * c.y * c.y);
  float gx = 2.0 * curve * c.x * c.y;
  float f = lines * length(vec2(gx / RENDERSIZE.x, gy / RENDERSIZE.y));
  lineC = mix(0.5, lineC, 1.0 - smoothstep(0.3, 0.5, f));
  float line = mix(lineC, lineR, moire);
  col *= 1.0 - scanline * line * 0.5;

  // Corner vignette.
  col *= 1.0 - vignette * smoothstep(0.15, 0.5, r2);

  // Rounded bezel : black outside the glass (on the warped coords). Kept in UV,
  // so at 16:9 the corners stretch like a 4:3 tube's bezel.
  vec2 q = abs(warped - 0.5) - (0.5 - corner);
  float bezel = length(max(q, 0.0)) - corner;
  float glass = 1.0 - smoothstep(0.0, 0.004, bezel);
  col *= glass;

  // Straight alpha : the glass carries the warped content's coverage; the black
  // bezel is as opaque as the layer is at that spot (opaque input : the black
  // frame as before; transparent input : nothing, no black slab).
  float aOut = mix(IMG_NORM_PIXEL(inputImage, uv).a, aIn, glass);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), aOut);
}
