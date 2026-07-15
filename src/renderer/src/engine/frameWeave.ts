// Frame-Weave (Rose Lowder) : temporal interlace. Instead of blending the layers,
// show ONE layer per frame, stepping through a paintable lattice of cells at
// `rate` cells/sec, so persistence-of-vision fuses them into a shimmer. A cell is a
// layer index (0..3) or -1 for a BLANK (black) frame. Applied post-modulation in
// the App loop (like the flicker strobe) : it hard-sets every non-chosen layer's
// opacity to 0 for the frame — self-releasing, since syncFromState restores each
// layer's base opacity next frame. The chosen cell is returned + mirrored to the
// output window so the projection weaves the identical frame.

import type { SequenceState } from '@shared/types'

let weaveStart = 0
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
  if (weaveStart === 0) weaveStart = nowMs
  const rate = Math.max(1, Math.min(48, cfg.rate))
  const idx = Math.floor(((nowMs - weaveStart) / 1000) * rate) % cells.length
  activeCell = idx
  const pick = cells[idx]
  comp.layers.forEach((L, i) => {
    if (L && (pick < 0 || i !== pick)) L.opacity = 0
  })
  return pick
}

/** The lattice cell index currently playing (for the UI highlight), or -1. */
export function frameWeaveActiveCell(): number {
  return activeCell
}
