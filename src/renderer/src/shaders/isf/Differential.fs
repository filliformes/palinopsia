/*{
  "DESCRIPTION": "Differential : visual polyrhythm by differential motion. Several wave trains share one field; layer k runs at rate × (1 + k × (ratio − 1)), so their phases drift against each other and beat like nested rhythms (whole-number ratios lock into repeating cycles, in-between ratios never quite repeat). Rendered as even-width contour lines of the summed field : matte topographic bands that pulse in and out of alignment. SKEW fans the layers inside a narrow angle, so it stays asymmetric (never radial or kaleidoscopic). AUDIO lets each layer swell with its own band of the spectrum, bass on the slowest layer.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry"],
  "INPUTS": [
    { "NAME": "count",     "TYPE": "float", "MIN": 2.0, "MAX": 8.0,  "DEFAULT": 4.0 },
    { "NAME": "ratio",     "TYPE": "float", "MIN": 1.0, "MAX": 3.0,  "DEFAULT": 2.0 },
    { "NAME": "rate",      "TYPE": "float", "MIN": 0.0, "MAX": 6.0,  "DEFAULT": 0.4 },
    { "NAME": "freq",      "TYPE": "float", "MIN": 0.5, "MAX": 12.0, "DEFAULT": 3.0 },
    { "NAME": "thickness", "TYPE": "float", "MIN": 0.02,"MAX": 0.5,  "DEFAULT": 0.12 },
    { "NAME": "lines",     "TYPE": "float", "MIN": 2.0, "MAX": 16.0, "DEFAULT": 6.0 },
    { "NAME": "skew",      "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.35 },
    { "NAME": "angle",     "TYPE": "float", "MIN": 0.0, "MAX": 6.2832,"DEFAULT": 0.4 },
    { "NAME": "audio",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0, "LABEL": "audio bands" },
    { "NAME": "tint",      "TYPE": "color", "DEFAULT": [0.82, 0.84, 0.8, 1.0] },
    { "NAME": "audioTex",  "TYPE": "image" }
  ]
}*/

// Layer k's phase = ∫ rate·(1 + k·(ratio − 1)) dt = PH_rate + k·PH_diffSpread
// (engine/phases.ts) : the harmonic speed series, integrated, so turning rate
// or ratio changes the speeds from here on and never jumps the picture.
uniform float PH_rate;
uniform float PH_diffSpread;

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float px = 1.0 / RENDERSIZE.y;

  // The fan : the layers spread over skew·1.15·(count − 1) radians, softly
  // capped below 90° (at most 1.45 rad) so evenly spread plane waves can never
  // close into a rosette.
  float spread = skew * 1.15 * max(count - 1.0, 1.0);
  float fan = spread < 1.0 ? spread : 1.0 + 0.45 * (1.0 - exp((1.0 - spread) / 0.45));

  // k is an integer, so both phases wrap at 2π seamlessly (keeps sin() precise).
  float ph0 = mod(PH_rate, 6.2832);
  float phK = mod(PH_diffSpread, 6.2832);
  float kf = freq * 6.2832;

  float field = 0.0;
  vec2 grad = vec2(0.0);   // analytic gradient of the field (for even line width)
  float amp = 1.0;
  float norm = 0.0;
  for (int k = 0; k < 8; k++) {
    float fk = float(k);
    // A fractional count fades the next layer in instead of popping it.
    float wgt = clamp(count - fk, 0.0, 1.0);
    if (wgt <= 0.0) break;
    float a = angle + fan * min(fk / max(count - 1.0, 1.0), 1.0);
    vec2 dir = vec2(cos(a), sin(a));
    float arg = dot(p, dir) * kf + ph0 + fk * phK;
    // AUDIO : this layer's own band of the (log-spaced) spectrum, bass first.
    vec2 bc = vec2((fk + 0.5) / max(count, 1.0), 0.75);
    float g = mix(1.0, 0.25 + 1.5 * IMG_NORM_PIXEL(audioTex, bc).r, audio);
    float A = amp * wgt * g;
    field += A * sin(arg);
    grad += A * cos(arg) * kf * dir;
    norm += amp * wgt;
    amp *= 0.82;
  }
  field /= max(norm, 0.001); // -1..1 (more with loud audio)
  grad /= max(norm, 0.001);

  // Contour lines of the summed field, at an even width in pixels : the
  // distance to the nearest contour is its field distance over the local
  // slope, so steep areas don't thin to broken dashes and flat ones don't
  // swell into blobs.
  // Every layer shares one wavenumber, so the field's curvature is simply
  // kf²·|field| : it keeps the tiny contour rings around a peak whole (a dot)
  // where the slope alone would split them into two specks.
  float s = field * lines * 0.5;
  float d = abs(fract(s + 0.5) - 0.5);                 // contour units, 0 on a line
  float G = length(grad) * lines * 0.5;                // contour units per frame height
  float curv = kf * kf * abs(field) * lines * 0.5;
  G = max(sqrt(G * G + curv * d), 1e-4);
  float dist = d / G;
  float hw = max(thickness * 0.055, 0.7 * px);
  hw = min(hw, 0.25 / G);                              // never fill more than half the gap
  float m = 1.0 - smoothstep(hw - 0.75 * px, hw + 0.75 * px, dist);

  vec3 base = vec3(0.02, 0.02, 0.025);
  gl_FragColor = vec4(base + tint.rgb * m, 1.0);
}
