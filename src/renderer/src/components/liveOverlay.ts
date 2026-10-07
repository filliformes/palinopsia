// One shared rAF that mirrors live modulation values onto registered DOM inputs
// : slider thumbs and number readouts alike. The Inspector can show many
// modulated controls at once; rather than each spinning its own requestAnimation
// Frame loop, they all register here and a single loop paints them. The overlay
// writes straight to the DOM (never through React), and skips any input the user
// is currently focused on so it can't fight a drag or an edit.

import { liveModValues } from '../engine/modulation'

type LiveSub =
  | { el: HTMLInputElement | HTMLSelectElement; key: string; format: (v: number) => string }
  // Anything else (a toggle button showing its live ON / OFF) : paint it yourself.
  | { key: string; apply: (v: number) => void }

const subs = new Set<LiveSub>()
let raf = 0

function tick(): void {
  for (const s of subs) {
    const live = liveModValues.get(s.key)
    if (live === undefined) continue
    if ('apply' in s) {
      s.apply(live)
      continue
    }
    if (document.activeElement === s.el) continue // don't clobber a drag/edit
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
