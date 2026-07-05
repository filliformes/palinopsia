/**
 * Compositor.ts — WebGL2 4-layer ISF compositor
 * ----------------------------------------------------------------------------
 * The heart of the visual instrument. Per-frame signal chain (brief §4):
 *
 *   SOURCE A ─ rackA ─┐
 *                     ├─ MIX ─ layer rack ─ PERSIST(feedback) ─┐
 *   SOURCE B ─ rackB ─┘                                        ├─ blend stack
 *                                            (×4 layers) ──────┘      │
 *                                                        master rack ─┴─ present
 *
 * - Every source/FX is an ISF shader. The runtime insists on binding
 *   framebuffer `null` for its final pass, so all ISF draws go through one
 *   proxied GL context whose null-binds redirect into the current target FBO.
 * - FX racks ping-pong through two shared chain buffers; each layer's final
 *   frame lands in its OWN ping-pong pair (so the shared buffers are free for
 *   the next layer), which doubles as the feedback source.
 * - PERSIST = mix(fresh, previous, amount): decay-register trails (never
 *   additive bloom — brief §1), capped below infinite persistence.
 * - Hot-swap principle (brief §1): loading/swapping shaders preserves the
 *   ping-pong buffers — trails survive the swap, never a reset to black.
 * - VAO discipline: the ISF runtime owns the default VAO (WebGL1-style
 *   attribute state); our mix/persist/blend/copy passes bind a private
 *   fullscreen-triangle VAO and release it.
 *
 * Target: RTX 4070 / WebGL2. 1080p–4K @ 60 is comfortable.
 */

import { Renderer as ISFRenderer } from 'interactive-shader-format';
import { handle, installTextureBridge } from './isfTextureBridge';
import type { CompositionState, FxInstance, FxScope } from '@shared/types';

installTextureBridge();

import type { BlendMode } from '@shared/types';
export type { BlendMode };

const QUAD_VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

// The 15 blend modes (indices match modeIndex below) — shared by the layer
// stack pass and the A/B source-mix pass. 'wrap' is the digital-native one.
const BLEND_GLSL = `
vec3 blendMode(int mode, vec3 b, vec3 t){
  if(mode==0) return t;                                     // normal
  if(mode==1) return min(b+t, 1.0);                         // add
  if(mode==2) return max(b-t, 0.0);                         // subtract
  if(mode==3) return b*t;                                   // multiply
  if(mode==4) return 1.0-(1.0-b)*(1.0-t);                   // screen
  if(mode==5) return mix(2.0*b*t, 1.0-2.0*(1.0-b)*(1.0-t), step(0.5,b)); // overlay
  if(mode==6) return (1.0-2.0*t)*b*b + 2.0*t*b;             // soft light (pegtop)
  if(mode==7) return mix(2.0*b*t, 1.0-2.0*(1.0-b)*(1.0-t), step(0.5,t)); // hard light
  if(mode==8) return min(b, t);                             // darken
  if(mode==9) return max(b, t);                             // lighten
  if(mode==10) return abs(b-t);                             // difference
  if(mode==11) return b+t-2.0*b*t;                          // exclusion
  if(mode==12) return clamp(b/max(1.0-t, 1e-4), 0.0, 1.0);  // color dodge
  if(mode==13) return 1.0-clamp((1.0-b)/max(t, 1e-4), 0.0, 1.0); // color burn
  if(mode==14) return fract(b+t);                           // wrap
  return t;                                                 // weave (mixer-only) / fallback
}`;

// Pairwise blend of two textures with opacity on the top layer.
const BLEND_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D base;   // accumulator below
uniform sampler2D top;    // layer above
uniform int mode;
uniform float opacity;
${BLEND_GLSL}
void main(){
  vec4 B = texture(base, uv);
  vec4 T = texture(top, uv);
  vec3 c = blendMode(mode, B.rgb, T.rgb);
  o = vec4(mix(B.rgb, c, T.a*opacity), max(B.a, T.a*opacity));
}`;

// Feedback persist: fresh frame smeared with the layer's previous frame.
// mix() (not add) keeps trails in the decay register — they always converge
// back to the fresh image instead of blooming toward white (brief §1).
const PERSIST_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src;    // this frame's processed layer output
uniform sampler2D prev;   // this layer's previous persisted frame
uniform float amount;     // 0 = plain copy, →1 = long trails
void main(){
  o = mix(texture(src, uv), texture(prev, uv), amount);
}`;

