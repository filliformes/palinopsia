/*{
  "DESCRIPTION": "Vibe — the always-on end-of-chain color-mastering stage: AUTO-LEVELS (temporally smoothed frame min/max, remaps luminance to full range), gamma tone placement, pre-map luma sharpen, dither, 2–5 stop palette map, source mix-back, contrast, saturation, and SPLIT-TONE (independent shadow/highlight tints). One unit that decides the whole output's look.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color", "Master"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "stops",      "TYPE": "float", "MIN": 2.0,  "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "color stops" },
    { "NAME": "blend",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "bands↔smooth" },
    { "NAME": "dither",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "dither breakup" },
    { "NAME": "mixSrc",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "source mix" },
    { "NAME": "autoLevel",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "auto-levels" },
    { "NAME": "gamma",      "TYPE": "float", "MIN": 0.4,  "MAX": 2.5, "DEFAULT": 1.0, "LABEL": "tone gamma" },
    { "NAME": "contrast",   "TYPE": "float", "MIN": 0.25, "MAX": 2.5, "DEFAULT": 1.0 },
    { "NAME": "saturation", "TYPE": "float", "MIN": 0.0,  "MAX": 2.0, "DEFAULT": 1.0 },
    { "NAME": "sharpen",    "TYPE": "float", "MIN": 0.0,  "MAX": 2.0, "DEFAULT": 0.0 },
    { "NAME": "splitTone",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "split-tone" },
    { "NAME": "shadowTint", "TYPE": "color", "DEFAULT": [0.45, 0.48, 0.55, 1.0], "LABEL": "shadow tint" },
    { "NAME": "highTint",   "TYPE": "color", "DEFAULT": [0.55, 0.52, 0.45, 1.0], "LABEL": "highlight tint" },
    { "NAME": "harmony",  "TYPE": "long",  "VALUES": [0, 1, 2, 3, 4, 5], "LABELS": ["off", "analogous", "complementary", "triad", "split", "tetrad"], "DEFAULT": 0 },
    { "NAME": "baseHue",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "chord hue" },
    { "NAME": "chroma",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55, "LABEL": "chord chroma" },
    { "NAME": "spread",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "chord spread" },
    { "NAME": "colorA", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0] },
    { "NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0] },
    { "NAME": "colorC", "TYPE": "color", "DEFAULT": [0.5, 0.5, 0.5, 1.0] },
    { "NAME": "colorD", "TYPE": "color", "DEFAULT": [0.75, 0.75, 0.75, 1.0] },
    { "NAME": "colorE", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0] }
  ],
  "PASSES": [
    { "TARGET": "lumBuf", "PERSISTENT": true, "WIDTH": "$WIDTH/64", "HEIGHT": "$HEIGHT/64" },
    { }
  ]
}*/

