// Depth Scan (the native node 'node-depthscan') : a plane sweeping through the
// picture's depth, and the depth slice.
//
// SCAN : a plane travels through the depth map, near to far, far to near, back and
// forth or set by hand, once a PERIOD (or on the beat). What it crosses lights up :
// brighter (BRIGHTEN), tinted toward the GLOW color (TINT), swollen a little
// (ENLARGE : the crossed parts spill over their own edge), with a crisp contour
// where the plane meets the picture (LINE, a depth isoline, pixel-true) and a fading
// wake behind it (TRAIL). REST dims everything the plane is not crossing.
// SLICE : only a band of depth is kept (AT, WIDTH, SOFTNESS), the rest made
// transparent (a matte : the layers below show through), dimmed, black, or drawn
// as a white-on-black matte for the Matte node or a mask. SCAN IN SLICE runs the
// plane inside the band only.
//
// The depth : with the depth engine on AI, the model reading THIS picture (the one
// entering the effect : engine/pictureDepth.ts), not the whole frame, whose depth
// would include the effect's own result (a slice keyed by the depth of its own
// matte runs away with itself); the shared frame map stands in until the first
// map comes, and on synth. With the engine off, or DEPTH FROM set so, the
// picture's own brightness stands in (bright = near), or its darkness. 1 = near,
// 0 = far, as everywhere (Parallax). The scan's
// place is an integrated phase on the rack's clock (Speed, freeze), so a period
// that moves never makes the plane jump.
//
// third-party: Gather 聚 Lite (the idea of a plane sweeping through the depth and
// lighting what it crosses; written for Palinopsia, no code taken)

import type { ConvNode, NodeContext } from './convNodes'
import { EngineGL, Edge, type Prog } from './organicGL'
import { glGeneration } from './glGeneration'
import { PictureDepthReader, pictureDepth } from './pictureDepth'

const num = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)
const colorOf = (v: number | number[] | undefined, d: [number, number, number]): [number, number, number] =>
  Array.isArray(v) && v.length >= 3 ? [v[0], v[1], v[2]] : d

/** Beats per sweep for each SYNC choice (free, beat, 2 beats, bar, 2 bars, 4 bars). */
const SYNC_BEATS = [0, 1, 2, 4, 8, 16]

const FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUV;
out vec4 o;
uniform sampler2D uHost, uDepth;
uniform int uHasDepth, uRead, uFlip, uMode, uOutside, uInvert;
uniform float uPos, uDirSign, uWidth, uTrail, uBright, uTint, uLine, uEnlarge, uRest;
uniform float uLo, uHi, uSoft, uDim, uWet, uPx;
uniform vec3 uGlow;
uniform vec2 uTexel;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// The depth at a point : the shared map, else the picture's brightness (or its
// darkness). 1 = near.
float depthAt(vec2 uv) {
  float d;
  if (uRead == 0 && uHasDepth == 1) d = texture(uDepth, uv).r;
  else {
    vec4 c = texture(uHost, uv);
    float l = luma(c.rgb) * c.a;
    d = uRead == 2 ? 1.0 - l : l;
  }
  return uFlip == 1 ? 1.0 - d : d;
}

// The band the plane lights : a soft core round its place, and the wake on the
// side it has already passed (TRAIL : how long the wake is).
float bandAt(float d) {
  float x = d - uPos;
  float core = exp(-(x * x) / max(uWidth * uWidth, 1e-6));
  // passed : the plane has gone beyond this depth in its direction of travel
  float passed = step(0.0, -x * uDirSign);
  float tail = uTrail > 0.001 ? passed * exp(-abs(x) / max(uWidth * (0.5 + uTrail * 6.0), 1e-4)) * uTrail : 0.0;
  return clamp(max(core, tail), 0.0, 1.0);
}

// The slice : 1 inside the kept band, 0 outside, soft at its two edges.
float keepAt(float d) {
  float k = smoothstep(uLo - uSoft, uLo + uSoft, d) * (1.0 - smoothstep(uHi - uSoft, uHi + uSoft, d));
  return uInvert == 1 ? 1.0 - k : k;
}

