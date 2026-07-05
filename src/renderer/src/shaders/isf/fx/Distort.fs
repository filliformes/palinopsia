/*{
  "DESCRIPTION": "Distort — ten warp modes on one control set (amount · scale · center · angle · rate): WAVE (sine ripple), RIPPLE (concentric, from center), BULGE / PINCH (spherize out/in), SWIRL (twist around center), SHEAR (position-dependent skew), GLASS (cell-refracted textured glass), CORRUGATE (accordion ribs along angle), PULL (directional drag from center), TURBULENT (curl-noise domain warp). The compositional bend/warp tool.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Distortion"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "mode", "TYPE": "long",
      "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      "LABELS": ["wave", "ripple", "bulge", "pinch", "swirl", "shear", "glass", "corrugate", "pull", "turbulent"],
      "DEFAULT": 0 },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.3 },
    { "NAME": "scale",  "TYPE": "float", "MIN": 0.5, "MAX": 20.0,   "DEFAULT": 4.0 },
    { "NAME": "center", "TYPE": "point2D", "DEFAULT": [0.5, 0.5] },
    { "NAME": "angle",  "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0 },
    { "NAME": "rate",   "TYPE": "float", "MIN": 0.0, "MAX": 5.0,    "DEFAULT": 0.5 }
  ]
}*/

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 3; k++) { s += a * vnoise(p); p = p * 2.03 + 5.1; a *= 0.5; }
  return s;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float t = TIME * rate;
  float amt = amount;
  // Aspect-corrected vector from the center (radial modes work in this space).
  vec2 p = uv - center;
  p.x *= aspect;
  float r = length(p);

  vec2 c = uv; // the coordinate we sample from

  // Direction / perpendicular from `angle`, shared by the oriented modes.
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 perp = vec2(-dir.y, dir.x);

  if (mode == 0) {
    // WAVE — a 2D sine wave oriented along `angle`, its phase measured from
    // `center` (moving the pad shifts the nodes; angle turns the grain).
    vec2 rel = uv - center;
    float along = dot(rel, dir);
    float across = dot(rel, perp);
    float d1 = sin(across * scale * 6.2832 + t);
    float d2 = sin(along * scale * 6.2832 + t * 1.3);
    c = uv + (dir * d1 + perp * d2) * 0.06 * amt;
  } else if (mode == 1) {
    // RIPPLE — concentric rings travelling out from the center.
    float ring = sin(r * scale * 6.2832 - t * 3.0);
    vec2 dir = p / max(r, 1e-4);
    dir.x /= aspect;
    c = uv + dir * ring * 0.05 * amt;
  } else if (mode == 2) {
    // BULGE — spherize outward (magnify the centre) inside a radius.
    float rad = 0.9;
    float rn = clamp(r / rad, 0.0, 1.0);
    float rr = pow(rn, mix(1.0, 0.25, amt)) * rad;
    vec2 pr = (p / max(r, 1e-4)) * rr;
    pr.x /= aspect;
    c = center + pr;
  } else if (mode == 3) {
    // PINCH — spherize inward (squeeze toward the centre).
    float rad = 0.9;
    float rn = clamp(r / rad, 0.0, 1.0);
    float rr = pow(rn, mix(1.0, 3.5, amt)) * rad;
    vec2 pr = (p / max(r, 1e-4)) * rr;
    pr.x /= aspect;
    c = center + pr;
  } else if (mode == 4) {
    // SWIRL — twist around the centre, falloff tightened by scale.
    float ang = amt * 6.2832 * exp(-r * r * scale);
    float cs = cos(ang), sn = sin(ang);
    vec2 pr = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
    pr.x /= aspect;
    c = center + pr;
  } else if (mode == 5) {
    // SHEAR — skew ⟂ `angle`, proportional to distance from `center` along it
    // (center is the shear pivot — the line that stays put).
    float along = dot(uv - center, dir);
    c = uv + perp * along * amt * 2.0;
  } else if (mode == 6) {
    // GLASS — cell-refracted textured glass. The tile grid is rotated by
    // `angle` and originates at `center`, so the panes turn and shift.
    vec2 rel = uv - center;
    rel.x *= aspect;
    vec2 g = vec2(rel.x * dir.x + rel.y * dir.y, -rel.x * dir.y + rel.y * dir.x); // rotate −angle
    vec2 cells = vec2(scale) * 2.0;
    vec2 cell = floor(g * cells);
    vec2 off = (hash22(cell) - 0.5) * 0.12 * amt;
    vec2 f = fract(g * cells) - 0.5;
    off *= 1.0 - dot(f, f) * 1.5;
    // rotate the offset back into uv space, undo aspect
    vec2 offW = vec2(off.x * dir.x - off.y * dir.y, off.x * dir.y + off.y * dir.x);
    offW.x /= aspect;
    c = uv + offW;
  } else if (mode == 7) {
    // CORRUGATE — accordion ribs along `angle`, phase measured from `center`.
    float along = dot(uv - center, dir) * scale;
    float tri = abs(fract(along) * 2.0 - 1.0);
    c = uv + perp * (tri - 0.5) * 0.1 * amt;
  } else if (mode == 8) {
    // PULL — directional drag from `center` along `angle`, strong near the
    // point and fading out (a smear-warp handle).
    float pull = amt * 0.35 / (r * scale + 1.0);
    c = uv - dir * pull;
  } else {
    // TURBULENT — curl-noise domain warp. The field is rotated by `angle`
    // and sampled about `center`, with a soft radial emphasis so the pad
    // point is the eye of the turbulence.
    vec2 rel = uv - center;
    rel.x *= aspect;
    vec2 dom = vec2(rel.x * dir.x + rel.y * dir.y, -rel.x * dir.y + rel.y * dir.x) * scale
             + vec2(t * 0.3, -t * 0.2);
    vec2 flow = vec2(fbm(dom), fbm(dom + vec2(5.2, 1.3))) - 0.5;
    vec2 curl = vec2(-flow.y, flow.x);
    vec2 curlW = vec2(curl.x * dir.x - curl.y * dir.y, curl.x * dir.y + curl.y * dir.x);
    curlW.x /= aspect;
    float w = 0.55 + 0.45 * exp(-r * r * 1.5);
    c = uv + curlW * 0.2 * amt * w;
  }

  c = clamp(c, 0.0, 1.0);
  gl_FragColor = IMG_NORM_PIXEL(inputImage, c);
}
