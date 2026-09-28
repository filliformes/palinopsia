/*{
  "DESCRIPTION": "Phosphene : the retinal afterimage that gives the instrument its name (palinopsia). A bright stimulus burns a lingering COMPLEMENTARY-color ghost into a persistent buffer that decays all the way back to black : a saturated color leaves its vivid negative (red → cyan), white or a pale color leaves a pale neutral ghost. The afterimage itself, distinct from motion-trail feedback. Bounded (loop gain < 1) so it can never run away. No psychedelia.",
  "CREDIT": "Palinopsia",
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

// Hoskins hash, whole-number inputs (pixel, frame).
float hash31(vec3 p) {
  vec3 p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = isf_FragNormCoord;

  if (PASSINDEX == 0) {
    // ── Charge / decay the afterimage buffer ──
    vec3 src = IMG_NORM_PIXEL(inputImage, uv).rgb;
    vec3 prev = IMG_NORM_PIXEL(buf, uv).rgb;
    float lum = dot(src, LUMA);

    // A stimulus brighter than the threshold burns an afterimage whose color is
    // the physiological COMPLEMENT (negative) of the stimulus. The negative of
    // white is black, which a screened ghost cannot show, so the less saturated
    // the stimulus the more a pale neutral ghost takes over (a white flash
    // leaves a gray-white afterglow; a saturated color keeps its vivid negative).
    // (1 - complement) blends toward a plain luminance ghost.
    float bright = smoothstep(min(threshold, 0.98), 1.0, lum);
    float sat = max(src.r, max(src.g, src.b)) - min(src.r, min(src.g, src.b));
    vec3 hueNeg = (1.0 - src) + 0.35 * (1.0 - sat) * (1.0 - sat);
    vec3 lumNeg = vec3(max(1.0 - lum, 0.35));
    vec3 comp = mix(lumNeg, hueNeg, complement);
    vec3 imprint = min(comp, 1.0) * bright * (0.3 + sensitivity);

    // Persistence → the ghost's time constant, log-spaced from 0.17 s to 4.2 s
    // (the same two ends as the old per-frame factor 0.90 → 0.996 at 60 fps;
    // 0.6 ≈ 1.2 s) and taken on the clock, so the fade does not depend on the
    // frame rate. The buffer is 8-bit : a plain prev*decay stops a few steps
    // above black (0.5 / (1 - decay) steps) and burns in for good. So the fade
    // is taken in whole 1/255 steps, DITHERED per pixel and frame : on average
    // exactly the exponential fade, and a faint ghost still steps down now and
    // then, all the way to black. max() lets a fresh flash re-arm the ghost : a
    // lingering trail, never runaway.
    float tau = 0.1667 * pow(25.0, persistence);
    float decay = exp(-clamp(TIMEDELTA, 0.0, 0.133) / tau);
    float dz = hash31(vec3(floor(gl_FragCoord.xy), mod(float(FRAMEINDEX), 4096.0)));
    vec3 steps = floor(prev * (1.0 - decay) * 255.0 + dz);
    vec3 faded = max(prev - steps / 255.0, 0.0);
    vec3 acc = max(faded, imprint);
    gl_FragColor = vec4(clamp(acc, 0.0, 1.0), 1.0);
  } else {
    // ── Screen the lingering ghost over the live image ──
    // Straight alpha : over an opaque layer the ghost is screened in (the old
    // picture); over transparency the ghost stands alone with its own
    // coverage, so a transparent layer never turns into a black card.
    vec4 s = IMG_NORM_PIXEL(inputImage, uv);
    vec3 g = IMG_NORM_PIXEL(buf, uv).rgb * strength;
    vec3 scr = 1.0 - (1.0 - s.rgb) * (1.0 - g);
    float gm = max(g.r, max(g.g, g.b));
    float a = s.a + (1.0 - s.a) * gm;
    vec3 prem = s.a * scr + (1.0 - s.a) * g;
    vec3 col = a > 0.0 ? prem / a : vec3(0.0);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), a);
  }
}
