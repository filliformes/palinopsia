/**
 * Compositor.ts : WebGL2 4-layer ISF compositor
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
 *   additive bloom : brief §1), capped below infinite persistence.
 * - Hot-swap principle (brief §1): loading/swapping shaders preserves the
 *   ping-pong buffers : trails survive the swap, never a reset to black.
 * - VAO discipline: the ISF runtime owns the default VAO (WebGL1-style
 *   attribute state); our mix/persist/blend/copy passes bind a private
 *   fullscreen-triangle VAO and release it.
 *
 * Target: RTX 4070 / WebGL2. 1080p–4K @ 60 is comfortable.
 */

import { Renderer as ISFRenderer } from 'interactive-shader-format';
import { handle, installTextureBridge } from './isfTextureBridge';
import { audioBus } from './audioIn';
import { makeConvNode, isNativeNode, type ConvNode } from './convNodes';
import { TextSource } from './TextSource';
import { ParametricSource } from './ParametricSource';
import { CollageSource } from './CollageSource';
import { DepthShadow } from './depthShadow';
import { OutputShape } from './outputShape';
import { Cameraless } from './cameraless';
import { StrobeLimiter } from './strobeLimit';
import { PbrLib } from './pbrTextures';
import type { SidechainRef } from '@shared/types';
import { VideoSource } from './VideoSource';
import { AssembleSource } from './AssembleSource';
import { CaptureSource } from './CaptureSource';
import { HiveSource } from './HiveSource';
import { videoPlayheads, videoKey } from './videoState';
import type { SourceSlot } from '@shared/types';
import type { AssembleClip } from '@shared/assemble';
import type { CompositionState, FxInstance, FxScope } from '@shared/types';

installTextureBridge();

import type { BlendMode, LayerMask } from '@shared/types';
export type { BlendMode };

const QUAD_VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

// The 15 blend modes (indices match modeIndex below) : shared by the layer
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
// Per-layer spatial mask (0 none · 1 luma · 2 gradient · 3 shape).
uniform int mMode, mInvert;
uniform float mSoft, mLumaLo, mLumaHi, mAngle, mPos, mCx, mCy, mSize, mAspect, mRound;
${BLEND_GLSL}
float maskValue(vec2 p, vec3 topRgb){
  if (mMode == 0) return 1.0;
  float s = max(mSoft, 0.001);
  float m = 1.0;
  if (mMode == 1) {
    float l = dot(topRgb, vec3(0.299, 0.587, 0.114));
    m = smoothstep(mLumaLo - s, mLumaLo + s, l) * (1.0 - smoothstep(mLumaHi - s, mLumaHi + s, l));
  } else if (mMode == 2) {
    vec2 d = vec2(cos(mAngle), sin(mAngle));
    float t = dot(p - 0.5, d) + 0.5;              // 0..1 across the axis
    m = smoothstep(mPos - s, mPos + s, t);
  } else if (mMode == 3) {
    vec2 q = (p - vec2(mCx, mCy)) / vec2(max(mSize * mAspect, 1e-3), max(mSize, 1e-3));
    float dist = mix(max(abs(q.x), abs(q.y)), length(q), mRound); // box ↔ ellipse
    m = 1.0 - smoothstep(1.0 - s, 1.0 + s, dist);
  }
  if (mInvert == 1) m = 1.0 - m;
  return clamp(m, 0.0, 1.0);
}
void main(){
  vec4 B = texture(base, uv);
  vec4 T = texture(top, uv);
  vec3 c = blendMode(mode, B.rgb, T.rgb);
  float a = T.a * opacity * maskValue(uv, T.rgb);
  o = vec4(mix(B.rgb, c, a), max(B.a, a));
}`;

// Feedback persist: fresh frame smeared with the layer's previous frame.
// mix() (not add) keeps trails in the decay register : they always converge
// back to the fresh image instead of blooming toward white (brief §1).
const PERSIST_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src;    // this frame's processed layer output
uniform sampler2D prev;   // this layer's previous persisted frame
uniform float amount;     // 0 = plain copy, →1 = long trails
void main(){
  vec4 p = mix(texture(src, uv), texture(prev, uv), amount);
  // NaN/Inf guard: a single bad frame from any source would otherwise lock the
  // feedback buffer forever (NaN self-perpetuates through prev, and feedback
  // survives shader swaps). Fall back to the live source when the trail is bad.
  o = all(equal(p, p)) ? p : texture(src, uv);
}`;

// A/B source mix: out = mix(A, blendMode(A,B), x) : 'normal' degenerates to
// the plain crossfade; every other mode makes the mixer a two-source
// combinator with x as its depth.
const MIX_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D a;
uniform sampler2D b;
uniform sampler2D uState; // Consume/Reagent competition field (mode 17; unused otherwise)
uniform int mode;
uniform float x;          // 0 = A only, 1 = full blend result
uniform float bHue;       // B hue rotation (radians) : A/B harmony: 0 consonant, π dissonant
${BLEND_GLSL}
vec3 hueRot(vec3 c, float a){
  vec3 k = vec3(0.57735);
  float ca = cos(a), sa = sin(a);
  return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.0-ca);
}
void main(){
  vec4 A = texture(a, uv);
  vec4 B = texture(b, uv);
  B.rgb = clamp(hueRot(B.rgb, bHue), 0.0, 1.0);
  if(mode==15){
    // WEAVE (a luminance-displacement weave): each source's luminance displaces the
    // OTHER's sampling, then they interleave : a woven two-source warp.
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
    // LUMAKEY (a luma keyer): A shows where it's bright, B fills A's
    // dark areas (composite A over B, keying out A's near-black background).
    // x is the key threshold, with a soft knee.
    float la = dot(A.rgb, vec3(0.299,0.587,0.114));
    float k = smoothstep(x - 0.08, x + 0.08, la);
    o = vec4(mix(B.rgb, A.rgb, k), max(A.a, B.a));
    return;
  }
  if(mode==17){
    // CONSUME / REAGENT : a competition field phi (updated in a prior pass) migrates
    // between A and B — bright A eats toward A, bright B toward B, the boundary
    // diffusing. Near the contested front the two EMBRACE (average). Stateful.
    float phi = texture(uState, uv).r;
    float k = smoothstep(0.35, 0.65, phi);
    vec3 front = mix(B.rgb, A.rgb, k);
    float edge = 1.0 - abs(phi - 0.5) * 2.0;         // 1 at the migrating boundary
    vec3 embrace = (A.rgb + B.rgb) * 0.5;
    o = vec4(mix(front, embrace, edge * 0.4), max(A.a, B.a));
    return;
  }
  vec3 c = blendMode(mode, A.rgb, B.rgb);
  o = vec4(mix(A.rgb, c, x), max(A.a, B.a * x));
}`;

// Consume/Reagent state update : evolve the competition field phi one step. Bright A
// pushes phi → 1, bright B → 0 (each source EATS toward itself, brightness-weighted);
// a Laplacian diffuses the boundary so the front migrates and stays organic; a weak
// pull to neutral keeps it alive. NaN-guarded (the field ping-pongs across frames).
const REAGENT_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D a, b, uState;
uniform vec2 uTexel;
uniform float uRate;    // = sourceMix : how hard the sources eat
const vec3 LUM = vec3(0.299, 0.587, 0.114);
void main(){
  float phi = texture(uState, uv).r;
  if(!(phi == phi)) phi = 0.5;                       // NaN guard
  float lap = (texture(uState, uv + vec2(uTexel.x, 0.0)).r
             + texture(uState, uv - vec2(uTexel.x, 0.0)).r
             + texture(uState, uv + vec2(0.0, uTexel.y)).r
             + texture(uState, uv - vec2(0.0, uTexel.y)).r) * 0.25 - phi;
  phi += lap * 0.28;                                 // diffusion : boundary migrates
  float la = dot(texture(a, uv).rgb, LUM);
  float lb = dot(texture(b, uv).rgb, LUM);
  phi += (la * la - lb * lb) * (0.05 + uRate * 0.25); // reaction : brighter side eats
  phi += (0.5 - phi) * 0.012;                        // weak restoring : front stays alive
  o = vec4(clamp(phi, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

// Present / copy pass.
const COPY_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex;
void main(){ o = texture(tex, uv); }`;

// Projection warp (keystone / corner-pin): the composite is drawn as a quad
// with 4 movable corners, perspective-correct via the per-vertex q (w) coord,
// with an optional alignment grid + border for lining up on a projector.
const WARP_VS = `#version 300 es
in vec2 pos;      // clip-space corner
in vec3 uvq;      // u*q, v*q, q
out vec3 vUvq;
void main(){ vUvq = uvq; gl_Position = vec4(pos, 0.0, 1.0); }`;
const WARP_FS = `#version 300 es
precision highp float;
in vec3 vUvq; out vec4 o;
uniform sampler2D tex;
uniform float grid;   // >0.5 → draw the alignment overlay
void main(){
  vec2 uv = vUvq.xy / vUvq.z;
  vec4 c = texture(tex, uv);
  if (grid > 0.5){
    vec2 g = abs(fract(uv * 8.0) - 0.5);
    float line = smoothstep(0.47, 0.5, max(g.x, g.y));
    c.rgb = mix(c.rgb, vec3(0.0, 1.0, 1.0), line * 0.5);
    float edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
    c.rgb = mix(c.rgb, vec3(1.0, 0.2, 0.2), 1.0 - smoothstep(0.0, 0.006, edge));
  }
  o = c;
}`;

// Source framing: zoom about centre, pan, and per-edge crop (crop-to-fill).
// Sampling outside the visible region → transparent, so zoom-out shows black.
const XFORM_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex;
uniform float zoom;    // scale about centre (1 = none)
uniform vec2 pan;      // -1..1 shift
uniform vec4 crop;     // L, R, T, B  (0..~0.9)
void main(){
  // zoom + pan about centre → the visible region p in [0,1]
  vec2 p = (uv - 0.5) / max(zoom, 0.0001) + 0.5 - pan;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) { o = vec4(0.0); return; }
  // crop-to-fill: p maps into [cropL, 1-cropR] x [cropB, 1-cropT]
  vec2 s = vec2(crop.x + p.x * (1.0 - crop.x - crop.y),
                crop.w + p.y * (1.0 - crop.z - crop.w));
  o = texture(tex, s);
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
  dispose(gl: WebGL2RenderingContext) {
    gl.deleteFramebuffer(this.fbo[0]); gl.deleteFramebuffer(this.fbo[1]);
    gl.deleteTexture(this.tex[0]); gl.deleteTexture(this.tex[1]);
  }
}

/** Free a makeTarget()'s framebuffer + texture. */
function disposeTarget(gl: WebGL2RenderingContext, t: { fbo: WebGLFramebuffer; tex: WebGLTexture }) {
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

function lineIntersect(a1: number[], a2: number[], b1: number[], b2: number[]): number[] | null {
  const d = (a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((b1[0] - a1[0]) * (b2[1] - b1[1]) - (b1[1] - a1[1]) * (b2[0] - b1[0])) / d;
  return [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])];
}

/** 4 normalized corners (TL,TR,BR,BL; 0..1, top-left origin) → 6 verts of
 *  (clipX, clipY, u·q, v·q, q) for a perspective-correct textured quad. The q
 *  (w) coords come from the diagonal intersection so the mapping is a true
 *  keystone, not a bilinear smear. */
function computeWarpVerts(c: number[]): Float32Array {
  const p = [
    [c[0], c[1]],
    [c[2], c[3]],
    [c[4], c[5]],
    [c[6], c[7]]
  ];
  const q = [1, 1, 1, 1];
  const inter = lineIntersect(p[0], p[2], p[1], p[3]);
  if (inter) {
    const dist = p.map((pt) => Math.hypot(pt[0] - inter[0], pt[1] - inter[1]));
    for (let i = 0; i < 4; i++) {
      const dopp = dist[(i + 2) % 4];
      q[i] = dopp > 1e-6 ? (dist[i] + dopp) / dopp : 1;
    }
  }
  const uv = [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
  ];
  const clip = p.map((pt) => [pt[0] * 2 - 1, 1 - pt[1] * 2]);
  const idx = [0, 1, 2, 0, 2, 3];
  const out = new Float32Array(30);
  let o = 0;
  for (const i of idx) {
    out[o++] = clip[i][0];
    out[o++] = clip[i][1];
    out[o++] = uv[i][0] * q[i];
    out[o++] = uv[i][1] * q[i];
    out[o++] = q[i];
  }
  return out;
}

