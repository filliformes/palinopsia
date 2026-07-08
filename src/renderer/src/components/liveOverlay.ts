// One shared rAF that mirrors live modulation values onto registered DOM inputs
// — slider thumbs and number readouts alike. The Inspector can show many
// modulated controls at once; rather than each spinning its own requestAnimation
// Frame loop, they all register here and a single loop paints them. The overlay
// writes straight to the DOM (never through React), and skips any input the user
// is currently focused on so it can't fight a drag or an edit.

import { liveModValues } from '../engine/modulation'

interface LiveSub {
  el: HTMLInputElement | HTMLSelectElement
  key: string
  format: (v: number) => string
}

const subs = new Set<LiveSub>()
let raf = 0

function tick(): void {
  for (const s of subs) {
    if (document.activeElement === s.el) continue // don't clobber a drag/edit
    const live = liveModValues.get(s.key)
    if (live === undefined) continue
    const next = s.format(live)
    if (s.el.value !== next) s.el.value = next
  }
  raf = subs.size ? requestAnimationFrame(tick) : 0
}

/** Register a DOM input to track its live modulated value. Returns an
 *  unsubscribe; the shared loop self-stops once the last subscriber leaves. */
export function registerLiveOverlay(sub: LiveSub): () => void {
  subs.add(sub)
  if (!raf) raf = requestAnimationFrame(tick)
  return () => {
    subs.delete(sub)
  }
}