// A/B source mix: out = mix(A, blendMode(A,B), x) — 'normal' degenerates to
// the plain crossfade; every other mode makes the mixer a two-source
// combinator with x as its depth.
const MIX_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D a;
uniform sampler2D b;
uniform int mode;
uniform float x;          // 0 = A only, 1 = full blend result
${BLEND_GLSL}
void main(){
  vec4 A = texture(a, uv);
  vec4 B = texture(b, uv);
  if(mode==15){
    // WEAVE (Signal Culture Weaver): each source's luminance displaces the
    // OTHER's sampling, then they interleave — a woven two-source warp.
    // x scales the displacement depth.
    vec3 lw = vec3(0.299,0.587,0.114);
    float la = dot(A.rgb, lw);
    float lb = dot(B.rgb, lw);
    float d = 0.06 * x;
    vec3 aw = texture(a, uv + vec2(0.0, (lb-0.5)*2.0*d)).rgb;
    vec3 bw = texture(b, uv + vec2((la-0.5)*2.0*d, 0.0)).rgb;
    o = vec4(mix(aw, bw, 0.5), max(A.a, B.a));
    return;
  }
  if(mode==16){
    // LUMAKEY (Lumen-style keyer): A shows where it's bright, B fills A's
    // dark areas (composite A over B, keying out A's near-black background).
    // x is the key threshold, with a soft knee.
    float la = dot(A.rgb, vec3(0.299,0.587,0.114));
    float k = smoothstep(x - 0.08, x + 0.08, la);
    o = vec4(mix(B.rgb, A.rgb, k), max(A.a, B.a));
    return;
  }
  vec3 c = blendMode(mode, A.rgb, B.rgb);
  o = vec4(mix(A.rgb, c, x), max(A.a, B.a * x));
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

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
  const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { fbo, tex };
}

/** Double-buffered render target so a shader can read last frame while writing this one. */
class PingPong {
  fbo: [WebGLFramebuffer, WebGLFramebuffer];
  tex: [WebGLTexture, WebGLTexture];
  cur = 0;
  constructor(gl: WebGL2RenderingContext, public w: number, public h: number) {
    const a = makeTarget(gl, w, h), b = makeTarget(gl, w, h);
    this.fbo = [a.fbo, b.fbo]; this.tex = [a.tex, b.tex];
  }
  write(): WebGLFramebuffer { return this.fbo[this.cur]; }     // draw target
  read(): WebGLTexture { return this.tex[1 - this.cur]; }      // previous frame (feedback)
  out(): WebGLTexture { return this.tex[this.cur]; }           // just-written frame
  swap() { this.cur = 1 - this.cur; }
}

/**
 * The ISF runtime hardcodes `bindFramebuffer(FRAMEBUFFER, null)` for its final
 * (screen) pass. This proxy hands the runtime a GL context whose null-FBO binds
 * are redirected to a target of our choosing. One shared instance serves every
 * ISF renderer — draws are strictly sequential within a frame.
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
      if (prop === 'bindTexture') {
        // The runtime defensively unbinds the ACTIVE texture unit between
        // passes (bindTexture(target, null)) — which strips a multi-pass
        // shader's persistent-buffer texture off its unit before the final
        // pass samples it (Stutter rendered black). Ignoring null binds
        // keeps every unit intact; the runtime always binds what it needs
        // before drawing, so nothing depends on the unbind.
        return (t: number, tex: WebGLTexture | null) => {
          if (tex !== null) target.bindTexture(t, tex);
        };
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

/** Load an ISF source into a fresh renderer; null on compile failure.
 *  Wrapped in try/catch because the ISF parser can THROW (not just set
 *  valid=false) on some sources — an uncaught throw here would propagate out
 *  of the render loop and freeze the whole app. Never let that happen. */
function loadIsf(rgl: WebGL2RenderingContext, id: string, source: string): ISFRenderer | null {
  try {
    const r = new ISFRenderer(rgl);
    r.loadSource(source);
    if (!r.valid) {
      console.error('[ISF] load failed for', id, r.error);
      return null;
    }
    return r;
  } catch (e) {
    console.error('[ISF] threw while loading', id, e);
    return null;
  }
}

