// The multisampled buffer, one per GL context and size : the sources that draw
// real geometry (Marbling, Fur, Relief) draw one after another, so they share it (4K at
// 4x is 265 MB). It goes with the last slot that uses it.

import { glGeneration } from './glGeneration'

export interface Msaa { gl: WebGL2RenderingContext; gen: number; w: number; h: number; fbo: WebGLFramebuffer; rb: WebGLRenderbuffer[]; samples: number }
let msaa: Msaa | null = null
let users = 0

export function acquireMsaa(): void {
  users++
}

export function msaaBuffer(gl: WebGL2RenderingContext, w: number, h: number): Msaa {
  if (msaa && msaa.gl === gl && msaa.gen === glGeneration() && msaa.w === w && msaa.h === h) return msaa
  if (msaa && msaa.gl === gl && msaa.gen === glGeneration()) {
    gl.deleteFramebuffer(msaa.fbo)
    for (const r of msaa.rb) gl.deleteRenderbuffer(r)
  }
  const samples = Math.max(1, Math.min(4, (gl.getParameter(gl.MAX_SAMPLES) as number) || 4))
  const fbo = gl.createFramebuffer()!
  const c = gl.createRenderbuffer()!
  const ds = gl.createRenderbuffer()!
  gl.bindRenderbuffer(gl.RENDERBUFFER, c)
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h)
  gl.bindRenderbuffer(gl.RENDERBUFFER, ds)
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, w, h)
  gl.bindRenderbuffer(gl.RENDERBUFFER, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, ds)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  msaa = { gl, gen: glGeneration(), w, h, fbo, rb: [c, ds], samples }
  return msaa
}

export function releaseMsaa(gl: WebGL2RenderingContext): void {
  users = Math.max(0, users - 1)
  if (!users && msaa) {
    if (msaa.gl === gl && msaa.gen === glGeneration()) {
      gl.deleteFramebuffer(msaa.fbo)
      for (const r of msaa.rb) gl.deleteRenderbuffer(r)
    }
    msaa = null
  }
}
