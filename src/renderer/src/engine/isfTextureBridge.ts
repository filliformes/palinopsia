// isfTextureBridge : feed raw WebGL textures into ISF image inputs.
//
// The stock `interactive-shader-format` runtime only accepts DOM elements
// (img / video / canvas) as image-input values: `pushTexture` texImage2D's
// `uniform.value` into its own texture. Palinopsia's FX chains need to feed
// GL textures we already own (layer buffers, chain buffers) : re-uploading
// through a canvas would burn the "lightweight" mandate.
//
// This module monkeypatches `pushTexture` (the single choke point : verified:
// setValue → pushUniform → pushTexture for every 't' uniform) to accept a
// TextureHandle marker object: it binds the raw texture on a fresh unit from
// the runtime's own unit allocator and sets the sampler + the _imgSize /
// _imgRect / _flip companion uniforms the parser generates. Everything else
// falls through to the original implementation.
//
// Units : draw() resets the runtime's unit counter and re-binds ONLY the pass
// buffers (units 0..B-1). A texture bound when setValue ran (the Context PBR maps
// are pushed during sync, long before the master rack draws) is overwritten by
// every renderer that draws in between, so the sampler read whatever sat on its
// unit, and when that was this draw's own target WebGL dropped the whole pass
// (a feedback loop). So every image input is bound at draw time instead, on
// units B.. : the handle's texture, a loaded image, or a blank texel if unfed.

import { Renderer } from 'interactive-shader-format'
import { tickPhases } from './phases'
import { glGeneration } from './glGeneration'

export interface TextureHandle {
  __opsiaTexture: true
  texture: WebGLTexture
  width: number
  height: number
}

export function handle(texture: WebGLTexture, width: number, height: number): TextureHandle {
  return { __opsiaTexture: true, texture, width, height }
}

interface IsfUniform {
  name: string
  type?: string
  value: unknown
  textureLoaded?: boolean
  texture?: { texture: WebGLTexture } // the runtime's own texture, image inputs only
}

interface IsfRendererInternals {
  gl: WebGL2RenderingContext
  program: { use: () => void; getUniformLocation: (n: string) => WebGLUniformLocation | null }
  contextState: { newTextureIndex: () => number }
  uniforms?: Record<string, IsfUniform>
  renderBuffers?: { name?: string }[]
  setValue: (name: string, value: number | number[] | boolean) => void
}

// One transparent 1×1 texture per context : what an image input nothing feeds reads.
// Rebuilt after a GPU reset (glGeneration) : a dead one broke every image input.
const blanks = new WeakMap<object, { t: WebGLTexture; gen: number }>()
function blankFor(gl: WebGL2RenderingContext): WebGLTexture | null {
  const have = blanks.get(gl)
  if (have && have.gen === glGeneration()) return have.t
  const t = gl.createTexture()
  if (!t) return null
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  blanks.set(gl, { t, gen: glGeneration() })
  return t
}

function isBufferName(r: IsfRendererInternals, name: string): boolean {
  const b = r.renderBuffers
  if (b) for (let i = 0; i < b.length; i++) if (b[i].name === name) return true
  return false
}

/** Bind every image input of `r` on units B.. (B = pass buffers, which draw()
 *  binds itself on 0..B-1). Runs at the top of each draw. */
function bindImageInputs(r: IsfRendererInternals): void {
  const us = r.uniforms
  if (!us) return
  const gl = r.gl
  const blank = blankFor(gl) // before any unit is bound : creating it binds a texture
  r.program.use()
  let unit = r.renderBuffers?.length ?? 0
  for (const name in us) {
    const u = us[name]
    if (u.type !== 't' || isBufferName(r, name)) continue
    const loc = r.program.getUniformLocation(name)
    if (!loc) continue // optimized out : never sampled
    const v = u.value as TextureHandle | null | undefined
    const tex = v && v.__opsiaTexture
      ? v.texture
      : v && u.textureLoaded && u.texture ? u.texture.texture : blank
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(loc, unit)
    unit++
  }
}

let patched = false