interface SharedGL {
  gl: WebGL2RenderingContext;               // the real context
  rgl: WebGL2RenderingContext;              // proxied for ISF renderers
  redirect: { redirect: WebGLFramebuffer | null };
  // Per-frame shader-compile budget. Randomize can request ~20 new shaders at
  // once; compiling them all in one frame stalls the driver (looks like a
  // freeze), so we cap loads per frame and let the rest come in over the next
  // few frames. Reset at the top of syncFromState.
  budget: { n: number };
}

const LOADS_PER_FRAME = 4;

/** One live FX unit inside a rack. `isf` is null when the shader failed to
 *  compile — the unit still exists (so it isn't reloaded every frame) and
 *  simply passes the image through. */
interface FxUnit {
  instId: string;
  shaderId: string;
  isf: ISFRenderer | null;
  enabled: boolean;
}

/**
 * An ordered chain of ISF filter instances (per-source, per-layer, or master).
 * `sync()` reconciles live renderers against the store's FxInstance[] each
 * frame; `apply()` runs the enabled units, ping-ponging through the shared
 * chain buffers, and returns the resulting texture.
 */
class FxRack {
  private units: FxUnit[] = [];

  constructor(private shared: SharedGL) {}

  sync(instances: FxInstance[], sourceById: (id: string) => string | null) {
    const byInst = new Map(this.units.map((u) => [u.instId, u]));
    const next: FxUnit[] = [];
    for (const inst of instances) {
      if (!inst.shaderId) continue;
      let unit = byInst.get(inst.id);
      if (unit && unit.shaderId !== inst.shaderId) {
        unit.isf?.cleanup();
        unit = undefined;
      }
      if (!unit) {
        const src = sourceById(inst.shaderId);
        // A compile costs from the per-frame budget; if spent, defer this
        // unit to a later frame (it just isn't in the chain this frame).
        if (src) {
          if (this.shared.budget.n <= 0) continue;
          this.shared.budget.n--;
        }
        // Create the unit even if the source is missing or the compile fails
        // (isf stays null) so we don't re-attempt the load every frame.
        const isf = src ? loadIsf(this.shared.rgl, inst.shaderId, src) : null;
        unit = { instId: inst.id, shaderId: inst.shaderId, isf, enabled: inst.enabled };
      }
      unit.enabled = inst.enabled;
      // Push declared param values (auto-UI / OSC write these to the store).
      if (unit.isf) for (const [k, v] of Object.entries(inst.inputs)) unit.isf.setValue(k, v);
      byInst.delete(inst.id);
      next.push(unit);
    }
    // Anything left in the map was removed from the rack.
    for (const gone of byInst.values()) gone.isf?.cleanup();
    this.units = next;
  }

  hasWork(): boolean {
    return this.units.some((u) => u.enabled);
  }

  /** Direct write to one unit's ISF input (the modulation path). */
  setUnitInput(instId: string, name: string, value: number | number[]): void {
    this.units.find((u) => u.instId === instId)?.isf?.setValue(name, value);
  }

  /** Assign this rack's clock (per-layer Speed — see isfTextureBridge). */
  setTime(tSec: number): void {
    for (const u of this.units) {
      if (u.isf) (u.isf as unknown as { __opsiaTimeSec?: number }).__opsiaTimeSec = tSec;
    }
  }

  /** Run the chain on `input`; returns the last written texture. */
  apply(input: WebGLTexture, chain: ChainBuffers): WebGLTexture {
    let cur = input;
    for (const u of this.units) {
      if (!u.enabled || !u.isf) continue;
      const target = chain.next();
      u.isf.setValue('inputImage', handle(cur, chain.w, chain.h) as unknown as number);
      this.shared.redirect.redirect = target.fbo;
      u.isf.draw({ width: chain.w, height: chain.h });
      this.shared.redirect.redirect = null;
      cur = target.tex;
    }
    return cur;
  }

  dispose() {
    for (const u of this.units) u.isf?.cleanup();
    this.units = [];
  }
}

/** Two shared scratch targets FX chains ping-pong through (sequential use). */
class ChainBuffers {
  private t: [{ fbo: WebGLFramebuffer; tex: WebGLTexture }, { fbo: WebGLFramebuffer; tex: WebGLTexture }];
  private i = 0;
  constructor(gl: WebGL2RenderingContext, public w: number, public h: number) {
    this.t = [makeTarget(gl, w, h), makeTarget(gl, w, h)];
  }
  next(): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
    this.i = 1 - this.i;
    return this.t[this.i];
  }
}

