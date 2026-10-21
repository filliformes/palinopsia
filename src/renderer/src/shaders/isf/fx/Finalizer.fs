/*{
  "DESCRIPTION": "Finalizer : the last always-on master stage after Context: a final 'EQ/compressor' for the whole output. LEVELS (input black/white + gamma + per-channel R/G/B gain, video-editor-style, and an OPACITY that fades the whole output toward black) for the finishing grade, a round of SHARPEN, and the physically-modeled GRAIN (film / digital sensor / CRT / VHS) over the whole graded picture so it shares one grain structure (grain size counts 1080p pixels and scales with the output; on the dome, film and digital grain are drawn after the mapping, in the master's own pixels, where the size counts pixels of a 4096 master). The output shape fill, film damage and the cameraless granulation are added after this shader, natively, so they carry no grain. All neutral at defaults.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color", "Master"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "black",     "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.0, "LABEL": "in black" },
    { "NAME": "white",     "TYPE": "float", "MIN": 0.5, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "in white" },
    { "NAME": "gamma",     "TYPE": "float", "MIN": 0.4, "MAX": 2.5, "DEFAULT": 1.0 },
    { "NAME": "rGain",     "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "R gain" },
    { "NAME": "gGain",     "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "G gain" },
    { "NAME": "bGain",     "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "B gain" },
    { "NAME": "alpha",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "opacity" },
    { "NAME": "sharpen",   "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.0 },
    { "NAME": "character", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["digital", "film", "crt", "vhs"], "DEFAULT": 1 },
    { "NAME": "grain",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "grain amount" },
    { "NAME": "grainSize", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 1.5 },
    { "NAME": "chroma",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "chroma grain" },
    { "NAME": "parasites", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1, "LABEL": "parasites" },
    { "NAME": "stereo",      "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["off", "anaglyph R/C", "gray anaglyph"], "DEFAULT": 0, "LABEL": "3D stereo" },
    { "NAME": "stereoDepth", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35, "LABEL": "3D relief" },
    { "NAME": "stereoConv",  "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "3D convergence" },
    { "NAME": "stereoInvert","TYPE": "bool",  "DEFAULT": false, "LABEL": "3D invert depth" },
    { "NAME": "filmHold",   "TYPE": "long",  "VALUES": [0, 1, 2], "LABELS": ["off", "film-hold", "freeze"], "DEFAULT": 0, "LABEL": "film hold" },
    { "NAME": "filmRate",   "TYPE": "float", "MIN": 1.0, "MAX": 60.0, "DEFAULT": 8.0, "LABEL": "film draw fps" },
    { "NAME": "filmJitter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "film timing" },
    { "NAME": "filmBoil",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35, "LABEL": "film boil" },
    { "NAME": "filmFlutter","TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2, "LABEL": "film flutter" },
    { "NAME": "filmBlank",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "film blanks" },
    { "NAME": "filmBlankMode","TYPE": "long","VALUES": [0, 1, 2], "LABELS": ["black", "white", "both"], "DEFAULT": 0, "LABEL": "blank leader" },
    { "NAME": "filmDust",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "film dust" },
    { "NAME": "filmScratch","TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "film scratch" },
    { "NAME": "filmGauge",  "TYPE": "long",  "VALUES": [0, 1, 2], "LABELS": ["35 mm", "16 mm", "Super 8"], "DEFAULT": 1, "LABEL": "film gauge" },
    { "NAME": "filmDirt",   "TYPE": "long",  "VALUES": [0, 1, 2], "LABELS": ["print", "mixed", "negative"], "DEFAULT": 0, "LABEL": "dirt on" },
    { "NAME": "filmBurst",  "TYPE": "event", "DEFAULT": false, "LABEL": "dirt burst ▸" },
    { "NAME": "filmGranule","TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "film granulation" },
    { "NAME": "filmSplice", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "film splice" },
    { "NAME": "filmGrab",   "TYPE": "event", "DEFAULT": false, "LABEL": "grab frame ▸" },
    { "NAME": "outShape", "TYPE": "long", "VALUES": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
      "LABELS": ["none","circle","square","rectangle","triangle","pentagon","hexagon","heptagon","octagon","diamond","star 5","star 6","ellipse","rounded","cross","ring","half-circle","heart","crescent","trapezoid","capsule"],
      "DEFAULT": 0, "LABEL": "out shape" },
    { "NAME": "outSize",  "TYPE": "float", "MIN": 0.1, "MAX": 1.6, "DEFAULT": 0.7, "LABEL": "shape size" },
    { "NAME": "outFeather", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "shape feather" },
    { "NAME": "outAngle", "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": 0.0, "LABEL": "shape angle" },
    { "NAME": "outPosX",  "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "shape x" },
    { "NAME": "outPosY",  "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "shape y" },
    { "NAME": "outBgSource", "TYPE": "long", "VALUES": [0,1], "LABELS": ["color","bg layer"], "DEFAULT": 0, "LABEL": "outside fill" },
    { "NAME": "outBgColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0], "LABEL": "fill color" },
    { "NAME": "outDepth", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "shape depth" },
    { "NAME": "outShadowAngle", "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": -0.98, "LABEL": "depth angle" },
    { "NAME": "outPerspective", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "perspective" },
    { "NAME": "outPostWarp", "TYPE": "bool", "DEFAULT": false, "LABEL": "post warp" },
    { "NAME": "outTilt", "TYPE": "float", "MIN": -1.3963, "MAX": 1.3963, "DEFAULT": 0.0, "LABEL": "z tilt" },
    { "NAME": "outTurn", "TYPE": "float", "MIN": -1.3963, "MAX": 1.3963, "DEFAULT": 0.0, "LABEL": "z turn" }
  ]
}*/
// NOTE: outShape / outBg* AND film* are applied NATIVELY as compositor output
// stages (engine/outputShape.ts, engine/cameraless.ts, and engine/filmDamage.ts for
// dust / scratch / gauge / dirt) : outShape needs the Background-slab texture
// as the outside fill, and film* needs frame-hold state, a film clock and a fixed
// pipeline slot, none reachable from ISF. Declared here only so the auto-UI shows
// them in the Finalizer; this shader ignores them.

