// Black : the whole show to black over the Morph time, and back (the top bar's
// Black, the `.` key, a MIDI / OSC control, a Body rule, /opsia/black). A
// dimmer on what leaves, not a fader : the layers, the Background and the sound
// keep their settings and keep running under it, so the second press brings
// back what is there by then (a scene recalled, a Generate, a fader moved).
//   the picture : the finished frame toward black (Compositor.setBlack), before
//     Flash safety, so the preview and every output (the window, NDI / Spout /
//     Syphon, recordings, the dome) go black together, the master FX included
//   the sound : every layer's film and Audio slot (Compositor.scaleLayerSound),
//     Sonify and the Audio Layer (the worklet's last stage : the speakers, Space,
//     the recordings)
// The store holds the switch (useStore.black); this holds the fade.

import { sonifyEngine } from './audio/sonify'

let from = 1
let to = 1
let t0 = 0
let dur = 0

/** How much of the show leaves now : 1 shown, 0 black (eased over the fade). */
export function blackLevel(now = performance.now()): number {
  if (dur <= 0) return to
  const k = (now - t0) / dur
  if (k >= 1) return to
  const s = k <= 0 ? 0 : k * k * (3 - 2 * k)
  return from + (to - from) * s
}

/** Fade to black (on) or back over `ms`, from wherever it is now (a press
 *  mid-way turns it round). */
export function fadeBlack(on: boolean, ms: number): void {
  const now = performance.now()
  from = blackLevel(now)
  to = on ? 0 : 1
  t0 = now
  dur = Math.max(0, ms)
  sonifyEngine.setBlack(to, dur)
}