/** One layer: A/B ISF sources with their racks, a layer rack, and feedback. */
export class ISFLayer {
  pp: PingPong;
  blend: BlendMode = 'normal';
  opacity = 1;
  mute = false;
  solo = false;
  /** 0 = no feedback (plain copy) · →1 = long decay trails. */
  feedbackAmount = 0;
  /** A/B mix depth — 0 = A only. Ignored while B is empty. */
  sourceMix = 0;
  /** How B combines with A before the crossfade. */
  sourceBlend: BlendMode = 'normal';
  /** Global time multiplier for this layer's sources + racks. */
  speed = 1;
  /** The layer's own clock (seconds) — advances by dt·speed each frame. */
  clockSec = 0;
  shaderIdA: string | null = null;
  shaderIdB: string | null = null;

  private isfA: ISFRenderer | null = null;
  private isfB: ISFRenderer | null = null;
  rackA: FxRack;
  rackB: FxRack;
  rackLayer: FxRack;
  scratchA: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  scratchB: { fbo: WebGLFramebuffer; tex: WebGLTexture };

  constructor(private shared: SharedGL, public w: number, public h: number) {
    this.pp = new PingPong(shared.gl, w, h);
    this.scratchA = makeTarget(shared.gl, w, h);
    this.scratchB = makeTarget(shared.gl, w, h);
    this.rackA = new FxRack(shared);
    this.rackB = new FxRack(shared);
    this.rackLayer = new FxRack(shared);
  }

  /** Load/swap/clear a source shader. Feedback buffers survive (brief §1).
   *  Records the requested id even when the compile FAILS — otherwise
   *  syncFromState would see the id still unmatched and re-attempt the load
   *  every frame (a 60 Hz shader-compile storm that stalls the driver). A
   *  failed shader just renders transparent until a different one is chosen. */
  setShader(slot: 'A' | 'B', id: string | null, source: string | null): void {
    // A real compile costs from the per-frame budget; if it's spent, defer —
    // leave the id unrecorded so syncFromState retries next frame.
    if (id && source) {
      if (this.shared.budget.n <= 0) return;
      this.shared.budget.n--;
    }
    const cur = slot === 'A' ? this.isfA : this.isfB;
    cur?.cleanup();
    let next: ISFRenderer | null = null;
    if (id && source) next = loadIsf(this.shared.rgl, id, source);
    if (slot === 'A') {
      this.isfA = next;
      this.shaderIdA = id;
    } else {
      this.isfB = next;
      this.shaderIdB = id;
    }
  }

  setInput(slot: 'A' | 'B', name: string, value: number | number[]) {
    (slot === 'A' ? this.isfA : this.isfB)?.setValue(name, value);
  }

  hasB(): boolean { return this.isfB !== null; }

  /** Advance the layer clock and stamp it onto every renderer it owns. */
  advanceClock(dtSec: number): void {
    this.clockSec += dtSec * this.speed;
    const t = this.clockSec;
    if (this.isfA) (this.isfA as unknown as { __opsiaTimeSec?: number }).__opsiaTimeSec = t;
    if (this.isfB) (this.isfB as unknown as { __opsiaTimeSec?: number }).__opsiaTimeSec = t;
    this.rackA.setTime(t);
    this.rackB.setTime(t);
    this.rackLayer.setTime(t);
  }

  /** Draw a source's ISF into its scratch target (empty → transparent). */
  renderSource(slot: 'A' | 'B') {
    const gl = this.shared.gl;
    const isf = slot === 'A' ? this.isfA : this.isfB;
    const scratch = slot === 'A' ? this.scratchA : this.scratchB;
    if (!isf) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.fbo);
      gl.viewport(0, 0, this.w, this.h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    this.shared.redirect.redirect = scratch.fbo;
    isf.draw({ width: this.w, height: this.h });
    this.shared.redirect.redirect = null;
  }

  /** The persisted (post-feedback) frame — what the blend stack composites. */
  texture(): WebGLTexture { return this.pp.out(); }
}

