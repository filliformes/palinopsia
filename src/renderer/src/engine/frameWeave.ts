// Frame-Weave : temporal interlace. Instead of blending the layers, show ONE layer
// per frame, stepping through a paintable lattice of cells at `rate` cells/sec, so
// persistence-of-vision fuses them into a shimmer. A cell is a layer index (0..3)
// or -1 for a BLANK (black) frame. Applied post-modulation in the App loop (like
// the flicker strobe) : it hard-sets every non-chosen layer's opacity to 0 for the
// frame, self-releasing, since syncFromState restores each layer's base opacity
// next frame. The chosen cell is returned + mirrored to the output window so the
// projection weaves the identical frame.
//
// The lattice position is an integrated phase (cells advanced += rate x dt), so a
// rate change only changes the speed from where it is (a `floor(elapsed * rate)`
// clock jumped to a random cell after a few minutes), and it restarts at the
// first cell each time the weave is switched on (resetFrameWeave).

import type { SequenceState } from '@shared/types'

let phase = 0 // cells advanced, kept within [0, cells.length)
let lastMs = 0
let activeCell = -1

/** Interlace the layer stack per the lattice. Mutates layer opacity. Returns the
 *  chosen cell value (0..3 = the shown layer, -1 = a blank frame). */
export function applyFrameWeave(
  comp: { layers: Array<{ opacity: number } | null | undefined> },
  cfg: SequenceState['frameWeave'],
  nowMs: number
): number {
  const cells = cfg.cells
  if (!cells || cells.length === 0) {
    activeCell = -1
    return -1
  }
  const rate = Math.max(1, Math.min(48, cfg.rate))
  const dt = lastMs > 0 ? Math.max(0, Math.min(1, (nowMs - lastMs) / 1000)) : 0
  lastMs = nowMs
  phase = (phase + dt * rate) % cells.length
  const idx = Math.floor(phase) % cells.length
  activeCell = idx
  const pick = cells[idx]
  comp.layers.forEach((L, i) => {
    if (L && (pick < 0 || i !== pick)) L.opacity = 0
  })
  return pick
}

/** The weave is off : the next applyFrameWeave starts again at the first cell. */
export function resetFrameWeave(): void {
  phase = 0
  lastMs = 0
  activeCell = -1
}

/** The lattice cell index currently playing (for the UI highlight), or -1. */
export function frameWeaveActiveCell(): number {
  return activeCell
}
