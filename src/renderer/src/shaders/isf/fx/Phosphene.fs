/*{
  "DESCRIPTION": "Phosphene — the retinal afterimage that gives the instrument its name (palinopsia), and a homage to Maxime Corbeil-Perron's 'Phosphènes'. A bright stimulus burns a lingering COMPLEMENTARY-colour negative ghost into a persistent buffer that slowly decays — the afterimage itself, distinct from motion-trail feedback. Bounded (loop gain < 1) so it can never run away. No psychedelia.",
  "CREDIT": "Palinopsia (after Maxime Corbeil-Perron)",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Optical"],
  "INPUTS": [
    { "NAME": "inputImage",  "TYPE": "image" },
    { "NAME": "sensitivity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5,  "LABEL": "sensitivity" },
    { "NAME": "persistence", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6,  "LABEL": "persistence" },
    { "NAME": "strength",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6,  "LABEL": "ghost" },
    { "NAME": "complement",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0,  "LABEL": "complement" },
    { "NAME": "threshold",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55, "LABEL": "threshold" }
  ],
  "PASSES": [
    { "TARGET": "buf", "PERSISTENT": true },
    { }
  ]
}*/

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

void main() {
  vec2 uv = isf_FragNormCoord;

  if (PASSINDEX == 0) {
    // ── Charge / decay the afterimage buffer ──
    vec3 src = IMG_NORM_PIXEL(inputImage, uv).rgb;
    vec3 prev = IMG_NORM_PIXEL(buf, uv).rgb;
    float lum = dot(src, LUMA);

    // A stimulus brighter than the threshold burns an afterimage whose colour is
    // the physiological COMPLEMENT (negative) of the stimulus, blended toward a
    // plain luminance-negative by (1 - complement).
    float bright = smoothstep(threshold, 1.0, lum);
    vec3 comp = mix(vec3(1.0 - lum), 1.0 - src, complement);
    vec3 imprint = comp * bright * (0.3 + sensitivity);

    // Persistence → slower fade. max() lets a fresh flash re-arm the ghost while
    // it otherwise bleeds down by decay — a lingering trail, never runaway.
    float decay = mix(0.90, 0.996, persistence);
    vec3 acc = max(prev * decay, imprint);
    gl_FragColor = vec4(clamp(acc, 0.0, 1.0), 1.0);
  } else {
    // ── Screen the lingering ghost over the live image ──
    vec3 src = IMG_NORM_PIXEL(inputImage, uv).rgb;
    vec3 ghost = IMG_NORM_PIXEL(buf, uv).rgb;
    vec3 outc = 1.0 - (1.0 - src) * (1.0 - ghost * strength);
    gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
  }
}