export class Compositor {
  gl: WebGL2RenderingContext;
  layers: ISFLayer[] = [];
  masterRack: FxRack;
  private shared: SharedGL;
  private chain: ChainBuffers;
  private mixTarget: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private blendProg: WebGLProgram;
  private persistProg: WebGLProgram;
  private mixProg: WebGLProgram;
  private copyProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private acc: PingPong;            // accumulator for the layer stack
  private uBase: WebGLUniformLocation; private uTop: WebGLUniformLocation;
  private uMode: WebGLUniformLocation; private uOpac: WebGLUniformLocation;
  private uPSrc: WebGLUniformLocation; private uPPrev: WebGLUniformLocation;
  private uPAmt: WebGLUniformLocation;
  private uMA: WebGLUniformLocation; private uMB: WebGLUniformLocation;
  private uMX: WebGLUniformLocation; private uMMode: WebGLUniformLocation;
  private uCTex: WebGLUniformLocation;
  private modeIndex: Record<BlendMode, number> = {
    normal: 0, add: 1, subtract: 2, multiply: 3, screen: 4, overlay: 5,
    softlight: 6, hardlight: 7, darken: 8, lighten: 9, difference: 10,
    exclusion: 11, dodge: 12, burn: 13, wrap: 14, weave: 15, lumakey: 16
  };

