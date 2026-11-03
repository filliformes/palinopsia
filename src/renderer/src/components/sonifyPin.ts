// Sonify made persistent (persist.ts SONIFY_PIN) : its right-click items, on
// the Transport's Sonify button and the Sonify page's header, the same two.

import { SONIFY_PIN } from '../persist'
import { useStore } from '../store'
import type { MenuItem } from './ContextMenu'

export function sonifyPinItems(pinned: boolean): MenuItem[] {
  return [
    {
      label: pinned ? '✓ Persistent : scenes leave Sonify as it is' : 'Make current state persistent',
      title: pinned
        ? 'Click : scenes change Sonify again (each recalls the Sonify it was saved with)'
        : 'Keep this Sonify (its voices, the mixer, the tail, the key and scale) when you switch scenes : no scene recall, the sequencer or the scene pad changes it. A hand on it still does. It is saved with the session',
      onClick: () => useStore.getState().togglePin(SONIFY_PIN)
    },
    {
      label: 'Set this Sonify in every scene',
      title: 'Writes this Sonify into every scene of the session (Ctrl+Z undoes)',
      onClick: () => useStore.getState().setSonifyInEveryScene()
    }
  ]
}
