// TextSource — typography as a SOURCE, with the visual-convolution move applied:
// the glyphs are a matte, and another layer (the sidechain) can be the material
// that fills them — the letters become a window cut into the other source's
// texture/energy. No sidechain ⇒ solid colour fill.
//
// Two stages:
//  1. Rasterize: white glyphs on transparent, drawn on an offscreen 2D canvas at
//     engine resolution (bundled OFL display faces). Only re-drawn when a raster
//     param (text · font · size · weight · spacing) changes — or when the font
//     file finishes loading.
//  2. GL pass into the layer's scratch target: angle/position UV transform on
//     the MASK, fill sampled in screen space (the sidechain shows through the
//     letters like a matte, it doesn't rotate with them).

import type { SidechainRef } from '@shared/types'

// Order must match the gen-text header's font VALUES/LABELS (shaders/isf/index.ts).
export const TEXT_FONTS = [
  'Inter',
  'Space Grotesk',
  'JetBrains Mono',
  'Playfair Display',
  'Bebas Neue',
  'VT323'
]

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uMask, uFill;
uniform float uUseFill, uAngle, uAspect;
uniform vec2 uPos;
uniform vec4 uColor;
void main(){
  // Inverse-transform the lookup: position, then rotate about centre in
  // aspect-corrected space so glyphs don't shear.
  vec2 p = vUV - 0.5 - uPos;
  p.x *= uAspect;
  float ca = cos(-uAngle), sa = sin(-uAngle);
  p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
  p.x /= uAspect;
  vec2 uv = p + 0.5;
  float m = 0.0;
  if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) m = texture(uMask, uv).a;
  // Fill in SCREEN space — the sidechain material shows through the letters.
  vec3 fill = mix(uColor.rgb, texture(uFill, vUV).rgb * uColor.rgb, uUseFill);
  o = vec4(fill * m, 1.0);
}`

interface TextGL {
  prog: WebGLProgram
  quad: WebGLBuffer
  u: (n: string) => WebGLUniformLocation | null
}

const shared = new WeakMap<WebGL2RenderingContext, TextGL>()
function textGL(gl: WebGL2RenderingContext): TextGL {
  let g = shared.get(gl)
  if (g) return g
  const compile = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      console.error('[text] shader compile:', gl.getShaderInfoLog(s))
    return s
  }
  const prog = gl.createProgram()!
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS))
  gl.bindAttribLocation(prog, 0, 'p')
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    console.error('[text] link:', gl.getProgramInfoLog(prog))
  const quad = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const cache = new Map<string, WebGLUniformLocation | null>()
  g = {
    prog,
    quad,
    u: (n) => {
      if (!cache.has(n)) cache.set(n, gl.getUniformLocation(prog, n))
      return cache.get(n)!
    }
  }
  shared.set(gl, g)
  return g
}

const num = (v: number | number[] | undefined, d: number): number =>
  typeof v === 'number' ? v : d

export class TextSource {
  sidechain: SidechainRef | null = null
  private canvas = document.createElement('canvas')
  private mask: WebGLTexture | null = null
  private rasterKey = ''
  private text = 'OPSIA'
  private live: Record<string, number | number[]> = {}
  private disposed = false

  constructor(
    private gl: WebGL2RenderingContext,
    private w: number,
    private h: number
  ) {}

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

  private rasterize(fontIdx: number, size: number, weight: number, spacing: number): void {
    const c = this.canvas
    c.width = this.w
    c.height = this.h
    const ctx = c.getContext('2d')
    if (!ctx) return
    const family = TEXT_FONTS[fontIdx] ?? TEXT_FONTS[0]
    const px = Math.max(4, size * this.h)
    const font = `${Math.round(weight / 100) * 100} ${px}px "${family}"`
    // If the face isn't in memory yet, draw with the fallback now and force a
    // re-raster when the file lands (rasterKey cleared).
    if (typeof document !== 'undefined' && document.fonts && !document.fonts.check(font)) {
      void document.fonts.load(font, this.text).then(() => {
        this.rasterKey = ''
      })
    }
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.font = font
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // Canvas letterSpacing (Chromium 99+) — in px, derived from em spacing.
    ;(ctx as unknown as { letterSpacing: string }).letterSpacing = `${(spacing * px).toFixed(1)}px`
    // Multi-line: literal "\n" typed in the field, or pasted newlines.
    const lines = this.text.split(/\r?\n|\\n/)
    const lineH = px * 1.15
    const y0 = c.height / 2 - ((lines.length - 1) * lineH) / 2
    lines.forEach((line, i) => ctx.fillText(line, c.width / 2, y0 + i * lineH))

    // Upload (flipped — engine space is bottom-left).
    const gl = this.gl
    if (!this.mask) {
      this.mask = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.mask)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.mask)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  }

  /** Draw the text (mask × fill) into the layer's scratch target. */
  render(scratchFbo: WebGLFramebuffer, sidechainTex: WebGLTexture | null): void {
    if (this.disposed) return
    const gl = this.gl
    const inp = this.live
    const fontIdx = Math.max(0, Math.min(TEXT_FONTS.length - 1, Math.round(num(inp.font, 0))))
    const size = Math.max(0.01, Math.min(1.5, num(inp.size, 0.25)))
    const weight = Math.max(100, Math.min(900, num(inp.weight, 700)))
    const spacing = Math.max(-0.2, Math.min(1, num(inp.spacing, 0)))

    // Re-rasterize only when a raster param changed (size quantized so a slow
    // modulation doesn't re-draw on sub-pixel jitter).
    const key = `${this.text}|${fontIdx}|${size.toFixed(3)}|${Math.round(weight / 100)}|${spacing.toFixed(2)}|${this.w}x${this.h}`
    if (key !== this.rasterKey) {
      this.rasterize(fontIdx, size, weight, spacing)
      this.rasterKey = key
    }
    if (!this.mask) return

    const g = textGL(gl)
    gl.useProgram(g.prog)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, g.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, scratchFbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.mask)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, sidechainTex ?? this.mask)
    gl.uniform1i(g.u('uMask'), 0)
    gl.uniform1i(g.u('uFill'), 1)
    gl.uniform1f(g.u('uUseFill'), sidechainTex ? 1 : 0)
    gl.uniform1f(g.u('uAngle'), num(inp.angle, 0))
    gl.uniform1f(g.u('uAspect'), this.w / this.h)
    gl.uniform2f(g.u('uPos'), num(inp.posX, 0) * 0.5, num(inp.posY, 0) * 0.5)
    const col = Array.isArray(inp.color) ? inp.color : [1, 1, 1, 1]
    gl.uniform4f(g.u('uColor'), col[0] ?? 1, col[1] ?? 1, col[2] ?? 1, col[3] ?? 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  dispose(): void {
    this.disposed = true
    if (this.mask) this.gl.deleteTexture(this.mask)
    this.mask = null
  }
}
