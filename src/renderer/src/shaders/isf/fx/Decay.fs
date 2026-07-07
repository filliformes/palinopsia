/*{
  "DESCRIPTION": "Decay — generation loss / hauntology: a feedback loop that ACCUMULATES degradation. Each frame the fed-back image is re-softened, desaturated and pocked with dropout holes, then blended back with the fresh frame — so the picture disintegrates over generations (tape dubbing, Basinski, Decasia), rather than a single static VHS pass. amount = how much the degraded past dominates; wobble adds generational instability.",
  "CREDIT": "Palinopsia (after Basinski / Decasia)",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount",  "TYPE": "float", "MIN": 0.0, "MAX": 0.99, "DEFAULT": 0.7,  "LABEL": "amount" },
    { "NAME": "soften",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4,  "LABEL": "soften" },
    { "NAME": "bleed",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.4,  "LABEL": "bleed" },
    { "NAME": "dropout", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.25, "LABEL": "dropout" },
    { "NAME": "wobble",  "TYPE": "float", "MIN": 0.0, "MAX": 0.02, "DEFAULT": 0.004,"LABEL": "wobble" }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

float dhash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    // Generational instability: a slow, spatially-varying wobble of the fed-back
    // image, plus a soften (5-tap) so each pass loses a little sharpness.
    vec2 drift = vec2(sin(TIME * 1.3 + uv.y * 20.0), cos(TIME * 1.1 + uv.x * 18.0)) * wobble;
    float r = soften * 0.004;
    vec2 sc0 = uv + drift;
    vec2 scL = sc0 + vec2(-r, 0.0);
    vec2 scR = sc0 + vec2(r, 0.0);
    vec2 scU = sc0 + vec2(0.0, r);
    vec2 scD = sc0 + vec2(0.0, -r);
    vec3 prev = (IMG_NORM_PIXEL(buf, sc0).rgb * 2.0
      + IMG_NORM_PIXEL(buf, scL).rgb + IMG_NORM_PIXEL(buf, scR).rgb
      + IMG_NORM_PIXEL(buf, scU).rgb + IMG_NORM_PIXEL(buf, scD).rgb) / 6.0;

    // Colour rot: pull the fed-back frame toward its luma (bleed) and crush a
    // touch of contrast so repeated passes wash out.
    float lp = dot(prev, vec3(0.299, 0.587, 0.114));
    prev = mix(prev, vec3(lp), bleed * 0.6);
    prev *= 0.985;

    // Dropout: sparse dark holes that flicker on a coarse grid (film decay).
    float fl = step(1.0 - dropout * 0.5, dhash(floor(uv * vec2(120.0, 90.0)) + floor(TIME * 8.0)));
    prev *= (1.0 - fl);

    vec3 live = IMG_NORM_PIXEL(inputImage, uv).rgb;
    gl_FragColor = vec4(mix(live, prev, amount), 1.0);
  } else {
    gl_FragColor = IMG_NORM_PIXEL(buf, uv);
  }
}
