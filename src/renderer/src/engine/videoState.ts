// videoState — live playhead readout for video sources, written by the engine
// each frame and read by the Inspector's timeline via requestAnimationFrame
// (direct DOM writes, no React re-renders — same pattern as liveModValues).

export interface VideoPlayhead {
  time: number // current playhead seconds
  duration: number // clip length seconds (0 until loaded)
}

export const videoPlayheads = new Map<string, VideoPlayhead>()

export const videoKey = (layer: number, slot: 'A' | 'B'): string => `${layer}:${slot}`
