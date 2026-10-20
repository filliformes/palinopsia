// Compiling an ISF shader and saying what is wrong, on its own lines : shared
// by the Source Editor (its live preview) and the agent's write_shader /
// preview_shader (shaders/../mcp/tools.ts), which also render a still of it
// running alone on a small context of their own, off the output.

import { Parser as ISFParser, Renderer as ISFRenderer } from 'interactive-shader-format'
import { makeRedirectableGL } from '../engine/Compositor'
import { handle } from '../engine/isfTextureBridge'
import { SHADER_BY_ID } from './isf'
import { categoryOf } from './userShaders'

export interface ShaderMark { line: number; msg: string; level: 'error' | 'warn' }

/** Two ISF traps the compiler explains badly (a typo, a missing ; are the
 *  compiler's own errors, on their line), and a shader that draws nothing. */
export function lintIsf(source: string): ShaderMark[] {
  const out: ShaderMark[] = []
  const lines = source.split('\n')
  const headerEnd = lines.findIndex((l) => l.includes('*/'))
  const events = new Set<string>()
  try {
    const m = source.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//)
    const j = m ? (JSON.parse(m[1]) as { INPUTS?: Array<{ NAME?: string; TYPE?: string }> }) : null
    for (const i of j?.INPUTS ?? []) if (i.TYPE === 'event' && i.NAME) events.add(i.NAME)
  } catch { /* the header error is reported by the compiler */ }
  lines.forEach((l, i) => {
    if (i <= headerEnd) return
    const code = l.replace(/\/\/.*$/, '')
    const im = code.match(/IMG_(?:NORM_)?PIXEL\s*\(\s*\w+\s*,\s*([^)]*)\)/)
    if (im && !/^\s*\w+\s*$/.test(im[1])) out.push({ line: i + 1, level: 'warn', msg: 'IMG_NORM_PIXEL / IMG_PIXEL want a plain variable as their coordinate : put the expression in a vec2 first.' })
    for (const ev of events) {
      if (new RegExp(`\\b${ev}\\s*[<>=!]=?\\s*[0-9.]`).test(code))
        out.push({ line: i + 1, level: 'warn', msg: `“${ev}” is an event : a bool here. Test it as it is (if (${ev})), not against a number.` })
    }
  })
  if (!/gl_FragColor|isf_FragColor/.test(source)) out.push({ line: Math.max(1, headerEnd + 2), level: 'warn', msg: 'Nothing writes gl_FragColor : the shader draws nothing.' })
  return out
}

/** Build it on `rgl` (a makeRedirectableGL wrapper of `gl`) : the renderer when
 *  it compiles (the caller owns it), else the errors, mapped back onto the
 *  source's lines (0 : no line). */
export function compileIsf(
  gl: WebGL2RenderingContext,
  rgl: WebGL2RenderingContext,
  source: string
): { renderer: ISFRenderer | null; errors: ShaderMark[] } {
  let r: ISFRenderer | null = null
  let thrown: unknown = null
  try {
    r = new ISFRenderer(rgl)
    r.loadSource(source)
  } catch (e) {
    thrown = e
  }
  if (r && r.valid && !thrown) return { renderer: r, errors: [] }
  const errs: ShaderMark[] = []
  const lines = source.split('\n')
  const msg = String((r?.error as { message?: string } | undefined)?.message ?? r?.error ?? thrown ?? '')
  const open = Math.max(0, lines.findIndex((l) => l.includes('/*')))
  const close = lines.findIndex((l) => l.includes('*/'))
  if (/metadata|There is no metadata/i.test(msg)) {
    const n = typeof r?.errorLine === 'number' ? (r.errorLine as number) : 1
    errs.push({ line: open + n, level: 'error', msg: msg.replace(/^Error:\s*/, '') })
  } else if (r?.fragmentShader) {
    // The runtime throws its GLSL log away : compile the shader it built again
    // here, read the log, and move each line back onto the source's.
    const sh = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(sh, r.fragmentShader)
    gl.compileShader(sh)
    const log = gl.getShaderInfoLog(sh) ?? ''
    gl.deleteShader(sh)
    const prefix = ISFParser.fragmentShaderSkeleton.split('[[main]]')[0].replace('[[uniforms]]', r.model?.uniformDefs ?? '')
    const before = prefix.split('\n').length // GLSL line of the source's "*/" line
    for (const l of log.split('\n')) {
      const m = l.match(/ERROR:\s*\d+:(\d+):\s*(.*)/)
      if (!m) continue
      const gLine = Number(m[1])
      const line = gLine >= before && close >= 0 ? close + 1 + (gLine - before) : 0
      errs.push({ line: line >= 1 && line <= lines.length ? line : 0, level: 'error', msg: m[2].trim() })
    }
    if (!errs.length) errs.push({ line: 0, level: 'error', msg: msg || 'It does not compile.' })
  } else {
    errs.push({ line: 0, level: 'error', msg: msg || 'It does not compile.' })
  }
  try { r?.cleanup() } catch { /* never built */ }
  return { renderer: null, errors: errs }
}

