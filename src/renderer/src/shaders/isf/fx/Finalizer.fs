/*{
  "DESCRIPTION": "Finalizer : the last always-on master stage after Context: a final 'EQ/compressor' for the whole output. LEVELS (input black/white + gamma + per-channel R/G/B gain + alpha, video-editor-style) for the finishing grade, a round of SHARPEN, and the physically-modelled GRAIN (film / digital sensor / CRT / VHS) laid over everything so the whole image shares one grain structure. All neutral at defaults.",
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
    { "NAME": "alpha",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "A" },
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
    { "NAME": "filmGranule","TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "film granulation" },
    { "NAME": "filmSplice", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "film splice" },
    { "NAME": "outShape", "TYPE": "long", "VALUES": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
      "LABELS": ["none","circle","square","rectangle","triangle","pentagon","hexagon","heptagon","octagon","diamond","star 5","star 6","ellipse","rounded","cross","ring","half-circle","heart","crescent","trapezoid","capsule"],
      "DEFAULT": 0, "LABEL": "out shape" },
    { "NAME": "outSize",  "TYPE": "float", "MIN": 0.1, "MAX": 1.6, "DEFAULT": 0.7, "LABEL": "shape size" },
    { "NAME": "outAngle", "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": 0.0, "LABEL": "shape angle" },
    { "NAME": "outPosX",  "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "shape x" },
    { "NAME": "outPosY",  "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "shape y" },
    { "NAME": "outBgSource", "TYPE": "long", "VALUES": [0,1], "LABELS": ["color","bg layer"], "DEFAULT": 0, "LABEL": "outside fill" },
    { "NAME": "outBgColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0], "LABEL": "fill color" },
    { "NAME": "outDepth", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "shape depth" },
    { "NAME": "outShadowAngle", "TYPE": "float", "MIN": -3.1416, "MAX": 3.1416, "DEFAULT": -0.98, "LABEL": "depth angle" },
    { "NAME": "outPerspective", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "perspective" }
  ]
}*/
// NOTE: outShape / outBg* AND film* are applied NATIVELY as compositor output
// stages (engine/outputShape.ts, engine/cameraless.ts) : outShape needs the
// Background-slab texture as the outside fill, and film* needs frame-hold state +
// a fixed pipeline slot, neither reachable from ISF. Declared here only so the
// auto-UI shows them in the Finalizer; this shader ignores them.

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float gauss(float u1, float u2) {
  return sqrt(-2.0 * log(max(u1, 1e-6))) * cos(6.2831853 * u2);
}

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
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);

  // ── LEVELS: input black/white → gamma → per-channel gain ──
  vec3 c = gradePix(uv);

  // ── SHARPEN (luma unsharp mask on the source detail) ──
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
    c += (lc - blur) * sharpen;
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
      // Gray/half-colour anaglyph : feed luma to each eye (less retinal rivalry,
      // classic for abstract relief where hue would fight the filters).
      float lL = dot(leftEye, vec3(0.299, 0.587, 0.114));
      float lR = dot(rightEye, vec3(0.299, 0.587, 0.114));
      c = vec3(lL, lR, lR);
    } else {
      c = vec3(leftEye.r, rightEye.g, rightEye.b);
    }
  }

  // ── GRAIN over the graded image (one shared grain structure) ──
  float l = clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  vec3 add = vec3(0.0);
  if (grain > 0.001) {
    if (character == 1) {
      float seed = floor(TIME * 24.0);
      vec2 jit = hash22(vec2(seed, 1.0)) * 64.0;
      vec2 p = gl_FragCoord.xy / (max(grainSize, 1.0) * 1.9) + jit;
      float g = vnoise(p) * 0.62 + vnoise(p * 2.3 + 11.0) * 0.38 - 0.5;
      g = sign(g) * pow(abs(g) * 2.0, 1.3) * 0.5;
      float mid = pow(1.0 - abs(2.0 * l - 1.0), 0.6);
      vec3 gn = vec3(g);
      if (chroma > 0.001) {
        gn = mix(vec3(g), vec3(vnoise(p + vec2(19.0, 3.0)) - 0.5, g, vnoise(p + vec2(7.0, 23.0)) - 0.5) * 1.1, chroma);
      }
      add = gn * grain * 1.15 * mid;
    } else if (character == 0) {
      float fs = floor(TIME * 30.0);
      vec2 pxg = gl_FragCoord.xy / max(grainSize, 1.0);
      float shot = gauss(hash21(pxg + fs * 7.3), hash21(pxg + fs * 7.3 + 57.0)) * sqrt(clamp(l, 0.02, 1.0));
      float read = gauss(hash21(pxg + fs * 7.3 + 123.0), hash21(pxg + fs * 7.3 + 199.0)) * 0.5;
      float prnu = (hash21(floor(pxg)) - 0.5) * 0.12 * l;
      vec3 gn = vec3(shot * 0.7 + read * 0.45 + prnu);
      if (chroma > 0.001) {
        float cn = hash21(pxg * 0.5 + fs * 3.0) - 0.5;
        gn += vec3(cn, -cn * 0.3, -cn) * chroma * 0.35 * (1.0 - l * 0.7);
      }
      add = gn * grain * 0.55;
    } else if (character == 2) {
      float row = floor(gl_FragCoord.y / max(grainSize, 1.0));
      float seed = floor(TIME * 50.0);
      vec2 cell = vec2(floor(gl_FragCoord.x / max(grainSize, 1.0)), row);
      float n = (hash21(cell + seed * 17.3) - 0.5) * (0.5 + hash21(vec2(row, seed)));
      float w = 0.35 + 0.65 * smoothstep(0.0, 0.4, l);
      float bandH = 1.0 + floor(hash21(vec2(row, seed + 3.0)) * 3.0);
      float bandQ = floor(row / bandH);
      float on = step(1.0 - parasites * 0.04, hash21(vec2(bandQ, seed)));
      float center = hash21(vec2(bandQ, seed + 7.0));
      float halfW = 0.03 + hash21(vec2(bandQ, seed + 11.0)) * 0.6;
      float inSeg = 1.0 - smoothstep(halfW - 0.02, halfW + 0.02, abs(uv.x - center) + (vnoise(vec2(uv.x * 40.0, bandQ)) - 0.5) * 0.06);
      add = vec3(n) * grain * w + vec3(on * inSeg * (hash21(cell + 77.0) - 0.3) * 1.4);
    } else {
      float row = floor(gl_FragCoord.y / max(grainSize, 1.0));
      float seed = floor(TIME * 30.0);
      float smear = vnoise(vec2(gl_FragCoord.x / (max(grainSize, 1.0) * 14.0), row * 0.7 + seed * 3.0)) - 0.5;
      float fine = (hash21(vec2(floor(gl_FragCoord.x / max(grainSize, 1.0)), row) + seed * 13.1) - 0.5) * 0.5;
      float chromaErr = vnoise(vec2(row * 0.4, seed * 2.0)) - 0.5;
      vec3 noise = vec3(smear * 0.7 + fine) + vec3(chromaErr * 0.6, 0.0, -chromaErr * 0.6);
      float w = 0.4 + 0.6 * smoothstep(0.0, 0.35, l);
      float scell = floor(uv.y * 60.0);
      float son = step(1.0 - parasites * 0.05, hash21(vec2(scell, seed)));
      float ctr = hash21(vec2(scell, seed + 5.0)) + (hash21(vec2(scell, seed + 3.0)) - 0.5) * 0.25 * fract(TIME * 7.7);
      float dash = son * (1.0 - step(0.02 + hash21(vec2(scell, seed + 9.0)) * 0.08, abs(uv.x - ctr)));
      add = noise * grain * w + vec3(dash * mix(1.1, -0.6, step(0.88, hash21(vec2(scell, seed + 17.0)))));
    }
  }
  c += add;

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a * alpha);
}
