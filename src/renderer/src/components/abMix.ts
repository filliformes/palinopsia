// What a layer's MIX slider means in each A/B mode, for its label and tooltip,
// and what each blend mode is called on screen (the layer strip and the Mixer
// say the same thing).

import type { BlendMode, LayerCoupling } from '@shared/types'
import { BLEND_MODES } from '@shared/types'

/** Each blend mode's name as shown : its menus, the OUT tab, the tooltips. Only
 *  shown : the stored names (sessions, OSC, the Agent) stay the short ones. */
export const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'normal',
  '50add': '50 add',
  add: 'add',
  subtract: 'subtract',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  softlight: 'soft light',
  hardlight: 'hard light',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  exclusion: 'exclusion',
  dodge: 'dodge',
  burn: 'burn',
  wrap: 'wrap',
  weave: 'weave',
  lumakey: 'luma key',
  consume: 'consume',
  lightercolor: 'lighter color'
}

/** A blend mode's name as shown (an unknown one : as stored). */
export const blendLabel = (mode: BlendMode): string => BLEND_LABELS[mode] ?? mode

/** A modulated blend's live value (an index that cycles through the modes) as its mode. */
export const blendAt = (x: number): BlendMode =>
  BLEND_MODES[Math.max(0, Math.min(BLEND_MODES.length - 1, Math.round(x)))] ?? BLEND_MODES[0]

/** A short word for the slider in this mode. */
export function mixWord(mode: BlendMode): string {
  if (mode === 'normal' || mode === '50add') return 'A↔B'
  if (mode === 'weave') return 'depth'
  if (mode === 'lumakey') return 'key'
  if (mode === 'consume') return 'hunger'
  return 'blend'
}

/** The slider's tooltip in this mode. */
export function mixTitle(mode: BlendMode): string {
  if (mode === 'normal') return 'A to B : 0 is A alone, 1 is B alone. Double-click resets to 0.5'
  if (mode === '50add') return 'A to B, added in the middle : 0 is A alone, 0.5 is A plus B, 1 is B alone. Double-click resets to 0.5'
  if (mode === 'weave') return 'Weave depth : how far each source displaces the other (the two always show half and half). Double-click resets to 0.5'
  if (mode === 'lumakey') return 'Key : how bright A must be to show; B fills the rest. Double-click resets to 0.5'
  if (mode === 'consume') return 'Hunger : how hard the two sources eat into each other (they never settle back to A alone). Double-click resets to 0.5'
  return `How much of the ${blendLabel(mode)} blend of A and B : 0 is A alone, 1 is the full blend. Double-click resets to 0.5`
}

/** A layer's coupling in a few words ("lean on flux"), for a chip's tooltip. */
export function couplingWords(c: LayerCoupling): string {
  return `${c.mode} on ${c.feature === 'band' ? `band ${(c.band ?? 0) + 1}` : c.feature}`
}
