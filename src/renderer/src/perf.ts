// Renderer frame-rate meter. The App render loop calls tickFrame() once per
// composited frame; the Output HUD reads currentFps(). Measured over a rolling
// ~500ms window so the number is steady but still responsive. No React state —
// the HUD samples it on its own interval (like the modulation live overlay).

let frames = 0
let fps = 0
let last = 0

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
