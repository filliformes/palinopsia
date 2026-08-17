// CollageSource : the Autocutter's cut-up, but every piece is its own film.
//
// The Autocutter FX partitions the frame and shuffles the pieces of ONE image.
// This is the same partition driving a WALL of simultaneous videos : each piece
// shows a different clip, cover-cropped to its own shape, looping and speed-
// stretched, re-dealt on a trigger or a clock. It is a SOURCE, not an effect —
// the whole mosaic is one layer, so the normal rack / blend / finishing stack
// sits on top of it unchanged.
//
// Three decisions carry the design:
//
//  1. **A 2D ARRAY TEXTURE, not N samplers or an atlas.** Every deck owns one
//     layer of a `sampler2DArray`, so the fragment shader picks a film with an
//     index instead of a 16-way branch, and there is no tile-packing maths and
//     no bleeding between neighbours. Layers must share a size, so each frame is
//     CONTAIN-fitted into a square layer (its content rect recorded on the CPU)
//     and the per-cell COVER crop is then computed against that content rect —
//     which is what makes portrait, landscape and 4K clips interchangeable.
//
//  2. **Decks are a pool, cells are a mapping.** More cuts than films is normal
//     and desirable : several cells then show the same film at different crops
//     and rotations, which reads as collage rather than repetition. The pool
//     size is what costs decoder bandwidth, not the number of cuts.
//
//  3. **Whole films by default, windows on request.** `window` (0 by default)
//     loops the WHOLE file : the element's native loop, no seeking at all, which
//     is both the smoothest path and the least surprising — a piece just plays
//     its film. Setting it non-zero loops a short window instead, which is how
//     you stop a 30-minute take from reducing a cell to one slow moment; the
//     cost is a hard cut backwards every `window` seconds, so it is opt-in.
//     `churn` then decides how many decks re-roll on a fast clock instead of
//     waiting for the next deal — the span from "every piece holds" to "every
//     piece is its own little montage".
//
// Measured on the target machine (RTX 4070) before designing this : 11 clips —
// including a 3840×2160 and a portrait 1200×1920 — decoded simultaneously at
// their native rates with the app still at 55-60 fps, and uploading all of them
// every frame cost ~3.5 ms. Uploads here are gated on a fresh decoded frame
// (requestVideoFrameCallback), so the steady-state cost is well under that.

import type { CollageClip, CollageEdl } from '@shared/collage'
import { uploadVideoFrame } from './VideoSource'
import { AssembleSource } from './AssembleSource'

/** Same piece cap as the Autocutter : the shader's uniform arrays are sized 64. */
const MAX_CELLS = 64
/** Hard ceiling on simultaneous decoders. */
export const MAX_DECKS = 50
/** Edge of one square array layer, traded against how many there are : a wall
 *  of 50 gives each piece a fiftieth of the frame, so it needs far less
 *  resolution than a wall of 8. Keeps the array under ~30 MB at every size
 *  (16×640² ≈ 26 MB, 50×384² ≈ 29 MB) instead of 50×640² ≈ 82 MB. */
function tileFor(layers: number): number {
  return layers <= 16 ? 640 : layers <= 32 ? 448 : 384
}
/** Chromium refuses playback rates outside roughly this band. */
const RATE_MIN = 0.0625
const RATE_MAX = 16

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

// Contain-fit blit of one decoded frame into its array layer. Runs once per
// deck per DECODED frame, not per rendered frame.
const FS_TILE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uSrc;
uniform vec4 uContent;   // where the picture sits inside the square layer
void main(){
  vec2 uv = (vUV - uContent.xy) / uContent.zw;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  o = vec4(texture(uSrc, uv).rgb, 1.0);
}`

// The collage itself. The partition, the contour warp, the torn-paper fringe and
// the mask are the Autocutter's, verbatim in behaviour — same dials, same look —
// with the single difference that a cell samples its own film out of the deck
// array instead of sampling a source rect of the host image.
const FS_COLLAGE = `#version 300 es
precision highp float;
// GLSL ES 3.00 gives sampler2D a default precision in the fragment stage but
// NOT sampler2DArray — without this line the whole program fails to compile.
precision highp sampler2DArray;
in vec2 vUV; out vec4 o;
uniform sampler2DArray uDecks;
uniform int uCount;
uniform vec4 uCell[64];   // dest rect (x,y,w,h) in output UV
uniform vec4 uCrop[64];   // source rect inside the deck's layer (cover crop)
uniform float uDeck[64];  // which array layer this piece plays
uniform float uRot[64];   // 0..3 (×90°)
uniform float uRank[64];  // mask dropout order; the survivor holds 2.0
uniform float uGap, uSeed, uContour, uTorn, uMask, uCurve;
float vhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 0.031) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), f.x),
             mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// CONTOUR : a continuous domain warp of the cell lookup. Because every pixel
