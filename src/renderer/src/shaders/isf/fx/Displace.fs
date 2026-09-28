/*{
  "DESCRIPTION": "Displace : drifting value-noise domain warp of the sampling coordinates. Asymmetric displacement (brief §1's preferred feedback discipline), never radial. The noise cells are square at any frame shape; reads past the frame edge are mirrored back in.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Distortion"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.03 },
    { "NAME": "scale",  "TYPE": "float", "MIN": 0.5, "MAX": 12.0, "DEFAULT": 3.0 },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.15 }
  ]
}*/

// Integrated phases (engine/phases.ts) : a knob change moves the picture on
// from where it is instead of jumping it.
uniform float PH_rate;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // Hoskins hash : no rows, no lattice over hours
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise on a lattice that tiles every 1024 cells, so the drift offset
// can wrap at 1024 without a seam and the coordinates stay small (precise)
// however long the show runs.
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, 1024.0);
  vec2 i1 = mod(i + 1.0, 1024.0);
  float a = hash(i0);
  float b = hash(vec2(i1.x, i0.y));
  float c = hash(vec2(i0.x, i1.y));
  float d = hash(i1);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float t = mod(PH_rate, 1024.0);
  // Square cells : `scale` cells per frame height at every frame shape (they
  // were 1.78× wider than tall at 16:9 and square only on the dome).
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * scale;
  vec2 disp = vec2(
    vnoise(p + vec2(t, 7.3)) - 0.5,
    vnoise(p.yx + vec2(13.1, -t)) - 0.5
  );
  vec2 c = uv + disp * amount * 2.0;
  // Reads past the frame edge mirror back in (the clamp smeared the edge row
  // into bands up to 20% wide at high amounts).
  c = 1.0 - abs(1.0 - mod(c, 2.0));
  gl_FragColor = IMG_NORM_PIXEL(inputImage, c);
}
