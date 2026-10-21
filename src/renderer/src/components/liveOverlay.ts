// One shared rAF that mirrors live modulation values onto registered DOM inputs
// : slider thumbs and number readouts alike. The Inspector can show many
// modulated controls at once; rather than each spinning its own requestAnimation
// Frame loop, they all register here and a single loop paints them. The overlay
// writes straight to the DOM (never through React), and skips any input the user
// is currently focused on so it can't fight a drag or an edit.
// One loop per window : the Output page can sit in a window of its own, whose
// controls keep moving on its own clock while the instrument is minimized (the
// control window's rAF stalls then).

import { liveModValues } from '../engine/modulation'

type LiveSub =
  | { el: HTMLInputElement | HTMLSelectElement; key: string; format: (v: number) => string }
  // Anything else (a toggle button showing its live ON / OFF, a readout) : paint
  // it yourself. `idle` runs on the frames nothing modulates it (put the stored
  // value back once the modulation stops). `view` : the window it paints in, when
  // not the instrument's (the Output page's own).
  | { key: string; apply: (v: number) => void; idle?: () => void; view?: Window }

type Loop = { subs: Set<LiveSub>; raf: number }
const loops = new Map<Window, Loop>()

/** The window a subscriber paints in (one without an element or a view : the instrument's). */
const viewOf = (s: LiveSub): Window => ('el' in s ? s.el.ownerDocument.defaultView : s.view) ?? window

function tick(view: Window, loop: Loop): void {
  for (const s of loop.subs) {
    const live = liveModValues.get(s.key)
    if (live === undefined) {
      if ('idle' in s) s.idle?.()
      continue
    }
    if ('apply' in s) {
      s.apply(live)
      continue
    }
    if (s.el.ownerDocument.activeElement === s.el) continue // don't clobber a drag/edit (its own window's focus)
    const next = s.format(live)
    if (s.el.value !== next) s.el.value = next
  }
  loop.raf = loop.subs.size && !view.closed ? view.requestAnimationFrame(() => tick(view, loop)) : 0
  if (!loop.raf && loops.get(view) === loop) loops.delete(view)
}

/** Register a DOM input to track its live modulated value. Returns an
 *  unsubscribe; the shared loop self-stops once the last subscriber leaves. */
export function registerLiveOverlay(sub: LiveSub): () => void {
  const view = viewOf(sub)
  let loop = loops.get(view)
  if (!loop) {
    loop = { subs: new Set(), raf: 0 }
    loops.set(view, loop)
  }
  const l = loop
  l.subs.add(sub)
  if (!l.raf) l.raf = view.requestAnimationFrame(() => tick(view, l))
  return () => {
    l.subs.delete(sub)
    // A window of its own may close with this : its frames stop, so let go here.
    if (!l.subs.size && view !== window) {
      try {
        view.cancelAnimationFrame(l.raf)
      } catch {
        /* the window is gone */
      }
      l.raf = 0
      if (loops.get(view) === l) loops.delete(view)
    }
  }
}
