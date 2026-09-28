/*{
  "DESCRIPTION": "Force Lines : incrustation along the image's own lines of force. The picture is banded by its luminance contours and each band SLIDES (alternating directions), so the image is cut and inlaid along its own structure : ribbons following the forms, not a grid. SLIDE picks the direction: along the contours (the ribbons glide inside the forms), across them (the bands shear over each other), or vertical (every band drops or rises, the original look). EDGE darkens the contour boundaries into engraved incrust lines; GATE confines the cutting to where there is real structure (gradient energy), leaving flat areas untouched. RATE makes the contours crawl through the tonal range; VARY gives each band its own slide; AUDIO lets each band ride its own part of the spectrum (dark bands the bass, bright bands the treble). Distinct from Autocutter (cells) : these cuts FOLLOW the image.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Distort"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "lines",  "TYPE": "float", "MIN": 2.0,  "MAX": 24.0, "DEFAULT": 8.0,  "LABEL": "contour bands" },
    { "NAME": "shift",  "TYPE": "float", "MIN": 0.0,  "MAX": 0.08, "DEFAULT": 0.02, "LABEL": "slide" },
    { "NAME": "edge",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.5,  "LABEL": "incrust lines" },
    { "NAME": "gate",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.5,  "LABEL": "structure gate" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 1.0,  "LABEL": "mix" },
    { "NAME": "slide",  "TYPE": "long",  "VALUES": [0, 1, 2], "LABELS": ["along contours", "across contours", "vertical"], "DEFAULT": 2, "LABEL": "slide direction" },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0,  "MAX": 2.0,  "DEFAULT": 0.0,  "LABEL": "crawl" },
    { "NAME": "vary",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.0,  "LABEL": "vary per band" },
    { "NAME": "audio",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.0,  "LABEL": "audio slide" },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// Integrated phase (engine/phases.ts) : the contours crawl by ∫rate dt, so a
// rate change alters the pace from here on, never where the bands are.
// Wrapped at 4096 (the band index is taken mod 4096, so nothing jumps).
uniform float PH_rate; // wrap 4096

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float hash11(float x) {
  vec3 p3 = fract(vec3(x) * 0.1031); // precise hash : no rows, no lattice over hours
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Spectrum (row 1 : log-spaced, bass at u = 0), 0..1. Bare-identifier coord.
float spec(float u) {
  vec2 ac = vec2(clamp(u, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);

  // Local luminance gradient : central differences about 2 px apart at 1080p,
  // measured in frame-height units so the gate reads the same at 720p, 4K and
  // on the dome. (Every coordinate is a bare identifier : the ISF parser splits
  // IMG_NORM_PIXEL on commas and silently miscompiles a nested vec2.)
  vec2 grad;
  if (slide == 2) {
    // Vertical : the original look. It reads one diagonal difference, so every
    // band slides straight up or down, whichever way that difference leans;
    // near edges the 8-bit noise flips the side pixel by pixel into a gritty
    // fringe, which is part of the look (the contour modes gate it out).
    vec2 dg = vec2(0.00185 / aspect);
    vec2 da = uv + dg;
    vec2 db = uv - dg;
    grad = vec2(luma(IMG_NORM_PIXEL(inputImage, da).rgb) - luma(IMG_NORM_PIXEL(inputImage, db).rgb), 0.0);
  } else {
    vec2 px = vec2(1.0 / aspect, 1.0) * 0.0019;
    vec2 cl = uv - vec2(px.x, 0.0);
    vec2 cr = uv + vec2(px.x, 0.0);
    vec2 cd = uv - vec2(0.0, px.y);
    vec2 cu = uv + vec2(0.0, px.y);
    grad = vec2(luma(IMG_NORM_PIXEL(inputImage, cr).rgb) - luma(IMG_NORM_PIXEL(inputImage, cl).rgb),
                luma(IMG_NORM_PIXEL(inputImage, cu).rgb) - luma(IMG_NORM_PIXEL(inputImage, cd).rgb));
  }
  float gm = length(grad);
  vec2 dir = grad / max(gm, 1e-4);
  // Along the iso-contour (the line of force), or across it (along the
  // gradient). Vertical takes the "along" rule on its one-axis gradient.
  vec2 slideDir = slide == 1 ? dir : vec2(-dir.y, dir.x);

  // Contour bands of the local luminance : each band slides, alternating
  // direction, so adjacent ribbons shear against each other. RATE crawls the
  // band boundaries through the tonal range.
  float l0 = luma(src.rgb);
  float lb = l0 * lines + PH_rate;
  float band = fract(lb);
  float bandIdx = mod(floor(lb), 4096.0);
  float side = step(0.5, fract(bandIdx * 0.5)) * 2.0 - 1.0;

  // Structure gate : flat areas (no gradient) keep still; edges cut hard. In
  // the contour modes, below a whisper of gradient the direction is only
  // quantization noise, so nothing slides there (the incrust lines still draw).
  float g = mix(1.0, smoothstep(0.008, 0.05, gm), gate);
  float gs = slide == 2 ? g : g * smoothstep(0.002, 0.006, gm);

  // Slide distance (frame-height units) : VARY scales each band on its own,
  // AUDIO adds each band's own slice of the spectrum.
  float s = shift * mix(1.0, 0.5 + hash11(bandIdx + 0.5), vary);
  if (audio > 0.0) s += audio * 0.04 * spec(floor(l0 * lines) / max(lines - 1.0, 1.0));
  vec2 off = slideDir * side * s * gs;
  vec2 suv = clamp(uv + vec2(off.x / aspect, off.y), 0.0, 1.0);
  vec3 col = IMG_NORM_PIXEL(inputImage, suv).rgb;

  // Incrust lines : engrave the band boundaries dark (only where gated in). On
  // steep edges a band is only a pixel or two wide, so the line widens with
  // the gradient to stay about 1.5 px instead of shimmering.
  float bw = min(max(0.07, gm * lines * 0.4), 0.45);
  float lineMask = smoothstep(0.0, bw, band) * (1.0 - smoothstep(1.0 - bw, 1.0, band));
  col *= mix(1.0, mix(1.0, lineMask, g), edge);

  gl_FragColor = vec4(mix(src.rgb, col, amount), src.a);
}
