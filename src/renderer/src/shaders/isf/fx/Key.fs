/*{
  "DESCRIPTION": "Key : cuts part of the picture to transparency, so the layers below show through. MODE : COLOR keys out one color (a green or blue cloth, a colored costume, a projected color : pick it in KEY COLOR) by its distance in the color plane, with DESPILL taking that color's cast off what stays; SATURATION keeps the colored things and cuts the grays (a subject on a white wall, a feed on a gray stage); EDGES keeps only the outlines, as a glowing-free line matte; CHANNEL makes one channel the transparency (brightness, red, green, blue or the picture's own alpha). TOLERANCE is where the cut lies, SOFTNESS how wide its edge is. CHOKE eats the matte in (or grows it out, below 0), FEATHER softens its edge. INVERT keeps what was cut. SHOW MATTE draws the matte in white on black to set it up. Per pixel, nine reads.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Utility", "Key"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "mode", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["color", "saturation", "edges", "channel"], "DEFAULT": 0, "LABEL": "mode" },
    { "NAME": "color", "TYPE": "color", "DEFAULT": [0.1, 0.72, 0.28, 1.0], "LABEL": "key color" },
    { "NAME": "channel", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["brightness", "red", "green", "blue", "alpha"], "DEFAULT": 0, "LABEL": "channel" },
    { "NAME": "tolerance", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "tolerance" },
    { "NAME": "softness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "softness" },
    { "NAME": "despill", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "despill" },
    { "NAME": "choke", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "choke" },
    { "NAME": "feather", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "feather" },
    { "NAME": "invert", "TYPE": "bool", "DEFAULT": false, "LABEL": "invert", "COMPACT": true },
    { "NAME": "showMatte", "TYPE": "bool", "DEFAULT": false, "LABEL": "show matte", "COMPACT": true },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" }
  ]
}*/

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

// The color plane : Cb / Cr (BT.601), brightness left out, so the shadows and
// folds of a green cloth key with its lit parts.
vec2 chromaOf(vec3 c) {
  return vec2(dot(c, vec3(-0.168736, -0.331264, 0.5)), dot(c, vec3(0.5, -0.418688, -0.081312)));
}