// still resolves to exactly ONE (warped) cell, the pieces stay a perfect
// tessellation while their boundaries wander and fray like torn paper.
// CURVE LENGTH picks the warp's wavelength : low = many small waves, high = few
// long sweeping curves.
vec2 tearWarp(vec2 p){
  float fc = mix(12.0, 2.2, clamp(uCurve, 0.0, 1.0));
  float ff = fc * 5.2;
  float fray = (0.25 + 0.2 * max(uContour - 1.0, 0.0)) * (1.0 - 0.7 * uCurve);
  vec2 w = (vec2(vnoise(p * fc), vnoise(p * fc + 31.7)) - 0.5) * (1.0 - fray)
         + (vec2(vnoise(p * ff + 11.3), vnoise(p * ff + 71.9)) - 0.5) * fray;
  return p + w * uContour * 0.045 * (1.0 + uCurve * 1.1);
}
vec2 rot90(vec2 p, float r){
  p -= 0.5; int ri = int(r + 0.5);
  if (ri == 1) p = vec2(-p.y, p.x);
  else if (ri == 2) p = -p;
  else if (ri == 3) p = vec2(p.y, -p.x);
  return p + 0.5;
}
void main(){
  vec3 col = vec3(0.0);
  float keep = 0.0;
  vec2 wUV = uContour > 0.001 ? clamp(tearWarp(vUV), 0.0001, 0.9999) : vUV;
  for (int i = 0; i < 64; i++){
    if (i >= uCount) break;
    vec4 d = uCell[i];
    if (wUV.x >= d.x && wUV.x < d.x + d.z && wUV.y >= d.y && wUV.y < d.y + d.w){
      keep = smoothstep(uMask - 0.06, uMask, uRank[i]);
      vec2 luv = rot90((wUV - d.xy) / d.zw, uRot[i]);
      vec4 cr = uCrop[i];
      col = texture(uDecks, vec3(cr.xy + luv * cr.zw, uDeck[i])).rgb;
      vec2 e = min(wUV - d.xy, d.xy + d.zw - wUV);
      float ed = min(e.x, e.y);
      if (uGap > 0.001) col *= smoothstep(0.0, uGap * 0.02, ed);
      if (uTorn > 0.001){
        // A heavy-tailed fringe width : long stretches of hairline tear broken
        // by broad white bites, the way a real rip crosses the paper grain.
        float bite = pow(vnoise(wUV * 6.0 + 13.7), 3.0);
        float rag = 0.5 + 0.5 * vnoise(wUV * 90.0);
        float fw = uTorn * 0.012 * (0.06 + 2.4 * bite + 0.45 * rag);
        float sh = smoothstep(fw * 0.8, fw + 0.020 * uTorn, ed);
        col *= 1.0 - (1.0 - sh) * 0.3 * min(uTorn, 1.0);
        float paper = 1.0 - smoothstep(0.0, fw, ed);
        vec3 paperCol = vec3(0.93, 0.91, 0.87) * (0.80 + 0.20 * vnoise(wUV * 160.0));
        col = mix(col, paperCol, paper * min(uTorn * 2.0, 1.0));
      }
      break;
    }
  }
  // Masked pieces leave TRANSPARENT holes, so the layers underneath show through.
  o = vec4(clamp(col, 0.0, 1.0) * keep, keep);
}`

interface CollageGL {
  tile: WebGLProgram
  collage: WebGLProgram
  quad: WebGLBuffer
  uTile: (n: string) => WebGLUniformLocation | null
  uColl: (n: string) => WebGLUniformLocation | null
}

// Programs and the quad are shared per context and NEVER deleted. Deleting a
// buffer while the default VAO is current resets attribute 0 for every ISF
// program in the app and freezes the canvas (see the shared-VAO landmine).
const shared = new WeakMap<WebGL2RenderingContext, CollageGL>()
function collageGL(gl: WebGL2RenderingContext): CollageGL {
  const hit = shared.get(gl)
  if (hit) return hit
  const compile = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      console.error('[collage] shader compile:', gl.getShaderInfoLog(s))
    return s
  }
  const link = (fs: string): WebGLProgram => {
    const p = gl.createProgram()!
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(p, 0, 'p')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      console.error('[collage] link:', gl.getProgramInfoLog(p))
    return p
  }
  const tile = link(FS_TILE)
  const collage = link(FS_COLLAGE)
  const quad = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const cacheOf = (p: WebGLProgram): ((n: string) => WebGLUniformLocation | null) => {
    const c = new Map<string, WebGLUniformLocation | null>()
    return (n) => {
      if (!c.has(n)) c.set(n, gl.getUniformLocation(p, n))
      return c.get(n)!
    }
  }
  const g: CollageGL = { tile, collage, quad, uTile: cacheOf(tile), uColl: cacheOf(collage) }
  shared.set(gl, g)
  return g
}

const num = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' ? v : d)
const clampf = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Deterministic PRNG so a seed replays the same deal. */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Deck {
  // Exactly one of these drives the deck. `asm` decks play a saved assemblage
  // (its own edit, its own cuts, its own ping-pong pair for cross-file cuts);
  // `el` decks loop a window of a single file.
  asm: AssembleSource | null
  el: HTMLVideoElement
  tex: WebGLTexture | null
  src: string // file currently loaded ('' = nothing)
  clip: CollageClip | null
  inSec: number // window start
  lenSec: number // window length (0 = whole file)
  content: [number, number, number, number] // picture rect inside the square layer
  pending: boolean // a decoded frame is waiting to be blitted
  rvfc: number
  seeking: boolean // gate : never queue a second seek
  seekAt: number
  churning: boolean // re-rolls its window on the fast clock
  nextRoll: number // seconds until this deck re-rolls (churn only)
  pan: [number, number] // where this deck's cells frame the picture
}

interface Cell {
  x: number
  y: number
  w: number
  h: number
  deck: number
  rot: number
  crop: [number, number, number, number]
}

export class CollageSource {
  private decks: Deck[] = []
  private cells: Cell[] = []
  private arr: WebGLTexture | null = null
  private arrLayers = 0
  private tile = 640
  private fbo: WebGLFramebuffer | null = null
  private pool: CollageClip[] = []
  private poolKey = ''
  private poolDirty = false
  private edls: CollageEdl[] = []
  private edlKey = ''
  private edlDirty = false
  private lastFeed = -1
  /** Base inputs from the store, overlaid by modulation's per-frame writes. */
  private live: Record<string, number | number[]> = {}
  private seed = 0x5eed1234
  private prevDeal = 0
  private dealTimer = 0
  private lastT = 0
  private lastCuts = -1
  private lastRotate = -1
  private lastZoom = -1
  private lastFilms = -1
  private disposed = false
  // Uniform staging, allocated once.
  private cellArr = new Float32Array(MAX_CELLS * 4)
  private cropArr = new Float32Array(MAX_CELLS * 4)
  private deckArr = new Float32Array(MAX_CELLS)
  private rotArr = new Float32Array(MAX_CELLS)
  private rankArr = new Float32Array(MAX_CELLS)

  constructor(
    private gl: WebGL2RenderingContext,
    private w: number,
    private h: number
  ) {}

  // ── Decks ──────────────────────────────────────────────────────────────

  private makeDeck(): Deck {
    const el = document.createElement('video')
    el.muted = true
    el.loop = true
    el.playsInline = true
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    const deck: Deck = {
      asm: null,
      el, tex: null, src: '', clip: null, inSec: 0, lenSec: 0,
      content: [0, 0, 1, 1], pending: false, rvfc: 0, seeking: false, seekAt: 0,
      churning: false, nextRoll: 0, pan: [0.5, 0.5]
    }
    el.addEventListener('seeked', () => { deck.seeking = false; deck.pending = true })
    // A bad file must never wedge the wall : clear the gate and let the deck
    // sit on whatever frame it has.
    el.addEventListener('error', () => { deck.seeking = false })
    const step = (): void => {
      deck.pending = true
      if (typeof el.requestVideoFrameCallback === 'function')
        deck.rvfc = el.requestVideoFrameCallback(step)
    }
    if (typeof el.requestVideoFrameCallback === 'function')
      deck.rvfc = el.requestVideoFrameCallback(step)
    return deck
  }

  /** An assemblage-fed deck : AssembleSource already owns playlist walking,
   *  gated seeks and the ping-pong pair that makes cross-FILE cuts free, so
   *  there is no second implementation of any of it here. */
  private makeAsmDeck(edl: CollageEdl): Deck {
    const asm = new AssembleSource(this.gl)
    asm.setPlaylist(edl.clips, true)
    asm.setPlaying(true)
    return {
      asm, el: document.createElement('video'), tex: null, src: edl.id, clip: null,
      inSec: 0, lenSec: 0, content: [0, 0, 1, 1], pending: false, rvfc: 0,
      seeking: false, seekAt: 0, churning: false, nextRoll: 0, pan: [0.5, 0.5]
    }
  }

  private killDeck(d: Deck): void {
    if (d.asm) {
      // The texture belongs to the AssembleSource : disposing that frees it, and
      // deleting it here as well would double-free.
      d.asm.dispose()
      d.asm = null
      d.tex = null
      return
    }
    try {
      if (d.rvfc && typeof d.el.cancelVideoFrameCallback === 'function')
        d.el.cancelVideoFrameCallback(d.rvfc)
      d.el.pause()
      d.el.removeAttribute('src')
      d.el.load()
    } catch {
      /* teardown is best-effort */
    }
    if (d.tex) this.gl.deleteTexture(d.tex)
    d.tex = null
  }

  private setDeckCount(n: number): void {
    n = Math.max(1, Math.min(MAX_DECKS, Math.round(n)))
    while (this.decks.length > n) this.killDeck(this.decks.pop()!)
    while (this.decks.length < n) this.decks.push(this.makeDeck())
    if (this.arrLayers !== n) this.allocArray(n)
  }

  /** One deck per selected assemblage. Rebuilt whenever the selection changes;
   *  identity is the edl id list, so re-picking the same set is a no-op. */
  private setAsmDecks(edls: CollageEdl[]): void {
    const want = edls.slice(0, MAX_DECKS)
    for (const d of this.decks) this.killDeck(d)
    this.decks = want.map((e) => this.makeAsmDeck(e))
    if (!this.decks.length) this.decks = [this.makeDeck()]
    this.allocArray(this.decks.length)
  }

  private allocArray(layers: number): void {
    const gl = this.gl
    if (this.arr) gl.deleteTexture(this.arr)
    this.arr = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arr)
    this.tile = tileFor(layers)
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, this.tile, this.tile, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
    if (!this.fbo) this.fbo = gl.createFramebuffer()
    this.arrLayers = layers
    // Every deck must re-blit into the new storage.
    for (const d of this.decks) d.pending = true
  }

  // ── Dealing ────────────────────────────────────────────────────────────

  /** Give every deck a clip and a window. `rnd` keeps a deal reproducible. */
  private deal(hold: number, churn: number): void {
    if (!this.pool.length) return
    const rnd = mulberry32(this.seed)
    const n = this.decks.length
    // Draw without repeats while the pool allows it, so a deal shows as many
    // different films as it can before it starts doubling up.
    const bag: CollageClip[] = []
    for (let i = 0; i < n; i++) {
      if (!bag.length) {
        bag.push(...this.pool)
        for (let k = bag.length - 1; k > 0; k--) {
          const j = Math.floor(rnd() * (k + 1))
          const t = bag[k]; bag[k] = bag[j]; bag[j] = t
        }
      }
      const clip = bag.pop()!
      const d = this.decks[i]
      // The churning decks are the FIRST `churn × n` : deterministic, so the
      // dial sweeps in a stable order instead of reshuffling who churns.
      d.churning = i < Math.round(churn * n)
      d.pan = [rnd(), rnd()]
      this.cue(d, clip, hold, rnd)
    }
    this.rebuildCrops()
  }

  /** Point one deck at a clip and a window inside it. */
  private cue(d: Deck, clip: CollageClip, hold: number, rnd: () => number): void {
    const url = `opsia-media://local/${encodeURIComponent(clip.file)}`
    const dur = Math.max(0.1, clip.durSec)
    const len = hold > 0.01 ? Math.min(hold, dur) : dur
    const inSec = len >= dur - 0.05 ? 0 : rnd() * (dur - len)
    d.clip = clip
    d.inSec = inSec
    d.lenSec = len
    d.nextRoll = 0.4 + rnd() * 3
    const av = clip.width > 0 && clip.height > 0 ? clip.width / clip.height : 16 / 9
    // Contain-fit inside the square layer : the whole frame is preserved, and
    // the per-cell COVER crop then chooses which part of it each piece shows.
    const cw = av >= 1 ? 1 : av
    const ch = av >= 1 ? 1 / av : 1
    d.content = [(1 - cw) / 2, (1 - ch) / 2, cw, ch]
    if (d.src !== url) {
      d.src = url
      d.el.src = url
      d.el.load()
    }
    // A window that is the whole file loops natively — no seeking at all, which
    // is by far the smoothest path. Sub-windows need the gated seek below.
    d.el.loop = len >= dur - 0.05
    this.seekTo(d, inSec)
    void d.el.play().catch(() => {
      /* autoplay can reject before the element is ready; the frame loop retries */
    })
  }

  /** One seek in flight per deck, with a stall safety net : a per-frame
   *  currentTime write means the decoder never settles (same law as
   *  VideoSource.seekTowardPos and AssembleSource.seekGated). */
  private seekTo(d: Deck, t: number): void {
    const now = performance.now()
    if (d.seeking && now - d.seekAt < 4000) return
    if (d.el.readyState < 1) {
      // Metadata not in yet : defer to the one-shot below rather than dropping it.
      d.el.addEventListener('loadedmetadata', () => this.seekTo(d, t), { once: true })
      return
    }
    if (Math.abs(d.el.currentTime - t) < 0.05) return
    d.seeking = true
    d.seekAt = now
    try {
      d.el.currentTime = Math.max(0, Math.min(t, (d.el.duration || t + 1) - 0.05))
    } catch {
      d.seeking = false
    }
  }

  // ── Partition ──────────────────────────────────────────────────────────

  /** The Autocutter's BSP : split the largest cell until we have `cuts` pieces. */
  private rebuildCells(cuts: number, rotateFrac: number): void {
    const rnd = mulberry32(this.seed ^ 0x9e3779b9)
    const minW = 0.06, minH = 0.06
    let rects: Array<{ x: number; y: number; w: number; h: number }> = [{ x: 0, y: 0, w: 1, h: 1 }]
    while (rects.length < cuts) {
      let idx = -1, area = -1
      for (let i = 0; i < rects.length; i++) {
        const c = rects[i]
        if (c.w >= minW * 2 || c.h >= minH * 2) {
          const a = c.w * c.h
          if (a > area) { area = a; idx = i }
        }
      }
      if (idx < 0) break
      const c = rects[idx]
      const canV = c.w >= minW * 2, canH = c.h >= minH * 2
      const vertical = canV && canH ? rnd() < c.w / (c.w + c.h) : canV
      const t = 0.35 + rnd() * 0.3
      if (vertical) {
        const sw = c.w * t
        rects.splice(idx, 1, { x: c.x, y: c.y, w: sw, h: c.h }, { x: c.x + sw, y: c.y, w: c.w - sw, h: c.h })
      } else {
        const sh = c.h * t
        rects.splice(idx, 1, { x: c.x, y: c.y, w: c.w, h: sh }, { x: c.x, y: c.y + sh, w: c.w, h: c.h - sh })
      }
    }
    if (rects.length > MAX_CELLS) rects = rects.slice(0, MAX_CELLS)
    const n = rects.length
    const nd = Math.max(1, this.decks.length)
    // Deal decks round-robin over a SHUFFLED cell order, so when there are more
    // cuts than films the repeats are scattered instead of landing side by side.
    const order = rects.map((_, i) => i)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const t = order[i]; order[i] = order[j]; order[j] = t
    }
    this.cells = rects.map((r) => ({ ...r, deck: 0, rot: 0, crop: [0, 0, 1, 1] as [number, number, number, number] }))
    for (let i = 0; i < n; i++) {
      const c = this.cells[order[i]]
      c.deck = i % nd
      c.rot = rotateFrac > 0 && rnd() < rotateFrac ? 1 + Math.floor(rnd() * 3) : 0
    }
    // MASK dropout order : a shuffled EVEN spacing over (0,0.90] so the dial
    // peels pieces at a steady rate. The ceiling sits below the shader's 0.06
    // fade band, and one seeded survivor holds an unreachable 2.0 — so full
    // mask always leaves exactly one piece, and every deal elects a new one.
    const drop = rects.map((_, i) => i)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const t = drop[i]; drop[i] = drop[j]; drop[j] = t
    }
    for (let i = 0; i < n; i++) this.rankArr[drop[i]] = ((i + 1) / n) * 0.9
    this.rankArr[Math.floor(rnd() * n)] = 2.0
    this.lastCuts = cuts
    this.lastRotate = rotateFrac
  }

  /** Cover-crop each cell's window into its deck's picture. Cheap, CPU-side,
   *  and re-run whenever the partition, the zoom or a deck's clip changes. */
  private rebuildCrops(zoom = this.lastZoom > 0 ? this.lastZoom : 1): void {
    const outAspect = this.w / this.h
    for (const c of this.cells) {
      const d = this.decks[c.deck]
      if (!d) continue
      const [cx, cy, cw, ch] = d.content
      // The layer is square, so the content rect's own ratio IS the clip aspect.
      const av = ch > 0 ? cw / ch : 1
      // The cell's aspect in real pixels; a quarter-turned piece frames the
      // picture through its flipped aspect.
      const raw = (c.w / c.h) * outAspect
      const ac = c.rot % 2 === 1 ? 1 / raw : raw
      let sw: number, sh: number
      if (ac >= av) { sw = cw; sh = ch * (av / ac) } else { sh = ch; sw = cw * (ac / av) }
      const z = Math.max(1, zoom)
      sw /= z
      sh /= z
      c.crop = [cx + (cw - sw) * d.pan[0], cy + (ch - sh) * d.pan[1], sw, sh]
    }
    this.lastZoom = zoom
  }

  // ── Frame ──────────────────────────────────────────────────────────────

  /** Called every frame by syncFromState with the slot's BASE inputs. The tick
   *  itself runs at render time, because applyModulation lands its overrides
   *  through setInput in between — reading them here would miss a frame and,
   *  worse, make modulated `cuts` / `films` / `mask` inert. */
  update(
    pool: CollageClip[],
    edls: CollageEdl[],
    inputs: Record<string, number | number[]>
  ): void {
    if (this.disposed) return
    // A changed pool (new folder, new selection) re-deals from scratch.
    const key = pool.map((c) => c.id).join('|')
    if (key !== this.poolKey) {
      this.pool = pool.slice()
      this.poolKey = key
      this.poolDirty = true
    }
    const ek = edls.map((e) => e.id).join('|')
    if (ek !== this.edlKey) {
      this.edls = edls.slice()
      this.edlKey = ek
      this.edlDirty = true
    }
    this.live = { ...inputs }
  }

  /** Modulation overlay (applyModulation runs after syncFromState). */
  setInput(name: string, value: number | number[]): void {
    this.live[name] = value
  }

  private tick(): void {
    const inputs = this.live
    const now = performance.now()
    const dt = this.lastT ? Math.min(0.25, (now - this.lastT) / 1000) : 0
    this.lastT = now

    const films = clampf(num(inputs.films, 12), 1, MAX_DECKS)
    const cuts = Math.round(clampf(num(inputs.cuts, 12), 2, MAX_CELLS))
    const rotate = clampf(num(inputs.rotate, 0), 0, 1)
    const hold = clampf(num(inputs.hold, 0), 0, 30)
    const churn = clampf(num(inputs.churn, 0), 0, 1)
    const zoom = clampf(num(inputs.zoom, 1.05), 1, 3)
    const speed = clampf(num(inputs.speed, 1), 0.1, 4)
    const rate = clampf(num(inputs.rate, 0), 0, 60)

    // feed 0 = the folder pool (one film per piece) · 1 = the Assemble bank
    // (one saved edit per piece). An empty selection falls back to the folder,
    // so switching the dial before picking anything can't blank the wall.
    const feed = this.edls.length && Math.round(num(inputs.feed, 0)) === 1 ? 1 : 0
    const poolChanged = this.poolDirty
    this.poolDirty = false
    const edlChanged = this.edlDirty
    this.edlDirty = false

    let deckChanged = feed !== this.lastFeed
    this.lastFeed = feed
    if (feed === 1) {
      if (deckChanged || edlChanged) {
        this.setAsmDecks(this.edls)
        deckChanged = true
      }
      this.lastFilms = -1 // force a rebuild when the dial goes back to folder
    } else {
      if (Math.round(films) !== this.lastFilms || deckChanged) {
        this.setDeckCount(films)
        this.lastFilms = Math.round(films)
        deckChanged = true
      }
    }
    if (cuts !== this.lastCuts || rotate !== this.lastRotate || deckChanged) {
      this.rebuildCells(cuts, rotate)
      this.rebuildCrops(zoom)
    }

    // A rising edge on the `deal` event, or the auto clock, re-deals everything.
    const dealNow = num(inputs.deal, 0) > 0.5
    let redeal = poolChanged || deckChanged
    if (dealNow && this.prevDeal < 0.5) redeal = true
    this.prevDeal = dealNow ? 1 : 0
    if (rate > 0.01) {
      this.dealTimer += dt
      if (this.dealTimer >= rate) { this.dealTimer = 0; redeal = true }
    } else {
      this.dealTimer = 0
    }
    if (redeal) {
      if (!poolChanged && !deckChanged) this.seed = (this.seed * 1664525 + 1013904223) >>> 0
      // Assemblage decks carry their own edit and their own pace : a deal only
      // re-cuts the partition and re-shuffles which piece shows which edit.
      if (feed === 0) this.deal(hold, churn)
      this.rebuildCells(cuts, rotate)
      this.rebuildCrops(zoom)
    }
    if (Math.abs(zoom - this.lastZoom) > 1e-4) this.rebuildCrops(zoom)

    // Per-deck housekeeping : rate, window looping, and the churn re-roll.
    const rnd = mulberry32((this.seed ^ 0x2545f491) >>> 0)
    let aspectMoved = false
    for (const d of this.decks) {
      if (d.asm) {
        // AssembleSource owns the walk; `speed` scales it like a layer clock.
        d.asm.tick(dt, speed)
        const [vw, vh] = d.asm.frameSize()
        if (vw > 0 && vh > 0) {
          // An edit cuts between clips of DIFFERENT aspects, so the piece has to
          // re-fit at every cut, not once when the deck was made.
          const av = vw / vh
          const cw = av >= 1 ? 1 : av
          const ch = av >= 1 ? 1 / av : 1
          if (Math.abs(cw - d.content[2]) > 1e-4 || Math.abs(ch - d.content[3]) > 1e-4) {
            d.content = [(1 - cw) / 2, (1 - ch) / 2, cw, ch]
            aspectMoved = true
          }
        }
        continue
      }
      if (!d.clip) continue
      const want = clampf(speed, RATE_MIN, RATE_MAX)
      if (Math.abs(d.el.playbackRate - want) > 1e-3) {
        try { d.el.playbackRate = want } catch { /* out-of-band rate */ }
      }
      if (d.el.paused && d.el.readyState >= 2) void d.el.play().catch(() => {})
      if (d.churning && churn > 0.001) {
        d.nextRoll -= dt
        if (d.nextRoll <= 0) {
          // Re-roll this deck's window (and, when the pool allows, its film) —
          // this cell becomes its own little montage.
          const clip = this.pool.length ? this.pool[Math.floor(rnd() * this.pool.length)] : d.clip
          d.pan = [rnd(), rnd()]
          this.cue(d, clip, hold, rnd)
          // The window moved, so every cell reading this deck re-frames.
          this.rebuildCrops(zoom)
          d.nextRoll = (0.25 + rnd() * 1.2) / Math.max(0.15, churn)
        }
      }
      // Sub-window looping : native loop only covers whole files.
      if (!d.el.loop && d.el.readyState >= 2 && !d.seeking) {
        const t = d.el.currentTime
        if (t >= d.inSec + d.lenSec || t < d.inSec - 0.25) this.seekTo(d, d.inSec)
      }
    }
    if (aspectMoved) this.rebuildCrops(zoom)
  }

  /** Draw the wall into the layer's scratch target. */
  render(scratchFbo: WebGLFramebuffer): void {
    if (this.disposed) return
    this.tick()
    const gl = this.gl
    const g = collageGL(gl)

    // 1) Fold every freshly decoded frame into its array layer.
    if (this.arr && this.fbo) {
      for (let i = 0; i < this.decks.length; i++) {
        const d = this.decks[i]
        if (d.asm) {
          const t = d.asm.upload()
          if (!t) continue
          d.tex = t
        } else {
          if (!d.pending || d.el.readyState < 2 || !d.el.videoWidth) continue
          d.pending = false
          d.tex = uploadVideoFrame(gl, d.el, d.tex)
        }
        if (!d.tex) continue
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.arr, 0, i)
        gl.viewport(0, 0, this.tile, this.tile)
        gl.useProgram(g.tile)
        gl.bindBuffer(gl.ARRAY_BUFFER, g.quad)
        gl.enableVertexAttribArray(0)
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, d.tex)
        gl.uniform1i(g.uTile('uSrc'), 0)
        gl.uniform4f(g.uTile('uContent'), d.content[0], d.content[1], d.content[2], d.content[3])
        gl.disable(gl.BLEND)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
    }

    // 2) Draw the collage.
    gl.bindFramebuffer(gl.FRAMEBUFFER, scratchFbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const n = Math.min(this.cells.length, MAX_CELLS)
    if (!n || !this.arr || !(this.pool.length || this.edls.length)) return
    for (let i = 0; i < n; i++) {
      const c = this.cells[i]
      this.cellArr[i * 4] = c.x; this.cellArr[i * 4 + 1] = c.y
      this.cellArr[i * 4 + 2] = c.w; this.cellArr[i * 4 + 3] = c.h
      this.cropArr[i * 4] = c.crop[0]; this.cropArr[i * 4 + 1] = c.crop[1]
      this.cropArr[i * 4 + 2] = c.crop[2]; this.cropArr[i * 4 + 3] = c.crop[3]
      this.deckArr[i] = c.deck
      this.rotArr[i] = c.rot
    }
    gl.useProgram(g.collage)
    gl.bindBuffer(gl.ARRAY_BUFFER, g.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arr)
    gl.uniform1i(g.uColl('uDecks'), 0)
    gl.uniform1i(g.uColl('uCount'), n)
    gl.uniform4fv(g.uColl('uCell'), this.cellArr)
    gl.uniform4fv(g.uColl('uCrop'), this.cropArr)
    gl.uniform1fv(g.uColl('uDeck'), this.deckArr)
    gl.uniform1fv(g.uColl('uRot'), this.rotArr)
    gl.uniform1fv(g.uColl('uRank'), this.rankArr)
    gl.uniform1f(g.uColl('uSeed'), (this.seed & 0xffff) / 65535)
    gl.uniform1f(g.uColl('uGap'), clampf(num(this.live.gap, 0), 0, 1))
    gl.uniform1f(g.uColl('uContour'), clampf(num(this.live.contour, 0), 0, 2))
    gl.uniform1f(g.uColl('uCurve'), clampf(num(this.live.curve, 0.3), 0, 1))
    gl.uniform1f(g.uColl('uTorn'), clampf(num(this.live.torn, 0), 0, 2))
    gl.uniform1f(g.uColl('uMask'), clampf(num(this.live.mask, 0), 0, 1))
    gl.disable(gl.BLEND)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    for (const d of this.decks) this.killDeck(d)
    this.decks = []
    if (this.arr) gl.deleteTexture(this.arr)
    if (this.fbo) gl.deleteFramebuffer(this.fbo)
    this.arr = null
    this.fbo = null
  }
}