void main() {
  vec4 src = texture(uHost, vUV);
  if (uWet < 0.001) { o = src; return; }
  float d = depthAt(vUV);
  vec3 rgb = src.rgb;
  float a = src.a;
  bool scan = uMode != 1;
  bool slice = uMode != 0;
  float keep = slice ? keepAt(d) : 1.0;

  if (scan) {
    float b = bandAt(d);
    // in the slice, the plane only lights what is kept
    if (uMode == 2) b *= keep;
    // ENLARGE : the crossed parts swell over their own edge. Eight neighbors a few
    // pixels out : the brightest of those the plane crosses spills here.
    if (uEnlarge > 0.001) {
      float r = uEnlarge * 7.0 * uPx;
      vec4 best = vec4(0.0);
      float bw = 0.0;
      for (int i = 0; i < 8; i++) {
        float th = float(i) * 0.78539816 + 0.39269908;
        vec2 q = vUV + vec2(cos(th), sin(th)) * r * uTexel;
        vec4 cq = texture(uHost, q);
        float bq = bandAt(depthAt(q));
        if (uMode == 2) bq *= keepAt(depthAt(q));
        float w = bq * (0.25 + luma(cq.rgb)) * cq.a;
        if (w > bw) { bw = w; best = cq; }
      }
      float spill = clamp(bw * 1.2 - b * 0.5, 0.0, 1.0) * uEnlarge;
      rgb = mix(rgb, best.rgb, spill);
      a = max(a, best.a * spill);
      b = max(b, spill * 0.8);
    }
    // the light : brighter, then toward the glow color (its brightness kept, with a
    // floor so a dark part the plane crosses still takes the color)
    vec3 lit = rgb * (1.0 + uBright * b);
    float lum = max(luma(lit), 0.12 * uBright * b);
    lit = mix(lit, uGlow * lum / max(luma(uGlow), 0.05), uTint * b);
    // REST : what the plane is not crossing sinks
    lit *= 1.0 - uRest * (1.0 - b);
    // LINE : the plane's contour, where it meets the picture, a 1.5 px line (at
    // 1080p) whatever the slope of the depth there
    if (uLine > 0.001) {
      float fw = max(fwidth(d), 1e-4);
      float dist = abs(d - uPos) / fw;
      float lw = 1.5 * uPx;
      float cov = (1.0 - smoothstep(lw - 0.75, lw + 0.75, dist)) * uLine;
      if (uMode == 2) cov *= keep;
      lit = mix(lit, uGlow, cov);
      a = max(a, cov);
    }
    rgb = lit;
  }

  if (slice) {
    if (uOutside == 0) a *= keep;                                 // transparent
    else if (uOutside == 1) rgb *= mix(uDim, 1.0, keep);          // dimmed
    else if (uOutside == 2) rgb *= keep;                          // black
    else { rgb = vec3(keep); a = 1.0; }                           // matte
  }

  vec4 res = vec4(clamp(rgb, 0.0, 1.0), clamp(a, 0.0, 1.0));
  // dry / wet, premultiplied (a transparent part never darkens the mix)
  vec4 pa = vec4(src.rgb * src.a, src.a), pb = vec4(res.rgb * res.a, res.a);
  vec4 m = mix(pa, pb, uWet);
  o = vec4(m.a > 1e-5 ? m.rgb / m.a : res.rgb, m.a);
}`

export class DepthScanNode implements ConvNode {
  private g: EngineGL | null = null
  private prog: Prog | null = null
  private gen = -1
  private phase = Math.random() // the sweep's place in its cycle, 0..1
  private restart = new Edge()
  private reader: PictureDepthReader | null = null
  private disposed = false
  constructor(private gl: WebGL2RenderingContext) {}

  private ensure(): void {
    if (this.g && this.gen === glGeneration()) return
    this.g?.dispose()
    this.g = new EngineGL(this.gl, 'depthscan')
    this.prog = this.g.prog(FS)
    this.gen = glGeneration()
  }

  render(ctx: NodeContext): WebGLTexture {
    if (this.disposed) return ctx.host
    const inp = ctx.inputs
    const wet = clamp(num(inp.wet, 1), 0, 1)
    if (wet < 0.001) return ctx.host
    this.ensure()
    const g = this.g!, p = this.prog!
    if (!g.ok) return ctx.host
    const gl = ctx.gl
    const W = ctx.chain.w, H = ctx.chain.h

    // The sweep's clock : free (one sweep a PERIOD) or on the beat.
    const syncI = Math.round(clamp(num(inp.sync, 0), 0, SYNC_BEATS.length - 1))
    const bpm = clamp(ctx.bpm && ctx.bpm > 0 ? ctx.bpm : 120, 20, 300)
    const period = syncI > 0 ? (60 / bpm) * SYNC_BEATS[syncI] : clamp(num(inp.period, 4), 0.25, 60)
    this.phase = (this.phase + Math.max(0, ctx.dt) / period) % 1
    if (this.restart.fired(num(inp.restart, 0))) this.phase = 0

    const mode = Math.round(clamp(num(inp.mode, 0), 0, 2))
    const width = clamp(num(inp.width, 0.08), 0.005, 0.6)
    // The slice's band (also the scan's range in SCAN IN SLICE)
    const at = clamp(num(inp.sliceAt, 0.6), 0, 1)
    const sw = clamp(num(inp.sliceWidth, 0.3), 0, 1)
    const lo = at - sw / 2, hi = at + sw / 2
    const soft = Math.max(0.002, clamp(num(inp.softness, 0.05), 0, 0.5))
    // Where the plane is : it travels a little past both ends (over its own width),
    // so it comes in and goes out cleanly.
    const dir = Math.round(clamp(num(inp.direction, 0), 0, 3))
    const [r0, r1] = mode === 2 ? [lo, hi] : [0, 1]
    const ext = width * 1.5
    let t: number, sign: number
    if (dir === 3) {
      t = clamp(num(inp.position, 0.5), 0, 1)
      sign = 0
    } else if (dir === 2) {
      // back and forth : near to far, then far to near
      t = this.phase < 0.5 ? 1 - this.phase * 2 : (this.phase - 0.5) * 2
      sign = this.phase < 0.5 ? -1 : 1
    } else if (dir === 1) {
      t = this.phase
      sign = 1
    } else {
      t = 1 - this.phase
      sign = -1
    }
    const pos = dir === 3 ? r0 + (r1 - r0) * t : r0 - ext + (r1 - r0 + 2 * ext) * t

    const [gr, gg, gb] = colorOf(inp.glow, [0.93, 0.88, 0.78])
    const read = Math.round(clamp(num(inp.reads, 0), 0, 2))
    let depth: WebGLTexture | null = null
    if (read === 0 && pictureDepth.wanted()) {
      if (!this.reader) this.reader = new PictureDepthReader(gl)
      depth = this.reader.step(ctx.host, W / Math.max(1, H), ctx.dt) ?? ctx.depth ?? null
    } else {
      this.reader?.stop()
      depth = read === 0 ? ctx.depth ?? null : null
    }
    const out = ctx.chain.next()
    p.use()
      .i1('uHost', 0).i1('uDepth', 1)
      .i1('uHasDepth', depth ? 1 : 0)
      .i1('uRead', read)
      .i1('uFlip', num(inp.flip, 0) >= 0.5 ? 1 : 0)
      .i1('uMode', mode)
      .i1('uOutside', Math.round(clamp(num(inp.outside, 0), 0, 3)))
      .i1('uInvert', num(inp.invert, 0) >= 0.5 ? 1 : 0)
      .f1('uPos', pos).f1('uDirSign', sign)
      .f1('uWidth', width)
      .f1('uTrail', clamp(num(inp.trail, 0.3), 0, 1))
      .f1('uBright', clamp(num(inp.brighten, 1), 0, 3))
      .f1('uTint', clamp(num(inp.tint, 0.35), 0, 1))
      .f1('uLine', clamp(num(inp.line, 0.5), 0, 1))
      .f1('uEnlarge', clamp(num(inp.enlarge, 0.3), 0, 1))
      .f1('uRest', clamp(num(inp.rest, 0.2), 0, 1))
      .f1('uLo', lo).f1('uHi', hi).f1('uSoft', soft)
      .f1('uDim', clamp(num(inp.dim, 0.15), 0, 1))
      .f1('uWet', wet)
      .f1('uPx', H / 1080)
      .f3('uGlow', gr, gg, gb)
      .f2('uTexel', 1 / Math.max(1, W), 1 / Math.max(1, H))
    g.bind(0, ctx.host)
    // a unit the program samples always holds a texture (the host stands in)
    g.bind(1, depth ?? ctx.host)
    g.draw(out.fbo, W, H)
    g.done(2)
    return out.tex
  }

  dispose(): void {
    this.disposed = true
    this.reader?.dispose()
    this.reader = null
    this.g?.dispose()
    this.g = null
  }
}