// How much of a pixel STAYS (1) or goes (0), before choke / feather. `l` is the
// brightness spread over the ring around it (the edge mode's local contrast).
float keepOf(vec4 s, float spread) {
  vec3 c = s.rgb;
  float lo = tolerance;
  float hi = tolerance + max(softness, 0.002) * 0.6;
  if (mode == 0) {
    // the angle off the key's hue in the color plane (0 = the key, 1 = its
    // opposite), so a cloth keys in its deep folds and its lit parts alike, a
    // paler or richer shade of it too; a near-gray pixel is never the key
    vec2 k = chromaOf(color.rgb);
    vec2 kd = k / max(length(k), 1e-4);
    vec2 ch = chromaOf(c);
    float along = dot(ch, kd);
    float perp = length(ch - kd * along);
    float ang = atan(perp, along) / 3.1415927;
    float cut = 1.0 - smoothstep(lo * 0.5, lo * 0.5 + max(softness, 0.002) * 0.3, ang);
    return 1.0 - cut * smoothstep(0.015, 0.06, along);
  }
  if (mode == 1) {
    float mx = max(c.r, max(c.g, c.b));
    float sat = mx > 0.0 ? (mx - min(c.r, min(c.g, c.b))) / mx : 0.0;
    return smoothstep(lo, hi + 0.001, sat * smoothstep(0.02, 0.12, mx));
  }
  if (mode == 2) return smoothstep(lo * 0.5, hi * 0.5 + 0.001, spread);
  float v = channel == 1 ? c.r : channel == 2 ? c.g : channel == 3 ? c.b : channel == 4 ? s.a : dot(c, LUMA);
  return smoothstep(lo, hi + 0.001, v);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  // The ring the matte is choked and feathered over, in 1080p pixels (it scales
  // with the output, so 4K and the dome key alike).
  float px = max(1.0, floor(RENDERSIZE.y / 1080.0 + 0.5));
  float rad = (1.0 + 5.0 * abs(choke) + 6.0 * feather) * px;
  vec2 st = rad / RENDERSIZE;
  // Eight taps on a ring, read once, outside every branch (D3D flattens a
  // texture read inside one).
  vec2 o0 = uv + vec2(st.x, 0.0);
  vec2 o1 = uv + vec2(-st.x, 0.0);
  vec2 o2 = uv + vec2(0.0, st.y);
  vec2 o3 = uv + vec2(0.0, -st.y);
  vec2 o4 = uv + st * 0.7071;
  vec2 o5 = uv - st * 0.7071;
  vec2 o6 = uv + vec2(st.x, -st.y) * 0.7071;
  vec2 o7 = uv + vec2(-st.x, st.y) * 0.7071;
  vec4 s0 = IMG_NORM_PIXEL(inputImage, o0);
  vec4 s1 = IMG_NORM_PIXEL(inputImage, o1);
  vec4 s2 = IMG_NORM_PIXEL(inputImage, o2);
  vec4 s3 = IMG_NORM_PIXEL(inputImage, o3);
  vec4 s4 = IMG_NORM_PIXEL(inputImage, o4);
  vec4 s5 = IMG_NORM_PIXEL(inputImage, o5);
  vec4 s6 = IMG_NORM_PIXEL(inputImage, o6);
  vec4 s7 = IMG_NORM_PIXEL(inputImage, o7);

  // EDGES : the brightness spread over the ring (dilation minus erosion), a
  // morphological edge that widens with the ring.
  float l0 = dot(src.rgb, LUMA);
  float lmx = max(max(max(dot(s0.rgb, LUMA), dot(s1.rgb, LUMA)), max(dot(s2.rgb, LUMA), dot(s3.rgb, LUMA))),
                  max(max(dot(s4.rgb, LUMA), dot(s5.rgb, LUMA)), max(dot(s6.rgb, LUMA), dot(s7.rgb, LUMA))));
  float lmn = min(min(min(dot(s0.rgb, LUMA), dot(s1.rgb, LUMA)), min(dot(s2.rgb, LUMA), dot(s3.rgb, LUMA))),
                  min(min(dot(s4.rgb, LUMA), dot(s5.rgb, LUMA)), min(dot(s6.rgb, LUMA), dot(s7.rgb, LUMA))));
  float spread = max(lmx, l0) - min(lmn, l0);

  float m = keepOf(src, spread);
  float r0 = keepOf(s0, spread), r1 = keepOf(s1, spread), r2 = keepOf(s2, spread), r3 = keepOf(s3, spread);
  float r4 = keepOf(s4, spread), r5 = keepOf(s5, spread), r6 = keepOf(s6, spread), r7 = keepOf(s7, spread);
  if (mode != 2) {
    // CHOKE : toward the ring's least (eat in) or most (grow out); FEATHER :
    // toward its mean (a soft edge).
    float rmn = min(min(min(r0, r1), min(r2, r3)), min(min(r4, r5), min(r6, r7)));
    float rmx = max(max(max(r0, r1), max(r2, r3)), max(max(r4, r5), max(r6, r7)));
    float avg = (m * 2.0 + r0 + r1 + r2 + r3 + r4 + r5 + r6 + r7) / 10.0;
    m = choke > 0.0 ? mix(m, min(m, rmn), choke) : mix(m, max(m, rmx), -choke);
    m = mix(m, avg, feather);
  } else {
    m = mix(m, smoothstep(0.0, 1.0, m), feather);
  }
  if (invert) m = 1.0 - m;
  m = clamp(m, 0.0, 1.0);

  // DESPILL (color mode) : take the key color's cast off what stays : the part
  // of the pixel's color that points the key's way in the color plane, removed
  // as far as the key reaches into it, brightness kept.
  vec3 col = src.rgb;
  if (mode == 0 && despill > 0.0) {
    vec2 k = chromaOf(color.rgb);
    float kl = length(k);
    if (kl > 0.02) {
      vec2 kd = k / kl;
      vec2 ch = chromaOf(col);
      // only the excess : the part along the key beyond what the color's own
      // hue explains (cyan keeps its green, a green-lit edge loses its cast)
      float along = dot(ch, kd);
      float spill = max(along - length(ch - kd * along) * 0.8, 0.0);
      vec2 ch2 = ch - kd * spill * despill;
      float y = dot(col, LUMA);
      // YCbCr back to RGB
      col = clamp(vec3(y + 1.402 * ch2.y, y - 0.344136 * ch2.x - 0.714136 * ch2.y, y + 1.772 * ch2.x), 0.0, 1.0);
    }
  }

  if (showMatte) {
    gl_FragColor = mix(src, vec4(vec3(m), 1.0), amount);
    return;
  }
  gl_FragColor = mix(src, vec4(col, src.a * m), amount);
}
