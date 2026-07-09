/*{
  "DESCRIPTION": "Edge : Sobel luminance contours, mixable over the source. Matte line-work for the digital-arts register; gain stays disciplined (no neon bloom).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Stylize"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "gain", "TYPE": "float", "MIN": 0.5, "MAX": 4.0, "DEFAULT": 1.5 },
    { "NAME": "blend", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 }
  ]
}*/

float lum(vec2 c) {
  vec4 s = IMG_NORM_PIXEL(inputImage, c);
  return dot(s.rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 px = 1.0 / RENDERSIZE;

  vec2 c00 = uv + vec2(-px.x, -px.y); vec2 c10 = uv + vec2(0.0, -px.y); vec2 c20 = uv + vec2(px.x, -px.y);
  vec2 c01 = uv + vec2(-px.x, 0.0);                                     vec2 c21 = uv + vec2(px.x, 0.0);
  vec2 c02 = uv + vec2(-px.x, px.y);  vec2 c12 = uv + vec2(0.0, px.y);  vec2 c22 = uv + vec2(px.x, px.y);

  float tl = lum(c00); float tc = lum(c10); float tr = lum(c20);
  float ml = lum(c01);                      float mr = lum(c21);
  float bl = lum(c02); float bc = lum(c12); float br = lum(c22);

  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  float e = clamp(length(vec2(gx, gy)) * gain, 0.0, 1.0);

  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  vec3 edges = vec3(e);
  gl_FragColor = vec4(mix(src.rgb, edges, blend), src.a);
}
