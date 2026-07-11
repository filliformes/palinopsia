/*{
  "DESCRIPTION": "Parallax : real 2.5D from a depth map. Near features shift more than far ones as an animated camera SWAY drifts the view, with depth-of-field blur around a FOCUS plane and a FOG that sinks the far distance toward black (aerial recession). It reads the DEPTH MAP the Depth engine fills — turn Depth on in the header (synth for a test bowl, AI for estimated depth on video/capture). With Depth off the map is flat, so this is a clean passthrough. Best on the MASTER chain (it uses the depth of the whole picture).",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Distortion", "Depth"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "depthMap", "TYPE": "image" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "parallax" },
    { "NAME": "angle",  "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0, "LABEL": "angle" },
    { "NAME": "sway",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "sway" },
    { "NAME": "dof",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "depth blur" },
    { "NAME": "focus",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "focus" },
    { "NAME": "fog",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "depth fog" },
    { "NAME": "invert", "TYPE": "bool", "DEFAULT": false, "LABEL": "invert", "COMPACT": true },
    { "NAME": "wet",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float d = IMG_NORM_PIXEL(depthMap, uv).r;
  if (invert) d = 1.0 - d;
  float dc = d - 0.5;                         // centered : mid-depth = no shift
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 swayv = vec2(sin(TIME * 0.5), cos(TIME * 0.37)) * sway;
  vec2 shift = (dir * amount + swayv) * dc * 0.15;
  vec2 suv = uv + shift;
  // Depth-of-field : blur radius grows with distance from the focus plane.
  float r = dof * 0.03 * abs(d - focus);
  vec2 c0 = suv;
  vec2 c1 = suv + vec2(r, 0.0);
  vec2 c2 = suv + vec2(-r, 0.0);
  vec2 c3 = suv + vec2(0.0, r);
  vec2 c4 = suv + vec2(0.0, -r);
  vec3 col = IMG_NORM_PIXEL(inputImage, c0).rgb * 0.4
    + (IMG_NORM_PIXEL(inputImage, c1).rgb + IMG_NORM_PIXEL(inputImage, c2).rgb
     + IMG_NORM_PIXEL(inputImage, c3).rgb + IMG_NORM_PIXEL(inputImage, c4).rgb) * 0.15;
  // Depth fog : the far distance settles toward black.
  col = mix(col, vec3(0.0), fog * smoothstep(focus, 1.0, d));
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  gl_FragColor = vec4(mix(src.rgb, col, wet), src.a);
}