// (hash21 / vnoise : the parasites' helpers, below)
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

// @parasites
// @grain

// 1 while the dome stage draws the film and digital grain itself, after the
// mapping, in master pixels (lib/finalGrain.glsl, engine/domeSignal.ts) : this
// shader then leaves them out, so the dome never blows the grain up 2-4x.
uniform float DOME_GRAIN;

// LEVELS grade at a UV (input black/white → gamma → per-channel gain). Pulled
// out so the anaglyph stage can grade a horizontally-displaced second "eye".
vec3 gradePix(vec2 uv) {
  vec3 c = IMG_NORM_PIXEL(inputImage, uv).rgb;
  c = clamp((c - black) / max(white - black, 0.01), 0.0, 1.0);
  c = pow(c, vec3(1.0 / gamma));
  c *= vec3(rGain, gGain, bGain);
  return c;
}

void main() {
  vec2 uv0 = isf_FragNormCoord;
  // VHS parasites move where the picture is read from (line jitter, the
  // head-switch tear, a tracking band) : everything below reads at uv.
  float band = 0.0;
  bool vhsPar = character == 3 && grain > 0.001 && parasites > 0.001;
  vec2 uv = vhsPar ? vhsWarp(uv0, parasites, TIME, band) : uv0;
  // A torn / jittered line shows the blanking (black) where it slides past the
  // frame edge, as on tape, instead of smearing the edge column across it.
  float inFrame = (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) ? 1.0 : 0.0;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);

  // ── LEVELS: input black/white → gamma → per-channel gain ──
  vec3 c = gradePix(uv);

  // ── SHARPEN (luma unsharp mask on the source detail) ──
  float shp = 0.0;
  if (sharpen > 0.001) {
    vec2 px = 1.0 / RENDERSIZE;
    vec2 cl = uv + vec2(-px.x, 0.0);
    vec2 cr = uv + vec2(px.x, 0.0);
    vec2 cu = uv + vec2(0.0, -px.y);
    vec2 cd = uv + vec2(0.0, px.y);
    vec3 lw = vec3(0.299, 0.587, 0.114);
    float lc = dot(src.rgb, lw);
    float blur = (dot(IMG_NORM_PIXEL(inputImage, cl).rgb, lw) + dot(IMG_NORM_PIXEL(inputImage, cr).rgb, lw) +
                  dot(IMG_NORM_PIXEL(inputImage, cu).rgb, lw) + dot(IMG_NORM_PIXEL(inputImage, cd).rgb, lw)) * 0.25;
    shp = (lc - blur) * sharpen;
    c += shp;
  }

  // ── ANAGLYPH 3D (red/cyan stereoscopy) ──────────────────────────────
  //    A >century-old 3D medium, generated digitally.
  //    Depth is read from luminance (bright = near, invertible); the RED eye is
  //    horizontally displaced from the CYAN eye by a disparity ∝ depth, so under
  //    red/cyan glasses the flat frame gains relief. Convergence sets the plane
  //    that sits ON the screen : push it negative and forms pop OUT toward you.
  if (stereo > 0) {
    float depth = clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    if (stereoInvert) depth = 1.0 - depth;
    // Separation in normalized x. Half each way so the image stays centred.
    float sep = (depth - 0.5 - stereoConv * 0.5) * stereoDepth * 0.06;
    vec3 leftEye = gradePix(uv - vec2(sep, 0.0));   // red channel
    vec3 rightEye = gradePix(uv + vec2(sep, 0.0));  // cyan channels
    if (stereo == 2) {
      // Gray/half-color anaglyph : feed luma to each eye (less retinal rivalry,
      // classic for abstract relief where hue would fight the filters).
      float lL = dot(leftEye, vec3(0.299, 0.587, 0.114));
      float lR = dot(rightEye, vec3(0.299, 0.587, 0.114));
      c = vec3(lL, lR, lR);
    } else {
      c = vec3(leftEye.r, rightEye.g, rightEye.b);
    }
    c += shp; // the sharpen detail rides both eyes
  }
  c *= inFrame;

  // ── GRAIN over the graded image (one shared grain structure) ──
  float l = clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  vec3 add = vec3(0.0);
  // Grain size counts 1080p pixels : the same grain relative to the picture on
  // a 4K or 4096 master (it used to shrink 2-4x there).
  float gs = max(grainSize, 1.0) * max(1.0, RENDERSIZE.y / 1080.0);
  if (grain > 0.001) {
    // Film and digital (lib/finalGrain.glsl) : on the dome, drawn by the dome
    // stage in master pixels instead.
    if (character == 1) {
      if (DOME_GRAIN < 0.5) add = finalFilmGrain(gl_FragCoord.xy, gs, l, TIME, chroma, grain);
    } else if (character == 0) {
      if (DOME_GRAIN < 0.5) add = finalDigitalGrain(gl_FragCoord.xy, gs, l, TIME, chroma, grain);
    } else if (character == 2) {
      float row = floor(gl_FragCoord.y / gs);
      float seed = mod(floor(TIME * 50.0), 4096.0);
      vec2 cell = vec2(floor(gl_FragCoord.x / gs), row);
      float n = (hash21(cell + mod(seed * 17.3, 1024.0)) - 0.5) * (0.5 + hash21(vec2(mod(row, 1024.0), seed)));
      float w = 0.35 + 0.65 * smoothstep(0.0, 0.4, l);
      add = vec3(n) * grain * w;
      if (parasites > 0.001) c = crtParasites(c, uv0, parasites, TIME);
    } else {
      float row = floor(gl_FragCoord.y / gs);
      float seed = mod(floor(TIME * 30.0), 4096.0);
      float smear = vnoise(vec2(gl_FragCoord.x / (gs * 14.0), row * 0.7 + seed * 3.0)) - 0.5;
      float fine = (hash21(vec2(floor(gl_FragCoord.x / gs), row) + mod(seed * 13.1, 1024.0)) - 0.5) * 0.5;
      float chromaErr = vnoise(vec2(row * 0.4, seed * 2.0)) - 0.5;
      vec3 noise = vec3(smear * 0.7 + fine) + vec3(chromaErr * 0.6, 0.0, -chromaErr * 0.6);
      float w = 0.4 + 0.6 * smoothstep(0.0, 0.35, l);
      add = noise * grain * w;
      if (vhsPar) c = vhsParasites(c, uv0, parasites, TIME, band);
    }
  }
  c += add;

  // Opacity fades the picture toward black. (As a straight alpha it reached no
  // output : every capture is opaque, and the preview only showed the panel.)
  gl_FragColor = vec4(clamp(c, 0.0, 1.0) * clamp(alpha, 0.0, 1.0), src.a);
}
