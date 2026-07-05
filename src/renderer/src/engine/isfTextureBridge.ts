// isfTextureBridge — feed raw WebGL textures into ISF image inputs.
//
// The stock `interactive-shader-format` runtime only accepts DOM elements
// (img / video / canvas) as image-input values: `pushTexture` texImage2D's
// `uniform.value` into its own texture. Palinopsia's FX chains need to feed
// GL textures we already own (layer buffers, chain buffers) — re-uploading
// through a canvas would burn the "lightweight" mandate.
//
// This module monkeypatches `pushTexture` (the single choke point — verified:
// setValue → pushUniform → pushTexture for every 't' uniform) to accept a
// TextureHandle marker object: it binds the raw texture on a fresh unit from
// the runtime's own unit allocator and sets the sampler + the _imgSize /
// _imgRect / _flip companion uniforms the parser generates. Everything else
// falls through to the original implementation.
//
// Unit-collision note: the runtime resets its unit counter at each draw() and
// re-binds only pass buffers (units 0..B-1); values pushed via setValue land
// on units ≥ B in steady state. We re-push handles EVERY frame (the ping-pong
// texture object alternates), so the sampler always points at a fresh unit.

import { Renderer } from 'interactive-shader-format'

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
  value: unknown
  textureLoaded?: boolean
}

interface IsfRendererInternals {
  gl: WebGL2RenderingContext
  program: { getUniformLocation: (n: string) => WebGLUniformLocation | null }
  contextState: { newTextureIndex: () => number }
  setValue: (name: string, value: number | number[] | boolean) => void
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
  }

  const orig = proto.pushTexture as (this: IsfRendererInternals, u: IsfUniform) => void

  proto.pushTexture = function (this: IsfRendererInternals, uniform: IsfUniform): void {
    const v = uniform.value as TextureHandle | null
    if (v && (v as TextureHandle).__opsiaTexture) {
      const gl = this.gl
      const loc = this.program.getUniformLocation(uniform.name)
      const unit = this.contextState.newTextureIndex()
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, v.texture)
      if (loc) gl.uniform1i(loc, unit)
      // Companion uniforms the parser generates for every image input. Our
      // buffers are already in GL orientation (same as the runtime's own
      // persistent buffers), so no flip.
      this.setValue(`_${uniform.name}_imgSize`, [v.width, v.height])
      this.setValue(`_${uniform.name}_imgRect`, [0, 0, 1, 1])
      this.setValue(`_${uniform.name}_flip`, false)
      return
    }
    orig.call(this, uniform)
  }
}
