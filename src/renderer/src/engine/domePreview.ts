// The dome simulator's picture : a small (1024²) read of the domemaster, handed
// from the engine's render loop to the simulator's own GL context. A
// captureStream of the full 4K canvas cost the Output page ~40 fps; this costs a
// 4 MB readback at 30 Hz, and only while the Output page shows the dome.

export const DOME_PREVIEW = 1024

export const domePreview = {
  px: null as Uint8Array | null, // bottom-up RGBA8, size × size
  size: 0,
  serial: 0 // bumps on every new frame
}
