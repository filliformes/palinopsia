// HiveEncoder : encodes the composite canvas to HEVC (WebCodecs) and ships the
// Annex-B chunks to the main-process HIVE sender. Real-time, hardware-preferred,
// ~80 Mbps to match HIVE. GOP + on-demand keyframes let new receivers join fast.
//
// EXPERIMENTAL: needs a WebCodecs HEVC *encoder* on the host (NVENC on the 4070).
// start() returns false when unsupported, so the UI can fall back gracefully.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const VideoEncoder: any
declare const VideoFrame: any

const GOP = 30 // keyframe every ~0.5s at 60fps (fast receiver join)

export class HiveEncoder {
  private enc: any = null
  private frame = 0
  private forceKey = true
  private ready = false

  async start(width: number, height: number): Promise<boolean> {
    if (typeof VideoEncoder === 'undefined') return false
    const config = {
      codec: 'hev1.1.6.L153.B0', // HEVC Main, Annex-B (in-band parameter sets)
      width,
      height,
      bitrate: 80_000_000,
      framerate: 60,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'realtime',
      hevc: { format: 'annexb' }
    }
    try {
      const sup = await VideoEncoder.isConfigSupported(config)
      if (!sup || !sup.supported) return false
      this.enc = new VideoEncoder({
        output: (chunk: any) => {
          const buf = new Uint8Array(chunk.byteLength)
          chunk.copyTo(buf)
          window.api.hiveSendChunk(chunk.type === 'key', buf)
        },
        error: (e: Error) => console.error('[hive-enc]', e.message)
      })
      this.enc.configure(config)
      this.ready = true
      this.forceKey = true
      this.frame = 0
      return true
    } catch (e) {
      console.error('[hive-enc] start failed:', (e as Error).message)
      return false
    }
  }

  requestKeyFrame(): void {
    this.forceKey = true
  }

  encode(canvas: HTMLCanvasElement, tsMicros: number): void {
    // Drop frames if the encoder is backed up (keeps latency low, never blocks).
    if (!this.ready || !this.enc || this.enc.encodeQueueSize > 2) return
    let vf: any
    try {
      vf = new VideoFrame(canvas, { timestamp: Math.round(tsMicros) })
    } catch {
      return
    }
    const key = this.forceKey || this.frame % GOP === 0
    this.forceKey = false
    try {
      this.enc.encode(vf, { keyFrame: key })
    } catch (e) {
      console.error('[hive-enc]', (e as Error).message)
    }
    vf.close()
    this.frame++
  }

  stop(): void {
    try {
      this.enc?.close()
    } catch {
      /* already closed */
    }
    this.enc = null
    this.ready = false
  }
}

// One shared encoder : the App render loop feeds it, OutputPage toggles it.
export const hiveEncoder = new HiveEncoder()
