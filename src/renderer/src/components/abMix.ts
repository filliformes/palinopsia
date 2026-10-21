// What a layer's MIX slider means in each A/B mode, for its label and tooltip
// (the layer strip and the Mixer say the same thing).

import type { BlendMode, LayerCoupling } from '@shared/types'

/** A short word for the slider in this mode. */
export function mixWord(mode: BlendMode): string {
  if (mode === 'normal') return 'A↔B'
  if (mode === 'weave') return 'depth'
  if (mode === 'lumakey') return 'key'
  if (mode === 'consume') return 'hunger'
  return 'blend'
}

/** The slider's tooltip in this mode. */
export function mixTitle(mode: BlendMode): string {
  if (mode === 'normal') return 'A to B : 0 is A alone, 1 is B alone. Double-click resets to 0.5'
  if (mode === 'weave') return 'Weave depth : how far each source displaces the other (the two always show half and half). Double-click resets to 0.5'
  if (mode === 'lumakey') return 'Key : how bright A must be to show; B fills the rest. Double-click resets to 0.5'
  if (mode === 'consume') return 'Hunger : how hard the two sources eat into each other (they never settle back to A alone). Double-click resets to 0.5'
  return `How much of the ${mode} blend of A and B : 0 is A alone, 1 is the full blend. Double-click resets to 0.5`
}

/** A layer's coupling in a few words ("lean on flux"), for a chip's tooltip. */
export function couplingWords(c: LayerCoupling): string {
  return `${c.mode} on ${c.feature === 'band' ? `band ${(c.band ?? 0) + 1}` : c.feature}`
}