  constructor(public canvas: HTMLCanvasElement, public w = 1920, public h = 1080) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false })!;
    if (!gl) throw new Error('WebGL2 unavailable');
    gl.getExtension('EXT_color_buffer_float'); // RGBA16F render targets
    this.gl = gl;
    const wrapped = makeRedirectableGL(gl);
    this.shared = { gl, rgl: wrapped.gl, redirect: wrapped.state, budget: { n: 0 } };

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

    this.mixProg = compile(gl, QUAD_VS, MIX_FS);
    this.uMA = gl.getUniformLocation(this.mixProg, 'a')!;
    this.uMB = gl.getUniformLocation(this.mixProg, 'b')!;
    this.uMX = gl.getUniformLocation(this.mixProg, 'x')!;
    this.uMMode = gl.getUniformLocation(this.mixProg, 'mode')!;

    this.copyProg = compile(gl, QUAD_VS, COPY_FS);
    this.uCTex = gl.getUniformLocation(this.copyProg, 'tex')!;

    this.acc = new PingPong(gl, w, h);
    this.chain = new ChainBuffers(gl, w, h);
    this.mixTarget = makeTarget(gl, w, h);
    this.masterRack = new FxRack(this.shared);
    for (let i = 0; i < 4; i++) this.layers.push(new ISFLayer(this.shared, w, h));
  }

  /**
   * Reconcile the engine against the store's CompositionState. Called once per
   * frame before render() — the single write path shared by UI, session loads,
   * OSC, and modulators. Shader hot-swaps preserve feedback buffers (brief §1).
   */
  syncFromState(c: CompositionState, sourceById: (id: string) => string | null) {
    this.shared.budget.n = LOADS_PER_FRAME; // cap new shader compiles this frame
    for (let i = 0; i < this.layers.length && i < c.layers.length; i++) {
      const l = c.layers[i];
      const L = this.layers[i];
      const wantA = l.sourceA.kind === 'generator' ? l.sourceA.shaderId : null;
      if (wantA !== L.shaderIdA) L.setShader('A', wantA, wantA ? sourceById(wantA) : null);
      const wantB = l.sourceB && l.sourceB.kind === 'generator' ? l.sourceB.shaderId : null;
      if (wantB !== L.shaderIdB) L.setShader('B', wantB, wantB ? sourceById(wantB) : null);
      L.blend = l.blend;
      L.opacity = l.opacity;
      L.mute = l.mute;
      L.solo = l.solo;
      L.feedbackAmount = l.feedback ? l.feedbackAmount : 0;
      L.sourceMix = l.sourceMix;
      L.sourceBlend = l.sourceBlend ?? 'normal';
      L.speed = l.speed ?? 1;
      for (const [k, v] of Object.entries(l.sourceA.inputs)) L.setInput('A', k, v);
      if (l.sourceB) for (const [k, v] of Object.entries(l.sourceB.inputs)) L.setInput('B', k, v);
      L.rackA.sync(l.sourceAFx, sourceById);
      L.rackB.sync(l.sourceBFx, sourceById);
      L.rackLayer.sync(l.fx, sourceById);
    }
    this.masterRack.sync(c.master, sourceById);
  }

  /** Direct write to an FX unit's ISF input in any rack (modulation path). */
  setFxInput(scope: FxScope, instId: string, name: string, value: number | number[]): void {
    if (scope.kind === 'master') {
      this.masterRack.setUnitInput(instId, name, value);
      return;
    }
    const L = this.layers[scope.layer];
    if (!L) return;
    const rack =
      scope.kind === 'layer' ? L.rackLayer : scope.kind === 'sourceA' ? L.rackA : L.rackB;
    rack.setUnitInput(instId, name, value);
  }

  /** Composite top texture over base into target using the given blend mode. */
  private blendInto(target: WebGLFramebuffer, base: WebGLTexture, top: WebGLTexture, mode: BlendMode, opacity: number) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.blendProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, base); gl.uniform1i(this.uBase, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, top);  gl.uniform1i(this.uTop, 1);
    gl.uniform1i(this.uMode, this.modeIndex[mode]);
    gl.uniform1f(this.uOpac, opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** A/B mix into the shared mix target: mix(A, blendMode(A,B), x). */
  private mixSources(a: WebGLTexture, b: WebGLTexture, x: number, mode: BlendMode): WebGLTexture {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mixTarget.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.mixProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a); gl.uniform1i(this.uMA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b); gl.uniform1i(this.uMB, 1);
    gl.uniform1i(this.uMMode, this.modeIndex[mode] ?? 0);
    gl.uniform1f(this.uMX, x);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    return this.mixTarget.tex;
  }

  /** pp.write() = mix(src, pp.read(), feedbackAmount), then swap. */
  private persist(L: ISFLayer, src: WebGLTexture) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, L.pp.write());
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.persistProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(this.uPSrc, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.pp.read()); gl.uniform1i(this.uPPrev, 1);
    // Cap just below 1 so trails always decay — infinite persistence is the
    // blooming failure mode the brief warns about.
    gl.uniform1f(this.uPAmt, Math.min(L.feedbackAmount, 0.97));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    L.pp.swap();
  }

  private lastNowMs = 0;
  private masterClockSec = 0;

  /** One frame. */
  render(timeMs: number) {
    const gl = this.gl;

    // Per-layer clocks (the Speed control): dt · speed, master at realtime.
    const dtSec = this.lastNowMs > 0 ? Math.min(0.2, (timeMs - this.lastNowMs) / 1000) : 1 / 60;
    this.lastNowMs = timeMs;
    this.masterClockSec += dtSec;
    this.masterRack.setTime(this.masterClockSec);

    // Per layer: sources → per-source racks → mix → layer rack → persist.
    // The result of each stage lives in shared buffers only until persist
    // writes it into the layer's own ping-pong pair.
    for (const L of this.layers) {
      L.advanceClock(dtSec);
      gl.bindVertexArray(null); // ISF draws own the default VAO
      L.renderSource('A');
      let sig = L.rackA.apply(L.scratchA.tex, this.chain);
      if (L.hasB()) {
        L.renderSource('B');
        const sigB = L.rackB.apply(L.scratchB.tex, this.chain);
        sig = this.mixSources(sig, sigB, L.sourceMix, L.sourceBlend);
      }
      gl.bindVertexArray(null);
      sig = L.rackLayer.apply(sig, this.chain);
      this.persist(L, sig);
    }

    // Blend stack: clear one accumulator buffer, then blend bottom→top
    // reading one buffer and writing the other (never the same texture).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.acc.write());
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    this.acc.swap(); // cleared buffer is now acc.read()

    const anySolo = this.layers.some((l) => l.solo);
    let first = true;
    for (const L of this.layers) {
      const audible = anySolo ? L.solo : !L.mute;
      if (!audible) continue;
      // The first visible layer has nothing real below it — the accumulator
      // is cleared black, so multiply/overlay/burn would eat it. Standard
      // compositor semantics: the bottom of the stack composites 'normal';
      // blend modes act BETWEEN layers.
      this.blendInto(
        this.acc.write(),
        this.acc.read(),
        L.texture(),
        first ? 'normal' : L.blend,
        L.opacity
      );
      first = false;
      this.acc.swap();
    }
    let composite = this.acc.read();

    // Master rack (glitch / dither / chroma / grade; warp joins in Phase 8).
    gl.bindVertexArray(null);
    composite = this.masterRack.apply(composite, this.chain);

    // Present to canvas.
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.copyProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, composite); gl.uniform1i(this.uCTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    // SEAM (Phase 8): gl.readPixels(composite) → IPC → Spout/Syphon/NDI.
  }
}
