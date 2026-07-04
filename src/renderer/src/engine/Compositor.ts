/**
 * Compositor.ts — WebGL2 4-layer ISF compositor
 * ----------------------------------------------------------------------------
 * The heart of the visual instrument. Renders 4 layers (each driven by an ISF
 * shader), blends them with selectable blend modes, runs a master FX pass, and
 * presents to the canvas. Feedback works because each layer keeps its previous
 * frame in a ping-pong FBO.
 *
 * Per-frame pipeline (Phase 2):
 *   1. each layer's ISF shader draws into the layer's SCRATCH target
 *      (the ISF runtime insists on binding framebuffer `null` for its final
 *      pass, so each renderer gets a proxied GL context that redirects null
 *      binds into the scratch FBO);
 *   2. a PERSIST pass writes pp.write() = mix(scratch, pp.read(), feedback) —
 *      the palinopsia itself: exponential decay trails, the disciplined
 *      register (decay, not additive bloom — brief §1);
 *   3. layers blend bottom→top into a ping-pong accumulator (read one buffer,
 *      write the other — never the same texture both ways);
 *   4. master FX chain (Phase 3 seam), then a copy pass presents to canvas.
 *
 * Hot-swap principle (brief §1): loading a new shader onto a layer preserves
 * its ping-pong buffers, so trails survive the swap — never a reset to black.
 *
 * Target: RTX 4070 / WebGL2. 1080p–4K @ 60 is comfortable.
 */

import { Renderer as ISFRenderer } from 'interactive-shader-format';

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

