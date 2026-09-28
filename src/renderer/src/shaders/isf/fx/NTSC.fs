/*{
  "DESCRIPTION": "NTSC : the crosstalk of composite-video decode. ARTIFACT bleeds the picture's fine luma detail into the color subcarrier so sharp vertical edges shimmer with dot-crawl rainbows (CARRIER tunes the subcarrier frequency : low = the coarse crawl of broadcast NTSC, high = the finest the raster can draw). FRINGE misregisters the chroma sideways for the smeared-color bleed. INTERLACE separates the two scan fields : alternate lines take a small hue rotation (FIELD HUE) and brightness offset, and FIELD CRAWL slides the pattern so it shivers. Every size is relative to the frame height, so the look holds at 4K or on the dome. A cheap real-time approximation of composite artifacts, not a full encode/decode. It sits on the picture before the grade.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "artifact",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "artifact" },
    { "NAME": "carrier",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "carrier" },
    { "NAME": "fringe",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "fringe" },
    { "NAME": "interlace",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "interlace" },
    { "NAME": "fieldHue",   "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "field hue" },
    { "NAME": "fieldCrawl", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "field crawl" }
  ]
}*/

const mat3 RGB2YIQ = mat3(
  0.299,  0.596,  0.211,
  0.587, -0.274, -0.523,
  0.114, -0.322,  0.312);
const mat3 YIQ2RGB = mat3(
  1.0,    1.0,    1.0,
  0.956, -0.272, -1.106,
  0.619, -0.647,  1.703);

// Integrated phase (engine/phases.ts) : a crawl-speed change moves the pattern
// on from where it is instead of jumping it.
uniform float PH_fieldCrawl;

const float TAU = 6.2831853;

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  // One 1080p pixel, relative to the frame height : every size below is the
  // same share of the frame at 1080p, 4K or on the dome (identical at 1080p).
  vec2 px = vec2(1.0 / aspect, 1.0) / 1080.0;

  // Interlace field index (0 even / 1 odd), crawling with fieldCrawl. 1080
  // field lines per frame height (one per row at 1080p), never finer than the
  // output's own rows. Only the parity matters, so the crawl is wrapped at 2.
  float fieldLines = min(1080.0, RENDERSIZE.y);
  float fieldLine = floor(uv.y * fieldLines + mod(PH_fieldCrawl * 30.0, 2.0));
  float fld = mod(fieldLine, 2.0);

  // FRINGE : take chroma from horizontally-offset taps (composite color smear).
  float fr = fringe * 6.0 * px.x;
  vec2 uvL = uv - vec2(fr, 0.0);
  vec2 uvR = uv + vec2(fr, 0.0);
  vec3 yiq  = RGB2YIQ * IMG_NORM_PIXEL(inputImage, uv).rgb;
  vec3 yiqL = RGB2YIQ * IMG_NORM_PIXEL(inputImage, uvL).rgb;
  vec3 yiqR = RGB2YIQ * IMG_NORM_PIXEL(inputImage, uvR).rgb;
  yiq.y = mix(yiq.y, yiqL.y, fringe);
  yiq.z = mix(yiq.z, yiqR.z, fringe);

  // ARTIFACT (dot-crawl) : inject subcarrier-modulated luma detail into chroma,
  // so sharp vertical edges rainbow-shimmer (the composite luma/chroma crosstalk).
  vec2 uvXR = uv + vec2(px.x, 0.0);
  vec2 uvXL = uv - vec2(px.x, 0.0);
  float hf = (RGB2YIQ * IMG_NORM_PIXEL(inputImage, uvXR).rgb).x
           - (RGB2YIQ * IMG_NORM_PIXEL(inputImage, uvXL).rgb).x;
  // Subcarrier in cycles per frame HEIGHT, rising with CARRIER : 40 (a coarse,
  // broadcast-like crawl) → 540 (one cycle every two rows at 1080p). It used to
  // be per pixel and folded back past the pixel grid, so turning CARRIER up
  // made the pattern COARSER above ~0.33 (the default 0.5 lands on the same
  // frequency as before).
  float fsub = min(40.0 + 500.0 * sqrt(carrier), 0.5 * RENDERSIZE.y);
  float ph = uv.x * aspect * fsub * TAU + fld * 3.14159 + mod(PH_fieldCrawl * 18.0, TAU);
  yiq.y += hf * sin(ph) * artifact * 0.7;
  yiq.z += hf * cos(ph) * artifact * 0.7;

  // INTERLACE : rotate each field's chroma (hue) and separate its brightness.
  if (interlace > 0.001) {
    float s = (fld - 0.5) * 2.0;                 // -1 even / +1 odd
    float ang = fieldHue * 3.14159 * s * interlace;
    float cs = cos(ang), sn = sin(ang);
    vec2 iq = mat2(cs, -sn, sn, cs) * yiq.yz;
    yiq.y = iq.x;
    yiq.z = iq.y;
    yiq.x += s * interlace * 0.04;
  }

  gl_FragColor = vec4(clamp(YIQ2RGB * yiq, 0.0, 1.0), IMG_NORM_PIXEL(inputImage, uv).a);
}
