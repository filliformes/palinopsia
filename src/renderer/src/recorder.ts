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
    this.rec.ondataavailable = (e): void => {
      if (!e.data || e.data.size === 0) return
      this.queue = this.queue.then(async () => {
        const buf = new Uint8Array(await e.data.arrayBuffer())
        window.api.recordingChunk(buf)
      })
    }
    // Small timeslice → frequent flushes → lower memory + tighter stop latency.
    this.rec.start(500)
    useStore.getState().setRecording(true)
    return true
  }

  /** Stop, flush all chunks, then let main produce the delivery file. */
  async stop(): Promise<string | null> {
    const rec = this.rec
    if (!rec) return null
    await new Promise<void>((res) => {
      rec.onstop = (): void => res()
      rec.stop()
    })
    // Stop only the canvas video tracks : the audio track is the LIVE sound
    // engine's output and must keep running for the performance.
    this.stream?.getVideoTracks().forEach((t) => t.stop())
    this.rec = null
    this.stream = null
    await this.queue // every chunk reached main before we finalize
    useStore.getState().setRecording(false)
    return window.api.recordingStop(this.formatId)
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
