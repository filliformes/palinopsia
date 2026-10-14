// Per-section CPU timing for the Performance panel. Each subsystem wraps its
// per-frame work in begin/end (or add for work on another loop) ; the render
// loop calls frame() once per tick to roll the accumulated times into a smoothed
// ms/frame reading. This is the CPU-side toll (JS dispatch + readbacks + audio /
// MediaPipe work) : WebGL doesn't expose per-section GPU execution time, so the
// panel shows this alongside the whole-GPU util/VRAM from the host sampler.
//
// A readback's wait for the GPU is not the section's own work : the window
// sits idle until the GPU process hands back a picture the GPU already drew,
// and with the GPU full that takes milliseconds whoever asks. Charged to the
// section that asked, it made Sonify read as the heaviest thing on an
// installation (8 to 30 ms a frame) when its own work was a fraction of a
// millisecond. So the readbacks report their wait (wait()), which comes out of
// every section open around it and goes to its own row, 'gpuwait'.

class PerfMeter {
  private acc: Record<string, number> = {} // ms accumulated during the current frame
  private smooth: Record<string, number> = {} // EMA ms/frame, read by the UI
  private open: Record<string, number> = {} // begin() timestamps
  private waited = 0 // ms of readback wait so far (only ever grows)
  private openWait: Record<string, number> = {} // `waited` at each begin()
  private readonly a = 0.12 // EMA weight (~1s settle at 60fps)

  begin(k: string): void {
    this.open[k] = performance.now()
    this.openWait[k] = this.waited
  }
  end(k: string): void {
    const t = this.open[k]
    if (t != null) {
      const w = this.waited - (this.openWait[k] ?? this.waited)
      this.acc[k] = (this.acc[k] ?? 0) + Math.max(0, performance.now() - t - w)
      this.open[k] = undefined as unknown as number
    }
  }
  /** A readback's wait for the GPU, in ms : its own row, out of the open sections. */
  wait(ms: number): void {
    this.waited += ms
    this.acc.gpuwait = (this.acc.gpuwait ?? 0) + ms
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