export function installTextureBridge(): void {
  if (patched) return
  patched = true
  const proto = (Renderer as unknown as { prototype: Record<string, unknown> }).prototype

  // ── Per-layer time scaling ─────────────────────────────────────────
  // The runtime stamps TIME from its own wall clock inside draw(). Layers
  // need their OWN clocks (the per-layer Speed control), so after the stock
  // stamping we overwrite TIME with the renderer's assigned clock when one
  // is set (renderer.__opsiaTimeSec, written by the Compositor each frame).
  const origDate = proto.setDateUniforms as (this: IsfRendererInternals) => void
  proto.setDateUniforms = function (this: IsfRendererInternals & { __opsiaTimeSec?: number }): void {
    origDate.call(this)
    if (typeof this.__opsiaTimeSec === 'number') {
      this.setValue('TIME', this.__opsiaTimeSec)
    }
    // Integrated phases (PH_ uniforms) ride the same clock : see phases.ts.
    const self = this as unknown as Parameters<typeof tickPhases>[0]
    const t = typeof this.__opsiaTimeSec === 'number'
      ? this.__opsiaTimeSec
      : Number(self.uniforms?.TIME?.value ?? 0)
    tickPhases(self, t)
  }

  // ── Program leak fix + shared-attribute quarantine ──────────────────
  // The stock cleanup() destroys renderBuffers but NEVER deletes the two
  // ISFGLProgram objects (`program` + `paintProgram`), each of which owns a
  // WebGLProgram, two shaders and a vertex buffer. ISFGLProgram HAS a cleanup()
  // that frees them : the runtime just never calls it. Palinopsia hot-swaps
  // shaders constantly (source/FX changes, Randomize up to 4/frame), so this
  // leaks GPU memory without bound → driver pressure → context loss. Wrap
  // cleanup() to also release the programs.
  //
  // CRITICAL : the runtime is WebGL1-style — every ISFGLProgram wires its quad
  // buffer into the DEFAULT VAO's attribute 0, shared by EVERY renderer on the
  // context (they all draw off whoever wired it last). Deleting a buffer while
  // the default VAO is current RESETS that shared binding to zero → every ISF
  // drawArrays in the app becomes INVALID_OPERATION → the whole image freezes
  // on the last presented frame until some new renderer re-wires it. (This is
  // exactly what the startup shader pre-warm did : ~70 create→cleanup cycles
  // with no successor = frozen first frame on every launch.) Quarantine ALL
  // deletions inside a sacrificial VAO so the default VAO's binding survives.
  const cleanupVaos = new WeakMap<object, { vao: WebGLVertexArrayObject; gen: number }>()
  const origCleanup = proto.cleanup as (this: {
    program?: { cleanup?: () => void }
    paintProgram?: { cleanup?: () => void }
  }) => void
  // setupGL() calls cleanup() first to drop the PREVIOUS source's program, while
  // paintProgram (built once in the constructor) must survive it : a shader whose
  // last pass renders to a TARGET is painted to screen through it, and freeing it
  // there made every such shader throw on draw. Only a real disposal frees it.
  const origSetupGL = proto.setupGL as (this: { __opsiaSetup?: boolean }) => void
  proto.setupGL = function (this: { __opsiaSetup?: boolean }): void {
    this.__opsiaSetup = true
    try {
      origSetupGL.call(this)
    } finally {
      this.__opsiaSetup = false
    }
  }
  proto.cleanup = function (this: {
    gl?: WebGL2RenderingContext
    program?: { cleanup?: () => void }
    paintProgram?: { cleanup?: () => void }
    __opsiaSetup?: boolean
  }): void {
    const gl = this.gl
    let vao: WebGLVertexArrayObject | null = null
    if (gl && typeof gl.createVertexArray === 'function') {
      // Rebuilt after a GPU reset (glGeneration) : a dead one left the default VAO
      // unprotected, the very landmine this quarantine exists for.
      const have = cleanupVaos.get(gl)
      vao = have && have.gen === glGeneration() ? have.vao : null
      if (!vao) {
        vao = gl.createVertexArray()
        if (vao) cleanupVaos.set(gl, { vao, gen: glGeneration() })
      }
      if (vao) gl.bindVertexArray(vao)
    }
    try {
      origCleanup.call(this)
      this.program?.cleanup?.()
      this.program = undefined
      if (!this.__opsiaSetup) {
        this.paintProgram?.cleanup?.()
        this.paintProgram = undefined
      }
    } finally {
      if (gl && vao) gl.bindVertexArray(null)
    }
  }

  // Image inputs are bound at draw time (see the header). A pass buffer never
  // shares a unit with them, so an input can't land under buffer 0 on a
  // renderer's first draw and seed its persistent buffers with black.
  const origDraw = proto.draw as (this: IsfRendererInternals, d: unknown) => void
  proto.draw = function (this: IsfRendererInternals, destination: unknown): void {
    bindImageInputs(this)
    origDraw.call(this, destination)
  }

  // Unknown input names are skipped quietly. The store routinely holds keys the
  // live renderer lacks for a frame or two (a swap waiting on the compile budget
  // keeps the old program running while the new shader's inputs arrive; prewarm
  // feeds inputImage to generators), and the stock setValue logs an error each.
  const origSetValue = proto.setValue as (this: IsfRendererInternals, n: string, v: unknown) => void
  proto.setValue = function (this: IsfRendererInternals, name: string, value: unknown): void {
    if (!this.uniforms?.[name]) return
    origSetValue.call(this, name, value)
  }

  const orig = proto.pushTexture as (this: IsfRendererInternals, u: IsfUniform) => void

  proto.pushTexture = function (this: IsfRendererInternals, uniform: IsfUniform): void {
    const v = uniform.value as TextureHandle | null
    if (v && (v as TextureHandle).__opsiaTexture) {
      // Companion uniforms the parser generates for every image input. Our
      // buffers are already in GL orientation (same as the runtime's own
      // persistent buffers), so no flip. The texture itself binds at draw.
      this.setValue(`_${uniform.name}_imgSize`, [v.width, v.height])
      this.setValue(`_${uniform.name}_imgRect`, [0, 0, 1, 1])
      this.setValue(`_${uniform.name}_flip`, false)
      return
    }
    orig.call(this, uniform)
  }
}
