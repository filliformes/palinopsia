// TextSource : typography as a SOURCE, with the visual-convolution move applied:
// the glyphs are a matte, and another layer (the fill) can be the material that
// shows through them : the letters become a window cut into that layer's
// picture. No fill layer ⇒ solid color.
//
// A glyph ATLAS laid out per glyph on the GPU, in three stages:
//  1. Layout (CPU, only when the shown text / font / weight changes). Each line
//     is measured on a 2D canvas. A glyph's pen position is the width of the
//     line up to and including it minus its own advance, so pair kerning
//     survives. Positions are kept in em : size, spacing, stretch, crawl, angle
//     and position are then pure vertex math, so they modulate smoothly and
//     never re-rasterize.
//  2. Atlas (CPU → an R8 texture, only when the glyph set or the raster scale
//     step changes). Each distinct glyph is drawn once, white on black, at the
//     on-screen pixel size rounded UP to a quarter-octave step, with the
//     vertical stretch baked in (so a tall stretch stays crisp).
//  3. Draw (GPU, every frame). One instanced quad per glyph into the layer's
//     scratch target, straight alpha : rgb = color × coverage, a = coverage, so
//     a Normal blend keeps the layers below visible around the letters. The fill
//     is sampled in SCREEN space (the fill layer shows through the letters, it
//     doesn't rotate with them). Per-glyph data also drives the letter drift and
//     the typewriter reveal.
//
// GL hygiene : its own VAO (never the default one the ISF runtime wires), and
// the shared program is rebuilt when a GPU reset has killed it.

import type { SidechainRef } from '@shared/types'
import { TEXT_FONTS, textFontWeightRange } from '../textFonts'
import { glGeneration } from './glGeneration'

const VS = `#version 300 es
layout(location = 0) in vec2 aCorner;  // quad corner 0..1
layout(location = 1) in vec4 aBox;     // glyph cell in em around its pen point : x0 y0 x1 y1 (y up)
layout(location = 2) in vec4 aUV;      // atlas cell : u0 vTop u1 vBottom
layout(location = 3) in vec4 aPen;     // pen x (em, line-centred) · baseline y (em) · spacing slot · seed
layout(location = 4) in float aOrder;  // reading order (0..1] for the typewriter reveal
uniform float uSize, uSpacing, uStretch, uAngle, uAspect, uCrawl, uDrift, uTime, uReveal;
uniform vec2 uPos;
out vec2 vUV;
void main(){
  if (aOrder > uReveal + 1e-4) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUV = vec2(0.0); return; }
  vec2 local = mix(aBox.xy, aBox.zw, aCorner);
  if (uDrift > 0.0) {
    // Each letter wanders and tilts on its own slow rates and phases.
    float s = aPen.w;
    vec2 c = 0.5 * (aBox.xy + aBox.zw);
    float p1 = uTime * (0.35 + 0.5 * fract(s * 7.13)) + 6.2832 * fract(s * 3.37);
    float p2 = uTime * (0.3 + 0.45 * fract(s * 5.71)) + 6.2832 * fract(s * 9.91);
    float r = uDrift * 0.3 * sin(uTime * (0.25 + 0.4 * fract(s * 2.39)) + 6.2832 * fract(s * 4.53));
    vec2 l = local - c;
    l = vec2(cos(r) * l.x - sin(r) * l.y, sin(r) * l.x + cos(r) * l.y);
    local = c + l + uDrift * vec2(0.09 * sin(p1), 0.12 * sin(p2));
  }
  vec2 q = vec2(aPen.x + aPen.z * uSpacing + uCrawl, aPen.y) + local; // em, block space
  q *= uSize;        // frame-height units
  q.y *= uStretch;   // along the letters' own vertical axis (condensed ↔ extended)
  float ca = cos(uAngle), sa = sin(uAngle);
  q = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y) + uPos;
  gl_Position = vec4(q.x * 2.0 / uAspect, q.y * 2.0, 0.0, 1.0);
  vUV = vec2(mix(aUV.x, aUV.z, aCorner.x), mix(aUV.w, aUV.y, aCorner.y));
}`

const FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uAtlas, uFill;
uniform float uUseFill;
uniform vec4 uColor;
uniform vec2 uRes;
void main(){
  float m = texture(uAtlas, vUV).r;
  vec3 fill = uColor.rgb;
  if (uUseFill > 0.5) fill *= texture(uFill, gl_FragCoord.xy / uRes).rgb;
  o = vec4(fill * m, m * uColor.a);
}`

const UNIFORMS = [
  'uSize', 'uSpacing', 'uStretch', 'uAngle', 'uAspect', 'uCrawl', 'uDrift', 'uTime', 'uReveal',
  'uPos', 'uAtlas', 'uFill', 'uUseFill', 'uColor', 'uRes'
] as const
type UName = (typeof UNIFORMS)[number]

interface TextProg {
  prog: WebGLProgram
  u: Record<UName, WebGLUniformLocation | null>
  gen: number // the GL generation it was built in (glGeneration.ts)
}

// One program per context, validated once per TextSource (never per frame :
// gl.isProgram is a blocking round-trip to the GPU process). A GPU reset keeps
// the same context object but kills its programs; the engine then rebuilds its
// sources, and the first new one finds the cached program dead and rebuilds it.
const progs = new WeakMap<WebGL2RenderingContext, TextProg>()
function textProg(gl: WebGL2RenderingContext): TextProg {
  const have = progs.get(gl)
  if (have && have.gen === glGeneration() && gl.isProgram(have.prog)) return have
  const compile = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      console.error('[text] shader compile:', gl.getShaderInfoLog(s))
    return s
  }
  const prog = gl.createProgram()!
  const vs = compile(gl.VERTEX_SHADER, VS)
  const fs = compile(gl.FRAGMENT_SHADER, FS)
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    console.error('[text] link:', gl.getProgramInfoLog(prog))
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  const u = {} as Record<UName, WebGLUniformLocation | null>
  for (const n of UNIFORMS) u[n] = gl.getUniformLocation(prog, n)
  const g = { prog, u, gen: glGeneration() }
  progs.set(gl, g)
  return g
}

const num = (v: number | number[] | undefined, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : d

const MEASURE_PX = 200 // layout is measured at this em size, then kept in em
const LINE_H = 1.15 // line pitch in em
const PREFIX_MAX = 160 // longer lines measure pairs instead of prefixes (O(n) vs O(n²))
const ATLAS_BUDGET = 8e6 // max atlas pixels (8 MB as R8) : huge text gets a coarser raster
const FLOATS = 13 // per-instance floats : box 4 · uv 4 · pen 4 · order 1

// Ink box of one glyph in em around its pen point (canvas TextMetrics).
interface Glyph { l: number; r: number; a: number; d: number }
// One inked glyph placed in the block (em; y up, block centred on 0).
interface Placed { ch: string; x: number; y: number; slot: number; order: number; seed: number }
interface Layout {
  glyphs: Map<string, Glyph>
  placed: Placed[]
  lines: { w: number; n: number }[] // advance width (em, no spacing) + char count per line
  top: number // ink extent of the block (em)
  bottom: number
}

// A small integer hash → [0,1) : a stable per-glyph seed.
function seedOf(k: number, i: number): number {
  let h = (Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(i + 7, 0x85ebca77)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

// Raster scale step : the on-screen px rounded UP to a quarter octave, so the
// atlas is never magnified and never more than ~1.19× too fine.
const bucket = (px: number): number =>
  Math.round(Math.pow(2, Math.ceil(Math.log2(Math.max(8, px)) * 4) / 4))

export class TextSource {
  sidechain: SidechainRef | null = null
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')
  private atlas: WebGLTexture | null = null
  private prog: TextProg | null = null // resolved on the first live frame
  private vao: WebGLVertexArrayObject
  private corner: WebGLBuffer
  private inst: WebGLBuffer
  private count = 0
  private text = 'OPSIA'
  private live: Record<string, number | number[]> = {}
  private disposed = false
  // Layout / atlas cache keys ('' forces a rebuild, e.g. when a font file lands).
  private layoutKey = ''
  private rasterKey = ''
  private layout: Layout | null = null
  // Line cues + crawl + clock state.
  private cue = 0
  private prevLine = 0
  private crawlX = 0 // frame-height units along the text's own baseline
  private lastClock: number | null = null
  private t0 = 0

  constructor(
    private gl: WebGL2RenderingContext,
    private w: number,
    private h: number
  ) {
    // Own VAO : the corner strip (per vertex) + the glyph instances (per instance).
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.corner = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corner)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.inst = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst)
    gl.bufferData(gl.ARRAY_BUFFER, FLOATS * 4, gl.DYNAMIC_DRAW)
    const stride = FLOATS * 4
    const attr = (loc: number, size: number, off: number): void => {
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4)
      gl.vertexAttribDivisor(loc, 1)
    }
    attr(1, 4, 0)
    attr(2, 4, 4)
    attr(3, 4, 8)
    attr(4, 1, 12)
    gl.bindVertexArray(null)
  }

  /** Base state from the store, pushed each frame by syncFromState. */
  update(text: string, inputs: Record<string, number | number[]>, sidechain: SidechainRef | null): void {
    this.text = text
    this.live = { ...inputs }
    this.sidechain = sidechain
  }

  /** Modulation overlay (applyModulation runs after syncFromState). */
  setInput(name: string, value: number | number[]): void {
    this.live[name] = value
  }

  // ── Layout ──────────────────────────────────────────────────────────
  private fontString(weight: number, px: number, family: string): string {
    return `${weight} ${px}px "${family}"`
  }

  private measure(family: string, weight: number, lines: string[]): Layout | null {
    const ctx = this.ctx
    if (!ctx) return null
    const M = MEASURE_PX
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.font = this.fontString(weight, M, family)
    ;(ctx as unknown as { letterSpacing: string }).letterSpacing = '0px'
    ;(ctx as unknown as { fontKerning: string }).fontKerning = 'normal'
    ctx.textAlign = 'left'
    // The em box's middle above the baseline : lines are centred on it, as the
    // old full-frame raster did with textBaseline 'middle'.
    ctx.textBaseline = 'middle'
    const hm = ctx.measureText('H').actualBoundingBoxAscent
    ctx.textBaseline = 'alphabetic'
    const ha = ctx.measureText('H').actualBoundingBoxAscent
    const mid = (ha - hm) / M

    const glyphs = new Map<string, Glyph>()
    const adv = new Map<string, number>()
    const advOf = (s: string): number => {
      let v = adv.get(s)
      if (v === undefined) {
        v = ctx.measureText(s).width
        adv.set(s, v)
      }
      return v
    }
    const placed: Placed[] = []
    const lineInfo: { w: number; n: number }[] = []
    const total = lines.reduce((s, l) => s + Array.from(l).length, 0)
    let order = 0
    let top = -Infinity
    let bottom = Infinity
    lines.forEach((line, k) => {
      const chars = Array.from(line)
      const n = chars.length
      const W = n ? ctx.measureText(line).width : 0
      lineInfo.push({ w: W / M, n })
      const baseline = ((lines.length - 1) / 2 - k) * LINE_H - mid
      let prefix = ''
      let pen = 0
      for (let i = 0; i < n; i++) {
        const ch = chars[i]
        prefix += ch
        // Pen x of glyph i = width(line[0..i]) − advance(ch) : the kerning with
        // the previous glyph is inside the prefix, the one with the next isn't.
        if (n <= PREFIX_MAX) pen = ctx.measureText(prefix).width - advOf(ch)
        else if (i > 0) pen += advOf(chars[i - 1] + ch) - advOf(ch)
        order++
        let g = glyphs.get(ch)
        if (!g) {
          const tm = ctx.measureText(ch)
          g = {
            l: tm.actualBoundingBoxLeft / M,
            r: tm.actualBoundingBoxRight / M,
            a: tm.actualBoundingBoxAscent / M,
            d: tm.actualBoundingBoxDescent / M
          }
          glyphs.set(ch, g)
        }
        if (g.l + g.r <= 1e-4 || g.a + g.d <= 1e-4) continue // whitespace : no ink
        placed.push({
          ch,
          x: (pen - W / 2) / M,
          y: baseline,
          slot: i - (n - 1) / 2,
          order: order / Math.max(1, total),
          seed: seedOf(k, i)
        })
        top = Math.max(top, baseline + g.a)
        bottom = Math.min(bottom, baseline - g.d)
      }
    })
    if (!placed.length) {
      top = 0
      bottom = 0
    }
    return { glyphs, placed, lines: lineInfo, top, bottom }
  }

  // ── Atlas ───────────────────────────────────────────────────────────
  private buildAtlas(family: string, weight: number, rx: number, ry: number): void {
    const L = this.layout
    const ctx = this.ctx
    const gl = this.gl
    if (!L || !ctx) return
    const inked = [...L.glyphs.entries()].filter(([, g]) => g.l + g.r > 1e-4 && g.a + g.d > 1e-4)
    const maxTex = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number)
    interface Cell { ch: string; g: Glyph; w: number; h: number; px: number; py: number; x: number; y: number }
    let cells: Cell[] = []
    let aw = 0
    let ah = 0
    for (let attempt = 0; attempt < 6; attempt++) {
      const px = 2 + Math.ceil(0.01 * rx)
      const py = 2 + Math.ceil(0.01 * ry)
      cells = inked.map(([ch, g]) => ({
        ch, g, px, py, x: 0, y: 0,
        w: Math.ceil((g.l + g.r) * rx) + 2 * px,
        h: Math.ceil((g.a + g.d) * ry) + 2 * py
      }))
      const area = cells.reduce((s, c) => s + c.w * c.h, 0)
      const widest = cells.reduce((s, c) => Math.max(s, c.w), 1)
      if (area > ATLAS_BUDGET || widest > maxTex) {
        const k = Math.min(Math.sqrt(ATLAS_BUDGET / area), (maxTex * 0.95) / widest) * 0.98
        rx = Math.max(8, Math.floor(rx * k))
        ry = Math.max(8, Math.floor(ry * k))
        continue
      }
      // Shelf pack, tallest first.
      aw = Math.min(maxTex, Math.max(widest, Math.ceil((Math.sqrt(area) * 1.15) / 64) * 64))
      cells.sort((p, q) => q.h - p.h)
      let x = 0
      let y = 0
      let shelf = 0
      for (const c of cells) {
        if (x + c.w > aw) {
          y += shelf
          x = 0
          shelf = 0
        }
        c.x = x
        c.y = y
        x += c.w
        shelf = Math.max(shelf, c.h)
      }
      ah = y + shelf
      if (ah <= maxTex) break
      rx = Math.max(8, Math.floor(rx * 0.8))
      ry = Math.max(8, Math.floor(ry * 0.8))
    }
    aw = Math.max(1, aw)
    ah = Math.max(1, ah)

    // Draw : white glyphs on opaque black, so the RED channel is the coverage
    // (uploaded as R8). The canvas is only resized when the atlas size changes.
    const c = this.canvas
    if (c.width !== aw || c.height !== ah) {
      c.width = aw
      c.height = ah
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, aw, ah)
    ctx.fillStyle = '#fff'
    ctx.font = this.fontString(weight, rx, family)
    ;(ctx as unknown as { letterSpacing: string }).letterSpacing = '0px'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    const cellOf = new Map<string, { box: number[]; uv: number[] }>()
    for (const cl of cells) {
      // Stretch baked in : the vertical axis is drawn at ry px per em.
      ctx.setTransform(1, 0, 0, ry / rx, cl.x + cl.px + cl.g.l * rx, cl.y + cl.py + cl.g.a * ry)
      ctx.fillText(cl.ch, 0, 0)
      const x0 = -cl.g.l - cl.px / rx
      const y1 = cl.g.a + cl.py / ry
      cellOf.set(cl.ch, {
        box: [x0, y1 - cl.h / ry, x0 + cl.w / rx, y1],
        uv: [cl.x / aw, cl.y / ah, (cl.x + cl.w) / aw, (cl.y + cl.h) / ah]
      })
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    if (!this.atlas) {
      this.atlas = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.atlas)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.atlas)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, c)

    // Instances : one per inked glyph.
    const data = new Float32Array(Math.max(1, L.placed.length) * FLOATS)
    let n = 0
    for (const p of L.placed) {
      const cc = cellOf.get(p.ch)
      if (!cc) continue
      const o = n * FLOATS
      data.set(cc.box, o)
      data.set(cc.uv, o + 4)
      data[o + 8] = p.x
      data[o + 9] = p.y
      data[o + 10] = p.slot
      data[o + 11] = p.seed
      data[o + 12] = p.order
      n++
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
    this.count = n
  }

  // ── Frame ───────────────────────────────────────────────────────────
  /** Draw the text (coverage × fill, straight alpha) into the layer's scratch
   *  target. `clockSec` is the layer clock (Speed / freeze apply); without it
   *  the wall clock drives the crawl and the letter drift. */
  render(scratchFbo: WebGLFramebuffer, sidechainTex: WebGLTexture | null, clockSec?: number): void {
    const gl = this.gl
    // Lost context (a GPU reset in progress) : nothing can be created or drawn;
    // the engine is rebuilt on restore.
    if (this.disposed || gl.isContextLost()) return
    const inp = this.live
    if (this.t0 === 0) this.t0 = performance.now()
    const clock = typeof clockSec === 'number' ? clockSec : (performance.now() - this.t0) / 1000
    const dt = this.lastClock === null ? 0 : Math.max(0, Math.min(0.25, clock - this.lastClock))
    this.lastClock = clock

    const fontIdx = Math.max(0, Math.min(TEXT_FONTS.length - 1, Math.round(num(inp.font, 1))))
    const family = TEXT_FONTS[fontIdx] ?? TEXT_FONTS[0]
    const [wLo, wHi] = textFontWeightRange(fontIdx)
    // Clamped to the weights the face really has : the browser never fakes a bold.
    const weight = Math.round(Math.max(wLo, Math.min(wHi, num(inp.weight, 700))) / 10) * 10
    const size = Math.max(0.01, Math.min(1.5, num(inp.size, 0.25)))
    const spacing = Math.max(-0.2, Math.min(1, num(inp.spacing, 0)))
    const stretch = Math.max(0.25, Math.min(4, num(inp.stretch, 1)))
    const angle = num(inp.angle, 0)
    const aspect = this.w / this.h
    const posX = num(inp.posX, 0) * 0.5 * aspect
    const posY = num(inp.posY, 0) * 0.5
    const scroll = Math.max(-2, Math.min(2, num(inp.scroll, 0)))

    // Lines : all of them, or one cue at a time stepped by the `line` event.
    const all = this.text.split(/\r?\n|\\n/)
    const oneAtATime = num(inp.lines, 0) >= 0.5
    const ev = num(inp.line, 0)
    if (oneAtATime && ev > 0.5 && this.prevLine <= 0.5) this.cue++
    this.prevLine = ev
    if (all.length) this.cue = ((this.cue % all.length) + all.length) % all.length
    const shown = oneAtATime ? [all[this.cue] ?? ''] : all

    // 1. Layout (text / font / weight).
    const lkey = `${fontIdx}|${weight}|${shown.join('\n')}`
    if (lkey !== this.layoutKey) {
      const font = this.fontString(weight, MEASURE_PX, family)
      // Face not in memory yet : lay out with the fallback now, redo when it lands.
      if (typeof document !== 'undefined' && document.fonts && !document.fonts.check(font)) {
        void document.fonts.load(font, shown.join('') || 'A').then(() => {
          this.layoutKey = ''
        })
      }
      this.layout = this.measure(family, weight, shown)
      this.layoutKey = lkey
      this.rasterKey = ''
    }
    const L = this.layout
    // Block size in em (advance width with spacing, ink height).
    let blockW = 0
    if (L) for (const ln of L.lines) blockW = Math.max(blockW, ln.w + Math.max(0, ln.n - 1) * spacing)
    const blockH = L ? Math.max(0, L.top - L.bottom) : 0

    // Shrink to fit (never enlarges). While crawling only the height is fitted.
    let sizeEff = size
    if (num(inp.fit, 0) >= 0.5 && blockW > 0 && blockH > 0) {
      const c = Math.abs(Math.cos(angle))
      const s = Math.abs(Math.sin(angle))
      const hs = blockH * stretch
      const fitH = scroll !== 0 ? 0.92 / hs : 0.92 / (s * blockW + c * hs)
      const fitW = scroll !== 0 ? Infinity : (0.92 * aspect) / (c * blockW + s * hs)
      sizeEff = Math.max(0.005, Math.min(size, fitH, fitW))
    }

    // 2. Atlas (glyph set / raster step).
    const rx = Math.min(4096, bucket(sizeEff * this.h))
    const ry = Math.min(8192, bucket(sizeEff * this.h * stretch))
    const rkey = `${lkey}|${rx}|${ry}`
    if (rkey !== this.rasterKey) {
      this.buildAtlas(family, weight, rx, ry)
      this.rasterKey = rkey
    }

    // Crawl : a ticker along the text's own baseline, in frame widths per second
    // (positive runs right to left). Integrated state, so changing the speed,
    // size or angle never jumps; it loops once the block has fully left.
    if (scroll === 0) {
      this.crawlX = 0
    } else {
      const ca = Math.cos(angle)
      const sa = Math.sin(angle)
      const half = 0.5 * (aspect * Math.abs(ca) + Math.abs(sa)) + Math.abs(posX * ca + posY * sa)
      const reach = half + (blockW * sizeEff) / 2
      this.crawlX -= scroll * aspect * dt
      if (this.crawlX < -reach) this.crawlX = reach - ((-reach - this.crawlX) % (2 * reach))
      else if (this.crawlX > reach) this.crawlX = -reach + ((this.crawlX - reach) % (2 * reach))
    }

    // 3. Draw.
    gl.bindFramebuffer(gl.FRAMEBUFFER, scratchFbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!this.atlas || this.count === 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return
    }
    if (!this.prog) this.prog = textProg(gl)
    const g = this.prog
    gl.useProgram(g.prog)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.atlas)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, sidechainTex ?? this.atlas)
    gl.uniform1i(g.u.uAtlas, 0)
    gl.uniform1i(g.u.uFill, 1)
    gl.uniform1f(g.u.uUseFill, sidechainTex ? 1 : 0)
    gl.uniform1f(g.u.uSize, sizeEff)
    gl.uniform1f(g.u.uSpacing, spacing)
    gl.uniform1f(g.u.uStretch, stretch)
    gl.uniform1f(g.u.uAngle, angle)
    gl.uniform1f(g.u.uAspect, aspect)
    gl.uniform1f(g.u.uCrawl, this.crawlX / sizeEff)
    gl.uniform1f(g.u.uDrift, Math.max(0, Math.min(1, num(inp.drift, 0))))
    gl.uniform1f(g.u.uTime, clock % 100000)
    gl.uniform1f(g.u.uReveal, Math.max(0, Math.min(1, num(inp.reveal, 1))))
    gl.uniform2f(g.u.uPos, posX, posY)
    gl.uniform2f(g.u.uRes, this.w, this.h)
    const col = Array.isArray(inp.color) ? inp.color : [1, 1, 1, 1]
    gl.uniform4f(g.u.uColor, col[0] ?? 1, col[1] ?? 1, col[2] ?? 1, col[3] ?? 1)
    // Overlapping glyph cells (tight kerning, negative spacing) : keep the max.
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.MAX)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count)
    gl.blendEquation(gl.FUNC_ADD)
    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    if (this.atlas) gl.deleteTexture(this.atlas)
    this.atlas = null
    // Buffers die inside our own VAO, never the default one.
    gl.bindVertexArray(this.vao)
    gl.deleteBuffer(this.corner)
    gl.deleteBuffer(this.inst)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(this.vao)
    this.canvas.width = 1
    this.canvas.height = 1
  }
}