/**
 * The ISF runtime hardcodes `bindFramebuffer(FRAMEBUFFER, null)` for its final
 * (screen) pass. This proxy hands the runtime a GL context whose null-FBO binds
 * are redirected to a target of our choosing. One shared instance serves every
 * ISF renderer : draws are strictly sequential within a frame.
 */
export function makeRedirectableGL(gl: WebGL2RenderingContext): {
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
        // passes (bindTexture(target, null)) : which strips a multi-pass
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
 *  valid=false) on some sources : an uncaught throw here would propagate out
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
  // few frames. Reset at the top of syncFromState. TIME-gated too : on
  // ANGLE/D3D one compile+link can cost 100ms+, so once `until` passes no
  // further compiles start this frame (the first one always goes through, so
  // progress is guaranteed).
  budget: { n: number; until: number };
  // Dry/wet blend for per-FX opacity : writes into a dedicated ping-pong so it
  // can't collide with the chain buffers. Set by the Compositor once its blend
  // program is ready. Returns the texture holding mix(dry, wet, opacity).
  blendDryWet?: (dry: WebGLTexture, wet: WebGLTexture, opacity: number) => WebGLTexture;
  // Copy a texture straight into a framebuffer (used to draw a video frame into
  // a layer's scratch target). Set by the Compositor once copyProg exists.
  blit?: (src: WebGLTexture, dstFbo: WebGLFramebuffer) => void;
  // Framed blit : zoom / pan / crop a source frame into a target (video/capture).
  blitXform?: (src: WebGLTexture, dstFbo: WebGLFramebuffer, f: Framing) => void;
  // The shared per-frame audio texture (128×2 : row 0 waveform, row 1 spectrum),
  // pushed into any generator that declares an `audioTex` image input so each
  // element can ride its own live sample (the EYESY per-element gesture).
  audioTex?: import('./isfTextureBridge').TextureHandle;
}

// Generators that declare the `audioTex` image input : renderSource pushes the
// shared audio texture into these every frame (the bridge requires a re-push).
export const AUDIO_TEX_GENS = new Set([
  'ten-print', 'slabs', 'grid-drift', 'shapes', 'filaments', 'ash'
]);

export interface Framing {
  zoom: number;
  panX: number;
  panY: number;
  cropL: number;
  cropR: number;
  cropT: number;
  cropB: number;
}
const IDENTITY_FRAMING: Framing = { zoom: 1, panX: 0, panY: 0, cropL: 0, cropR: 0, cropT: 0, cropB: 0 };

// Generous COUNT cap (the time gate below is the real guard) : with a warm
// program cache a whole Randomize-All burst (~20 loads at <1ms each) lands
// inside one or two frames, so the crossfade covers the swap in one piece
// instead of layers popping in one by one.
// Generators whose picture is drawn by a TS class instead of the ISF runtime :
// their header-only ISF exists purely to give the Inspector / M / modulation /
// curated-Randomize surface. syncFromState must keep them OUT of setShader.
const NATIVE_SOURCE_IDS = new Set(['gen-text', 'gen-parametric', 'gen-collage']);

const LOADS_PER_FRAME = 12;
// ms of compile time allowed per frame : one heavy (cache-miss) compile may
// overshoot it, after which the rest of the queue defers to later frames.
const LOAD_MS_PER_FRAME = 8;
/** True when this frame's compile budget (count OR time) is exhausted. */
function budgetSpent(b: { n: number; until: number }): boolean {
  return b.n <= 0 || performance.now() >= b.until;
}

/** One live FX unit inside a rack. `isf` is null when the shader failed to
 *  compile : the unit still exists (so it isn't reloaded every frame) and
 *  simply passes the image through. */
interface FxUnit {
  instId: string;
  shaderId: string;
  isf: ISFRenderer | null;
  enabled: boolean;
  opacity: number; // dry/wet
  // Native convolution node (`node-*`): the TS class + its live params + the
  // sidechain ref (resolved to a texture by the compositor at apply time).
  node?: ConvNode | null;
  inputs?: Record<string, number | number[]>;
  sidechain?: SidechainRef | null;
}

// Everything a native node needs beyond its input texture: the sidechain
// resolver (ref → texture) and the frame delta. Supplied by the compositor.
export interface NodeApplyCtx {
  sidechainTex: (ref: SidechainRef | null | undefined) => WebGLTexture | null;
  dt: number;
  depth?: WebGLTexture | null; // shared scene-depth map for depth-aware nodes (Parallax)
}

/**
 * An ordered chain of ISF filter instances (per-source, per-layer, or master).
 * `sync()` reconciles live renderers against the store's FxInstance[] each
 * frame; `apply()` runs the enabled units, ping-ponging through the shared
 * chain buffers, and returns the resulting texture.
 */
class FxRack {
  private units: FxUnit[] = [];
  // Persistent id→unit index : O(1) modulation writes (setUnitInput runs once per
  // modulated input per frame) AND doubles as the reconcile map in sync(), so the
  // 60fps sync path allocates nothing (the old code built a fresh Map + arrays
  // per rack per frame — 14 racks of steady GC churn).
  private index = new Map<string, FxUnit>();
  private scratch: FxUnit[] = []; // swapped with `units` each sync : no array alloc

  constructor(private shared: SharedGL) {}

  sync(instances: FxInstance[], sourceById: (id: string) => string | null) {
    const byInst = this.index; // holds last frame's units : exactly the reconcile set
    const next = this.scratch;
    next.length = 0;
    for (const inst of instances) {
      if (!inst.shaderId) continue;
      let unit = byInst.get(inst.id);
      if (unit && unit.shaderId !== inst.shaderId) {
        unit.isf?.cleanup();
        unit.node?.dispose();
        unit = undefined;
      }
      const native = isNativeNode(inst.shaderId);
      if (!unit) {
        if (native) {
          // A native node compiles ALL its pass programs in its constructor —
          // as heavy as an ISF load, so it pays from the same per-frame budget
          // (a Randomize that lands nodes in several racks used to stall a
          // single frame for seconds).
          if (budgetSpent(this.shared.budget)) continue;
          this.shared.budget.n--;
          unit = {
            instId: inst.id, shaderId: inst.shaderId, isf: null, enabled: inst.enabled, opacity: 1,
            node: makeConvNode(this.shared.gl, inst.shaderId)
          };
        } else {
          const src = sourceById(inst.shaderId);
          // A compile costs from the per-frame budget; if spent, defer this
          // unit to a later frame (it just isn't in the chain this frame).
          if (src) {
            if (budgetSpent(this.shared.budget)) continue;
            this.shared.budget.n--;
          }
          // Create the unit even if the source is missing or the compile fails
          // (isf stays null) so we don't re-attempt the load every frame.
          const isf = src ? loadIsf(this.shared.rgl, inst.shaderId, src) : null;
          unit = { instId: inst.id, shaderId: inst.shaderId, isf, enabled: inst.enabled, opacity: 1 };
        }
      }
      unit.enabled = inst.enabled;
      unit.opacity = inst.opacity ?? 1;
      if (native) {
        // Native node: refresh its base params (modulation overlays these before
        // render via setUnitInput) and the sidechain ref.
        unit.inputs = { ...inst.inputs };
        unit.sidechain = inst.sidechain ?? null;
      } else if (unit.isf) {
        // Push declared param values (auto-UI / OSC write these to the store).
        // for-in : Object.entries allocates an array of pairs per unit per frame.
        for (const k in inst.inputs) unit.isf.setValue(k, inst.inputs[k]);
      }
      byInst.delete(inst.id);
      next.push(unit);
    }
    // Anything left in the map was removed from the rack.
    for (const gone of byInst.values()) { gone.isf?.cleanup(); gone.node?.dispose(); }
    // Swap the arrays and rebuild the index from the fresh list.
    this.scratch = this.units;
    this.units = next;
    byInst.clear();
    for (const u of next) byInst.set(u.instId, u);
  }

  /** Direct write to one unit's input (the modulation path). ISF units push to
   *  the renderer; native nodes overlay their live param map (read at render). */
  setUnitInput(instId: string, name: string, value: number | number[]): void {
    const u = this.index.get(instId);
    if (!u) return;
    if (u.node) { if (u.inputs) u.inputs[name] = value; }
    else u.isf?.setValue(name, value);
  }

  /** Feed a raw GL texture into one ISF unit's image input (via the texture
   *  bridge) : the Context PBR maps ride this every frame. */
  setUnitImage(instId: string, name: string, tex: import('./isfTextureBridge').TextureHandle): void {
    this.index.get(instId)?.isf?.setValue(name, tex);
  }

  /** Bind an image to `name` on every enabled ISF unit whose shader is in `ids`
   *  (used to feed the shared depth map to Parallax / any depth-aware FX). */
  bindImageByShader(ids: string[], name: string, tex: import('./isfTextureBridge').TextureHandle): void {
    for (const u of this.units) if (u.isf && ids.includes(u.shaderId)) u.isf.setValue(name, tex);
  }

  /** Assign this rack's clock (per-layer Speed : see isfTextureBridge). */
  setTime(tSec: number): void {
    for (const u of this.units) {
      if (u.isf) (u.isf as unknown as { __opsiaTimeSec?: number }).__opsiaTimeSec = tSec;
    }
  }

  /** Run the chain on `input`; returns the last written texture. `nodeCtx` is
   *  required for racks that may hold native convolution nodes (layer FX). */
  apply(input: WebGLTexture, chain: ChainBuffers, nodeCtx?: NodeApplyCtx): WebGLTexture {
    let cur = input;
    for (const u of this.units) {
      if (!u.enabled) continue;
      const dry = cur;
      let wet: WebGLTexture;
      if (u.node) {
        // Native convolution node : runs its own multi-pass render.
        if (!nodeCtx) continue; // rack not given a node context this frame
        wet = u.node.render({
          gl: this.shared.gl,
          chain,
          host: cur,
          sidechain: nodeCtx.sidechainTex(u.sidechain),
          inputs: u.inputs ?? {},
          dt: nodeCtx.dt,
          depth: nodeCtx.depth ?? null
        });
        if (wet === cur) continue; // node was inert (no sidechain) : passthrough
      } else if (u.isf) {
        const target = chain.next();
        u.isf.setValue('inputImage', handle(cur, chain.w, chain.h) as unknown as number);
        this.shared.redirect.redirect = target.fbo;
        u.isf.draw({ width: chain.w, height: chain.h });
        this.shared.redirect.redirect = null;
        wet = target.tex;
      } else {
        continue;
      }
      // Per-FX opacity: blend the wet result back over the dry input.
      cur =
        u.opacity < 0.999 && this.shared.blendDryWet
          ? this.shared.blendDryWet(dry, wet, u.opacity)
          : wet;
    }
    return cur;
  }

