/*{
  "DESCRIPTION": "Swell : an open water surface seen from above, no horizon. 24 wave trains spread around the wind DIRECTION, each travelling at the speed its length gives it on deep water (longer waves run faster, the ocean's dispersion law), so the surface builds, crosses and breaks up like the real thing instead of sliding. It is shaded the way water is : by its slopes, which reflect the brighter horizon sky (the tint) while flat water stays dark, with a subdued glint of sun at LIGHT ANGLE and foam on the sharpest crests. CHOP sets the steepness, SPREAD how far the waves fan from the wind (0 = one swell, 1 = confused sea).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Organic", "Noise"],
  "INPUTS": [
    { "NAME": "rate",      "TYPE": "float", "MIN": 0.0, "MAX": 4.0,    "DEFAULT": 0.6 },
    { "NAME": "scale",     "TYPE": "float", "MIN": 1.0, "MAX": 12.0,   "DEFAULT": 4.0 },
    { "NAME": "chop",      "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.4 },
    { "NAME": "direction", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.6 },
    { "NAME": "spread",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0,    "DEFAULT": 0.35 },
    { "NAME": "tint",      "TYPE": "color", "DEFAULT": [0.5, 0.62, 0.65, 1.0] },
    { "NAME": "lightAngle","TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 2.36, "LABEL": "light angle" }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = uv * vec2(aspect, 1.0) * scale;
  float t = TIME * rate;

  // Sum of wave trains : wavelengths spread log-uniformly, direction fanned
  // around the wind, speed from deep-water dispersion (omega = sqrt(g k)),
  // amplitude proportional to the wavelength (constant steepness).
  vec2 grad = vec2(0.0);
  vec3 hess = vec3(0.0); // d2h/dx2, d2h/dy2, d2h/dxdy
  for (int k = 0; k < 24; k++) {
    float fk = float(k);
    float r1 = og_hash(vec2(fk, 1.7)), r2 = og_hash(vec2(fk, 5.3)), r3 = og_hash(vec2(fk, 9.1));
    // Directions peak around the wind (a triangular stand-in for the cos²
    // spreading of a real sea) : a uniform fan puts waves at right angles and
    // the crests cross into a plaid.
    float r4 = og_hash(vec2(fk, 13.9));
    float ang = direction + (r1 + r4 - 1.0) * mix(0.6, 2.4, spread);
    vec2 d = vec2(cos(ang), sin(ang));
    float lam = exp(mix(-2.5, 0.5, r2));                 // 0.08 .. 1.65 (in scale units)
    float kk = 6.2832 / lam;
    float w = sqrt(9.8 * kk) * 0.35;
    // Steepness falls with the wavelength (a real sea spectrum : the long swell
    // carries the shape, short waves only texture it).
    float steep = (0.35 + chop * 1.3) * 0.06 * pow(lam, 0.12) * (0.6 + 0.8 * r3);
    float a = steep / kk;
    float ph = dot(d, p) * kk - w * t + r3 * 6.2832;
    float s = sin(ph), c = cos(ph);
    grad += a * kk * c * d;
    hess += -a * kk * kk * s * vec3(d.x * d.x, d.y * d.y, d.x * d.y);
  }
  // Capillary ripples on top : small, fast, everywhere (what keeps real water crisp).
  vec2 wind = vec2(cos(direction), sin(direction));
  // (rotated off the noise lattice : gradient-noise slopes carry faint
  //  grid-aligned artifacts that the slope shading would draw as a plaid)
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  vec3 nd = og_noised(rot * p * 22.0 + wind * t * 2.2);
  grad += (rot * nd.yz) * 0.0009 * (0.4 + chop);

  vec3 n = normalize(vec3(-grad, 1.0));
  // How water looks from above : mostly the dark body of the water, a faint
  // mirror of the sky (Fresnel, a little stronger on steep facets and toward
  // the horizon), and the sun's glitter : every facet tilted just right to
  // mirror the sun flashes. The glitter is what reads as water; it is kept to
  // pinpoints (matte register : no bloom).
  vec3 v = normalize(vec3(0.0, -0.3, 1.0));             // a slightly oblique look
  vec3 r = reflect(-v, n);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 sky = tint.rgb * mix(0.45, 1.1, 1.0 - clamp(r.z, 0.0, 1.0));
  vec3 deep = tint.rgb * 0.1 + vec3(0.004, 0.008, 0.01);
  // The sky is brighter on the sun's side : facets turned toward it read lighter,
  // their backs darker (this is what draws the wave shapes).
  vec2 ldir = vec2(cos(lightAngle), sin(lightAngle));
  float side = clamp(0.45 + dot(-grad, ldir) * 2.4, 0.0, 1.25);
  vec3 col = deep + tint.rgb * side * 0.42 + sky * clamp(fres * 6.0, 0.0, 0.8);
  vec3 sun = normalize(vec3(cos(lightAngle) * 0.55, sin(lightAngle) * 0.55, 0.64));
  float glint = pow(max(dot(r, sun), 0.0), 900.0);
  float sheen = pow(max(dot(r, sun), 0.0), 60.0);
  col += vec3(0.9, 0.88, 0.82) * min(glint * 1.6, 1.0) + tint.rgb * sheen * 0.12;
  // Whitecaps on the sharpest crests, and the foam they leave drawn out in
  // streaks along the wind.
  float crest = -(hess.x + hess.y);
  vec2 wf = vec2(dot(p, wind), dot(p, vec2(-wind.y, wind.x)));
  float streak = og_vnoise(vec2(wf.x * 1.2 - t * 0.4, wf.y * 9.0)) * og_vnoise(vec2(wf.x * 3.0, wf.y * 22.0) + 5.0);
  float cap = smoothstep(10.0, 16.0, crest) * smoothstep(0.35, 0.7, og_vnoise(p * 9.0 + t * 0.5));
  float foam = (cap + smoothstep(0.36, 0.6, streak) * 0.25) * smoothstep(0.15, 0.8, chop);
  col = mix(col, vec3(0.74, 0.78, 0.78), clamp(foam, 0.0, 1.0) * 0.6);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