// ── a still of a shader running alone (the agent's eyes on it) ──────────
interface StillGL {
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext
  rgl: WebGL2RenderingContext
  state: { redirect: WebGLFramebuffer | null }
}
let still: StillGL | null = null
function stillGL(): StillGL | null {
  if (still && !still.gl.isContextLost()) return still
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 16
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false })
  if (!gl) return null
  const { gl: rgl, state } = makeRedirectableGL(gl)
  still = { canvas, gl, rgl, state }
  return still
}

function target(gl: WebGL2RenderingContext, w: number, h: number): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { fbo, tex }
}

/** A control value as the runtime wants it, from the header's declared type. */
function headerTypes(source: string): Map<string, string> {
  const out = new Map<string, string>()
  try {
    const m = source.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//)
    const j = m ? (JSON.parse(m[1]) as { INPUTS?: Array<{ NAME?: string; TYPE?: string }> }) : null
    for (const i of j?.INPUTS ?? []) if (i.NAME && i.TYPE) out.set(i.NAME, i.TYPE)
  } catch { /* none */ }
  return out
}

export interface StillResult {
  ok: boolean
  /** errors (when it does not compile) and the linter's warnings */
  marks: ShaderMark[]
  /** a JPEG, base64, when it compiled */
  jpeg?: string
  width: number
  height: number
}

/** Compile `source` and render a still of it, `time` seconds into its clock
 *  (a few frames leading up to it, so trails and integrated phases have moved).
 *  An effect reads a stock generator under it. Nothing on screen changes. */
export function renderStill(
  source: string,
  opts: { width?: number; height?: number; values?: Record<string, unknown>; time?: number; under?: string } = {}
): StillResult {
  const W = Math.max(64, Math.min(1280, Math.round(opts.width ?? 512)))
  const H = Math.max(36, Math.min(1280, Math.round(opts.height ?? (W * 9) / 16)))
  const lints = lintIsf(source)
  const g = stillGL()
  if (!g) return { ok: false, marks: [{ line: 0, level: 'error', msg: 'No WebGL2 context for the preview.' }, ...lints], width: W, height: H }
  const { gl, rgl, state } = g
  const { renderer, errors } = compileIsf(gl, rgl, source)
  if (!renderer) return { ok: false, marks: [...errors, ...lints], width: W, height: H }
  const out = target(gl, W, H)
  const inp = target(gl, W, H)
  let under: ISFRenderer | null = null
  try {
    const fx = categoryOf(source) === 'FX'
    if (fx) {
      const src = SHADER_BY_ID[opts.under ?? 'filaments']?.source ?? SHADER_BY_ID.filaments?.source
      if (src) {
        under = compileIsf(gl, rgl, src).renderer
      }
    }
    const types = headerTypes(source)
    const vals = opts.values ?? {}
    const setVals = (): void => {
      for (const [k, v] of Object.entries(vals)) {
        const ty = types.get(k)
        if (!ty || ty === 'image') continue
        if (ty === 'bool' || ty === 'event') renderer.setValue(k, typeof v === 'number' ? v >= 0.5 : !!v)
        else if (Array.isArray(v)) renderer.setValue(k, v.map(Number))
        else if (typeof v === 'number') renderer.setValue(k, v)
      }
    }
    const t1 = Math.max(0, opts.time ?? 4)
    const FRAMES = 12
    for (let f = 0; f < FRAMES; f++) {
      const t = Math.max(0, t1 - ((FRAMES - 1 - f) * 1) / 30)
      if (under) {
        ;(under as unknown as { __opsiaTimeSec?: number }).__opsiaTimeSec = t
        state.redirect = inp.fbo
        under.draw({ width: W, height: H })
        state.redirect = null
        renderer.setValue('inputImage', handle(inp.tex, W, H))
      }
      setVals()
      ;(renderer as unknown as { __opsiaTimeSec?: number }).__opsiaTimeSec = t
      state.redirect = out.fbo
      renderer.draw({ width: W, height: H })
      state.redirect = null
    }
    gl.bindVertexArray(null)
    const px = new Uint8Array(W * H * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    // bottom-up rows → an upright, opaque picture
    const c2 = document.createElement('canvas')
    c2.width = W
    c2.height = H
    const ctx = c2.getContext('2d')!
    const img = ctx.createImageData(W, H)
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4
      img.data.set(px.subarray(src, src + W * 4), y * W * 4)
    }
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255
    ctx.putImageData(img, 0, 0)
    const jpeg = c2.toDataURL('image/jpeg', 0.85).split(',')[1] ?? ''
    return { ok: true, marks: lints, jpeg, width: W, height: H }
  } catch (e) {
    return { ok: false, marks: [{ line: 0, level: 'error', msg: `It compiled but failed to draw : ${(e as Error).message}` }, ...lints], width: W, height: H }
  } finally {
    try { renderer.cleanup() } catch { /* gone */ }
    try { under?.cleanup() } catch { /* gone */ }
    for (const x of [out, inp]) { gl.deleteTexture(x.tex); gl.deleteFramebuffer(x.fbo) }
  }
}
