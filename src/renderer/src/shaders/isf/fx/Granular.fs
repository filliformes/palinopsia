/*{
  "DESCRIPTION": "Granular : video granular synthesis (after Forbes & Villegas): the frame is shattered into a grid of Hann-windowed grains, each rotated, scattered and scaled on its own, then resynthesised. A persistent buffer lets grains bleed from the previous frame (temporal smear / echo). Density thins the grain field so the smear shows through the gaps. Matte, glitch-native : the granular texture is the point.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Texture"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "grain",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.45, "LABEL": "grain size" },
    { "NAME": "density", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.85 },
    { "NAME": "scatter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25 },
    { "NAME": "rotate",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2 },
    { "NAME": "smear",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3,  "LABEL": "temporal smear" },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0, "MAX": 20.0,"DEFAULT": 0.6 }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;

  if (PASSINDEX == 0) {
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    // Grain cell size in normalized units : big grains → fine grains.
    float cell = mix(0.22, 0.03, grain);
    // Stepped grain clock: the grain field re-rolls its jitter in cuts.
    float tk = floor(TIME * (0.5 + rate * 3.0));

    vec2 g = vec2(uv.x * aspect, uv.y) / cell;
    vec2 baseCell = floor(g);

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 c = baseCell + vec2(float(i), float(j));
        // Sparse field: a density-sized fraction of grains are active.
        if (hash(c * 1.7 + tk * 0.13) > density) continue;
        float ang = (hash(c + 3.1) - 0.5) * rotate * 6.2832;
        vec2 off = (vec2(hash(c + 5.0), hash(c + 9.0)) - 0.5) * scatter;
        // Grain centre in uv space; window weight by distance to it.
        vec2 centre = (c + 0.5) * cell;
        centre.x /= aspect;
        vec2 d = (uv - centre) * vec2(aspect, 1.0) / cell;
        float dist = length(d);
        if (dist > 1.0) continue;
        float w = 0.5 + 0.5 * cos(dist * 3.14159); // Hann window
        // Sample the source, rotated about the grain centre and offset.
        float cs = cos(ang), sn = sin(ang);
        vec2 rel = (uv - centre) * vec2(aspect, 1.0);
        rel = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs);
        rel.x /= aspect;
        vec2 sp = centre + rel + vec2(off.x / aspect, off.y) * cell;
        vec4 live = IMG_NORM_PIXEL(inputImage, sp);
        vec4 prev = IMG_NORM_PIXEL(buf, sp);
        acc += mix(live.rgb, prev.rgb, smear) * w;
        wsum += w;
      }
    }

    // Gaps in the grain field show the smeared background.
    vec4 bg = IMG_NORM_PIXEL(buf, uv);
    vec4 lv = IMG_NORM_PIXEL(inputImage, uv);
    vec3 outc = wsum > 0.001 ? acc / wsum : mix(lv.rgb, bg.rgb, smear);
    gl_FragColor = vec4(outc, 1.0);
  } else {
    gl_FragColor = IMG_NORM_PIXEL(buf, uv);
  }
}
