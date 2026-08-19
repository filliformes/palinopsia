/*{
  "DESCRIPTION": "NTSC : the crosstalk of composite-video decode. ARTIFACT bleeds the picture's fine luma detail into the colour subcarrier so sharp vertical edges shimmer with dot-crawl rainbows (CARRIER tunes the subcarrier frequency). FRINGE misregisters the chroma sideways for the smeared-colour bleed. INTERLACE separates the two scan fields : alternate lines take a small hue rotation (FIELD HUE) and brightness offset, and FIELD CRAWL slides the pattern so it shivers. A cheap real-time approximation of composite artefacts, not a full encode/decode — sits on the picture before the grade.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "artifact",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "artifact" },
    { "NAME": "carrier",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "carrier" },
    { "NAME": "fringe",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "fringe" },
    { "NAME": "interlace",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "interlace" },
    { "NAME": "fieldHue",   "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "field ▸ hue" },
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

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 px = 1.0 / RENDERSIZE;

  // Interlace field index (0 even / 1 odd), crawling with fieldCrawl.
  float fieldLine = floor(uv.y * RENDERSIZE.y + TIME * fieldCrawl * 30.0);
  float fld = mod(fieldLine, 2.0);

  // FRINGE : take chroma from horizontally-offset taps (composite colour smear).
  float fr = fringe * 6.0 * px.x;
  vec2 uvL = uv - vec2(fr, 0.0);
  vec2 uvR = uv + vec2(fr, 0.0);
  vec3 yiq  = RGB2YIQ * IMG_NORM_PIXEL(inputImage, uv).rgb;
  vec3 yiqL = RGB2YIQ * IMG_NORM_PIXEL(inputImage, uvL).rgb;
  vec3 yiqR = RGB2YIQ * IMG_NORM_PIXEL(inputImage, uvR).rgb;
  yiq.y = mix(yiq.y, yiqL.y, fringe);
  yiq.z = mix(yiq.z, yiqR.z, fringe);

  // ARTIFACT : dot-crawl — inject subcarrier-modulated luma detail into chroma,
  // so sharp vertical edges rainbow-shimmer (the composite luma/chroma crosstalk).
  vec2 uvXR = uv + vec2(px.x, 0.0);
  vec2 uvXL = uv - vec2(px.x, 0.0);
  float hf = (RGB2YIQ * IMG_NORM_PIXEL(inputImage, uvXR).rgb).x
           - (RGB2YIQ * IMG_NORM_PIXEL(inputImage, uvXL).rgb).x;
  float ph = uv.x * RENDERSIZE.x * (1.5 + carrier * 5.0) + fld * 3.14159 + TIME * fieldCrawl * 18.0;
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
