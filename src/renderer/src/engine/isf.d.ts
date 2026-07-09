// Minimal ambient types for the `interactive-shader-format` runtime (the npm
// package ships no declarations). Only the surface Palinopsia uses. The runtime
// is WebGL1-style GLSL (gl_FragColor / texture2D), which a WebGL2 context still
// accepts for ES 1.00 shaders : so it shares the Compositor's WebGL2 context.
declare module 'interactive-shader-format' {
  export class Renderer {
    constructor(gl: WebGLRenderingContext | WebGL2RenderingContext)
    /** Parse + compile an ISF source (JSON header + GLSL). Sets `valid`. */
    loadSource(fragmentISF: string, vertexISFOpt?: string): void
    /** Set an ISF INPUT (or a standard uniform) by name. Image inputs accept
     *  a TextureHandle via the isfTextureBridge monkeypatch. */
    setValue(name: string, value: unknown): void
    /** Render the shader; a no-PASSES generator draws to the bound default FBO
     *  at the destination's size. */
    draw(destination: { width: number; height: number }): void
    cleanup(): void
    valid: boolean
    error: unknown
    errorLine: unknown
  }
  export class Parser {
    parse(fragmentISF: string, vertexISFOpt?: string): void
    inputs: Array<Record<string, unknown>>
    valid: boolean
  }
  export class Upgrader {}
  export class MetadataExtractor {}
}
