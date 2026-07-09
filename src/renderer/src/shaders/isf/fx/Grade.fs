/*{
  "DESCRIPTION": "Grade : brightness / contrast / saturation / lift. The master-rack workhorse: bias toward mid-tone grades and desaturation (the disciplined feedback treatment, brief §1).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "brightness", "TYPE": "float", "MIN": -0.5, "MAX": 0.5, "DEFAULT": 0.0 },
    { "NAME": "contrast",   "TYPE": "float", "MIN": 0.25, "MAX": 2.5, "DEFAULT": 1.0 },
    { "NAME": "saturation", "TYPE": "float", "MIN": 0.0,  "MAX": 2.0, "DEFAULT": 1.0 },
    { "NAME": "lift",       "TYPE": "float", "MIN": 0.0,  "MAX": 0.2, "DEFAULT": 0.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 c = IMG_NORM_PIXEL(inputImage, uv);
  vec3 col = c.rgb;
  col = (col - 0.5) * contrast + 0.5 + brightness;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, saturation);
  col = col * (1.0 - lift) + lift; // gentle black lift : matte floor
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
}