// Feedback persist: fresh frame smeared with the layer's previous frame.
// mix() (not add) keeps trails in the decay register — they always converge
// back to the fresh image instead of blooming toward white (brief §1).
const PERSIST_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src;    // this frame's ISF output (scratch)
uniform sampler2D prev;   // this layer's previous persisted frame
uniform float amount;     // 0 = plain copy, →1 = long trails
void main(){
  o = mix(texture(src, uv), texture(prev, uv), amount);
}`;

// Present / copy pass.
const COPY_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex;
void main(){ o = texture(tex, uv); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (t: number, s: string) => {
    const sh = gl.createShader(t)!; gl.shaderSource(sh, s); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
    return sh;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p');
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

/**
 * The ISF runtime hardcodes `bindFramebuffer(FRAMEBUFFER, null)` for its final
 * (screen) pass. This proxy hands the runtime a GL context whose null-FBO binds
 * are redirected to a target of our choosing, so each layer's "screen" is its
 * own scratch FBO. Everything else passes straight through to the real context
 * (methods bound + cached; constants and properties as-is).
 */
function makeRedirectableGL(gl: WebGL2RenderingContext): {
  gl: WebGL2RenderingContext;
  state: { redirect: WebGLFramebuffer | null };
} {
  const state = { redirect: null as WebGLFramebuffer | null };
  const cache = new Map<PropertyKey, unknown>();
  const proxy = new Proxy(gl, {
    get(target, prop) {
      if (prop === 'bindFramebuffer') {
        return (t: number, fbo: WebGLFramebuffer | null) =>
          target.bindFramebuffer(t, fbo === null ? state.redirect : fbo);
      }
      const v = (target as unknown as Record<PropertyKey, unknown>)[prop];
      if (typeof v === 'function') {
        let bound = cache.get(prop);
        if (!bound) {
          bound = (v as (...a: unknown[]) => unknown).bind(target);
          cache.set(prop, bound);
        }
        return bound;
      }
      return v;
    }
  });
  return { gl: proxy as WebGL2RenderingContext, state };
}

/** One layer = one ISF shader rendering into scratch, persisted through ping-pong. */
export class ISFLayer {
  pp: PingPong;
  blend: BlendMode = 'normal';
  opacity = 1;
  mute = false;
  solo = false;
  /** 0 = no feedback (plain copy) · →1 = long decay trails. */
  feedbackAmount = 0;
  shaderId: string | null = null;

  private isf: ISFRenderer | null = null;
  private rgl: WebGL2RenderingContext;
  private redirect: { redirect: WebGLFramebuffer | null };
  scratchFbo: WebGLFramebuffer;
  scratchTex: WebGLTexture;

  constructor(private gl: WebGL2RenderingContext, public w: number, public h: number) {
    this.pp = new PingPong(gl, w, h);
    const wrapped = makeRedirectableGL(gl);
    this.rgl = wrapped.gl;
    this.redirect = wrapped.state;
    // Scratch target the ISF pass lands in each frame (pre-persist).
    const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.scratchTex = t;
    const f = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    this.scratchFbo = f;
  }

  /**
   * Load (or hot-swap) the ISF shader that drives this layer. The ping-pong
   * feedback buffers are deliberately preserved across a swap so rebuilding
   * the patch mid-performance never resets to black (the hot-swap principle,
   * brief §1). Returns false if the shader failed to compile.
   */
  loadShader(id: string, source: string): boolean {
    const r = new ISFRenderer(this.rgl);
    r.loadSource(source);
    if (!r.valid) {
      console.error('[ISF] load failed for', id, r.error);
      return false;
    }
    this.isf?.cleanup();
    this.isf = r;
    this.shaderId = id;
    return true;
  }

  /** Clear the shader; the layer goes transparent (feedback buffers kept). */
  unloadShader() {
    this.isf?.cleanup();
    this.isf = null;
    this.shaderId = null;
  }

  setInput(name: string, value: number | number[]) {
    this.isf?.setValue(name, value);
  }

  /** Draw the ISF shader into the scratch target (empty layer → transparent). */
  renderISF() {
    const gl = this.gl;
    if (!this.isf) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scratchFbo);
      gl.viewport(0, 0, this.w, this.h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    this.redirect.redirect = this.scratchFbo;
    this.isf.draw({ width: this.w, height: this.h });
    this.redirect.redirect = null;
  }

  /** The persisted (post-feedback) frame — what the blend stack composites. */
  texture(): WebGLTexture { return this.pp.out(); }
}

export class Compositor {
  gl: WebGL2RenderingContext;
  layers: ISFLayer[] = [];
  private blendProg: WebGLProgram;
  private persistProg: WebGLProgram;
  private copyProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private acc: PingPong;            // accumulator for the layer stack
  private uBase: WebGLUniformLocation; private uTop: WebGLUniformLocation;
  private uMode: WebGLUniformLocation; private uOpac: WebGLUniformLocation;
  private uPSrc: WebGLUniformLocation; private uPPrev: WebGLUniformLocation;
  private uPAmt: WebGLUniformLocation;
  private uCTex: WebGLUniformLocation;
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
    // Leave the default VAO for the ISF runtime — it sets up its own attribute
    // state there (WebGL1-style). Our passes bind this.vao explicitly.
    gl.bindVertexArray(null);

    this.blendProg = compile(gl, QUAD_VS, BLEND_FS);
    this.uBase = gl.getUniformLocation(this.blendProg, 'base')!;
    this.uTop  = gl.getUniformLocation(this.blendProg, 'top')!;
    this.uMode = gl.getUniformLocation(this.blendProg, 'mode')!;
    this.uOpac = gl.getUniformLocation(this.blendProg, 'opacity')!;

    this.persistProg = compile(gl, QUAD_VS, PERSIST_FS);
    this.uPSrc  = gl.getUniformLocation(this.persistProg, 'src')!;
    this.uPPrev = gl.getUniformLocation(this.persistProg, 'prev')!;
    this.uPAmt  = gl.getUniformLocation(this.persistProg, 'amount')!;

    this.copyProg = compile(gl, QUAD_VS, COPY_FS);
    this.uCTex = gl.getUniformLocation(this.copyProg, 'tex')!;

    this.acc = new PingPong(gl, w, h);
    for (let i = 0; i < 4; i++) this.layers.push(new ISFLayer(gl, w, h));
  }

  /** Composite top texture over base into target using the given blend mode. */
  private blendInto(target: WebGLFramebuffer, base: WebGLTexture, top: WebGLTexture, mode: BlendMode, opacity: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.blendProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, base); gl.uniform1i(this.uBase, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, top);  gl.uniform1i(this.uTop, 1);
    gl.uniform1i(this.uMode, this.modeIndex[mode]);
    gl.uniform1f(this.uOpac, opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** pp.write() = mix(scratch, pp.read(), feedbackAmount), then swap. */
  private persist(L: ISFLayer) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, L.pp.write());
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.persistProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, L.scratchTex); gl.uniform1i(this.uPSrc, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.pp.read()); gl.uniform1i(this.uPPrev, 1);
    // Cap just below 1 so trails always decay — infinite persistence is the
    // blooming failure mode the brief warns about.
    gl.uniform1f(this.uPAmt, Math.min(L.feedbackAmount, 0.97));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    L.pp.swap();
  }

  /** One frame: ISF passes → persist passes → blend stack → present. */
  render(_timeMs: number) {
    const gl = this.gl;

    // 1. ISF draws (default VAO — the runtime owns its own vertex state there).
    gl.bindVertexArray(null);
    for (const L of this.layers) L.renderISF();

    // Our fullscreen-triangle passes from here on.
    gl.bindVertexArray(this.vao);

    // 2. persist (feedback) pass per layer.
    for (const L of this.layers) this.persist(L);

    // 3. clear one accumulator buffer, then blend layers bottom→top reading
    //    the previous result and writing the other buffer (never the same
    //    texture both ways).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.acc.write());
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    this.acc.swap(); // cleared buffer is now acc.read()

    const anySolo = this.layers.some((l) => l.solo);
    for (const L of this.layers) {
      const audible = anySolo ? L.solo : !L.mute;
      if (!audible) continue;
      this.blendInto(this.acc.write(), this.acc.read(), L.texture(), L.blend, L.opacity);
      this.acc.swap();
    }
    const composite = this.acc.read();

    // 4. MASTER FX chain goes here (Phase 3): glitch / dither / chroma / grade
    //    as an ISF chain sampling `composite`, then the warp pass (Phase 8).

    // 5. present to canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.copyProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, composite); gl.uniform1i(this.uCTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);

    // 6. SEAM (Phase 8): gl.readPixels(composite) → IPC → Spout/Syphon/NDI.
  }

  // ---- instrument API (called from React / OSC / modulators) ----
  /** Load (or hot-swap) an ISF shader onto a layer. */
  loadLayerShader(i: number, id: string, source: string): boolean {
    return this.layers[i]?.loadShader(id, source) ?? false;
  }
  unloadLayerShader(i: number) { this.layers[i]?.unloadShader(); }
  setLayerSourceInput(i: number, name: string, value: number | number[]) { this.layers[i]?.setInput(name, value); }
  setBlend(i: number, mode: BlendMode) { if (this.layers[i]) this.layers[i].blend = mode; }
  setOpacity(i: number, v: number)     { if (this.layers[i]) this.layers[i].opacity = v; }
}
