// Renderer frame-rate meter. The App render loop calls tickFrame() once per
// composited frame; the Output HUD reads currentFps(). Measured over a rolling
// ~500ms window so the number is steady but still responsive. No React state —
// the HUD samples it on its own interval (like the modulation live overlay).
//
// tickSkip() counts the OTHER outcome: a frame the loop gave up on because the
// GPU was still two frames behind (see Compositor.gpuBacklogged). Those return
// before tickFrame(), so they are invisible in the FPS number by construction :
// a loop skipping half its frames and a display running at half the rate read
// exactly the same. The Performance tab shows both, which is the difference
// between "the guard is throttling us" and "this display is simply slower".

let frames = 0
let fps = 0
let last = 0

let skips = 0
let skipRate = 0
let skipLast = 0

export function tickFrame(nowMs: number): void {
  if (last === 0) last = nowMs
  frames++
  const dt = nowMs - last
  if (dt >= 500) {
    fps = (frames * 1000) / dt
    frames = 0
    last = nowMs
  }
}

export function currentFps(): number {
  return fps
}

/** One frame dropped by the GPU backlog guard. */
export function tickSkip(nowMs: number): void {
  if (skipLast === 0) skipLast = nowMs
  skips++
  const dt = nowMs - skipLast
  if (dt >= 500) {
    skipRate = (skips * 1000) / dt
    skips = 0
    skipLast = nowMs
  }
}

/** Skipped frames per second, over the same rolling window as the FPS meter.
 *  Decays to 0 on its own : a window with no skip reports none. */
export function currentSkips(nowMs: number): number {
  if (skipLast !== 0 && nowMs - skipLast >= 1000) {
    skipRate = (skips * 1000) / (nowMs - skipLast)
    skips = 0
    skipLast = nowMs
  }
  return skipRate
}
