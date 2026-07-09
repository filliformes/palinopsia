// Superimposition flicker (Cameraless spec §5.2) — Brakhage's hypnagogic strobe:
// on a drawn-frame cadence, cross-cut WHICH layer(s) show. Applied post-modulation
// in the App loop, it multiplies the non-hot layers' opacity toward black each
// frame (self-releasing — syncFromState re-applies the base opacity next frame, so
// amount → 0 restores everything). The rate follows the Cameraless film draw rate
// when it's on, so the strobe lands on the drawn frames; otherwise a default.
//
// Reuses the existing 4-layer stack + per-layer feedback: the layers keep
// integrating underneath, you just see a different one each drawn frame.

let acc = 0
let lastMs = 0
let hot = -1

/** Strobe the layer stack. `amount` 0 = off (deadzone); 1 = only the hot layer
 *  shows. `rateFps` = strobe rate (drawn frames/sec). Mutates comp layer opacity. */
export function applyFlicker(
  comp: { layers: Array<{ opacity: number } | null | undefined> },
  amount: number,
  rateFps: number,
  nowMs: number
): void {
  if (amount < 0.02) {
    lastMs = nowMs
    hot = -1
    return
  }
  const dt = lastMs > 0 ? Math.min(0.2, (nowMs - lastMs) / 1000) : 0
  lastMs = nowMs
  acc += dt
  const interval = 1 / Math.max(1, rateFps)

  if (hot < 0 || acc >= interval) {
    acc = 0
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
}
