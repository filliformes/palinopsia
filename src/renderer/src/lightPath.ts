// Context's light, animated : the Metasurface's draw sequencer over the light pad.
// The path lives on the Context unit (FxInstance.lightPath); the render loop
// traces it (surface.ts tracePath) and writes the light engine-side each frame,
// like a modulator. `liveLight` is where it is now, for the pad's moving dot.

import type { LightPath } from '@shared/types'

export const DEFAULT_LIGHT_PATH: LightPath = {
  path: [],
  play: false,
  timeMs: 8000,
  way: 'forward',
  jump: 0,
  wiggle: 0,
  closed: false
}

/** The light's traced position this frame (light space, y up); `on` while a
 *  path is playing. Written by the render loop, read by the pad (rAF). */
export const liveLight = { x: 0.5, y: 0.55, on: false }
