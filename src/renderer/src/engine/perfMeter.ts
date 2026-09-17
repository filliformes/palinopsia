// Per-section CPU timing for the Performance panel. Each subsystem wraps its
// per-frame work in begin/end (or add for work on another loop) ; the render
// loop calls frame() once per tick to roll the accumulated times into a smoothed
// ms/frame reading. This is the CPU-side toll (JS dispatch + readbacks + audio /
// MediaPipe work) : WebGL doesn't expose per-section GPU execution time, so the
// panel shows this alongside the whole-GPU util/VRAM from the host sampler.

class PerfMeter {
  private acc: Record<string, number> = {} // ms accumulated during the current frame
  private smooth: Record<string, number> = {} // EMA ms/frame, read by the UI
  private open: Record<string, number> = {} // begin() timestamps
  private readonly a = 0.12 // EMA weight (~1s settle at 60fps)

  begin(k: string): void {
    this.open[k] = performance.now()
  }
  end(k: string): void {
    const t = this.open[k]
    if (t != null) { this.acc[k] = (this.acc[k] ?? 0) + (performance.now() - t); this.open[k] = undefined as unknown as number }
  }
  /** Add pre-measured ms (for work on a separate loop, e.g. the MediaPipe rAF). */
  add(k: string, ms: number): void {
    this.acc[k] = (this.acc[k] ?? 0) + ms
  }

  /** Roll this frame's accumulation into the smoothed readings ; decay sections
   *  that did nothing this frame toward zero so a turned-off stage fades out. */
  frame(): void {
    for (const k in this.acc) this.smooth[k] = (this.smooth[k] ?? 0) * (1 - this.a) + this.acc[k] * this.a
    for (const k in this.smooth) if (!(k in this.acc)) this.smooth[k] = (this.smooth[k] ?? 0) * (1 - this.a)
    this.acc = {}
  }

  read(): Record<string, number> {
    return { ...this.smooth }
  }
}

export const perfMeter = new PerfMeter()
