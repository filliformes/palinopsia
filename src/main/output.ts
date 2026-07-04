// GPU texture-sharing output (brief §9).
//
// PHASE 8. Spout (Windows) / Syphon (macOS) / NDI (cross-platform). The
// renderer reads back the final composite via `gl.readPixels` (negligible
// on a 4070) and hands the buffer here over IPC; this module forwards it to
// a native sender. PROVEN PATH: adopt/fork modV's `grandiose` (libndi) for
// NDI-from-Electron rather than writing an addon from scratch.
//
// Stubbed for Phase 0 — the readback→send seam exists but does nothing yet.

export type OutputTarget = 'spout' | 'syphon' | 'ndi'

export interface FramePayload {
  width: number
  height: number
  // RGBA8 pixels from gl.readPixels.
  pixels: Uint8Array
}

export class OutputSender {
  private enabled: Record<OutputTarget, boolean> = {
    spout: false,
    syphon: false,
    ndi: false
  }

  setEnabled(target: OutputTarget, on: boolean): void {
    this.enabled[target] = on
  }

  /** Phase 8: push `frame` to whichever native senders are enabled. */
  send(_frame: FramePayload): void {
    /* TODO Phase 8 — native Spout/Syphon/NDI */
  }
}
