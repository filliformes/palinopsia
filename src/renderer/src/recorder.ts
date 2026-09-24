// Output recorder : captures the live output canvas with MediaRecorder into a
// HIGH-bitrate, hardware-accelerated intermediate (H.264 where the platform
// offers it : smooth, low CPU), streams the chunks to main, and lets ffmpeg
// turn that into the chosen delivery format on stop (fast stream-copy remux when
// codecs match; a real transcode for ProRes / FFV1 / uncompressed / H.265 / VP9).
//
// MediaRecorder taps the canvas compositor output (no per-frame gl.readPixels),
// so recording doesn't stall the live show. The lo-fi/glitchy look before was
// MediaRecorder's ~2.5 Mbps default; we now set a resolution-scaled bitrate.

import { sonifyEngine } from './audio/sonify'
import { useStore } from './store'
import { showToast } from './components/Toast'

// Intermediate codec preference: H.264 first (hardware-encoded on Windows/macOS
// Chromium → smooth + cheap), then VP9, then VP8. Each maps to what we tell main.
const INTERMEDIATES: Array<{ mime: string; ext: string; codec: string }> = [
  { mime: 'video/x-matroska;codecs=avc1', ext: 'mkv', codec: 'h264' },
  { mime: 'video/mp4;codecs=avc1', ext: 'mp4', codec: 'h264' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm', codec: 'vp9' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm', codec: 'vp8' }
]

function pickIntermediate(withAudio: boolean): { mime: string; ext: string; codec: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  return (
    INTERMEDIATES.find((i) => {
      try {
        // With sonification running the intermediate must mux an Opus track :
        // test the combined mime (Chromium's mp4 muxer may refuse audio, in
        // which case we fall through to webm, which always takes vp9+opus).
        return MediaRecorder.isTypeSupported(withAudio ? `${i.mime},opus` : i.mime)
      } catch {
        return false
      }
    }) ?? null
  )
}

/** Delivery formats offered to the UI : comes from main (ffmpeg-gated). */
export async function recordingFormats(): Promise<Array<{ id: string; label: string }>> {
  try {
    return await window.api.recordingFormats()
  } catch {
    return [{ id: 'source', label: 'Fast · no re-encode' }]
  }
}

// Near-transparent capture bitrate: ~0.22 bits/pixel/frame, clamped so a 4K take
// doesn't overwhelm the hardware encoder. This is the intermediate only —
// ffmpeg re-encodes to the final format afterward.
function captureBitrate(w: number, h: number, fps: number): number {
  return Math.min(150_000_000, Math.max(25_000_000, Math.round(w * h * fps * 0.22)))
}

export class OutputRecorder {
  private rec: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private formatId = 'source'
  // Serialize chunk sends: arrayBuffer() is async and the byte stream must reach
  // disk strictly in order or the container is corrupt.
  private queue: Promise<void> = Promise.resolve()
  // Bytes actually handed to main this take (0 = the encoder never produced video).
  private bytes = 0
  // Why the last take ended badly, for the stop toast (null = fine).
  lastError: string | null = null
  // One stop in flight at a time : a second click joins it instead of stealing
  // its resolver (which used to leave the first caller waiting forever).
  private stopping: Promise<string | null> | null = null
  private watchdog: number | null = null

  get active(): boolean {
    return this.rec !== null
  }

