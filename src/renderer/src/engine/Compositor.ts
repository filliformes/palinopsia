/**
 * Compositor.ts — WebGL2 4-layer ISF compositor (seed)
 * ----------------------------------------------------------------------------
 * The heart of the visual instrument. Renders 4 layers (each driven by an ISF
 * shader), blends them with selectable blend modes, runs a master FX pass, and
 * presents to the canvas. Feedback works because each layer keeps its previous
 * frame in a ping-pong FBO that any shader can sample.
 *
 * INTEGRATION SEAM: `ISFLayer.render()` is where the `interactive-shader-format`
 * Renderer actually executes a shader into the layer's FBO. This file owns all
 * the plumbing around it (FBOs, blending, master, output) in plain WebGL2 so the
 * architecture is concrete and correct regardless of the ISF runtime's API.
 *
 * Target: RTX 4070 / WebGL2. 1080p–4K @ 60 is comfortable.
 */

export type BlendMode = 'add' | 'screen' | 'multiply' | 'difference' | 'overlay' | 'normal';

const QUAD_VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

// Pairwise blend of two textures with opacity on the top layer.
const BLEND_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D base;   // accumulator below
uniform sampler2D top;    // layer above
uniform int mode;
uniform float opacity;
vec3 blend(vec3 b, vec3 t){
  if(mode==0) return b+t;                                   // add
  if(mode==1) return 1.0-(1.0-b)*(1.0-t);                   // screen
  if(mode==2) return b*t;                                   // multiply
  if(mode==3) return abs(b-t);                              // difference
  if(mode==4) return mix(2.0*b*t, 1.0-2.0*(1.0-b)*(1.0-t), step(0.5,b)); // overlay
  return t;                                                 // normal
}
void main(){
  vec4 B = texture(base, uv);
  vec4 T = texture(top, uv);
  vec3 c = blend(B.rgb, T.rgb);
  o = vec4(mix(B.rgb, c, T.a*opacity), max(B.a, T.a*opacity));
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (t: number, s: string) => {
    const sh = gl.createShader(t)!; gl.shaderSource(sh, s); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
    return sh;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  return p;
}

/** Double-buffered render target so a shader can read last frame while writing this one. */
class PingPong {
  fbo: [WebGLFramebuffer, WebGLFramebuffer];
  tex: [WebGLTexture, WebGLTexture];
  cur = 0;
  constructor(private gl: WebGL2RenderingContext, public w: number, public h: number) {
    const make = () => {
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return [f, t] as const;
    };
    const a = make(), b = make();
    this.fbo = [a[0], b[0]]; this.tex = [a[1], b[1]];
  }
  write(): WebGLFramebuffer { return this.fbo[this.cur]; }     // draw target
  read(): WebGLTexture { return this.tex[1 - this.cur]; }      // previous frame (feedback)
  out(): WebGLTexture { return this.tex[this.cur]; }           // just-written frame
  swap() { this.cur = 1 - this.cur; }
}

/** One layer = one ISF shader rendering into a ping-pong target. */
export class ISFLayer {
  pp: PingPong;
  blend: BlendMode = 'normal';
  opacity = 1;
  // isfRenderer: import('interactive-shader-format').Renderer  // <-- attach here
  constructor(private gl: WebGL2RenderingContext, w: number, h: number) {
    this.pp = new PingPong(gl, w, h);
  }
  setInput(_name: string, _value: number | number[]) {
    // SEAM: forward to the ISF Renderer, e.g. this.isfRenderer.setValue(name, value)
  }
  render(_timeMs: number) {
    // SEAM: bind this.pp.write(), expose this.pp.read() as the shader's feedback
    // input, then this.isfRenderer.draw(target). Plumbing below is real; the ISF
    // draw call goes here.
    this.pp.swap();
  }
  texture(): WebGLTexture { return this.pp.out(); }
}

export class Compositor {
  gl: WebGL2RenderingContext;
  layers: ISFLayer[] = [];
  private blendProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private acc: PingPong;            // accumulator for the layer stack
  private uBase: WebGLUniformLocation; private uTop: WebGLUniformLocation;
  private uMode: WebGLUniformLocation; private uOpac: WebGLUniformLocation;
  private modeIndex: Record<BlendMode, number> =
    { add:0, screen:1, multiply:2, difference:3, overlay:4, normal:5 };

  constructor(public canvas: HTMLCanvasElement, public w = 1920, public h = 1080) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false })!;
    if (!gl) throw new Error('WebGL2 unavailable');
    gl.getExtension('EXT_color_buffer_float'); // RGBA16F render targets
    this.gl = gl;

    const quad = new Float32Array([-1,-1, 3,-1, -1,3]); // fullscreen triangle
    this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.blendProg = compile(gl, QUAD_VS, BLEND_FS);
    gl.bindAttribLocation(this.blendProg, 0, 'p');
    this.uBase = gl.getUniformLocation(this.blendProg, 'base')!;
    this.uTop  = gl.getUniformLocation(this.blendProg, 'top')!;
    this.uMode = gl.getUniformLocation(this.blendProg, 'mode')!;
    this.uOpac = gl.getUniformLocation(this.blendProg, 'opacity')!;

    this.acc = new PingPong(gl, w, h);
    for (let i = 0; i < 4; i++) this.layers.push(new ISFLayer(gl, w, h));
  }

  /** Composite top texture over the accumulator using the given blend mode. */
  private blendInto(target: WebGLFramebuffer, base: WebGLTexture, top: WebGLTexture, mode: BlendMode, opacity: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.blendProg);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, base); gl.uniform1i(this.uBase, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, top);  gl.uniform1i(this.uTop, 1);
    gl.uniform1i(this.uMode, this.modeIndex[mode]);
    gl.uniform1f(this.uOpac, opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** One frame: render every layer, stack them, (master pass TODO), present. */
  render(timeMs: number) {
    const gl = this.gl;

    // 1. render each layer's ISF shader into its own target
    for (const L of this.layers) L.render(timeMs);

    // 2. clear accumulator to black, then blend layers bottom→top
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.acc.write());
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    let base = this.acc.out();
    for (const L of this.layers) {
      this.blendInto(this.acc.write(), base, L.texture(), L.blend, L.opacity);
      this.acc.swap();
      base = this.acc.out();
    }

    // 3. MASTER FX pass goes here (glitch / dither / chroma / grade as an ISF chain),
    //    sampling `base`. For now we present `base` straight to the canvas.

    // 4. present to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.blendInto(null as unknown as WebGLFramebuffer, base, base, 'normal', 0); // base over base = base
    // NOTE: replace step 4 with a dedicated copy/master program; this keeps the seed self-contained.

    // 5. SEAM: gl.readPixels(...) → IPC → native Spout/Syphon/NDI sender (cheap on a 4070)
  }

  // ---- instrument API (called from React / OSC / modulators) ----
  setLayerSourceInput(i: number, name: string, value: number | number[]) { this.layers[i]?.setInput(name, value); }
  setBlend(i: number, mode: BlendMode) { if (this.layers[i]) this.layers[i].blend = mode; }
  setOpacity(i: number, v: number)     { if (this.layers[i]) this.layers[i].opacity = v; }
}
