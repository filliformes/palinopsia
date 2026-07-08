// Output recorder — captures the live output canvas with MediaRecorder and
// streams the encoded chunks to main (→ the Recorded/ folder). MediaRecorder is
// the GPU-friendly path: it taps the canvas's compositor output without a
// per-frame gl.readPixels stall, so recording doesn't tank the live show.
//
// Format choice is what the platform's Chromium actually supports (probed at
// runtime). "Max quality" is a very-high-bitrate VP9 — the nearest thing to
// lossless MediaRecorder offers (true uncompressed single-file video would need
// a bundled ffmpeg + raw-frame readback, which stalls live rendering).

export interface RecFormat {
  id: string
  label: string
  mime: string
  ext: string
  bitrate?: number
}

const CANDIDATES: RecFormat[] = [
  { id: 'vp9', label: 'WebM · VP9 (compressed)', mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { id: 'vp8', label: 'WebM · VP8 (compressed)', mime: 'video/webm;codecs=vp8', ext: 'webm' },
  { id: 'h264-mp4', label: 'MP4 · H.264 (compressed)', mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
  { id: 'h264-mkv', label: 'MKV · H.264 (compressed)', mime: 'video/x-matroska;codecs=avc1', ext: 'mkv' },
  { id: 'av1', label: 'WebM · AV1 (compressed)', mime: 'video/webm;codecs=av01', ext: 'webm' },
  {
    id: 'vp9-max',
    label: 'WebM · VP9 (max quality)',
    mime: 'video/webm;codecs=vp9',
    ext: 'webm',
    bitrate: 240_000_000
  }
]

/** The subset of formats this build can actually encode, in menu order. */
export function supportedFormats(): RecFormat[] {
  if (typeof MediaRecorder === 'undefined') return []
  return CANDIDATES.filter((f) => {
    try {
      return MediaRecorder.isTypeSupported(f.mime)
    } catch {
      return false
    }
  })
}

export class OutputRecorder {
  private rec: MediaRecorder | null = null
  private stream: MediaStream | null = null
  // Serialize chunk sends: arrayBuffer() is async, and the byte stream must
  // reach disk strictly in order or the container is corrupt.
  private queue: Promise<void> = Promise.resolve()

  get active(): boolean {
    return this.rec !== null
  }

  async start(canvas: HTMLCanvasElement, fmt: RecFormat): Promise<boolean> {
    if (this.rec) return false
    const path = await window.api.recordingStart(fmt.ext)
    if (!path) return false
    try {
      this.stream = canvas.captureStream(60)
      const opts: MediaRecorderOptions = { mimeType: fmt.mime }
      if (fmt.bitrate) opts.videoBitsPerSecond = fmt.bitrate
      this.rec = new MediaRecorder(this.stream, opts)
    } catch {
      this.stream?.getTracks().forEach((t) => t.stop())
      this.stream = null
      await window.api.recordingStop()
      return false
    }
    this.rec.ondataavailable = (e): void => {
      if (!e.data || e.data.size === 0) return
      this.queue = this.queue.then(async () => {
        const buf = new Uint8Array(await e.data.arrayBuffer())
        window.api.recordingChunk(buf)
      })
    }
    this.rec.start(1000) // 1s timeslice → periodic chunks streamed to disk
    return true
  }

  /** Stop, flush all pending chunks, and return the finished clip's path. */
  async stop(): Promise<string | null> {
    const rec = this.rec
    if (!rec) return null
    await new Promise<void>((res) => {
      rec.onstop = (): void => res()
      rec.stop()
    })
    this.stream?.getTracks().forEach((t) => t.stop())
    this.rec = null
    this.stream = null
    await this.queue // ensure every chunk reached main before we close the file
    return window.api.recordingStop()
  }
}

/** One-shot PNG of the current output frame at its native resolution. */
export async function captureScreenshot(canvas: HTMLCanvasElement): Promise<string | null> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) return null
  const buf = new Uint8Array(await blob.arrayBuffer())
  return window.api.saveScreenshot(buf)
}