  dispose() {
    for (const u of this.units) { u.isf?.cleanup(); u.node?.dispose(); }
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
  dispose(gl: WebGL2RenderingContext) {
    disposeTarget(gl, this.t[0]); disposeTarget(gl, this.t[1]);
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
  /** A/B mix depth : 0 = A only. Ignored while B is empty. */
  sourceMix = 0;
  /** How B combines with A before the crossfade. */
  sourceBlend: BlendMode = 'normal';
  /** A/B harmony : 0 consonant (matched) · 1 dissonant (B hue clashes with A). */
  harmony = 0;
  /** Global time multiplier for this layer's sources + racks. */
  speed = 1;
  /** The layer's own clock (seconds) : advances by dt·speed each frame. */
  clockSec = 0;
  shaderIdA: string | null = null;
  shaderIdB: string | null = null;

  private isfA: ISFRenderer | null = null;
  private isfB: ISFRenderer | null = null;
  // Video-source slots (kind:'video'). Tracked alongside the ISF renderers; a
  // slot is EITHER an ISF generator OR a video, never both at once.
  private videoA: VideoSource | null = null;
  private videoB: VideoSource | null = null;
  private mediaIdA: string | null = null;
  private mediaIdB: string | null = null;
  /** Modulation seam for video slots : `position` (normalized playhead) and
   *  `speed` (rate multiplier) overrides, consumed by the source's next tick. */
  setVideoInput(slot: 'A' | 'B', name: string, v: number): void {
    // An Assemble slot answers to the same two names : `position` scrubs the
    // whole edit, `speed` scales it. (No grain — the cuts are the grain.)
    const as = slot === 'A' ? this.assembleA : this.assembleB;
    if (as) {
      if (name === 'position') as.setPosMod(v);
      else if (name === 'speed') as.setSpeedMod(v);
      return;
    }
    const vs = slot === 'A' ? this.videoA : this.videoB;
    if (!vs) return;
    if (name === 'position') vs.setPosMod(v);
    else if (name === 'speed') vs.setSpeedMod(v);
    else vs.setGrainMod(name, v);
  }
  // Assemble slots (kind:'assemble') : an edit decision list played live.
  private assembleA: AssembleSource | null = null;
  private assembleB: AssembleSource | null = null;
  private assembleIdA: string | null = null;
  private assembleIdB: string | null = null;
  // Live capture slots (kind:'capture'). Like video: a slot is one kind at once.
  private captureA: CaptureSource | null = null;
  private captureB: CaptureSource | null = null;
  private captureIdA: string | null = null;
  private captureIdB: string | null = null;
  // Live HIVE (HEVC-over-TCP) slots.
  private hiveA: HiveSource | null = null;
  private hiveB: HiveSource | null = null;
  private hiveIdA: string | null = null;
  private hiveIdB: string | null = null;
  // Native Text slots (generator 'gen-text' : typography, glyphs fillable by a
  // sidechain layer).
  private textA: TextSource | null = null;
  private textB: TextSource | null = null;
  // Native Parametric slots (generator 'gen-parametric' : audio→texture).
  private paramA: ParametricSource | null = null;
  private paramB: ParametricSource | null = null;
  // Native Collage slots (generator 'gen-collage' : a wall of films cut up by
  // the Autocutter's partition — owns its own pool of video decks).
  private collageA: CollageSource | null = null;
  private collageB: CollageSource | null = null;
  // Per-slot framing (zoom/pan/crop) for video + capture sources.
  private framingA: Framing = { ...IDENTITY_FRAMING };
  private framingB: Framing = { ...IDENTITY_FRAMING };
  rackA: FxRack;
  rackB: FxRack;
  rackLayer: FxRack;
  scratchA: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  scratchB: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  // Consume/Reagent competition field (lazy : only when the A/B mix uses 'consume').
  reagent: PingPong | null = null;
  // Spatial mask on this layer's stack contribution (null = none).
  mask: LayerMask | null = null;

  constructor(private shared: SharedGL, public w: number, public h: number) {
    this.pp = new PingPong(shared.gl, w, h);
    this.scratchA = makeTarget(shared.gl, w, h);
    this.scratchB = makeTarget(shared.gl, w, h);
    this.rackA = new FxRack(shared);
    this.rackB = new FxRack(shared);
    this.rackLayer = new FxRack(shared);
  }

  /** Load/swap/clear a source shader. Feedback buffers survive (brief §1).
   *  Records the requested id even when the compile FAILS : otherwise
   *  syncFromState would see the id still unmatched and re-attempt the load
   *  every frame (a 60 Hz shader-compile storm that stalls the driver). A
   *  failed shader just renders transparent until a different one is chosen. */
  setShader(slot: 'A' | 'B', id: string | null, source: string | null): void {
    // A real compile costs from the per-frame budget; if it's spent, defer —
    // leave the id unrecorded so syncFromState retries next frame.
    if (id && source) {
      if (budgetSpent(this.shared.budget)) return;
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

  /** Load/swap/clear a VIDEO source. Passing null (or a new mediaId) disposes
   *  the current clip. Cheap when the id is unchanged (the common per-frame
   *  case), so syncFromState can call it every frame. */
  setVideo(slot: 'A' | 'B', mediaId: string | null): void {
    const curId = slot === 'A' ? this.mediaIdA : this.mediaIdB;
    if (mediaId === curId) return; // no change
    const cur = slot === 'A' ? this.videoA : this.videoB;
    // A dispose error must never strand the slot on the OLD frozen source :
    // always fall through to loading the new clip.
    try { cur?.dispose(); } catch (e) { console.warn('[video] dispose failed:', e); }
    let next: VideoSource | null = null;
    if (mediaId) {
      next = new VideoSource(this.shared.gl);
      next.load(mediaId);
    }
    if (slot === 'A') { this.videoA = next; this.mediaIdA = mediaId; }
    else { this.videoB = next; this.mediaIdB = mediaId; }
  }

  /** Activate/refresh/clear an ASSEMBLE slot. Keyed by the assemblage id, which
   *  changes on every generate and Variation — so a re-roll swaps the edit and
   *  an untouched one is a cheap no-op every frame. */
  setAssemble(slot: 'A' | 'B', id: string | null, edl: AssembleClip[] | undefined, loop: boolean): void {
    const curId = slot === 'A' ? this.assembleIdA : this.assembleIdB;
    const cur = slot === 'A' ? this.assembleA : this.assembleB;
    if (id === curId) {
      // Same edit : `loop` is the only thing that can change without a re-id.
      cur?.setLoop(loop);
      return;
    }
    try { cur?.dispose(); } catch (e) { console.warn('[assemble] dispose failed:', e); }
    let next: AssembleSource | null = null;
    if (id && edl && edl.length) {
      next = new AssembleSource(this.shared.gl);
      next.setPlaylist(edl, loop);
    }
    if (slot === 'A') { this.assembleA = next; this.assembleIdA = id; }
    else { this.assembleB = next; this.assembleIdB = id; }
  }

  /** The live AssembleSource on a slot, if any. The renderer uses this to hand
   *  target-driven edits their matcher (which needs the corpus from the store,
   *  so it cannot be built down here). */
  assemble(slot: 'A' | 'B'): AssembleSource | null {
    return slot === 'A' ? this.assembleA : this.assembleB;
  }

  /** Per-frame clock for assemble slots, mirroring tickVideos. Only touches a
   *  playhead entry when this slot IS an assemblage — tickVideos owns the same
   *  key for video slots and must not be clobbered. */
  tickAssemble(layerIndex: number, rawDt: number, mul: number): void {
    for (const slot of ['A', 'B'] as const) {
      const a = slot === 'A' ? this.assembleA : this.assembleB;
      if (!a) continue;
      try { a.tick(rawDt, mul); } catch { /* a bad clip must not stall the frame */ }
      videoPlayheads.set(videoKey(layerIndex, slot), { time: a.position(), duration: a.totalDuration() });
    }
  }

  /** Activate/refresh/clear a native TEXT source. Called every frame by
   *  syncFromState (cheap when unchanged) : cfg carries the base state. */
  setText(
    slot: 'A' | 'B',
    cfg: { text: string; inputs: Record<string, number | number[]>; sidechain: SidechainRef | null } | null
  ): void {
    const cur = slot === 'A' ? this.textA : this.textB;
    if (!cfg) {
      if (cur) {
        cur.dispose();
        if (slot === 'A') this.textA = null;
        else this.textB = null;
      }
      return;
    }
    let src = cur;
    if (!src) {
      src = new TextSource(this.shared.gl, this.w, this.h);
      if (slot === 'A') this.textA = src;
      else this.textB = src;
    }
    src.update(cfg.text, cfg.inputs, cfg.sidechain);
  }

  /** Activate/refresh/clear a native PARAMETRIC source (audio→texture). */
  setParam(slot: 'A' | 'B', cfg: { inputs: Record<string, number | number[]> } | null): void {
    const cur = slot === 'A' ? this.paramA : this.paramB;
    if (!cfg) {
      if (cur) {
        cur.dispose();
        if (slot === 'A') this.paramA = null; else this.paramB = null;
      }
      return;
    }
    let src = cur;
    if (!src) {
      src = new ParametricSource(this.shared.gl, this.w, this.h);
      if (slot === 'A') this.paramA = src; else this.paramB = src;
    }
    src.update(cfg.inputs);
  }

  /** Activate/refresh/clear a native COLLAGE source (a wall of film pieces). */
  setCollage(
    slot: 'A' | 'B',
    cfg: { pool: import('@shared/collage').CollageClip[]; inputs: Record<string, number | number[]> } | null
  ): void {
    const cur = slot === 'A' ? this.collageA : this.collageB;
    if (!cfg) {
      if (cur) {
        cur.dispose();
        if (slot === 'A') this.collageA = null; else this.collageB = null;
      }
      return;
    }
    let src = cur;
    if (!src) {
      src = new CollageSource(this.shared.gl, this.w, this.h);
      if (slot === 'A') this.collageA = src; else this.collageB = src;
    }
    src.update(cfg.pool, cfg.inputs);
  }

  /** Load/swap/clear a live CAPTURE source ('webcam' | 'screen' | 'desktop:id'). */
  setCapture(slot: 'A' | 'B', spec: string | null): void {
    const curId = slot === 'A' ? this.captureIdA : this.captureIdB;
    if (spec === curId) return;
    const cur = slot === 'A' ? this.captureA : this.captureB;
    cur?.dispose();
    let next: CaptureSource | null = null;
    if (spec) {
      next = new CaptureSource(this.shared.gl);
      void next.start(spec);
    }
    if (slot === 'A') { this.captureA = next; this.captureIdA = spec; }
    else { this.captureB = next; this.captureIdB = spec; }
  }

  /** Load/swap/clear a live HIVE source (spec = 'host:port'). */
  setHive(slot: 'A' | 'B', spec: string | null): void {
    const curId = slot === 'A' ? this.hiveIdA : this.hiveIdB;
    if (spec === curId) return;
    const cur = slot === 'A' ? this.hiveA : this.hiveB;
    cur?.dispose();
    let next: HiveSource | null = null;
    if (spec) {
      next = new HiveSource(this.shared.gl);
      next.start(spec);
    }
    if (slot === 'A') { this.hiveA = next; this.hiveIdA = spec; }
    else { this.hiveB = next; this.hiveIdB = spec; }
  }

  /** Push framing (zoom/pan/crop) to a video or capture slot. */
  setFraming(slot: 'A' | 'B', s: SourceSlot | null | undefined): void {
    if (!s) return;
    const f: Framing = {
      zoom: s.zoom ?? 1,
      panX: s.panX ?? 0,
      panY: s.panY ?? 0,
      cropL: s.cropL ?? 0,
      cropR: s.cropR ?? 0,
      cropT: s.cropT ?? 0,
      cropB: s.cropB ?? 0
    };
    if (slot === 'A') this.framingA = f;
    else this.framingB = f;
  }

  /** Push transport params (play/speed/reverse/loop/in/out) to a video slot. */
  setVideoPlayback(slot: 'A' | 'B', s: SourceSlot | null | undefined): void {
    // Assemble slots share the transport's play/pause flag but have none of the
    // trim / direction / granulation machinery.
    const a = slot === 'A' ? this.assembleA : this.assembleB;
    if (a && s) {
      a.setPlaying(s.videoPlaying ?? true);
      // The slot's own speed multiplies the whole edit on top of each clip's
      // rate. Without this the Inspector's speed slider wrote a value nothing
      // ever read.
      a.setRate(s.videoSpeed ?? 1);
      return;
    }
    const v = slot === 'A' ? this.videoA : this.videoB;
    if (!v || !s) return;
    v.setPlayback({
      playing: s.videoPlaying ?? true,
      speed: s.videoSpeed ?? 1,
      direction: s.videoDirection ?? (s.videoReverse ? 'reverse' : 'forward'),
      loop: s.videoLoop ?? true,
      inN: s.videoIn ?? 0,
      outN: s.videoOut ?? 1
    });
    v.setGrain({
      on: s.grainOn ?? false,
      size: s.grainSize ?? 0.25,
      spray: s.grainSpray ?? 0.15,
      reverseP: s.grainReverse ?? 0.25,
      jitter: s.grainJitter ?? 0.2,
      sync: s.grainSync ?? 0
    });
  }

  /** Drive video playheads and publish them for the Inspector timeline.
   *  `rawDt` is the real frame delta; `mul` is this layer's speed × global speed
   *  (the rate over realtime) : so both scale the clip on top of its own speed. */
  tickVideos(layerIndex: number, rawDt: number, mul: number, bpm = 120): void {
    for (const slot of ['A', 'B'] as const) {
      const v = slot === 'A' ? this.videoA : this.videoB;
      const key = videoKey(layerIndex, slot);
      if (v) {
        v.tick(rawDt, mul, bpm);
        videoPlayheads.set(key, { time: v.time(), duration: v.duration() });
      } else {
        videoPlayheads.delete(key);
      }
    }
  }

  setInput(slot: 'A' | 'B', name: string, value: number | number[]) {
    (slot === 'A' ? this.isfA : this.isfB)?.setValue(name, value);
    (slot === 'A' ? this.textA : this.textB)?.setInput(name, value); // modulation on text params
    (slot === 'A' ? this.paramA : this.paramB)?.setInput(name, value); // modulation on parametric params
    (slot === 'A' ? this.collageA : this.collageB)?.setInput(name, value); // modulation on collage params
  }

  hasB(): boolean { return this.isfB !== null || this.videoB !== null || this.captureB !== null || this.hiveB !== null || this.textB !== null || this.paramB !== null || this.collageB !== null || this.assembleB !== null; }

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

  /** Draw a source (ISF generator, video frame, or native text) into its
   *  scratch target. Empty/not-yet-ready → transparent. `sidechainTex` resolves
   *  a native source's sidechain ref to a live texture (text glyph fill). */
  renderSource(slot: 'A' | 'B', sidechainTex?: (ref: SidechainRef | null | undefined) => WebGLTexture | null) {
    const gl = this.shared.gl;
    const scratch = slot === 'A' ? this.scratchA : this.scratchB;
    const isf = slot === 'A' ? this.isfA : this.isfB;
    const video = slot === 'A' ? this.videoA : this.videoB;
    const capture = slot === 'A' ? this.captureA : this.captureB;
    const hive = slot === 'A' ? this.hiveA : this.hiveB;
    const text = slot === 'A' ? this.textA : this.textB;
    const param = slot === 'A' ? this.paramA : this.paramB;

    // Native text: rasterized glyphs × (sidechain material | solid colour).
    if (text) {
      text.render(scratch.fbo, sidechainTex ? sidechainTex(text.sidechain) : null);
      return;
    }

    // Native parametric: the audio buffer rendered as raster/waveform/spectrogram.
    if (param) {
      param.render(scratch.fbo);
      return;
    }

    // Native collage: a wall of simultaneous films through the cut-up partition.
    const collage = slot === 'A' ? this.collageA : this.collageB;
    if (collage) {
      collage.render(scratch.fbo);
      return;
    }

    // Video / live-capture / HIVE slot: upload the current frame and blit (with
    // the slot's zoom/pan/crop framing) into scratch.
    const feed = video ?? capture ?? hive ?? (slot === 'A' ? this.assembleA : this.assembleB);
    if (feed) {
      const tex = feed.upload();
      const framing = slot === 'A' ? this.framingA : this.framingB;
      if (tex && this.shared.blitXform) {
        this.shared.blitXform(tex, scratch.fbo, framing);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.fbo);
        gl.viewport(0, 0, this.w, this.h);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      }
      return;
    }

    if (!isf) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.fbo);
      gl.viewport(0, 0, this.w, this.h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    // Per-element audio : generators that declare `audioTex` get the shared
    // 128×2 waveform/spectrum texture, re-pushed each frame (bridge contract).
    const sid = slot === 'A' ? this.shaderIdA : this.shaderIdB;
    if (sid && this.shared.audioTex && AUDIO_TEX_GENS.has(sid)) {
      isf.setValue('audioTex', this.shared.audioTex);
    }
    this.shared.redirect.redirect = scratch.fbo;
    isf.draw({ width: this.w, height: this.h });
    this.shared.redirect.redirect = null;
  }

  /** The persisted (post-feedback) frame : what the blend stack composites. */
  texture(): WebGLTexture { return this.pp.out(); }

  /** Release every GL resource this layer owns (renderers, racks, buffers). */
  dispose(): void {
    const gl = this.shared.gl;
    this.isfA?.cleanup();
    this.isfB?.cleanup();
    this.videoA?.dispose();
    this.videoB?.dispose();
    this.assembleA?.dispose();
    this.assembleB?.dispose();
    this.collageA?.dispose();
    this.collageB?.dispose();
    this.captureA?.dispose();
    this.captureB?.dispose();
    this.hiveA?.dispose();
    this.hiveB?.dispose();
    this.textA?.dispose();
    this.textB?.dispose();
    this.paramA?.dispose();
    this.paramB?.dispose();
    this.rackA.dispose();
    this.rackB.dispose();
    this.rackLayer.dispose();
    this.pp.dispose(gl);
    disposeTarget(gl, this.scratchA);
    disposeTarget(gl, this.scratchB);
    this.reagent?.dispose(gl);
  }
}

export class Compositor {
  gl: WebGL2RenderingContext;
  layers: ISFLayer[] = [];
  masterRack: FxRack;
  // Background slab : the ground under the stack: one generator + its own FX
  // rack + its own slow clock, composited first (blend 'normal').
  private bgIsf: ISFRenderer | null = null;
  private bgShaderId: string | null = null;
  private bgRack: FxRack;
  private bgScratch!: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private bgClockSec = 0;
  private bgOpacity = 0;
  private bgSpeed = 0.25;
  private bgDepth = 0;
  private bgIsolate = false; // true → the 4 layers composite as their own group
  private depthShadow: DepthShadow | null = null;
  // Finalizer output stage (shape + outside fill), applied last.
  private outputShape: OutputShape | null = null;
  private bgFill!: { fbo: WebGLFramebuffer; tex: WebGLTexture }; // stable copy of the bg for the fill
  private fzShape = 0;
  private fzSize = 0.7;
  private fzAngle = 0;
  private fzPosX = 0;
  private fzPosY = 0;
  private fzBgSrc = 0; // raw outBgSource (0 colour · 1 bg layer)
  private fzBgColor: number[] = [0, 0, 0];
  private fzDepth = 0; // shape drop-shadow onto the fill (float-over feel)
  private fzShadowAngle = -0.98; // direction the shape's shadow falls
  private fzPersp = 0; // perspective projection of the cast shadow
  private fzInstId: string | null = null; // the pinned finalizer's instance id

  // Strobe-safety limiter : slew-limits full-field luminance jumps on the FINAL
  // presented frame (photosensitive safety). 0 = off. Applied last, before present.
  private strobeLimiter: StrobeLimiter | null = null;
  private strobeSafe = 0;
  /** Flash-safety amount 0..1 (0 = off). Higher = tighter mean-luminance cap. */
  setStrobeSafe(v: number): void { this.strobeSafe = v; }
  // Cameraless / direct-film stage (after outputShape, before xfade). Params live
  // on the Finalizer (cf* ← film* inputs), applied natively like the fz* shaper.
  private cameraless: Cameraless | null = null;
  private cfHold = 0; // 0 off · 1 film-hold · 2 freeze
  private cfRate = 8;
  private cfJitter = 0.3;
  private cfBoil = 0.35;
  private cfFlutter = 0.2;
  private cfBlank = 0;
  private cfBlankMode = 0;
  private cfDust = 0;
  private cfScratch = 0;
  private cfGranule = 0;
  private cfSplice = 0;
  private pbrLib: PbrLib | null = null; // Context PBR material maps (lazy)
  // Outside fill = the Background slab, only meaningful with a shape active.
  private get fzBgLayer(): boolean {
    return this.fzShape > 0 && this.fzBgSrc === 1;
  }
  private shared: SharedGL;
  private chain: ChainBuffers;
  private mixTarget: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  // Off-chain hold for source A's post-rack signal while source B's rack runs
  // (both racks share one ChainBuffers, so B could otherwise clobber A).
  private abHold!: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  // Dedicated dry/wet ping-pong for per-FX opacity (kept off the main chain).
  private fxOpac: [{ fbo: WebGLFramebuffer; tex: WebGLTexture }, { fbo: WebGLFramebuffer; tex: WebGLTexture }] | null = null;
  private fxOpacI = 0;
  // Scene crossfade (Randomize / scene morph). `snapshot` always holds the last
  // presented frame; when a morph begins we freeze it and dissolve into the new
  // scene over `xfadeMs`, so even a structural change (new shaders) morphs.
  private snapshot!: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private xfadeTarget!: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private xfadeActive = false;
  private xfadeStartMs = -1;
  private xfadeMs = 0;
  // The texture presented last frame : snapshotted into `snapshot` the moment a
  // crossfade begins (so no per-frame blit in the steady state).
  private lastPresent: WebGLTexture | null = null;
  // Monomedia "freeze" drop: hold the last presented frame on screen (the
  // sequencer's freeze-style punctuation). Captured into `snapshot` on the first
  // frozen frame; safe because monomedia recalls are hard cuts (no xfade).
  private freezeActive = false;
  private freezeCaptured = false;
  // Output readback (Spout/NDI seam) : set to a callback to grab the final RGBA8
  // frame each frame; null (default) → zero cost.
  private outputCapture: ((w: number, h: number, px: Uint8Array) => void) | null = null;
  private readbackBuf: Uint8Array | null = null;
  // Async readback (Spout/NDI) : two PIXEL_PACK PBOs ping-pong so readPixels
  // never stalls the pipeline. Frame N reads into one PBO (async) while frame
  // N-1's pixels are harvested from the other once its fence signals : one
  // frame of sink latency instead of a full GPU flush every frame.
  private capPbos: [WebGLBuffer, WebGLBuffer] | null = null;
  private capSyncs: [WebGLSync | null, WebGLSync | null] = [null, null];
  private capW = 0;
  private capH = 0;
  private capPhase = 0;

  private freeCapturePbos(): void {
    const gl = this.gl;
    if (this.capPbos) {
      gl.deleteBuffer(this.capPbos[0]);
      gl.deleteBuffer(this.capPbos[1]);
      this.capPbos = null;
    }
    for (let i = 0; i < 2; i++) {
      if (this.capSyncs[i]) { gl.deleteSync(this.capSyncs[i]!); this.capSyncs[i] = null; }
    }
    this.capW = this.capH = 0;
    this.capPhase = 0;
  }
  // Global time multiplier (1/64×…64×) : scales every visual clock.
  private globalSpeed = 1;
  private blendProg: WebGLProgram;
  private persistProg: WebGLProgram;
  private mixProg: WebGLProgram;
  private copyProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private quadBuf: WebGLBuffer;    // the fullscreen-triangle vertex buffer
  private acc: PingPong;            // accumulator for the layer stack
  private uBase: WebGLUniformLocation; private uTop: WebGLUniformLocation;
  private uMode: WebGLUniformLocation; private uOpac: WebGLUniformLocation;
  private uMask: Record<string, WebGLUniformLocation | null> = {};
  private uPSrc: WebGLUniformLocation; private uPPrev: WebGLUniformLocation;
  private uPAmt: WebGLUniformLocation;
  private uMA: WebGLUniformLocation; private uMB: WebGLUniformLocation;
  private uMX: WebGLUniformLocation; private uMMode: WebGLUniformLocation;
  private uMBHue!: WebGLUniformLocation; private uMState!: WebGLUniformLocation;
  // Consume/Reagent competition-field update program.
  private reagentProg!: WebGLProgram;
  private uRA!: WebGLUniformLocation; private uRB!: WebGLUniformLocation;
  private uRState!: WebGLUniformLocation; private uRTexel!: WebGLUniformLocation;
  private uRRate!: WebGLUniformLocation;
  private uCTex: WebGLUniformLocation;
  private xformProg!: WebGLProgram;
  private uXTex!: WebGLUniformLocation; private uXZoom!: WebGLUniformLocation;
  private uXPan!: WebGLUniformLocation; private uXCrop!: WebGLUniformLocation;
  // Projection warp present pass.
  private warpProg!: WebGLProgram;
  private warpVao!: WebGLVertexArrayObject;
  private warpBuf!: WebGLBuffer;
  private uWTex!: WebGLUniformLocation; private uWGrid!: WebGLUniformLocation;
  private warpActive = false;
  private warpGridOn = false;
  private warpCorners: number[] = [];
  private modeIndex: Record<BlendMode, number> = {
    normal: 0, add: 1, subtract: 2, multiply: 3, screen: 4, overlay: 5,
    softlight: 6, hardlight: 7, darken: 8, lighten: 9, difference: 10,
    exclusion: 11, dodge: 12, burn: 13, wrap: 14, weave: 15, lumakey: 16, consume: 17
  };

  constructor(public canvas: HTMLCanvasElement, public w = 1920, public h = 1080) {
    // preserveDrawingBuffer so canvas.captureStream() (the output-window mirror)
    // reliably reads the frame instead of capturing black after the buffer swap.
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true })!;
    if (!gl) throw new Error('WebGL2 unavailable');
    // RGBA16F render targets need this : without it every FBO is incomplete and
    // the whole engine renders black. Surface it rather than fail silently.
    if (!gl.getExtension('EXT_color_buffer_float')) {
      console.error('[Compositor] EXT_color_buffer_float unavailable : float render targets will fail (black output)');
    }
    this.gl = gl;
    const wrapped = makeRedirectableGL(gl);
    this.shared = { gl, rgl: wrapped.gl, redirect: wrapped.state, budget: { n: 0, until: 0 } };

    const quad = new Float32Array([-1,-1, 3,-1, -1,3]); // fullscreen triangle
    this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    this.quadBuf = buf;
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Leave the default VAO for the ISF runtime : it sets up its own attribute
    // state there (WebGL1-style). Our passes bind this.vao explicitly.
    gl.bindVertexArray(null);

    this.blendProg = compile(gl, QUAD_VS, BLEND_FS);
    this.uBase = gl.getUniformLocation(this.blendProg, 'base')!;
    this.uTop  = gl.getUniformLocation(this.blendProg, 'top')!;
    this.uMode = gl.getUniformLocation(this.blendProg, 'mode')!;
    this.uOpac = gl.getUniformLocation(this.blendProg, 'opacity')!;
    for (const n of ['mMode', 'mInvert', 'mSoft', 'mLumaLo', 'mLumaHi', 'mAngle', 'mPos', 'mCx', 'mCy', 'mSize', 'mAspect', 'mRound']) {
      this.uMask[n] = gl.getUniformLocation(this.blendProg, n);
    }

    this.persistProg = compile(gl, QUAD_VS, PERSIST_FS);
    this.uPSrc  = gl.getUniformLocation(this.persistProg, 'src')!;
    this.uPPrev = gl.getUniformLocation(this.persistProg, 'prev')!;
    this.uPAmt  = gl.getUniformLocation(this.persistProg, 'amount')!;

    this.mixProg = compile(gl, QUAD_VS, MIX_FS);
    this.uMA = gl.getUniformLocation(this.mixProg, 'a')!;
    this.uMB = gl.getUniformLocation(this.mixProg, 'b')!;
    this.uMX = gl.getUniformLocation(this.mixProg, 'x')!;
    this.uMMode = gl.getUniformLocation(this.mixProg, 'mode')!;
    this.uMBHue = gl.getUniformLocation(this.mixProg, 'bHue')!;
    this.uMState = gl.getUniformLocation(this.mixProg, 'uState')!;

    this.reagentProg = compile(gl, QUAD_VS, REAGENT_FS);
    this.uRA = gl.getUniformLocation(this.reagentProg, 'a')!;
    this.uRB = gl.getUniformLocation(this.reagentProg, 'b')!;
    this.uRState = gl.getUniformLocation(this.reagentProg, 'uState')!;
    this.uRTexel = gl.getUniformLocation(this.reagentProg, 'uTexel')!;
    this.uRRate = gl.getUniformLocation(this.reagentProg, 'uRate')!;

    this.copyProg = compile(gl, QUAD_VS, COPY_FS);
    this.uCTex = gl.getUniformLocation(this.copyProg, 'tex')!;

    this.xformProg = compile(gl, QUAD_VS, XFORM_FS);
    this.uXTex = gl.getUniformLocation(this.xformProg, 'tex')!;
    this.uXZoom = gl.getUniformLocation(this.xformProg, 'zoom')!;
    this.uXPan = gl.getUniformLocation(this.xformProg, 'pan')!;
    this.uXCrop = gl.getUniformLocation(this.xformProg, 'crop')!;

    // Warp present pass : its own VAO with a 6-vertex (2-triangle) quad, each
    // vertex (x,y, u*q,v*q,q) = 5 floats, re-uploaded when the corners move.
    this.warpProg = compile(gl, WARP_VS, WARP_FS);
    this.uWTex = gl.getUniformLocation(this.warpProg, 'tex')!;
    this.uWGrid = gl.getUniformLocation(this.warpProg, 'grid')!;
    const wpos = gl.getAttribLocation(this.warpProg, 'pos');
    const wuvq = gl.getAttribLocation(this.warpProg, 'uvq');
    this.warpVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.warpVao);
    this.warpBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.warpBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 30 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(wpos);
    gl.vertexAttribPointer(wpos, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(wuvq);
    gl.vertexAttribPointer(wuvq, 3, gl.FLOAT, false, 20, 8);
    gl.bindVertexArray(null);

    this.acc = new PingPong(gl, w, h);
    this.chain = new ChainBuffers(gl, w, h);
    this.mixTarget = makeTarget(gl, w, h);
    this.abHold = makeTarget(gl, w, h);
    this.bgScratch = makeTarget(gl, w, h);
    this.bgFill = makeTarget(gl, w, h);
    this.snapshot = makeTarget(gl, w, h);
    this.xfadeTarget = makeTarget(gl, w, h);
    this.fxOpac = [makeTarget(gl, w, h), makeTarget(gl, w, h)];
    // Now that the blend program + its uniforms exist, expose the dry/wet mix
    // to the racks. Alternating the two targets guarantees dst ≠ dry.
    this.shared.blendDryWet = (dry, wet, opacity) => {
      this.fxOpacI = 1 - this.fxOpacI;
      const t = this.fxOpac![this.fxOpacI];
      this.blendInto(t.fbo, dry, wet, 'normal', opacity);
      return t.tex;
    };
    this.shared.blit = (src, dstFbo) => this.copyInto(dstFbo, src);
    this.shared.blitXform = (src, dstFbo, f) => {
      gl.bindVertexArray(this.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
      gl.viewport(0, 0, this.w, this.h);
      gl.useProgram(this.xformProg);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(this.uXTex, 0);
      gl.uniform1f(this.uXZoom, f.zoom);
      gl.uniform2f(this.uXPan, f.panX, f.panY);
      gl.uniform4f(this.uXCrop, f.cropL, f.cropR, f.cropT, f.cropB);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    };
    this.masterRack = new FxRack(this.shared);
    this.bgRack = new FxRack(this.shared);
    for (let i = 0; i < 4; i++) this.layers.push(new ISFLayer(this.shared, w, h));
  }

  /** Global time multiplier (1/64×…64×) : scales the master + layer clocks. */
  setGlobalSpeed(x: number): void {
    this.globalSpeed = Math.max(1 / 64, Math.min(64, x));
  }

  /** Begin dissolving the frozen last frame into the new scene over `ms`.
   *  Driven by the render loop from a morph (Randomize / scene recall). Called
   *  BEFORE this frame's render(), while `lastPresent` still holds the previous
   *  (old-scene) frame : snapshot it here rather than blitting every frame. */
  beginCrossfade(ms: number): void {
    if (ms <= 20) return;
    if (this.lastPresent) this.copyInto(this.snapshot.fbo, this.lastPresent);
    this.xfadeActive = true;
    this.xfadeStartMs = -1; // stamped on the next render (loop clock)
    this.xfadeMs = ms;
  }

  /** Freeze/unfreeze the presented frame (monomedia freeze-drop). */
  setFreeze(on: boolean): void {
    if (on) {
      if (!this.freezeActive) { this.freezeActive = true; this.freezeCaptured = false; }
    } else {
      this.freezeActive = false;
      this.freezeCaptured = false;
    }
  }

  /** Enable/disable final-frame readback for external output (Spout/NDI). The
   *  callback gets the presented RGBA8 frame each frame (GL bottom-up). */
  setOutputCapture(cb: ((w: number, h: number, px: Uint8Array) => void) | null): void {
    this.outputCapture = cb;
  }

  /** Compile ONE shader (or native node) and immediately discard it : startup
   *  warm-up. The compiled program lands in Chromium's GPU program cache
   *  (memory + disk), so every later load of the same source — Randomize's
   *  bursts above all — is a cache hit instead of a 100ms+ driver compile.
   *  Call one per frame from the render loop until the registry is warm. */
  prewarmShader(id: string, source: string | null): void {
    try {
      if (isNativeNode(id)) {
        makeConvNode(this.gl, id)?.dispose();
      } else if (source) {
        loadIsf(this.shared.rgl, id, source)?.cleanup();
      }
    } catch (e) {
      console.warn('[prewarm]', id, e);
    }
  }

  // ── Animated sound (spec §4.4): read one horizontal scanline of the PRESENTED
  //    frame and downsample it to `n` luma samples in 0..1 : the "optical
  //    soundtrack" a drawn gesture writes. Cheap (one row, sub-rect readback).
  //    Call AFTER render() (the default framebuffer then holds the presented frame).
  private markStripBuf: Uint8Array | null = null;
  // ── Vision feature sampling (the return path : image → control) ──────────
  private visionFbo: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private visionBuf: Uint8Array | null = null;
  private visionSize = 0;

  /** Downsample the just-presented frame to a size×size grid and read it back (a
   *  few KB) so the renderer can extract control features from the picture. One
   *  linear-filtered copy draw : a sparse but representative sample, cheap. Call
   *  AFTER render() (uses the presented texture). Null if nothing shown yet. */
  visionSample(size: number): { grid: Uint8Array; size: number } | null {
    const gl = this.gl;
    if (!this.lastPresent) return null;
    if (!this.visionFbo || this.visionSize !== size) {
      if (this.visionFbo) { gl.deleteFramebuffer(this.visionFbo.fbo); gl.deleteTexture(this.visionFbo.tex); }
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.visionFbo = { fbo, tex };
      this.visionSize = size;
      this.visionBuf = new Uint8Array(size * size * 4);
    }
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.visionFbo.fbo);
    gl.viewport(0, 0, size, size);
    gl.useProgram(this.copyProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.lastPresent); gl.uniform1i(this.uCTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, this.visionBuf as Uint8Array);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    return { grid: this.visionBuf as Uint8Array, size };
  }

  // ── Sonify tap readback : a 96×96 downsample of the presented frame OR one
  //    layer's post-FX image, read by the sonification engine at ~30Hz. Same
  //    pattern as visionSample (tiny sync read after a downsample draw). ──
  private soniFbo: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;

  readSonifyGrid(kind: 'master' | 'layer', layer: number, out: Uint8Array): boolean {
    const gl = this.gl;
    const size = 96;
    if (out.length < size * size * 4) return false;
    const src = kind === 'master' ? this.lastPresent : this.layers[layer]?.texture() ?? null;
    if (!src) return false;
    if (!this.soniFbo) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.soniFbo = { fbo, tex };
    }
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.soniFbo.fbo);
    gl.viewport(0, 0, size, size);
    gl.useProgram(this.copyProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(this.uCTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    return true;
  }

  // ── Depth map (2.5D) : the shared grayscale depth the Parallax FX reads (and
  //    later Context / anaglyph). Filled synthetically or by the depth estimator. ──
  private depthTex: WebGLTexture | null = null;
  private depthAcc: Float32Array | null = null;
  private depthRGBA: Uint8Array | null = null;
  private depthW = 0;
  private depthH = 0;
  private depthFbo: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private depthReadBuf: Uint8Array | null = null;
  private depthReadSize = 0;

  private ensureDepth(w: number, h: number): void {
    if (this.depthTex && this.depthW === w && this.depthH === h) return;
    const gl = this.gl;
    if (this.depthTex) gl.deleteTexture(this.depthTex);
    this.depthTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.depthAcc = new Float32Array(w * h);
    this.depthRGBA = new Uint8Array(w * h * 4);
    this.depthW = w; this.depthH = h;
  }

  /** Push a grayscale depth map (0..1) with temporal EMA; upload to depthTex. */
  setDepth(data: Float32Array, w: number, h: number, ema: number): void {
    const first = !this.depthTex || this.depthW !== w || this.depthH !== h;
    this.ensureDepth(w, h);
    const acc = this.depthAcc as Float32Array, rgba = this.depthRGBA as Uint8Array;
    const k = first ? 1 : Math.max(0, Math.min(1, ema));
    const n = w * h;
    for (let i = 0; i < n; i++) {
      acc[i] += (data[i] - acc[i]) * k;
      let v = acc[i] * 255; v = v < 0 ? 0 : v > 255 ? 255 : v;
      const b = v | 0;
      rgba[i * 4] = b; rgba[i * 4 + 1] = b; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  /** Flat 0.5 depth → the Parallax FX becomes a passthrough (Depth off). */
  clearDepth(): void {
    const d = new Float32Array(4); d.fill(0.5);
    this.setDepth(d, 2, 2, 1);
  }

  /** A synthetic depth bowl (centre near → edges far) : a test map, no model. */
  setSyntheticDepth(): void {
    const S = 64, d = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x / (S - 1) - 0.5, dy = y / (S - 1) - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 1.7;
      d[y * S + x] = Math.max(0, Math.min(1, 1 - r));
    }
    this.setDepth(d, S, S, 1);
  }

  /** Read the presented frame down to size×size RGBA (the depth estimator input). */
  depthFrame(size: number): { data: Uint8Array; w: number; h: number } | null {
    const gl = this.gl;
    if (!this.lastPresent) return null;
    if (!this.depthFbo || this.depthReadSize !== size) {
      if (this.depthFbo) { gl.deleteFramebuffer(this.depthFbo.fbo); gl.deleteTexture(this.depthFbo.tex); }
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.depthFbo = { fbo, tex }; this.depthReadSize = size;
      this.depthReadBuf = new Uint8Array(size * size * 4);
    }
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.depthFbo.fbo);
    gl.viewport(0, 0, size, size);
    gl.useProgram(this.copyProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.lastPresent); gl.uniform1i(this.uCTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, this.depthReadBuf as Uint8Array);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    return { data: this.depthReadBuf as Uint8Array, w: size, h: size };
  }

  /** Feed the shared depth map to every Parallax unit (across master + layers). */
  private bindDepth(): void {
    if (!this.depthTex) this.clearDepth();
    const dh = handle(this.depthTex as WebGLTexture, this.depthW, this.depthH);
    const C = ['fx-parallax'];
    this.masterRack.bindImageByShader(C, 'depthMap', dh);
    for (const L of this.layers) {
      L.rackA.bindImageByShader(C, 'depthMap', dh);
      L.rackB.bindImageByShader(C, 'depthMap', dh);
      L.rackLayer.bindImageByShader(C, 'depthMap', dh);
    }
  }

  // ── Shared audio texture (per-element audio, the EYESY gesture) ──────────
  // 128×2 R8 : row 0 = time-domain waveform (0..255 centred at 128), row 1 =
  // spectrum. Uploaded once per frame (256 bytes); generators with an
  // `audioTex` image input sample it per element. The output window can't run
  // the audio bus, so it mirrors via setAudioOverride (OutputFrame.audioRows).
  private audioTexGL: WebGLTexture | null = null;
  private audioRowBuf = new Uint8Array(128 * 2);
  private audioOverride: { wave: number[]; spec: number[] } | null = null;

  setAudioOverride(rows: { wave: number[]; spec: number[] } | null): void {
    this.audioOverride = rows;
  }

  private updateAudioTex(): void {
    const gl = this.gl;
    if (!this.audioTexGL) {
      this.audioTexGL = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.audioTexGL);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 128, 2, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.shared.audioTex = handle(this.audioTexGL, 128, 2);
    }
    const buf = this.audioRowBuf;
    const ov = this.audioOverride;
    const wave = ov ? ov.wave : audioBus.waveformBytes();
    const spec = ov ? ov.spec : audioBus.spectrumBytes();
    for (let i = 0; i < 128; i++) {
      // 128 = silence for the waveform row so aud() reads ~0 without audio.
      buf[i] = wave && wave.length ? (wave[Math.floor((i / 128) * wave.length)] ?? 128) : 128;
      buf[128 + i] = spec && spec.length ? (spec[Math.floor((i / 128) * spec.length)] ?? 0) : 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.audioTexGL);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 2, gl.RED, gl.UNSIGNED_BYTE, buf);
  }

  readMarkStrip(n: number, y01: number): Float32Array | null {
    const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
    if (w < 2 || h < 2 || n < 1) return null;
    // GL is bottom-up; y01 is top-down (0 = top of image).
    const y = Math.max(0, Math.min(h - 1, Math.round((1 - y01) * (h - 1))));
    const need = w * 4;
    if (!this.markStripBuf || this.markStripBuf.length !== need) this.markStripBuf = new Uint8Array(need);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, y, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.markStripBuf);
    const out = new Float32Array(n), b = this.markStripBuf;
    for (let i = 0; i < n; i++) {
      const p = Math.min(w - 1, Math.floor((i / n) * w)) * 4;
      out[i] = (b[p] * 0.299 + b[p + 1] * 0.587 + b[p + 2] * 0.114) / 255;
    }
    return out;
  }

  /** Set the projection warp for the present pass. `corners` = 8 normalized
   *  numbers (TL,TR,BR,BL x,y; top-left origin) or null to disable. */
  setWarp(corners: number[] | null, grid: boolean): void {
    if (!corners || corners.length !== 8) {
      this.warpActive = false;
      return;
    }
    this.warpActive = true;
    this.warpGridOn = grid;
    // Numeric diff (a join() would allocate a string every frame while warping).
    let changed = this.warpCorners.length !== corners.length;
    if (!changed) for (let i = 0; i < corners.length; i++) if (this.warpCorners[i] !== corners[i]) { changed = true; break; }
    if (changed) {
      this.warpCorners = corners.slice();
      const gl = this.gl;
      gl.bindVertexArray(this.warpVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.warpBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, computeWarpVerts(corners));
      gl.bindVertexArray(null);
    }
  }

  /** Blit `tex` into `fbo` unchanged (used to keep the crossfade snapshot). */
  private copyInto(fbo: WebGLFramebuffer, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.copyProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(this.uCTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /**
   * Reconcile the engine against the store's CompositionState. Called once per
   * frame before render() : the single write path shared by UI, session loads,
   * OSC, and modulators. Shader hot-swaps preserve feedback buffers (brief §1).
   */
  /** Transport BPM, synced from the composition each frame (grain-clock sync). */
  bpm = 120;

  syncFromState(c: CompositionState, sourceById: (id: string) => string | null) {
    this.bpm = c.bpm || 120;
    this.shared.budget.n = LOADS_PER_FRAME; // cap new shader compiles this frame
    this.shared.budget.until = performance.now() + LOAD_MS_PER_FRAME; // ...and cap the time they take
    for (let i = 0; i < this.layers.length && i < c.layers.length; i++) {
      const l = c.layers[i];
      const L = this.layers[i];
      // Each slot is a generator, a video, or empty : reconcile both engines so
      // switching kinds swaps cleanly (video↔generator never overlap). The Text
      // generator is NATIVE (a TS class, no ISF compile) : route it to setText.
      const nativeA = l.sourceA.kind === 'generator' && NATIVE_SOURCE_IDS.has(l.sourceA.shaderId ?? '');
      const isTextA = l.sourceA.kind === 'generator' && l.sourceA.shaderId === 'gen-text';
      const isParamA = l.sourceA.kind === 'generator' && l.sourceA.shaderId === 'gen-parametric';
      const isCollA = l.sourceA.kind === 'generator' && l.sourceA.shaderId === 'gen-collage';
      const wantA = l.sourceA.kind === 'generator' && !nativeA ? l.sourceA.shaderId : null;
      const wantVidA = l.sourceA.kind === 'video' ? (l.sourceA.mediaId ?? null) : null;
      const wantCapA = l.sourceA.kind === 'capture' ? (l.sourceA.mediaId ?? null) : null;
      const wantHiveA = l.sourceA.kind === 'hive' ? (l.sourceA.mediaId ?? null) : null;
      const wantAsmA = l.sourceA.kind === 'assemble' ? (l.sourceA.mediaId ?? null) : null;
      if (wantA !== L.shaderIdA) L.setShader('A', wantA, wantA ? sourceById(wantA) : null);
      L.setVideo('A', wantVidA);
      L.setCapture('A', wantCapA);
      L.setHive('A', wantHiveA);
      L.setAssemble('A', wantAsmA, l.sourceA.edl, l.sourceA.videoLoop ?? true);
      L.setText('A', isTextA
        ? { text: l.sourceA.text ?? 'OPSIA', inputs: l.sourceA.inputs, sidechain: l.sourceA.sidechain ?? null }
        : null);
      L.setParam('A', isParamA ? { inputs: l.sourceA.inputs } : null);
      L.setCollage('A', isCollA ? { pool: l.sourceA.collagePool ?? [], inputs: l.sourceA.inputs } : null);
      const nativeB = !!l.sourceB && l.sourceB.kind === 'generator' && NATIVE_SOURCE_IDS.has(l.sourceB.shaderId ?? '');
      const isTextB = !!l.sourceB && l.sourceB.kind === 'generator' && l.sourceB.shaderId === 'gen-text';
      const isParamB = !!l.sourceB && l.sourceB.kind === 'generator' && l.sourceB.shaderId === 'gen-parametric';
      const isCollB = !!l.sourceB && l.sourceB.kind === 'generator' && l.sourceB.shaderId === 'gen-collage';
      const wantB = l.sourceB && l.sourceB.kind === 'generator' && !nativeB ? l.sourceB.shaderId : null;
      const wantVidB = l.sourceB && l.sourceB.kind === 'video' ? (l.sourceB.mediaId ?? null) : null;
      const wantCapB = l.sourceB && l.sourceB.kind === 'capture' ? (l.sourceB.mediaId ?? null) : null;
      const wantHiveB = l.sourceB && l.sourceB.kind === 'hive' ? (l.sourceB.mediaId ?? null) : null;
      const wantAsmB = l.sourceB && l.sourceB.kind === 'assemble' ? (l.sourceB.mediaId ?? null) : null;
      if (wantB !== L.shaderIdB) L.setShader('B', wantB, wantB ? sourceById(wantB) : null);
      L.setVideo('B', wantVidB);
      L.setCapture('B', wantCapB);
      L.setHive('B', wantHiveB);
      L.setAssemble('B', wantAsmB, l.sourceB?.edl, l.sourceB?.videoLoop ?? true);
      L.setText('B', isTextB && l.sourceB
        ? { text: l.sourceB.text ?? 'OPSIA', inputs: l.sourceB.inputs, sidechain: l.sourceB.sidechain ?? null }
        : null);
      L.setParam('B', isParamB && l.sourceB ? { inputs: l.sourceB.inputs } : null);
      L.setCollage('B', isCollB && l.sourceB ? { pool: l.sourceB.collagePool ?? [], inputs: l.sourceB.inputs } : null);
      L.setVideoPlayback('A', l.sourceA);
      L.setVideoPlayback('B', l.sourceB);
      L.setFraming('A', l.sourceA);
      L.setFraming('B', l.sourceB);
      L.blend = l.blend;
      L.opacity = l.opacity;
      L.mute = l.mute;
      L.solo = l.solo;
      L.feedbackAmount = l.feedback ? l.feedbackAmount : 0;
      L.sourceMix = l.sourceMix;
      L.sourceBlend = l.sourceBlend ?? 'normal';
      L.harmony = l.harmony ?? 0;
      L.speed = l.speed ?? 1;
      L.mask = l.mask ?? null;
      // for-in : entries() would allocate a pair-array per slot per frame.
      for (const k in l.sourceA.inputs) L.setInput('A', k, l.sourceA.inputs[k]);
      if (l.sourceB) for (const k in l.sourceB.inputs) L.setInput('B', k, l.sourceB.inputs[k]);
      L.rackA.sync(l.sourceAFx, sourceById);
      L.rackB.sync(l.sourceBFx, sourceById);
      L.rackLayer.sync(l.fx, sourceById);
    }
    this.masterRack.sync(c.master, sourceById);

    // ── Background slab reconcile (generator-only source + rack + mix). ──
    const bg = c.background;
    const wantBg = bg && bg.source.kind === 'generator' ? bg.source.shaderId : null;
    if (wantBg !== this.bgShaderId) {
      const src = wantBg ? sourceById(wantBg) : null;
      if (!wantBg || !src || !budgetSpent(this.shared.budget)) {
        if (wantBg && src) this.shared.budget.n--;
        this.bgIsf?.cleanup();
        this.bgIsf = wantBg && src ? loadIsf(this.shared.rgl, wantBg, src) : null;
        this.bgShaderId = wantBg;
      } // else: budget spent : retry next frame (id left unrecorded)
    }
    if (this.bgIsf && bg) {
      for (const k in bg.source.inputs) this.bgIsf.setValue(k, bg.source.inputs[k]);
    }
    this.bgRack.sync(bg?.fx ?? [], sourceById);
    this.bgOpacity = bg && bg.source.shaderId ? bg.opacity : 0;
    this.bgSpeed = bg?.speed ?? 0.25;
    this.bgDepth = bg?.depth ?? 0;
    this.bgIsolate = bg?.blendMode === 'isolate';

    // Finalizer output-stage params (native shape + outside fill). Read straight
    // off the pinned finalizer's inputs.
    const fin = c.master.find((f) => f.shaderId === 'fx-finalizer' && f.enabled);
    const fi = fin?.inputs ?? {};
    const numf = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' ? v : d);
    this.fzInstId = fin?.id ?? null;
    this.fzShape = fin ? Math.round(numf(fi.outShape, 0)) : 0;
    this.fzSize = numf(fi.outSize, 0.7);
    this.fzAngle = numf(fi.outAngle, 0);
    this.fzPosX = numf(fi.outPosX, 0);
    this.fzPosY = numf(fi.outPosY, 0);
    this.fzBgSrc = Math.round(numf(fi.outBgSource, 0));
    this.fzBgColor = Array.isArray(fi.outBgColor) ? fi.outBgColor : [0, 0, 0];
    this.fzDepth = numf(fi.outDepth, 0);
    this.fzShadowAngle = numf(fi.outShadowAngle, -0.98);
    this.fzPersp = numf(fi.outPerspective, 0);
    // Cameraless / direct-film draw-hold (native, applied after the shaper).
    this.cfHold = fin ? Math.round(numf(fi.filmHold, 0)) : 0;
    this.cfRate = numf(fi.filmRate, 8);
    this.cfJitter = numf(fi.filmJitter, 0.3);
    this.cfBoil = numf(fi.filmBoil, 0.35);
    this.cfFlutter = numf(fi.filmFlutter, 0.2);
    this.cfBlank = numf(fi.filmBlank, 0);
    this.cfBlankMode = Math.round(numf(fi.filmBlankMode, 0));
    this.cfDust = numf(fi.filmDust, 0);
    this.cfScratch = numf(fi.filmScratch, 0);
    this.cfGranule = numf(fi.filmGranule, 0);
    this.cfSplice = numf(fi.filmSplice, 0);

    // Context PBR surface: feed the selected material's maps (or the neutral
    // flat set) into the Context unit's image inputs every frame. Lazy : no
    // texture leaves disk until a material is first selected.
    const ctx = c.master.find((f) => f.shaderId === 'fx-context');
    if (ctx) {
      if (!this.pbrLib) this.pbrLib = new PbrLib(this.gl);
      const idx = Math.round(numf(ctx.inputs.pbrTexture, 0));
      const maps = idx > 0 ? this.pbrLib.get(idx) : this.pbrLib.neutralMaps();
      this.masterRack.setUnitImage(ctx.id, 'pbrNormal', maps.normal);
      this.masterRack.setUnitImage(ctx.id, 'pbrHeight', maps.height);
      this.masterRack.setUnitImage(ctx.id, 'pbrAO', maps.ao);
      // Texture "off" hard-zeroes the relief so the stage is a guaranteed
      // passthrough whatever the sliders hold.
      if (idx === 0) this.masterRack.setUnitInput(ctx.id, 'pbrAmount', 0);
    }
  }

  /** Direct write to an FX unit's ISF input in any rack (modulation path). */
  setFxInput(scope: FxScope, instId: string, name: string, value: number | number[]): void {
    if (scope.kind === 'master') {
      this.masterRack.setUnitInput(instId, name, value);
      // The Finalizer's out* params are applied NATIVELY (the shader ignores
      // them) : mirror modulated writes onto the fz fields, else modulation
      // moves the sliders but never the picture. syncFromState sets the base
      // each frame; applyModulation runs after it, so this wins the frame.
      if (instId === this.fzInstId && typeof value === 'number') {
        switch (name) {
          case 'outShape': this.fzShape = Math.round(value); break;
          case 'outSize': this.fzSize = value; break;
          case 'outAngle': this.fzAngle = value; break;
          case 'outPosX': this.fzPosX = value; break;
          case 'outPosY': this.fzPosY = value; break;
          case 'outBgSource': this.fzBgSrc = Math.round(value); break;
          case 'outDepth': this.fzDepth = value; break;
          case 'outShadowAngle': this.fzShadowAngle = value; break;
          case 'outPerspective': this.fzPersp = value; break;
          case 'filmHold': this.cfHold = Math.round(value); break;
          case 'filmRate': this.cfRate = value; break;
          case 'filmJitter': this.cfJitter = value; break;
          case 'filmBoil': this.cfBoil = value; break;
          case 'filmFlutter': this.cfFlutter = value; break;
          case 'filmBlank': this.cfBlank = value; break;
          case 'filmBlankMode': this.cfBlankMode = Math.round(value); break;
          case 'filmDust': this.cfDust = value; break;
          case 'filmScratch': this.cfScratch = value; break;
          case 'filmGranule': this.cfGranule = value; break;
          case 'filmSplice': this.cfSplice = value; break;
        }
      }
      return;
    }
    if (scope.kind === 'background') {
      this.bgRack.setUnitInput(instId, name, value);
      return;
    }
    const L = this.layers[scope.layer];
    if (!L) return;
    const rack =
      scope.kind === 'layer' ? L.rackLayer : scope.kind === 'sourceA' ? L.rackA : L.rackB;
    rack.setUnitInput(instId, name, value);
  }

  /** Direct write to the Background slab's source ISF input (modulation path).
   *  syncFromState re-applies the store base each frame first, so a modulated
   *  write here wins the frame it lands in : same contract as setFxInput. */
  setBgSourceInput(name: string, value: number | number[]): void {
    this.bgIsf?.setValue(name, value);
  }

  /** Composite top texture over base into target using the given blend mode. */
  private blendInto(target: WebGLFramebuffer, base: WebGLTexture, top: WebGLTexture, mode: BlendMode, opacity: number, mask?: LayerMask | null) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.blendProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, base); gl.uniform1i(this.uBase, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, top);  gl.uniform1i(this.uTop, 1);
    gl.uniform1i(this.uMode, this.modeIndex[mode]);
    gl.uniform1f(this.uOpac, opacity);
    const m = this.uMask;
    if (mask && mask.mode > 0) {
      gl.uniform1i(m.mMode, Math.round(mask.mode)); gl.uniform1i(m.mInvert, mask.invert ? 1 : 0);
      gl.uniform1f(m.mSoft, mask.soft); gl.uniform1f(m.mLumaLo, mask.lumaLo); gl.uniform1f(m.mLumaHi, mask.lumaHi);
      gl.uniform1f(m.mAngle, mask.angle); gl.uniform1f(m.mPos, mask.pos);
      gl.uniform1f(m.mCx, mask.cx); gl.uniform1f(m.mCy, mask.cy);
      gl.uniform1f(m.mSize, mask.size); gl.uniform1f(m.mAspect, mask.aspect); gl.uniform1f(m.mRound, mask.round);
    } else {
      gl.uniform1i(m.mMode, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** A/B mix into the shared mix target: mix(A, blendMode(A,B), x). The `consume`
   *  mode is stateful : it first evolves the layer's competition field one step. */
  private mixSources(
    a: WebGLTexture, b: WebGLTexture, x: number, mode: BlendMode, harmony = 0, layer?: ISFLayer
  ): WebGLTexture {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);

    // Consume/Reagent : advance the persistent competition field first.
    let stateTex = a; // dummy bind for non-consume modes (branch not taken)
    if (mode === 'consume' && layer) {
      if (!layer.reagent || layer.reagent.w !== this.w || layer.reagent.h !== this.h) {
        layer.reagent?.dispose(gl);
        layer.reagent = new PingPong(gl, this.w, this.h);
      }
      const st = layer.reagent;
      gl.bindFramebuffer(gl.FRAMEBUFFER, st.write());
      gl.viewport(0, 0, this.w, this.h);
      gl.useProgram(this.reagentProg);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a); gl.uniform1i(this.uRA, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b); gl.uniform1i(this.uRB, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, st.read()); gl.uniform1i(this.uRState, 2);
      gl.uniform2f(this.uRTexel, 1 / this.w, 1 / this.h);
      gl.uniform1f(this.uRRate, x);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      stateTex = st.out(); // the field we just wrote
      st.swap();
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mixTarget.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.mixProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a); gl.uniform1i(this.uMA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b); gl.uniform1i(this.uMB, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, stateTex); gl.uniform1i(this.uMState, 2);
    gl.uniform1i(this.uMMode, this.modeIndex[mode] ?? 0);
    gl.uniform1f(this.uMX, x);
    gl.uniform1f(this.uMBHue, harmony * Math.PI); // 1 = complementary (π rad)
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
    // Cap just below 1 so trails always decay : infinite persistence is the
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
    // The global-speed multiplier scales the real delta before it feeds any
    // clock, so 1/64×…64× stretches/compresses ALL motion without time jumps.
    const rawDt = this.lastNowMs > 0 ? Math.min(0.2, (timeMs - this.lastNowMs) / 1000) : 1 / 60;
    this.lastNowMs = timeMs;
    const dtSec = rawDt * this.globalSpeed;
    this.masterClockSec += dtSec;
    this.masterRack.setTime(this.masterClockSec);
    // Background's own slow clock (default 0.25×) on top of the global speed.
    this.bgClockSec += dtSec * this.bgSpeed;
    if (this.bgIsf) (this.bgIsf as unknown as { __opsiaTimeSec?: number }).__opsiaTimeSec = this.bgClockSec;
    this.bgRack.setTime(this.bgClockSec);
    // Feed the shared depth map to any Parallax units before they draw (uses last
    // frame's depth : the estimator runs post-render, so it's always 1 frame behind).
    this.bindDepth();
    // Refresh the shared audio texture (waveform + spectrum rows) : generators
    // with an `audioTex` input ride it element-by-element this frame.
    this.updateAudioTex();

    // Native convolution nodes (layer FX) resolve their sidechain to a live
    // texture: another layer's persisted output (previous frame for layers not
    // yet rendered : fine, the node keeps its own history). Assets land later.
    const nodeCtx: NodeApplyCtx = {
      dt: rawDt,
      depth: this.depthTex, // shared scene depth (Parallax node reads it, layer + master)
      sidechainTex: (ref) => {
        if (!ref) return null;
        if (ref.kind === 'layer') return this.layers[ref.layer]?.texture() ?? null;
        return null; // imported assets : Commit C
      }
    };

    // Per layer: sources → per-source racks → mix → layer rack → persist.
    // The result of each stage lives in shared buffers only until persist
    // writes it into the layer's own ping-pong pair.
    for (let li = 0; li < this.layers.length; li++) {
      const L = this.layers[li];
      // Fault-isolate each layer: a throw inside one layer's rack (e.g. an ISF
      // unit in a bad state after an edit) must not abort the whole frame : that
      // would freeze EVERY layer, including a video, until the state changed.
      // Skip the offending layer this frame, keep the rest live, and always
      // clear the ISF redirect so a throw mid-draw can't leak a stale target.
      try {
        L.advanceClock(dtSec);
        // Video: pass the REAL delta + the layer×global rate multiplier so the
        // clip plays natively (smooth) at speed·layer·global over realtime.
        L.tickVideos(li, rawDt, this.globalSpeed * L.speed, this.bpm);
        L.tickAssemble(li, rawDt, this.globalSpeed * L.speed);
        gl.bindVertexArray(null); // ISF draws own the default VAO
        L.renderSource('A', nodeCtx.sidechainTex);
        let sig = L.rackA.apply(L.scratchA.tex, this.chain, nodeCtx); // nodeCtx → native nodes on source A
        if (L.hasB()) {
          // rackA + rackB ping-pong through the SAME ChainBuffers, so rackB can
          // land a write back on the buffer holding A's result (parity-dependent,
          // e.g. A=1 FX, B=2 FX). Park A off-chain before B runs.
          this.copyInto(this.abHold.fbo, sig);
          sig = this.abHold.tex;
          L.renderSource('B', nodeCtx.sidechainTex);
          const sigB = L.rackB.apply(L.scratchB.tex, this.chain, nodeCtx); // nodeCtx → native nodes on source B
          sig = this.mixSources(sig, sigB, L.sourceMix, L.sourceBlend, L.harmony, L);
        }
        gl.bindVertexArray(null);
        sig = L.rackLayer.apply(sig, this.chain, nodeCtx);
        this.persist(L, sig);
      } catch (e) {
        this.shared.redirect.redirect = null;
        console.error(`[render] layer ${li} skipped this frame:`, e);
      }
    }

    // Blend stack: clear one accumulator buffer, then blend bottom→top
    // reading one buffer and writing the other (never the same texture).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.acc.write());
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    this.acc.swap(); // cleared buffer is now acc.read()

    const anySolo = this.layers.some((l) => l.solo);
    let first = true;

    // Background slab. Rendered whenever it's needed either behind the layers OR
    // as the finalizer's outside fill (fzBgLayer "moves" it there : so it must
    // NOT also sit behind the layers). Copied into a STABLE bgFill buffer since
    // the chain buffer the rack returns is reused by the layer loop below.
    const wantBg = this.bgIsf && (this.bgOpacity > 0.001 || this.fzBgLayer);
    let haveBgFill = false;
    if (wantBg) {
      try {
        gl.bindVertexArray(null);
        this.shared.redirect.redirect = this.bgScratch.fbo;
        this.bgIsf!.draw({ width: this.w, height: this.h });
        this.shared.redirect.redirect = null;
        gl.bindVertexArray(null);
        const bgTex = this.bgRack.apply(this.bgScratch.tex, this.chain, nodeCtx); // nodeCtx → native nodes on the background
        this.copyInto(this.bgFill.fbo, bgTex);
        haveBgFill = true;

        // Composite behind the layers UNLESS moved to the finalizer's fill.
        if (this.bgOpacity > 0.001 && !this.fzBgLayer) {
          this.blendInto(this.acc.write(), this.acc.read(), this.bgFill.tex, 'normal', this.bgOpacity);
          this.acc.swap();
          // 'blend' (default): the first layer blends onto the background with its
          // own mode. 'isolate': keep `first` true so the background never alters
          // the inter-layer blends.
          if (!this.bgIsolate) first = false;

          // Depth: the foreground casts a soft shadow onto the background (now in
          // acc). No-op at depth 0.
          if (this.bgDepth > 0.001) {
            if (!this.depthShadow) this.depthShadow = new DepthShadow(this.gl);
            const tex = this.layers.map((l) => l.texture());
            const wts = this.layers.map((l) => ((anySolo ? l.solo : !l.mute) ? l.opacity : 0));
            this.depthShadow.apply(this.acc.read(), tex, wts, this.bgDepth, this.acc.write(), this.w, this.h);
            this.acc.swap();
            gl.bindVertexArray(null);
          }
        }
      } catch (e) {
        this.shared.redirect.redirect = null;
        console.error('[render] background skipped this frame:', e);
      }
    }
    for (const L of this.layers) {
      const audible = anySolo ? L.solo : !L.mute;
      if (!audible) continue;
      // The first visible layer has nothing real below it : the accumulator
      // is cleared black, so multiply/overlay/burn would eat it. Standard
      // compositor semantics: the bottom of the stack composites 'normal';
      // blend modes act BETWEEN layers.
      this.blendInto(
        this.acc.write(),
        this.acc.read(),
        L.texture(),
        first ? 'normal' : L.blend,
        L.opacity,
        L.mask
      );
      first = false;
      this.acc.swap();
    }
    let composite = this.acc.read();

    // Master rack (glitch / dither / chroma / grade; warp joins in Phase 8).
    gl.bindVertexArray(null);
    composite = this.masterRack.apply(composite, this.chain, nodeCtx); // nodeCtx → native nodes (Parallax) work on master too

    // Finalizer output stage: clip the finished frame into a shape, filling
    // OUTSIDE with a solid colour or the (moved) Background slab. No-op unless a
    // shape is chosen. mixTarget is free here (the layer loop is long done).
    if (this.fzShape > 0) {
      if (!this.outputShape) this.outputShape = new OutputShape(this.gl);
      const fill = this.fzBgLayer && haveBgFill ? this.bgFill.tex : null;
      this.outputShape.apply(
        composite, fill, this.fzBgColor, this.fzShape, this.fzSize, this.fzAngle,
        this.fzPosX, this.fzPosY, this.fzDepth, this.fzShadowAngle, this.fzPersp,
        this.w / this.h, this.mixTarget.fbo, this.w, this.h
      );
      composite = this.mixTarget.tex;
    }

    // Cameraless / direct-film stage: draw-clock hold + boil (§2.1 pipeline slot).
    // Null when off (hold===0) or effectively smooth (draw ≥ present fps with no
    // artifacts) : skipped entirely so it costs nothing and passes through clean.
    if (this.cfHold > 0) {
      const active =
        this.cfRate < 58 || this.cfBoil > 0.001 || this.cfFlutter > 0.001 || this.cfBlank > 0.001 ||
        this.cfDust > 0.001 || this.cfScratch > 0.001 || this.cfGranule > 0.001 || this.cfSplice > 0.001;
      if (active) {
        if (!this.cameraless) this.cameraless = new Cameraless(gl);
        composite = this.cameraless.apply(
          composite, rawDt,
          { hold: this.cfHold, rate: this.cfRate, jitter: this.cfJitter, boil: this.cfBoil,
            flutter: this.cfFlutter, blank: this.cfBlank, blankMode: this.cfBlankMode,
            dust: this.cfDust, scratch: this.cfScratch, granule: this.cfGranule, splice: this.cfSplice },
          this.w, this.h
        );
      }
    }

    // Scene crossfade: dissolve the frozen old frame into the new composite.
    // The only way a STRUCTURAL morph (Randomize All swaps shaders) can read as
    // a transition : parameter easing can't cross a shader change.
    let present = composite;
    if (this.xfadeActive) {
      if (this.xfadeStartMs < 0) this.xfadeStartMs = timeMs;
      let k = (timeMs - this.xfadeStartMs) / this.xfadeMs;
      if (k >= 1) {
        this.xfadeActive = false;
      } else {
        k = k * k * (3 - 2 * k); // smoothstep
        this.blendInto(this.xfadeTarget.fbo, this.snapshot.tex, composite, 'normal', k);
        present = this.xfadeTarget.tex;
      }
    }
    // Monomedia freeze-drop: hold the last frame (captured once) on screen.
    if (this.freezeActive) {
      if (!this.freezeCaptured && this.lastPresent) {
        this.copyInto(this.snapshot.fbo, this.lastPresent);
        this.freezeCaptured = true;
      }
      if (this.freezeCaptured) present = this.snapshot.tex;
    }
    // Strobe-safety limiter : the very last stage on the presented frame, so it nets
    // ALL upstream flash sources (Shutter, Superimposition, Frame-Weave, Cameraless
    // blank, datamosh bloom, hard cuts…). cap = max mean-luminance step per frame.
    if (this.strobeSafe > 0.02) {
      if (!this.strobeLimiter) this.strobeLimiter = new StrobeLimiter(gl);
      const cap = 0.25 - this.strobeSafe * 0.235; // 0.02 → ~0.245 (loose) · 1 → 0.015 (tight)
      present = this.strobeLimiter.apply(present, cap, this.w, this.h);
    }
    // Present to canvas : warped (keystone quad) or straight full-screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (this.warpActive) {
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(this.warpVao);
      gl.useProgram(this.warpProg);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, present); gl.uniform1i(this.uWTex, 0);
      gl.uniform1f(this.uWGrid, this.warpGridOn ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else {
      gl.bindVertexArray(this.vao);
      gl.useProgram(this.copyProg);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, present); gl.uniform1i(this.uCTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);

    // Remember what we just showed : beginCrossfade() snapshots this next time a
    // morph starts, so the dissolve begins from the exact frame on screen.
    this.lastPresent = present;

    // External output seam (Spout/NDI): read the presented RGBA8 frame from the
    // default framebuffer and hand it off. Only runs when a sink is attached.
    // ASYNC : readPixels goes into a PBO (no stall); the previous frame's PBO is
    // harvested once its fence signals. One frame of sink latency, zero flushes.
    if (this.outputCapture) {
      const w = this.canvas.width, h = this.canvas.height;
      const need = w * h * 4;
      if (!this.capPbos || this.capW !== w || this.capH !== h) {
        this.freeCapturePbos();
        const a = gl.createBuffer()!, b = gl.createBuffer()!;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, a);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, need, gl.STREAM_READ);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, need, gl.STREAM_READ);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        this.capPbos = [a, b];
        this.capW = w; this.capH = h;
      }
      const wi = this.capPhase, ri = 1 - this.capPhase;
      // If the write-side PBO still has a pending fence (sink slower than us),
      // drop that frame : delete the fence and overwrite.
      if (this.capSyncs[wi]) { gl.deleteSync(this.capSyncs[wi]!); this.capSyncs[wi] = null; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.capPbos[wi]);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0); // → PBO, async
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.capSyncs[wi] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      // Harvest the OTHER PBO (last frame's pixels) if its copy completed.
      const sync = this.capSyncs[ri];
      if (sync) {
        const st = gl.clientWaitSync(sync, 0, 0);
        if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) {
          gl.deleteSync(sync); this.capSyncs[ri] = null;
          if (!this.readbackBuf || this.readbackBuf.length !== need) this.readbackBuf = new Uint8Array(need);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.capPbos[ri]);
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.readbackBuf);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          this.outputCapture(w, h, this.readbackBuf);
        }
        // Not signalled yet → leave it; next frame either harvests or drops it.
      }
      this.capPhase = ri;
    } else if (this.capPbos) {
      this.freeCapturePbos(); // sink detached : release the PBOs
    }
  }

  /** Release EVERY GL resource this compositor owns. Call on unmount so a
   *  React remount (StrictMode double-invoke / HMR) can't orphan a whole
   *  compositor's worth of programs and RGBA16F targets. */
  dispose(): void {
    const gl = this.gl;
    for (const L of this.layers) L.dispose();
    this.layers = [];
    this.masterRack.dispose();
    this.bgIsf?.cleanup();
    this.bgRack.dispose();
    this.depthShadow?.dispose();
    this.outputShape?.dispose();
    this.cameraless?.dispose();
    this.strobeLimiter?.dispose();
    this.pbrLib?.dispose();
    disposeTarget(gl, this.bgScratch);
    disposeTarget(gl, this.bgFill);
    this.acc.dispose(gl);
    this.chain.dispose(gl);
    disposeTarget(gl, this.mixTarget);
    disposeTarget(gl, this.abHold);
    disposeTarget(gl, this.snapshot);
    disposeTarget(gl, this.xfadeTarget);
    if (this.fxOpac) { disposeTarget(gl, this.fxOpac[0]); disposeTarget(gl, this.fxOpac[1]); }
    this.freeCapturePbos();
    if (this.audioTexGL) { gl.deleteTexture(this.audioTexGL); this.audioTexGL = null; }
    if (this.soniFbo) { gl.deleteFramebuffer(this.soniFbo.fbo); gl.deleteTexture(this.soniFbo.tex); this.soniFbo = null; }
    if (this.visionFbo) { gl.deleteFramebuffer(this.visionFbo.fbo); gl.deleteTexture(this.visionFbo.tex); this.visionFbo = null; }
    if (this.depthTex) { gl.deleteTexture(this.depthTex); this.depthTex = null; }
    if (this.depthFbo) { gl.deleteFramebuffer(this.depthFbo.fbo); gl.deleteTexture(this.depthFbo.tex); this.depthFbo = null; }
    gl.deleteProgram(this.blendProg);
    gl.deleteProgram(this.persistProg);
    gl.deleteProgram(this.mixProg);
    gl.deleteProgram(this.copyProg);
    gl.deleteProgram(this.xformProg);
    gl.deleteProgram(this.warpProg);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.warpVao);
    gl.deleteBuffer(this.quadBuf);
    gl.deleteBuffer(this.warpBuf);
  }
}
