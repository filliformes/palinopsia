/*{
  "DESCRIPTION": "Ramps : analog-style voltage ramps: a clean gradient signal (horizontal / vertical / diagonal / radial / diamond), optionally stepped into bands, mirrored into a seamless rise-and-fall, and slowly scrolling. At freq 1 one ramp runs exactly edge to edge (or center to farthest corner) at any aspect and angle, so a lumakey wipe against it reveals one clean front. The raw material of analog video synthesis : feed it into Colorizer or key against it. Matte.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Scan"],
  "INPUTS": [
    { "NAME": "shape", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["horizontal", "vertical", "diagonal", "radial", "diamond"], "DEFAULT": 0 },
    { "NAME": "freq",  "TYPE": "float", "MIN": 0.5, "MAX": 12.0, "DEFAULT": 1.0 },
    { "NAME": "steps", "TYPE": "float", "MIN": 1.0, "MAX": 32.0, "DEFAULT": 1.0 },
    { "NAME": "rate",  "TYPE": "float", "MIN": -20.0, "MAX": 20.0,  "DEFAULT": 0.2 },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0 },
    { "NAME": "mirror", "TYPE": "bool", "DEFAULT": false, "LABEL": "mirror (triangle)" },
    { "NAME": "center", "TYPE": "point2D", "MIN": [0.0, 0.0], "MAX": [1.0, 1.0], "DEFAULT": [0.5, 0.5] },
    { "NAME": "tint",  "TYPE": "color", "DEFAULT": [0.7, 0.72, 0.68, 1.0] }
  ]
}*/

// ∫ rate dt : the scroll follows a moving rate without jumping (engine-integrated).
uniform float PH_rate;

// Rotate a centered, aspect-scaled offset into the ramp's frame.
vec2 rot(vec2 c, float cs, float sn) {
  return vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 A = vec2(aspect, 1.0);
  float cs = cos(angle), sn = sin(angle);

  float v;
  if (shape <= 2) {
    // Linear ramps : project onto the ramp direction and divide by the frame's
    // own extent along it, so 0..1 spans exactly edge to edge (corner to corner
    // for the diagonal) at any aspect and angle : no seam inside the frame.
    vec2 c = (uv - 0.5) * A;
    vec2 d = shape == 0 ? vec2(cs, -sn) : (shape == 1 ? vec2(sn, cs) : vec2(cs + sn, cs - sn));
    v = dot(c, d) / (abs(d.x) * aspect + abs(d.y)) + 0.5;
  } else {
    // Radial / diamond around `center`, normalized by the farthest frame corner
    // so 0..1 runs from the center to that corner.
    vec2 c = rot((uv - center) * A, cs, sn);
    float far = 0.0;
    for (int k = 0; k < 4; k++) {
      vec2 corner = vec2(k == 1 || k == 3 ? 1.0 : 0.0, k >= 2 ? 1.0 : 0.0);
      vec2 q = rot((corner - center) * A, cs, sn);
      far = max(far, shape == 3 ? length(q) : abs(q.x) + abs(q.y));
    }
    v = (shape == 3 ? length(c) : abs(c.x) + abs(c.y)) / max(far, 1e-4);
  }

  // Scroll : wrap the (unbounded) phase first so the ramp keeps full precision.
  v = fract(v * freq + fract(PH_rate * 0.2));
  // Mirror : fold the saw into a triangle (a rise and fall, no hard seam).
  if (mirror) v = 1.0 - abs(2.0 * v - 1.0);
  // Stepped ramp : a whole number of evenly spaced levels from 0 to 1.
  float n = floor(max(steps, 1.0));
  if (n > 1.5) v = min(floor(v * n), n - 1.0) / (n - 1.0);

  vec3 base = vec3(0.02, 0.02, 0.025);
  gl_FragColor = vec4(base + tint.rgb * clamp(v, 0.0, 1.0), 1.0);
}
