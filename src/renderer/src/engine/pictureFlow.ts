// The picture's own motion on the GPU : a dense optical-flow field of any texture,
// at a small fixed size (a 256 x 256 field over the whole frame, whatever its size),
// so a node can follow what moves in its picture at the same cost at 1080p, 4K and
// on the dome. The same three passes Transfert, Datamosh and Sillage run (their
// shaders live here and convNodes.ts imports them) : the picture's luma, a
// gradient (poor-man's Lucas-Kanade) flow against the previous luma, then a
// separable blur that turns the noisy per-texel estimate into a smooth field.
//
// PictureFlow is the self-contained form, on an organic engine's GL (its own VAO,
// organicGL.ts), for the field effects (Morphogen, Current) : one update a frame,
// `tex` holds the flow (RG, in texels of the 256 field per frame : divide by 256
// for a frame-uv offset).

import type { EngineGL, Prog, Target } from './organicGL'

// Luma of the flow source at flow resolution. uBox > 0 averages a 4×4 grid over
// the output texel's footprint (a box prefilter : fine texture no longer aliases
// into flow noise); 0 = one bilinear tap.
export const F_DOWNSAMPLE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex; uniform float uBox;
float lum(vec2 uv){ return dot(texture(uTex, uv).rgb, vec3(0.299,0.587,0.114)); }
void main(){
  float l = 0.0;
  if (uBox > 0.0) {
    for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
      vec2 d = (vec2(float(i), float(j)) - 1.5) * 0.25 * uBox;
      vec2 uv = vUV + d;
      l += lum(uv);
    }
    l *= 0.0625;
  } else l = lum(vUV);
  o = vec4(l, 0.0, 0.0, 1.0);
}`

// Gradient (poor-man's Lucas–Kanade) flow : RG = flow vector, in texels of a
// 256-wide field whatever the flow resolution (uScale = 256/res), so the flow-res
// dial is a quality knob, not a hidden gain.
export const F_FLOW = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uCur, uPrev; uniform vec2 uRes; uniform float uLambda, uClamp, uScale;
void main(){
  vec2 texel = 1.0 / uRes;
  float c = texture(uCur, vUV).r;
  float p = texture(uPrev, vUV).r;
  float dx = texture(uCur, vUV + vec2(texel.x,0.0)).r - texture(uCur, vUV - vec2(texel.x,0.0)).r;
  float dy = texture(uCur, vUV + vec2(0.0,texel.y)).r - texture(uCur, vUV - vec2(0.0,texel.y)).r;
  float dt = c - p;
  vec2 grad = vec2(dx, dy) * 0.5;
  float mag2 = dot(grad, grad) + uLambda;
  vec2 flow = -dt * grad / mag2 * uScale;
  o = vec4(clamp(flow, -uClamp, uClamp), 0.0, 1.0);
}`

// Separable blur on the flow field (dynamic radius : WebGL2 allows it).
export const F_BLUR = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex; uniform vec2 uStep; uniform float uRadius;
void main(){
  vec2 acc = vec2(0.0); float wsum = 0.0; int R = int(uRadius);
  for (int i = -R; i <= R; i++){
    float w = 1.0 - abs(float(i)) / (uRadius + 1.0);
    acc += texture(uTex, vUV + uStep * float(i)).rg * w; wsum += w;
  }
  o = vec4(acc / max(wsum, 1e-4), 0.0, 1.0);
}`

/** The field's size : 256 texels across the frame each way. */
export const PICTURE_FLOW_RES = 256

export class PictureFlow {
  private down: Prog
  private flow: Prog
  private blur: Prog
  private lumaA: Target
  private lumaB: Target
  private s1: Target
  private s2: Target
  private curIsA = true
  private primed = false

  constructor(private g: EngineGL) {
    this.down = g.prog(F_DOWNSAMPLE)
    this.flow = g.prog(F_FLOW)
    this.blur = g.prog(F_BLUR)
    const n = PICTURE_FLOW_RES
    const t = (): Target => g.target(n, n, { half: 'rgba', linear: true })
    this.lumaA = t()
    this.lumaB = t()
    this.s1 = t()
    this.s2 = t()
  }

  /** The blurred flow (RG), valid after update. */
  get tex(): WebGLTexture {
    return this.s1.tex
  }

  /** Measure this frame's motion of `src` against the last frame's. `restart` :
   *  no history to compare with (inserted, re-enabled, cleared) : the field reads
   *  still instead of jolting. `smooth` : the blur radius in field texels. */
  update(src: WebGLTexture, restart: boolean, smooth = 6): void {
    const g = this.g
    const n = PICTURE_FLOW_RES
    const cur = this.curIsA ? this.lumaA : this.lumaB
    const prev = this.curIsA ? this.lumaB : this.lumaA
    // a box prefilter over the source texel footprint : fine texture never aliases into flow noise
    this.down.use().i1('uTex', 0).f1('uBox', 1 / n)
    g.bind(0, src)
    g.draw(cur.fbo, n, n)
    if (restart || !this.primed) {
      g.draw(prev.fbo, n, n)
      this.primed = true
    }
    this.flow.use().i1('uCur', 0).i1('uPrev', 1).f2('uRes', n, n).f1('uLambda', 0.001).f1('uClamp', 1.0).f1('uScale', 256 / n)
    g.bind(0, cur.tex)
    g.bind(1, prev.tex)
    g.draw(this.s1.fbo, n, n)
    this.blur.use().i1('uTex', 0).f1('uRadius', smooth)
    g.bind(0, this.s1.tex)
    this.blur.f2('uStep', 1 / n, 0)
    g.draw(this.s2.fbo, n, n)
    g.bind(0, this.s2.tex)
    this.blur.f2('uStep', 0, 1 / n)
    g.draw(this.s1.fbo, n, n)
    this.curIsA = !this.curIsA
  }

  dispose(): void {
    for (const t of [this.lumaA, this.lumaB, this.s1, this.s2]) this.g.freeTarget(t)
  }
}