float bayer4(vec2 p) {
  vec2 q = floor(mod(p, 4.0));
  float i = q.x + q.y * 4.0;
  float v = 0.0;
  if (i < 0.5) v = 0.0;  else if (i < 1.5) v = 8.0;  else if (i < 2.5) v = 2.0;  else if (i < 3.5) v = 10.0;
  else if (i < 4.5) v = 12.0; else if (i < 5.5) v = 4.0;  else if (i < 6.5) v = 14.0; else if (i < 7.5) v = 6.0;
  else if (i < 8.5) v = 3.0;  else if (i < 9.5) v = 11.0; else if (i < 10.5) v = 1.0; else if (i < 11.5) v = 9.0;
  else if (i < 12.5) v = 15.0; else if (i < 13.5) v = 7.0; else if (i < 14.5) v = 13.0; else v = 5.0;
  return (v + 0.5) / 16.0;
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Colour CHORDS (after Collopy): generate the palette stops from one base hue
// plus a harmony relationship, on a dark→light value ramp. Value carries the
// tonal placement; the harmony carries the hue relationships.
vec3 chordColor(float idx) {
  float n = floor(stops + 0.5);
  float ii = clamp(idx, 0.0, n - 1.0);
  float ti = n > 1.5 ? ii / (n - 1.0) : 0.0;
  float off = 0.0;
  if (harmony == 1) off = (ti - 0.5) * spread * 0.4;                 // analogous (adjacent hues)
  else if (harmony == 2) off = mod(ii, 2.0) < 0.5 ? 0.0 : 0.5;       // complementary (180deg)
  else if (harmony == 3) off = mod(ii, 3.0) / 3.0;                   // triad (120deg)
  else if (harmony == 4) { float m = mod(ii, 3.0); off = m < 0.5 ? 0.0 : (m < 1.5 ? 0.42 : 0.58); } // split-comp
  else off = mod(ii, 4.0) * 0.25;                                    // tetrad (90deg)
  float hue = fract(baseHue + off);
  float val = mix(0.06, 1.0, ti);          // dark shadows → light highlights
  float sat = chroma * mix(1.0, 0.55, ti); // ease saturation up top (matte)
  return hsv2rgb(vec3(hue, sat, val));
}

vec3 stopColor(float idx) {
  if (harmony >= 1) return chordColor(idx); // colour-chord mode overrides the manual stops
  if (idx < 0.5) return colorA.rgb;
  if (idx < 1.5) return colorB.rgb;
  if (idx < 2.5) return colorC.rgb;
  if (idx < 3.5) return colorD.rgb;
  return colorE.rgb;
}

float lumaAt(vec2 c) {
  vec4 s = IMG_NORM_PIXEL(inputImage, c);
  return dot(s.rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = isf_FragNormCoord;

  if (PASSINDEX == 0) {
    // Downsampled luma with temporal smoothing — feeds auto-levels. The
    // 0.92 lerp keeps level estimates from pumping with flicker content.
    float l = lumaAt(uv);
    float prev = IMG_NORM_PIXEL(lumBuf, uv).r;
    gl_FragColor = vec4(mix(l, prev, 0.92), 0.0, 0.0, 1.0);
    return;
  }

  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float l = clamp(dot(src.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);

  // Luma sharpen BEFORE the map — detail survives even hard 2-stop palettes.
  if (sharpen > 0.001) {
    vec2 px = 1.0 / RENDERSIZE;
    vec2 cl = uv + vec2(-px.x, 0.0);
    vec2 cr = uv + vec2(px.x, 0.0);
    vec2 cu = uv + vec2(0.0, px.y);
    vec2 cd = uv + vec2(0.0, -px.y);
    float blur = (lumaAt(cl) + lumaAt(cr) + lumaAt(cu) + lumaAt(cd)) * 0.25;
    l = clamp(l + (l - blur) * sharpen, 0.0, 1.0);
  }

  // AUTO-LEVELS: estimate the frame's smoothed min/max from the small buffer
  // (36 taps) and stretch luminance to span the palette fully.
  if (autoLevel > 0.001) {
    float mn = 1.0;
    float mx = 0.0;
    for (int j = 0; j < 6; j++) {
      for (int i = 0; i < 6; i++) {
        vec2 p = (vec2(float(i), float(j)) + 0.5) / 6.0;
        float s = IMG_NORM_PIXEL(lumBuf, p).r;
        mn = min(mn, s);
        mx = max(mx, s);
      }
    }
    float stretched = clamp((l - mn) / max(mx - mn, 0.05), 0.0, 1.0);
    l = mix(l, stretched, autoLevel);
  }

  // Tone gamma shapes WHERE the palette stops land on the image.
  l = pow(l, gamma);

  // Ordered-dither breakup before the map.
  float n = floor(stops + 0.5);
  l += (bayer4(gl_FragCoord.xy) - 0.5) * dither / max(n - 1.0, 1.0);
  l = clamp(l, 0.0, 1.0);

  // The palette map.
  float t = l * (n - 1.0);
  float i = floor(min(t, n - 1.001));
  float f = fract(t);
  float k = mix(step(0.5, f), f, blend);
  vec3 col = mix(stopColor(i), stopColor(i + 1.0), k);

  // Source color mix-back, then the finishing chain.
  col = mix(col, src.rgb, mixSrc);
  col = (col - 0.5) * contrast + 0.5;
  float l2 = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l2), col, saturation);

  // SPLIT-TONE: multiplicative tints (0.5-grey = neutral), shadows and
  // highlights independently, crossing at the mids.
  if (splitTone > 0.001) {
    vec3 sh = col * (shadowTint.rgb * 2.0);
    vec3 hi = col * (highTint.rgb * 2.0);
    float zone = smoothstep(0.25, 0.75, clamp(l2, 0.0, 1.0));
    col = mix(col, mix(sh, hi, zone), splitTone);
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
}
