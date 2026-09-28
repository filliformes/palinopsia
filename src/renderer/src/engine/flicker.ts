// Superimposition flicker (Cameraless spec §5.2) : a hypnagogic strobe:
// on a drawn-frame cadence, cross-cut WHICH layer(s) show. Applied post-modulation
// in the App loop, it multiplies the non-hot layers' opacity toward black each
// frame (self-releasing : syncFromState re-applies the base opacity next frame, so
// amount → 0 restores everything). When the Cameraless film stage is running, the
// hot layer re-rolls on ITS draw ticks (the jittered hand-drawn clock), so each
// drawn frame catches a different layer; otherwise it runs on its own clock at
// `rateFps`.
//
// Reuses the existing 4-layer stack + per-layer feedback: the layers keep
// integrating underneath, you just see a different one each drawn frame.

let acc = 0
let lastMs = 0
let hot = -1
let lastTick = -1

/** Strobe the layer stack. `amount` 0 = off (deadzone); 1 = only the hot layer
 *  shows. `rateFps` = strobe rate (drawn frames/sec) on the own clock.
 *  `filmTick` = the Cameraless draw-tick serial (-1 when that stage isn't running) :
 *  when given, the hot layer re-rolls whenever it changes instead.
 *  Mutates comp layer opacity. Returns the current hot layer index (or -1) so the
 *  output window can mirror the same choice without re-rolling its own random pick. */
export function applyFlicker(
  comp: { layers: Array<{ opacity: number } | null | undefined> },
  amount: number,
  rateFps: number,
  nowMs: number,
  filmTick = -1
): number {
  if (amount < 0.02) {
    lastMs = nowMs
    hot = -1
    lastTick = -1
    return -1
  }
  const dt = lastMs > 0 ? Math.min(0.2, (nowMs - lastMs) / 1000) : 0
  lastMs = nowMs
  let reroll = hot < 0
  if (filmTick >= 0) {
    // Lock to the drawn frames.
    if (filmTick !== lastTick) reroll = true
    lastTick = filmTick
    acc = 0
  } else {
    lastTick = -1
    acc += dt
    const interval = 1 / Math.max(1, rateFps)
    if (acc >= interval) {
      reroll = true
      // Keep the overshoot (zeroing it ran 8 fps at 7.5 on a 60 Hz loop), but
      // never bank more than one interval.
      acc = Math.min(acc - interval, interval)
    }
  }

  if (reroll) {
    // Eligible = layers currently carrying some opacity (visible, not muted-to-0).
    const elig: number[] = []
    comp.layers.forEach((L, i) => {
      if (L && L.opacity > 0.001) elig.push(i)
    })
    if (elig.length > 1) {
      let pick = elig[Math.floor(Math.random() * elig.length)]
      if (pick === hot) pick = elig[(elig.indexOf(pick) + 1) % elig.length] // avoid immediate repeat
      hot = pick
    } else {
      hot = elig.length ? elig[0] : -1
    }
  }

  // Dim every non-hot layer toward black by `amount` (1 = hard cut to the hot one).
  comp.layers.forEach((L, i) => {
    if (L && i !== hot) L.opacity *= 1 - amount
  })
  return hot
}