  async start(canvas: HTMLCanvasElement, formatId: string): Promise<boolean> {
    if (this.rec) return false
    // Sonification running → mix its audio into the capture (a true
    // audiovisual take). The audio track belongs to the sound engine's
    // MediaStreamDestination : it is merged, never stopped by us.
    const soniStream = sonifyEngine.recordStream()
    const audioTracks = soniStream && sonifyEngine.isRunning() ? soniStream.getAudioTracks() : []
    const inter = pickIntermediate(audioTracks.length > 0)
    if (!inter) return false
    this.formatId = formatId
    this.bytes = 0
    this.lastError = null
    const ok = await window.api.recordingStart(inter.ext, inter.codec)
    if (!ok) return false
    try {
      const fps = 60
      const canvasStream = canvas.captureStream(fps)
      this.stream = audioTracks.length
        ? new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])
        : canvasStream
      this.rec = new MediaRecorder(this.stream, {
        mimeType: audioTracks.length ? `${inter.mime},opus` : inter.mime,
        videoBitsPerSecond: captureBitrate(canvas.width, canvas.height, fps),
        ...(audioTracks.length ? { audioBitsPerSecond: 256_000 } : {})
      })
    } catch {
      this.stream?.getVideoTracks().forEach((t) => t.stop())
      this.stream = null
      await window.api.recordingStop(formatId)
      return false
    }
    const rec = this.rec
    rec.ondataavailable = (e): void => {
      if (!e.data || e.data.size === 0) return
      this.bytes += e.data.size
      // A failed chunk must never poison the chain : every later chunk (and
      // stop's final flush) would otherwise wait on a rejected promise forever.
      this.queue = this.queue
        .then(async () => {
          const buf = new Uint8Array(await e.data.arrayBuffer())
          window.api.recordingChunk(buf)
        })
        .catch((err) => console.error('[recorder] chunk lost:', err))
    }
    // The encoder can die on its own (a frame size it refuses, e.g. a 4096² dome
    // master; a GPU reset; the canvas track ending). Finalize instead of leaving
    // the take "recording" with nothing behind it.
    rec.onerror = (ev): void => {
      const err = (ev as unknown as { error?: DOMException }).error
      this.lastError = `the video encoder stopped${err?.message ? ` (${err.message})` : ''}`
      console.error('[recorder] MediaRecorder error:', err)
      this.autoStop()
    }
    for (const t of this.stream.getVideoTracks()) {
      t.addEventListener('ended', () => {
        if (this.rec === rec) {
          this.lastError = 'the output stopped feeding the recorder'
          this.autoStop()
        }
      })
    }
    // Small timeslice → frequent flushes → lower memory + tighter stop latency.
    rec.start(500)
    // Nothing after 4 s = the encoder refused this output : say so and stop.
    this.watchdog = window.setTimeout(() => {
      this.watchdog = null
      if (this.rec === rec && this.bytes === 0) {
        this.lastError = `the encoder produced no video at ${canvas.width}×${canvas.height}${
          canvas.width > 4096 || canvas.height > 2304 ? ' (too large for it : try a smaller dome master or render size)' : ''
        }`
        this.autoStop()
      }
    }, 4000)
    useStore.getState().setRecording(true)
    return true
  }

  /** The take ended on its own (encoder error, lost track, nothing captured) :
   *  finalize it and tell the player why, without waiting for a click. */
  private autoStop(): void {
    void this.stop().then((path) => {
      const why = this.lastError ?? 'the recorder stopped'
      showToast(
        path
          ? `Recording stopped : ${why}. Kept what was captured · ${path.split(/[\\/]/).pop() ?? path}`
          : `Recording stopped : ${why}. Nothing was saved.`,
        'warn',
        8000
      )
    })
  }

  /** Stop, flush all chunks, then let main produce the delivery file. Never
   *  hangs and never throws : whatever happens, the take ends and the REC state
   *  clears. Returns the saved path, or null (see `lastError` for why). */
  stop(): Promise<string | null> {
    if (this.stopping) return this.stopping
    this.stopping = this.doStop().finally(() => {
      this.stopping = null
    })
    return this.stopping
  }

  private async doStop(): Promise<string | null> {
    if (this.watchdog !== null) { window.clearTimeout(this.watchdog); this.watchdog = null }
    const rec = this.rec
    try {
      if (rec) {
        // Wait for the final chunk, but only if the recorder is still running :
        // one that already stopped (error, lost track) will never fire 'stop'
        // again, and waiting on it was the hang. 3 s cap regardless.
        if (rec.state !== 'inactive') {
          await new Promise<void>((res) => {
            const done = (): void => { window.clearTimeout(t); res() }
            const t = window.setTimeout(done, 3000)
            rec.addEventListener('stop', done, { once: true })
            try { rec.stop() } catch { done() }
          })
        }
        // Stop only the canvas video tracks : the audio track is the LIVE sound
        // engine's output and must keep running for the performance.
        this.stream?.getVideoTracks().forEach((t) => t.stop())
        this.rec = null
        this.stream = null
        await this.queue.catch(() => {}) // every chunk reached main before we finalize
      }
    } finally {
      useStore.getState().setRecording(false)
    }
    if (!rec) return null
    if (this.bytes === 0 && !this.lastError) this.lastError = 'the encoder produced no video'
    try {
      return await window.api.recordingStop(this.formatId)
    } catch (e) {
      this.lastError = this.lastError ?? `saving failed (${(e as Error).message})`
      return null
    }
  }
}

// The ONE recorder : recording is a global take, not an Output-page visit.
// Starting happens from the Output page; the take keeps rolling when you
// return to the main view (a REC pill in the top bar shows it + stops it).
export const outputRecorder = new OutputRecorder()

/** One-shot PNG of the current output frame at its native resolution. */
export async function captureScreenshot(canvas: HTMLCanvasElement): Promise<string | null> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) return null
  const buf = new Uint8Array(await blob.arrayBuffer())
  return window.api.saveScreenshot(buf)
}
