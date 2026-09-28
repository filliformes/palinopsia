// Bundled by build.cjs : the live registry (with every registry transform) + the
// patched ISF runtime (texture bridge, integrated PH_ phases), exposed to page.js.
import { Renderer } from '../../node_modules/interactive-shader-format/src/main.js'
import { installTextureBridge, handle } from '../../src/renderer/src/engine/isfTextureBridge.ts'
import { shaderSourceById, SHADER_BY_ID } from '../../src/renderer/src/shaders/isf/index.ts'
installTextureBridge()
window.Renderer = Renderer
window.texHandle = handle
window.shaderSourceById = shaderSourceById
window.SHADER_BY_ID = SHADER_BY_ID
